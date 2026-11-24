// Guarda no disco os primeiros segundos de cada faixa de todas as músicas (e a versão já
// ajustada quando a música tem BPM/tom alterados). Assim qualquer música começa na hora,
// enquanto o resto do áudio abre por trás. Cada música é preparada uma única vez.
import { deviceSampleRate } from '@/lib/audioDecoder';
import { clipPlayLength, getClipAudio, getClipPlayAudio, getClipSource, openClipAudio } from '@/lib/audioLibrary';
import type { ClipAudio } from '@/lib/audioLibrary';
import { hasSliceParams } from '@/lib/medley';
import { computeNextSongId } from '@/lib/playFlow';
import { entryExists, fullCopyName, hash, purgeStale, readEntry, readyDir, renderVersion, sourceIdentity, writeEntry } from '@/lib/readyStore';
import { isTimecodeTrackId } from '@/lib/timecode';
import { stretchClipAudio, tempoFromBpm } from '@/lib/timeStretch';
import { canReadWavDirect, readWav, readWavRangeBackground, wavConvertsRate, wavLayoutAtRate } from '@/lib/wavReader';
import { isUserInteracting } from '@/lib/interactionTracker';
import { useStore } from '@/store';
import type { AudioClip, Song } from '@/types';
import type { BackgroundLease } from '@/lib/backgroundGate';

export const HEAD_SECONDS = 10;
// Margem mínima de começo pronto à frente do ponto de largada.
const START_MARGIN_SECONDS = 4;
const CLIP_CONCURRENCY = Math.min(8, Math.max(3, (navigator.hardwareConcurrency || 4) - 1));
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
  return `s_${hash(`${identity(clip, source)}|${rate}|${tempo.toFixed(6)}|${pitch.toFixed(6)}${renderVersion(tempo, pitch)}`)}`;
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
    // O começo guardado é o do arquivo; um clipe cortado no início (ex.: lado direito de um
    // split) toca a partir do corte, igual a getClipPlayAudio.
    const trimFrames = Math.floor(Math.max(0, clip.trimStart ?? 0) * entry.sampleRate);
    const full = Math.min(playFrames(clip, entry.sampleRate, entry.fullFrames), Math.max(1, entry.fullFrames - trimFrames));
    const frames = Math.min(Math.max(0, entry.channels[0].length - trimFrames), full);
    const local = (startOffset - clip.startTime) * entry.sampleRate;
    if (frames <= 0 || (frames < full && local > frames - START_MARGIN_SECONDS * entry.sampleRate)) return null;
    const channels = entry.channels.map((ch) => ch.subarray(trimFrames, trimFrames + frames));
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
  const sources: Array<{ clip: AudioClip; audio: ClipAudio }> = [];
  for (const clip of clips) {
    const audio = getClipPlayAudio(clip);
    if (!audio) return null;
    const frames = Math.min(audio.length, Math.floor(HEAD_SECONDS * audio.sampleRate));
    const local = (startOffset - clip.startTime) * audio.sampleRate;
    if (frames < audio.length && local > frames - START_MARGIN_SECONDS * audio.sampleRate) return null;
    sources.push({ clip, audio });
  }
  const out = new Map<string, HeadAudio>();
  for (const { clip, audio } of sources) out.set(clip.id, headFromOpenAudio(audio));
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
/** Só a cópia convertida precisa ser conferida de novo (parou, ou a próxima mudou parada). */
let copiesAgain = false;
let runTimer: number | null = null;
let copyTimer: number | null = null;
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
    void runPasses(true);
  }, delay);
}

/** Confere só a cópia convertida (sem refazer a conferência dos começos prontos). */
function scheduleCopies(delay: number) {
  if (!deps) return;
  if (copyTimer !== null) window.clearTimeout(copyTimer);
  copyTimer = window.setTimeout(() => {
    copyTimer = null;
    if (running) {
      copiesAgain = true;
      return;
    }
    void runPasses(false);
  }, delay);
}

// Primeiro os começos prontos (é o que deixa o Play imediato); depois, com tudo parado, a cópia convertida.
async function runPasses(heads: boolean) {
  running = true;
  try {
    for (;;) {
      restart = false;
      if (heads) await buildPass();
      if (restart) { heads = true; continue; }
      copiesAgain = false;
      // a cópia é só um ganho: um erro nela não pode derrubar o preparo dos começos
      await buildConvertedCopies().catch((err) => console.warn('[instantStart] cópia convertida', err));
      if (restart) { heads = true; continue; }
      if (copiesAgain) { heads = false; continue; }
      break;
    }
  } finally {
    running = false;
  }
}

// O Play e a decodificação da importação têm a vez; durante interação ativa cede brevemente.
async function yieldToPlayback() {
  for (;;) {
    const st = useStore.getState();
    if (!deps!.isBusy() && st.importProgress?.status !== 'decoding' && !isUserInteracting()) break;
    await new Promise((r) => setTimeout(r, 30));
  }
  if (useStore.getState().transport.isPlaying) await new Promise((r) => setTimeout(r, 40));
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
  if (useStore.getState().transport.isPlaying) return 1;
  return CLIP_CONCURRENCY;
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

// ---------- cópia convertida dos WAVs em outra taxa ----------
// Um WAV em taxa diferente da saída (ex.: 44,1 kHz numa saída de 48 kHz) toca direto do arquivo,
// convertido trecho a trecho nos workers de leitura, a cada Play. A cópia já convertida (`f_`, a
// mesma que openClipAudio grava) tira essa conversão do show: o leitor do disco usa a cópia
// quando ela existe (diskSource.openRangeReader). Só para a selecionada e a próxima, e só com
// tudo parado de vez (Stop): tocando ou na pausa, os leitores da música já estão abertos, a
// cópia só serviria na próxima abertura e a gravação disputaria disco e memória com o show.
// O ganho chega quando os leitores da música abrem de novo: na sessão seguinte, ou ao voltar a
// uma música que saiu da selecionada e da próxima. As cópias não são apagadas aqui (um leitor
// aberto nelas pararia de tocar), então o teto do projeto fica com as primeiras que couberem.
// Com o teto cheio, cada Stop só confere as faixas dos dois alvos e sai, sem recontar nem esperar.

const MIB = 1024 ** 2;
const GIB = 1024 ** 3;
/** Trecho lido por vez (cerca de 1,4 s a 48 kHz): o worker geral fica poucos ms ocupado por trecho. */
export const COPY_CHUNK_FRAMES = 1 << 16;
/**
 * Tetos da cópia convertida (objeto para os testes poderem apertar).
 * - clipBytes: a cópia é montada inteira na memória antes de gravar (o formato do arquivo é do
 *   readyStore); 64 MB é uma faixa estéreo de cerca de 5,8 min a 48 kHz. Maior que isso segue
 *   convertida na leitura, como antes, até haver gravação por trechos.
 * - projectBytes: teto das cópias convertidas do projeto aberto.
 * - readyBytes: a pasta das cópias prontas inteira (todos os projetos) só passa disso com a cópia
 *   nova se ela couber; fica 1 GB abaixo do teto de 8 GB do readyStore (MAX_TOTAL_BYTES), para a
 *   cópia nunca fazer o readyStore apagar o que outros projetos guardaram.
 */
export const copyLimits = {
  clipBytes: 64 * MIB,
  projectBytes: 3 * GIB,
  readyBytes: 7 * GIB,
};
/** Espaço que precisa sobrar para o navegador depois de gravar uma cópia. */
const COPY_DISK_RESERVE_BYTES = 4 * GIB;
/** Espera depois de parar ou de trocar a próxima, para o preparo da música passar antes. */
const COPY_DELAY_MS = 2000;
const copyAttempts = new Map<string, number>();

/** Muda quando as faixas, os arquivos ou as músicas do projeto mudam (o espaço das cópias é recontado). */
let structureGen = 0;
/** Espaço das cópias conferido por último: com o teto cheio, cada parada não varre o projeto de novo. */
interface CopySpace { gen: number; rate: number; projectBytes: number; readyBytes: number }
let copySpace: CopySpace | null = null;

function roomOf(space: CopySpace): number {
  return Math.min(copyLimits.projectBytes - space.projectBytes, copyLimits.readyBytes - space.readyBytes);
}

interface ConvertedClip { plan: ClipPlan; frames: number; channels: number; need: number; exists: boolean }

/** WAVs em outra taxa de uma música, com o tamanho da cópia de cada um e se ela já existe. */
async function convertedOf(dir: FileSystemDirectoryHandle, song: Song, rate: number): Promise<ConvertedClip[]> {
  const out: ConvertedClip[] = [];
  for (const p of await planSong(song, rate)) {
    if (!p.keepName) continue;
    const layout = await wavLayoutAtRate(p.source, rate).catch(() => null);
    if (!layout) continue;
    out.push({ plan: p, frames: layout.frames, channels: layout.channels, need: layout.frames * layout.channels * 2, exists: await entryExists(dir, p.keepName) });
  }
  return out;
}

/** Tamanho da pasta das cópias prontas (todos os projetos); null se não der para contar. */
async function readyDirBytes(dir: FileSystemDirectoryHandle): Promise<number | null> {
  let total = 0;
  try {
    for await (const name of (dir as unknown as { keys: () => AsyncIterable<string> }).keys()) {
      if (copyStopped()) return null;
      try {
        total += (await (await dir.getFileHandle(name)).getFile()).size;
      } catch { /* saiu ou não é arquivo */ }
    }
  } catch {
    return null;
  }
  return total;
}

/** Conta as cópias convertidas que o projeto já tem e a pasta inteira. Só roda quando há o que gravar. */
async function countCopySpace(dir: FileSystemDirectoryHandle, rate: number, songs: Song[], gen: number): Promise<CopySpace | null> {
  let projectBytes = 0;
  for (const song of songs) {
    if (copyStopped()) return null;
    for (const c of await convertedOf(dir, song, rate)) if (c.exists) projectBytes += c.need;
  }
  const readyBytes = await readyDirBytes(dir);
  if (readyBytes === null) return null;
  return { gen, rate, projectBytes, readyBytes };
}

/**
 * Monta a cópia inteira convertida a partir de trechos do WAV. Cada trecho sai idêntico ao do
 * arquivo convertido inteiro (mesmo filtro e mesmas fases, ver wavReader.worker), então a cópia
 * é a mesma que openClipAudio grava. `between` roda antes de cada trecho e devolve false para
 * parar; aí, ou se um trecho falhar, devolve null.
 */
export async function assembleConvertedCopy(
  frames: number,
  channelCount: number,
  readChunk: (start: number, count: number) => Promise<Int16Array[] | null>,
  between: () => Promise<boolean>,
): Promise<Int16Array[] | null> {
  if (frames <= 0 || channelCount < 1 || channelCount > 2) return null;
  const channels = Array.from({ length: channelCount }, () => new Int16Array(frames));
  for (let start = 0; start < frames; start += COPY_CHUNK_FRAMES) {
    if (!(await between())) return null;
    const count = Math.min(COPY_CHUNK_FRAMES, frames - start);
    const part = await readChunk(start, count);
    if (!part || part.length !== channelCount || part.some((ch) => ch.length !== count)) return null;
    for (let c = 0; c < channelCount; c++) channels[c].set(part[c], start);
  }
  return channels;
}

/** A selecionada e a próxima, do mesmo jeito que o App escolhe o que guardar; nada fora do Stop. */
function copyTargets(): string[] {
  const st = useStore.getState();
  // tocando ou na pausa, os leitores da música já estão abertos: a cópia não serviria ao retomar
  if (st.transport.isPlaying || !st.transport.isStopped) return [];
  const selId = st.selectedSongId ?? st.playlist[0]?.songId ?? null;
  const nextId = st.transport.nextSongId
    ?? (selId ? computeNextSongId(selId, st.playlist, st.playlistOrder, st.transport.playFlow) : null);
  const out: string[] = [];
  for (const id of [selId, nextId]) if (id && !out.includes(id)) out.push(id);
  return out;
}

function copyStopped(): boolean {
  if (restart || copiesAgain || !deps) return true;
  const t = useStore.getState().transport;
  return t.isPlaying || !t.isStopped;
}

async function copyRoom(need: number): Promise<boolean> {
  const estimate = await navigator.storage?.estimate?.().catch(() => null);
  if (!estimate?.quota || estimate.usage === undefined) return true;
  return estimate.quota - estimate.usage >= need + COPY_DISK_RESERVE_BYTES;
}

/** Espera parada que desiste logo se a música tocar, a seleção mudar ou o preparo for desligado. */
async function copyWait(ms: number): Promise<boolean> {
  const end = performance.now() + ms;
  for (let left = ms; left > 0; left = end - performance.now()) {
    if (copyStopped()) return false;
    await new Promise((r) => setTimeout(r, Math.min(100, left)));
  }
  return !copyStopped();
}

/**
 * Vez no portão do trabalho de fundo (Lote 10): a cópia convertida é trabalho pesado, então espera
 * a música parada, a pessoa sem mexer e nenhuma outra análise pesada (tom, volume) rodando junto.
 * Import sob demanda: o portão importa o audioEngine, que importa este arquivo.
 * Desiste da espera (e devolve a vez assim que ela chegar) se a música tocar ou o preparo mudar,
 * para os começos prontos nunca ficarem presos atrás da cópia.
 */
let gateModule: Promise<typeof import('@/lib/backgroundGate')> | null = null;
async function copyTurn(): Promise<BackgroundLease | null> {
  gateModule ??= import('@/lib/backgroundGate');
  const turn = gateModule.then((m) => m.acquireBackgroundTurn());
  let lease: BackgroundLease | null = null;
  let failed = false;
  turn.then((l) => { lease = l; }, () => { failed = true; });
  for (;;) {
    if (lease) return lease;
    if (failed) return null;
    if (copyStopped()) {
      turn.then((l) => l.release(), () => {});
      return null;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
}

/** Contadores para os testes: quantas vezes o espaço foi recontado e quantas esperas começaram. */
export const copyStats = { scans: 0, waits: 0 };

async function buildConvertedCopies() {
  const dir = await readyDir();
  const targets = copyTargets();
  if (!dir || !deps || targets.length === 0) return;
  const rate = deviceSampleRate();
  const gen = structureGen;
  const st = useStore.getState();
  const byId = new Map(st.songs.map((s) => [s.id, s]));

  // só as faixas da selecionada e da próxima (na ordem dos alvos), nunca o projeto inteiro aqui
  const todo: ConvertedClip[] = [];
  for (const id of targets) {
    const song = byId.get(id);
    if (!song) continue;
    if (copyStopped()) return;
    for (const c of await convertedOf(dir, song, rate)) {
      if (!c.exists && c.need <= copyLimits.clipBytes && (copyAttempts.get(c.plan.keepName!) ?? 0) < MAX_ATTEMPTS) todo.push(c);
    }
  }
  if (todo.length === 0 || copyStopped()) return;
  // o espaço das cópias é recontado só quando o projeto muda; com o teto cheio sai aqui, sem esperar
  if (!copySpace || copySpace.gen !== gen || copySpace.rate !== rate) {
    copyStats.scans++;
    const space = await countCopySpace(dir, rate, st.songs, gen);
    if (!space || copyStopped()) return;
    copySpace = space;
  }
  const room = roomOf(copySpace);
  if (!todo.some((c) => c.need <= room)) return;
  copyStats.waits++;
  if (!(await copyWait(COPY_DELAY_MS))) return;
  const lease = await copyTurn();
  if (!lease) return;
  try {
    await writeCopies(dir, todo, rate, gen, lease);
  } finally {
    lease.release();
  }
}

async function writeCopies(dir: FileSystemDirectoryHandle, todo: ConvertedClip[], rate: number, gen: number, lease: BackgroundLease) {
  const stopped = () => copyStopped() || lease.shouldStop();
  for (const { plan: p, frames, channels: count, need } of todo) {
    const space = copySpace;
    if (stopped() || structureGen !== gen || !space || space.gen !== gen) return;
    // uma faixa menor da lista ainda pode caber
    if (need > roomOf(space)) continue;
    if (!(await copyRoom(need))) return;
    const name = p.keepName!;
    const counted = () => { space.projectBytes += need; space.readyBytes += need; };
    if (await entryExists(dir, name)) { counted(); continue; }
    // metade do tempo trabalhando, metade esperando: com 2 núcleos (Intel antigo) a tela não sente
    let last = 0;
    const between = async () => {
      if (last > 0) await new Promise((r) => setTimeout(r, Math.max(4, performance.now() - last)));
      if (stopped()) return false;
      await yieldToPlayback();
      if (stopped()) return false;
      last = performance.now();
      return true;
    };
    try {
      const channels = await assembleConvertedCopy(frames, count, (s, n) => readWavRangeBackground(p.source, rate, s, n), between);
      if (stopped()) return;
      if (!channels) {
        copyAttempts.set(name, (copyAttempts.get(name) ?? 0) + 1);
        continue;
      }
      // openClipAudio pode ter gravado a mesma cópia enquanto esta era montada
      if (await entryExists(dir, name)) { counted(); continue; }
      // a gravação não para no meio: o Play que chegou durante a conferência acima vence
      if (stopped()) return;
      await writeEntry(dir, name, rate, channels, frames, frames);
      counted();
    } catch (err) {
      if (stopped()) return;
      copyAttempts.set(name, (copyAttempts.get(name) ?? 0) + 1);
      console.warn('[instantStart] não consegui gravar a cópia convertida', p.clip.name, err);
      // disco cheio: não tenta as outras agora
      if (err instanceof DOMException && err.name === 'QuotaExceededError') return;
    }
  }
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
  // outro projeto (ou o mesmo reaberto): o espaço das cópias é recontado na primeira vez
  structureGen++;
  copySpace = null;
  let prev = useStore.getState();
  let prevKey = structureKey();
  scheduleRun(150);
  const unsub = useStore.subscribe((state) => {
    const before = prev;
    prev = state;
    // Ao selecionar ou trocar de música, coloca ela no topo da fila para preparar imediatamente
    if (state.selectedSongId !== before.selectedSongId && state.selectedSongId) {
      requestPriority(state.selectedSongId);
    }
    // A cópia convertida só anda no Stop: confere ao parar e quando a próxima muda com tudo parado.
    const t = state.transport;
    const b = before.transport;
    if (t.isStopped && !t.isPlaying && (b.isPlaying || !b.isStopped || t.nextSongId !== b.nextSongId
      || t.playFlow !== b.playFlow || state.playlistOrder !== before.playlistOrder)) {
      scheduleCopies(150);
    }
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
    structureGen++;
    scheduleRun(150);
  });
  return () => {
    unsub();
    deps = null;
    if (runTimer !== null) window.clearTimeout(runTimer);
    runTimer = null;
    if (copyTimer !== null) window.clearTimeout(copyTimer);
    copyTimer = null;
    if (readyTimer !== null) window.clearTimeout(readyTimer);
    readyTimer = null;
    restart = true;
    useStore.getState().setInstantPrep(null);
  };
}
