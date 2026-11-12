// Ajuste automático do som de click que o usuário importa (Recriar metrônomo → Seu som).
// Mesmo tratamento dado ao Agradável e ao Bloco:
// - acha cada toque do arquivo (um toque só ou um compasso inteiro gravado);
// - corta o começo no ataque (a -20 dB do pico): sem silêncio, chiado ou pré-eco do MP3 antes,
//   para a batida cair em cima do som;
// - corta o fim quando o som volta ao chiado (no máximo 0,5 s), com saída suave;
// - se o arquivo tem dois sons (como 1 2 3 4 | 1, com o 1 diferente), separa o do 1 do
//   compasso e o dos outros tempos, pelo tom ou pelo volume.
// O volume final é acertado em clickSounds (levelHits). Sem AudioBuffer, para dar para testar.

import { clickHits } from './clickEdit.ts';
import type { ClickHit } from './clickSounds.ts';

export interface PreparedClick {
  normal: ClickHit;
  /** O toque do 1 do compasso, quando o arquivo tem dois sons. */
  accent?: ClickHit;
  /** Quantos toques o arquivo tem. */
  hits: number;
}

/** Só os primeiros 30 s do arquivo entram na conta. */
const MAX_SECONDS = 30;
/** Toque mais longo que isso é cortado (com saída suave). */
const MAX_HIT_SECONDS = 0.5;

function percentile(data: Float32Array, p: number): number {
  const step = Math.max(1, Math.floor(data.length / 20000));
  const xs: number[] = [];
  for (let i = 0; i < data.length; i += step) xs.push(data[i]);
  xs.sort((a, b) => a - b);
  return xs[Math.min(xs.length - 1, Math.floor(xs.length * p))] ?? 0;
}

interface Cut { start: number; end: number; peak: number }

/** Recorta o toque que começa perto de `approx`, sem passar de `lo`..`hi` (os toques vizinhos). */
function cutHit(level: Float32Array, loud: Float32Array, sr: number, approx: number, lo: number, hi: number, noise: number): Cut | null {
  const ms = (x: number) => Math.round((x * sr) / 1000);
  let peak = 0;
  let pi = approx;
  for (let i = Math.max(lo, approx - ms(5)); i < Math.min(hi, approx + ms(40)); i++) {
    if (level[i] > peak) { peak = level[i]; pi = i; }
  }
  if (peak <= 0) return null;
  // começo: primeira amostra a -20 dB do pico; recua até 3 amostras para o cruzamento de zero
  let start = pi;
  for (let i = Math.max(lo, approx - ms(10)); i <= pi; i++) {
    if (level[i] >= peak * 0.1) { start = i; break; }
  }
  for (let i = start; i >= Math.max(lo + 1, start - 3); i--) {
    if (Math.sign(loud[i]) !== Math.sign(loud[i - 1])) { start = i; break; }
  }
  // fim: quando o maior valor em 5 ms volta para perto do chiado
  const limit = Math.min(hi, start + Math.round(MAX_HIT_SECONDS * sr));
  const win = ms(5);
  const quiet = Math.max(noise * 1.6, peak * 0.004);
  let end = limit;
  for (let i = pi; i < limit; i += Math.max(1, ms(1))) {
    let p = 0;
    for (let k = i; k < Math.min(limit, i + win); k++) p = Math.max(p, level[k]);
    if (p <= quiet) { end = Math.min(limit, i + win); break; }
  }
  if (end - start < ms(2)) return null;
  return { start, end, peak };
}

/** Copia o trecho em estéreo, com entrada de 3 amostras e saída suave. */
function extract(channels: Float32Array[], c: Cut): ClickHit {
  const len = c.end - c.start;
  const L = channels[0].slice(c.start, c.end);
  const R = (channels[1] ?? channels[0]).slice(c.start, c.end);
  const fin = Math.min(3, len);
  for (let i = 0; i < fin; i++) { L[i] *= i / fin; R[i] *= i / fin; }
  const fo = Math.max(1, Math.round(len * 0.4));
  for (let i = 0; i < fo; i++) {
    const g = (i / fo) ** 2;
    L[len - 1 - i] *= g;
    R[len - 1 - i] *= g;
  }
  return [L, R];
}

/** Cruzamentos de zero por segundo nos primeiros 15 ms: mede o tom (agudo ou grave). */
function zeroRate(hit: ClickHit, sr: number): number {
  const [L, R] = hit;
  const n = Math.min(L.length, Math.round(0.015 * sr));
  const d = Array.from({ length: n }, (_, i) => (Math.abs(L[i]) >= Math.abs(R[i]) ? L[i] : R[i]));
  let z = 0;
  for (let i = 1; i < n; i++) if ((d[i - 1] < 0) !== (d[i] < 0)) z++;
  return (z * sr) / Math.max(1, n);
}

/**
 * Separa os toques em dois grupos pelo maior salto do valor (tom ou volume), se o salto for
 * grande o bastante. Devolve o índice de cada toque no grupo de cima (true) ou de baixo.
 */
function splitByGap(values: number[], minJump: (a: number, b: number) => boolean): boolean[] | null {
  const sorted = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  let best = -1;
  let bestJump = 0;
  for (let k = 0; k < sorted.length - 1; k++) {
    const a = sorted[k].v;
    const b = sorted[k + 1].v;
    if (minJump(a, b) && b - a > bestJump) { bestJump = b - a; best = k; }
  }
  if (best < 0) return null;
  const cut = sorted[best].v;
  return values.map((v) => v > cut);
}

/** O toque mais típico do grupo: o de pico mediano. */
function typical(cuts: Cut[], idx: number[]): number {
  const s = [...idx].sort((a, b) => cuts[a].peak - cuts[b].peak);
  return s[Math.floor(s.length / 2)];
}

/**
 * Ajusta o som importado: acha os toques, recorta cada um no ataque e, se houver dois sons,
 * separa o do 1 do compasso (o grupo que aparece menos; empate fica com o do primeiro toque).
 * Erro com mensagem para a tela se não achar nenhum toque.
 */
export function prepareImportedClick(channels: Float32Array[], sampleRate: number): PreparedClick {
  if (!channels.length || !channels[0].length) throw new Error('o arquivo está vazio');
  const n = Math.min(channels[0].length, Math.round(MAX_SECONDS * sampleRate));
  const chans = channels.slice(0, 2).map((c) => c.subarray(0, n));
  const level = new Float32Array(n);
  const loud = new Float32Array(n);
  for (const ch of chans) {
    for (let i = 0; i < n; i++) {
      const v = Math.abs(ch[i]);
      if (v > level[i]) { level[i] = v; loud[i] = ch[i]; }
    }
  }
  let peak = 0;
  let peakAt = 0;
  for (let i = 0; i < n; i++) if (level[i] > peak) { peak = level[i]; peakAt = i; }
  if (peak < 1e-3) throw new Error('o áudio está em silêncio');
  const noise = percentile(level, 0.2);

  let starts = clickHits(level, sampleRate);
  if (!starts.length) starts = [peakAt];
  const cuts: Cut[] = [];
  starts.forEach((approx, k) => {
    const lo = k > 0 ? Math.round((starts[k - 1] + approx) / 2) : 0;
    const hi = k < starts.length - 1 ? starts[k + 1] - Math.round(0.002 * sampleRate) : n;
    const c = cutHit(level, loud, sampleRate, approx, lo, Math.max(lo + 1, hi), noise);
    if (c) cuts.push(c);
  });
  if (!cuts.length) throw new Error('não achei nenhum toque nesse áudio');
  const hits = cuts.map((c) => extract(chans, c));

  // dois sons? primeiro pelo tom (salto de 20% ou mais), depois pelo volume (3 dB ou mais)
  let upper: boolean[] | null = null;
  let accentIsUpper = true;
  if (hits.length >= 2) {
    upper = splitByGap(hits.map((h) => zeroRate(h, sampleRate)), (a, b) => b >= a * 1.2);
    if (!upper) {
      upper = splitByGap(cuts.map((c) => 20 * Math.log10(c.peak)), (a, b) => b - a >= 3);
      // pelo volume, o do 1 é o mais forte
      if (upper) accentIsUpper = true;
    } else {
      // pelo tom: o do 1 é o grupo que aparece menos (empate: o do primeiro toque)
      const ups = upper.filter(Boolean).length;
      const downs = upper.length - ups;
      accentIsUpper = ups === downs ? upper[0] : ups < downs;
    }
  }
  const all = cuts.map((_, i) => i);
  if (!upper) return { normal: hits[typical(cuts, all)], hits: hits.length };
  const accentIdx = all.filter((i) => upper![i] === accentIsUpper);
  const normalIdx = all.filter((i) => upper![i] !== accentIsUpper);
  return {
    normal: hits[typical(cuts, normalIdx)],
    accent: hits[typical(cuts, accentIdx)],
    hits: hits.length,
  };
}

/** Deixa o maior pico dos toques em 0,95 (para guardar em 16 bits sem perder detalhe). */
export function scaleForStorage(p: PreparedClick): PreparedClick {
  let peak = 0;
  for (const ch of [...p.normal, ...(p.accent ?? [])]) for (let i = 0; i < ch.length; i++) peak = Math.max(peak, Math.abs(ch[i]));
  if (peak <= 0) return p;
  const g = 0.95 / peak;
  const scale = ([L, R]: ClickHit): ClickHit => [L.map((v) => v * g), R.map((v) => v * g)];
  return { ...p, normal: scale(p.normal), accent: p.accent ? scale(p.accent) : undefined };
}
