import { COUNT_VOICES_B64 } from '@/lib/maestroVoiceData';
import { decodeBlob } from '@/lib/audioDecoder';

function b64ToBlob(b64: string): Blob {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: 'audio/wav' });
}

let cachedVoiceBuffers: Record<string, AudioBuffer> | null = null;

async function loadVoiceBuffers(): Promise<Record<string, AudioBuffer>> {
  if (cachedVoiceBuffers) return cachedVoiceBuffers;
  const names = ['um', 'dois', 'tres', 'quatro', 'cinco', 'seis'];
  const map: Record<string, AudioBuffer> = {};
  await Promise.all(
    names.map(async (name) => {
      const b64 = COUNT_VOICES_B64[name];
      if (b64) {
        const blob = b64ToBlob(b64);
        map[name] = await decodeBlob(blob);
      }
    })
  );
  cachedVoiceBuffers = map;
  return map;
}

/**
 * Gera a trilha do Maestro com contagem falada em português ("Um, Dois, Três, Quatro")
 * para exatamente 1 compasso antes da música começar.
 */
export async function generateMaestroCountIn(
  bpm: number,
  beatsPerBar = 4,
  sampleRate = 44100
): Promise<{ buffer: AudioBuffer; barDuration: number }> {
  const voices = await loadVoiceBuffers();
  const secondsPerBeat = 60 / Math.max(30, Math.min(300, bpm));
  const barDuration = beatsPerBar * secondsPerBeat;
  const totalLength = Math.ceil(barDuration * sampleRate);

  const buffer = new AudioBuffer({ length: totalLength, numberOfChannels: 2, sampleRate });
  const outL = buffer.getChannelData(0);
  const outR = buffer.getChannelData(1);

  const beatNames: string[] =
    beatsPerBar === 3
      ? ['um', 'dois', 'tres']
      : beatsPerBar === 6
        ? ['um', 'dois', 'tres', 'quatro', 'cinco', 'seis']
        : ['um', 'dois', 'tres', 'quatro'];

  for (let b = 0; b < beatsPerBar; b++) {
    const voiceName = beatNames[b];
    const voiceBuf = voices[voiceName];
    if (!voiceBuf) continue;

    const startSec = b * secondsPerBeat;
    const startSample = Math.round(startSec * sampleRate);

    const vL = voiceBuf.getChannelData(0);
    const vR = voiceBuf.numberOfChannels > 1 ? voiceBuf.getChannelData(1) : vL;
    const vLen = voiceBuf.length;

    for (let i = 0; i < vLen && startSample + i < totalLength; i++) {
      outL[startSample + i] += vL[i] * 0.9;
      outR[startSample + i] += vR[i] * 0.9;
    }
  }

  return { buffer, barDuration };
}
