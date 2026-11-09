// Fontes que leem o áudio de um clipe direto do disco, em trechos, na taxa da saída:
//  - cópia pronta já convertida guardada pelo app (MP3/M4A e outros formatos compactados
//    ganham essa cópia uma vez, em segundo plano);
//  - o próprio WAV, em qualquer taxa (convertida trecho a trecho, com o mesmo filtro).
// Os cortes do clipe (início/fim) são aplicados igual a getClipPlayAudio.
import { deviceSampleRate } from '@/lib/audioDecoder';
import { clipPlayLength, getClipSource } from '@/lib/audioLibrary';
import type { RangeReader } from '@/lib/audioStreamer';
import { fullCopyName, openEntryRange, readyDir } from '@/lib/readyStore';
import { readWavRange, wavLayoutAtRate } from '@/lib/wavReader';
import type { AudioClip } from '@/types';

/** Mesmo trecho que getClipPlayAudio devolve para um arquivo de `fileFrames` quadros. */
export function playWindow(fileFrames: number, sampleRate: number, clip: { duration: number; trimStart?: number; trimEnd?: number }): { start: number; length: number } {
  const startSec = Math.max(0, clip.trimStart ?? 0);
  const endSec = Math.max(0, clip.trimEnd ?? 0);
  if (startSec <= 0 && endSec <= 0) return { start: 0, length: fileFrames };
  const startSample = Math.min(Math.max(0, fileFrames - 1), Math.floor(startSec * sampleRate));
  const maxAvailSec = Math.max(0.05, fileFrames / sampleRate - startSec - endSec);
  const playLength = Math.min(clipPlayLength(clip), maxAvailSec);
  const playSamples = Math.max(1, Math.min(fileFrames - startSample, Math.round(playLength * sampleRate)));
  const endSample = Math.min(fileFrames, startSample + playSamples);
  if (startSample <= 0 && endSample >= fileFrames) return { start: 0, length: fileFrames };
  return { start: startSample, length: Math.max(1, endSample - startSample) };
}

function windowed(base: { sampleRate: number; channelCount: number; frames: number; read: (s: number, n: number) => Promise<Int16Array[]> }, clip: AudioClip): RangeReader {
  const win = playWindow(base.frames, base.sampleRate, clip);
  return {
    sampleRate: base.sampleRate,
    channelCount: base.channelCount,
    length: win.length,
    read: (start, frames) => {
      const s = Math.max(0, Math.min(win.length, start));
      const n = Math.max(0, Math.min(frames, win.length - s));
      return base.read(win.start + s, n);
    },
  };
}

/** Leitor de trechos para o clipe, ou null se o arquivo só abre inteiro (sem cópia pronta ainda). */
export async function openRangeReader(clip: AudioClip): Promise<RangeReader | null> {
  const source = getClipSource(clip.id);
  if (!source) return null;
  const rate = deviceSampleRate();
  const dir = await readyDir();
  // as duas consultas vão juntas: a cópia pronta (se houver) vence, senão o próprio WAV
  const [copy, layoutProbe] = await Promise.all([
    dir ? openEntryRange(dir, fullCopyName(clip.songId, clip.id, source, rate)) : Promise.resolve(null),
    wavLayoutAtRate(source, rate).catch(() => null),
  ]);
  if (copy && copy.sampleRate === rate && copy.frames === copy.fullFrames) {
    return windowed({ sampleRate: rate, channelCount: copy.channelCount, frames: copy.frames, read: copy.read }, clip);
  }
  const layout = layoutProbe;
  if (!layout) return null;
  return windowed({
    sampleRate: rate,
    channelCount: layout.channels,
    frames: layout.frames,
    read: async (s, n) => {
      if (n <= 0) return [new Int16Array(0)];
      const r = await readWavRange(source, rate, s, n);
      if (!r) throw new Error('leitura do WAV falhou');
      return r;
    },
  }, clip);
}

/** Leitores para todas as faixas, ou null se alguma ainda não puder ser lida em trechos. */
export async function openRangeReaders(clips: AudioClip[]): Promise<Map<string, RangeReader> | null> {
  if (clips.length === 0) return null;
  const readers = await Promise.all(clips.map((c) => openRangeReader(c).catch(() => null)));
  if (readers.some((r) => !r)) return null;
  return new Map(clips.map((c, i) => [c.id, readers[i]!]));
}
