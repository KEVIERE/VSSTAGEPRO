import { decodeBlob } from '@/lib/audioDecoder';
import { toClipAudioAsync, putClipAudio, registerClipSource } from '@/lib/audioLibrary';
import { encodeWavInt16 } from '@/lib/wavEncoder';
import { audioEngine } from '@/lib/audioEngine';
import { useStore } from '@/store';
import type { AudioClip } from '@/types';
import { generateMarkers } from '@/lib/audioDecoder';
import { publishMeters } from '@/lib/meterBus';
import { masterMaestroAudioBuffer } from '@/lib/voiceMastering';

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
        label: d.label || `Entrada ${index + 1}`,
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
  private monitorCtx: AudioContext | null = null;
  private monitorSource: MediaStreamAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private animFrameId: number | null = null;
  private activeDeviceId: string | null = null;

  get recording(): boolean {
    return this.isRecording;
  }

  /** Inicia monitoramento contínuo de entrada para alimentar o VU meter */
  async startMonitoring(deviceId?: string): Promise<void> {
    if (this.mediaStream && this.activeDeviceId === (deviceId || 'default')) return;
    this.stopMonitoring();

    try {
      this.activeDeviceId = deviceId || 'default';
      const constraints: MediaStreamConstraints = {
        audio: deviceId ? { deviceId: { exact: deviceId } } : true,
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.mediaStream = stream;

      const AudioCtxClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtxClass();
      this.monitorCtx = ctx;

      const source = ctx.createMediaStreamSource(stream);
      this.monitorSource = source;

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.5;
      source.connect(analyser);
      this.analyser = analyser;

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const updateMeter = () => {
        if (!this.analyser) return;
        this.analyser.getByteTimeDomainData(dataArray);

        // Calcula amplitude de pico
        let maxPeak = 0;
        for (let i = 0; i < dataArray.length; i++) {
          const val = Math.abs((dataArray[i] - 128) / 128);
          if (val > maxPeak) maxPeak = val;
        }

        // Converte amplitude linear em escala visual 0..1 com curva perceptiva (dB)
        const normalized = Math.min(1, maxPeak * 1.6);
        publishMeters(new Map([['input-maestro', normalized]]));

        this.animFrameId = requestAnimationFrame(updateMeter);
      };
      updateMeter();
    } catch (err) {
      console.warn('[audioRecorder] Falha ao iniciar monitor de entrada:', err);
    }
  }

  stopMonitoring(): void {
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    if (this.monitorSource) {
      try { this.monitorSource.disconnect(); } catch { /* ignore */ }
      this.monitorSource = null;
    }
    if (this.analyser) {
      try { this.analyser.disconnect(); } catch { /* ignore */ }
      this.analyser = null;
    }
    if (this.monitorCtx) {
      try { this.monitorCtx.close(); } catch { /* ignore */ }
      this.monitorCtx = null;
    }
    publishMeters(new Map([['input-maestro', 0]]));
  }

  async start(deviceId?: string): Promise<void> {
    if (this.isRecording) return;
    this.recordedChunks = [];

    // Garante que o stream de áudio esteja aberto e monitorando
    if (!this.mediaStream || (deviceId && this.activeDeviceId !== deviceId)) {
      await this.startMonitoring(deviceId);
    }

    if (!this.mediaStream) {
      const constraints: MediaStreamConstraints = {
        audio: deviceId ? { deviceId: { exact: deviceId } } : true,
      };
      this.mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
    }

    const mimeTypes = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', ''];
    const mimeType = mimeTypes.find((m) => !m || MediaRecorder.isTypeSupported(m)) || '';

    const recorder = mimeType ? new MediaRecorder(this.mediaStream, { mimeType }) : new MediaRecorder(this.mediaStream);
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
          const rawBlob = new Blob(this.recordedChunks, { type: recorder.mimeType || 'audio/webm' });
          this.recordedChunks = [];
          this.mediaRecorder = null;

          const audioBuffer = await decodeBlob(rawBlob);
          resolve({ blob: rawBlob, audioBuffer });
        } catch (err) {
          reject(err);
        }
      };

      try {
        recorder.stop();
      } catch (err) {
        reject(err);
      }
    });
  }

  dispose(): void {
    this.stopMonitoring();
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((t) => t.stop());
      this.mediaStream = null;
    }
    this.activeDeviceId = null;
    this.isRecording = false;
  }
}

export const audioRecorder = new AudioRecorder();

/**
 * Salva a gravação finalizada como um clipe oficial na faixa Maestro.
 */
export async function saveRecordingToMaestro(
  songId: string,
  startTime: number,
  rawAudioBuffer: AudioBuffer
): Promise<AudioClip> {
  const store = useStore.getState();

  // Aplica masterização vocal inteligente com IA (De-Noise, EQ de Presença e Nivelamento)
  let audioBuffer = rawAudioBuffer;
  try {
    audioBuffer = await masterMaestroAudioBuffer(rawAudioBuffer);
  } catch (err) {
    console.warn('[saveRecordingToMaestro] Fallback áudio bruto:', err);
  }

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
    name: `Voz Maestro ✨ (${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })})`,
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
