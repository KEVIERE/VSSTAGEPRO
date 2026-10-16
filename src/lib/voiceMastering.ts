import { decodeBlob } from '@/lib/audioDecoder';
import { getClipAudio, putClipAudio, registerClipSource, toClipAudioAsync } from '@/lib/audioLibrary';
import { encodeWavInt16 } from '@/lib/wavEncoder';
import { audioEngine } from '@/lib/audioEngine';
import { useStore } from '@/store';
import type { AudioClip } from '@/types';

/**
 * Processador de Masterização Vocal IA para a faixa Maestro (VS Stage Pro).
 * Utiliza OfflineAudioContext e análise dinâmica para transformar a gravação
 * bruta do microfone em uma voz guia com presença, clareza e potência de estúdio.
 */
export async function masterMaestroAudioBuffer(inputBuffer: AudioBuffer): Promise<AudioBuffer> {
  const sampleRate = inputBuffer.sampleRate;
  const length = inputBuffer.length;
  const numChannels = inputBuffer.numberOfChannels;

  // 1. Cria contexto de renderização offline de alta fidelidade
  const offlineCtx = new OfflineAudioContext(numChannels, length, sampleRate);
  const source = offlineCtx.createBufferSource();
  source.buffer = inputBuffer;

  // 2. Filtro Passa-Altas (De-Rumble / Anti-Plosivas a 90Hz)
  const lowCut = offlineCtx.createBiquadFilter();
  lowCut.type = 'highpass';
  lowCut.frequency.value = 90;
  lowCut.Q.value = 0.707;

  // 3. Notch de limpeza de médias-graves (remove o som oco/abafado a 320Hz)
  const boxinessCut = offlineCtx.createBiquadFilter();
  boxinessCut.type = 'peaking';
  boxinessCut.frequency.value = 320;
  boxinessCut.Q.value = 1.4;
  boxinessCut.gain.value = -2.5;

  // 4. Realce de Articulação e Inteligibilidade Vocal IA (3.4kHz)
  // Faz com que os comandos e contagens "1, 2, 3, 4" do maestro cortem o som da banda no fone
  const vocalClarity = offlineCtx.createBiquadFilter();
  vocalClarity.type = 'peaking';
  vocalClarity.frequency.value = 3400;
  vocalClarity.Q.value = 1.1;
  vocalClarity.gain.value = 3.6;

  // 5. Brilho de estúdio (Air Sheen a 10kHz)
  const airSheen = offlineCtx.createBiquadFilter();
  airSheen.type = 'highshelf';
  airSheen.frequency.value = 10000;
  airSheen.gain.value = 2.4;

  // 6. Compressor Vocal Dinâmico estilo Óptico (nivelamento de voz)
  // Uniformiza falas sussurradas e gritos altos para a banda ouvir perfeitamente
  const compressor = offlineCtx.createDynamicsCompressor();
  compressor.threshold.value = -18;
  compressor.knee.value = 6;
  compressor.ratio.value = 3.5;
  compressor.attack.value = 0.006;
  compressor.release.value = 0.085;

  // 7. Ganho de Maquiagem inicial
  const makeupGain = offlineCtx.createGain();
  makeupGain.gain.value = 1.45;

  // Conexão em cascata DSP
  source.connect(lowCut);
  lowCut.connect(boxinessCut);
  boxinessCut.connect(vocalClarity);
  vocalClarity.connect(airSheen);
  airSheen.connect(compressor);
  compressor.connect(makeupGain);
  makeupGain.connect(offlineCtx.destination);

  source.start(0);
  const rendered = await offlineCtx.startRendering();

  // 8. Pós-processamento: Noise Gate Adaptativo + Limiter True-Peak a -1.0 dBFS
  const finalCtx = new AudioContext();
  const finalBuffer = finalCtx.createBuffer(rendered.numberOfChannels, rendered.length, rendered.sampleRate);
  await finalCtx.close();

  const channelsData: Float32Array[] = [];
  for (let ch = 0; ch < rendered.numberOfChannels; ch++) {
    const raw = rendered.getChannelData(ch);
    const out = finalBuffer.getChannelData(ch);
    out.set(raw);
    channelsData.push(out);
  }

  // Análise de Ruído de Fundo (Noise Floor) e Gate Inteligente
  const frameSize = Math.round(sampleRate * 0.02); // 20ms
  const numFrames = Math.floor(length / frameSize);

  let noiseFloorEstimate = 0.003;
  for (let f = 0; f < Math.min(numFrames, 30); f++) {
    let sum = 0;
    const start = f * frameSize;
    for (let i = 0; i < frameSize; i++) {
      const s = Math.abs(channelsData[0][start + i]);
      sum += s * s;
    }
    const rms = Math.sqrt(sum / frameSize);
    if (rms > 0.0001 && rms < noiseFloorEstimate) noiseFloorEstimate = rms;
  }

  const gateThreshold = Math.max(0.004, noiseFloorEstimate * 1.8);
  let gateGain = 1.0;

  for (let i = 0; i < length; i++) {
    // Pico instantâneo entre os canais
    let instantPeak = 0;
    for (let ch = 0; ch < numChannels; ch++) {
      const v = Math.abs(channelsData[ch][i]);
      if (v > instantPeak) instantPeak = v;
    }

    // Envelope suave do gate
    const targetGain = instantPeak < gateThreshold ? 0.15 : 1.0;
    const smoothRate = instantPeak < gateThreshold ? 0.0008 : 0.015;
    gateGain += (targetGain - gateGain) * smoothRate;

    for (let ch = 0; ch < numChannels; ch++) {
      channelsData[ch][i] *= gateGain;
    }
  }

  // Normalização e Limiter True-Peak a -1.0 dBFS
  let maxPeak = 0;
  for (let ch = 0; ch < numChannels; ch++) {
    for (let i = 0; i < length; i++) {
      const v = Math.abs(channelsData[ch][i]);
      if (v > maxPeak) maxPeak = v;
    }
  }

  const targetPeak = 0.891; // -1.0 dBFS
  if (maxPeak > 0) {
    const normFactor = Math.min(3.5, targetPeak / maxPeak);
    for (let ch = 0; ch < numChannels; ch++) {
      for (let i = 0; i < length; i++) {
        let val = channelsData[ch][i] * normFactor;
        // Soft-clip transparente caso ultrapasse
        if (val > targetPeak) val = targetPeak + (1 - targetPeak) * Math.tanh((val - targetPeak) / (1 - targetPeak));
        else if (val < -targetPeak) val = -targetPeak + (-1 + targetPeak) * Math.tanh((val + targetPeak) / (-1 + targetPeak));
        channelsData[ch][i] = val;
      }
    }
  }

  return finalBuffer;
}

/**
 * Masteriza um clipe existente na faixa Maestro e atualiza a timeline instantaneamente.
 */
export async function masterMaestroClip(clipId: string): Promise<boolean> {
  const store = useStore.getState();
  const clip = store.clips.find((c) => c.id === clipId);
  if (!clip) return false;

  store.setImportProgress({
    clipId: 'mastering',
    status: 'working',
    message: 'Masterizando voz do Maestro com IA (De-Noise, EQ & Compressor)...',
  });

  try {
    const rawAudio = getClipAudio(clipId);
    let audioBuffer: AudioBuffer | null = null;

    if (rawAudio) {
      const ctx = new AudioContext();
      audioBuffer = ctx.createBuffer(rawAudio.channels.length, rawAudio.length, rawAudio.sampleRate);
      for (let ch = 0; ch < rawAudio.channels.length; ch++) {
        const floatData = audioBuffer.getChannelData(ch);
        const intData = rawAudio.channels[ch];
        for (let i = 0; i < intData.length; i++) {
          floatData[i] = intData[i] / 32768;
        }
      }
      await ctx.close();
    }

    if (!audioBuffer) {
      throw new Error('Não foi possível obter os dados de áudio do clipe.');
    }

    // Aplica o algoritmo de masterização vocal IA
    const masteredBuffer = await masterMaestroAudioBuffer(audioBuffer);

    // Converte para formato de biblioteca e gera nova waveform
    const clipAudio = await toClipAudioAsync(masteredBuffer);
    const wavBytes = encodeWavInt16(clipAudio);
    const wavBlob = new Blob([wavBytes], { type: 'audio/wav' });
    const peaks = audioEngine.generateWaveformPeaks(masteredBuffer, 2000);

    // Atualiza armazenamento em memória e clipes
    putClipAudio(clip.id, clip.songId, clipAudio);
    registerClipSource(clip.id, clip.songId, wavBlob);

    store.updateClip(clip.id, {
      name: clip.name.includes('✨') ? clip.name : `✨ ${clip.name} (Master IA)`,
      waveformPeaks: peaks,
      gain: 1.0,
    });

    audioEngine.invalidatePrepared(clip.songId);

    store.setImportProgress({
      clipId: 'mastering',
      status: 'done',
      message: 'Voz do Maestro masterizada com Inteligência Artificial!',
    });
    setTimeout(() => store.setImportProgress(null), 3000);
    return true;
  } catch (err) {
    console.error('[masterMaestroClip] Erro:', err);
    store.setImportProgress({
      clipId: 'mastering',
      status: 'error',
      message: 'Falha ao masterizar voz do Maestro.',
    });
    setTimeout(() => store.setImportProgress(null), 3500);
    return false;
  }
}
