// Fontes que leem o áudio de um clipe direto do disco, em trechos, na taxa da saída:
//  - cópia pronta já convertida guardada pelo app (MP3/M4A e outros formatos compactados
//    ganham essa cópia uma vez, em segundo plano);
//  - o próprio WAV, em qualquer taxa (convertida trecho a trecho, com o mesmo filtro).
// Os cortes do clipe (início/fim) são aplicados igual a getClipPlayAudio.
import { deviceSampleRate } from '@/lib/audioDecoder';
import { clipPlayLength, getClipSource } from '@/lib/audioLibrary';
import type { RangeReader } from '@/lib/audioStreamer';
import { entryGeneration, fullCopyName, openEntryRange, readyDir } from '@/lib/readyStore';
import { readWavRange, wavLayoutAtRate } from '@/lib/wavReader';
import type { AudioClip } from '@/types';

interface BaseReader {
  sampleRate: number;
  channelCount: number;
  frames: number;
  read: (s: number, n: number) => Promise<Int16Array[]>;
}

// Leitor do arquivo inteiro (sem os cortes) já aberto, por arquivo de origem e nome da cópia pronta
// (o nome já leva a música, o clipe, o tamanho do arquivo e a taxa da saída). Abrir de novo a mesma
// faixa (preparo da próxima, Play, click, corte) deixa de consultar o disco. Vale enquanto a cópia
// pronta não for gravada nem apagada (entryGeneration) e enquanto a leitura não falhar. Os cortes
// do clipe são aplicados a cada abertura, então mudar o corte nunca usa um trecho velho.
// WeakMap pelo arquivo: quando a biblioteca solta a fonte, o leitor guardado sai junto.
const openBases = new WeakMap<Blob, Map<string, { generation: number; base: BaseReader }>>();

function cachedBase(source: Blob, name: string): BaseReader | null {
  const hit = openBases.get(source)?.get(name);
  if (!hit) return null;
  if (hit.generation === entryGeneration(name)) return hit.base;
  openBases.get(source)?.delete(name);
  return null;
}

function rememberBase(source: Blob, name: string, generation: number, base: BaseReader): BaseReader {
  let byName = openBases.get(source);
  if (!byName) openBases.set(source, (byName = new Map()));
  const entry: { generation: number; base: BaseReader } = { generation, base };
  entry.base = {
    ...base,
    // leitura que falha (cópia trocada por fora, disco fora) tira o leitor da memória: a próxima
    // abertura consulta o disco de novo, como antes
    read: (s, n) => base.read(s, n).catch((err) => {
      if (openBases.get(source)?.get(name) === entry) openBases.get(source)?.delete(name);
      throw err;
    }),
  };
  byName.set(name, entry);
  return entry.base;
}

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

function windowed(base: BaseReader, clip: AudioClip): RangeReader {
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
  const name = fullCopyName(clip.songId, clip.id, source, rate);
  const hit = cachedBase(source, name);
  if (hit) return windowed(hit, clip);
  // lido antes de abrir: se a cópia for gravada ou apagada no meio, o leitor guardado já nasce velho
  const generation = entryGeneration(name);
  const dir = await readyDir();
  // as duas consultas vão juntas: a cópia pronta (se houver) vence, senão o próprio WAV
  const [copy, layoutProbe] = await Promise.all([
    dir ? openEntryRange(dir, name) : Promise.resolve(null),
    wavLayoutAtRate(source, rate).catch(() => null),
  ]);
  if (copy && copy.sampleRate === rate && copy.frames === copy.fullFrames) {
    return windowed(rememberBase(source, name, generation, { sampleRate: rate, channelCount: copy.channelCount, frames: copy.frames, read: copy.read }), clip);
  }
  const layout = layoutProbe;
  if (!layout) return null;
  return windowed(rememberBase(source, name, generation, {
    sampleRate: rate,
    channelCount: layout.channels,
    frames: layout.frames,
    read: async (s, n) => {
      if (n <= 0) return [new Int16Array(0)];
      const r = await readWavRange(source, rate, s, n);
      if (!r) throw new Error('leitura do WAV falhou');
      return r;
    },
  }), clip);
}

/** Leitores para todas as faixas, ou null se alguma ainda não puder ser lida em trechos. */
export async function openRangeReaders(clips: AudioClip[]): Promise<Map<string, RangeReader> | null> {
  if (clips.length === 0) return null;
  const readers = await Promise.all(clips.map((c) => openRangeReader(c).catch(() => null)));
  if (readers.some((r) => !r)) return null;
  return new Map(clips.map((c, i) => [c.id, readers[i]!]));
}
