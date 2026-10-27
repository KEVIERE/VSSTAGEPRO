import { useStore } from '@/store';
import {
  clipAudioToBuffer,
  clipPlayLength,
  ensureSongLoaded,
  getClipPlayAudio,
  putClipAudio,
  registerClipSource,
  type ClipAudio,
} from '@/lib/audioLibrary';
import { encodeWavInt16 } from '@/lib/wavEncoder';
import { audioEngine } from '@/lib/audioEngine';
import { generateMarkers } from '@/lib/audioDecoder';
import { evaluateFadeCurve, type AudioClip } from '@/types';

/**
 * Emendar / Unir clipes de áudio (Glue / Consolidate) estilo DAWs profissionais (Logic Pro / Pro Tools).
 *
 * Quando dois ou mais clipes da mesma faixa são selecionados (ou em várias faixas, ex.: Cmd+A):
 * - Agrupa por trackId.
 * - Concatena na ordem temporal exata.
 * - Se houver espaço/distância entre eles, preenche com silêncio perfeito.
 * - Se houver sobreposição, mescla as amostras com proteção anti-clipping.
 * - Aplica os fades e ganhos individuais no áudio consolidado.
 * - Gera uma nova waveform de estúdio HD (100 picos/segundo) e substitui os clipes antigos pelo novo.
 */
export async function glueSelectedClips(clipIdsToGlue?: string[]): Promise<boolean> {
  const store = useStore.getState();
  if (store.timelineLocked) return false;

  const activeSongId = store.selectedSongId ?? store.transport.currentSongId ?? store.playlist[0]?.songId ?? null;
  if (!activeSongId) return false;

  const targetIds = new Set(
    clipIdsToGlue && clipIdsToGlue.length > 0
      ? clipIdsToGlue
      : store.selectedClipIds
  );

  // Se nada estava selecionado, nada a emendar
  if (targetIds.size < 2) return false;

  const songClips = store.clips.filter((c) => c.songId === activeSongId && targetIds.has(c.id));
  if (songClips.length < 2) return false;

  // Garante que todo o áudio da música esteja carregado antes de processar as amostras
  await ensureSongLoaded(activeSongId);

  // Agrupa os clipes selecionados por faixa (trackId)
  const clipsByTrack = new Map<string, AudioClip[]>();
  for (const clip of songClips) {
    const list = clipsByTrack.get(clip.trackId) ?? [];
    list.push(clip);
    clipsByTrack.set(clip.trackId, list);
  }

  // Só emenda faixas que têm 2 ou mais clipes selecionados
  const glueableTracks = Array.from(clipsByTrack.entries()).filter(([, list]) => list.length >= 2);
  if (glueableTracks.length === 0) return false;

  const newlyCreatedClips: AudioClip[] = [];
  const allClipsToRemove: string[] = [];

  for (const [trackId, trackClips] of glueableTracks) {
    // 1. Ordena por tempo de início na timeline
    trackClips.sort((a, b) => a.startTime - b.startTime);

    // 2. Calcula os limites temporais (início e fim absolutos na timeline)
    const minStart = Math.min(...trackClips.map((c) => c.startTime));
    const maxEnd = Math.max(...trackClips.map((c) => c.startTime + clipPlayLength(c)));
    const totalDuration = maxEnd - minStart;
    if (totalDuration <= 0.01) continue;

    // 3. Obtém o sampleRate e número de canais a partir dos clipes
    const firstAudio = getClipPlayAudio(trackClips[0]);
    const sampleRate = firstAudio?.sampleRate ?? trackClips[0].sampleRate ?? 44100;
    const numChannels = Math.max(
      2,
      ...trackClips.map((c) => {
        const a = getClipPlayAudio(c);
        return a ? a.channels.length : c.channels ?? 2;
      })
    );

    const totalFrames = Math.max(1, Math.round(totalDuration * sampleRate));

    // 4. Cria os buffers de áudio em 16-bit com silêncio inicial
    const mergedChannels: Int16Array[] = Array.from(
      { length: numChannels },
      () => new Int16Array(totalFrames)
    );

    // 5. Copia e mescla cada clipe na posição exata (espaços viram silêncio automaticamente)
    for (const clip of trackClips) {
      const playAudio = getClipPlayAudio(clip);
      if (!playAudio || !playAudio.channels.length) continue;

      const clipOffsetSec = Math.max(0, clip.startTime - minStart);
      const startFrame = Math.round(clipOffsetSec * sampleRate);
      const clipFrames = playAudio.length;
      const gain = clip.gain ?? 1;
      const fadeIn = clip.fadeIn ?? 0;
      const fadeOut = clip.fadeOut ?? 0;
      const playDur = clipPlayLength(clip);
      const srcChannels = playAudio.channels;

      for (let ch = 0; ch < numChannels; ch++) {
        const src = srcChannels[Math.min(ch, srcChannels.length - 1)];
        const dst = mergedChannels[ch];

        for (let i = 0; i < clipFrames; i++) {
          const dstIdx = startFrame + i;
          if (dstIdx >= totalFrames) break;

          let val = src[i];
          if (gain !== 1) val *= gain;

          if (fadeIn > 0 || fadeOut > 0) {
            const t = i / sampleRate;
            if (t < fadeIn && fadeIn > 0) {
              val *= evaluateFadeCurve(clip.fadeCurveIn ?? 'linear', t / fadeIn, true);
            } else if (t >= playDur - fadeOut && fadeOut > 0) {
              const frac = Math.min(1, (t - (playDur - fadeOut)) / fadeOut);
              val *= evaluateFadeCurve(clip.fadeCurveOut ?? 'linear', frac, false);
            }
          }

          // Soma no canal de destino com proteção anti-clipping de 16 bits
          const existing = dst[dstIdx];
          const mixed = existing + val;
          dst[dstIdx] = mixed > 32767 ? 32767 : mixed < -32768 ? -32768 : Math.round(mixed);
        }
      }
    }

    const mergedClipAudio: ClipAudio = {
      channels: mergedChannels,
      sampleRate,
      length: totalFrames,
    };

    // 6. Codifica em WAV oficial e registra na biblioteca de áudio
    const newClipId = `clip-glued-${activeSongId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const wavBytes = encodeWavInt16(mergedClipAudio);
    const wavBlob = new Blob([wavBytes], { type: 'audio/wav' });

    registerClipSource(newClipId, activeSongId, wavBlob);
    putClipAudio(newClipId, activeSongId, mergedClipAudio);

    // 7. Gera nova waveform em alta resolução Studio HD (100 picos por segundo)
    const peakResolution = Math.min(24000, Math.max(8000, Math.round(totalDuration * 100)));
    const peaks = audioEngine.generateWaveformPeaks(clipAudioToBuffer(mergedClipAudio), peakResolution);

    // 8. Nome limpo para o clipe consolidado
    const baseName = trackClips[0].name
      .replace(/\s*\(Pt\s*\d+\)/gi, '')
      .replace(/\s*\(Emendado\)/gi, '')
      .trim();

    const newClip: AudioClip = {
      id: newClipId,
      trackId,
      name: `${baseName} (Emendado)`,
      fileName: `${baseName} (Emendado).wav`,
      filePath: URL.createObjectURL(wavBlob),
      songId: activeSongId,
      startTime: minStart,
      duration: totalDuration,
      sampleRate,
      channels: numChannels,
      bpm: null,
      markers: generateMarkers(totalDuration),
      routingMethod: trackClips[0].routingMethod,
      routingConfidence: 1,
      waveformPeaks: peaks,
      gain: 1,
      mute: false,
      solo: trackClips.some((c) => c.solo),
    };

    newlyCreatedClips.push(newClip);
    for (const c of trackClips) allClipsToRemove.push(c.id);
  }

  if (newlyCreatedClips.length === 0) return false;

  // Para o áudio ao vivo de qualquer clipe antigo que estivesse tocando
  audioEngine.stopClipsLive(allClipsToRemove);

  // Atualiza a store atomicamente
  const removeSet = new Set(allClipsToRemove);
  useStore.setState((s) => ({
    clips: [...s.clips.filter((c) => !removeSet.has(c.id)), ...newlyCreatedClips],
    selectedClipIds: newlyCreatedClips.map((c) => c.id),
  }));

  audioEngine.invalidatePrepared(activeSongId);

  // Feedback visual rápido
  const msg = newlyCreatedClips.length === 1
    ? `Áudios emendados em 1 clipe contínuo!`
    : `${newlyCreatedClips.length} faixas emendadas com sucesso!`;

  useStore.getState().setImportProgress({
    clipId: 'glued',
    status: 'done',
    message: msg,
  });
  setTimeout(() => useStore.getState().setImportProgress(null), 2500);

  return true;
}
