import { useStore } from '@/store';
import { clipPlayLength, getClipPlayAudio, getClipSource } from '@/lib/audioLibrary';
import { decodeBlob } from '@/lib/audioDecoder';
import { encodeWavInt16, encodeWavPcm24 } from '@/lib/wavEncoder';
import { openFileTarget } from '@/lib/exportTarget';

const safeName = (name: string) => (name.replace(/\.[^.]+$/, '').replace(/[/\\:*?"<>|]+/g, '_').trim() || 'audio');

/** O trecho tocado do clipe (cortes do início e do fim), na qualidade do arquivo original. */
function trimmed(buffer: AudioBuffer, clip: { duration: number; trimStart?: number; trimEnd?: number }): AudioBuffer {
  const sr = buffer.sampleRate;
  const start = Math.min(buffer.length - 1, Math.max(0, Math.floor((clip.trimStart ?? 0) * sr)));
  const length = Math.max(1, Math.min(buffer.length - start, Math.round(clipPlayLength(clip) * sr)));
  if (start === 0 && length === buffer.length) return buffer;
  const out = new AudioBuffer({ length, sampleRate: sr, numberOfChannels: buffer.numberOfChannels });
  for (let c = 0; c < buffer.numberOfChannels; c++) out.copyToChannel(buffer.getChannelData(c).subarray(start, start + length), c);
  return out;
}

/**
 * Exporta só o áudio deste clipe num WAV, com os cortes do início e do fim. Sai do arquivo original
 * (WAV de 24 bits); sem ele, da cópia em memória (16 bits). O ganho, os fades e o volume do canal
 * não entram: sai o áudio do clipe como ele é. A pessoa escolhe a pasta e o nome no Finder.
 * Devolve onde gravou, ou null se cancelou ou falhou.
 */
export async function exportClipAudio(clipId: string): Promise<string | null> {
  const store = useStore.getState();
  const clip = store.clips.find((c) => c.id === clipId);
  if (!clip) return null;
  const source = getClipSource(clip.id);
  const memory = source ? null : getClipPlayAudio(clip);
  if (!source && !memory) {
    store.setPlaybackError(`"${clip.name}": o áudio deste clipe não está disponível para exportar.`);
    return null;
  }
  const picked = await openFileTarget(`${safeName(clip.name)}.wav`);
  if (!picked) return null;
  try {
    const data = source ? encodeWavPcm24(trimmed(await decodeBlob(source), clip)) : encodeWavInt16(memory!);
    await picked.target.write(picked.name, data);
    await picked.target.finish();
    return picked.target.location;
  } catch (err) {
    store.setPlaybackError(`Não consegui exportar "${clip.name}": ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
