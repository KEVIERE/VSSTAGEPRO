import { audioEngine } from '@/lib/audioEngine';
import { deviceSampleRate } from '@/lib/audioDecoder';
import { dropClipBuffer, forgetClipAudio, getClipSource, putClipAudio, registerClipSource, toClipAudioAsync } from '@/lib/audioLibrary';
import { makeClickClip } from '@/lib/clickClip';
import { generateClickAt } from '@/lib/clickGenerator';
import { barSeconds, barStartFlags, clickClipsOf, playLength, remakeClickTimes } from '@/lib/clickEdit';
import {
  clickBeatsKey, generatedClickTimes, isImportedClick, markGeneratedClick, staleGeneratedClicks, tempoMapChanged,
  type ClickClip,
} from '@/lib/clickFollow';
import { isUserInteracting } from '@/lib/interactionTracker';
import { DEFAULT_CLICK_SOUND, clickSoundLabel, rememberClickSound, type ClickSoundId } from '@/lib/clickSounds';
import { clipInput, toDeviceRate } from '@/lib/clipStemSplit';
import { encodeWavPcm24 } from '@/lib/wavEncoder';
import { useStore } from '@/store';
import type { AudioClip } from '@/types';

// Comandos da faixa Click (botão direito na faixa ou no clipe de click):
// - Adicionar um compasso antes do início: empurra o VS 1 compasso para a direita e põe 1
//   compasso de click antes.
// - Recriar metrônomo: usa o click da faixa como guia e troca o som pelo metrônomo escolhido
//   na janela de sons (ver ClickSoundChooser).
// Cada um é um passo só de desfazer (Cmd+Z). O áudio antigo continua guardado para o desfazer.

export type ClickToolKind = 'bar' | 'remake' | 'generate';

/** O que impede o comando do click agora (ou null se pode). */
export function clickAddBlocker(songId: string | null, kind: ClickToolKind): string | null {
  if (!songId) return 'Abra uma música primeiro';
  const s = useStore.getState();
  const song = s.songs.find((x) => x.id === songId);
  if (!song) return 'Abra uma música primeiro';
  const click = clickClipsOf(s.clips, songId)[0];
  if (kind === 'generate') {
    if (click) return 'Esta música já tem click. Para trocar o som, use Trocar som do click';
    if (!s.clips.some((c) => c.songId === songId)) return 'Esta música não tem áudio para analisar';
    return null;
  }
  if (!click) return 'Esta música ainda não tem click';
  return null;
}

/** Um compasso de click antes do primeiro click, copiado do próprio click; o VS anda 1 compasso. */
export async function addClickBefore(songId: string): Promise<void> {
  const blocker = clickAddBlocker(songId, 'bar');
  if (blocker) throw new Error(blocker);
  const state = useStore.getState();
  const song = state.songs.find((x) => x.id === songId)!;
  const click = clickClipsOf(state.clips, songId)[0];

  const bar = barSeconds(song, click.startTime);
  // o compasso novo é uma cópia de um compasso do próprio click (mesmo som e acento)
  const prefix = bar;

  const input = await toDeviceRate(await clipInput(click));
  const sr = input.sampleRate;
  const playStart = Math.round((click.trimStart ?? 0) * sr);
  const playLen = Math.min(input.length - playStart, Math.round(playLength(click) * sr));
  const prefixLen = Math.round(prefix * sr);
  const barLen = Math.round(bar * sr);
  // O som de cada click começa um pouco ANTES da batida (1,5 ms nos clicks novos, ~6 ms nos
  // antigos). Copiar a partir da batida cortava o começo do primeiro click do pedaço novo.
  // Por isso copia junto até 30 ms de antes, e o clipe novo começa esse tanto antes.
  // Usa o 2º compasso quando existe: o 1º click do clipe não tem nada antes dele no áudio.
  const second = playLen >= 2 * barLen + prefixLen ? barLen : 0;
  const copyStart = playStart + second;
  const shift = bar;
  const room = Math.max(0, click.startTime + shift - prefix); // tempo livre antes do pedaço novo
  const lead = Math.max(0, Math.min(Math.round(0.03 * sr), copyStart, Math.floor(room * sr)));
  const pieceLen = lead + prefixLen;
  const out = new AudioBuffer({ length: pieceLen + playLen, numberOfChannels: input.numberOfChannels, sampleRate: sr });
  // No fim do pedaço copiado vem o começo do click seguinte; ele toca é no click original,
  // que entra logo depois. Esses últimos 10 ms ficam em silêncio (com rampa curta) para não
  // soar um ataque picotado colado no click original.
  const cut = Math.min(Math.round(0.01 * sr), prefixLen);
  const ramp = Math.round(0.002 * sr);
  for (let c = 0; c < input.numberOfChannels; c++) {
    const src = input.getChannelData(c);
    const dst = out.getChannelData(c);
    // se o click for mais curto que o pedaço, o resto fica em silêncio
    dst.set(src.subarray(copyStart - lead, Math.min(src.length, copyStart + prefixLen, playStart + playLen)), 0);
    for (let i = pieceLen - cut - ramp; i < pieceLen; i++) {
      if (i < 0) continue;
      dst[i] *= i >= pieceLen - cut ? 0 : (pieceLen - cut - i) / ramp;
    }
    dst.set(src.subarray(playStart, playStart + playLen), pieceLen);
  }

  // Um compasso: o VS anda 1 compasso, e o click novo começa onde o antigo começava
  // (menos o pedacinho de antes da batida).
  const startTime = click.startTime + shift - prefix - lead / sr;
  const clip = await makeClickClip(song, out, Math.max(0, startTime), click);
  useStore.getState().applyClickEdit({ songId, shift, removeClipIds: [click.id], addClips: [clip] });
  audioEngine.invalidatePrepared(songId);
}

/**
 * Recriar metrônomo: acha cada batida do click que está na faixa e põe o som escolhido (o padrão
 * do VS Stage ou um dos outros de clickSounds) exatamente ali. Segue o click de referência, então acompanha mudança de andamento e medley.
 * Click importado fica com as batidas exatamente onde estão. Click gerado pelo programa usa a grade
 * atual; o antigo, sem marca, só vai para a linha se estiver inteiro deslocado por igual (alignHitsToGrid).
 */
export async function remakeMetronome(songId: string, sound: ClickSoundId = DEFAULT_CLICK_SOUND): Promise<number> {
  const blocker = clickAddBlocker(songId, 'remake');
  if (blocker) throw new Error(blocker);
  const state = useStore.getState();
  const song = state.songs.find((x) => x.id === songId)!;
  const clicks = clickClipsOf(state.clips, songId);
  const added: AudioClip[] = [];
  const replaced: string[] = [];
  let beats = 0;
  for (const click of clicks as ClickClip[]) {
    const input = await toDeviceRate(await clipInput(click));
    const sr = input.sampleRate;
    const playStart = Math.round((click.trimStart ?? 0) * sr);
    const playLen = Math.min(input.length - playStart, Math.round(playLength(click) * sr));
    const channels = Array.from({ length: input.numberOfChannels }, (_, c) => input.getChannelData(c));
    const times = click.generatedClick
      ? generatedClickTimes(song, click)
      : remakeClickTimes(channels, playStart, playLen, sr, click.startTime, song, isImportedClick(click));
    if (times.length < 2) continue;
    // o 1 de cada compasso, para o som de dois toques (segue a grade da timeline)
    const accents = barStartFlags(song, times.map((t) => click.startTime + t));
    const buffer = await generateClickAt(times, playLen / sr, sr, sound, accents);
    if (click.generatedClick) {
      markGeneratedClick(buffer, {
        sound,
        beats: clickBeatsKey(song, { startTime: click.startTime, duration: buffer.duration, trimStart: 0, trimEnd: 0 }),
      });
    }
    added.push(await makeClickClip(song, buffer, click.startTime, click));
    replaced.push(click.id);
    beats += times.length;
  }
  if (!added.length) throw new Error('não achei as batidas no click desta música');
  useStore.getState().applyClickEdit({
    songId,
    removeClipIds: replaced,
    addClips: added,
  });
  audioEngine.invalidatePrepared(songId);
  return beats;
}

// ---------- Situação para a tela (painel no canto, igual ao do Separar stems) ----------

export type ClickToolStatus = {
  state: 'idle' | 'working' | 'done' | 'error';
  title: string;
  percent: number;
  message: string;
};

let status: ClickToolStatus = { state: 'idle', title: '', percent: 0, message: '' };
let running = false;
const listeners = new Set<() => void>();
function setStatus(next: ClickToolStatus) {
  status = next;
  listeners.forEach((l) => l());
}
export function subscribeClickTool(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function getClickToolStatus(): ClickToolStatus { return status; }
export function dismissClickTool(): void { setStatus({ ...status, state: 'idle' }); }
export function isClickToolRunning(): boolean { return running; }

const TITLES: Record<ClickToolKind, string> = {
  bar: 'Um compasso antes do início',
  remake: 'Trocar som do click',
  generate: 'Gerar click a partir da música',
};

/** Roda um comando do click pelo menu e mostra o resultado no painel. */
export async function startClickTool(songId: string, kind: ClickToolKind, sound: ClickSoundId = DEFAULT_CLICK_SOUND): Promise<void> {
  if (running) return;
  running = true;
  const title = TITLES[kind];
  setStatus({ state: 'working', title, percent: 5, message: 'Preparando...' });
  try {
    if (kind === 'generate') {
      setStatus({ state: 'working', title, percent: 20, message: 'Ouvindo a música do início ao fim para achar o andamento. Pode levar até 1 minuto...' });
      const { generateSongClick, bpmFoundNotice } = await import('@/lib/importManager');
      const name = useStore.getState().songs.find((x) => x.id === songId)?.name ?? '';
      const res = await generateSongClick(songId);
      if (!res.ok) throw new Error(res.reason);
      setStatus({
        state: 'done', title, percent: 100,
        message: `Click criado na grade. ${bpmFoundNotice(name, res.bpms)} Confira as placas de BPM na régua: dá para arrastar ou editar.`,
      });
      return;
    }
    if (kind === 'remake') {
      const beats = await remakeMetronome(songId, sound);
      rememberClickSound(sound);
      setStatus({
        state: 'done', title, percent: 100,
        message: `Metrônomo recriado com ${sound === 'meu' ? 'o seu som' : `o som ${clickSoundLabel(sound)}`}: ${beats} batidas, no mesmo lugar do click que estava na faixa.`,
      });
      return;
    }
    await addClickBefore(songId);
    setStatus({
      state: 'done', title, percent: 100,
      message: 'O VS andou 1 compasso para a direita e entrou 1 compasso de click antes do início.',
    });
  } catch (err) {
    setStatus({ state: 'error', title, percent: 0, message: `Não deu: ${(err as Error)?.message ?? String(err)}.` });
  } finally {
    running = false;
  }
}

// ---------- Click gerado acompanha o mapa de andamento ----------

// Editou o mapa (mover placa, trocar BPM, compasso): o click feito pelo programa é refeito em cima
// da grade nova. Espera a música parar e o gesto acabar, porque trocar o clipe no ar interromperia
// o som. Não entra no Desfazer como passo próprio: desfazer o mapa volta o clipe junto.
// Click importado não tem a marca e nunca passa por aqui.

const FOLLOW_DELAY_MS = 1200;
const followSongs = new Set<string>();
let followTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleFollow() {
  if (followTimer !== null) return;
  followTimer = setTimeout(() => { followTimer = null; void runFollow(); }, FOLLOW_DELAY_MS);
}

async function runFollow() {
  if (followSongs.size === 0) return;
  if (useStore.getState().transport.isPlaying || running || isUserInteracting()) {
    scheduleFollow();
    return;
  }
  const songId = followSongs.values().next().value as string;
  followSongs.delete(songId);
  running = true;
  try {
    await refreshGeneratedClick(songId);
  } catch (err) {
    console.warn('[click] não consegui refazer o click pela grade', err);
  } finally {
    running = false;
  }
  if (followSongs.size > 0) scheduleFollow();
}

async function refreshGeneratedClick(songId: string): Promise<void> {
  const state = useStore.getState();
  const song = state.songs.find((s) => s.id === songId);
  if (!song) return;
  const stale = staleGeneratedClicks(song, clickClipsOf(state.clips, songId) as ClickClip[]);
  if (stale.length === 0) return;
  const sr = deviceSampleRate();
  const added: AudioClip[] = [];
  for (const click of stale) {
    const times = generatedClickTimes(song, click);
    const accents = barStartFlags(song, times.map((t) => click.startTime + t));
    const mark = click.generatedClick!;
    const buffer = await generateClickAt(times, playLength(click), sr, mark.sound, accents);
    markGeneratedClick(buffer, {
      sound: mark.sound,
      beats: clickBeatsKey(song, { startTime: click.startTime, duration: buffer.duration, trimStart: 0, trimEnd: 0 }),
    });
    added.push(await makeClickClip(song, buffer, click.startTime, click));
  }
  // Mudou algo enquanto o áudio era montado: descarta e tenta de novo com o estado atual.
  const now = useStore.getState();
  const nowSong = now.songs.find((s) => s.id === songId);
  if (!nowSong) return;
  const clipChanged = stale.some((c) => {
    const x = now.clips.find((clip) => clip.id === c.id);
    return !x || !sameClipState(c, x);
  });
  if (tempoMapChanged(song, nowSong) || now.transport.isPlaying || clipChanged) {
    added.forEach((c) => forgetClipAudio(c.id));
    followSongs.add(songId);
    return;
  }
  const history = useStore.temporal.getState();
  history.pause();
  try {
    now.applyClickEdit({ songId, removeClipIds: stale.map((c) => c.id), addClips: added });
  } finally {
    history.resume();
  }
  retireGeneratedClicks(songId, stale);
  audioEngine.invalidatePrepared(songId);
}

/** O que a pessoa pode ter mudado no clipe enquanto o click era montado. */
function sameClipState(a: AudioClip, b: AudioClip): boolean {
  return a.startTime === b.startTime && (a.trimStart ?? 0) === (b.trimStart ?? 0) && (a.trimEnd ?? 0) === (b.trimEnd ?? 0)
    && a.gain === b.gain && !!a.mute === !!b.mute && (a.fadeIn ?? 0) === (b.fadeIn ?? 0) && (a.fadeOut ?? 0) === (b.fadeOut ?? 0)
    && a.fadeCurveIn === b.fadeCurveIn && a.fadeCurveOut === b.fadeCurveOut;
}

// Click gerado que saiu de uso continua no Desfazer. A cópia decodificada é solta na hora; o WAV só dos
// últimos, e os mais antigos ficam com o necessário para refazer (a marca do clipe e o mapa da música):
// numa edição atrás da outra, a memória não cresce sem limite.
const KEPT_OLD_WAVS = 2;
const retired = new Map<string, Array<{ id: string; url: string }>>();
const forgotten = new Set<string>();
const rebuilding = new Set<string>();

function retireGeneratedClicks(songId: string, clips: ClickClip[]) {
  const list = retired.get(songId) ?? [];
  for (const clip of clips) {
    dropClipBuffer(clip.id);
    list.push({ id: clip.id, url: clip.filePath });
  }
  while (list.length > KEPT_OLD_WAVS) {
    const old = list.shift()!;
    forgetClipAudio(old.id);
    forgotten.add(old.id);
    if (old.url.startsWith('blob:')) {
      try { URL.revokeObjectURL(old.url); } catch { /* já liberado */ }
    }
  }
  retired.set(songId, list);
}

/** O Desfazer trouxe de volta um click cujo áudio foi solto: monta de novo, igual ao que era. */
async function rebuildForgottenClick(clip: ClickClip): Promise<void> {
  const mark = clip.generatedClick;
  const song = useStore.getState().songs.find((s) => s.id === clip.songId);
  if (!mark || !song || rebuilding.has(clip.id)) return;
  rebuilding.add(clip.id);
  try {
    const span = { startTime: clip.startTime, duration: clip.duration, trimStart: 0, trimEnd: 0 };
    const times = generatedClickTimes(song, span);
    const accents = barStartFlags(song, times.map((t) => clip.startTime + t));
    const buffer = await generateClickAt(times, clip.duration, clip.sampleRate || deviceSampleRate(), mark.sound, accents);
    if (!useStore.getState().clips.some((c) => c.id === clip.id) || getClipSource(clip.id)) return;
    registerClipSource(clip.id, song.id, new Blob([encodeWavPcm24(buffer)], { type: 'audio/wav' }));
    putClipAudio(clip.id, song.id, await toClipAudioAsync(buffer));
    forgotten.delete(clip.id);
    audioEngine.invalidatePrepared(song.id);
  } catch (err) {
    console.warn('[click] não consegui remontar o click do Desfazer', err);
  } finally {
    rebuilding.delete(clip.id);
  }
}

useStore.subscribe((state, prev) => {
  if (forgotten.size > 0 && state.clips !== prev.clips) {
    for (const clip of state.clips) {
      if (forgotten.has(clip.id)) void rebuildForgottenClick(clip as ClickClip);
    }
  }
  if (state.songs === prev.songs) return;
  for (const song of state.songs) {
    const old = prev.songs.find((s) => s.id === song.id);
    if (!old || old === song || !tempoMapChanged(old, song)) continue;
    const clicks = clickClipsOf(state.clips, song.id) as ClickClip[];
    if (clicks.some((c) => c.generatedClick)) followSongs.add(song.id);
  }
  if (followSongs.size > 0) scheduleFollow();
});

// ---------- Janela de sons do Recriar metrônomo ----------

let chooserSongId: string | null = null;
const chooserListeners = new Set<() => void>();
function setChooser(next: string | null) {
  chooserSongId = next;
  chooserListeners.forEach((l) => l());
}
export function subscribeClickChooser(listener: () => void): () => void {
  chooserListeners.add(listener);
  return () => { chooserListeners.delete(listener); };
}
/** Música da janela de sons aberta agora (ou null se ela está fechada). */
export function getClickChooser(): string | null { return chooserSongId; }
export function openClickChooser(songId: string): void { setChooser(songId); }
export function closeClickChooser(): void { setChooser(null); }
