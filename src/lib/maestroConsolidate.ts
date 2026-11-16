// Consolidar o Maestro IA de uma música: todas as falas geradas pela IA viram UM áudio comum na
// faixa Maestro (como um Maestro gravado), e as falas e marcações saem da linha Maestro IA.
// Para soar igual: a faixa Maestro também entra seca no Play (entersDry), e o volume da linha
// Maestro IA vai no ganho do clipe novo.
//
// Por que: cada fala é um clipe, e cada clipe custa ao motor o mesmo que uma faixa inteira (um
// reprodutor próprio, leitura do disco, onda, arquivo no projeto). Com dezenas de falas por música
// isso pesa; consolidado, é um reprodutor só.
//
// O áudio sai cru (sem BPM e sem tom): a reprodução estica o clipe novo como esticava as falas.
// Cada fala entra com o ganho, os fades e o corte dela; falas mudas ficam de fora (com alguma em
// solo, só as em solo entram, e o clipe novo nasce em solo).
// Desfazer (Cmd+Z) volta tudo, porque a troca é um passo só.
import { useStore } from '@/store';
import { clipAudioToBuffer, clipPlayLength, getClipPlayAudio, getClipSource, openClipAudio, putClipAudio, registerClipSource, type ClipAudio } from '@/lib/audioLibrary';
import { audioEngine } from '@/lib/audioEngine';
import { encodeWavInt16 } from '@/lib/wavEncoder';
import { generateMarkers } from '@/lib/audioDecoder';
import { MAESTRO_IA_TRACK_ID } from '@/lib/narrations';
import { faderToGain } from '@/lib/faderScale';
import { isGenerating } from '@/lib/maestroVoice';
import { evaluateFadeCurve, type AudioClip } from '@/types';

/** Faixa Maestro (de cima): onde o áudio consolidado fica. */
export const MAESTRO_TRACK_ID = 'track-maestro';

export type ConsolidateResult = 'ok' | 'sem-falas' | 'gerando' | 'tocando' | 'travado' | 'sem-audio' | 'mudou';

export interface MixPart {
  /** Segundos na timeline. */
  startTime: number;
  audio: ClipAudio;
  gain: number;
  fadeIn: number;
  fadeOut: number;
  fadeCurveIn?: AudioClip['fadeCurveIn'];
  fadeCurveOut?: AudioClip['fadeCurveOut'];
}

/**
 * Mistura os trechos num áudio só, de `from` (segundos) em diante, na taxa `rate` e com `channels`
 * canais. Trecho em outra taxa é convertido (interpolação linear). Soma com teto de 16 bits.
 * Sem dependência do programa, para os testes.
 */
export function mixParts(parts: MixPart[], from: number, totalFrames: number, rate: number, channels: number): Int16Array[] {
  const out = Array.from({ length: channels }, () => new Float32Array(totalFrames));
  for (const p of parts) {
    const a = p.audio;
    if (!a.channels.length || a.length <= 0) continue;
    const ratio = a.sampleRate / rate;
    const outLen = Math.floor(a.length / ratio);
    const start = Math.round((p.startTime - from) * rate);
    const playDur = outLen / rate;
    // mesma conta da reprodução (scheduleClipFade): o fade-out não começa antes do fim do fade-in
    const fadeOutStart = Math.max(p.fadeIn, playDur - p.fadeOut);
    for (let ch = 0; ch < channels; ch++) {
      const src = a.channels[Math.min(ch, a.channels.length - 1)];
      const dst = out[ch];
      for (let i = 0; i < outLen; i++) {
        const d = start + i;
        if (d < 0) continue;
        if (d >= totalFrames) break;
        const pos = i * ratio;
        const k = Math.floor(pos);
        const f = pos - k;
        const s0 = src[k] ?? 0;
        const s1 = src[Math.min(a.length - 1, k + 1)] ?? s0;
        let v = (s0 + (s1 - s0) * f) * p.gain;
        const t = i / rate;
        if (p.fadeIn > 0 && t < p.fadeIn) v *= evaluateFadeCurve(p.fadeCurveIn ?? 'linear', t / p.fadeIn, true);
        else if (p.fadeOut > 0 && t >= fadeOutStart) v *= evaluateFadeCurve(p.fadeCurveOut ?? 'linear', Math.min(1, (t - fadeOutStart) / p.fadeOut), false);
        dst[d] += v;
      }
    }
  }
  return out.map((ch) => {
    const o = new Int16Array(ch.length);
    for (let i = 0; i < ch.length; i++) {
      const v = Math.round(ch[i]);
      o[i] = v > 32767 ? 32767 : v < -32768 ? -32768 : v;
    }
    return o;
  });
}

/** Áudio tocável do clipe (com o corte de início/fim); abre só ele do disco se não estiver na memória. */
async function playAudioOf(clip: AudioClip): Promise<ClipAudio | null> {
  const ready = getClipPlayAudio(clip);
  if (ready) return ready;
  const src = getClipSource(clip.id);
  if (!src) return null;
  const audio = await openClipAudio(clip.songId, clip.id, src);
  putClipAudio(clip.id, clip.songId, audio);
  return getClipPlayAudio(clip);
}

/** Pode consolidar agora? (para o botão ficar apagado quando não dá) */
export function canConsolidateMaestroIa(songId: string): boolean {
  const s = useStore.getState();
  return s.clips.some((c) => c.songId === songId && c.trackId === MAESTRO_IA_TRACK_ID);
}

export async function consolidateMaestroIa(songId: string): Promise<ConsolidateResult> {
  const store = useStore.getState();
  if (store.timelineLocked) return 'travado';
  // só tocando de verdade bloqueia: pausada ou parada, pode consolidar
  if (store.transport.isPlaying && store.transport.currentSongId === songId) return 'tocando';
  const song = store.songs.find((s) => s.id === songId);
  const iaClips = store.clips.filter((c) => c.songId === songId && c.trackId === MAESTRO_IA_TRACK_ID);
  if (!song || iaClips.length === 0) return 'sem-falas';
  if ((song.narrations ?? []).some((n) => isGenerating(n.id))) return 'gerando';

  // falas mudas não soam: ficam de fora do áudio (mas saem da faixa junto com as outras)
  const anySolo = iaClips.some((c) => c.solo);
  const sounding = iaClips.filter((c) => (anySolo ? c.solo : !c.mute)).sort((a, b) => a.startTime - b.startTime);
  const parts: MixPart[] = [];
  for (const clip of sounding) {
    const audio = await playAudioOf(clip).catch(() => null);
    if (!audio) return 'sem-audio';
    parts.push({
      startTime: clip.startTime,
      audio,
      gain: clip.gain ?? 1,
      fadeIn: clip.fadeIn ?? 0,
      fadeOut: clip.fadeOut ?? 0,
      fadeCurveIn: clip.fadeCurveIn,
      fadeCurveOut: clip.fadeCurveOut,
    });
  }
  if (parts.length === 0) return 'sem-audio';

  const rate = parts[0].audio.sampleRate;
  const channels = Math.max(1, ...parts.map((p) => Math.min(2, p.audio.channels.length)));
  const from = Math.min(...sounding.map((c) => c.startTime));
  const to = Math.max(...sounding.map((c) => c.startTime + clipPlayLength(c)));
  const duration = Math.max(0.05, to - from);
  const totalFrames = Math.max(1, Math.round(duration * rate));
  const merged: ClipAudio = { sampleRate: rate, length: totalFrames, channels: mixParts(parts, from, totalFrames, rate, channels) };

  const now = useStore.getState();
  // a pessoa pode ter mexido enquanto os áudios abriam: confere de novo
  if (now.timelineLocked) return 'travado';
  if (now.transport.isPlaying && now.transport.currentSongId === songId) return 'tocando';
  const iaNow = now.clips.filter((c) => c.songId === songId && c.trackId === MAESTRO_IA_TRACK_ID);
  const sameClips = iaNow.length === iaClips.length && iaNow.every((c) => iaClips.includes(c));
  if (!sameClips) return 'mudou';
  const iaTrack = now.tracks.find((t) => t.id === MAESTRO_IA_TRACK_ID);
  const id = `clip-maestro-consolidado-${songId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const wav = new Blob([encodeWavInt16(merged)], { type: 'audio/wav' });
  registerClipSource(id, songId, wav);
  putClipAudio(id, songId, merged);
  const peaks = audioEngine.generateWaveformPeaks(clipAudioToBuffer(merged), Math.min(24000, Math.max(400, Math.round(duration * 100))));
  const clip: AudioClip = {
    id,
    trackId: MAESTRO_TRACK_ID,
    name: 'Maestro IA (consolidado)',
    fileName: 'Maestro IA (consolidado).wav',
    filePath: URL.createObjectURL(wav),
    songId,
    startTime: from,
    duration,
    sampleRate: rate,
    channels,
    bpm: null,
    markers: generateMarkers(duration),
    routingMethod: 'manual',
    routingConfidence: 1,
    waveformPeaks: peaks,
    gain: iaTrack ? faderToGain(iaTrack.volume) : 1,
    mute: !!iaTrack?.mute,
    solo: anySolo,
  };

  const removeIds = new Set(iaClips.map((c) => c.id));
  audioEngine.stopClipsLive([...removeIds]);
  // um passo só (Cmd+Z desfaz tudo): sai a faixa de falas e as marcações, entra o áudio único
  useStore.setState((s) => ({
    clips: [...s.clips.filter((c) => !removeIds.has(c.id)), clip],
    songs: s.songs.map((sg) => (sg.id === songId ? { ...sg, narrations: [] } : sg)),
    selectedClipIds: [id],
  }));
  audioEngine.invalidatePrepared(songId);
  return 'ok';
}

export const CONSOLIDATE_MESSAGES: Record<Exclude<ConsolidateResult, 'ok'>, string> = {
  'sem-falas': 'Esta música não tem falas do Maestro IA para consolidar.',
  gerando: 'Espere as falas terminarem de ser geradas e tente de novo.',
  tocando: 'Pare a música antes de consolidar o Maestro IA.',
  travado: 'A timeline está travada. Destrave para consolidar.',
  'sem-audio': 'Não foi possível abrir o áudio de uma das falas. Gere a fala de novo e tente outra vez.',
  mudou: 'As falas mudaram enquanto o áudio era montado. Tente consolidar de novo.',
};
