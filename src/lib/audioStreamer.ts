// Entrega o áudio de cada clipe ao reprodutor (AudioWorklet) aos poucos, sem cópias grandes
// na thread principal e sem esperar o arquivo inteiro: primeiro o trecho em volta do ponto de
// largada, depois o resto. A música no ar tem prioridade sobre a próxima, e dentro da mesma
// prioridade as faixas avançam juntas (nenhuma fica para trás enquanto outra termina).
// Sem dependências do navegador além de postMessage: os testes rodam direto no Node.

export interface StreamPort {
  postMessage(message: unknown, transfer?: Transferable[]): void;
}

export interface StreamAudio {
  channels: Int16Array[];
  length: number;
}

export const PRIORITY_ON_AIR = 0;
export const PRIORITY_SELECTED = 1;
export const PRIORITY_NEXT = 2;

/** Tamanho de cada trecho enviado: pequeno o bastante para não pesar na thread de áudio. */
export const CHUNK_FRAMES = 1 << 16;
/** Quanto é copiado de uma vez antes de devolver a vez para a tela e o som (por fatia de trabalho). */
const SLICE_BYTES = 8 * 1024 * 1024;
/** Trecho em volta do ponto de largada que vai junto com os blocos, antes de qualquer espera. */
export const WINDOW_FRAMES = 1 << 17;
const BACK_MARGIN_FRAMES = 1 << 15;

interface Job {
  port: StreamPort;
  audio: StreamAudio;
  priority: number;
  /** Trechos ainda por enviar, na ordem de envio. */
  queue: Array<[number, number]>;
  done: boolean;
  resolve: () => void;
  promise: Promise<void>;
}

export interface StreamHandle {
  /** Resolve quando todo o áudio foi entregue (ou o envio foi cancelado). */
  readonly done: Promise<void>;
  readonly finished: boolean;
  cancel(): void;
  /** Passa a enviar primeiro a partir deste ponto e com esta prioridade. */
  focus(frame: number, priority?: number): void;
}

/** Trechos [início, fim) ainda faltando, começando em `from` e depois voltando ao começo. */
export function planChunks(total: number, have: Array<[number, number]>, from: number, chunk = CHUNK_FRAMES): Array<[number, number]> {
  const missing: Array<[number, number]> = [];
  let cursor = 0;
  const sorted = [...have].sort((a, b) => a[0] - b[0]);
  for (const [s, e] of sorted) {
    if (s > cursor) missing.push([cursor, Math.min(s, total)]);
    cursor = Math.max(cursor, e);
  }
  if (cursor < total) missing.push([cursor, total]);
  const start = Math.max(0, Math.min(total, from | 0));
  const ahead: Array<[number, number]> = [];
  const behind: Array<[number, number]> = [];
  for (const [s, e] of missing) {
    if (e <= start) behind.push([s, e]);
    else if (s >= start) ahead.push([s, e]);
    else { behind.push([s, start]); ahead.push([start, e]); }
  }
  const out: Array<[number, number]> = [];
  for (const [s, e] of [...ahead, ...behind]) {
    for (let a = s; a < e; a += chunk) out.push([a, Math.min(e, a + chunk)]);
  }
  return out;
}

function remainingRanges(queue: Array<[number, number]>): Array<[number, number]> {
  return [...queue].sort((a, b) => a[0] - b[0]);
}

const defaultYield = () => new Promise<void>((resolve) => {
  // MessageChannel não sofre o atraso mínimo de 4 ms dos timers aninhados.
  if (typeof MessageChannel !== 'undefined') {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => { ch.port1.close(); resolve(); };
    ch.port2.postMessage(null);
  } else {
    setTimeout(resolve, 0);
  }
});

export class AudioStreamer {
  private jobs = new Set<Job>();
  private running = false;
  private rr = 0;
  private yieldToMain: () => Promise<void>;
  private sliceBytes: number;

  constructor(yieldToMain: () => Promise<void> = defaultYield, sliceBytes = SLICE_BYTES) {
    this.yieldToMain = yieldToMain;
    this.sliceBytes = sliceBytes;
  }

  /**
   * Começa a entregar `audio` ao reprodutor: manda na hora os blocos do tamanho total com o
   * trecho [from - pouco, from + WINDOW] já preenchido (e o começo, se `headFrames` > 0), e o
   * resto em segundo plano.
   */
  start(port: StreamPort, audio: StreamAudio, options: { from: number; priority: number; headFrames?: number; window?: number; availableFrames?: number }): StreamHandle {
    const total = audio.length;
    // Só o começo está aberto (ex.: começo pronto lido do disco): manda o que existe e não
    // agenda o resto — quem chamou recomeça a entrega quando o áudio inteiro abrir.
    const available = Math.max(0, Math.min(total, options.availableFrames ?? total, audio.channels[0].length));
    const window = options.window ?? WINDOW_FRAMES;
    const from = Math.max(0, Math.min(total, options.from | 0));
    const have: Array<[number, number]> = [];
    const head = Math.min(available, Math.max(0, options.headFrames ?? 0));
    if (head > 0) have.push([0, head]);
    // um pouco antes do ponto pedido: até a mensagem chegar, a música já andou alguns milissegundos
    // e o SoundTouch lê à frente
    const wStart = Math.max(0, from - BACK_MARGIN_FRAMES);
    const wEnd = Math.min(available, from + window);
    if (wEnd > wStart) have.push([wStart, wEnd]);

    const left = new Int16Array(total);
    const src = audio.channels;
    const right = src[1] ? new Int16Array(total) : left;
    for (const [s, e] of have) {
      left.set(src[0].subarray(s, e), s);
      if (src[1]) right.set(src[1].subarray(s, e), s);
    }
    port.postMessage({ type: 'stream', left, right, total, ranges: have }, right === left ? [left.buffer] : [left.buffer, right.buffer]);
    const queue = available < total ? [] : planChunks(total, have, from);
    return this.enqueue(port, audio, queue, options.priority);
  }

  /** O reprodutor já tem os blocos (ex.: começo pronto do disco); só envia o que falta. */
  resume(port: StreamPort, audio: StreamAudio, have: Array<[number, number]>, options: { from: number; priority: number }): StreamHandle {
    return this.enqueue(port, audio, planChunks(audio.length, have, options.from), options.priority);
  }

  private enqueue(port: StreamPort, audio: StreamAudio, queue: Array<[number, number]>, priority: number): StreamHandle {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => { resolve = r; });
    const job: Job = { port, audio, priority, queue, done: false, resolve, promise };
    if (queue.length === 0) this.finish(job);
    else {
      this.jobs.add(job);
      this.kick();
    }
    const finish = (j: Job) => this.finish(j);
    const kick = () => this.kick();
    return {
      done: promise,
      get finished() { return job.done; },
      cancel() { finish(job); },
      focus(frame: number, prio?: number) {
        if (job.done) return;
        if (typeof prio === 'number') job.priority = prio;
        job.queue = planChunks(audio.length, invert(audio.length, remainingRanges(job.queue)), frame);
        kick();
      },
    };
  }

  private finish(job: Job) {
    if (job.done) return;
    job.done = true;
    job.queue = [];
    this.jobs.delete(job);
    job.resolve();
  }

  /** Quantos envios ainda estão em andamento (para diagnóstico e testes). */
  pending(): number {
    return this.jobs.size;
  }

  private kick() {
    if (this.running) return;
    this.running = true;
    void this.loop();
  }

  private next(): Job | null {
    let best = Number.POSITIVE_INFINITY;
    for (const j of this.jobs) best = Math.min(best, j.priority);
    const same = Array.from(this.jobs).filter((j) => j.priority === best);
    if (same.length === 0) return null;
    this.rr = (this.rr + 1) % same.length;
    return same[this.rr];
  }

  private async loop() {
    try {
      while (this.jobs.size > 0) {
        let budget = this.sliceBytes;
        while (budget > 0 && this.jobs.size > 0) {
          const job = this.next();
          if (!job) break;
          const range = job.queue.shift();
          if (!range) { this.finish(job); continue; }
          const [s, e] = range;
          const ch = job.audio.channels;
          const left = ch[0].slice(s, e);
          const right = ch[1] ? ch[1].slice(s, e) : left;
          try {
            job.port.postMessage({ type: 'append', offset: s, left, right }, right === left ? [left.buffer] : [left.buffer, right.buffer]);
          } catch {
            // reprodutor já descartado
            this.finish(job);
            continue;
          }
          budget -= left.byteLength + (right === left ? 0 : right.byteLength);
          if (job.queue.length === 0) this.finish(job);
        }
        if (this.jobs.size > 0) await this.yieldToMain();
      }
    } finally {
      this.running = false;
    }
  }
}

/** Complemento de `missing` em [0, total): o que o reprodutor já tem. */
function invert(total: number, missing: Array<[number, number]>): Array<[number, number]> {
  const have: Array<[number, number]> = [];
  let cursor = 0;
  for (const [s, e] of missing) {
    if (s > cursor) have.push([cursor, s]);
    cursor = Math.max(cursor, e);
  }
  if (cursor < total) have.push([cursor, total]);
  return have;
}

export const audioStreamer = new AudioStreamer();

// ---------- leitura antecipada direto do disco ----------

/** Fonte que lê trechos do arquivo na taxa da saída, sem abrir o arquivo inteiro. */
export interface RangeReader {
  sampleRate: number;
  /** Quadros tocáveis do clipe (já com os cortes de início/fim aplicados). */
  length: number;
  channelCount: number;
  read(start: number, frames: number): Promise<Int16Array[]>;
}

export interface DiskHandle extends StreamHandle {
  /** true quando o trecho do ponto de largada já chegou ao reprodutor; false se cancelou ou falhou. */
  readonly first: Promise<boolean>;
  readonly failed: boolean;
}

interface DiskJob {
  port: StreamPort;
  reader: RangeReader;
  priority: number;
  queue: Array<[number, number]>;
  inFlight: number;
  done: boolean;
  failed: boolean;
  firstPending: boolean;
  firstResolve: (ok: boolean) => void;
  resolve: () => void;
  retries: number;
}

/** Quantas leituras do disco ao mesmo tempo (para todas as faixas juntas). */
const DISK_CONCURRENCY = 6;
export const DISK_CHUNK_FRAMES = 1 << 16;
const DISK_RETRIES = 2;

/**
 * Como os programas de gravação fazem: cada faixa lê do disco os próximos trechos a partir do
 * ponto que está tocando, poucas leituras por vez, a música no ar na frente. Nada é convertido
 * ou aberto inteiro antes do Play.
 */
export class DiskStreamer {
  private jobs = new Set<DiskJob>();
  private active = 0;
  private rr = 0;
  private concurrency: number;
  private chunk: number;

  constructor(options?: { concurrency?: number; chunkFrames?: number }) {
    this.concurrency = options?.concurrency ?? DISK_CONCURRENCY;
    this.chunk = options?.chunkFrames ?? DISK_CHUNK_FRAMES;
  }

  /** `initial`: trecho já lido (ex.: o da largada, lido antes de parar a música anterior). */
  start(port: StreamPort, reader: RangeReader, options: { from: number; priority: number; initial?: { start: number; channels: Int16Array[] } }): DiskHandle {
    const total = reader.length;
    const left = new Int16Array(total);
    const right = reader.channelCount > 1 ? new Int16Array(total) : left;
    const have: Array<[number, number]> = [];
    const init = options.initial;
    if (init && init.channels[0]?.length) {
      const s = Math.max(0, Math.min(total, init.start));
      const n = Math.min(init.channels[0].length, total - s);
      left.set(init.channels[0].subarray(0, n), s);
      if (right !== left) right.set((init.channels[1] ?? init.channels[0]).subarray(0, n), s);
      if (n > 0) have.push([s, s + n]);
    }
    port.postMessage({ type: 'stream', left, right, total, ranges: have }, right === left ? [left.buffer] : [left.buffer, right.buffer]);
    const from = Math.max(0, Math.min(total, options.from | 0));
    let resolve!: () => void;
    const done = new Promise<void>((r) => { resolve = r; });
    let firstResolve!: (ok: boolean) => void;
    const first = new Promise<boolean>((r) => { firstResolve = r; });
    const job: DiskJob = {
      port, reader, priority: options.priority,
      queue: planChunks(total, have, from, this.chunk),
      inFlight: 0, done: false, failed: false, firstPending: have.length === 0, firstResolve, resolve, retries: 0,
    };
    if (!job.firstPending) firstResolve(true);
    if (job.queue.length === 0) {
      this.finish(job, true);
    } else {
      this.jobs.add(job);
      this.pump();
    }
    const finish = (ok: boolean) => this.finish(job, ok);
    const pump = () => this.pump();
    return {
      done,
      first,
      get finished() { return job.done; },
      get failed() { return job.failed; },
      cancel() { finish(false); },
      focus(frame: number, prio?: number) {
        if (job.done) return;
        if (typeof prio === 'number') job.priority = prio;
        // reordena o que falta a partir do novo ponto
        const missing = [...job.queue].sort((a, b) => a[0] - b[0]);
        job.queue = [];
        const start = Math.max(0, Math.min(total, frame | 0));
        const ahead = missing.filter((r) => r[1] > start);
        const behind = missing.filter((r) => r[1] <= start);
        job.queue = [...ahead, ...behind];
        pump();
      },
    };
  }

  pending(): number {
    return this.jobs.size;
  }

  private finish(job: DiskJob, ok: boolean) {
    if (job.done) return;
    job.done = true;
    job.queue = [];
    this.jobs.delete(job);
    if (job.firstPending) { job.firstPending = false; job.firstResolve(ok && !job.failed); }
    job.resolve();
  }

  private pick(): DiskJob | null {
    let best = Number.POSITIVE_INFINITY;
    for (const j of this.jobs) if (j.queue.length > 0) best = Math.min(best, j.priority);
    const same = Array.from(this.jobs).filter((j) => j.priority === best && j.queue.length > 0);
    if (same.length === 0) return null;
    this.rr = (this.rr + 1) % same.length;
    return same[this.rr];
  }

  private pump() {
    while (this.active < this.concurrency) {
      const job = this.pick();
      if (!job) return;
      const range = job.queue.shift()!;
      this.active++;
      job.inFlight++;
      void this.readOne(job, range).finally(() => {
        this.active--;
        job.inFlight--;
        if (!job.done && job.queue.length === 0 && job.inFlight === 0) this.finish(job, true);
        this.pump();
      });
    }
  }

  private async readOne(job: DiskJob, [s, e]: [number, number]) {
    let channels: Int16Array[];
    try {
      channels = await job.reader.read(s, e - s);
    } catch {
      if (job.done) return;
      if (job.retries++ < DISK_RETRIES) { job.queue.unshift([s, e]); return; }
      // o disco não respondeu: quem chamou cai para o áudio aberto na memória
      job.failed = true;
      this.finish(job, false);
      return;
    }
    if (job.done || !channels[0] || channels[0].length === 0) return;
    const left = channels[0];
    const right = channels[1] ?? left;
    try {
      job.port.postMessage({ type: 'append', offset: s, left, right }, right === left ? [left.buffer] : [left.buffer, right.buffer]);
    } catch {
      this.finish(job, false);
      return;
    }
    if (job.firstPending) { job.firstPending = false; job.firstResolve(true); }
  }
}

export const diskStreamer = new DiskStreamer();
