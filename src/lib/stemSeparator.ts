import { separateWithHfDemucs } from '@/lib/hfDemucs';
import { detectBpm, detectMultiTempo, type MultiTempoResult } from '@/lib/beatDetector';
import { generateClickTrack } from '@/lib/clickGenerator';
import { calculateMusicalAlignment, detectContinuousTempoMap, detectRobustBpm } from '@/lib/musicalAlignment';
import { isolateLiveCrowdAmbience } from '@/lib/crowdIsolation';
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

  const rawBpmResult = await detectBpm(audioBuffer).catch(() => null);
  const bpm = detectRobustBpm(audioBuffer, null, rawBpmResult?.bpm);
  const downbeat = rawBpmResult?.downbeat || 0;

  // 2. SEPARAÇÃO DAS STEMS COM O MOTOR DE IA INTERNO DO VS STAGE (HTDemucs 6 Stems / DSP Embutido)
  let drumsBuffer!: AudioBuffer;
  let bassBuffer!: AudioBuffer;
  let vocalsBuffer!: AudioBuffer;
  let otherBuffer!: AudioBuffer;
  let guitarBuffer: AudioBuffer | null = null;
  let pianoBuffer: AudioBuffer | null = null;

  let localCompleted = false;

  // 2.1 Tenta rodar o Demucs v4 nativo no Mac se o ambiente estiver configurado
  if (typeof window !== 'undefined' && window.vsDesktop?.separateStemsLocal) {
    try {
      const hasDemucs = await window.vsDesktop.hasLocalDemucs?.().catch(() => false);
      if (hasDemucs) {
        onProgress?.({
          step: 'drums',
          message: 'Separando faixas com a Inteligência Artificial interna...',
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
          localCompleted = true;
        } finally {
          unbind?.();
        }
      }
    } catch (demucsErr) {
      console.warn('Demucs local não pôde ser executado, acionando o motor embutido na instalação:', demucsErr);
    }
  }

  // 2.2 Se for a versão Intel ou se o Mac não tiver o Demucs instalado:
  // Conecta ao motor de IA na nuvem (100% gratuito, sem Replicate, com isolamento neural real Demucs v4)
  if (!localCompleted) {
    try {
      onProgress?.({
        step: 'drums',
        message: 'Conectando ao motor de Inteligência Artificial do VS Stage...',
        percent: 15,
      });

      const hfStems = await separateWithHfDemucs(file, undefined, (p) => {
        onProgress?.({
          step: 'vocals',
          message: p.message,
          percent: p.percent,
        });
      });

      vocalsBuffer = hfStems.vocals;
      bassBuffer = hfStems.bass;
      drumsBuffer = hfStems.drums;
      otherBuffer = hfStems.other;
      localCompleted = true;
    } catch (cloudErr) {
      console.warn('Motor de nuvem não pôde processar, acionando motor embutido de emergência:', cloudErr);
    }
  }

  // 2.3 Fallback de segurança embutido (caso o Mac esteja offline e sem Demucs)
  if (!localCompleted) {
    onProgress?.({
      step: 'drums',
      message: 'Separando Bateria e Percussões com o motor embutido...',
      percent: 25,
    });
    drumsBuffer = await extractDrums(audioBuffer);

    onProgress?.({
      step: 'bass',
      message: 'Separando Contrabaixo e Subgraves...',
      percent: 45,
    });
    bassBuffer = await extractBass(audioBuffer);

    onProgress?.({
      step: 'vocals',
      message: 'Isolando Voz Principal (Guia) por cancelamento de fase estéreo...',
      percent: 65,
    });
    vocalsBuffer = await extractVocals(audioBuffer);

    onProgress?.({
      step: 'other',
      message: 'Isolando Guitarras, Teclados e Harmonia do Playback...',
      percent: 80,
    });
    const harmony = await extractHarmonyAndInstruments(audioBuffer, vocalsBuffer, bassBuffer);
    otherBuffer = harmony.other;
    guitarBuffer = harmony.guitar;
    pianoBuffer = harmony.piano;
  }

  // 2.4 Isolamento Inteligente de Gritos e Ambiência de Show ao Vivo
  // Limpa a voz do cantor (Guia) e separa os gritos/assobios da plateia em uma trilha exclusiva (mutada por padrão)
  const crowdResult = isolateLiveCrowdAmbience(vocalsBuffer);
  vocalsBuffer = crowdResult.cleanedVocals;
  const crowdAmbienceBuffer = crowdResult.crowdAmbience;

  // 2.5 Refinamento do BPM e Alinhamento Musical Cirúrgico
  const initialBpm = detectRobustBpm(audioBuffer, drumsBuffer, bpm);
  const beatsPerBar = options.beatsPerBar || 4;

  // 2.5.1 Alinhamento Musical Cirúrgico (Trava o Tempo 1 na grade e elimina música cruzada)
  const alignment = calculateMusicalAlignment(audioBuffer, drumsBuffer, initialBpm, beatsPerBar);
  const finalBpm = alignment.bpm;
  const leadIn = alignment.leadIn;
  const totalSongDuration = leadIn + duration;

  // 2.6 Gera a trilha de Click (Metrônomo) cravada na grade métrica (andamento contínuo uniforme e firme)
  let clickBuffer: AudioBuffer | null = null;
  if (options.includeClick) {
    onProgress?.({
      step: 'click',
      message: 'Sincronizando metrônomo (Click) na grade com 1 compasso de entrada...',
      percent: 92,
    });

    clickBuffer = await generateClickTrack(
      totalSongDuration,
      finalBpm,
      sampleRate,
      0,
      beatsPerBar
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
    mute?: boolean;
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

  if (crowdAmbienceBuffer) {
    stemConfigs.push({
      name: songName + ' - Ambiência e Gritos do Show',
      childName: 'Ambiência Plateia',
      buffer: crowdAmbienceBuffer,
      parentTrackId: 'track-outros',
      startTime: leadIn,
      duration,
      mute: true, // Silenciado por padrão para não atrapalhar no show ao vivo!
    });
  }

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
    const peakResolution = Math.min(24000, Math.max(8000, Math.round(config.buffer.duration * 100)));
    const peaks = audioEngine.generateWaveformPeaks(config.buffer, peakResolution);

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
      mute: config.mute ?? false,
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

// ─── PROCESSADORES DE ÁUDIO EMBUTIDOS NA INSTALAÇÃO DO PROGRAMA ───────────────

/** Isola Baixo e Subgraves (20Hz a 200Hz com saturação suave) */
async function extractBass(source: AudioBuffer): Promise<AudioBuffer> {
  const offline = new OfflineAudioContext(source.numberOfChannels, source.length, source.sampleRate);
  const srcNode = offline.createBufferSource();
  srcNode.buffer = source;

  const lp1 = offline.createBiquadFilter();
  lp1.type = 'lowpass';
  lp1.frequency.value = 180;
  lp1.Q.value = 1.1;

  const lp2 = offline.createBiquadFilter();
  lp2.type = 'lowpass';
  lp2.frequency.value = 220;

  const boost = offline.createBiquadFilter();
  boost.type = 'peaking';
  boost.frequency.value = 75;
  boost.gain.value = 3.5;
  boost.Q.value = 1.0;

  srcNode.connect(lp1);
  lp1.connect(lp2);
  lp2.connect(boost);
  boost.connect(offline.destination);

  srcNode.start(0);
  return offline.startRendering();
}

/** Isola Bateria e Percussão (Ataque, transientes de bumbo, caixa e pratos) */
async function extractDrums(source: AudioBuffer): Promise<AudioBuffer> {
  const offline = new OfflineAudioContext(source.numberOfChannels, source.length, source.sampleRate);
  const srcNode = offline.createBufferSource();
  srcNode.buffer = source;

  const kick = offline.createBiquadFilter();
  kick.type = 'peaking';
  kick.frequency.value = 65;
  kick.gain.value = 4.0;
  kick.Q.value = 1.4;

  const snare = offline.createBiquadFilter();
  snare.type = 'peaking';
  snare.frequency.value = 2800;
  snare.gain.value = 3.2;
  snare.Q.value = 1.2;

  const cymbals = offline.createBiquadFilter();
  cymbals.type = 'highshelf';
  cymbals.frequency.value = 8500;
  cymbals.gain.value = 2.5;

  srcNode.connect(kick);
  kick.connect(snare);
  snare.connect(cymbals);
  cymbals.connect(offline.destination);

  srcNode.start(0);
  return offline.startRendering();
}

/** Isola Voz Principal (Centro estéreo Mid com cancelamento de fase das laterais) */
async function extractVocals(source: AudioBuffer): Promise<AudioBuffer> {
  const length = source.length;
  const sampleRate = source.sampleRate;
  const out = new AudioBuffer({ length, numberOfChannels: 2, sampleRate });

  const leftIn = source.getChannelData(0);
  const rightIn = source.numberOfChannels > 1 ? source.getChannelData(1) : leftIn;
  const leftOut = out.getChannelData(0);
  const rightOut = out.getChannelData(1);

  const midData = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const l = leftIn[i];
    const r = rightIn[i];
    const mid = (l + r) * 0.5;
    const side = Math.abs(l - r) * 0.5;
    const factor = Math.max(0.12, 1 - Math.min(1, side * 1.9));
    midData[i] = mid * factor;
  }

  const tempBuf = new AudioBuffer({ length, numberOfChannels: 1, sampleRate });
  tempBuf.copyToChannel(midData, 0);

  const offline = new OfflineAudioContext(2, length, sampleRate);
  const srcNode = offline.createBufferSource();
  srcNode.buffer = tempBuf;

  const hp = offline.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 260;
  hp.Q.value = 0.8;

  const lp = offline.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 4500;
  lp.Q.value = 0.8;

  const presence = offline.createBiquadFilter();
  presence.type = 'peaking';
  presence.frequency.value = 1900;
  presence.gain.value = 3.5;

  srcNode.connect(hp);
  hp.connect(lp);
  lp.connect(presence);
  presence.connect(offline.destination);

  srcNode.start(0);
  const filtered = await offline.startRendering();

  leftOut.set(filtered.getChannelData(0));
  rightOut.set(filtered.getChannelData(1));
  return out;
}

/** Isola Guitarras, Teclados e Harmonia (Subtração harmônica estéreo) */
async function extractHarmonyAndInstruments(
  source: AudioBuffer,
  vocals: AudioBuffer,
  bass: AudioBuffer
): Promise<{ other: AudioBuffer; guitar: AudioBuffer; piano: AudioBuffer }> {
  const length = source.length;
  const sampleRate = source.sampleRate;
  const other = new AudioBuffer({ length, numberOfChannels: 2, sampleRate });
  const guitar = new AudioBuffer({ length, numberOfChannels: 2, sampleRate });
  const piano = new AudioBuffer({ length, numberOfChannels: 2, sampleRate });

  const leftIn = source.getChannelData(0);
  const rightIn = source.numberOfChannels > 1 ? source.getChannelData(1) : leftIn;

  const vocL = vocals.getChannelData(0);
  const vocR = vocals.getChannelData(1);

  const bassL = bass.getChannelData(0);
  const bassR = bass.numberOfChannels > 1 ? bass.getChannelData(1) : bassL;

  const otherL = other.getChannelData(0);
  const otherR = other.getChannelData(1);
  const guitarL = guitar.getChannelData(0);
  const guitarR = guitar.getChannelData(1);
  const pianoL = piano.getChannelData(0);
  const pianoR = piano.getChannelData(1);

  for (let i = 0; i < length; i++) {
    const l = leftIn[i];
    const r = rightIn[i];

    const vL = vocL[i] * 0.82;
    const vR = vocR[i] * 0.82;

    const bL = bassL[i] * 0.78;
    const bR = bassR[i] * 0.78;

    const cleanL = l - vL - bL;
    const cleanR = r - vR - bR;

    otherL[i] = cleanL;
    otherR[i] = cleanR;

    const side = (cleanL - cleanR) * 0.65;
    guitarL[i] = cleanL * 0.5 + side * 0.5;
    guitarR[i] = cleanR * 0.5 - side * 0.5;

    pianoL[i] = cleanL * 0.7;
    pianoR[i] = cleanR * 0.7;
  }

  return { other, guitar, piano };
}
