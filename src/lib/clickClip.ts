import { audioEngine } from '@/lib/audioEngine';
import { deviceSampleRate, generateMarkers } from '@/lib/audioDecoder';
import { putClipAudio, registerClipSource, toClipAudioAsync } from '@/lib/audioLibrary';
import { generateClickAt } from '@/lib/clickGenerator';
import { CLICK_TRACK_ID, clickGridTimes } from '@/lib/clickEdit';
import { clickBeatsKey, generatedMarkOf, markGeneratedClick, type ClickClip } from '@/lib/clickFollow';
import { DEFAULT_CLICK_SOUND } from '@/lib/clickSounds';
import { encodeWavPcm24 } from '@/lib/wavEncoder';
import type { AudioClip, Song } from '@/types';

// Caminho único do click do VS Stage: o VS por IA e os comandos da faixa Click (Recriar
// metrônomo, compasso antes do início) geram o som com generateClickAt e montam o clipe aqui.
// Fica fora do clickTools para o stemSeparator usar sem importar o clipStemSplit (que importa
// o stemSeparator).

/** Transforma o áudio num clipe de click pronto (WAV, picos, áudio guardado). */
export async function makeClickClip(song: Song, buffer: AudioBuffer, startTime: number, base?: AudioClip): Promise<AudioClip> {
  const id = `clip-${song.id}-click-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const name = base?.name ?? `${song.name} - Click`;
  const wavBlob = new Blob([encodeWavPcm24(buffer)], { type: 'audio/wav' });
  const peaks = audioEngine.generateWaveformPeaks(buffer, Math.min(24000, Math.max(8000, Math.round(buffer.duration * 100))));
  registerClipSource(id, song.id, wavBlob);
  putClipAudio(id, song.id, await toClipAudioAsync(buffer));
  // sem marca nova, herda a do clipe de origem (compasso antes do início de um click gerado)
  const generatedClick = generatedMarkOf(buffer) ?? (base as ClickClip | undefined)?.generatedClick;
  return {
    // mantém volume, mudo e fades do click que já existia
    ...(base ?? {
      songId: song.id, bpm: null, routingMethod: 'ai', routingConfidence: 1, gain: 1, mute: false, solo: false,
    } as Partial<AudioClip>),
    id,
    trackId: CLICK_TRACK_ID,
    name,
    fileName: `${name}.wav`,
    filePath: URL.createObjectURL(wavBlob),
    songId: song.id,
    startTime,
    duration: buffer.duration,
    trimStart: 0,
    trimEnd: 0,
    sampleRate: buffer.sampleRate,
    channels: buffer.numberOfChannels,
    markers: generateMarkers(buffer.duration),
    waveformPeaks: peaks,
    groupId: undefined,
    ...(generatedClick ? { generatedClick } : {}),
  } as AudioClip;
}

/**
 * Click na grade da música, do 0 até `durationSeconds`, na taxa do aparelho (a mesma do Recriar
 * metrônomo, que passa o áudio por toDeviceRate). Cada batida cai numa linha da grade da timeline.
 */
export async function gridClickBuffer(song: Pick<Song, 'bpm' | 'beatsPerBar' | 'tempoSegments'>, durationSeconds: number): Promise<AudioBuffer> {
  const buffer = await generateClickAt(clickGridTimes(song, durationSeconds), durationSeconds, deviceSampleRate());
  markGeneratedClick(buffer, {
    sound: DEFAULT_CLICK_SOUND,
    beats: clickBeatsKey(song, { startTime: 0, duration: buffer.duration, trimStart: 0, trimEnd: 0 }),
  });
  return buffer;
}
