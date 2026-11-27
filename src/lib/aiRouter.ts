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
import { looksLikeMetronome, PERCUSSION_ROUTE } from '@/lib/metronomeCheck';
import { tallyVotes, type RouteGuess } from '@/lib/routeReview';
import { instrumentVerdict } from '@/lib/instrumentClassifier';
import { routeToUserGroup } from '@/lib/userGroups';

export interface AiRouteResult {
  target: RoutingTarget;
  childName: string;
  confidence: number;
  yamnetClass: string;
  /** 2º palpite em outra faixa (só para mostrar; não muda a decisão) */
  second?: RouteGuess | null;
}

/** Decisão da IA e os dois palpites mais fortes, com a confiança de cada um. */
export interface AiVoteDetail {
  route: AiRouteResult | null;
  guesses: RouteGuess[];
  /** o motor de escuta trocou a resposta da votação: a faixa é a dele, mas a certeza fica baixa */
  switched?: boolean;
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
  return (await classifyPick(clipId, monoSamples, sampleRate)).route;
}

// A régua de confiança fica em routeByYamnetScores (yamnetCategories.ts), que compara o
// instrumento com os outros sons. Aqui só barra resposta vazia: um mínimo fixo de 15%
// descartava voz (7%) e bumbo (10%), porque num stem o "Music" leva quase toda a nota.
const MIN_CONFIDENCE = 0.05;

/** Um trecho: a decisão (igual à de sempre) e, sem decisão, a pista do som mais forte com faixa. */
async function classifyPick(clipId: string, monoSamples: Float32Array, sampleRate: number): Promise<{ route: AiRouteResult | null; hint: RouteGuess | null; embedding?: Float32Array }> {
  try {
    const res = await pool.classify(clipId, monoSamples, sampleRate);
    if (res.error) return { route: null, hint: null };
    const embedding = res.embedding;
    const second: RouteGuess | null = res.second
      ? { target: res.second.targetTrackId, childName: res.second.childName, confidence: res.second.confidence }
      : null;
    if (!res.targetTrackId || !res.childName || res.confidence < MIN_CONFIDENCE) return { route: null, hint: second, embedding };
    return { route: { target: res.targetTrackId, childName: res.childName, confidence: res.confidence, yamnetClass: res.yamnetClass, second }, hint: null, embedding };
  } catch {
    return { route: null, hint: null };
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
  // usado pelos stems separados por IA: o motor de escuta foi medido só com VS de verdade, então ali fica a votação de sempre
  return (await classifyByVoteDetailed(src, key, { escuta: false })).route;
}

/** A mesma votação, devolvendo também o 1º e o 2º palpites (para a conferência das faixas). */
export async function classifyByVoteDetailed(src: VoteSource, key: string, opts: { escuta?: boolean } = {}): Promise<AiVoteDetail> {
  const sr = src.sampleRate;
  const win = Math.min(src.length, Math.round(5 * sr));
  if (win < sr || src.channels < 1) return { route: null, guesses: [] };
  const step = Math.max(1, Math.floor(win / 2));
  const energy: Array<{ at: number; e: number }> = [];
  for (let at = 0; at + win <= src.length; at += step) {
    let e = 0;
    for (let c = 0; c < src.channels; c++) for (let i = at; i < at + win; i += 32) { const v = src.sample(c, i); e += v * v; }
    energy.push({ at, e });
  }
  const picks = energy.sort((a, b) => b.e - a.e).slice(0, 3);
  const results: Array<AiRouteResult | null> = [];
  const hints: Array<RouteGuess | null> = [];
  const embeddings: Float32Array[] = [];
  for (let k = 0; k < picks.length; k++) {
    const mono = new Float32Array(win);
    for (let c = 0; c < src.channels; c++) for (let i = 0; i < win; i++) mono[i] += src.sample(c, picks[k].at + i) / src.channels;
    const r = await classifyPick(`${key}-${k}`, mono, sr);
    results.push(r.route);
    if (r.embedding) embeddings.push(r.embedding);
    hints.push(r.hint);
  }
  const { route: voted, guesses: votedGuesses } = tallyVotes(results, picks.length, hints);
  // motor de escuta treinado com VS reais (instrumentClassifier): troca a votação só na regra medida
  const verdict = opts.escuta === false ? null : instrumentVerdict(voted, embeddings);
  const heard = verdict?.heard ?? null;
  let best: AiRouteResult | null = voted;
  if (heard) {
    best = { target: heard.target, childName: heard.childName, confidence: heard.confidence, yamnetClass: `escuta:${heard.instrument}`, second: voted ? { target: voted.target, childName: voted.childName, confidence: voted.confidence } : null };
  } else if (verdict?.sure && voted) {
    // concordou com a votação e está seguro: a faixa fica, a certeza usa a confiança dele
    best = { ...voted, confidence: verdict.guesses[0].confidence };
  }
  // com o motor novo seguro, o 1º e o 2º palpites da conferência vêm dele
  const guesses: RouteGuess[] = verdict?.sure
    ? verdict.guesses.map((g) => ({ target: g.target, childName: g.childName, confidence: g.confidence }))
    : votedGuesses;
  const route = clickChecked(best, src);
  // o palpite de Click que aparece na conferência passa pela mesma régua (sem medir duas vezes)
  let metronome: boolean | null = best?.target === 'track-click' ? route?.target === 'track-click' : null;
  const isMetronome = () => (metronome ??= looksLikeMetronome(src));
  // instrumento de um multigrupo do projeto aberto (trompete com o grupo Metais): vai para o grupo
  const mine = routeToUserGroup(route);
  const head = mine ? [{ target: mine.target, childName: mine.childName, confidence: mine.confidence }] : [];
  return { route: mine, guesses: fixClickGuesses([...head, ...guesses.map((g) => routeToUserGroup(g))], isMetronome), ...(heard ? { switched: true } : {}) };
}

/**
 * A IA ouve bloco, cowbell e aro tocados como click: só vai para o Click se o áudio inteiro for
 * mesmo um metrônomo (toques curtos, iguais e no mesmo espaçamento); na dúvida, Percussões.
 */
function clickChecked(best: AiRouteResult | null, src: VoteSource): AiRouteResult | null {
  if (best?.target === 'track-click' && !looksLikeMetronome(src)) return { ...best, ...PERCUSSION_ROUTE };
  return best;
}

/** Palpite de Click que não passa na conferência do metrônomo aparece como Percussões (sem repetir faixa). */
function fixClickGuesses(guesses: RouteGuess[], isMetronome: () => boolean): RouteGuess[] {
  const out: RouteGuess[] = [];
  for (const g of guesses) {
    const fixed = g.target === 'track-click' && !isMetronome() ? { ...g, ...PERCUSSION_ROUTE } : g;
    if (!out.some((o) => o.target === fixed.target)) out.push(fixed);
  }
  return out.slice(0, 2);
}

/** Mesma escuta da importação (votação + motor de escuta) sobre o áudio de um clipe (16 bits na memória). */
export async function classifyClipAudio(audio: ClipAudio, key: string): Promise<AiRouteResult | null> {
  return (await classifyClipAudioDetailed(audio, key)).route;
}

/** Votação com os dois palpites, sobre o áudio de um clipe. */
export function classifyClipAudioDetailed(audio: ClipAudio, key: string): Promise<AiVoteDetail> {
  return classifyByVoteDetailed(clipVoteSource(audio), key);
}

export function clipVoteSource(audio: ClipAudio): VoteSource {
  return {
    length: audio.length,
    sampleRate: audio.sampleRate,
    channels: audio.channels.length,
    sample: (c, i) => audio.channels[c][i] / 32768,
  };
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
      // o mesmo motor da importação: o "reclassificar" não pode dar outra resposta para o mesmo áudio
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
