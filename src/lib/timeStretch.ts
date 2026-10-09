// Pool de workers para processar BPM/afinador em paralelo.
// O áudio vai e volta em 16 bits quando possível: metade da memória do formato nativo.
// Os workers fecham sozinhos quando ficam parados, devolvendo a memória ao navegador.
import { clipAudioToBuffer } from '@/lib/audioLibrary';
import type { ClipAudio } from '@/lib/audioLibrary';

type Samples = Int16Array | Float32Array;
type OutputFormat = 'int16' | 'float';

type Job = {
  id: string;
  left: Samples;
  right: Samples;
  sampleRate: number;
  tempo: number;
  pitch: number;
  output: OutputFormat;
};

type JobResult<T extends Samples> = { left: T; right: T };

type Pending = { resolve: (r: JobResult<Samples>) => void; reject: (e: Error) => void; worker: Worker };

const IDLE_TERMINATE_MS = 30_000;

class StretchWorkerPool {
  private workers: Worker[] = [];
  private roundRobin = 0;
  private pending = new Map<string, Pending>();
  private nextId = 0;
  private idleTimer: number | null = null;

  private ensureWorkers() {
    if (this.workers.length > 0) return;
    const hw = Math.min(3, Math.max(1, (navigator.hardwareConcurrency || 2) - 1));
    for (let i = 0; i < hw; i++) {
      const w = new Worker(new URL('@/workers/timeStretch.worker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (ev) => this.onMessage(ev);
      w.onerror = (ev) => {
        for (const [id, p] of this.pending) {
          if (p.worker !== w) continue;
          p.reject(new Error(ev.message || 'Falha ao processar o áudio.'));
          this.pending.delete(id);
        }
        this.scheduleIdle();
      };
      this.workers.push(w);
    }
  }

  private scheduleIdle() {
    if (this.idleTimer !== null) window.clearTimeout(this.idleTimer);
    this.idleTimer = null;
    if (this.pending.size > 0) return;
    this.idleTimer = window.setTimeout(() => {
      this.idleTimer = null;
      if (this.pending.size > 0) return;
      this.workers.forEach((w) => w.terminate());
      this.workers = [];
    }, IDLE_TERMINATE_MS);
  }

  private onMessage(ev: MessageEvent) {
    const data = ev.data as { id: string; ok: boolean; left?: Samples; right?: Samples; error?: string };
    const p = this.pending.get(data.id);
    if (!p) return;
    this.pending.delete(data.id);
    if (data.ok && data.left && data.right) p.resolve({ left: data.left, right: data.right });
    else p.reject(new Error(data.error || 'processing failed'));
    this.scheduleIdle();
  }

  run(job: Omit<Job, 'id' | 'output'> & { output: 'int16' }): Promise<JobResult<Int16Array>>;
  run(job: Omit<Job, 'id' | 'output'> & { output: 'float' }): Promise<JobResult<Float32Array>>;
  run(job: Omit<Job, 'id'>): Promise<JobResult<Samples>> {
    if (this.idleTimer !== null) { window.clearTimeout(this.idleTimer); this.idleTimer = null; }
    this.ensureWorkers();
    const id = `job_${++this.nextId}`;
    const worker = this.workers[this.roundRobin % this.workers.length];
    this.roundRobin++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, worker });
      const msg: Job = { id, ...job };
      const transfer = job.left.buffer === job.right.buffer ? [job.left.buffer] : [job.left.buffer, job.right.buffer];
      worker.postMessage(msg, transfer as Transferable[]);
    });
  }
}

export const stretchPool = new StretchWorkerPool();

export function tempoFromBpm(bpmAdjust: number): number {
  return (120 + bpmAdjust) / 120;
}

export function bpmAdjustToAlpha(bpmAdjust: number): number {
  return 120 / (120 + bpmAdjust);
}

/** Processa um áudio de 16 bits e devolve 16 bits, sem passar pelo formato nativo no meio. */
export function stretchClipAudio(audio: ClipAudio, tempo: number, pitch: number): Promise<JobResult<Int16Array>> {
  const left = audio.channels[0].slice();
  const right = audio.channels[1] ? audio.channels[1].slice() : left;
  return stretchPool.run({ left, right, sampleRate: audio.sampleRate, tempo, pitch, output: 'int16' });
}

// alpha = fator de duração (0.9 = 10% mais curto); cents = deslocamento de tom (100 = um semitom).
export async function processClipAudioAsync(
  ctx: BaseAudioContext,
  audio: ClipAudio,
  alpha: number,
  cents: number
): Promise<AudioBuffer> {
  const needsTempo = Math.abs(alpha - 1) >= 1e-3;
  const needsPitch = Math.abs(cents) >= 1;
  if (!needsTempo && !needsPitch) return clipAudioToBuffer(audio);

  const left = audio.channels[0].slice();
  const right = audio.channels[1] ? audio.channels[1].slice() : left;
  const { left: outL, right: outR } = await stretchPool.run({
    left,
    right,
    sampleRate: audio.sampleRate,
    tempo: 1 / alpha,
    pitch: needsPitch ? Math.pow(2, cents / 1200) : 1,
    output: 'float',
  });

  const out = ctx.createBuffer(2, outL.length, audio.sampleRate);
  out.copyToChannel(outL, 0);
  out.copyToChannel(outR, 1);
  return out;
}
