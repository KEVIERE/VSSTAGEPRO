import { decodeBlob } from '@/lib/audioDecoder';
import { toClipAudioAsync, putClipAudio, registerClipSource } from '@/lib/audioLibrary';
import { encodeWavInt16 } from '@/lib/wavEncoder';
import { audioEngine } from '@/lib/audioEngine';
import { useStore } from '@/store';
import type { AudioClip } from '@/types';
import { generateMarkers } from '@/lib/audioDecoder';
import { publishMeters } from '@/lib/meterBus';
import { inputConstraints, inputLabel, usableChannel, type InputAudioDevice, type MaestroInput } from '@/lib/maestroInput';

export type { InputAudioDevice, MaestroInput } from '@/lib/maestroInput';

/**
 * Placas de entrada do computador. Com `askPermission`, se vierem sem nome (o sistema só dá o
 * nome depois da permissão do microfone), pede a permissão uma vez e lista de novo.
 * `denied` avisa quando a permissão foi negada.
 */
export async function listInputAudioDevices(askPermission = false): Promise<{ devices: InputAudioDevice[]; denied: boolean }> {
  const read = async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    const all = await navigator.mediaDevices.enumerateDevices();
    return all
      .filter((d) => d.kind === 'audioinput')
      .map((d, index) => ({ deviceId: d.deviceId, ...inputLabel(d.label, index) }));
  };
  try {
    let devices = await read();
    let denied = false;
    if (askPermission && (devices.length === 0 || devices.some((d) => !d.named))) {
      try {
        const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
        probe.getTracks().forEach((t) => t.stop());
        devices = await read();
      } catch {
        denied = true;
      }
    }
    return { devices, denied };
  } catch (err) {
    console.warn('[audioRecorder] erro ao listar entradas de áudio:', err);
    return { devices: [], denied: false };
  }
}

/**
 * Gravação da voz do Maestro: abre a placa escolhida, separa os canais e grava só o canal
 * escolhido (mono). O medidor de entrada ('input-maestro') mostra esse canal.
 */
class AudioRecorder {
  private mediaRecorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private dest: MediaStreamAudioDestinationNode | null = null;
  private recordedChunks: Blob[] = [];
  private isRecording = false;
  private animFrameId: number | null = null;
  private openKey: string | null = null;
  private opening: Promise<void> | null = null;
  private closeAfterStop = false;
  /** Muda a cada fechamento: uma abertura que termina depois de fechar solta a placa. */
  private gen = 0;
  /** Quantos canais a placa aberta tem. */
  channels = 0;

  get recording(): boolean {
    return this.isRecording;
  }

  /** Abre a placa e liga o canal escolhido no medidor e na gravação. */
  private async open(input: MaestroInput): Promise<void> {
    const key = `${input.deviceId}|${input.channel}`;
    if (this.openKey === key && this.ctx) return;
    if (this.opening) await this.opening.catch(() => {});
    if (this.openKey === key && this.ctx) return;
    this.close();
    const gen = this.gen;
    this.opening = (async () => {
      const stream = await navigator.mediaDevices.getUserMedia(inputConstraints(input.deviceId));
      if (gen !== this.gen) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      const ctx = new AudioContext();
      // o navegador cria o AudioContext pausado quando não foi um clique que abriu: sem isso a
      // gravação sairia em silêncio
      await ctx.resume().catch(() => {});
      const source = ctx.createMediaStreamSource(stream);
      const channels = Math.max(1, stream.getAudioTracks()[0]?.getSettings().channelCount ?? source.channelCount ?? 1);
      const splitter = ctx.createChannelSplitter(channels);
      source.connect(splitter);
      const pick = ctx.createGain();
      splitter.connect(pick, usableChannel(input.channel, channels));
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.5;
      pick.connect(analyser);
      const dest = ctx.createMediaStreamDestination();
      dest.channelCount = 1;
      pick.connect(dest);
      this.stream = stream;
      this.ctx = ctx;
      this.analyser = analyser;
      this.dest = dest;
      this.channels = channels;
      this.openKey = key;
    })();
    try {
      await this.opening;
    } finally {
      this.opening = null;
    }
  }

  private close(): void {
    this.gen++;
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    this.analyser = null;
    this.dest = null;
    if (this.ctx) {
      try { void this.ctx.close(); } catch { /* já fechado */ }
      this.ctx = null;
    }
    // solta o microfone de verdade (sem isso a luz do microfone do Mac fica acesa)
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.openKey = null;
    publishMeters(new Map([['input-maestro', 0]]));
  }

  /** Liga o medidor de entrada do canal escolhido. Devolve quantos canais a placa tem. */
  async startMonitoring(input: MaestroInput): Promise<number> {
    await this.open(input);
    if (this.animFrameId === null && this.analyser) {
      const data = new Uint8Array(this.analyser.frequencyBinCount);
      const update = () => {
        if (!this.analyser) { this.animFrameId = null; return; }
        this.analyser.getByteTimeDomainData(data);
        let peak = 0;
        for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs((data[i] - 128) / 128));
        publishMeters(new Map([['input-maestro', Math.min(1, peak * 1.6)]]));
        this.animFrameId = requestAnimationFrame(update);
      };
      update();
    }
    return this.channels;
  }

  /** Desliga o medidor e solta a placa (se estiver gravando, solta quando a gravação terminar). */
  stopMonitoring(): void {
    if (this.isRecording) {
      this.closeAfterStop = true;
      return;
    }
    this.close();
  }

  async start(input: MaestroInput): Promise<void> {
    if (this.isRecording) return;
    this.recordedChunks = [];
    await this.startMonitoring(input);
    if (!this.dest) throw new Error('entrada de áudio indisponível');
    const mimeTypes = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', ''];
    const mimeType = mimeTypes.find((m) => !m || MediaRecorder.isTypeSupported(m)) || '';
    const recorder = mimeType ? new MediaRecorder(this.dest.stream, { mimeType }) : new MediaRecorder(this.dest.stream);
    this.mediaRecorder = recorder;
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) this.recordedChunks.push(e.data);
    };
    recorder.start(100);
    this.closeAfterStop = false;
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
          if (this.closeAfterStop) {
            this.closeAfterStop = false;
            this.close();
          }
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
    this.isRecording = false;
    this.close();
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
