import { clickHits } from './clickEdit.ts';

// Click com BPM alterado sem passar pelo SoundTouch. O SoundTouch escolhe o melhor encaixe a cada
// janela, então cada batida do click sairia com um desvio diferente. Aqui o som de cada batida é
// copiado como está (sem esticar) para o lugar dela no andamento novo. Contas puras, sem áudio do
// navegador: rodam no worker (clickRemount.worker.ts) e nos testes.

// Mesmas janelas do reprodutor e do preparo em segundo plano (setParameters(sr, 82, 28, 12)).
const SOUNDTOUCH_SEQUENCE_MS = 82;
const SOUNDTOUCH_OVERLAP_MS = 12;

/** Trecho copiado antes do ataque de cada batida (o começo do som fica um pouco antes dele). */
const PRE_ATTACK_SEC = 0.002;
/** Saída suave no fim de cada batida, para o corte nunca virar estalo. */
const TAIL_FADE_SEC = 0.004;
/** Janela depois de cada batida em que tem de estar o som de um click de verdade. */
const HIT_WINDOW_SEC = 0.25;
/** Parte mínima da energia dentro dessas janelas. Abaixo disso a faixa não é só click (voz, guia). */
const MIN_ENERGY_IN_HITS = 0.9;
const MIN_HITS = 4;

/**
 * Quanto a música sai adiantada (segundos) ao passar pelo SoundTouch no andamento `tempo`. O
 * SoundTouch guarda a primeira sobreposição sem tocar e, dentro de cada janela, o áudio anda no
 * passo do original. O click remontado fica junto da banda, que continua passando pelo SoundTouch.
 * Medido em 5 músicas reais: o erro desta conta fica dentro de 3,5 ms da mediana da banda.
 * No BPM original não há adiantamento: bateria e percussão tocam sem SoundTouch, e as faixas com
 * tom alterado são devolvidas para a grade (stretchLatency).
 */
export function bandLeadSeconds(tempo: number): number {
  if (Math.abs(tempo - 1) < 1e-4) return 0;
  const hop = SOUNDTOUCH_SEQUENCE_MS - SOUNDTOUCH_OVERLAP_MS;
  return (SOUNDTOUCH_OVERLAP_MS + (hop / 2) * (1 - tempo)) / tempo / 1000;
}

/** O canal mais forte de cada amostra, em -1..1 (click em um lado só também vale). */
function strongest(left: Int16Array, right: Int16Array): Float32Array {
  const out = new Float32Array(left.length);
  const k = 1 / 32767;
  for (let i = 0; i < left.length; i++) {
    const a = left[i];
    const b = right[i];
    out[i] = (Math.abs(a) >= Math.abs(b) ? a : b) * k;
  }
  return out;
}

/**
 * Batidas (índices de amostra) de um áudio de click, ou null se a faixa não for só click: aí ela
 * continua pelo caminho normal, porque remontar em pedaços estragaria voz ou guia gravada junto.
 */
export function findClickBeats(left: Int16Array, right: Int16Array, sampleRate: number): number[] | null {
  const data = strongest(left, right);
  const hits = clickHits(data, sampleRate);
  if (hits.length < MIN_HITS) return null;
  const reach = Math.round(HIT_WINDOW_SEC * sampleRate);
  const pre = Math.round(PRE_ATTACK_SEC * sampleRate);
  let inside = 0;
  let total = 0;
  let h = 0;
  for (let i = 0; i < data.length; i++) {
    const e = data[i] * data[i];
    total += e;
    while (h + 1 < hits.length && hits[h + 1] - pre <= i) h++;
    if (i >= hits[h] - pre && i < hits[h] + reach) inside += e;
  }
  return total > 0 && inside / total >= MIN_ENERGY_IN_HITS ? hits : null;
}

/** Copia `src[from..from+count)` em `dst[at..)` com saída suave nas últimas `fade` amostras. */
function copyHit(src: Int16Array, dst: Int16Array, from: number, at: number, count: number, fade: number) {
  dst.set(src.subarray(from, from + count), at);
  const f = Math.min(fade, count);
  for (let i = 0; i < f; i++) {
    const p = at + count - 1 - i;
    dst[p] = Math.round(dst[p] * (i / f));
  }
}

/** Põe o som de cada batida em `batida / tempo - lead`, sem invadir a batida seguinte. */
function placeHits(
  left: Int16Array, right: Int16Array, hits: number[], sampleRate: number, tempo: number, lead: number,
  outL: Int16Array, outR: Int16Array,
) {
  const length = outL.length;
  const pre = Math.round(PRE_ATTACK_SEC * sampleRate);
  const fade = Math.round(TAIL_FADE_SEC * sampleRate);
  const place = (h: number) => Math.round(h / tempo) - lead;
  for (let k = 0; k < hits.length; k++) {
    const h = hits[k];
    // o trecho antes do ataque nunca invade a batida anterior
    const before = k > 0 ? Math.min(pre, Math.floor((h - hits[k - 1]) / 2)) : Math.min(pre, h);
    // Batida colada no começo: entra no 0 com o ataque inteiro, em vez de perder o começo do som.
    const at = Math.max(0, place(h) - before);
    const from = h - before;
    const nextAt = k + 1 < hits.length
      ? Math.max(at, place(hits[k + 1]) - Math.min(pre, Math.floor((hits[k + 1] - h) / 2)))
      : length;
    const srcEnd = k + 1 < hits.length ? hits[k + 1] - Math.min(pre, Math.floor((hits[k + 1] - h) / 2)) : left.length;
    const count = Math.min(srcEnd - from, nextAt - at, length - at);
    if (count <= 0) continue;
    copyHit(left, outL, from, at, count, fade);
    if (outR !== outL) copyHit(right, outR, from, at, count, fade);
  }
}

/**
 * Remonta o click no andamento `tempo`: o som de cada batida, intacto, em `batida / tempo`, junto
 * da banda (bandLeadSeconds). Devolve o áudio no formato que o reprodutor lê como já processado.
 */
export function remountClick(
  left: Int16Array, right: Int16Array, hits: number[], sampleRate: number, tempo: number,
): { left: Int16Array; right: Int16Array } {
  const length = Math.ceil(left.length / tempo);
  const outL = new Int16Array(length);
  const outR = right === left ? outL : new Int16Array(length);
  placeHits(left, right, hits, sampleRate, tempo, Math.round(bandLeadSeconds(tempo) * sampleRate), outL, outR);
  return { left: outL, right: outR };
}

/**
 * Refaz o click remontado com cada batida exatamente na grade, no mesmo bloco de memória. A banda
 * deixou de sair adiantada (o reprodutor desconta o quanto cada faixa adianta), então o click não
 * precisa mais acompanhar esse adiantamento.
 */
export function placeRemountOnGrid(
  left: Int16Array, right: Int16Array, remount: { left: Int16Array; right: Int16Array; hits: number[] }, sampleRate: number, tempo: number,
) {
  remount.left.fill(0);
  if (remount.right !== remount.left) remount.right.fill(0);
  placeHits(left, right, remount.hits, sampleRate, tempo, 0, remount.left, remount.right);
}

/**
 * Ponto (amostra do click original) onde trocar para o click remontado sem dobrar uma batida: o
 * meio do primeiro intervalo entre batidas a partir de `from`. Sem batida à frente, o próprio `from`.
 */
export function quietSwapFrame(hits: number[], from: number): number {
  for (let k = 0; k + 1 < hits.length; k++) {
    const mid = Math.round((hits[k] + hits[k + 1]) / 2);
    if (mid >= from) return mid;
  }
  return from;
}
