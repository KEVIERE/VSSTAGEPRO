// Guarda no disco os primeiros segundos de cada faixa de todas as músicas (e a versão já
// ajustada quando a música tem BPM/tom alterados). Assim qualquer música começa na hora,
// enquanto o resto do áudio abre por trás. Cada música é preparada uma única vez.
import { deviceSampleRate } from '@/lib/audioDecoder';
import { clipPlayLength, getClipAudio, getClipPlayAudio, getClipSource, openClipAudio } from '@/lib/audioLibrary';
import type { ClipAudio } from '@/lib/audioLibrary';
import { hasSliceParams } from '@/lib/medley';
import { entryExists, fullCopyName, hash, purgeStale, readEntry, readyDir, sourceIdentity, writeEntry } from '@/lib/readyStore';
import { isTimecodeTrackId } from '@/lib/timecode';
import { stretchClipAudio, tempoFromBpm } from '@/lib/timeStretch';
import { canReadWavDirect, readWav, wavConvertsRate } from '@/lib/wavReader';
import { useStore } from '@/store';
import type { AudioClip, Song } from '@/types';

export const HEAD_SECONDS = 10;
// Margem mínima de começo pronto à frente do ponto de largada.
const START_MARGIN_SECONDS = 4;
const CLIP_CONCURRENCY = 4;
const MAX_ATTEMPTS = 2;
const READY_NOTICE_MS = 4000;

export interface HeadAudio extends ClipAudio {
  fullFrames: number;
}

export interface StretchedHead {
  left: Int16Array;
  right: Int16Array;
  validFrames: number;
}

function identity(clip: AudioClip, source: Blob): string {
  return sourceIdentity(clip.songId, clip.id, source);
}

function headName(clip: AudioClip, source: Blob, rate: number): string {
  return `h_${hash(`${identity(clip, source)}|${rate}`)}`;
}

function stretchedName(clip: AudioClip, source: Blob, rate: number, tempo: number, pitch: number): string {
  return `s_${hash(`${identity(clip, source)}|${rate}|${tempo.toFixed(6)}|${pitch.toFixed(6)}`)}`;
}

/** Só BPM/tom da música inteira têm começo ajustado guardado; fatias com valores próprios são processadas ao vivo. */
export function wantsStretchedHead(song: Song | undefined): song is Song {
  return !!song && ((song.bpmAdjust ?? 0) !== 0 || song.tuner !== 0) && !hasSliceParams(song);
}

function playFrames(clip: AudioClip, sampleRate: number, fullFrames: number): number {
  return Math.min(fullFrames, Math.max(1, Math.round(clipPlayLength(clip) * sampleRate)));
}

/**
 * Lê o começo pronto de todas as faixas. Devolve null se alguma faltar ou se o ponto de
 * largada estiver perto demais do fim do trecho pronto (aí a música abre inteira antes).
 */
export async function loadHeads(clips: AudioClip[], startOffset: number): Promise<Map<string, HeadAudio> | null> {
  const dir = await readyDir();
  if (!dir || clips.length === 0) return null;
  const rate = deviceSampleRate();
  const results = await Promise.all(clips.map(async (clip) => {
    const source = getClipSource(clip.id);
    if (!source) return null;
    const entry = await readEntry(dir, headName(clip, source, rate));
    if (!entry || entry.sampleRate !== rate) return null;
    const full = playFrames(clip, entry.sampleRate, entry.fullFrames);
    const frames = Math.min(entry.channels[0].length, full);
    const local = (startOffset - clip.startTime) * entry.sampleRate;
    if (frames < full && local > frames - START_MARGIN_SECONDS * entry.sampleRate) return null;
    const channels = entry.channels.map((ch) => ch.subarray(0, frames));
    return { clip, audio: { channels, sampleRate: entry.sampleRate, length: frames, fullFrames: full } };
  }));
  const out = new Map<string, HeadAudio>();
  for (const r of results) {
    if (!r) return null;
    out.set(r.clip.id, r.audio);
  }
  return out;
}

/** Lê o começo já ajustado de todas as faixas; espera um pouco se ele estiver sendo preparado agora. */
export async function loadStretchedHeads(
  song: Song,
  clips: AudioClip[],
  pitchFor: (clip: AudioClip) => number,
  waitMs: number,
): Promise<Map<string, StretchedHead> | null> {
  const dir = await readyDir();
  if (!dir || clips.length === 0 || !wantsStretchedHead(song)) return null;
  const rate = deviceSampleRate();
  const tempo = tempoFromBpm(song.bpmAdjust ?? 0);
  const deadline = performance.now() + waitMs;
  requestPriority(song.id);
  for (;;) {
    const results = await Promise.all(clips.map(async (clip) => {
      const source = getClipSource(clip.id);
      if (!source) return null;
      const entry = await readEntry(dir, stretchedName(clip, source, rate, tempo, pitchFor(clip)));
      if (!entry) return null;
      const left = entry.channels[0];
      return { id: clip.id, head: { left, right: entry.channels[1] ?? left, validFrames: entry.validFrames } };
    }));
    if (results.every(Boolean)) {
      const out = new Map<string, StretchedHead>();
      for (const r of results) out.set(r!.id, r!.head);
      return out;
    }
    if (performance.now() >= deadline) return null;
    await new Promise((r) => setTimeout(r, 100));
  }
}

function headFromOpenAudio(audio: ClipAudio): HeadAudio {
  const frames = Math.min(audio.length, Math.floor(HEAD_SECONDS * audio.sampleRate));
  return { channels: audio.channels.map((ch) => ch.slice(0, frames)), sampleRate: audio.sampleRate, length: frames, fullFrames: audio.length };
}

/**
 * Começo de uma música que já está aberta: largar por ele evita copiar o áudio inteiro
 * de todas as faixas para o reprodutor no instante do Play.
 */
export function headsFromOpenAudio(clips: AudioClip[], startOffset: number): Map<string, HeadAudio> | null {
  if (clips.length === 0) return null;
  const out = new Map<string, HeadAudio>();
  for (const clip of clips) {
    const audio = getClipPlayAudio(clip);
    if (!audio) return null;
    const head = headFromOpenAudio(audio);
    const local = (startOffset - clip.startTime) * head.sampleRate;
    if (head.length < head.fullFrames && local > head.length - START_MARGIN_SECONDS * head.sampleRate) return null;
    out.set(clip.id, head);
  }
  return out;
}

// ---------- preparo em segundo plano ----------

interface BuilderDeps {
  isBusy: () => boolean;
  pitchFor: (clip: AudioClip) => number;
}

interface ClipPlan {
  clip: AudioClip;
  source: Blob;
  hName: string;
  sName: string | null;
  fName: string | null;
  keepName: string | null;
  pitch: number;
}

let deps: BuilderDeps | null = null;
let running = false;
let restart = false;
let runTimer: number | null = null;
let readyTimer: number | null = null;
const priority: string[] = [];
const attempts = new Map<string, number>();

function requestPriority(songId: string) {
  const i = priority.indexOf(songId);
  if (i === 0) return;
  if (i > 0) priority.splice(i, 1);
  priority.unshift(songId);
  scheduleRun(150);
}

function scheduleRun(delay: number) {
  if (!deps) return;
  if (runTimer !== null) window.clearTimeout(runTimer);
  runTimer = window.setTimeout(() => {
    runTimer = null;
    if (running) {
      restart = true;
      return;
    }
    void runPasses();
  }, delay);
}

async function runPasses() {
  running = true;
  try {
    do {
      restart = false;
      await buildPass();
    } while (restart);
  } finally {
    running = false;
  }
}

// O Play e a importação têm a vez; com música tocando o preparo segue, só que mais leve.
async function yieldToPlayback() {
  for (;;) {
    const st = useStore.getState();
    if (!deps!.isBusy() && st.importProgress?.status !== 'decoding') break;
    await new Promise((r) => setTimeout(r, 200));
  }
  if (useStore.getState().transport.isPlaying) await new Promise((r) => setTimeout(r, 60));
}

function orderedSongs(): Song[] {
  const st = useStore.getState();
  const order: string[] = [];
  const add = (id: string | null | undefined) => { if (id && !order.includes(id)) order.push(id); };
  priority.forEach(add);
  add(st.transport.currentSongId);
  add(st.selectedSongId);
  add(st.transport.nextSongId);
  st.playlistOrder.forEach(add);
  st.songs.forEach((s) => add(s.id));
  return order.map((id) => st.songs.find((s) => s.id === id)).filter((s): s is Song => !!s);
}

async function planSong(song: Song, rate: number): Promise<ClipPlan[]> {
  const st = useStore.getState();
  const clips = st.clips.filter((c) => c.songId === song.id && !isTimecodeTrackId(c.trackId) && st.tracks.some((t) => t.id === c.trackId));
  const stretch = wantsStretchedHead(song);
  const tempo = tempoFromBpm(song.bpmAdjust ?? 0);
  const plans: ClipPlan[] = [];
  for (const clip of clips) {
    const source = getClipSource(clip.id);
    if (!source) continue;
    const pitch = deps!.pitchFor(clip);
    const direct = await canReadWavDirect(source, rate);
    const converts = direct && await wavConvertsRate(source, rate);
    plans.push({
      clip,
      source,
      pitch,
      hName: headName(clip, source, rate),
      sName: stretch ? stretchedName(clip, source, rate, tempo, pitch) : null,
      fName: direct ? null : fullCopyName(clip.songId, clip.id, source, rate),
      keepName: converts ? fullCopyName(clip.songId, clip.id, source, rate) : null,
    });
  }
  return plans;
}

async function missing(dir: FileSystemDirectoryHandle, p: ClipPlan) {
  const [head, stretched, full] = await Promise.all([
    entryExists(dir, p.hName),
    p.sName ? entryExists(dir, p.sName) : true,
    p.fName ? entryExists(dir, p.fName) : true,
  ]);
  return { head: !head, stretched: !stretched, full: !full };
}

async function headFor(p: ClipPlan, rate: number, needFull: boolean): Promise<HeadAudio> {
  const open = getClipAudio(p.clip.id);
  if (open && open.sampleRate === rate && !needFull) return headFromOpenAudio(open);
  if (!p.fName) {
    const wav = await readWav(p.source, rate, Math.floor(HEAD_SECONDS * rate));
    if (wav) return { channels: wav.channels, sampleRate: wav.sampleRate, length: wav.length, fullFrames: wav.totalFrames };
  }
  return headFromOpenAudio(await openClipAudio(p.clip.songId, p.clip.id, p.source, { waitForCopy: true }));
}

async function buildClip(dir: FileSystemDirectoryHandle, song: Song, p: ClipPlan, rate: number) {
  const need = await missing(dir, p);
  if (!need.head && !need.stretched && !need.full) return;
  await yieldToPlayback();
  if (restart) return;
  let head: HeadAudio | null = null;
  if (need.head || need.full) {
    head = await headFor(p, rate, need.full);
    if (need.head) await writeEntry(dir, p.hName, head.sampleRate, head.channels, head.fullFrames, head.length);
  }
  if (!p.sName || !need.stretched) return;
  if (!head) {
    const entry = await readEntry(dir, p.hName);
    if (!entry) return;
    head = { channels: entry.channels, sampleRate: entry.sampleRate, length: entry.channels[0].length, fullFrames: entry.fullFrames };
  }
  await yieldToPlayback();
  if (restart) return;
  const r = await stretchClipAudio(head, tempoFromBpm(song.bpmAdjust ?? 0), p.pitch);
  const coversWholeClip = head.length >= head.fullFrames;
  // O fim de um trecho processado sozinho difere um pouco do processado inteiro: essa parte não é usada.
  const valid = coversWholeClip ? r.left.length : Math.max(0, r.left.length - Math.floor(head.sampleRate * 0.5));
  await writeEntry(dir, p.sName, head.sampleRate, r.left === r.right ? [r.left] : [r.left, r.right], head.fullFrames, valid);
}

function planKey(p: ClipPlan): string {
  return `${p.hName}|${p.sName ?? ''}|${p.fName ?? ''}`;
}

function concurrency(): number {
  return useStore.getState().transport.isPlaying ? 1 : CLIP_CONCURRENCY;
}

function showReady(failed: number) {
  const st = useStore.getState();
  const total = st.instantPrep?.total ?? 0;
  st.setInstantPrep({ done: total, total, ready: true, failed });
  if (readyTimer !== null) window.clearTimeout(readyTimer);
  readyTimer = window.setTimeout(() => {
    readyTimer = null;
    if (useStore.getState().instantPrep?.ready) useStore.getState().setInstantPrep(null);
  }, READY_NOTICE_MS);
}

async function buildPass() {
  const dir = await readyDir();
  if (!dir || !deps) return;
  const rate = deviceSampleRate();
  const inUse = new Set<string>();
  const songs = orderedSongs();

  // Confere primeiro o que já está pronto: o aviso só aparece quando há trabalho de verdade.
  const todo: Array<{ song: Song; plans: ClipPlan[] }> = [];
  let total = 0;
  let failedSongs = 0;
  for (const song of songs) {
    if (restart) return;
    const plans = await planSong(song, rate);
    if (plans.length === 0) continue;
    total++;
    for (const p of plans) [p.hName, p.sName, p.fName, p.keepName].forEach((n) => { if (n) inUse.add(n); });
    const needs = await Promise.all(plans.map((p) => missing(dir, p)));
    const pending = plans.filter((_, i) => needs[i].head || needs[i].stretched || needs[i].full);
    if (pending.length === 0) continue;
    const retryable = pending.filter((p) => (attempts.get(planKey(p)) ?? 0) < MAX_ATTEMPTS);
    if (retryable.length === 0) failedSongs++;
    else todo.push({ song, plans: retryable });
  }

  const st = useStore.getState();
  if (todo.length === 0) {
    if (st.instantPrep && !st.instantPrep.ready) showReady(failedSongs);
    await purgeStale(dir, inUse);
    return;
  }

  if (readyTimer !== null) { window.clearTimeout(readyTimer); readyTimer = null; }
  let done = total - todo.length - failedSongs;
  for (const { song, plans } of todo) {
    if (restart) return;
    useStore.getState().setInstantPrep({ done, total, name: song.name });
    let cursor = 0;
    let songFailed = false;
    const worker = async () => {
      while (cursor < plans.length && !restart) {
        const p = plans[cursor++];
        const key = planKey(p);
        try {
          await buildClip(dir, song, p, rate);
        } catch (err) {
          songFailed = true;
          console.warn('[instantStart] não consegui preparar', p.clip.name, err);
        }
        if (!restart) attempts.set(key, (attempts.get(key) ?? 0) + 1);
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency(), plans.length) }, worker));
    if (restart) return;
    if (songFailed) failedSongs++;
    else done++;
    const pi = priority.indexOf(song.id);
    if (pi >= 0) priority.splice(pi, 1);
  }
  useStore.getState().setInstantPrep({ done, total });
  // Faixas que falharam ganham mais uma tentativa logo; depois disso ficam para abrir no Play.
  if (failedSongs > 0 && todo.some(({ plans }) => plans.some((p) => (attempts.get(planKey(p)) ?? 0) < MAX_ATTEMPTS))) {
    restart = true;
    return;
  }
  showReady(failedSongs);
  await purgeStale(dir, inUse);
}

// Só o que muda o áudio preparado: troca de faixas, de arquivo, de BPM ou de tom.
function structureKey(): string {
  const st = useStore.getState();
  const songs = st.songs.map((s) => `${s.id}:${s.bpmAdjust ?? 0}:${s.tuner}:${hasSliceParams(s) ? 1 : 0}`).join(',');
  const clips = st.clips.map((c) => `${c.id}:${c.songId}:${c.trackId}:${getClipSource(c.id) ? 1 : 0}`).join(',');
  const tracks = st.tracks.map((t) => `${t.id}:${t.parentId ?? ''}:${t.name}`).join(',');
  return `${songs}|${clips}|${tracks}`;
}

/** Liga o preparo em segundo plano; refaz só o que mudou quando as faixas ou o BPM/tom mudam. */
export function startInstantStartBuilder(builderDeps: BuilderDeps): () => void {
  deps = builderDeps;
  let prev = useStore.getState();
  let prevKey = structureKey();
  scheduleRun(1200);
  const unsub = useStore.subscribe((state) => {
    const before = prev;
    prev = state;
    if (state.songs === before.songs && state.clips === before.clips && state.tracks === before.tracks) return;
    if (state.songs !== before.songs) {
      for (const s of state.songs) {
        const old = before.songs.find((o) => o.id === s.id);
        if (old && ((old.bpmAdjust ?? 0) !== (s.bpmAdjust ?? 0) || old.tuner !== s.tuner)) {
          const i = priority.indexOf(s.id);
          if (i >= 0) priority.splice(i, 1);
          priority.unshift(s.id);
        }
      }
    }
    const key = structureKey();
    if (key === prevKey) return;
    prevKey = key;
    scheduleRun(800);
  });
  return () => {
    unsub();
    deps = null;
    if (runTimer !== null) window.clearTimeout(runTimer);
    runTimer = null;
    if (readyTimer !== null) window.clearTimeout(readyTimer);
    readyTimer = null;
    restart = true;
    useStore.getState().setInstantPrep(null);
  };
}
