// Roteamento de instrumento por IA (YAMNet) — 2ª tentativa de roteamento automático,
// usada em src/lib/importManager.ts só quando o nome do arquivo não identificou o
// instrumento (routeByName devolveu null). O nome do arquivo continua sendo a 1ª
// tentativa e nunca é substituído por isto; a IA só decide quando o nome não decide.
//
// Modelo roda local no navegador via TensorFlow.js (nada é enviado para servidor
// nenhum). O "cérebro" (~15-20MB) é baixado uma vez da internet e fica em cache do
// navegador nas próximas vezes. Sem internet na primeira vez, falha em silêncio e o
// clipe cai em "Outros" como sempre caiu.
import type { RoutingTarget } from '@/types';
import type { WorkerRequest, WorkerResponse } from '@/workers/aiRouter.worker';
import { getClipAudio, channelToFloat } from '@/lib/audioLibrary';
import { useStore } from '@/store';

export interface AiRouteResult {
  target: RoutingTarget;
  childName: string;
  confidence: number;
  yamnetClass: string;
}

const IDLE_TERMINATE_MS = 30_000;

class AiRouterWorkerPool {
  private worker: Worker | null = null;
  private pending = new Map<string, { resolve: (r: WorkerResponse) => void }>();
  private nextId = 0;
  private idleTimer: number | null = null;
  private unavailable = false; // trava depois de uma falha de carregar o modelo (ex: sem internet)

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const w = new Worker(new URL('@/workers/aiRouter.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      const p = this.pending.get(ev.data.clipId);
      if (!p) return;
      this.pending.delete(ev.data.clipId);
      p.resolve(ev.data);
      this.scheduleIdle();
    };
    w.onerror = () => {
      for (const [id, p] of this.pending) {
        p.resolve({ clipId: id, targetTrackId: null, childName: null, confidence: 0, yamnetClass: '', error: 'worker_error' });
      }
      this.pending.clear();
      this.unavailable = true;
      this.terminate();
    };
    this.worker = w;
    return w;
  }

  private scheduleIdle() {
    if (this.idleTimer !== null) self.clearTimeout(this.idleTimer);
    if (this.pending.size > 0) return;
    this.idleTimer = self.setTimeout(() => {
      this.idleTimer = null;
      if (this.pending.size === 0) this.terminate();
    }, IDLE_TERMINATE_MS);
  }

  private terminate() {
    this.worker?.terminate();
    this.worker = null;
  }

  async classify(clipId: string, audioData: Float32Array, sampleRate: number): Promise<WorkerResponse> {
    if (this.unavailable) {
      return { clipId, targetTrackId: null, childName: null, confidence: 0, yamnetClass: '', error: 'unavailable' };
    }
    if (this.idleTimer !== null) { self.clearTimeout(this.idleTimer); this.idleTimer = null; }
    const worker = this.ensureWorker();
    return new Promise((resolve) => {
      this.pending.set(clipId, { resolve });
      const msg: WorkerRequest = { clipId, audioData, sampleRate };
      // audioData é uma cópia só para a IA (o chamador mantém a dele) — pode transferir sem medo.
      worker.postMessage(msg, [audioData.buffer]);
    });
  }
}

const pool = new AiRouterWorkerPool();

/**
 * Tenta identificar o instrumento de um trecho de áudio já decodificado (mono, até
 * poucos segundos — ex: o `sample5s` que `decodeFile` já gera). Devolve null se a IA
 * não reconheceu nada com confiança suficiente, ou se o modelo não pôde ser carregado
 * (ex: primeira vez sem internet) — nesses casos o chamador deve seguir o fluxo normal
 * (cair em "Outros", como já fazia antes de existir a IA).
 */
export async function classifyInstrumentAudio(
  clipId: string,
  monoSamples: Float32Array,
  sampleRate: number
): Promise<AiRouteResult | null> {
  // confiança mínima pra confiar no palpite da IA — abaixo disso, melhor cair em "Outros"
  // do que arriscar botar uma guitarra na faixa de teclados.
  const MIN_CONFIDENCE = 0.15;
  try {
    const res = await pool.classify(clipId, monoSamples, sampleRate);
    if (res.error || !res.targetTrackId || !res.childName) return null;
    if (res.confidence < MIN_CONFIDENCE) return null;
    return { target: res.targetTrackId, childName: res.childName, confidence: res.confidence, yamnetClass: res.yamnetClass };
  } catch {
    return null;
  }
}

/**
 * Reclassifica manualmente um clipe já importado (menu de contexto: "Reclassificar com
 * IA"). Usa o próprio áudio do clipe (já carregado em memória) como entrada, pega até
 * 5s do meio do clipe — mais informativo que o início, que às vezes é silêncio — e
 * roteia para a faixa correspondente se a IA reconhecer o instrumento com confiança.
 */
export async function reclassifyClipWithAi(clipId: string): Promise<AiRouteResult | null> {
  const store = useStore.getState();
  const clip = store.clips.find((c) => c.id === clipId);
  const audio = getClipAudio(clipId);
  if (!clip || !audio || audio.channels.length === 0) return null;

  store.setImportProgress({ clipId, status: 'classifying', message: `Ouvindo "${clip.name}" com IA...` });

  try {
    const sampleRate = audio.sampleRate;
    const maxLen = Math.min(audio.length, Math.floor(sampleRate * 5));
    const start = Math.max(0, Math.floor((audio.length - maxLen) / 2));

    // Mixa os canais para mono, como o resto do roteamento por IA espera.
    const mono = new Float32Array(maxLen);
    for (const ch of audio.channels) {
      const f = channelToFloat(ch.subarray(start, start + maxLen));
      for (let i = 0; i < maxLen; i++) mono[i] += f[i] / audio.channels.length;
    }

    const result = await classifyInstrumentAudio(`${clipId}-manual-${Date.now()}`, mono, sampleRate);
    if (!result) {
      store.setImportProgress({ clipId, status: 'error', message: 'A IA não reconheceu o instrumento com confiança suficiente.' });
      setTimeout(() => useStore.getState().setImportProgress(null), 3000);
      return null;
    }

    store.routeClip(clipId, result.target);
    store.updateClip(clipId, { routingMethod: 'ai', routingConfidence: result.confidence });
    store.setImportProgress({ clipId, status: 'done', message: `IA reconheceu: ${result.childName} (${Math.round(result.confidence * 100)}% de confiança)` });
    setTimeout(() => useStore.getState().setImportProgress(null), 3000);
    return result;
  } catch (err) {
    store.setImportProgress({ clipId, status: 'error', message: 'Falha ao reclassificar com IA.' });
    setTimeout(() => useStore.getState().setImportProgress(null), 3000);
    console.error('[reclassifyClipWithAi]', err);
    return null;
  }
}
