import type { Marker } from '@/types';

export interface DecodedAudio {
  audioBuffer: AudioBuffer;
  sampleRate: number;
  channels: number;
  duration: number;
  /** First 5 seconds of mono data for AI classification */
  sample5s: Float32Array;
}

// Reaproveita um único AudioContext "offline-ish" para decodificar todos os
// arquivos, em vez de abrir e fechar um por arquivo (operação cara).
let decodeCtx: AudioContext | null = null;
function getDecodeContext(): AudioContext {
  if (!decodeCtx || decodeCtx.state === 'closed') {
    decodeCtx = new AudioContext();
  }
  return decodeCtx;
}

export async function decodeFile(file: File): Promise<DecodedAudio> {
  const audioBuffer = await decodeBlob(file);

  const sampleRate = audioBuffer.sampleRate;
  const channels = audioBuffer.numberOfChannels;
  const duration = audioBuffer.duration;

  const fiveSeconds = Math.min(5, duration);
  const sampleLength = Math.floor(fiveSeconds * sampleRate);
  const sample5s = new Float32Array(sampleLength);

  for (let ch = 0; ch < channels; ch++) {
    const channelData = audioBuffer.getChannelData(ch);
    for (let i = 0; i < sampleLength; i++) {
      sample5s[i] += channelData[i] / channels;
    }
  }

  return { audioBuffer, sampleRate, channels, duration, sample5s };
}

export async function decodeBlob(blob: Blob): Promise<AudioBuffer> {
  const arrayBuffer = await blob.arrayBuffer();
  return getDecodeContext().decodeAudioData(arrayBuffer);
}

/** Taxa da saída de áudio: é nela que o áudio aberto precisa estar para tocar sem conversão. */
export function deviceSampleRate(): number {
  return getDecodeContext().sampleRate;
}

export function extractChannelData(audioBuffer: AudioBuffer): Float32Array {
  const channelData = audioBuffer.getChannelData(0);
  return channelData;
}

export function generateMarkers(duration: number): Marker[] {
  return [
    {
      id: `marker-start-${Date.now()}`,
      name: 'Início',
      position: 0,
      type: 'start',
    },
    {
      id: `marker-end-${Date.now()}`,
      name: 'Fim',
      position: duration,
      type: 'end',
    },
  ];
}
