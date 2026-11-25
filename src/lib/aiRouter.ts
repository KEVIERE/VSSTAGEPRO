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
import { ensureSongLoaded, getClipAudio, withSongAudio, type ClipAudio } from '@/lib/audioLibrary';
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
  // A régua de confiança fica em routeByYamnetScores (yamnetCategories.ts), que compara o
  // instrumento com os outros sons. Aqui só barra resposta vazia: um mínimo fixo de 15%
  // descartava voz (7%) e bumbo (10%), porque num stem o "Music" leva quase toda a nota.
  const MIN_CONFIDENCE = 0.05;
  try {
    const res = await pool.classify(clipId, monoSamples, sampleRate);
    if (res.error || !res.targetTrackId || !res.childName) return null;
    if (res.confidence < MIN_CONFIDENCE) return null;
    return { target: res.targetTrackId, childName: res.childName, confidence: res.confidence, yamnetClass: res.yamnetClass };
  } catch {
    return null;
  }
}

/** Áudio de onde a IA tira os trechos: tamanho, taxa e o valor de cada amostra (-1 a 1). */
export interface VoteSource {
  length: number;
  sampleRate: number;
  channels: number;
  sample: (channel: number, index: number) => number;
}

/**
 * Ouve até 3 trechos de 5 s entre os mais fortes do áudio e vota: vence o instrumento que
 * aparecer mais (desempate pela confiança). Trecho do meio podia ser silêncio (piano que só
 * entra no refrão, bumbo parado na intro) e a IA não reconhecia nada. null = não reconheceu.
 */
export async function classifyByVote(src: VoteSource, key: string): Promise<AiRouteResult | null> {
  const sr = src.sampleRate;
  const win = Math.min(src.length, Math.round(5 * sr));
  if (win < sr || src.channels < 1) return null;
  const step = Math.max(1, Math.floor(win / 2));
  const energy: Array<{ at: number; e: number }> = [];
  for (let at = 0; at + win <= src.length; at += step) {
    let e = 0;
    for (let c = 0; c < src.channels; c++) for (let i = at; i < at + win; i += 32) { const v = src.sample(c, i); e += v * v; }
    energy.push({ at, e });
  }
  const picks = energy.sort((a, b) => b.e - a.e).slice(0, 3);
  const votes = new Map<string, { n: number; conf: number; best: AiRouteResult }>();
  for (let k = 0; k < picks.length; k++) {
    const mono = new Float32Array(win);
    for (let c = 0; c < src.channels; c++) for (let i = 0; i < win; i++) mono[i] += src.sample(c, picks[k].at + i) / src.channels;
    const r = await classifyInstrumentAudio(`${key}-${k}`, mono, sr);
    if (!r) continue;
    const v = votes.get(r.target) ?? { n: 0, conf: 0, best: r };
    v.n++; v.conf += r.confidence;
    if (r.confidence > v.best.confidence) v.best = r;
    votes.set(r.target, v);
  }
  let winner: { n: number; conf: number; best: AiRouteResult } | null = null;
  for (const v of votes.values()) if (!winner || v.n > winner.n || (v.n === winner.n && v.conf > winner.conf)) winner = v;
  return winner && winner.n >= 2 ? winner.best : winner && picks.length < 2 ? winner.best : null;
}

/** Mesma votação sobre o áudio de um clipe (16 bits na memória). */
export function classifyClipAudio(audio: ClipAudio, key: string): Promise<AiRouteResult | null> {
  return classifyByVote({
    length: audio.length,
    sampleRate: audio.sampleRate,
    channels: audio.channels.length,
    sample: (c, i) => audio.channels[c][i] / 32768,
  }, key);
}

// ---------------------------------------------------------------- sugestão do clique direito

/** O que a IA ouviu num clipe, esperando a pessoa confirmar ("Enviar para Violões"). */
export interface AiSuggestion {
  clipId: string;
  clipName: string;
  result: AiRouteResult;
}

let suggestion: AiSuggestion | null = null;
const suggestionListeners = new Set<() => void>();
const setSuggestion = (s: AiSuggestion | null) => { suggestion = s; suggestionListeners.forEach((f) => f()); };

export function currentAiSuggestion(): AiSuggestion | null { return suggestion; }
export function subscribeAiSuggestion(fn: () => void): () => void {
  suggestionListeners.add(fn);
  return () => { suggestionListeners.delete(fn); };
}
export function dismissAiSuggestion() { setSuggestion(null); }

/** "Enviar para ...": manda o clipe para a faixa que a IA sugeriu. */
export function acceptAiSuggestion() {
  const s = suggestion;
  if (!s) return;
  setSuggestion(null);
  const store = useStore.getState();
  if (!store.clips.some((c) => c.id === s.clipId)) return;
  store.routeClip(s.clipId, s.result.target, s.result.childName);
  store.updateClip(s.clipId, { routingMethod: 'ai', routingConfidence: s.result.confidence });
}

/**
 * Clique direito > "Reclassificar com IA": a IA ouve o clipe e SUGERE a faixa numa janelinha;
 * só muda de faixa quando a pessoa confirma. O áudio pode não estar na memória (o programa
 * libera as músicas fora de uso): carrega a música antes, senão o item não fazia nada.
 */
export async function reclassifyClipWithAi(clipId: string): Promise<AiRouteResult | null> {
  const store = useStore.getState();
  const clip = store.clips.find((c) => c.id === clipId);
  if (!clip) return null;
  const done = (status: 'done' | 'error', message: string) => {
    useStore.getState().setImportProgress({ clipId, status, message });
    setTimeout(() => useStore.getState().setImportProgress(null), 4000);
  };

  store.setImportProgress({ clipId, status: 'classifying', message: `Ouvindo "${clip.name}" com IA...` });
  try {
    const result = await withSongAudio(clip.songId, async () => {
      if (!getClipAudio(clipId)) await ensureSongLoaded(clip.songId);
      const audio = getClipAudio(clipId);
      if (!audio || audio.channels.length === 0) throw new Error('no_audio');
      return classifyClipAudio(audio, `${clipId}-manual-${Date.now()}`);
    });
    if (!result) {
      done('error', 'A IA não reconheceu o instrumento com confiança. Arraste o clipe para a faixa certa.');
      return null;
    }
    useStore.getState().setImportProgress(null);
    setSuggestion({ clipId, clipName: clip.name, result });
    return result;
  } catch (err) {
    done('error', (err as Error)?.message === 'no_audio'
      ? 'Não consegui abrir o áudio desse clipe para a IA ouvir.'
      : 'Falha ao ouvir o áudio com IA. Tente de novo.');
    console.error('[reclassifyClipWithAi]', err);
    return null;
  }
}
