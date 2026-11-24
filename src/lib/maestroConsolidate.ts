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
// Pelo clique direito numa fala (ou nas selecionadas) consolida só aquele trecho.
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

export type ConsolidateResult = 'ok' | 'sem-falas' | 'gerando' | 'tocando' | 'travado' | 'sem-audio' | 'mudas' | 'mudou';

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

// ---- parte pura (sem o programa, para os testes) ----

interface ClipRef { id: string; songId: string; trackId: string }

/**
 * Quais falas o clique direito consolida: a clicada; se ela faz parte de uma seleção de vários
 * itens, todas as selecionadas que são falas da Maestro IA da mesma música (o resto da seleção,
 * de outras faixas, fica como está). Vazio se o clipe clicado não é da Maestro IA.
 */
export function pickConsolidateClipIds(clips: ClipRef[], clipId: string, selectedIds: string[]): string[] {
  const clicked = clips.find((c) => c.id === clipId);
  if (!clicked || clicked.trackId !== MAESTRO_IA_TRACK_ID) return [];
  if (!selectedIds.includes(clipId) || selectedIds.length < 2) return [clipId];
  const chosen = new Set(selectedIds);
  return clips
    .filter((c) => chosen.has(c.id) && c.songId === clicked.songId && c.trackId === MAESTRO_IA_TRACK_ID)
    .map((c) => c.id);
}

/**
 * Trecho (s) que o áudio consolidado ocupa: do início da primeira fala ao fim da última, no
 * mesmo tempo da timeline (o clipe novo começa em `from`, então nada sai do lugar).
 */
export function consolidateSpan(clips: Array<{ startTime: number; duration: number; trimStart?: number; trimEnd?: number }>): { from: number; duration: number } {
  const from = Math.min(...clips.map((c) => c.startTime));
  const to = Math.max(...clips.map((c) => c.startTime + clipPlayLength(c)));
  return { from, duration: Math.max(0.05, to - from) };
}

// ---- fim da parte pura ----

/**
 * Consolida as falas do Maestro IA da música num áudio só, na faixa Maestro.
 * Sem `onlyClipIds`: todas as falas (o botão da régua), e as marcações saem todas.
 * Com `onlyClipIds`: só essas falas (o clique direito numa fala ou nas selecionadas); as outras
 * falas e marcações ficam onde estão.
 */
export async function consolidateMaestroIa(songId: string, onlyClipIds?: string[]): Promise<ConsolidateResult> {
  const store = useStore.getState();
  if (store.timelineLocked) return 'travado';
  // só tocando de verdade bloqueia: pausada ou parada, pode consolidar
  if (store.transport.isPlaying && store.transport.currentSongId === songId) return 'tocando';
  const song = store.songs.find((s) => s.id === songId);
  const allIa = store.clips.filter((c) => c.songId === songId && c.trackId === MAESTRO_IA_TRACK_ID);
  const partial = !!onlyClipIds;
  const only = new Set(onlyClipIds ?? []);
  const iaClips = partial ? allIa.filter((c) => only.has(c.id)) : allIa;
  if (!song || iaClips.length === 0) return 'sem-falas';
  const chosenIds = new Set(iaClips.map((c) => c.id));
  const narrations = song.narrations ?? [];
  if (narrations.some((n) => isGenerating(n.id) && (!partial || (!!n.clipId && chosenIds.has(n.clipId))))) return 'gerando';

  // falas mudas não soam: ficam de fora do áudio (mas saem da faixa junto com as outras).
  // O solo vale para a faixa inteira: com alguma fala em solo, só as em solo soam.
  const anySolo = allIa.some((c) => c.solo);
  const sounding = iaClips.filter((c) => (anySolo ? c.solo : !c.mute)).sort((a, b) => a.startTime - b.startTime);
  if (sounding.length === 0) return 'mudas';
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

  const rate = parts[0].audio.sampleRate;
  const channels = Math.max(1, ...parts.map((p) => Math.min(2, p.audio.channels.length)));
  const { from, duration } = consolidateSpan(sounding);
  const totalFrames = Math.max(1, Math.round(duration * rate));
  const merged: ClipAudio = { sampleRate: rate, length: totalFrames, channels: mixParts(parts, from, totalFrames, rate, channels) };

  const now = useStore.getState();
  // a pessoa pode ter mexido enquanto os áudios abriam: confere de novo
  if (now.timelineLocked) return 'travado';
  if (now.transport.isPlaying && now.transport.currentSongId === songId) return 'tocando';
  const iaNow = now.clips.filter((c) => c.songId === songId && c.trackId === MAESTRO_IA_TRACK_ID);
  // as falas escolhidas continuam iguais (no consolidar geral, também nenhuma a mais)
  const sameClips = iaClips.every((c) => iaNow.includes(c)) && (partial || iaNow.length === iaClips.length);
  if (!sameClips) return 'mudou';
  const iaTrack = now.tracks.find((t) => t.id === MAESTRO_IA_TRACK_ID);
  const id = `clip-maestro-consolidado-${songId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const wav = new Blob([encodeWavInt16(merged)], { type: 'audio/wav' });
  registerClipSource(id, songId, wav);
  putClipAudio(id, songId, merged);
  const peaks = audioEngine.generateWaveformPeaks(clipAudioToBuffer(merged), Math.min(24000, Math.max(400, Math.round(duration * 100))));
  const name = partial ? (sounding.length === 1 ? 'Maestro IA (fala consolidada)' : 'Maestro IA (falas consolidadas)') : 'Maestro IA (consolidado)';
  const clip: AudioClip = {
    id,
    trackId: MAESTRO_TRACK_ID,
    name,
    fileName: `${name}.wav`,
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
    solo: sounding.some((c) => c.solo),
  };

  const removeIds = chosenIds;
  audioEngine.stopClipsLive([...removeIds]);
  // um passo só (Cmd+Z desfaz tudo): saem as falas (e as marcações delas), entra o áudio único
  useStore.setState((s) => ({
    clips: [...s.clips.filter((c) => !removeIds.has(c.id)), clip],
    songs: s.songs.map((sg) => (sg.id !== songId ? sg : partial
      ? { ...sg, narrations: (sg.narrations ?? []).filter((n) => !n.clipId || !removeIds.has(n.clipId)) }
      : { ...sg, narrations: [] })),
    selectedClipIds: [id],
  }));
  audioEngine.invalidatePrepared(songId);
  return 'ok';
}

export const CONSOLIDATE_OK_MESSAGE = 'Falas do Maestro IA consolidadas num áudio só, na faixa Maestro. Cmd+Z desfaz.';

/**
 * Consolida e mostra a mensagem de resultado (a mesma no botão da régua e no clique direito).
 * Sem `onlyClipIds`, todas as falas da música.
 */
export async function runConsolidateMaestroIa(songId: string, onlyClipIds?: string[]): Promise<ConsolidateResult> {
  const result = await consolidateMaestroIa(songId, onlyClipIds).catch(() => 'sem-audio' as const);
  const message = result === 'ok' ? CONSOLIDATE_OK_MESSAGE : CONSOLIDATE_MESSAGES[result];
  useStore.getState().setImportProgress({ clipId: 'maestro-consolidado', status: result === 'ok' ? 'done' : 'error', message });
  setTimeout(() => {
    if (useStore.getState().importProgress?.clipId === 'maestro-consolidado') useStore.getState().setImportProgress(null);
  }, 3500);
  return result;
}

export const CONSOLIDATE_MESSAGES: Record<Exclude<ConsolidateResult, 'ok'>, string> = {
  'sem-falas': 'Esta música não tem falas do Maestro IA para consolidar.',
  gerando: 'Espere as falas terminarem de ser geradas e tente de novo.',
  tocando: 'Pare a música antes de consolidar o Maestro IA.',
  travado: 'A timeline está travada. Destrave para consolidar.',
  'sem-audio': 'Não foi possível abrir o áudio de uma das falas. Gere a fala de novo e tente outra vez.',
  mudas: 'As falas escolhidas estão mudas (ou fora do solo). Tire o mudo e tente de novo.',
  mudou: 'As falas mudaram enquanto o áudio era montado. Tente consolidar de novo.',
};
