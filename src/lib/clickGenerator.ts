import { decodeBlob } from '@/lib/audioDecoder';
import { clickBufferLength, placeClickSamples } from '@/lib/clickEdit';

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
    // A amostra (157 KB) só é usada ao gerar click (VS por IA e Recriar metrônomo): fica fora
    // do carregamento da abertura do programa e é buscada aqui, na primeira vez.
    const { USER_CLICK_SAMPLE_B64 } = await import('@/lib/clickSampleData');
    const blob = b64ToBlob(USER_CLICK_SAMPLE_B64);
    cachedUserSample = await decodeBlob(blob);
    return cachedUserSample;
  } catch (err) {
    console.warn('[clickGenerator] falha ao decodificar amostra do usuário:', err);
    throw err;
  }
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

/**
 * Som padrão do metrônomo do VS Stage em cada instante de `times` (segundos), com o começo do
 * som em cima do instante. É o único gerador de click: o Recriar metrônomo passa as batidas do
 * click da faixa e o VS por IA passa as batidas da grade (ver gridClickBuffer em clickClip).
 */
export async function generateClickAt(times: number[], durationSeconds: number, sampleRate = 44100): Promise<AudioBuffer> {
  const length = clickBufferLength(durationSeconds, sampleRate);
  let sampleBuf: AudioBuffer;
  try {
    sampleBuf = await loadUserSample();
  } catch {
    sampleBuf = createFallbackSample(sampleRate);
  }
  const sL = sampleBuf.getChannelData(0);
  const sR = sampleBuf.numberOfChannels > 1 ? sampleBuf.getChannelData(1) : sL;
  const [outL, outR] = placeClickSamples(times, length, sampleRate, sL, sR);
  const buffer = new AudioBuffer({ length, numberOfChannels: 2, sampleRate });
  buffer.getChannelData(0).set(outL);
  buffer.getChannelData(1).set(outR);
  return buffer;
}
