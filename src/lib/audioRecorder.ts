import { decodeBlob } from '@/lib/audioDecoder';
import { toClipAudioAsync, putClipAudio, registerClipSource } from '@/lib/audioLibrary';
import { encodeWavInt16 } from '@/lib/wavEncoder';
import { audioEngine } from '@/lib/audioEngine';
import { useStore } from '@/store';
import type { AudioClip } from '@/types';
import { generateMarkers } from '@/lib/audioDecoder';

export interface InputAudioDevice {
  deviceId: string;
  label: string;
}

export async function listInputAudioDevices(): Promise<InputAudioDevice[]> {
  try {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    // Solicita permissão se ainda não concedida para que os labels apareçam
    const devices = await navigator.mediaDevices.enumerateDevices();
    const inputs = devices
      .filter((d) => d.kind === 'audioinput')
      .map((d, index) => ({
        deviceId: d.deviceId,
        label: d.label || `Microfone / Entrada ${index + 1}`,
      }));
    return inputs;
  } catch (err) {
    console.warn('[audioRecorder] erro ao listar entradas de áudio:', err);
    return [];
  }
}

class AudioRecorder {
  private mediaRecorder: MediaRecorder | null = null;
  private mediaStream: MediaStream | null = null;
  private recordedChunks: Blob[] = [];
  private isRecording = false;

  get recording(): boolean {
    return this.isRecording;
  }

  async start(deviceId?: string): Promise<void> {
    if (this.isRecording) return;
    this.recordedChunks = [];

    const constraints: MediaStreamConstraints = {
      audio: deviceId ? { deviceId: { exact: deviceId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false } : { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    };

    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    this.mediaStream = stream;

    // Prefere WAV/WebM com áudio não comprimido ou de alta fidelidade
    const mimeTypes = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', ''];
    const mimeType = mimeTypes.find((m) => !m || MediaRecorder.isTypeSupported(m)) || '';

    const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    this.mediaRecorder = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        this.recordedChunks.push(e.data);
      }
    };

    recorder.start(100);
    this.isRecording = true;
  }

  async stop(): Promise<{ blob: Blob; audioBuffer: AudioBuffer } | null> {
    if (!this.isRecording || !this.mediaRecorder) return null;

    return new Promise((resolve, reject) => {
      const recorder = this.mediaRecorder!;
      recorder.onstop = async () => {
        try {
          this.isRecording = false;
          // Desliga trilhas do microfone
          if (this.mediaStream) {
            this.mediaStream.getTracks().forEach((t) => t.stop());
            this.mediaStream = null;
          }

          const rawBlob = new Blob(this.recordedChunks, { type: recorder.mimeType || 'audio/webm' });
          this.recordedChunks = [];
          this.mediaRecorder = null;

          const audioBuffer = await decodeBlob(rawBlob);
          resolve({ blob: rawBlob, audioBuffer });
        } catch (err) {
          reject(err);
        }
      };

      recorder.stop();
    });
  }
}

export const audioRecorder = new AudioRecorder();

/**
 * Salva a gravação finalizada como um clipe oficial na faixa Maestro.
 */
export async function saveRecordingToMaestro(
  songId: string,
  startTime: number,
  audioBuffer: AudioBuffer
): Promise<AudioClip> {
  const store = useStore.getState();
  const sampleRate = audioBuffer.sampleRate;
  const duration = Math.max(0.1, audioBuffer.duration);

  const clipAudio = await toClipAudioAsync(audioBuffer);
  const wavBytes = encodeWavInt16(clipAudio);
  const wavBlob = new Blob([wavBytes], { type: 'audio/wav' });

  const clipId = `clip-maestro-${Date.now()}`;
  const peaks = audioEngine.generateWaveformPeaks(audioBuffer, 2000);

  const clip: AudioClip = {
    id: clipId,
    trackId: 'track-maestro',
    name: `Voz Maestro (${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })})`,
    fileName: `maestro_${Date.now()}.wav`,
    filePath: URL.createObjectURL(wavBlob),
    songId,
    startTime: Math.max(0, startTime),
    duration,
    sampleRate,
    channels: audioBuffer.numberOfChannels,
    bpm: null,
    markers: generateMarkers(duration),
    routingMethod: 'manual',
    routingConfidence: 1,
    waveformPeaks: peaks,
    gain: 1,
    mute: false,
    solo: false,
  };

  registerClipSource(clipId, songId, wavBlob);
  putClipAudio(clipId, songId, clipAudio);
  store.addClip(clip);

  audioEngine.invalidatePrepared(songId);
  return clip;
}
