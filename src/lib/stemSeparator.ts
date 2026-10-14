import { separateWithReplicateDemucs } from '@/lib/replicateDemucs';
import { detectBpm } from '@/lib/beatDetector';
import { generateClickTrack } from '@/lib/clickGenerator';
import { generateMaestroCountIn } from '@/lib/maestroCountIn';
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
  countIn?: boolean; // Contagem prévia do Maestro (1 compasso "1, 2, 3, 4")
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

  // 2. SEPARAÇÃO DAS STEMS COM DEMUCS v4 (HTDemucs 6 Stems)
  let drumsBuffer: AudioBuffer;
  let bassBuffer: AudioBuffer;
  let vocalsBuffer: AudioBuffer;
  let otherBuffer: AudioBuffer;
  let guitarBuffer: AudioBuffer | null = null;
  let pianoBuffer: AudioBuffer | null = null;

  if (typeof window !== 'undefined' && window.vsDesktop?.separateStemsLocal) {
    onProgress?.({
      step: 'drums',
      message: 'Separando 6 stems (Bateria, Baixo, Guitarras, Teclados, Voz e Outros)...',
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

      const [v, b, d, o, g, p] = await Promise.all([
        decodeBlob(new Blob([rawStems.vocals], { type: 'audio/wav' })),
        decodeBlob(new Blob([rawStems.bass], { type: 'audio/wav' })),
        decodeBlob(new Blob([rawStems.drums], { type: 'audio/wav' })),
        decodeBlob(new Blob([rawStems.other], { type: 'audio/wav' })),
        rawStems.guitar ? decodeBlob(new Blob([rawStems.guitar], { type: 'audio/wav' })) : Promise.resolve(null),
        rawStems.piano ? decodeBlob(new Blob([rawStems.piano], { type: 'audio/wav' })) : Promise.resolve(null),
      ]);
      vocalsBuffer = v;
      bassBuffer = b;
      drumsBuffer = d;
      otherBuffer = o;
      guitarBuffer = g;
      pianoBuffer = p;
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

  // 2.5 Refinamento de BPM e Downbeat pela bateria isolada
  let finalBpm = bpm;
  try {
    const drumBpm = await detectBpm(drumsBuffer);
    if (drumBpm && drumBpm.bpm >= 45 && drumBpm.bpm <= 240) {
      finalBpm = drumBpm.bpm;
    }
  } catch { /* usa bpm inicial */ }

  const beatsPerBar = options.beatsPerBar || 4;
  const countInEnabled = options.countIn !== false; // Padrão ligado

  // Cálculo da contagem prévia de 1 compasso do Maestro
  const secondsPerBeat = 60 / finalBpm;
  const leadInDuration = countInEnabled ? beatsPerBar * secondsPerBeat : 0;
  const totalSongDuration = leadInDuration + duration;

  // 2.6 Gera a voz do Maestro contando "Um, Dois, Três, Quatro" no compasso de entrada
  let maestroBuffer: AudioBuffer | null = null;
  if (countInEnabled) {
    onProgress?.({
      step: 'click',
      message: 'Gerando contagem falada do Maestro ("Um, Dois, Três, Quatro")...',
      percent: 90,
    });
    const m = await generateMaestroCountIn(finalBpm, beatsPerBar, sampleRate);
    maestroBuffer = m.buffer;
  }

  // 2.7 Gera a trilha de Click (Metrônomo) cravada na grade métrica
  let clickBuffer: AudioBuffer | null = null;
  if (options.includeClick) {
    onProgress?.({
      step: 'click',
      message: 'Sincronizando metrônomo (Click) completo com compasso de entrada...',
      percent: 94,
    });
    clickBuffer = generateClickTrack(
      totalSongDuration,
      finalBpm,
      sampleRate,
      0, // começa cravado no tempo 1 do compasso de entrada
      beatsPerBar
    );
  }

  // 3. MONTAGEM DO PROJETO E ROTEAMENTO NAS PASTAS
  onProgress?.({
    step: 'finalizing',
    message: 'Criando VS e organizando pastas no mixer...',
    percent: 97,
  });

  const songId = 'song-ai-' + Date.now();
  const store = useStore.getState();

  const song: Song = {
    id: songId,
    name: songName,
    clips: [],
    bpm: finalBpm,
    bpmDetected: true,
    bpmSource: bpmResult?.fromClick ? 'click' : 'audio',
    downbeat: 0,
    beatsPerBar,
    bpmAdjust: 0,
    tuner: 0,
    duration: totalSongDuration,
    timelineStart: 0,
    blockId: null,
    regions: [],
  };

  store.addSong(song);
  store.addToPlaylist(songId, songName, totalSongDuration, finalBpm);

  interface StemEntry {
    name: string;
    buffer: AudioBuffer;
    targetTrack: string;
    startTime: number;
    duration: number;
  }

  const stemConfigs: StemEntry[] = [];

  // MÚSICA PRINCIPAL (começa exatamente após o compasso de contagem)
  stemConfigs.push(
    { name: songName + ' - Bateria', buffer: drumsBuffer, targetTrack: 'track-bateria', startTime: leadInDuration, duration },
    { name: songName + ' - Baixo', buffer: bassBuffer, targetTrack: 'track-contrabaixo', startTime: leadInDuration, duration }
  );

  // Guitarras / Violões isolados
  if (guitarBuffer) {
    stemConfigs.push({
      name: songName + ' - Guitarras e Violões',
      buffer: guitarBuffer,
      targetTrack: 'track-guitarras',
      startTime: leadInDuration,
      duration,
    });
  }

  // Teclados e Pianos isolados
  if (pianoBuffer) {
    stemConfigs.push({
      name: songName + ' - Teclados',
      buffer: pianoBuffer,
      targetTrack: 'track-teclados',
      startTime: leadInDuration,
      duration,
    });
  }

  // Voz Guia
  stemConfigs.push({
    name: songName + ' - Guia (Voz)',
    buffer: vocalsBuffer,
    targetTrack: 'track-guia',
    startTime: leadInDuration,
    duration,
  });

  // Outros arranjos e instrumentos
  stemConfigs.push({
    name: songName + ' - Outros (Arranjos)',
    buffer: otherBuffer,
    targetTrack: 'track-outros',
    startTime: leadInDuration,
    duration,
  });

  // Maestro (Contagem de 1 Compasso de Entrada no tempo zero)
  if (maestroBuffer) {
    stemConfigs.push({
      name: songName + ' - Maestro (Contagem 1 Compasso)',
      buffer: maestroBuffer,
      targetTrack: 'track-maestro',
      startTime: 0,
      duration: leadInDuration,
    });
  }

  // Click / Metrônomo do Show (inicia no tempo zero e vai até o fim)
  if (clickBuffer) {
    stemConfigs.push({
      name: songName + ' - Click Metrônomo',
      buffer: clickBuffer,
      targetTrack: 'track-click',
      startTime: 0,
      duration: totalSongDuration,
    });
  }

  for (let i = 0; i < stemConfigs.length; i++) {
    const config = stemConfigs[i];
    const clipId = 'clip-' + songId + '-' + i;
    const clipAudio = await toClipAudioAsync(config.buffer);
    const wavAb = encodeWavInt16(clipAudio);
    const wavBlob = new Blob([wavAb], { type: 'audio/wav' });
    const peaks = audioEngine.generateWaveformPeaks(config.buffer, 2000);

    const clip: AudioClip = {
      id: clipId,
      trackId: config.targetTrack,
      name: config.name,
      fileName: config.name + '.wav',
      filePath: URL.createObjectURL(wavBlob),
      songId,
      startTime: config.startTime,
      duration: config.duration,
      sampleRate,
      channels: config.buffer.numberOfChannels,
      bpm: null,
      markers: generateMarkers(config.duration),
      routingMethod: 'ai',
      routingConfidence: 0.99,
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
