import { USER_CLICK_SAMPLE_B64 } from '@/lib/clickSampleData';
import { decodeBlob } from '@/lib/audioDecoder';

function b64ToBlob(b64: string): Blob {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: 'audio/wav' });
}

let cachedUserSample: AudioBuffer | null = null;

async function loadUserSample(): Promise<AudioBuffer> {
  if (cachedUserSample) return cachedUserSample;
  try {
    const blob = b64ToBlob(USER_CLICK_SAMPLE_B64);
    cachedUserSample = await decodeBlob(blob);
    return cachedUserSample;
  } catch (err) {
    console.warn('[clickGenerator] falha ao decodificar amostra do usuário:', err);
    throw err;
  }
}

/**
 * Sintetizador de Click do Show.
 * Utiliza o áudio real do usuário, mantendo exatamente o mesmo timbre e som único em 100% das batidas,
 * travado com precisão matemática na grade métrica.
 */
export async function generateClickTrack(
  durationSeconds: number,
  bpm: number,
  sampleRate = 44100,
  downbeatOffset = 0,
  beatsPerBar = 4
): Promise<AudioBuffer> {
  const safeDuration = Math.max(1, durationSeconds);
  const length = Math.ceil(safeDuration * sampleRate);
  const buffer = new AudioBuffer({ length, numberOfChannels: 2, sampleRate });
  const outL = buffer.getChannelData(0);
  const outR = buffer.getChannelData(1);

  let sampleBuf: AudioBuffer;
  try {
    sampleBuf = await loadUserSample();
  } catch {
    // Fallback matemático caso a amostra falhe
    sampleBuf = createFallbackSample(sampleRate);
  }

  const sL = sampleBuf.getChannelData(0);
  const sR = sampleBuf.numberOfChannels > 1 ? sampleBuf.getChannelData(1) : sL;
  const sampleLen = sampleBuf.length;

  const secondsPerBeat = 60 / Math.max(30, Math.min(300, bpm));

  const kMin = Math.ceil(-downbeatOffset / secondsPerBeat);
  const kMax = Math.floor((safeDuration - downbeatOffset) / secondsPerBeat);

  for (let k = kMin; k <= kMax; k++) {
    const beatTime = downbeatOffset + k * secondsPerBeat;
    const startSample = Math.round(beatTime * sampleRate);
    if (startSample < 0 || startSample >= length) continue;

    // Apenas UM som idêntico em todas as batidas, no volume oficial de estúdio
    for (let i = 0; i < sampleLen && startSample + i < length; i++) {
      outL[startSample + i] += sL[i];
      outR[startSample + i] += sR[i];
    }
  }

  return buffer;
}

function createFallbackSample(sampleRate: number): AudioBuffer {
  const len = Math.round(sampleRate * 0.03); // 30ms
  const buf = new AudioBuffer({ length: len, numberOfChannels: 2, sampleRate });
  const l = buf.getChannelData(0);
  const r = buf.getChannelData(1);
  for (let i = 0; i < len; i++) {
    const t = i / sampleRate;
    const env = Math.exp(-t * 240);
    const v = Math.sin(2 * Math.PI * 1800 * t) * env * 0.9;
    l[i] = v;
    r[i] = v;
  }
  return buf;
}
