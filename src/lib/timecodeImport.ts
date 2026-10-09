import { useStore } from '@/store';
import { audioEngine } from '@/lib/audioEngine';
import { decodeBlob } from '@/lib/audioDecoder';
import { putClipAudio, registerClipSource, toClipAudio } from '@/lib/audioLibrary';
import { TIMECODE_TRACK_ID } from '@/lib/timecode';
import type { AudioClip } from '@/types';

/** Coloca o arquivo de timecode na música; um timecode por música, o novo substitui o anterior. */
export async function importTimecodeForSong(songId: string, file: File): Promise<void> {
  let buffer: AudioBuffer;
  try {
    buffer = await decodeBlob(file);
  } catch {
    throw new Error(`Não consegui ler "${file.name}". Use um arquivo de áudio WAV com o sinal de timecode.`);
  }
  const store = useStore.getState();
  for (const old of store.clips.filter((c) => c.songId === songId && c.trackId === TIMECODE_TRACK_ID)) {
    store.removeClip(old.id);
  }
  const clipId = `timecode-${songId}-${Date.now()}`;
  const clip: AudioClip = {
    id: clipId,
    trackId: TIMECODE_TRACK_ID,
    name: 'Timecode',
    fileName: file.name,
    filePath: URL.createObjectURL(file),
    songId,
    startTime: 0,
    duration: buffer.duration,
    sampleRate: buffer.sampleRate,
    channels: buffer.numberOfChannels,
    bpm: null,
    markers: [],
    routingMethod: 'manual',
    routingConfidence: 1,
    waveformPeaks: audioEngine.generateWaveformPeaks(buffer, 2000),
  };
  registerClipSource(clipId, songId, file);
  putClipAudio(clipId, songId, toClipAudio(buffer));
  useStore.getState().addClip(clip);
}
