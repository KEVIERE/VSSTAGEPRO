/**
 * Contas da onda que acompanha o zoom ao vivo (sem dependências do programa, para os testes).
 *
 * Durante a pinça ou a roda com Ctrl/Cmd a geometria anda por CSS (--vs-zoom) e a onda de cada
 * clipe é redesenhada a cada quadro num canvas do tamanho só da parte visível do clipe
 * (liveWaveHub). Para caber no quadro, cada coluna da tela lê poucos valores: os resumos ganham
 * níveis prontos (pirâmide de máximos, cada nível com o maior de cada par do nível de baixo), e o
 * máximo de um trecho qualquer sai exato com no máximo duas leituras por nível.
 *
 * As colunas dão exatamente o mesmo que waveColumns, fineColumns e sampleColumns (waveColumns.ts),
 * que o desenho normal usa no fim do gesto: a forma não muda na troca, só o acabamento.
 */

export type PeakArray = Uint8Array | Float32Array;

/** levels[0] são os dados; levels[k][i] = max(levels[k-1][2i], levels[k-1][2i+1]). */
export interface PeakPyramid {
  levels: ArrayLike<number>[];
}

/** Os níveis de cima têm o tipo dos dados (bytes do resumo detalhado) ou Float32 (resumo do projeto). */
export function buildPyramid(base: ArrayLike<number>): PeakPyramid {
  const levels: ArrayLike<number>[] = [base];
  const bytes = base instanceof Uint8Array;
  let prev = base;
  while (prev.length > 2) {
    const len = Math.ceil(prev.length / 2);
    const next: PeakArray = bytes ? new Uint8Array(len) : new Float32Array(len);
    const last = prev.length - 1;
    for (let i = 0, j = 0; i < len; i++, j += 2) {
      const a = prev[j];
      const b = j < last ? prev[j + 1] : 0;
      next[i] = a > b ? a : b;
    }
    levels.push(next);
    prev = next;
  }
  return { levels };
}

/** Maior valor de levels[0] no trecho [a, b), exato. */
export function pyramidMax(p: PeakPyramid, a: number, b: number): number {
  const levels = p.levels;
  const top = levels.length - 1;
  let m = 0;
  let lv = 0;
  if (a < 0) a = 0;
  if (b > levels[0].length) b = levels[0].length;
  while (a < b) {
    const d = levels[lv];
    if (lv >= top || b - a <= 4) {
      for (let i = a; i < b; i++) if (d[i] > m) m = d[i];
      break;
    }
    // ponta esquerda filha da direita e ponta direita filha da esquerda: lidas aqui; o resto sobe
    if (a & 1) { if (d[a] > m) m = d[a]; a++; }
    if (b & 1) { b--; if (d[b] > m) m = d[b]; }
    a >>= 1;
    b >>= 1;
    lv++;
  }
  return m;
}

/** Trechos curtos (até isso de pontos por coluna) são lidos direto, sem pirâmide. */
export const DIRECT_MAX_RUN = 12;

/**
 * Memória dos níveis de cima guardados entre um gesto e outro. Afastado, cada clipe da tela monta
 * a sua pirâmide; sem limite, um show grande inteiro na tela deixava dezenas de MB presos até o
 * projeto fechar. Durante o gesto nada sai (não monta de novo a cada quadro); no fim, os menos
 * usados saem até caber.
 */
export const PYRAMID_BUDGET_BYTES = 16 * 1024 * 1024;

/** Só os níveis de cima: os dados são do clipe (ou do resumo detalhado) e não ficam presos aqui. */
interface Upper { levels: PeakArray[] | null; bytes: number }
const uppers = new WeakMap<object, Upper>();
/** Ordem de uso (o mais recente no fim). */
const used = new Set<Upper>();
let upperBytes = 0;

/** Pirâmide do resumo detalhado (bytes) ou do resumo do projeto, montada uma vez (sem copiar os dados). */
export function pyramidOf(data: ArrayLike<number>): PeakPyramid {
  let u = uppers.get(data as object);
  if (!u) { u = { levels: null, bytes: 0 }; uppers.set(data as object, u); }
  if (!u.levels) {
    u.levels = buildPyramid(data).levels.slice(1) as PeakArray[];
    u.bytes = u.levels.reduce((n, l) => n + l.byteLength, 0);
    upperBytes += u.bytes;
  }
  used.delete(u);
  used.add(u);
  const levels: ArrayLike<number>[] = [data];
  for (const l of u.levels) levels.push(l);
  return { levels };
}

/** Fim do gesto: tira as pirâmides menos usadas até caber no limite. */
export function trimPyramids(budget = PYRAMID_BUDGET_BYTES): void {
  for (const u of used) {
    if (upperBytes <= budget) break;
    used.delete(u);
    upperBytes -= u.bytes;
    u.levels = null;
    u.bytes = 0;
  }
}

/** Memória dos níveis guardados (para teste). */
export function pyramidBytes(): number {
  return upperBytes;
}

/** Já tem pirâmide pronta (para teste). */
export function hasPyramid(data: object): boolean {
  return !!uppers.get(data)?.levels;
}

/**
 * Igual ao ramo do resumo do projeto de waveColumns (`peaks`, `n` pontos, `total` px do arquivo
 * inteiro), escrevendo em `out` (width + 1 colunas, a partir do pixel `offset`).
 */
export function peaksColumnsInto(peaks: ArrayLike<number>, total: number, offset: number, width: number, out: Float32Array): Float32Array {
  const n = peaks.length;
  const full = Math.max(1, total);
  out.fill(0, 0, width + 1);
  if (n === 0) return out;
  if (n <= full) {
    // cada ponto no centro do trecho que resume (duas leituras por coluna)
    for (let x = 0; x <= width; x++) {
      if (offset + x < 0) continue;
      const pos = Math.max(0, Math.min(n - 1, ((offset + x + 0.5) / full) * n - 0.5));
      const i = Math.floor(pos);
      const a = peaks[i] ?? 0;
      const b = peaks[Math.min(i + 1, n - 1)] ?? 0;
      const t = pos - i;
      out[x] = a + (b - a) * t * t * (3 - 2 * t);
    }
    return out;
  }
  // afastado: o maior ponto que cai no pixel, pela pirâmide quando o trecho é longo
  const long = n / full > DIRECT_MAX_RUN;
  const pyr = long ? pyramidOf(peaks) : null;
  for (let x = 0; x <= width; x++) {
    if (offset + x < 0) continue;
    const s = Math.floor(((offset + x) / full) * n);
    const e = Math.min(n, Math.max(s + 1, Math.floor(((offset + x + 1) / full) * n)));
    if (s >= n) break;
    if (pyr) {
      out[x] = pyramidMax(pyr, s, e);
    } else {
      let m = 0;
      for (let i = s; i < e; i++) if (peaks[i] > m) m = peaks[i];
      out[x] = m;
    }
  }
  return out;
}

export interface FineLike {
  sampleRate: number;
  framesPer: number;
  data: Uint8Array;
}

const FINE_DECODE = (() => {
  const t = new Float32Array(256);
  for (let i = 0; i < 256; i++) { const v = i / 255; t[i] = v * v; }
  return t;
})();

/** Igual a fineColumns, escrevendo em `out`. */
export function fineColumnsInto(fine: FineLike, duration: number, total: number, offset: number, width: number, out: Float32Array): Float32Array {
  out.fill(0, 0, width + 1);
  const fp = Math.max(1, fine.framesPer);
  const perPx = (duration / Math.max(1, total)) * fine.sampleRate;
  const data = fine.data;
  const bins = data.length;
  const pyr = perPx / fp > DIRECT_MAX_RUN ? pyramidOf(data) : null;
  for (let x = 0; x <= width; x++) {
    if (offset + x < 0) continue;
    const s0 = Math.floor((offset + x) * perPx);
    const s1 = Math.max(s0 + 1, Math.floor((offset + x + 1) * perPx));
    const b0 = Math.floor(s0 / fp);
    if (b0 >= bins) break;
    const b1 = Math.min(bins, Math.max(b0 + 1, Math.ceil(s1 / fp)));
    let m = 0;
    if (pyr) m = pyramidMax(pyr, b0, b1);
    else for (let b = b0; b < b1; b++) if (data[b] > m) m = data[b];
    out[x] = FINE_DECODE[m];
  }
  return out;
}

/** Igual a sampleColumns (amostras na memória, começando no quadro 0), escrevendo em `out`. */
export function sampleColumnsInto(channels: Int16Array[], totalFrames: number, perPx: number, offset: number, width: number, out: Float32Array): Float32Array {
  out.fill(0, 0, width + 1);
  const chs = channels.slice(0, 2);
  const have = chs.length ? Math.min(...chs.map((c) => c.length)) : 0;
  const end = Math.min(totalFrames, have);
  for (let x = 0; x <= width; x++) {
    if (offset + x < 0) continue;
    const s0 = Math.floor((offset + x) * perPx);
    if (s0 >= end) break;
    const s1 = Math.min(end, Math.max(s0 + 1, Math.floor((offset + x + 1) * perPx)));
    let m = 0;
    for (const ch of chs) {
      for (let s = Math.max(s0, 0); s < s1; s++) {
        const raw = ch[s];
        const v = raw < 0 ? -raw : raw;
        if (v > m) m = v;
      }
    }
    out[x] = m / 32768;
  }
  return out;
}

/** Com o áudio na memória e sem resumo detalhado, as amostras só entram até isso de quadros por pixel. */
export const LIVE_SAMPLES_MAX_PER_PX = 128;
/**
 * ...ou quando o canvas inteiro lê até isso de quadros (o mesmo custo de uma tela de 2048 px no
 * limite acima). Áudio curto (fala do Maestro IA, que tem só 400 pontos no resumo do projeto) cabe
 * sempre: lê as amostras como o desenho normal, e a forma não muda no fim do gesto.
 */
export const LIVE_SAMPLES_MAX_FRAMES = LIVE_SAMPLES_MAX_PER_PX * 2048;

export type LiveKind = 'fine' | 'samples' | 'peaks' | 'none';

/**
 * De onde vêm as colunas no quadro do gesto, na mesma ordem do desenho normal: aproximado (o
 * arquivo tem mais pixels que pontos no resumo do projeto) usa o resumo detalhado, ou as amostras
 * quando são poucas por pixel, ou o resumo do projeto; afastado, sempre o resumo do projeto.
 */
export function pickLiveKind(o: { peakCount: number; total: number; hasFine: boolean; hasAudio: boolean; framesPerPx: number; cols?: number }): LiveKind {
  const full = Math.max(1, o.total);
  const samplesOk = o.hasAudio && (o.framesPerPx <= LIVE_SAMPLES_MAX_PER_PX || o.framesPerPx * (o.cols ?? Infinity) <= LIVE_SAMPLES_MAX_FRAMES);
  if (o.peakCount > 0 && full < o.peakCount) return 'peaks';
  if (o.hasFine) return 'fine';
  if (samplesOk) return 'samples';
  return o.peakCount > 0 ? 'peaks' : 'none';
}

/** Parte do arquivo que o canvas do gesto cobre, em px do arquivo no zoom do quadro. */
export interface LiveSpan {
  /** Primeiro pixel do arquivo (inteiro): a borda esquerda do canvas dentro do clipe. */
  left: number;
  /** Colunas (o desenho tem width + 1 valores, como os blocos do desenho normal). */
  width: number;
  /** Largura do arquivo inteiro (px) no zoom do quadro. */
  total: number;
}

export interface LiveSpanInput {
  zoom: number;
  scrollLeft: number;
  clientWidth: number;
  /** Início do arquivo inteiro na timeline (s). */
  startSec: number;
  /** Duração do arquivo inteiro (s). */
  duration: number;
  /** Largura mínima do arquivo na tela (px), a mesma do estilo. */
  minPx: number;
  /** Trecho que toca (s do arquivo): fora dele o clipe esconde a onda. */
  from?: number;
  to?: number;
  /** Folga dos lados da tela (px). */
  pad?: number;
}

/** O canvas cobre só o pedaço do arquivo que está na tela (e no trecho que toca); null fora dela. */
export function liveSpan(i: LiveSpanInput): LiveSpan | null {
  if (!(i.zoom > 0) || !(i.duration > 0) || !Number.isFinite(i.startSec)) return null;
  const total = Math.max(i.minPx, i.duration * i.zoom);
  const fileLeft = i.startSec * i.zoom;
  const pad = i.pad ?? 0;
  const k = total / i.duration;
  const p0 = Math.max(0, (i.from ?? 0) * k);
  const p1 = Math.min(total, (i.to ?? i.duration) * k);
  const a = Math.floor(Math.max(0, p0, i.scrollLeft - pad - fileLeft));
  const b = Math.ceil(Math.min(total, p1, i.scrollLeft + i.clientWidth + pad - fileLeft));
  if (!(b - a >= 1)) return null;
  return { left: a, width: b - a, total };
}

/**
 * Altura (px, de cada lado do meio) de cada coluna, com a mesma conta do desenho normal (WaveTile):
 * ganho, escala perceptual pow 0,68, silêncio abaixo de 0,003 com altura zero e mínimo de 0,5 px.
 */
export function liveHeightsInto(cols: Float32Array, width: number, gain: number, amp: number, out: Float32Array): Float32Array {
  const g = Math.max(0.01, gain || 1);
  for (let x = 0; x <= width; x++) {
    const raw = cols[x] * g;
    const v = Math.pow(Math.max(0, Math.min(1, raw)), 0.68);
    out[x] = v < 0.003 ? 0 : Math.max(0.5, v * amp);
  }
  return out;
}

/** Orçamento do desenho de todas as ondas num quadro do gesto (ms). */
export const LIVE_BUDGET_MS = 6;
/** Passou disso dentro do quadro: as ondas que faltam ficam esticadas neste quadro. */
export const LIVE_HARD_MS = 9;

/**
 * Quantas ondas desenhar no próximo quadro. Passou do orçamento: só as mais próximas do mouse, na
 * proporção do tempo gasto (com folga). Sobrou bastante: volta a desenhar mais, aos poucos.
 */
export function nextLiveLimit(limit: number, drawn: number, wanted: number, elapsedMs: number, budgetMs = LIVE_BUDGET_MS): number {
  if (drawn <= 0) return limit;
  if (elapsedMs > budgetMs) return Math.max(1, Math.floor(drawn * (budgetMs / elapsedMs) * 0.85));
  if (drawn < wanted && limit <= drawn && elapsedMs < budgetMs * 0.5) return drawn + Math.max(1, Math.ceil(drawn * 0.25));
  return limit;
}

/** Ordem do desenho: das faixas mais próximas do mouse (altura do centro) para as mais longe. */
export function orderByDistance(centers: number[], mouseY: number): number[] {
  const idx = centers.map((_, i) => i);
  idx.sort((a, b) => Math.abs(centers[a] - mouseY) - Math.abs(centers[b] - mouseY));
  return idx;
}
