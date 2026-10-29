// Cliente dos leitores de WAV em segundo plano.
import type { ClipAudio } from '@/lib/audioLibrary';

export interface WavRead extends ClipAudio {
  totalFrames: number;
}

type Reply = { id: number; ok: boolean; sampleRate?: number; sourceRate?: number; totalFrames?: number; channels?: Int16Array[]; channelCount?: number };

const POOL_SIZE = Math.min(3, Math.max(1, (navigator.hardwareConcurrency || 2) - 1));
const IDLE_TERMINATE_MS = 30_000;

let workers: Worker[] = [];
// Leituras de trechos da música no ar têm workers só delas: nunca esperam atrás de um arquivo
// inteiro sendo aberto (preparo em segundo plano, importação).
const rangeWorkers: Worker[] = [];
const RANGE_POOL_SIZE = 2;
let rangeTurn = 0;
let turn = 0;
let nextId = 0;
let idleTimer: number | null = null;
const pending = new Map<number, { resolve: (r: Reply) => void; worker: Worker }>();
const probes = new WeakMap<Blob, Map<number, Promise<Reply>>>();

function scheduleIdle() {
  if (idleTimer !== null) window.clearTimeout(idleTimer);
  idleTimer = null;
  if (pending.size > 0) return;
  idleTimer = window.setTimeout(() => {
    idleTimer = null;
    if (pending.size > 0) return;
    // os de trechos ficam: religar um worker no Play de uma música atrasaria a largada
    workers.forEach((w) => w.terminate());
    workers = [];
  }, IDLE_TERMINATE_MS);
}

function makeWorker(): Worker {
  const w = new Worker(new URL('@/workers/wavReader.worker.ts', import.meta.url), { type: 'module' });
  w.onmessage = (ev: MessageEvent<Reply>) => {
    const p = pending.get(ev.data.id);
    if (!p) return;
    pending.delete(ev.data.id);
    p.resolve(ev.data);
    scheduleIdle();
  };
  w.onerror = () => {
    for (const [id, p] of pending) {
      if (p.worker !== w) continue;
      pending.delete(id);
      p.resolve({ id, ok: false });
    }
    scheduleIdle();
  };
  return w;
}

function rangeWorker(): Worker {
  if (rangeWorkers.length === 0) for (let i = 0; i < RANGE_POOL_SIZE; i++) rangeWorkers.push(makeWorker());
  return rangeWorkers[rangeTurn++ % rangeWorkers.length];
}

function ensureWorkers() {
  if (workers.length > 0) return;
  for (let i = 0; i < POOL_SIZE; i++) workers.push(makeWorker());
}

function ask(blob: Blob, targetRate: number, maxFrames: number, probeOnly: boolean, startFrame?: number): Promise<Reply> {
  if (idleTimer !== null) { window.clearTimeout(idleTimer); idleTimer = null; }
  let worker: Worker;
  if (typeof startFrame === 'number') worker = rangeWorker();
  else {
    ensureWorkers();
    worker = workers[turn++ % workers.length];
  }
  const id = ++nextId;
  return new Promise((resolve) => {
    pending.set(id, { resolve, worker });
    worker.postMessage({ id, blob, targetRate, maxFrames, probeOnly, startFrame });
  });
}

function probe(blob: Blob, targetRate: number): Promise<Reply> {
  let byRate = probes.get(blob);
  if (!byRate) probes.set(blob, (byRate = new Map()));
  let p = byRate.get(targetRate);
  if (!p) {
    p = ask(blob, targetRate, 0, true);
    byRate.set(targetRate, p);
  }
  return p;
}

/** Diz se o arquivo é um WAV que abre direto (convertendo a taxa, se precisar) para a saída de áudio. */
export function canReadWavDirect(blob: Blob, targetRate: number): Promise<boolean> {
  return probe(blob, targetRate).then((r) => r.ok);
}

/** WAV que abre direto, mas com taxa diferente da saída: vale guardar a versão convertida inteira. */
export function wavConvertsRate(blob: Blob, targetRate: number): Promise<boolean> {
  return probe(blob, targetRate).then((r) => r.ok && r.sourceRate !== targetRate);
}

/** Abre o WAV (inteiro ou só os primeiros quadros). Devolve null se ele não abre direto. */
export async function readWav(blob: Blob, targetRate: number, maxFrames = 0): Promise<WavRead | null> {
  if (!(await canReadWavDirect(blob, targetRate))) return null;
  const r = await ask(blob, targetRate, maxFrames, false);
  if (!r.ok || !r.channels?.length || !r.sampleRate) return null;
  return { channels: r.channels, sampleRate: r.sampleRate, length: r.channels[0].length, totalFrames: r.totalFrames ?? r.channels[0].length };
}

/** Quadros na taxa da saída e canais (até 2) do WAV, se ele abre direto (senão null). */
export async function wavLayoutAtRate(blob: Blob, targetRate: number): Promise<{ frames: number; channels: number } | null> {
  const r = await probe(blob, targetRate);
  return r.ok && r.totalFrames ? { frames: r.totalFrames, channels: r.channelCount ?? 2 } : null;
}

/** Lê só um trecho do WAV na taxa da saída (convertendo, se preciso), sem abrir o arquivo inteiro. */
export async function readWavRange(blob: Blob, targetRate: number, startFrame: number, frames: number): Promise<Int16Array[] | null> {
  const r = await ask(blob, targetRate, frames, false, startFrame);
  return r.ok && r.channels?.length ? r.channels : null;
}
