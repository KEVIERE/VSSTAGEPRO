import { clipAudioToBuffer, getClipAudio, getClipSource, putClipAudio, registerClipSource, toClipAudioAsync } from '@/lib/audioLibrary';
import { encodeWavPcm24 } from '@/lib/wavEncoder';
import { decodeBlob } from '@/lib/audioDecoder';
import { masterChannels } from '@/lib/mastering';
import { audioEngine } from '@/lib/audioEngine';
import { useStore } from '@/store';

/** Masteriza um AudioBuffer com a cadeia de mastering.ts (mantém o loudness, teto -1 dBTP). */
export async function masterProfessionalAudioBuffer(inputBuffer: AudioBuffer, isVocalTrack = false): Promise<AudioBuffer> {
  const channels = Array.from({ length: inputBuffer.numberOfChannels }, (_, c) => inputBuffer.getChannelData(c));
  const { channels: out } = masterChannels(channels, inputBuffer.sampleRate, { vocal: isVocalTrack });
  const buf = new AudioBuffer({ length: out[0].length, numberOfChannels: out.length, sampleRate: inputBuffer.sampleRate });
  out.forEach((c, i) => buf.copyToChannel(c as Float32Array<ArrayBuffer>, i));
  return buf;
}

/**
 * Masteriza um clipe da timeline (voz, bateria, guitarras, baixo, mix completa...).
 * Lê o arquivo original em resolução total (float), aplica a cadeia de mastering.ts e grava o
 * resultado em WAV de 24 bits como nova fonte do clipe — sem perder resolução. Funciona também
 * quando o áudio não está aberto na memória (a música toca lida do disco).
 */
export async function masterAudioClip(clipId: string): Promise<boolean> {
  const store = useStore.getState();
  const clip = store.clips.find((c) => c.id === clipId);
  if (!clip) return false;

  const isVocal = clip.trackId === 'track-maestro' || clip.trackId === 'track-guia';
  const done = (status: 'done' | 'error', message: string) => {
    store.setImportProgress({ clipId: 'mastering', status, message });
    setTimeout(() => { if (useStore.getState().importProgress?.clipId === 'mastering') useStore.getState().setImportProgress(null); }, status === 'done' ? 6000 : 4000);
  };

  store.setImportProgress({ clipId: 'mastering', status: 'working' as never, message: `Masterizando "${clip.name}"...` });

  try {
    const source = getClipSource(clipId);
    let input: AudioBuffer | null = null;
    if (source) {
      input = await decodeBlob(source);
    } else {
      const raw = getClipAudio(clipId);
      if (raw) input = clipAudioToBuffer(raw);
    }
    if (!input) throw new Error('o áudio deste clipe não foi encontrado');

    const channels = Array.from({ length: Math.min(2, input.numberOfChannels) }, (_, c) => input!.getChannelData(c));
    const { channels: out, report } = masterChannels(channels, input.sampleRate, { vocal: isVocal });
    const mastered = new AudioBuffer({ length: out[0].length, numberOfChannels: out.length, sampleRate: input.sampleRate });
    out.forEach((c, i) => mastered.copyToChannel(c as Float32Array<ArrayBuffer>, i));

    const clipAudio = await toClipAudioAsync(mastered);
    const wavBlob = new Blob([encodeWavPcm24(mastered)], { type: 'audio/wav' });
    const peaks = audioEngine.generateWaveformPeaks(mastered, Math.min(24000, Math.max(8000, Math.round(clip.duration * 100))));

    putClipAudio(clip.id, clip.songId, clipAudio);
    registerClipSource(clip.id, clip.songId, wavBlob);

    const cleanBaseName = clip.name.replace(/^✨\s*/, '').replace(/\s*\(Master(?:izado| Moises)?\)/g, '');
    store.updateClip(clip.id, { name: `✨ ${cleanBaseName} (Masterizado)`, waveformPeaks: peaks, gain: 1.0 });
    audioEngine.invalidatePrepared(clip.songId);

    const f = (v: number) => (Number.isFinite(v) ? v.toFixed(1) : '-∞');
    done('done', `Masterizado: compressão ${f(-report.compressionDb)} dB, pico ${f(report.peakBeforeDbtp)} → ${f(report.peakAfterDbtp)} dBTP, volume mantido em ${f(report.lufsAfter)} LUFS.`);
    return true;
  } catch (err) {
    console.error('[masterAudioClip] Erro:', err);
    done('error', `Não consegui masterizar "${clip.name}": ${err instanceof Error ? err.message : String(err)}.`);
    return false;
  }
}

// Mantém compatibilidade com chamadas legadas
export const masterMaestroClip = masterAudioClip;
export const masterMaestroAudioBuffer = (buf: AudioBuffer) => masterProfessionalAudioBuffer(buf, true);
