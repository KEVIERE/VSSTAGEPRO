import { separateWithReplicateDemucs } from '@/lib/replicateDemucs';
import { detectBpm, detectMultiTempo, type MultiTempoResult } from '@/lib/beatDetector';
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

  // 2.5 Refinamento do BPM, Downbeat e detecção de múltiplos andamentos
  let finalBpm = bpm;
  let finalDownbeat = downbeat;
  let multiTempoResult: MultiTempoResult | null = null;
  try {
    multiTempoResult = await detectMultiTempo(drumsBuffer || audioBuffer);
    if (multiTempoResult && multiTempoResult.bpm >= 45 && multiTempoResult.bpm <= 240) {
      finalBpm = multiTempoResult.bpm;
      finalDownbeat = Math.max(0, multiTempoResult.downbeat);
    }
  } catch {
    try {
      const drumBpm = await detectBpm(drumsBuffer);
      if (drumBpm && drumBpm.bpm >= 45 && drumBpm.bpm <= 240) {
        finalBpm = drumBpm.bpm;
        finalDownbeat = Math.max(0, drumBpm.downbeat);
      }
    } catch { /* usa estimativa inicial */ }
  }

  const beatsPerBar = options.beatsPerBar || 4;
  const secondsPerBeat = 60 / finalBpm;
  const barDuration = beatsPerBar * secondsPerBeat;

  // Sincronização de Fase: O 1º compasso (0 a barDuration) é o count-in do click.
  // A música começa deslocada de modo que o seu primeiro tempo forte (downbeat) caia
  // EXATAMENTE no tempo 1 do compasso seguinte (t = barDuration).
  const safeDownbeat = finalDownbeat % barDuration;
  const leadIn = barDuration - safeDownbeat;
  const totalSongDuration = leadIn + duration;

  // 2.6 Gera a trilha de Click (Metrônomo) cravada na grade métrica (com suporte a múltiplos andamentos)
  let clickBuffer: AudioBuffer | null = null;
  if (options.includeClick) {
    onProgress?.({
      step: 'click',
      message: multiTempoResult?.isMultiTempo
        ? 'Sincronizando metrônomo adaptativo com múltiplos andamentos...'
        : 'Sincronizando metrônomo (Click) na grade com 1 compasso de entrada...',
      percent: 92,
    });

    const segments = multiTempoResult?.isMultiTempo
      ? multiTempoResult.segments.map((seg, idx) => ({
          ...seg,
          startTime: idx === 0 ? 0 : seg.startTime + leadIn,
          endTime: seg.endTime + leadIn,
        }))
      : undefined;

    clickBuffer = await generateClickTrack(
      totalSongDuration,
      finalBpm,
      sampleRate,
      0,
      beatsPerBar,
      segments
    );
  }

  // 3. MONTAGEM DO PROJETO E ROTEAMENTO OFICIAL
  onProgress?.({
    step: 'finalizing',
    message: 'Roteando stems para as pastas oficiais do programa...',
    percent: 96,
  });

  const songId = 'song-ai-' + Date.now();
  const store = useStore.getState();

  const song: Song = {
    id: songId,
    name: songName,
    clips: [],
    bpm: finalBpm,
    bpmDetected: true,
    bpmSource: 'audio',
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
    childName: string;
    buffer: AudioBuffer;
    parentTrackId: string;
    startTime: number;
    duration: number;
  }

  const stemConfigs: StemEntry[] = [
    {
      name: songName + ' - Bateria',
      childName: 'Bateria',
      buffer: drumsBuffer,
      parentTrackId: 'track-bateria',
      startTime: leadIn,
      duration,
    },
    {
      name: songName + ' - Baixo',
      childName: 'Baixo',
      buffer: bassBuffer,
      parentTrackId: 'track-contrabaixo',
      startTime: leadIn,
      duration,
    },
  ];

  if (guitarBuffer) {
    stemConfigs.push({
      name: songName + ' - Guitarras e Violões',
      childName: 'Guitarras',
      buffer: guitarBuffer,
      parentTrackId: 'track-guitarras',
      startTime: leadIn,
      duration,
    });
  }

  if (pianoBuffer) {
    stemConfigs.push({
      name: songName + ' - Teclados',
      childName: 'Teclados',
      buffer: pianoBuffer,
      parentTrackId: 'track-teclados',
      startTime: leadIn,
      duration,
    });
  }

  stemConfigs.push({
    name: songName + ' - Guia (Voz)',
    childName: 'Guia',
    buffer: vocalsBuffer,
    parentTrackId: 'track-guia',
    startTime: leadIn,
    duration,
  });

  stemConfigs.push({
    name: songName + ' - Outros',
    childName: 'Outros',
    buffer: otherBuffer,
    parentTrackId: 'track-outros',
    startTime: leadIn,
    duration,
  });

  if (clickBuffer) {
    stemConfigs.push({
      name: songName + ' - Click Metrônomo',
      childName: 'Click',
      buffer: clickBuffer,
      parentTrackId: 'track-click',
      startTime: 0,
      duration: totalSongDuration,
    });
  }

  for (let i = 0; i < stemConfigs.length; i++) {
    const config = stemConfigs[i];
    const parentId = config.parentTrackId;

    // Roteamento padrão oficial do VS Stage Pro:
    // Trilhas raiz (Click, Guia, Maestro) recebem o clipe direto.
    // Subgrupos (Bateria, Contrabaixo, Guitarras, Teclados, Outros) usam/criam a faixa filha.
    let actualTrackId: string;
    if (parentId === 'track-guia' || parentId === 'track-click' || parentId === 'track-maestro') {
      actualTrackId = parentId;
    } else {
      const existingChild = store.tracks.find((t) => t.parentId === parentId);
      if (existingChild) {
        actualTrackId = existingChild.id;
      } else {
        const childId = parentId + '-child-' + Date.now() + '-' + i;
        store.addChildTrack(parentId, config.childName, childId);
        actualTrackId = childId;
      }
    }

    const clipId = 'clip-' + songId + '-' + i;
    const clipAudio = await toClipAudioAsync(config.buffer);
    const wavAb = encodeWavInt16(clipAudio);
    const wavBlob = new Blob([wavAb], { type: 'audio/wav' });
    const peaks = audioEngine.generateWaveformPeaks(config.buffer, 2000);

    const clip: AudioClip = {
      id: clipId,
      trackId: actualTrackId,
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
      routingConfidence: 1,
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
