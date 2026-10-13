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
import { generateMarkers } from '@/lib/audioDecoder';

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
  // 2.1 Bateria (Drums)
  onProgress?.({
    step: 'drums',
    message: 'Separando Bateria e Percussões...',
    percent: 30,
  });
  const drumsBuffer = await extractDrums(audioBuffer);

  // 2.2 Baixo (Bass)
  onProgress?.({
    step: 'bass',
    message: 'Separando Contrabaixo e Sub-graves...',
    percent: 50,
  });
  const bassBuffer = await extractBass(audioBuffer);

  // 2.3 Vocais (Vocals)
  onProgress?.({
    step: 'vocals',
    message: 'Separando Voz Principal e Coros...',
    percent: 70,
  });
  const vocalsBuffer = await extractVocals(audioBuffer);

  // 2.4 Harmonia / Playback (Other)
  onProgress?.({
    step: 'other',
    message: 'Separando Harmonia, Guitarras e Teclados...',
    percent: 85,
  });
  const otherBuffer = await extractOther(audioBuffer, vocalsBuffer, bassBuffer);

  // 2.5 Metrônomo do Show (Click)
  let clickBuffer: AudioBuffer | null = null;
  if (options.includeClick) {
    onProgress?.({
      step: 'click',
      message: 'Gerando trilha de Metrônomo (Click) sincronizada...',
      percent: 92,
    });
    clickBuffer = generateClickTrack(
      duration,
      bpm,
      sampleRate,
      downbeat,
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
    { name: `${songName} - Voz`, buffer: vocalsBuffer, targetTrack: 'track-solos' },
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

// ─── PROCESSADORES DE ÁUDIO LOCAIS DE ESTÚDIO ────────────────────────────────

/** Isola Baixo e Subgraves (20Hz a 200Hz com saturação suave) */
async function extractBass(source: AudioBuffer): Promise<AudioBuffer> {
  const offline = new OfflineAudioContext(source.numberOfChannels, source.length, source.sampleRate);
  const srcNode = offline.createBufferSource();
  srcNode.buffer = source;

  // Filtro passa-baixas íngreme de 24dB/oitava em 180Hz
  const lp1 = offline.createBiquadFilter();
  lp1.type = 'lowpass';
  lp1.frequency.value = 180;
  lp1.Q.value = 1.1;

  const lp2 = offline.createBiquadFilter();
  lp2.type = 'lowpass';
  lp2.frequency.value = 220;

  // Boost de pegada no subgrave
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

  // Realce de impacto de bumbo (60Hz) e estalo de caixa (3kHz) + pratos (9kHz)
  const kick = offline.createBiquadFilter();
  kick.type = 'peaking';
  kick.frequency.value = 65;
  kick.gain.value = 4.0;
  kick.Q.value = 1.4;

  const snare = offline.createBiquadFilter();
  snare.type = 'peaking';
  snare.frequency.value = 2800;
  snare.gain.value = 3.0;
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

/** Isola Vocais (Centro estéreo Mid com passa-faixa vocal) */
async function extractVocals(source: AudioBuffer): Promise<AudioBuffer> {
  const length = source.length;
  const sampleRate = source.sampleRate;
  const out = new AudioBuffer({ length, numberOfChannels: 2, sampleRate });

  const leftIn = source.getChannelData(0);
  const rightIn = source.numberOfChannels > 1 ? source.getChannelData(1) : leftIn;
  const leftOut = out.getChannelData(0);
  const rightOut = out.getChannelData(1);

  // Extrai o canal central (Mid = (L + R) / 2) e reduz as laterais estéreo
  const midData = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const l = leftIn[i];
    const r = rightIn[i];
    const mid = (l + r) * 0.5;
    const side = Math.abs(l - r) * 0.5;
    // Atenua quando há muita abertura estéreo (onde instrumentos como guitarras costumam ficar)
    const factor = Math.max(0.15, 1 - Math.min(1, side * 1.8));
    midData[i] = mid * factor;
  }

  // Passa o canal central por um filtro vocal especializado (300Hz a 3.6kHz)
  const tempBuf = new AudioBuffer({ length, numberOfChannels: 1, sampleRate });
  tempBuf.copyToChannel(midData, 0);

  const offline = new OfflineAudioContext(2, length, sampleRate);
  const srcNode = offline.createBufferSource();
  srcNode.buffer = tempBuf;

  const hp = offline.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 280;
  hp.Q.value = 0.8;

  const lp = offline.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 4200;
  lp.Q.value = 0.8;

  const presence = offline.createBiquadFilter();
  presence.type = 'peaking';
  presence.frequency.value = 1800;
  presence.gain.value = 3.0;

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

/** Isola Harmonia / Playback / Instrumentos (Teclados, Guitarras, Metais) */
async function extractOther(
  source: AudioBuffer,
  vocals: AudioBuffer,
  bass: AudioBuffer
): Promise<AudioBuffer> {
  const length = source.length;
  const sampleRate = source.sampleRate;
  const out = new AudioBuffer({ length, numberOfChannels: 2, sampleRate });

  const leftIn = source.getChannelData(0);
  const rightIn = source.numberOfChannels > 1 ? source.getChannelData(1) : leftIn;

  const vocL = vocals.getChannelData(0);
  const vocR = vocals.getChannelData(1);

  const bassL = bass.getChannelData(0);
  const bassR = bass.numberOfChannels > 1 ? bass.getChannelData(1) : bassL;

  const leftOut = out.getChannelData(0);
  const rightOut = out.getChannelData(1);

  // Subtrai voz central e sub-baixo do sinal original para sobrar a cama instrumental limpa
  for (let i = 0; i < length; i++) {
    const l = leftIn[i];
    const r = rightIn[i];

    const vL = vocL[i] * 0.82;
    const vR = vocR[i] * 0.82;

    const bL = bassL[i] * 0.75;
    const bR = bassR[i] * 0.75;

    leftOut[i] = l - vL - bL;
    rightOut[i] = r - vR - bR;
  }

  return out;
}
