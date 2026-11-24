import type { ClipAudio } from '@/lib/audioLibrary';
import { indexColumns, readyWaveIndex, WAVE_INDEX_MIN_FRAMES_PER_PX } from './waveIndex.ts';

/**
 * Altura da forma de onda (0 a 1) em cada pixel de um bloco do desenho, do pixel `offset` até
 * `offset + width`. `total` é a largura em pixels do arquivo inteiro, que dura `duration` segundos.
 *
 * Com zoom aproximado e o áudio na memória, cada pixel mostra o pico real das amostras daquele
 * trecho, como numa DAW: um click cai sempre no pixel certo e tem sempre o mesmo desenho.
 * Sem o áudio, usa o resumo `peaks` (cada ponto resume um trecho igual do arquivo).
 */
export function waveColumns(
  peaks: number[] | undefined,
  audio: ClipAudio | null | undefined,
  duration: number,
  total: number,
  offset: number,
  width: number,
  fine?: FinePeaks | null,
): Float32Array {
  const out = new Float32Array(width + 1);
  const n = peaks?.length ?? 0;
  const full = Math.max(1, total);

  // resumo mais grosso que os pixels (zoom aproximado): lê as amostras
  if (audio && audio.length > 0 && audio.channels.length > 0 && duration > 0 && full >= n) {
    const perPx = (duration / full) * audio.sampleRate;
    // índice de máximos pronto (waveIndex.ts): mesma coluna, lendo só as pontas de cada pixel
    const index = perPx >= WAVE_INDEX_MIN_FRAMES_PER_PX ? readyWaveIndex(audio) : null;
    if (index) return indexColumns(audio.channels, index, audio.length, perPx, offset, width);
    return sampleColumns(audio.channels, 0, audio.length, perPx, offset, width);
  }
  // sem o áudio na memória: o resumo detalhado guardado no disco (um pico a cada 64 quadros)
  if (fine && fine.data.length > 0 && duration > 0 && full >= n) {
    return fineColumns(fine, duration, full, offset, width);
  }

  if (!peaks || n === 0) return out;
  if (n <= full) {
    // cada ponto do resumo fica no centro do trecho que ele resume
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
  // zoom afastado: o maior pico entre os pontos que caem no pixel
  for (let x = 0; x <= width; x++) {
    if (offset + x < 0) continue;
    const s = Math.floor(((offset + x) / full) * n);
    const e = Math.max(s + 1, Math.floor(((offset + x + 1) / full) * n));
    let m = 0;
    for (let i = s; i < e && i < n; i++) if (peaks[i] > m) m = peaks[i];
    out[x] = m;
  }
  return out;
}

/**
 * Altura de cada pixel lida direto das amostras (16 bits). `channels` começam no quadro
 * `firstFrame` do arquivo, que tem `totalFrames` quadros; `perPx` = quadros por pixel.
 * Serve para o áudio na memória e para o trecho lido do disco (wavePrecise), com o mesmo
 * resultado nos dois: o ataque cai no pixel certo, sem o borrão do resumo.
 */
export function sampleColumns(
  channels: Int16Array[],
  firstFrame: number,
  totalFrames: number,
  perPx: number,
  offset: number,
  width: number,
): Float32Array {
  const out = new Float32Array(width + 1);
  const chs = channels.slice(0, 2);
  const have = chs.length ? Math.min(...chs.map((c) => c.length)) : 0;
  const end = Math.min(totalFrames, firstFrame + have);
  for (let x = 0; x <= width; x++) {
    if (offset + x < 0) continue;
    const s0 = Math.floor((offset + x) * perPx);
    if (s0 >= end) break;
    const s1 = Math.min(end, Math.max(s0 + 1, Math.floor((offset + x + 1) * perPx)));
    let m = 0;
    for (const ch of chs) {
      for (let s = Math.max(s0, firstFrame); s < s1; s++) {
        const raw = ch[s - firstFrame];
        const v = raw < 0 ? -raw : raw;
        if (v > m) m = v;
      }
    }
    out[x] = m / 32768;
  }
  return out;
}

/**
 * Resumo detalhado de uma faixa, guardado no disco do app (finePeaks.ts): o maior valor de cada
 * `framesPer` quadros (64 = 1,3 ms a 48 kHz), num byte (raiz quadrada, para não perder o detalhe
 * dos trechos baixos). Com ele a onda abre já no lugar certo com zoom aproximado, sem ler o áudio.
 */
export interface FinePeaks {
  sampleRate: number;
  framesPer: number;
  /** Quadros do arquivo inteiro. */
  frames: number;
  data: Uint8Array;
}

export const FINE_FRAMES_PER_PEAK = 64;

/** Byte do resumo detalhado para um pico de 16 bits (0 a 32768). */
export function encodeFineValue(abs: number): number {
  return Math.min(255, Math.round(Math.sqrt(Math.min(1, abs / 32768)) * 255));
}

/**
 * Escreve em `out` os picos do trecho `channels` (que começa no quadro `firstFrame`, múltiplo de
 * `framesPer`). Cada byte cobre `framesPer` quadros, nos dois canais.
 */
export function encodeFineChunk(channels: Int16Array[], firstFrame: number, framesPer: number, out: Uint8Array): void {
  const chs = channels.slice(0, 2);
  if (chs.length === 0) return;
  const len = Math.min(...chs.map((c) => c.length));
  const firstBin = Math.floor(firstFrame / framesPer);
  for (let i = 0; i * framesPer < len; i++) {
    const bin = firstBin + i;
    if (bin >= out.length) break;
    const a = i * framesPer;
    const b = Math.min(len, a + framesPer);
    let m = 0;
    for (const ch of chs) {
      for (let s = a; s < b; s++) {
        const v = ch[s] < 0 ? -ch[s] : ch[s];
        if (v > m) m = v;
      }
    }
    out[bin] = encodeFineValue(m);
  }
}

/** Altura de cada pixel a partir do resumo detalhado (mesma escala de waveColumns). */
export function fineColumns(fine: FinePeaks, duration: number, total: number, offset: number, width: number): Float32Array {
  const out = new Float32Array(width + 1);
  const fp = Math.max(1, fine.framesPer);
  const perPx = (duration / Math.max(1, total)) * fine.sampleRate;
  const bins = fine.data.length;
  for (let x = 0; x <= width; x++) {
    if (offset + x < 0) continue;
    const s0 = Math.floor((offset + x) * perPx);
    const s1 = Math.max(s0 + 1, Math.floor((offset + x + 1) * perPx));
    const b0 = Math.floor(s0 / fp);
    if (b0 >= bins) break;
    const b1 = Math.min(bins, Math.max(b0 + 1, Math.ceil(s1 / fp)));
    let m = 0;
    for (let b = b0; b < b1; b++) if (fine.data[b] > m) m = fine.data[b];
    const v = m / 255;
    out[x] = v * v;
  }
  return out;
}

/** Trecho de quadros do arquivo que um bloco de pixels precisa (para ler do disco). */
export function tileFrames(duration: number, sampleRate: number, total: number, offset: number, width: number): { start: number; frames: number; perPx: number } {
  const totalFrames = Math.max(0, Math.round(duration * sampleRate));
  const perPx = (duration / Math.max(1, total)) * sampleRate;
  const start = Math.max(0, Math.min(totalFrames, Math.floor(Math.max(0, offset) * perPx)));
  const end = Math.max(start, Math.min(totalFrames, Math.ceil((offset + width + 1) * perPx)));
  return { start, frames: end - start, perPx };
}

/**
 * Cache das colunas já calculadas. Com o zoom aproximado e o áudio na memória, cada bloco lê
 * milhões de amostras; mudar só a altura das faixas, o ganho ou a cor, ou voltar a um zoom
 * recente, redesenhava tudo isso de novo e travava a tela (e os medidores) durante o zoom.
 * LRU com limite: cada entrada é um Float32Array de ~8 KB (bloco de 2048 px), 256 = ~2 MB.
 */
export const WAVE_COLUMNS_CACHE_MAX = 256;
const columnsCache = new Map<string, Float32Array>();
const sourceIds = new WeakMap<object, number>();
let nextSourceId = 1;
function sourceId(src: object | null | undefined): number {
  if (!src) return 0;
  let id = sourceIds.get(src);
  if (!id) {
    id = nextSourceId++;
    sourceIds.set(src, id);
  }
  return id;
}

/** Igual a `waveColumns`, mas reaproveita o resultado. Não altere o array devolvido. */
export function waveColumnsCached(
  peaks: number[] | undefined,
  audio: ClipAudio | null | undefined,
  duration: number,
  total: number,
  offset: number,
  width: number,
  fine?: FinePeaks | null,
): Float32Array {
  // a identidade dos objetos entra na chave: resumo ou áudio novo (outra música, reimportação) não reaproveita
  const key = `${sourceId(peaks)}|${sourceId(audio)}|${sourceId(fine?.data)}|${duration}|${total}|${offset}|${width}`;
  const hit = columnsCache.get(key);
  if (hit) {
    // vai para o fim da fila (mais recente)
    columnsCache.delete(key);
    columnsCache.set(key, hit);
    return hit;
  }
  const cols = waveColumns(peaks, audio, duration, total, offset, width, fine);
  columnsCache.set(key, cols);
  while (columnsCache.size > WAVE_COLUMNS_CACHE_MAX) {
    const oldest = columnsCache.keys().next().value;
    if (oldest === undefined) break;
    columnsCache.delete(oldest);
  }
  return cols;
}

/** Quantas entradas o cache tem (para teste). */
export function waveColumnsCacheSize(): number {
  return columnsCache.size;
}

/** Esvazia o cache (para teste). */
export function clearWaveColumnsCache(): void {
  columnsCache.clear();
}
