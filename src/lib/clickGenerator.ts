import { decodeBlob } from '@/lib/audioDecoder';
import type { TempoSegment } from '@/lib/beatDetector';
import { clickOnsetIndex } from '@/lib/clickEdit';

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
    // A amostra (157 KB) só é usada ao gerar click na separação: fica fora do carregamento
    // da abertura do programa e é buscada aqui, na primeira vez.
    const { USER_CLICK_SAMPLE_B64 } = await import('@/lib/clickSampleData');
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
  beatsPerBar = 4,
  tempoSegments?: TempoSegment[]
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

  // O começo do som (não o pico) fica em cima da linha da grade. A amostra começa a soar em
  // ~1,5 ms e tem o pico em ~7,4 ms: alinhar pelo pico deixava ~6 ms de click antes da linha,
  // visível na forma de onda e adiantado no ouvido. A amostra é copiada ponto a ponto, então
  // o índice medido nela vale direto no buffer do click.
  const onsetSamples = clickOnsetIndex(sL);

  const place = (beatTime: number) => {
    const targetSample = Math.round(beatTime * sampleRate);
    // No primeiro click (t <= 0), inicia no sample 0 para preservar 100% do som sem corte.
    // Nos demais, adianta só o silêncio do começo da amostra: o som começa em cima da linha.
    const startSample = targetSample <= 0 ? 0 : Math.max(0, targetSample - onsetSamples);
    for (let i = 0; i < sampleLen; i++) {
      const dest = startSample + i;
      if (dest >= 0 && dest < length) {
        outL[dest] += sL[i];
        outR[dest] += sR[i];
      }
    }
  };

  if (tempoSegments && tempoSegments.length > 1) {
    // Vários andamentos: cada trecho recomeça a contar na própria mudança, igual à grade
    // (gridLines). Conta por índice (início + k × tempo) para não acumular erro de soma.
    const segs = [...tempoSegments].sort((x, y) => x.startTime - y.startTime);
    segs.forEach((seg, idx) => {
      const spb = 60 / Math.max(30, Math.min(300, seg.bpm || bpm));
      const end = idx === segs.length - 1 ? safeDuration : Math.min(seg.endTime, safeDuration);
      for (let k = 0; ; k++) {
        const t = seg.startTime + k * spb;
        if (t >= end - 1e-6) break;
        place(t);
      }
    });
  } else {
    // Modo padrão métrico contínuo cravado na grade da timeline
    const secondsPerBeat = 60 / Math.max(30, Math.min(300, bpm));
    const kMin = Math.ceil(-downbeatOffset / secondsPerBeat);
    const kMax = Math.floor((safeDuration - downbeatOffset) / secondsPerBeat);

    for (let k = kMin; k <= kMax; k++) place(downbeatOffset + k * secondsPerBeat);
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

/**
 * Som padrão do metrônomo do VS Stage em cada instante de `times` (segundos), com o começo do
 * som em cima do instante. Usado no "Recriar metrônomo": as batidas vêm do click da faixa.
 */
export async function generateClickAt(times: number[], durationSeconds: number, sampleRate = 44100): Promise<AudioBuffer> {
  const length = Math.max(1, Math.ceil(Math.max(0.05, durationSeconds) * sampleRate));
  const buffer = new AudioBuffer({ length, numberOfChannels: 2, sampleRate });
  const outL = buffer.getChannelData(0);
  const outR = buffer.getChannelData(1);
  let sampleBuf: AudioBuffer;
  try {
    sampleBuf = await loadUserSample();
  } catch {
    sampleBuf = createFallbackSample(sampleRate);
  }
  const sL = sampleBuf.getChannelData(0);
  const sR = sampleBuf.numberOfChannels > 1 ? sampleBuf.getChannelData(1) : sL;
  const onset = clickOnsetIndex(sL);
  for (const t of times) {
    const target = Math.round(t * sampleRate);
    // se a batida cai bem no começo, o som entra inteiro a partir do 0 (sem cortar o ataque)
    const start = Math.max(0, target - onset);
    for (let i = 0; i < sL.length; i++) {
      const dest = start + i;
      if (dest >= length) break;
      outL[dest] += sL[i];
      outR[dest] += sR[i];
    }
  }
  return buffer;
}
