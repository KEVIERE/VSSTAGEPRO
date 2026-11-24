import { useStore } from '@/store';
import { audioEngine } from '@/lib/audioEngine';
import { decodeBlob } from '@/lib/audioDecoder';
import { putClipAudio, registerClipSource, toClipAudio } from '@/lib/audioLibrary';
import type { AudioClip } from '@/types';

const AUDIO_EXT = /\.(wav|wave|mp3|aif|aiff|flac|m4a|aac|ogg|oga|opus|caf)$/i;

/** Arquivo de áudio que dá para soltar numa trilha (pelo tipo ou pela extensão). */
export function isAudioFile(file: { name: string; type?: string }): boolean {
  return (file.type ?? '').startsWith('audio/') || AUDIO_EXT.test(file.name);
}

/** O arraste traz arquivos de fora do programa (Finder, Explorer, área de trabalho)? */
export function dragHasFiles(dt: DataTransfer | null): boolean {
  return !!dt && Array.from(dt.types ?? []).includes('Files');
}

const baseName = (name: string) => name.replace(/\.[^.]+$/, '') || name;

/**
 * Coloca os áudios soltos na trilha, a partir do ponto em que caíram. Vários arquivos ficam um
 * depois do outro. Os que não abrem são pulados e avisados; os outros entram. Cada clipe entra
 * como um passo do Desfazer.
 */
export async function dropAudioOnTrack(songId: string, trackId: string, files: File[], startTime: number): Promise<number> {
  const audios = files.filter(isAudioFile);
  const skipped = files.length - audios.length;
  const failed: string[] = [];
  let at = Math.max(0, startTime);
  let added = 0;
  for (const file of audios) {
    let buffer: AudioBuffer;
    try {
      buffer = await decodeBlob(file);
    } catch {
      failed.push(file.name);
      continue;
    }
    const clipId = `drop-${trackId}-${Date.now()}-${added}`;
    const peakResolution = Math.min(24000, Math.max(8000, Math.round(buffer.duration * 100)));
    const clip: AudioClip = {
      id: clipId,
      trackId,
      name: baseName(file.name),
      fileName: file.name,
      filePath: URL.createObjectURL(file),
      songId,
      startTime: at,
      duration: buffer.duration,
      sampleRate: buffer.sampleRate,
      channels: buffer.numberOfChannels,
      bpm: null,
      markers: [],
      routingMethod: 'manual',
      routingConfidence: 1,
      waveformPeaks: audioEngine.generateWaveformPeaks(buffer, peakResolution),
    };
    registerClipSource(clipId, songId, file);
    putClipAudio(clipId, songId, toClipAudio(buffer));
    useStore.getState().addClip(clip);
    at += buffer.duration;
    added++;
  }
  const notes: string[] = [];
  if (failed.length) notes.push(`não consegui ler ${failed.map((n) => `"${n}"`).join(', ')}`);
  if (skipped) notes.push(`${skipped} arquivo${skipped > 1 ? 's' : ''} que não ${skipped > 1 ? 'são' : 'é'} de áudio ficou de fora`);
  if (notes.length) useStore.getState().setPlaybackError(`Arrastar para a trilha: ${notes.join('; ')}. Use WAV, MP3, AIFF, FLAC ou M4A.`);
  return added;
}
