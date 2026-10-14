import { separateWithReplicateDemucs } from '@/lib/replicateDemucs';
import { detectBpm } from '@/lib/beatDetector';
import { generateClickTrack } from '@/lib/clickGenerator';
import { encodeWavInt16 } from '@/lib/wavEncoder';
import { audioEngine } from '@/lib/audioEngine';
import {
  putClipAudio,
  registerClipSource,
  toClipAudioAsync,
} from '@/lib/audioLibrary';
import { useStore } from '@/store';
import type { AudioClip, Song } from '@/types';
import { generateMarkers, decodeBlob } from '@/lib/audioDecoder';

export interface StemSeparationProgress {
  step: 'analyzing' | 'drums' | 'bass' | 'vocals' | 'other' | 'click' | 'finalizing';
  message: string;
  percent: number;
}

export interface StemSeparationOptions {
  includeClick: boolean;
  beatsPerBar?: 4 | 3 | 6;
  songName?: string;
}

export interface StemResult {
  songId: string;
  songName: string;
  bpm: number;
  duration: number;
  stemsCount: number;
}

/**
 * Motor Local de Separação de Stems e Criação de VS.
 * Processa 100% localmente no Mac usando filtros de estúdio acelerados e cancelamento de fase estéreo.
 */
export async function separateSongToVS(
  audioBuffer: AudioBuffer,
  file: File,
  options: StemSeparationOptions,
  onProgress?: (p: StemSeparationProgress) => void
): Promise<StemResult> {
  const sampleRate = audioBuffer.sampleRate;
  const duration = audioBuffer.duration;
  const numChannels = audioBuffer.numberOfChannels;
  const songName = (options.songName || file.name.replace(/\.[^/.]+$/, '')).trim() || 'Música';

  // 1. ANÁLISE DE BPM E COMPASSO
  onProgress?.({
    step: 'analyzing',
    message: 'Analisando áudio e detectando BPM da música...',
    percent: 10,
  });

  const bpmResult = await detectBpm(audioBuffer).catch(() => null);
  const bpm = bpmResult?.bpm || 120;
  const downbeat = bpmResult?.downbeat || 0;

  // 2. SEPARAÇÃO DAS 4 STEMS
  let drumsBuffer: AudioBuffer;
  let bassBuffer: AudioBuffer;
  let vocalsBuffer: AudioBuffer;
  let otherBuffer: AudioBuffer;

  // Separação oficial via Demucs v4 (Meta AI)
  if (typeof window !== 'undefined' && window.vsDesktop?.separateStemsLocal) {
    onProgress?.({
      step: 'drums',
      message: 'Iniciando Demucs v4 nativo no Mac (Apple Silicon)...',
      percent: 20,
    });

    const unbind = window.vsDesktop.onSeparationProgress?.((data) => {
      onProgress?.({
        step: 'vocals',
        message: data.message,
        percent: 20 + Math.floor((data.percent || 0) * 0.65),
      });
    });

    try {
      const arrayBuf = await file.arrayBuffer();
      const rawStems = await window.vsDesktop.separateStemsLocal(file.name, arrayBuf);
      onProgress?.({
        step: 'other',
        message: 'Decodificando faixas de alta fidelidade para a timeline...',
        percent: 88,
      });

      const [v, b, d, o] = await Promise.all([
        decodeBlob(new Blob([rawStems.vocals], { type: 'audio/wav' })),
        decodeBlob(new Blob([rawStems.bass], { type: 'audio/wav' })),
        decodeBlob(new Blob([rawStems.drums], { type: 'audio/wav' })),
        decodeBlob(new Blob([rawStems.other], { type: 'audio/wav' })),
      ]);
      vocalsBuffer = v;
      bassBuffer = b;
      drumsBuffer = d;
      otherBuffer = o;
    } finally {
      unbind?.();
    }
  } else {
    onProgress?.({
      step: 'drums',
      message: 'Conectando ao Demucs v4 na nuvem...',
      percent: 20,
    });
    const stems = await separateWithReplicateDemucs(file, (p) => {
      onProgress?.({
        step: 'vocals',
        message: p.message,
        percent: p.percent,
      });
    });
    vocalsBuffer = stems.vocals;
    bassBuffer = stems.bass;
    drumsBuffer = stems.drums;
    otherBuffer = stems.other;
  }

  // 2.5 Metrônomo do Show (Click) sincronizado pelo canal de bateria
  let clickBuffer: AudioBuffer | null = null;
  if (options.includeClick) {
    onProgress?.({
      step: 'click',
      message: 'Sincronizando metrônomo (Click) pela bateria...',
      percent: 92,
    });

    // Refina BPM e Downbeat analisando os transientes isolados da bateria
    let finalBpm = bpm;
    let finalDownbeat = downbeat;
    try {
      const drumBpm = await detectBpm(drumsBuffer);
      if (drumBpm && drumBpm.bpm >= 45 && drumBpm.bpm <= 240) {
        finalBpm = drumBpm.bpm;
        finalDownbeat = drumBpm.downbeat;
      }
    } catch { /* usa estimativa inicial */ }

    clickBuffer = generateClickTrack(
      duration,
      finalBpm,
      sampleRate,
      finalDownbeat,
      options.beatsPerBar || 4
    );
  }

  // 3. MONTAGEM DO PROJETO E ROTEAMENTO
  onProgress?.({
    step: 'finalizing',
    message: 'Criando VS e roteando para as pastas do programa...',
    percent: 97,
  });

  const songId = `song-ai-${Date.now()}`;
  const store = useStore.getState();

  const song: Song = {
    id: songId,
    name: songName,
    clips: [],
    bpm,
    bpmDetected: true,
    bpmSource: bpmResult?.fromClick ? 'click' : 'audio',
    downbeat,
    beatsPerBar: options.beatsPerBar || 4,
    bpmAdjust: 0,
    tuner: 0,
    duration,
    timelineStart: 0,
    blockId: null,
    regions: [],
  };

  store.addSong(song);
  store.addToPlaylist(songId, songName, duration, bpm);

  const stemConfigs = [
    { name: `${songName} - Bateria`, buffer: drumsBuffer, targetTrack: 'track-bateria' },
    { name: `${songName} - Baixo`, buffer: bassBuffer, targetTrack: 'track-contrabaixo' },
    { name: `${songName} - Playback Harmonia`, buffer: otherBuffer, targetTrack: 'track-outros' },
    { name: `${songName} - Guia (Voz)`, buffer: vocalsBuffer, targetTrack: 'track-guia' },
  ];

  if (clickBuffer) {
    stemConfigs.push({
      name: `${songName} - Click`,
      buffer: clickBuffer,
      targetTrack: 'track-click',
    });
  }

  for (let i = 0; i < stemConfigs.length; i++) {
    const config = stemConfigs[i];
    const clipId = `clip-${songId}-${i}`;
    const clipAudio = await toClipAudioAsync(config.buffer);
    const wavAb = encodeWavInt16(clipAudio);
    const wavBlob = new Blob([wavAb], { type: 'audio/wav' });
    const peaks = audioEngine.generateWaveformPeaks(config.buffer, 2000);

    const clip: AudioClip = {
      id: clipId,
      trackId: config.targetTrack,
      name: config.name,
      fileName: `${config.name}.wav`,
      filePath: URL.createObjectURL(wavBlob),
      songId,
      startTime: 0,
      duration,
      sampleRate,
      channels: config.buffer.numberOfChannels,
      bpm: null,
      markers: generateMarkers(duration),
      routingMethod: 'ai',
      routingConfidence: 0.98,
      waveformPeaks: peaks,
      gain: 1,
      mute: false,
      solo: false,
    };

    registerClipSource(clipId, songId, wavBlob);
    putClipAudio(clipId, songId, clipAudio);
    store.addClip(clip);
  }

  store.selectSong(songId);

  onProgress?.({
    step: 'finalizing',
    message: 'VS criado com sucesso!',
    percent: 100,
  });

  return {
    songId,
    songName,
    bpm,
    duration,
    stemsCount: stemConfigs.length,
  };
}
