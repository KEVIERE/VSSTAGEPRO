// A janela "Conferir faixas" ligada ao programa: monta a lista a partir dos clipes, aplica o
// Confirmar num passo só de Desfazer, guarda o aprendizado e toca o trecho de cada áudio.
// A lógica (certeza, escolha, aprendizado) fica em routeReview.ts, testada à parte.
import { useStore } from '@/store';
import type { AudioClip, RoutingTarget } from '@/types';
import { beginGesture, endGesture } from '@/lib/undoGestures';
import { ensureSongLoaded, getClipAudio, withSongAudio, type ClipAudio } from '@/lib/audioLibrary';
import { engineLatencyHint } from '@/lib/engineLatency';
import { audioEngine } from '@/lib/audioEngine';
import { isTimecodeTrackId } from '@/lib/timecode';
import { MAESTRO_IA_TRACK_ID } from '@/lib/narrations';
import {
  applyReview, defaultChildFor, isReviewTarget, itemsToReview, learnRoute, loudestWindow,
  type ReviewChoice, type ReviewItem, type ReviewSibling,
} from '@/lib/routeReview';

export interface RouteReviewState {
  items: ReviewItem[];
  /** Aberta sozinha no fim da importação (só os incertos) ou pelo menu (a música inteira). */
  fromImport: boolean;
}

let state: RouteReviewState | null = null;
/** Áudios que a pessoa ouviu nesta janela: ouvir e deixar onde está também é conferir. */
const heardIds = new Set<string>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((f) => f());

export function currentRouteReview(): RouteReviewState | null { return state; }
export function subscribeRouteReview(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

const stripNumber = (name: string) => name.replace(/\s+\d+$/, '').trim();

function itemOf(clip: AudioClip & { generatedClick?: unknown }): ReviewItem | null {
  const st = useStore.getState();
  if (!clip.fileName || clip.generatedClick || isTimecodeTrackId(clip.trackId) || clip.trackId === MAESTRO_IA_TRACK_ID) return null;
  const track = st.tracks.find((t) => t.id === clip.trackId);
  if (!track) return null;
  const root = (track.parentId ?? track.id) as RoutingTarget;
  if (!isReviewTarget(root)) return null;
  const song = st.songs.find((s) => s.id === clip.songId);
  return {
    clipId: clip.id,
    songId: clip.songId,
    songName: song?.name ?? '',
    fileName: clip.fileName,
    clipName: clip.name,
    current: root,
    currentChild: track.parentId ? stripNumber(track.name) || defaultChildFor(root) : defaultChildFor(root),
    certainty: clip.routingCertainty ?? (clip.routingMethod === 'name' || clip.routingMethod === 'manual' ? 'high' : 'low'),
    guesses: clip.routingGuesses ?? [],
    previewAt: clip.previewAt,
  };
}

/**
 * Abre a janela para estas músicas. Na importação (`onlyLow`), só com os áudios de certeza baixa
 * e só se houver algum. Pelo menu, todos os áudios da música, os incertos primeiro.
 */
export function openRouteReview(songIds: string[], opts: { onlyLow: boolean }): boolean {
  const ids = new Set(songIds);
  const all = useStore.getState().clips.filter((c) => ids.has(c.songId)).map(itemOf).filter((i): i is ReviewItem => !!i);
  const items = opts.onlyLow ? itemsToReview(all) : [...all].sort((a, b) => (a.certainty === b.certainty ? 0 : a.certainty === 'low' ? -1 : 1));
  if (opts.onlyLow && items.length === 0) return false;
  stopReviewPreview();
  previewCache.clear();
  heardIds.clear();
  state = { items, fromImport: opts.onlyLow };
  emit();
  return true;
}

/** Editar > "Conferir Faixas desta Música" e o botão direito do clipe. */
export function openRouteReviewForSong(songId: string | null | undefined): void {
  if (!songId) {
    useStore.getState().setPlaybackError('Escolha uma música na playlist para conferir as faixas.');
    return;
  }
  openRouteReview([songId], { onlyLow: false });
}

export function closeRouteReview(): void {
  stopReviewPreview();
  previewCache.clear();
  heardIds.clear();
  if (!state) return;
  state = null;
  emit();
}

/** "Pular": cada áudio fica onde a IA pôs, nada é aprendido. */
export function skipRouteReview(): void {
  closeRouteReview();
}

/** Todos os áudios das músicas da janela, inclusive os que não aparecem nela. */
function siblingsOf(items: readonly ReviewItem[]): ReviewSibling[] {
  const st = useStore.getState();
  const songIds = new Set(items.map((i) => i.songId));
  return st.clips
    .filter((c) => songIds.has(c.songId) && !!c.fileName && !(c as { generatedClick?: unknown }).generatedClick && !isTimecodeTrackId(c.trackId) && c.trackId !== MAESTRO_IA_TRACK_ID)
    .map((c) => ({ songId: c.songId, songName: st.songs.find((sg) => sg.id === c.songId)?.name ?? '', fileName: c.fileName, clipId: c.id }));
}

/** "Confirmar": aplica tudo num passo só de Desfazer e aprende o que a pessoa mudou ou ouviu. */
export function confirmRouteReview(choices: ReviewChoice[]): number {
  const s = state;
  if (!s) return 0;
  const store = () => useStore.getState();
  const heard = new Set(heardIds);
  const siblings = siblingsOf(s.items);
  const changed = applyReview({
    beginUndoStep: beginGesture,
    endUndoStep: endGesture,
    routeClip: (clipId, target, childName) => {
      const before = store().clips.find((c) => c.id === clipId);
      const item = s.items.find((i) => i.clipId === clipId);
      store().routeClip(clipId, target, childName);
      const after = store().clips.find((c) => c.id === clipId);
      if (!before || !after) return;
      const track = store().tracks.find((t) => t.id === after.trackId);
      // nome automático ("Teclado 1") acompanha a trilha nova: senão a reorganização das faixas
      // leria o nome antigo e mandaria o áudio de volta
      const auto = !!item && new RegExp(`^${item.currentChild.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+\\d+$`, 'i').test(before.name);
      const name = track && track.parentId ? track.name : defaultChildFor(target);
      if (auto && name && name !== before.name) store().updateClip(clipId, { name });
      if (after.routingCertainty !== 'high') store().updateClip(clipId, { routingCertainty: 'high' });
    },
    renameClip: (clipId, name) => store().updateClip(clipId, { name }),
    learn: (fileName, songName, choice) => { learnRoute(fileName, songName, choice); },
    // a reorganização das faixas (próxima importação) não devolve o áudio pelo nome do arquivo
    lockClip: (clipId) => store().updateClip(clipId, { routingLocked: true, routingCertainty: 'high' }),
  }, s.items, choices, { heard, siblings });
  closeRouteReview();
  return changed;
}

// ---------------------------------------------------------------- ouvir o trecho

const PREVIEW_SECONDS = 8;
/** Trechos já recortados (8 s por áudio) enquanto a janela está aberta. */
type Slice = { channels: Float32Array<ArrayBuffer>[]; sampleRate: number };
const previewCache = new Map<string, Slice>();
let ctx: AudioContext | null = null;
let ctxHint: AudioContextLatencyCategory | null = null;
let ctxSink: string | null = null;

/**
 * Contexto da prévia na mesma placa em que as músicas tocam (sinkId no construtor; sem isso,
 * setSinkId). Antes abria sempre na saída padrão do sistema: com a placa de som escolhida no
 * programa, o trecho saía em outro lugar.
 */
function newReviewContext(hint: AudioContextLatencyCategory, sink: string): AudioContext {
  if (sink) {
    try {
      const made = new AudioContext({ latencyHint: hint, sinkId: sink } as AudioContextOptions);
      if ((made as unknown as { sinkId?: unknown }).sinkId !== sink) {
        const sinkable = made as unknown as { setSinkId?: (id: string) => Promise<void> };
        void sinkable.setSinkId?.(sink).catch(() => { /* placa recusada: fica na saída padrão */ });
      }
      return made;
    } catch { /* construtor não aceita a placa: abre na padrão */ }
  }
  return new AudioContext({ latencyHint: hint });
}
let playing: { clipId: string; src: AudioBufferSourceNode } | null = null;
let playingId: string | null = null;
let playToken = 0;
const previewListeners = new Set<() => void>();
const emitPreview = () => previewListeners.forEach((f) => f());

export function currentPreviewClipId(): string | null { return playingId; }
export function subscribeReviewPreview(fn: () => void): () => void {
  previewListeners.add(fn);
  return () => { previewListeners.delete(fn); };
}

function cut(audio: ClipAudio, at: number | undefined): Slice {
  const sr = audio.sampleRate;
  const startSec = at ?? loudestWindow({
    length: audio.length, sampleRate: sr, channels: audio.channels.length,
    sample: (c, i) => audio.channels[c][i] / 32768,
  }, PREVIEW_SECONDS);
  const from = Math.max(0, Math.min(audio.length - 1, Math.round(startSec * sr)));
  const len = Math.max(1, Math.min(audio.length - from, Math.round(PREVIEW_SECONDS * sr)));
  const channels = audio.channels.slice(0, 2).map((ch) => {
    const out = new Float32Array(len);
    for (let i = 0; i < len; i++) out[i] = ch[from + i] / 32768;
    return out;
  });
  return { channels, sampleRate: sr };
}

/** Recorta o trecho de todos os áudios da música de uma vez: a música abre uma vez só. */
async function slicesFor(item: ReviewItem): Promise<Slice | null> {
  const hit = previewCache.get(item.clipId);
  if (hit) return hit;
  const sameSong = (state?.items ?? [item]).filter((i) => i.songId === item.songId && !previewCache.has(i.clipId));
  await withSongAudio(item.songId, async () => {
    if (!getClipAudio(item.clipId)) await ensureSongLoaded(item.songId);
    for (const i of sameSong) {
      const audio = getClipAudio(i.clipId);
      if (audio && audio.channels.length > 0 && audio.length > 0) previewCache.set(i.clipId, cut(audio, i.previewAt));
    }
  });
  return previewCache.get(item.clipId) ?? null;
}

export function stopReviewPreview(): void {
  playToken++;
  const p = playing;
  playing = null;
  if (p) {
    try { p.src.onended = null; p.src.stop(); } catch { /* já parou */ }
  }
  if (playingId !== null) { playingId = null; emitPreview(); }
}

/** Toca uns 8 s do trecho mais forte do áudio; tocar outro ou fechar a janela para este. */
export async function playReviewPreview(item: ReviewItem): Promise<boolean> {
  stopReviewPreview();
  const token = ++playToken;
  playingId = item.clipId;
  emitPreview();
  try {
    const slice = await slicesFor(item);
    if (token !== playToken) return false;
    if (!slice) { stopReviewPreview(); return false; }
    // mesmo bloco do motor: a prévia não pode encurtar a folga das músicas (ver engineLatency)
    const hint = engineLatencyHint();
    const sink = audioEngine.getOutputSinkId();
    if (ctx && (ctxHint !== hint || ctxSink !== sink) && !useStore.getState().transport.isPlaying) {
      void ctx.close().catch(() => { /* já fechou */ });
      ctx = null;
    }
    if (!ctx) { ctx = newReviewContext(hint, sink); ctxHint = hint; ctxSink = sink; }
    void ctx.resume();
    const buffer = ctx.createBuffer(slice.channels.length, slice.channels[0].length, slice.sampleRate);
    slice.channels.forEach((ch, c) => buffer.copyToChannel(ch, c));
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const gain = ctx.createGain();
    const t0 = ctx.currentTime;
    const dur = buffer.duration;
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(1, t0 + 0.03);
    gain.gain.setValueAtTime(1, Math.max(t0 + 0.03, t0 + dur - 0.05));
    gain.gain.linearRampToValueAtTime(0, t0 + dur);
    src.connect(gain).connect(ctx.destination);
    src.onended = () => {
      if (playing?.src !== src) return;
      playing = null;
      playingId = null;
      emitPreview();
    };
    src.start();
    playing = { clipId: item.clipId, src };
    // só conta como ouvida a prévia que tocou de verdade
    heardIds.add(item.clipId);
    return true;
  } catch (err) {
    console.warn('[conferir faixas] trecho não tocou', err);
    if (token === playToken) stopReviewPreview();
    return false;
  }
}
