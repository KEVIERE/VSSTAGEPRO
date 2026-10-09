import { decodeBlob, deviceSampleRate } from '@/lib/audioDecoder';
import { fullCopyName, readEntry, readyDir, writeEntry } from '@/lib/readyStore';
import { readWav, wavConvertsRate } from '@/lib/wavReader';
import { useStore } from '@/store';

// Guarda só a referência ao arquivo de cada clipe (leve, fica no disco) e
// decodifica o áudio apenas das músicas em uso; o resto é liberado da memória.
// O áudio aberto fica em 16 bits (metade do espaço do formato nativo do navegador).

export interface ClipAudio {
  channels: Int16Array[];
  sampleRate: number;
  length: number;
}

export type LoadFailure = 'missing' | 'format' | 'memory';

interface ClipEntry {
  songId: string;
  source: Blob | null;
  buffer: ClipAudio | null;
  failure: LoadFailure | null;
}

export function toClipAudio(buffer: AudioBuffer): ClipAudio {
  const channels: Int16Array[] = [];
  for (let c = 0; c < Math.min(2, buffer.numberOfChannels); c++) channels.push(floatToChannel(buffer.getChannelData(c)));
  return { channels, sampleRate: buffer.sampleRate, length: buffer.length };
}

export function floatToChannel(src: Float32Array): Int16Array {
  const out = new Int16Array(src.length);
  convertRange(src, out, 0, src.length);
  return out;
}

function convertRange(src: Float32Array, out: Int16Array, from: number, to: number) {
  for (let i = from; i < to; i++) {
    const v = src[i];
    out[i] = v >= 1 ? 32767 : v <= -1 ? -32768 : Math.round(v * 32767);
  }
}

const CONVERT_SLICE = 1 << 18;

/** Igual a toClipAudio, mas em fatias: a tela e o som não engasgam com faixas longas. */
export async function toClipAudioAsync(buffer: AudioBuffer): Promise<ClipAudio> {
  const channels: Int16Array[] = [];
  for (let c = 0; c < Math.min(2, buffer.numberOfChannels); c++) {
    const src = buffer.getChannelData(c);
    const out = new Int16Array(src.length);
    for (let i = 0; i < src.length; i += CONVERT_SLICE) {
      convertRange(src, out, i, Math.min(src.length, i + CONVERT_SLICE));
      await new Promise((r) => setTimeout(r, 0));
    }
    channels.push(out);
  }
  return { channels, sampleRate: buffer.sampleRate, length: buffer.length };
}

export function channelToFloat(src: Int16Array): Float32Array {
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i++) out[i] = src[i] / 32767;
  return out;
}

/** Cria uma cópia temporária no formato nativo, para exportar ou medir o BPM. */
export function clipAudioToBuffer(audio: ClipAudio): AudioBuffer {
  const buffer = new AudioBuffer({ length: audio.length, numberOfChannels: audio.channels.length, sampleRate: audio.sampleRate });
  audio.channels.forEach((ch, c) => buffer.copyToChannel(channelToFloat(ch), c));
  return buffer;
}

const entries = new Map<string, ClipEntry>();
const songLoads = new Map<string, Promise<void>>();
const loading = new Set<string>();
let retained = new Set<string>();
const lastUsed = new Map<string, number>();

const DECODE_CONCURRENCY = 3;

// Quanto áudio aberto pode ficar na memória: músicas já abertas ficam até esse limite.
const MEMORY_BUDGET_BYTES = (() => {
  const gb = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  const share = typeof window !== 'undefined' && window.vsDesktop ? 0.35 : 0.2;
  return Math.max(0.6, Math.min(3, gb * share)) * 1024 ** 3;
})();

function isProtected(songId: string) {
  return retained.has(songId) || loading.has(songId);
}

function freeUnprotected() {
  for (const e of entries.values()) {
    if (e.buffer && !isProtected(e.songId)) e.buffer = null;
  }
}

function audioBytes(a: ClipAudio): number {
  return a.channels.reduce((n, ch) => n + ch.byteLength, 0);
}

// Solta primeiro as músicas usadas há mais tempo, só quando passa do limite.
function trimToBudget() {
  const bySong = new Map<string, number>();
  let total = 0;
  for (const e of entries.values()) {
    if (!e.buffer) continue;
    const b = audioBytes(e.buffer);
    total += b;
    bySong.set(e.songId, (bySong.get(e.songId) ?? 0) + b);
  }
  if (total <= MEMORY_BUDGET_BYTES) return;
  const victims = Array.from(bySong.keys())
    .filter((id) => !isProtected(id))
    .sort((a, b) => (lastUsed.get(a) ?? 0) - (lastUsed.get(b) ?? 0));
  for (const id of victims) {
    if (total <= MEMORY_BUDGET_BYTES) break;
    for (const e of entries.values()) if (e.songId === id) e.buffer = null;
    total -= bySong.get(id) ?? 0;
  }
}

function entryFor(clipId: string, songId: string): ClipEntry {
  let e = entries.get(clipId);
  if (!e) {
    e = { songId, source: null, buffer: null, failure: null };
    entries.set(clipId, e);
  }
  e.songId = songId;
  return e;
}

export function registerClipSource(clipId: string, songId: string, source: Blob) {
  const e = entryFor(clipId, songId);
  e.source = source;
  e.failure = null;
}

export function putClipAudio(clipId: string, songId: string, audio: ClipAudio) {
  entryFor(clipId, songId).buffer = audio;
}

export function getClipSource(clipId: string): Blob | null {
  return entries.get(clipId)?.source ?? null;
}

export function getClipAudio(clipId: string): ClipAudio | null {
  return entries.get(clipId)?.buffer ?? null;
}

export function clipPlayLength(clip: { duration: number; trimEnd?: number }): number {
  return Math.max(0.05, clip.duration - (clip.trimEnd ?? 0));
}

// O corte no fim nunca apaga o arquivo: só limita até onde o áudio é lido.
export function getClipPlayAudio(clip: { id: string; duration: number; trimEnd?: number }): ClipAudio | null {
  const audio = getClipAudio(clip.id);
  if (!audio || !clip.trimEnd || clip.trimEnd <= 0) return audio;
  const length = Math.min(audio.length, Math.max(1, Math.round(clipPlayLength(clip) * audio.sampleRate)));
  if (length >= audio.length) return audio;
  return { sampleRate: audio.sampleRate, length, channels: audio.channels.map((ch) => ch.subarray(0, length)) };
}

export function isSongLoaded(songId: string): boolean {
  for (const e of entries.values()) {
    if (e.songId === songId && e.source && !e.buffer) return false;
  }
  return true;
}

export function missingClipIds(songId: string): string[] {
  const out: string[] = [];
  for (const [id, e] of entries) {
    if (e.songId === songId && e.source && !e.buffer) out.push(id);
  }
  return out;
}

export function loadFailure(clipId: string): LoadFailure | null {
  return entries.get(clipId)?.failure ?? null;
}

/** Solta o áudio aberto de faixas removidas; esquece o arquivo só quando nem o Desfazer pode trazê-las de volta. */
export function pruneAudioLibrary(liveClipIds: Set<string>, historyClipIds: Set<string>) {
  for (const [id, e] of entries) {
    if (liveClipIds.has(id) || loading.has(e.songId)) continue;
    if (historyClipIds.has(id)) e.buffer = null;
    else entries.delete(id);
  }
}

function classifyFailure(err: unknown): LoadFailure {
  const name = err instanceof DOMException ? err.name : '';
  if (name === 'NotFoundError' || name === 'NotReadableError' || name === 'NotAllowedError') return 'missing';
  if (name === 'EncodingError') return 'format';
  return 'memory';
}

export function clearAudioLibrary() {
  entries.clear();
  songLoads.clear();
  loading.clear();
  lastUsed.clear();
  retained = new Set();
}

/**
 * Abre o áudio inteiro de uma faixa pelo caminho mais rápido: WAV direto do arquivo, ou a
 * cópia pronta guardada no disco. Só na primeira vez um MP3/M4A (ou um WAV em outra taxa)
 * passa pela conversão completa.
 */
export async function openClipAudio(songId: string, clipId: string, source: Blob, options?: { waitForCopy?: boolean }): Promise<ClipAudio> {
  const rate = deviceSampleRate();
  const converts = await wavConvertsRate(source, rate);
  const dir = await readyDir();
  const name = fullCopyName(songId, clipId, source, rate);
  const readCopy = async () => {
    if (!dir) return null;
    const copy = await readEntry(dir, name);
    if (copy && copy.sampleRate === rate && copy.channels[0].length === copy.fullFrames) {
      return { channels: copy.channels, sampleRate: copy.sampleRate, length: copy.fullFrames };
    }
    return null;
  };
  const keep = (audio: ClipAudio) => {
    if (!dir || audio.sampleRate !== rate) return;
    const saving = writeEntry(dir, name, audio.sampleRate, audio.channels, audio.length, audio.length);
    if (options?.waitForCopy) return saving;
    saving.catch(() => { /* fica para a próxima */ });
  };
  if (converts) {
    const copy = await readCopy();
    if (copy) return copy;
  }
  const wav = await readWav(source, rate);
  if (wav) {
    if (converts) await keep(wav);
    return wav;
  }
  const copy = await readCopy();
  if (copy) return copy;
  const audio = await toClipAudioAsync(await decodeBlob(source));
  await keep(audio);
  return audio;
}

export function ensureSongLoaded(songId: string): Promise<void> {
  if (isSongLoaded(songId)) return Promise.resolve();
  const inflight = songLoads.get(songId);
  if (inflight) return inflight;

  loading.add(songId);
  const task = (async () => {
    useStore.getState().setSongLoading(songId, true);
    try {
      await decodeMissing(songId, DECODE_CONCURRENCY);
      // falhas costumam ser falta de memória: libera o que não está em uso e tenta uma a uma
      for (let pass = 0; pass < 2 && !isSongLoaded(songId); pass++) {
        freeUnprotected();
        await decodeMissing(songId, 1);
      }
    } finally {
      loading.delete(songId);
      songLoads.delete(songId);
      useStore.getState().setSongLoading(songId, false);
      useStore.getState().setSongIncomplete(songId, !isSongLoaded(songId));
      trimToBudget();
    }
  })();
  songLoads.set(songId, task);
  return task;
}

async function decodeMissing(songId: string, concurrency: number) {
  const todo = Array.from(entries.entries()).filter(([, e]) => e.songId === songId && e.source && !e.buffer);
  let cursor = 0;
  const worker = async () => {
    while (cursor < todo.length) {
      const [clipId, e] = todo[cursor++];
      try {
        const audio = await openClipAudio(e.songId, clipId, e.source!);
        // a música pode ter sido liberada enquanto decodificava
        if (entries.get(clipId) === e) {
          e.buffer = audio;
          e.failure = null;
        }
      } catch (err) {
        e.failure = classifyFailure(err);
        console.warn('[audioLibrary] falha ao carregar áudio', clipId, err);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, todo.length) }, worker));
}

/** Protege o áudio das músicas indicadas; as outras já abertas ficam enquanto couberem na memória. */
export function retainSongs(songIds: Array<string | null | undefined>, options?: { strict?: boolean }) {
  retained = new Set(songIds.filter((id): id is string => !!id));
  const now = performance.now();
  retained.forEach((id) => lastUsed.set(id, now));
  if (options?.strict) freeUnprotected();
  else trimToBudget();
}

/** Carrega uma música só durante uma tarefa (salvar, exportar) e libera depois. */
export async function withSongAudio<T>(songId: string, fn: () => Promise<T>): Promise<T> {
  await ensureSongLoaded(songId);
  try {
    return await fn();
  } finally {
    if (!isProtected(songId)) {
      for (const e of entries.values()) {
        if (e.songId === songId) e.buffer = null;
      }
    }
  }
}
