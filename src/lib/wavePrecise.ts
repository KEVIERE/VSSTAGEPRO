// Onda exata com zoom aproximado, mesmo sem o áudio na memória.
//
// Com o projeto recém-aberto, as músicas tocam lendo do disco e a onda vinha só do resumo
// (um pico a cada 10 ms). Com zoom aproximado, cada ponto do resumo era espalhado até o meio
// do vizinho: o ataque de um click ou de uma batida aparecia até ~15 ms ANTES do lugar, um
// "resto" de áudio à esquerda da linha da grade. Depois de "Medir BPM de novo" a música ficava
// na memória e a onda saía exata, por isso parecia que medir consertava e reabrir estragava.
// Aqui, só para os blocos visíveis e só com zoom aproximado, lê do disco o trecho do arquivo e
// desenha das amostras reais. Lê pouco por vez (uma ou duas leituras), nos workers gerais (nunca
// nos da música no ar), e só com zoom em que o resumo fica mais grosso que os pixels.
import { deviceSampleRate } from '@/lib/audioDecoder';
import { getClipSource } from '@/lib/audioLibrary';
import { fullCopyName, openEntryRange, readyDir } from '@/lib/readyStore';
import { readWavRangeBackground } from '@/lib/wavReader';
import { sampleColumns, tileFrames } from '@/lib/waveColumns';
import { useStore } from '@/store';

/**
 * Até quantos quadros por pixel vale ler do disco (um bloco de 2048 px lê no máximo ~1 milhão de
 * quadros, uns 4 MB). O resumo de uma música longa tem um ponto a cada ~21 ms (8 min = 24.000
 * pontos, o teto), e o borrão chega a ~30 ms: a 271 px/s eram 5 a 10 px antes da linha da grade.
 * Por isso a leitura exata liga assim que o resumo fica mais grosso que os pixels.
 */
export const PRECISE_MAX_FRAMES_PER_PX = 512;

export function wantsPrecise(duration: number, sampleRate: number, fullWidth: number, peakCount: number): boolean {
  if (!(duration > 0) || !(sampleRate > 0) || !(fullWidth > 0) || peakCount <= 0) return false;
  return fullWidth >= peakCount && (duration / fullWidth) * sampleRate <= PRECISE_MAX_FRAMES_PER_PX;
}

export interface PreciseRequest {
  clipId: string;
  songId: string;
  duration: number;
  sampleRate: number;
  fullWidth: number;
  offset: number;
  width: number;
}

const CACHE_MAX = 512;
const cache = new Map<string, Float32Array | null>();
interface Pending {
  req: PreciseRequest;
  listeners: Set<(cols: Float32Array) => void>;
  started: boolean;
}
const pending = new Map<string, Pending>();
let running = 0;

const sources = new WeakMap<Blob, number>();
let nextSource = 1;
function sourceId(b: Blob): number {
  let id = sources.get(b);
  if (!id) { id = nextSource++; sources.set(b, id); }
  return id;
}

function keyOf(r: PreciseRequest, src: Blob): string {
  return `${r.clipId}|${sourceId(src)}|${r.duration}|${r.sampleRate}|${r.fullWidth}|${r.offset}|${r.width}`;
}

function remember(key: string, cols: Float32Array | null) {
  cache.delete(key);
  cache.set(key, cols);
  while (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/** Colunas exatas já lidas (undefined = ainda não leu; null = esse arquivo não dá para ler em trechos). */
export function preciseColumns(r: PreciseRequest): Float32Array | null | undefined {
  const src = getClipSource(r.clipId);
  if (!src) return null;
  const key = keyOf(r, src);
  if (!cache.has(key)) return undefined;
  const hit = cache.get(key)!;
  cache.delete(key);
  cache.set(key, hit);
  return hit;
}

// música tocando: uma leitura por vez; parada: três
const limit = () => (useStore.getState().transport.isPlaying ? 1 : 3);

function pump() {
  for (const [key, p] of pending) {
    if (running >= limit()) return;
    if (p.started) continue;
    p.started = true;
    running++;
    void read(p.req)
      .then((cols) => {
        remember(key, cols);
        if (cols) p.listeners.forEach((fn) => fn(cols));
      })
      .catch(() => remember(key, null))
      .finally(() => {
        pending.delete(key);
        running--;
        pump();
      });
  }
}

// arquivo que não lê em trechos (nem cópia pronta, nem WAV): não tenta de novo a cada bloco e zoom
const unreadable = new WeakSet<Blob>();

async function read(r: PreciseRequest): Promise<Float32Array | null> {
  const src = getClipSource(r.clipId);
  if (!src || unreadable.has(src) || !(r.sampleRate > 0) || !(r.duration > 0)) return null;
  // 1. a cópia pronta do app (MP3/M4A e WAV em outra taxa ganham uma), na taxa da saída
  const rate = deviceSampleRate();
  const dir = await readyDir().catch(() => null);
  const copy = dir ? await openEntryRange(dir, fullCopyName(r.songId, r.clipId, src, rate)) : null;
  if (copy && copy.frames === copy.fullFrames && copy.sampleRate > 0) {
    const t = tileFrames(r.duration, copy.sampleRate, r.fullWidth, r.offset, r.width);
    if (t.frames <= 0) return new Float32Array(r.width + 1);
    const channels = await copy.read(t.start, t.frames);
    return sampleColumns(channels, t.start, copy.frames, t.perPx, r.offset, r.width);
  }
  // 2. o próprio WAV
  const t = tileFrames(r.duration, r.sampleRate, r.fullWidth, r.offset, r.width);
  if (t.frames <= 0) return new Float32Array(r.width + 1);
  const channels = await readWavRangeBackground(src, r.sampleRate, t.start, t.frames);
  if (!channels) {
    // MP3/M4A ainda sem cópia pronta: fica no resumo
    unreadable.add(src);
    return null;
  }
  return sampleColumns(channels, t.start, Math.round(r.duration * r.sampleRate), t.perPx, r.offset, r.width);
}

/** A leitura exata desta faixa pode chegar (há fonte e ela lê em trechos)? */
export function preciseReadable(clipId: string): boolean {
  const src = getClipSource(clipId);
  return !!src && !unreadable.has(src);
}

/**
 * Pede as colunas exatas de um bloco; `done` é chamado quando chegam. Devolve a função que
 * desiste (o bloco saiu da tela ou o zoom mudou): se ainda não começou, nem lê.
 */
export function requestPreciseColumns(r: PreciseRequest, done: (cols: Float32Array) => void): () => void {
  const src = getClipSource(r.clipId);
  if (!src) return () => {};
  const key = keyOf(r, src);
  let p = pending.get(key);
  if (!p) {
    p = { req: r, listeners: new Set(), started: false };
    pending.set(key, p);
  }
  p.listeners.add(done);
  pump();
  const job = p;
  return () => {
    job.listeners.delete(done);
    if (!job.started && job.listeners.size === 0) pending.delete(key);
  };
}

/** Para teste. */
export function clearPreciseCache(): void {
  cache.clear();
}
