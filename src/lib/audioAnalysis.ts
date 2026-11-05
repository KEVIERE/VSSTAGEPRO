// Cliente do worker de análise (src/workers/analysis.worker.ts): o loudness/pico do "volume
// igual" e a IA de tom saem da thread da tela. Se o worker não abrir (ou falhar), o cálculo
// passa a rodar aqui mesmo, como antes, para a medida nunca deixar de sair.
import { analyze, type AnalysisRequest, type AnalysisResponse } from '@/lib/analysisCore';

// Sem pedido por esse tempo, o worker é fechado e a memória dele volta.
const IDLE_TERMINATE_MS = 30_000;

let worker: Worker | null = null;
let broken = false;
let nextId = 1;
let idleTimer: number | null = null;
const pending = new Map<number, { resolve: (r: AnalysisResponse) => void }>();

function failAll(error: string) {
  for (const [id, p] of pending) p.resolve({ id, ok: false, error });
  pending.clear();
}

function terminate() {
  if (idleTimer !== null) { clearTimeout(idleTimer); idleTimer = null; }
  worker?.terminate();
  worker = null;
}

function scheduleIdle() {
  if (idleTimer !== null) clearTimeout(idleTimer);
  if (pending.size > 0) return;
  idleTimer = window.setTimeout(() => {
    idleTimer = null;
    if (pending.size === 0) terminate();
  }, IDLE_TERMINATE_MS);
}

function getWorker(): Worker | null {
  if (broken || typeof Worker === 'undefined') return null;
  if (worker) return worker;
  try {
    const w = new Worker(new URL('@/workers/analysis.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (ev: MessageEvent<AnalysisResponse>) => {
      const p = pending.get(ev.data.id);
      if (!p) return;
      pending.delete(ev.data.id);
      p.resolve(ev.data);
      scheduleIdle();
    };
    w.onerror = () => {
      // os canais já foram transferidos para o worker: estes pedidos falham e a música é medida
      // de novo na próxima vez; os próximos pedidos rodam aqui mesmo
      broken = true;
      failAll('worker_error');
      terminate();
    };
    worker = w;
    return w;
  } catch {
    broken = true;
    return null;
  }
}

// O AudioBuffer continua dono da memória dele: vai uma cópia, transferida (sem copiar de novo).
function copyChannels(buf: AudioBuffer): Float32Array[] {
  return Array.from({ length: buf.numberOfChannels }, (_, c) => new Float32Array(buf.getChannelData(c)));
}

function run(req: Omit<AnalysisRequest, 'id'>): Promise<AnalysisResponse> {
  const id = nextId++;
  const full = { ...req, id } as AnalysisRequest;
  const w = getWorker();
  if (!w) return Promise.resolve(analyze(full));
  if (idleTimer !== null) { clearTimeout(idleTimer); idleTimer = null; }
  return new Promise((resolve) => {
    pending.set(id, { resolve });
    try {
      w.postMessage(full, full.channels.map((ch) => ch.buffer));
    } catch {
      pending.delete(id);
      resolve(analyze(full));
    }
  });
}

/** Loudness integrado (LUFS) e pico real do mix, calculados fora da thread da tela. */
export async function analyzeLoudness(buf: AudioBuffer): Promise<{ lufs: number; peak: number }> {
  const res = await run({ kind: 'loudness', channels: copyChannels(buf), sampleRate: buf.sampleRate });
  if (!res.ok) throw new Error(res.error);
  if (res.kind !== 'loudness') throw new Error('analysis_mismatch');
  return { lufs: res.lufs, peak: res.peak };
}

/** Tom da música pelo mix melódico, calculado fora da thread da tela. */
export async function analyzeKey(buf: AudioBuffer): Promise<{ key: string; confident: boolean } | null> {
  const res = await run({ kind: 'key', channels: copyChannels(buf), sampleRate: buf.sampleRate });
  if (!res.ok) throw new Error(res.error);
  if (res.kind !== 'key') throw new Error('analysis_mismatch');
  return res.key;
}
