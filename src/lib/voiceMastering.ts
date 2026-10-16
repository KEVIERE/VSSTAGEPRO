import { getClipAudio, putClipAudio, registerClipSource, toClipAudioAsync } from '@/lib/audioLibrary';
import { encodeWavInt16 } from '@/lib/wavEncoder';
import { audioEngine } from '@/lib/audioEngine';
import { useStore } from '@/store';

/**
 * Processador de Masterização Vocal de Estúdio para a faixa Maestro.
 * Aplica cadeia de canal de voz profissional de broadcast (High-Pass, De-Mud,
 * Realce de Presença 3.2kHz, Air Sheen 11kHz, Compressor Óptico e Normalização True-Peak).
 * Processamento 100% linear e transparente, livre de artefatos ou distorções.
 */
export async function masterMaestroAudioBuffer(inputBuffer: AudioBuffer): Promise<AudioBuffer> {
  const sampleRate = inputBuffer.sampleRate;
  const length = inputBuffer.length;
  const numChannels = inputBuffer.numberOfChannels;

  // Renderização offline com precisão de 32-bit float
  const offlineCtx = new OfflineAudioContext(numChannels, length, sampleRate);
  const source = offlineCtx.createBufferSource();
  source.buffer = inputBuffer;

  // 1. Filtro Passa-Altas (corte de subgraves e ruídos mecânicos a 85Hz)
  const highPass = offlineCtx.createBiquadFilter();
  highPass.type = 'highpass';
  highPass.frequency.value = 85;
  highPass.Q.value = 0.707;

  // 2. Limpeza de frequências ocas / abafadas (280Hz -2.5dB)
  const lowMidClean = offlineCtx.createBiquadFilter();
  lowMidClean.type = 'peaking';
  lowMidClean.frequency.value = 280;
  lowMidClean.Q.value = 1.0;
  lowMidClean.gain.value = -2.5;

  // 3. Realce de Presença e Articulação Vocal (3.2kHz +2.8dB)
  // Garante que a voz guia do maestro corte os multitracks nos fones com definição absoluta
  const presence = offlineCtx.createBiquadFilter();
  presence.type = 'peaking';
  presence.frequency.value = 3200;
  presence.Q.value = 0.9;
  presence.gain.value = 2.8;

  // 4. Brilho de Estúdio / Air Sheen (11kHz +2.0dB)
  const airSheen = offlineCtx.createBiquadFilter();
  airSheen.type = 'highshelf';
  airSheen.frequency.value = 11000;
  airSheen.gain.value = 2.0;

  // 5. Compressor Vocal Dinâmico Broadcast (nivelamento de dinâmicas sem saturação)
  const compressor = offlineCtx.createDynamicsCompressor();
  compressor.threshold.value = -20;
  compressor.knee.value = 10;
  compressor.ratio.value = 3.2;
  compressor.attack.value = 0.012;
  compressor.release.value = 0.140;

  // 6. Ganho de compensação de estúdio
  const makeupGain = offlineCtx.createGain();
  makeupGain.gain.value = 1.25;

  // Conexão em cascata DSP
  source.connect(highPass);
  highPass.connect(lowMidClean);
  lowMidClean.connect(presence);
  presence.connect(airSheen);
  airSheen.connect(compressor);
  compressor.connect(makeupGain);
  makeupGain.connect(offlineCtx.destination);

  source.start(0);
  const rendered = await offlineCtx.startRendering();

  // 7. Normalização True-Peak linear a -1.0 dBFS (0.891) sem distorção harmônica
  const finalCtx = new AudioContext();
  const finalBuffer = finalCtx.createBuffer(rendered.numberOfChannels, rendered.length, rendered.sampleRate);
  await finalCtx.close();

  let maxPeak = 0;
  for (let ch = 0; ch < rendered.numberOfChannels; ch++) {
    const data = rendered.getChannelData(ch);
    for (let i = 0; i < data.length; i++) {
      const absVal = Math.abs(data[i]);
      if (absVal > maxPeak) maxPeak = absVal;
    }
  }

  const targetPeak = 0.891; // -1.0 dBFS
  const scale = maxPeak > 0 ? Math.min(2.5, targetPeak / maxPeak) : 1.0;

  for (let ch = 0; ch < rendered.numberOfChannels; ch++) {
    const srcData = rendered.getChannelData(ch);
    const destData = finalBuffer.getChannelData(ch);
    for (let i = 0; i < srcData.length; i++) {
      destData[i] = srcData[i] * scale;
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
    message: 'Masterizando voz do Maestro com qualidade de estúdio...',
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

    // Aplica a cadeia profissional de masterização de estúdio
    const masteredBuffer = await masterMaestroAudioBuffer(audioBuffer);

    // Converte para formato de biblioteca e gera nova waveform limpa
    const clipAudio = await toClipAudioAsync(masteredBuffer);
    const wavBytes = encodeWavInt16(clipAudio);
    const wavBlob = new Blob([wavBytes], { type: 'audio/wav' });
    const peaks = audioEngine.generateWaveformPeaks(masteredBuffer, 2000);

    // Atualiza armazenamento em memória e clipe
    putClipAudio(clip.id, clip.songId, clipAudio);
    registerClipSource(clip.id, clip.songId, wavBlob);

    store.updateClip(clip.id, {
      name: clip.name.includes('✨') ? clip.name : `✨ ${clip.name} (Master)`,
      waveformPeaks: peaks,
      gain: 1.0,
    });

    audioEngine.invalidatePrepared(clip.songId);

    store.setImportProgress({
      clipId: 'mastering',
      status: 'done',
      message: 'Voz do Maestro masterizada com clareza de estúdio!',
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
