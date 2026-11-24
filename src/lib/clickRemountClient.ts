// Fala com o worker que remonta o click. Um worker só, um pedido por vez: o trabalho é curto e não
// pode disputar processador com a música no ar. Ele fecha sozinho quando fica parado.

export type ClickRemount = { left: Int16Array; right: Int16Array; hits: number[] };

type Reply = { id: number; ok: boolean; hits?: number[] | null; left?: Int16Array; right?: Int16Array; error?: string };
type Pending = { resolve: (r: ClickRemount | null) => void; reject: (e: Error) => void };

const IDLE_CLOSE_MS = 30_000;
/** Batidas de cada clipe: achar é a parte cara, e elas não mudam com o andamento. */
const MAX_REMEMBERED = 32;

let worker: Worker | null = null;
let idleTimer: number | null = null;
let nextId = 0;
const pending = new Map<number, Pending>();
const beats = new Map<string, number[] | null>();
let queue: Promise<unknown> = Promise.resolve();

function closeWhenIdle() {
  if (idleTimer !== null) window.clearTimeout(idleTimer);
  idleTimer = window.setTimeout(() => {
    idleTimer = null;
    if (pending.size > 0 || !worker) return;
    worker.terminate();
    worker = null;
  }, IDLE_CLOSE_MS);
}

function failAll(message: string) {
  for (const p of pending.values()) p.reject(new Error(message));
  pending.clear();
  worker?.terminate();
  worker = null;
}

function ensureWorker(): Worker {
  if (worker) return worker;
  const w = new Worker(new URL('../workers/clickRemount.worker.ts', import.meta.url), { type: 'module' });
  w.onmessage = (ev: MessageEvent<Reply>) => {
    const d = ev.data;
    const p = pending.get(d.id);
    if (!p) return;
    pending.delete(d.id);
    closeWhenIdle();
    if (!d.ok) p.reject(new Error(d.error || 'falha ao remontar o click'));
    else if (!d.hits || !d.left || !d.right) p.resolve(null);
    else p.resolve({ left: d.left, right: d.right, hits: d.hits });
  };
  w.onerror = (ev) => failAll(ev.message || 'falha ao remontar o click');
  worker = w;
  return w;
}

function run(key: string, channels: Int16Array[], sampleRate: number, tempo: number): Promise<ClickRemount | null> {
  if (idleTimer !== null) { window.clearTimeout(idleTimer); idleTimer = null; }
  const w = ensureWorker();
  const id = ++nextId;
  const left = channels[0].slice();
  const right = channels[1] ? channels[1].slice() : left;
  return new Promise<ClickRemount | null>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    const transfer = left === right ? [left.buffer] : [left.buffer, right.buffer];
    w.postMessage({ id, left, right, sampleRate, tempo, hits: beats.get(key) ?? null }, transfer as Transferable[]);
  }).then((r) => {
    if (beats.size >= MAX_REMEMBERED && !beats.has(key)) beats.delete(beats.keys().next().value as string);
    beats.set(key, r ? r.hits : null);
    return r;
  });
}

/**
 * O click do clipe remontado no andamento `tempo`, ou null se a faixa não for só click.
 * `key` identifica o áudio (o id do clipe muda quando o áudio muda).
 */
export function remountClickAudio(key: string, channels: Int16Array[], sampleRate: number, tempo: number): Promise<ClickRemount | null> {
  // Já se sabe que este áudio não é só click: não copia nada para descobrir de novo.
  if (beats.has(key) && beats.get(key) === null) return Promise.resolve(null);
  const job = queue.then(() => run(key, channels, sampleRate, tempo));
  queue = job.catch(() => undefined);
  return job;
}
