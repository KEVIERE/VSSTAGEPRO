// Cliente do worker da masterização (src/workers/mastering.worker.ts). Se o worker não abrir
// (ou falhar antes de receber o áudio), a masterização roda aqui mesmo, como antes.
import { masterChannels, type MasterOptions, type MasterReport } from '@/lib/mastering';
import type { MasterRequest, MasterResponse } from '@/workers/mastering.worker';

let nextId = 1;

/**
 * Masteriza os canais fora da thread da tela. Os arrays são transferidos ao worker: depois da
 * chamada, use só os que voltam no resultado.
 */
export function masterInWorker(channels: Float32Array[], sampleRate: number, options: MasterOptions): Promise<{ channels: Float32Array[]; report: MasterReport }> {
  let worker: Worker | null = null;
  try {
    worker = typeof Worker === 'undefined' ? null : new Worker(new URL('@/workers/mastering.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    worker = null;
  }
  if (!worker) return Promise.resolve(masterChannels(channels, sampleRate, { ...options, inPlace: true }));
  const w = worker;
  const id = nextId++;
  return new Promise((resolve, reject) => {
    let sent = false;
    const done = () => w.terminate();
    w.onmessage = (ev: MessageEvent<MasterResponse>) => {
      if (ev.data.id !== id) return;
      done();
      if (ev.data.ok) resolve({ channels: ev.data.channels, report: ev.data.report });
      else reject(new Error(ev.data.error));
    };
    w.onerror = (ev) => {
      done();
      // sem ter recebido o áudio, dá para fazer aqui mesmo; depois, os canais já foram embora
      if (!sent) resolve(masterChannels(channels, sampleRate, { ...options, inPlace: true }));
      else reject(new Error(ev.message || 'a masterização parou no meio'));
    };
    const req: MasterRequest = { id, channels, sampleRate, options };
    try {
      w.postMessage(req, channels.map((c) => c.buffer));
      sent = true;
    } catch {
      done();
      resolve(masterChannels(channels, sampleRate, { ...options, inPlace: true }));
    }
  });
}
