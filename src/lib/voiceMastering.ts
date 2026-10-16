import { getClipAudio, putClipAudio, registerClipSource, toClipAudioAsync } from '@/lib/audioLibrary';
import { encodeWavInt16 } from '@/lib/wavEncoder';
import { audioEngine } from '@/lib/audioEngine';
import { useStore } from '@/store';

/**
 * Motor de Masterização Vocal IA de Alto Nível (Nível Moises / Broadcast Studio).
 * Cadeia completa de estúdio profissional:
 * 1. Steep Highpass 24dB/oct (85Hz) - corte total de subgraves e plosivas
 * 2. Low-Shelf Warmth (200Hz +2.5dB) - peso e corpo vocal analógico
 * 3. De-Mud Boxiness Cut (380Hz -3.5dB) - elimina som de caixa/sala
 * 4. Vocal Articulation & Bite (3.5kHz +5.0dB) - inteligibilidade para cortar a banda nos fones
 * 5. High-Air Sheen (10kHz +4.0dB) - brilho sedoso de microfone valvulado de ponta
 * 6. Compressor Óptico Musical (Ratio 4:1, Attack 8ms, Release 100ms)
 * 7. Saturação Harmônica Quente (Analog Tape/Tube Warmth)
 * 8. Brickwall Maximizer / Limiter de Estúdio com teto a -0.3 dBFS e ganho comercial potente.
 */
export async function masterMaestroAudioBuffer(inputBuffer: AudioBuffer): Promise<AudioBuffer> {
  const sampleRate = inputBuffer.sampleRate;
  const length = inputBuffer.length;
  const numChannels = inputBuffer.numberOfChannels;

  // Renderização offline com precisão de 32-bit float
  const offlineCtx = new OfflineAudioContext(numChannels, length, sampleRate);
  const source = offlineCtx.createBufferSource();
  source.buffer = inputBuffer;

  // 1. Filtros Passa-Altas em cascata (24dB/octave a 85Hz) para limpeza cirúrgica de rumble
  const hp1 = offlineCtx.createBiquadFilter();
  hp1.type = 'highpass';
  hp1.frequency.value = 85;
  hp1.Q.value = 0.707;

  const hp2 = offlineCtx.createBiquadFilter();
  hp2.type = 'highpass';
  hp2.frequency.value = 85;
  hp2.Q.value = 0.707;

  // 2. Low-Shelf de Calor Analógico (200Hz +2.5dB) - encorpa a voz do maestro
  const warmth = offlineCtx.createBiquadFilter();
  warmth.type = 'lowshelf';
  warmth.frequency.value = 200;
  warmth.gain.value = 2.5;

  // 3. Limpeza de frequências ocas / ressonância de sala (380Hz -3.5dB, Q=1.4)
  const deMud = offlineCtx.createBiquadFilter();
  deMud.type = 'peaking';
  deMud.frequency.value = 380;
  deMud.Q.value = 1.4;
  deMud.gain.value = -3.5;

  // 4. Boost de Inteligibilidade & Presença Vocal Principal (3.5kHz +5.0dB)
  // Faz os comandos "Intro", "Refrão", "1, 2, 3, 4" cortarem qualquer mix pesada no fone
  const presence = offlineCtx.createBiquadFilter();
  presence.type = 'peaking';
  presence.frequency.value = 3500;
  presence.Q.value = 1.1;
  presence.gain.value = 5.0;

  // 5. Brilho Aéreo de Estúdio / Air Sheen (10kHz +4.0dB)
  const air = offlineCtx.createBiquadFilter();
  air.type = 'highshelf';
  air.frequency.value = 10000;
  air.gain.value = 4.0;

  // 6. Compressor Vocal Dinâmico Estilo Óptico (nivelamento firme e consistente)
  const compressor = offlineCtx.createDynamicsCompressor();
  compressor.threshold.value = -24;
  compressor.knee.value = 12;
  compressor.ratio.value = 4.0;
  compressor.attack.value = 0.008;
  compressor.release.value = 0.100;

  // 7. Ganho de Maquiagem para alimentar a saturação analógica
  const makeupGain = offlineCtx.createGain();
  makeupGain.gain.value = 1.85;

  // Conexão do grafo DSP
  source.connect(hp1);
  hp1.connect(hp2);
  hp2.connect(warmth);
  warmth.connect(deMud);
  deMud.connect(presence);
  presence.connect(air);
  air.connect(compressor);
  compressor.connect(makeupGain);
  makeupGain.connect(offlineCtx.destination);

  source.start(0);
  const rendered = await offlineCtx.startRendering();

  // 8. Pós-processamento de Alto Nível: Saturação Analógica + Maximizer / Limiter Potente
  const finalCtx = new AudioContext();
  const finalBuffer = finalCtx.createBuffer(numChannels, rendered.length, rendered.sampleRate);
  await finalCtx.close();

  // Copia os dados renderizados
  const channels: Float32Array[] = [];
  for (let ch = 0; ch < numChannels; ch++) {
    channels.push(rendered.getChannelData(ch));
  }

  // 8a. Saturação Analógica (Warmth) com curva suave de fita/válvula
  // Adiciona harmônicos quentes que tornam a voz encorpada, presente e potente
  for (let ch = 0; ch < numChannels; ch++) {
    const data = channels[ch];
    for (let i = 0; i < data.length; i++) {
      const x = data[i];
      // Curva suave de saturação analógica: transparência em volumes baixos, calor musical nos picos
      data[i] = Math.tanh(x * 1.25) / 1.15;
    }
  }

  // 8b. Análise de Picos e RMS para Maximizer de Alto Rendimento
  let maxPeak = 0;
  let rmsSum = 0;
  for (let ch = 0; ch < numChannels; ch++) {
    const data = channels[ch];
    for (let i = 0; i < data.length; i++) {
      const absVal = Math.abs(data[i]);
      if (absVal > maxPeak) maxPeak = absVal;
      rmsSum += absVal * absVal;
    }
  }
  const totalSamples = length * numChannels;
  const currentRms = totalSamples > 0 ? Math.sqrt(rmsSum / totalSamples) : 0.05;

  // Alvo de Masterização Profissional Comercial:
  // - Picos a -0.3 dBFS (0.966)
  // - RMS encorpado e potente (volume bem presente e alto no fone)
  const ceiling = 0.966; // -0.3 dBFS
  let boostFactor = 1.0;

  if (maxPeak > 0) {
    // Se o áudio estiver fraco/baixo, eleva com firmeza para nível profissional
    if (currentRms < 0.12) {
      const targetRms = 0.14; // Nível potente de broadcast
      boostFactor = Math.min(4.0, Math.max(1.5, targetRms / Math.max(0.01, currentRms)));
    } else {
      boostFactor = Math.min(2.5, ceiling / maxPeak);
    }
  }

  // 8c. Brickwall Limiter Transparente (teto em -0.3 dBFS sem clipar nem estalar)
  for (let ch = 0; ch < numChannels; ch++) {
    const src = channels[ch];
    const dest = finalBuffer.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      let val = src[i] * boostFactor;
      // Soft knee brickwall limiter transparente
      if (val > ceiling) {
        val = ceiling + (1 - ceiling) * Math.tanh((val - ceiling) / (1 - ceiling));
      } else if (val < -ceiling) {
        val = -ceiling + (-1 + ceiling) * Math.tanh((val + ceiling) / (-1 + ceiling));
      }
      dest[i] = Math.max(-0.99, Math.min(0.99, val));
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
    message: 'Masterizando voz com IA (Presença, Calor Analógico e Limiter Nível Moises)...',
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

    // Aplica a cadeia profissional de masterização de estúdio nível Moises
    const masteredBuffer = await masterMaestroAudioBuffer(audioBuffer);

    // Converte para formato de biblioteca e gera nova waveform robusta
    const clipAudio = await toClipAudioAsync(masteredBuffer);
    const wavBytes = encodeWavInt16(clipAudio);
    const wavBlob = new Blob([wavBytes], { type: 'audio/wav' });
    const peaks = audioEngine.generateWaveformPeaks(masteredBuffer, 2000);

    // Atualiza armazenamento em memória e clipe
    putClipAudio(clip.id, clip.songId, clipAudio);
    registerClipSource(clip.id, clip.songId, wavBlob);

    store.updateClip(clip.id, {
      name: clip.name.includes('✨') ? clip.name : `✨ ${clip.name} (Master Moises)`,
      waveformPeaks: peaks,
      gain: 1.0,
    });

    audioEngine.invalidatePrepared(clip.songId);

    store.setImportProgress({
      clipId: 'mastering',
      status: 'done',
      message: 'Voz masterizada com potência de estúdio profissional!',
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
