import { encodeWavPcm24, encodePcm24, wavHeaderPcm24 } from '@/lib/wavEncoder';
import { clipGainFor, channelGainFor, createSafetyLimiter, faderToGain, isMelodicTrack, MAGIC_SUM_GAIN } from '@/lib/audioEngine';
import { useStore } from '@/store';
import { processClipAudioAsync, bpmAdjustToAlpha } from '@/lib/timeStretch';
import { clipAudioToBuffer, clipPlayLength, getClipPlayAudio, getClipSource, openClipAudio, putClipAudio, releaseClipAudio, withSongAudio, type ClipAudio } from '@/lib/audioLibrary';
import { DiskFullError, openFileTarget, openFolderTarget, type ExportTarget } from '@/lib/exportTarget';
import { isTimecodeTrackId } from '@/lib/timecode';
import { isMedley, isSliceEnabled, medleySlices, sliceParams } from '@/lib/medley';
import { evaluateFadeCurve } from '@/types';
import { analyzeKey, analyzeLoudness } from '@/lib/audioAnalysis';
import { isFixedLevelTrack, songLevelGain } from '@/lib/songLevel';
import { ANTI_CLIP_CEILING, limitInPlace } from '@/lib/peakLimiter.js';
import { antiClipActive } from '@/lib/antiClip';
import { splitByAntiClip } from '@/lib/antiClipMix';
import { exportFilePath, exportRevealPath, exportSongs, planExport, sanitize, songFolderNames } from '@/lib/exportPlan';
import type { AudioClip, ProjectState, Song, Track } from '@/types';
import { buildRpp, layoutSongs, rppFileName, songTempoPoints, type RppOutItem, type RppOutTempo, type RppOutTrack, type TempoSlice } from '@/lib/reaperExport';

export type BounceMode = 'lr' | 'multipista' | 'show-continuo' | 'projeto-rpp';

export { exportSongs, songFolderNames };

function effectivePan(trackId: string, trackPan: number, lrMasterActive: boolean): number {
  if (isTimecodeTrackId(trackId)) return 0;
  if (!lrMasterActive) return trackPan;
  if (trackId === 'track-guia' || trackId === 'track-click' || trackId === 'track-maestro') return -1;
  return 1;
}

function songLength(song: Song, clips: AudioClip[]): number {
  const songClips = clips.filter((c) => c.songId === song.id && !isTimecodeTrackId(c.trackId));
  const maxEnd = songClips.reduce((m, c) => Math.max(m, c.startTime + clipPlayLength(c)), 0);
  return Math.max(maxEnd, 1);
}

function createBufferFallback(length: number, channels: number, sampleRate: number): AudioBuffer {
  try {
    return new AudioBuffer({ length: Math.max(1, length), numberOfChannels: channels, sampleRate });
  } catch {
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const dummy = new AudioContextClass({ latencyHint: 'playback' }); // nunca toca: bloco máximo, não encurta o do motor
    const buf = dummy.createBuffer(channels, Math.max(1, length), sampleRate);
    dummy.close().catch(() => {});
    return buf;
  }
}

function concatAudioBuffers(buffers: AudioBuffer[]): AudioBuffer {
  if (buffers.length === 0) return createBufferFallback(1, 2, 48000);
  if (buffers.length === 1) return buffers[0];
  const sampleRate = buffers[0].sampleRate;
  const totalFrames = buffers.reduce((sum, b) => sum + b.length, 0);
  const out = createBufferFallback(totalFrames, 2, sampleRate);
  let offset = 0;
  for (const b of buffers) {
    for (let c = 0; c < Math.min(2, b.numberOfChannels); c++) {
      out.copyToChannel(b.getChannelData(c), c, offset);
    }
    offset += b.length;
  }
  return out;
}

// Quantos clipes entram juntos em cada passada de renderização. Cada passada converte só o áudio
// dela para o formato nativo e libera tudo ao terminar: o pico de memória deixa de crescer com o
// número de faixas, que era o que fazia faixas sumirem (mudas) ou a exportação falhar no navegador.
const EXPORT_BATCH = 1;

const yieldToUi = () => new Promise<void>((r) => setTimeout(r, 0));

/**
 * Áudio aberto de um clipe para exportar. Se a memória já soltou o áudio, reabre do arquivo e
 * tenta de novo antes de desistir. Quando realmente não abre, avisa com erro: uma faixa NUNCA
 * pode sair muda no arquivo exportado sem ninguém saber.
 * Se o arquivo estiver ausente, falha com o nome do clipe em vez de gerar silêncio.
 */
async function exportAudioFor(clip: AudioClip): Promise<ClipAudio> {
  const cached = getClipPlayAudio(clip);
  if (cached) return cached;
  const src = getClipSource(clip.id);
  if (!src) {
    throw new Error(`O clipe "${clip.name}" não tem áudio acessível para exportar. Relocalize o arquivo ausente e tente novamente.`);
  }
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const audio = await openClipAudio(clip.songId, clip.id, src);
      putClipAudio(clip.id, clip.songId, audio);
      const playable = getClipPlayAudio(clip);
      if (playable) return playable;
      throw new Error(`O áudio do clipe "${clip.name}" está vazio ou não pôde ser lido.`);
    } catch (err) {
      lastErr = err;
      console.warn(`[bounce] tentativa ${attempt + 1} de abrir "${clip.name}" falhou:`, err);
    }
    await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
  }
  console.error('[bounce] clipe não abriu para exportar:', clip.name, lastErr);
  throw new Error(`Não foi possível abrir o áudio "${clip.name}" para exportar (memória insuficiente ou arquivo ilegível). Feche outros programas e tente de novo.`);
}

// Antes do trecho usado, o processamento de BPM/tom recebe um pouco de áudio a mais para já
// estar estável na borda da fatia (sem ataque esquisito no começo).
const STRETCH_PREROLL_SECONDS = 0.25;

/**
 * Converte só o pedaço do clipe que cai na fatia [localStart, localEnd) (segundos do clipe) e
 * libera o original. Antes, cada fatia de um medley convertia o clipe INTEIRO de novo: com
 * várias fatias e dezenas de faixas, a memória estourava e a música falhava na exportação.
 * Devolve o buffer e quanto do começo dele (em segundos de saída) é só aquecimento.
 */
async function processExportClip(
  ctx: BaseAudioContext,
  clip: AudioClip,
  alpha: number,
  cents: number,
  localStart: number,
  localEnd: number,
): Promise<{ buffer: AudioBuffer; lead: number }> {
  const audio = await exportAudioFor(clip);
  try {
    const sr = audio.sampleRate;
    const processing = Math.abs(alpha - 1) >= 1e-3 || Math.abs(cents) >= 1;
    const from = Math.max(0, Math.floor((localStart - (processing ? STRETCH_PREROLL_SECONDS : 0)) * sr));
    const to = Math.min(audio.length, Math.max(from + 1, Math.ceil(localEnd * sr)));
    const part: ClipAudio = from === 0 && to === audio.length
      ? audio
      : { sampleRate: sr, length: to - from, channels: audio.channels.map((ch) => ch.subarray(from, to)) };
    const buffer = await processClipAudioAsync(ctx, part, alpha, cents);
    return { buffer, lead: Math.max(0, localStart - from / sr) * alpha };
  } finally {
    releaseClipAudio(clip.id);
    await yieldToUi();
  }
}

/**
 * Envelope de ganho do clipe (fade in, platô, fade out) num contexto que começa em 0, mesmo
 * quando o clipe começou antes da fatia (clipStart negativo): o ponto de partida é calculado
 * no instante 0 e o resto da curva segue no tempo certo.
 */
function scheduleClipEnvelope(param: AudioParam, clip: AudioClip, baseGain: number, clipStart: number, playDuration: number, alpha: number) {
  const fadeIn = Math.max(0, (clip.fadeIn ?? 0) * alpha);
  const fadeOut = Math.max(0, (clip.fadeOut ?? 0) * alpha);
  if (fadeIn <= 0 && fadeOut <= 0) {
    param.value = baseGain;
    return;
  }
  const points: Array<[number, number]> = [];
  const steps = (curve: string) => (curve === 'linear' ? 1 : 8);
  if (fadeIn > 0) {
    const curve = clip.fadeCurveIn ?? 'linear';
    points.push([clipStart, 0]);
    for (let i = 1, n = steps(curve); i <= n; i++) points.push([clipStart + (i / n) * fadeIn, evaluateFadeCurve(curve, i / n, true) * baseGain]);
  } else {
    points.push([clipStart, baseGain]);
  }
  if (fadeOut > 0) {
    const curve = clip.fadeCurveOut ?? 'linear';
    const outStart = clipStart + Math.max(fadeIn, playDuration - fadeOut);
    points.push([outStart, baseGain]);
    for (let i = 1, n = steps(curve); i <= n; i++) points.push([outStart + (i / n) * fadeOut, evaluateFadeCurve(curve, i / n, false) * baseGain]);
  }
  // valor no instante 0 (interpolado se o fade já estava em andamento)
  let v0 = points[0][1];
  for (let i = 0; i < points.length; i++) {
    const [t, v] = points[i];
    if (t <= 0) { v0 = v; continue; }
    const prev = points[i - 1];
    if (prev && prev[0] < 0) v0 = prev[1] + (v - prev[1]) * ((0 - prev[0]) / (t - prev[0]));
    break;
  }
  param.setValueAtTime(v0, 0);
  for (const [t, v] of points) if (t > 0) param.linearRampToValueAtTime(v, t);
}

// Renderiza um trecho isolado [sliceStart, sliceEnd] com BPM e Tom específicos daquele trecho
async function renderSliceOffline(
  song: Song,
  sliceStart: number,
  sliceEnd: number,
  bpmAdjust: number,
  tuner: number,
  tracks: Track[],
  clips: AudioClip[],
  lrMasterActive: boolean,
  trackFilter?: (t: Track) => boolean,
  applyMasterLimiter = false,
  cancelled: () => boolean = () => false,
  masterVolume = 0.8,
  channelLevel = 1,
  magicOff = false
): Promise<AudioBuffer> {
  const alpha = bpmAdjustToAlpha(bpmAdjust);
  const sliceDurSec = Math.max(0.05, sliceEnd - sliceStart);
  const outDuration = sliceDurSec * alpha;
  const sampleRate = 48000;
  const totalFrames = Math.max(1, Math.ceil(outDuration * sampleRate));
  const cents = tuner * 100;
  const respectMuteSolo = !trackFilter;
  // magicOff: faixa separada para o projeto .RPP, sem a soma do LR mágico (lá cada faixa tem o fader dela)
  const magic = !magicOff && !!useStore.getState().magicRoutingActive;

  const songClips = clips.filter((c) => c.songId === song.id && !isTimecodeTrackId(c.trackId));

  // Só entram os clipes que cruzam este trecho e pertencem às faixas pedidas. O filtro vem ANTES
  // de abrir qualquer áudio: na multipista cada arquivo abre só o que é dele.
  const wanted: Array<{ clip: AudioClip; track: Track }> = [];
  for (const clip of songClips) {
    const clipEnd = clip.startTime + clipPlayLength(clip);
    if (clipEnd <= sliceStart || clip.startTime >= sliceEnd) continue;
    const track = tracks.find((t) => t.id === clip.trackId);
    if (!track) throw new Error(`O clipe "${clip.name}" de "${song.name}" aponta para uma faixa inexistente. Corrija o roteamento antes de exportar.`);
    if (trackFilter && !trackFilter(track)) continue;
    wanted.push({ clip, track });
  }

  // O mix das passadas é somado aqui (a soma de sinais é exatamente o que o Web Audio faz no destino).
  const accL = new Float32Array(totalFrames);
  const accR = new Float32Array(totalFrames);

  const renderInto = async (items: typeof wanted, dstL: Float32Array, dstR: Float32Array) => {
    for (let from = 0; from < items.length; from += EXPORT_BATCH) {
      if (cancelled()) throw new DOMException('Exportação cancelada', 'AbortError');
      const batch = items.slice(from, from + EXPORT_BATCH);
      const ctx = new OfflineAudioContext(2, totalFrames, sampleRate);

      const trackChannels = new Map<string, { gain: GainNode; panner: StereoPannerNode }>();
      const ensureChannel = (targetTrack: Track) => {
        const existing = trackChannels.get(targetTrack.id);
        if (existing) return existing;
        const gain = ctx.createGain();
        const panner = ctx.createStereoPanner();
        // LR mágico: mesma soma a -6 dB da reprodução (o canal estéreo vai todo para um lado)
        const magicSum = magic && !isTimecodeTrackId(targetTrack.id) ? MAGIC_SUM_GAIN : 1;
        // "volume igual": só a banda; click, guia e Maestro ficam fixos, como na reprodução
        const songLevel = isFixedLevelTrack(targetTrack.id, tracks) ? 1 : channelLevel;
        gain.gain.value = (respectMuteSolo ? channelGainFor(targetTrack, tracks, targetTrack.volume) : faderToGain(targetTrack.volume)) * magicSum * songLevel;
        panner.pan.value = effectivePan(targetTrack.id, targetTrack.pan, lrMasterActive);
        gain.connect(panner);
        panner.connect(ctx.destination);
        const node = { gain, panner };
        trackChannels.set(targetTrack.id, node);
        return node;
      };

      let scheduled = 0;
      for (const { clip, track } of batch) {
        const clipPlayLen = clipPlayLength(clip);
        const melodic = isMelodicTrack(track, tracks);
        // trecho do clipe (em segundos do clipe) que cai nesta fatia
        const localStart = Math.max(0, sliceStart - clip.startTime);
        const localEnd = Math.min(clipPlayLen, sliceEnd - clip.startTime);
        // clipe que só encosta na borda da fatia não tem o que tocar nela: fica de fora (não é erro)
        if (localEnd - localStart <= 0.0005) continue;
        const { buffer: processed, lead } = await processExportClip(ctx, clip, alpha, melodic ? cents : 0, localStart, localEnd);
        if (cancelled()) throw new DOMException('Exportação cancelada', 'AbortError');

        const target = track.parentId ? tracks.find((t) => t.id === track.parentId) ?? track : track;
        const channel = ensureChannel(target);
        const source = ctx.createBufferSource();
        source.buffer = processed;
        source.playbackRate.value = 1;

        const clipGain = ctx.createGain();
        const trackVolumeGain = track.parentId
          ? (respectMuteSolo ? channelGainFor(track, tracks, track.volume) : faderToGain(track.volume))
          : 1;
        const baseGain = trackVolumeGain * clipGainFor(clip, songClips);

        const playDuration = clipPlayLen * alpha;
        scheduleClipEnvelope(clipGain.gain, clip, baseGain, (clip.startTime - sliceStart) * alpha, playDuration, alpha);

        source.connect(clipGain);

        if (track.parentId) {
          const clipPan = ctx.createStereoPanner();
          clipPan.pan.value = effectivePan(track.id, track.pan, lrMasterActive);
          clipGain.connect(clipPan);
          clipPan.connect(channel.gain);
        } else {
          clipGain.connect(channel.gain);
        }

        const when = Math.max(0, (clip.startTime - sliceStart) * alpha);
        const offset = Math.min(lead, Math.max(0, (source.buffer?.duration ?? 0) - 1 / sampleRate));
        try {
          if (offset > 0) source.start(when, offset);
          else source.start(when);
          scheduled++;
        } catch (err) {
          console.error('[bounce] agendamento falhou:', clip.name, err);
          throw new Error(`Não foi possível agendar o clipe "${clip.name}" na exportação.`);
        }
        await yieldToUi();
      }

      if (scheduled > 0) {
        const rendered = await ctx.startRendering();
        if (cancelled()) throw new DOMException('Exportação cancelada', 'AbortError');
        const l = rendered.getChannelData(0);
        const r = rendered.numberOfChannels > 1 ? rendered.getChannelData(1) : l;
        const n = Math.min(totalFrames, rendered.length);
        for (let i = 0; i < n; i++) {
          dstL[i] += l[i];
          dstR[i] += r[i];
        }
      }
      await yieldToUi();
    }
  };

  // Canais com anti-clip: o limitador age na soma do canal inteiro (como na reprodução), então
  // os clipes de cada um são somados à parte, limitados juntos e só então entram no mix.
  // Sem nenhum anti-clip ligado, tudo segue o caminho (e a ordem) de sempre.
  const { plain, groups } = splitByAntiClip(wanted, ({ track }) => {
    const target = track.parentId ? tracks.find((t) => t.id === track.parentId) ?? track : track;
    return antiClipActive(target) ? target.id : null;
  });
  await renderInto(plain, accL, accR);
  if (groups.length > 0) {
    const chL = new Float32Array(totalFrames);
    const chR = new Float32Array(totalFrames);
    // o "volume igual" já entrou no canal, antes do limitador, igual à reprodução
    const ceiling = ANTI_CLIP_CEILING;
    for (const group of groups) {
      chL.fill(0);
      chR.fill(0);
      await renderInto(group, chL, chR);
      if (cancelled()) throw new DOMException('Exportação cancelada', 'AbortError');
      limitInPlace([chL, chR], sampleRate, { ceiling });
      for (let i = 0; i < totalFrames; i++) {
        accL[i] += chL[i];
        accR[i] += chR[i];
      }
      await yieldToUi();
    }
  }

  const mixed = createBufferFallback(totalFrames, 2, sampleRate);
  mixed.copyToChannel(accL, 0);
  mixed.copyToChannel(accR, 1);
  if (!applyMasterLimiter) return mixed;

  // Limitador de segurança do master, aplicado sobre a soma final (como na mesa de reprodução).
  const master = new OfflineAudioContext(2, totalFrames, sampleRate);
  const src = master.createBufferSource();
  src.buffer = mixed;
  const makeup = master.createGain();
  makeup.gain.value = faderToGain(masterVolume);
  if (magic) {
    // LR mágico: um limiter por lado, como na reprodução (a banda não abaixa a guia/click)
    const split = master.createChannelSplitter(2);
    const merge = master.createChannelMerger(2);
    src.connect(makeup);
    makeup.connect(split);
    for (let c = 0; c < 2; c++) {
      const lim = createSafetyLimiter(master);
      lim.channelCount = 1;
      lim.channelCountMode = 'explicit';
      split.connect(lim, c);
      lim.connect(merge, 0, c);
    }
    merge.connect(master.destination);
  } else {
    const limiter = createSafetyLimiter(master);
    src.connect(makeup);
    makeup.connect(limiter);
    limiter.connect(master.destination);
  }
  src.start(0);
  const out = await master.startRendering();
  // Anti-clip do master: o mesmo limitador da reprodução, depois do limiter de segurança
  // (no LR mágico, um por lado). O "volume igual" já entrou no fader master: o teto é o de sempre.
  if (useStore.getState().masterAntiClip) {
    const sides = [out.getChannelData(0), out.getChannelData(1)];
    if (magic) sides.forEach((ch) => limitInPlace([ch], sampleRate));
    else limitInPlace(sides, sampleRate);
    sides.forEach((ch, c) => out.copyToChannel(ch, c));
  }
  return out;
}

async function renderOffline(
  song: Song,
  tracks: Track[],
  clips: AudioClip[],
  lrMasterActive: boolean,
  trackFilter?: (t: Track) => boolean,
  applyMasterLimiter = false,
  cancelled: () => boolean = () => false,
  masterVolume = 0.8,
  channelLevel = 1,
  magicOff = false
): Promise<AudioBuffer> {
  // Se for um Medley com fatias:
  // - Renderiza apenas as fatias marcadas (enabled !== false), pulando as desmarcadas!
  // - Cada fatia respeita o seu próprio Tom (tuner) e BPM (bpmAdjust)!
  // - Emenda as fatias marcadas em sequência contínua
  if (isMedley(song)) {
    const slices = medleySlices(song).filter(isSliceEnabled);
    if (slices.length === 0) {
      return new AudioBuffer({ length: 48000, numberOfChannels: 2, sampleRate: 48000 });
    }
    const buffers: AudioBuffer[] = [];
    for (const s of slices) {
      const p = sliceParams(song, s);
      const buf = await renderSliceOffline(
        song,
        s.start,
        s.end,
        p.bpmAdjust,
        p.tuner,
        tracks,
        clips,
        lrMasterActive,
        trackFilter,
        applyMasterLimiter,
        cancelled,
        masterVolume,
        channelLevel,
        magicOff
      );
      buffers.push(buf);
    }
    return concatAudioBuffers(buffers);
  }

  // Música padrão (sem fatias de medley): renderiza do início ao fim respeitando BPM e Tom da música
  const duration = songLength(song, clips);
  return renderSliceOffline(
    song,
    0,
    duration,
    song.bpmAdjust || 0,
    song.tuner || 0,
    tracks,
    clips,
    lrMasterActive,
    trackFilter,
    applyMasterLimiter,
    cancelled,
    masterVolume,
    channelLevel,
    magicOff
  );
}

// O timecode sai como o arquivo original: sem BPM, sem afinador e sem fader.
async function timecodeBuffer(clip: AudioClip): Promise<AudioBuffer> {
  const audio = await exportAudioFor(clip);
  try {
    return clipAudioToBuffer(audio);
  } finally {
    releaseClipAudio(clip.id);
  }
}

export async function renderLrMasterForSong(song: Song, state: ProjectState): Promise<AudioBuffer> {
  return withSongAudio(song.id, () => renderOffline(song, state.tracks, state.clips, state.lrMasterActive, undefined, true));
}

/** A faixa Guia (onde fica a voz) e as faixas dentro dela. */
export const GUIDE_TRACK_ID = 'track-guia';

export function guideTrackIds(tracks: Track[]): Set<string> {
  const byId = new Map(tracks.map((t) => [t.id, t]));
  const ids = new Set<string>();
  for (const t of tracks) {
    let cur: Track | undefined = t;
    for (let depth = 0; cur && depth < 8; depth++) {
      if (cur.id === GUIDE_TRACK_ID) { ids.add(t.id); break; }
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
  }
  return ids;
}

/** A música tem áudio na faixa Guia? (sem Guia não há voz para ler) */
export function songHasGuide(song: Song, state: Pick<ProjectState, 'tracks' | 'clips'>): boolean {
  const ids = guideTrackIds(state.tracks);
  return state.clips.some((c) => c.songId === song.id && ids.has(c.trackId));
}

/**
 * Só a faixa Guia da música, no centro e com o fader em 0 dB (mesmo que ela esteja abaixada ou
 * muda na mixagem), no mesmo tempo e tom do show: é o que o leitor de letra ouve. O tempo bate
 * com o áudio de referência do produtor, que sai do mesmo render.
 */
export async function renderGuideForSong(song: Song, state: ProjectState): Promise<AudioBuffer> {
  const ids = guideTrackIds(state.tracks);
  const unity = state.tracks.map((t) => (ids.has(t.id) ? { ...t, volume: 0.8, pan: 0, antiClip: false } : t));
  return withSongAudio(song.id, () => renderOffline(song, unity, state.clips, false, (t) => ids.has(t.id), false));
}

export interface ExportProgress {
  fraction: number;
  label: string;
  saved: number;
  total: number;
  location: string;
}

export interface DiskFullInfo {
  saved: number;
  total: number;
  needed: number;
  file: string;
  checkFree: () => Promise<number | null>;
}

export interface ExportHooks {
  onProgress: (p: ExportProgress) => void;
  onDiskFull: (info: DiskFullInfo) => Promise<'continue' | 'stop'>;
  cancelled: () => boolean;
}

export interface ExportRequest {
  scope: 'musica' | 'projeto';
  /** Uma música só (forma antiga, usada pelos testes de navegador). */
  songId?: string;
  /** Músicas marcadas no escopo 'musica', na ordem do show. Tem prioridade sobre songId. */
  songIds?: string[];
  mode: BounceMode;
}

export interface ExportResult {
  status: 'done' | 'stopped' | 'cancelled';
  saved: number;
  total: number;
  songsSaved: number;
  songsTotal: number;
  incomplete: string[];
  empty: string[];
  location: string;
  reveal: (() => Promise<void>) | null;
}

interface FileJob {
  name: string;
  label: string;
  render: () => Promise<ArrayBuffer>;
}

// Antes de carregar o áudio, conta as faixas que têm clipe para a barra de progresso já começar certa.
function estimateFiles(song: Song, state: ProjectState, mode: BounceMode): number {
  if (mode === 'lr' || mode === 'show-continuo') return 1;
  const known = new Set(state.tracks.map((t) => t.id));
  return new Set(state.clips.filter((c) => c.songId === song.id && known.has(c.trackId)).map((c) => c.trackId)).size;
}

function multitrackJobs(song: Song, state: ProjectState, cancelled: () => boolean): FileJob[] {
  const songClips = state.clips
    .filter((c) => c.songId === song.id)
    .sort((a, b) => a.startTime - b.startTime);
  const order = new Map(state.tracks.map((t, i) => [t.id, i]));
  const orphan = songClips.find((c) => !order.has(c.trackId));
  if (orphan) throw new Error(`O clipe "${orphan.name}" de "${song.name}" aponta para uma faixa inexistente. Corrija o roteamento antes de exportar.`);
  const trackIds = Array.from(new Set(songClips.map((c) => c.trackId)))
    .filter((id) => order.has(id))
    .sort((a, b) => order.get(a)! - order.get(b)!);
  const jobs: FileJob[] = [];
  const tcClip = songClips.find((c) => isTimecodeTrackId(c.trackId));
  if (tcClip) {
    jobs.push({
      name: 'TIMECODE (LTC).wav',
      label: 'Timecode (LTC)',
      render: async () => {
        const buf = await timecodeBuffer(tcClip);
        return encodeWavPcm24(buf);
      },
    });
  }
  const stems = trackIds.filter((id) => !isTimecodeTrackId(id)).map((id) => state.tracks.find((t) => t.id === id)!);
  const used = new Map<string, number>();
  stems.forEach((track, i) => {
    const base = sanitize(track.name);
    const n = (used.get(base.toLowerCase()) ?? 0) + 1;
    used.set(base.toLowerCase(), n);
    jobs.push({
      name: n === 1 ? `${base}.wav` : `${base} (${n}).wav`,
      label: `Faixa ${i + 1} de ${stems.length}: ${track.name}`,
      render: async () =>
        encodeWavPcm24(await renderOffline(song, state.tracks, state.clips, state.lrMasterActive, (t) => t.id === track.id, false, cancelled)),
    });
  });
  return jobs;
}

/**
 * Loudness (LUFS) e pico real só da banda: sem click, guia e Maestro, com os faders em 0 dB, sem
 * fader master, limiter nem LR mágico. É a medida usada pelo "volume igual entre os VS".
 */
export async function measureSongLoudness(song: Song, state: ProjectState, cancelled: () => boolean = () => false): Promise<{ lufs: number; peak: number }> {
  const unity = state.tracks.map((t) => ({ ...t, volume: 0.8, antiClip: false }));
  const isBand = (t: Track) => !isFixedLevelTrack(t.id, unity);
  const buf = await withSongAudio(song.id, () => renderOffline(song, unity, state.clips, false, isBand, false, cancelled, 0.8, 1, true));
  // o cálculo (~0,7 s por música no M2) vai para o worker: a tela e o streaming do disco seguem livres
  return analyzeLoudness(buf);
}

/**
 * Tom da música pela IA: mix só das faixas melódicas (sem bateria, percussão, click e maestro),
 * faders em 0 dB, sem o tom/BPM ajustados. A mixagem para mono e a análise rodam no worker.
 */
export async function detectSongKey(song: Song, state: ProjectState): Promise<{ key: string; confident: boolean } | null> {
  const unity = state.tracks.map((t) => ({ ...t, volume: 0.8, antiClip: false }));
  const plain: Song = { ...song, bpmAdjust: 0, tuner: 0, medley: undefined };
  const buf = await withSongAudio(song.id, () => renderOffline(plain, unity, state.clips, false, (t) => isMelodicTrack(t, unity), false));
  return analyzeKey(buf);
}

/** Mix master de uma música; se falhar (memória apertada), libera o áudio dela e tenta mais uma vez. */
async function renderSongWithRetry(song: Song, state: ProjectState, cancelled: () => boolean): Promise<AudioBuffer> {
  let last: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await withSongAudio(song.id, () => renderOffline(song, state.tracks, state.clips, state.lrMasterActive, undefined, true, cancelled, state.masterVolume, songLevelGain(state, song.id)));
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') throw err;
      last = err;
      console.warn(`[bounce] tentativa ${attempt + 1} de mixar "${song.name}" falhou`, err);
      await new Promise((r) => setTimeout(r, 400));
    }
  }
  throw last;
}

/** Garante exatamente `frames` quadros (completa com silêncio ou corta o arredondamento). */
function fitFrames(buf: AudioBuffer, frames: number): AudioBuffer {
  if (buf.length === frames) return buf;
  const out = createBufferFallback(frames, 2, buf.sampleRate);
  for (let c = 0; c < 2; c++) {
    const src = buf.getChannelData(Math.min(c, buf.numberOfChannels - 1));
    out.copyToChannel(src.length > frames ? src.subarray(0, frames) : src, c);
  }
  return out;
}

/**
 * Trechos tocados da música, em ordem, com a duração de cada um já no BPM ajustado (em quadros).
 * No medley, só as fatias marcadas; senão, a música inteira. É exatamente o que renderOffline gera.
 */
function songOutSlices(song: Song, clips: AudioClip[], sampleRate: number): Array<{ srcStart: number; srcEnd: number; alpha: number; frames: number }> {
  if (isMedley(song)) {
    return medleySlices(song).filter(isSliceEnabled).map((sl) => {
      const alpha = bpmAdjustToAlpha(sliceParams(song, sl).bpmAdjust);
      return { srcStart: sl.start, srcEnd: sl.end, alpha, frames: Math.max(1, Math.ceil((sl.end - sl.start) * alpha * sampleRate)) };
    });
  }
  const len = songLength(song, clips);
  const alpha = bpmAdjustToAlpha(song.bpmAdjust || 0);
  return [{ srcStart: 0, srcEnd: len, alpha, frames: Math.max(1, Math.ceil(len * alpha * sampleRate)) }];
}

/** Quadros que a música ocupa no arquivo exportado (pelo menos 1). */
function songOutFrames(song: Song, clips: AudioClip[], sampleRate: number): number {
  return Math.max(1, songOutSlices(song, clips, sampleRate).reduce((sum, sl) => sum + sl.frames, 0));
}

/** Onde gravar: os seletores do sistema por padrão; os testes passam destinos na memória. */
export interface ExportTargets {
  openFileTarget: typeof openFileTarget;
  openFolderTarget: typeof openFolderTarget;
}

const SYSTEM_TARGETS: ExportTargets = { openFileTarget, openFolderTarget };

function reasonOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function runExport(req: ExportRequest, state: ProjectState, hooks: ExportHooks, targets: ExportTargets = SYSTEM_TARGETS): Promise<ExportResult | null> {
  const { openFileTarget, openFolderTarget } = targets;
  const songs = exportSongs(req, state);
  if (songs.length === 0) {
    throw new Error(req.scope === 'musica' ? 'Música não encontrada.' : 'O projeto não tem músicas para exportar.');
  }
  const folders = songFolderNames(songs);

  // Projeto inteiro ou 2+ músicas marcadas: uma pasta por música. Uma música só: direto no destino.
  const plan = planExport(req.scope, req.mode, songs.map((s) => s.name), state.projectName);
  const { multi } = plan;
  let target: ExportTarget;
  let lrFileName = '';
  if (plan.destination.kind === 'file') {
    const picked = await openFileTarget(plan.destination.name);
    if (!picked) return null;
    target = picked.target;
    lrFileName = picked.name;
  } else {
    const t = await openFolderTarget(plan.destination.title, plan.destination.zipName);
    if (!t) return null;
    target = t;
  }

  if (req.mode === 'projeto-rpp') return runRppExport(songs, folders, plan, target, state, hooks);

  const estimates = songs.map((s) => estimateFiles(s, state, req.mode));
  let total = estimates.reduce((a, b) => a + b, 0);
  let saved = 0;
  let songsSaved = 0;
  const run: { status: ExportResult['status'] } = { status: 'done' };
  const incomplete: string[] = [];
  const empty: string[] = [];
  const report = (label: string, part: number) =>
    hooks.onProgress({ fraction: total ? Math.min(1, (saved + part) / total) : 0, label, saved, total, location: target.location });

  report('Preparando...', 0);

  // Modo Show Contínuo: mixa cada música do show e emenda todas em sequência num único WAV master estéreo.
  // Cada música é renderizada, gravada no disco e descartada da memória antes da próxima começar —
  // em nenhum momento o show inteiro fica inteiro em RAM, mesmo com dezenas de músicas longas.
  if (req.mode === 'show-continuo') {
    const outName = lrFileName || (plan.destination.kind === 'file' ? plan.destination.name : 'SHOW COMPLETO CONTÍNUO.wav');
    const sampleRate = 48000;

    // Precisa saber a duração total ANTES de escrever (o cabeçalho WAV declara o tamanho do arquivo
    // logo no início). Considera exatamente as fatias marcadas em cada medley e o BPM de cada uma.
    const songFrames = songs.map((s) => songOutFrames(s, state.clips, sampleRate));
    const totalFrames = songFrames.reduce((a, b) => a + b, 0);

    if (!target.openStream) {
      // Destino sem suporte a gravação em pedaços (ex.: download direto no navegador sem app
      // nem acesso a pastas): mantém o caminho em memória como alternativa, com aviso de escala.
      const renderedBuffers: AudioBuffer[] = [];
      for (let si = 0; si < songs.length; si++) {
        if (hooks.cancelled()) { run.status = 'cancelled'; break; }
        const song = songs[si];
        report(`Música ${si + 1} de ${songs.length} – ${song.name} · mixando`, 0);
        try {
          const buf = await renderSongWithRetry(song, state, hooks.cancelled);
          renderedBuffers.push(buf);
          saved++;
          songsSaved++;
        } catch (err) {
          if ((err as DOMException)?.name === 'AbortError') { run.status = 'cancelled'; break; }
          // pular uma música deixaria o show contínuo com um buraco de tempo: para e diz qual
          throw new Error(`O show contínuo parou em "${song.name}" (música ${si + 1} de ${songs.length}): ${reasonOf(err)}`);
        }
      }
      if (run.status === 'cancelled' || renderedBuffers.length === 0) {
        return {
          status: run.status, location: target.location, saved: songsSaved, total: songs.length,
          songsSaved, songsTotal: songs.length, incomplete, empty, reveal: null,
        };
      }
      report('Emendando músicas em sequência contínua...', 0.92);
      const sr = renderedBuffers[0].sampleRate;
      const totalF = renderedBuffers.reduce((sum, b) => sum + b.length, 0);
      const fullBuffer = createBufferFallback(totalF, 2, sr);
      let frameOffset = 0;
      for (const b of renderedBuffers) {
        for (let ch = 0; ch < Math.min(2, b.numberOfChannels); ch++) {
          fullBuffer.copyToChannel(b.getChannelData(ch), ch, frameOffset);
        }
        frameOffset += b.length;
      }
      report('Codificando WAV do show completo...', 0.96);
      const data = encodeWavPcm24(fullBuffer);
      report(`Salvando ${outName}...`, 0.98);
      await target.write(outName, data);
      return {
        status: 'done', location: target.location, saved: 1, total: 1,
        songsSaved, songsTotal: songs.length, incomplete, empty,
        reveal: target.reveal ? () => target.reveal!(outName) : null,
      };
    }

    const stream = await target.openStream(outName);
    try {
      await stream.append(wavHeaderPcm24(totalFrames, 2, sampleRate));

      for (let si = 0; si < songs.length; si++) {
        if (hooks.cancelled()) { run.status = 'cancelled'; break; }
        const song = songs[si];
        const songLabel = `Música ${si + 1} de ${songs.length} – ${song.name}`;
        report(`${songLabel} · mixando faixa`, 0);
        let buf: AudioBuffer;
        try {
          buf = await renderSongWithRetry(song, state, hooks.cancelled);
        } catch (err) {
          if ((err as DOMException)?.name === 'AbortError') { run.status = 'cancelled'; break; }
          // O cabeçalho do WAV já declarou a duração do show inteiro: pular uma música deixaria o
          // arquivo corrompido e fora de tempo. Para e diz exatamente qual música e por quê.
          throw new Error(`O show contínuo parou em "${song.name}" (música ${si + 1} de ${songs.length}): ${reasonOf(err)}`);
        }
        report(`${songLabel} · gravando no disco`, 0.5);
        // exatamente o tamanho declarado no cabeçalho para esta música
        const pcm = encodePcm24(fitFrames(buf, songFrames[si]));
        await stream.append(pcm);
        saved++;
        songsSaved++;
        report(`${songLabel} · concluída`, 1);
      }

      if (run.status === 'cancelled') {
        await stream.abort();
        return {
          status: 'cancelled', location: target.location, saved: songsSaved, total: songs.length,
          songsSaved, songsTotal: songs.length, incomplete, empty, reveal: null,
        };
      }
      if (songsSaved === 0) {
        await stream.abort();
        throw new Error('Nenhuma música do show pôde ser mixada para o áudio contínuo.');
      }

      report('Finalizando arquivo do show completo...', 0.99);
      await stream.close();
    } catch (err) {
      await stream.abort().catch(() => {});
      throw err;
    }

    return {
      status: 'done', location: target.location, saved: 1, total: 1,
      songsSaved, songsTotal: songs.length, incomplete, empty,
      reveal: target.reveal ? () => target.reveal!(outName) : null,
    };
  }

  for (let si = 0; si < songs.length; si++) {
    const song = songs[si];
    const songLabel = songs.length > 1 ? `Música ${si + 1} de ${songs.length} – ${song.name}` : song.name;
    if (run.status !== 'done') { incomplete.push(song.name); continue; }
    report(`${songLabel} · carregando áudio`, 0);
    let songSaved = 0;
    try {
    songSaved = await withSongAudio(song.id, async () => {
      const jobs: FileJob[] = req.mode === 'lr'
        ? [{
            name: lrFileName || `${sanitize(song.name)} - LR MASTER.wav`,
            label: 'mix LR Master',
            render: async () => encodeWavPcm24(await renderOffline(song, state.tracks, state.clips, state.lrMasterActive, undefined, true, hooks.cancelled, state.masterVolume, songLevelGain(state, song.id))),
          }]
        : multitrackJobs(song, state, hooks.cancelled);
      total += jobs.length - estimates[si];
      let count = 0;
      for (const job of jobs) {
        if (hooks.cancelled()) { run.status = 'cancelled'; break; }
        report(`${songLabel} · ${job.label}`, 0);
        let data: ArrayBuffer;
        try {
          data = await job.render();
        } catch (err) {
          if ((err as DOMException)?.name === 'AbortError') { run.status = 'cancelled'; break; }
          throw err;
        }
        if (hooks.cancelled()) { run.status = 'cancelled'; break; }
        report(`${songLabel} · salvando ${job.name}`, 0.9);
        const rel = exportFilePath(plan, folders[si], job.name);
        for (;;) {
          try {
            await target.write(rel, data);
            break;
          } catch (err) {
            if (!(err instanceof DiskFullError)) throw err;
            const choice = await hooks.onDiskFull({ saved, total, needed: data.byteLength, file: job.name, checkFree: target.freeSpace });
            if (choice === 'stop') { run.status = 'stopped'; break; }
          }
        }
        if (run.status !== 'done') break;
        saved++;
        count++;
      }
      if (jobs.length === 0) empty.push(song.name);
      else if (count < jobs.length) incomplete.push(song.name);
      return count;
    });
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') { run.status = 'cancelled'; incomplete.push(song.name); continue; }
      if (err instanceof DiskFullError) throw err;
      // Uma música com problema não derruba a exportação das outras: segue e avisa no fim, com o motivo.
      console.warn('[bounce] falha na música', song.name, err);
      incomplete.push(`${song.name} — ${reasonOf(err)}`);
      continue;
    }
    if (songSaved > 0) songsSaved++;
  }

  if (saved === 0 && run.status === 'done') {
    throw new Error(!multi
      ? `"${songs[0].name}" não tem nenhuma faixa com áudio para exportar.`
      : req.scope === 'musica'
        ? 'Nenhuma das músicas marcadas tem faixas com áudio para exportar.'
        : 'Nenhuma música do projeto tem faixas com áudio para exportar.');
  }
  if (saved > 0) {
    report('Finalizando...', 0);
    await target.finish();
  }
  const revealRel = exportRevealPath(plan, req.mode, lrFileName);
  return {
    status: run.status,
    saved,
    total,
    songsSaved,
    songsTotal: songs.length,
    incomplete,
    empty,
    location: target.location,
    reveal: target.reveal && saved > 0 ? () => target.reveal!(revealRel) : null,
  };
}

// ---------------------------------------------------------------------------------------------
// Projeto .RPP: uma pasta com o .rpp e os áudios de cada faixa de cada música.

const MAESTRO_ROOT_ID = 'track-maestro';

/** A faixa Maestro e tudo dentro dela (gravado, Maestro por IA...): sai como uma faixa de áudio só. */
function maestroFamily(tracks: Track[]): Set<string> {
  const byId = new Map(tracks.map((t) => [t.id, t]));
  const ids = new Set<string>();
  for (const t of tracks) {
    let cur: Track | undefined = t;
    for (let depth = 0; cur && depth < 8; depth++) {
      if (cur.id === MAESTRO_ROOT_ID) { ids.add(t.id); break; }
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
  }
  return ids;
}

interface RppStem {
  /** Faixa do projeto onde o áudio entra (no Maestro, a faixa Maestro de cima). */
  rowId: string;
  name: string;
  timecode: boolean;
  render: () => Promise<{ data: ArrayBuffer; seconds: number; offset: number }>;
}

/**
 * Faixas separadas de uma música para o .RPP: cada faixa com áudio vira um WAV do tamanho da
 * música (no BPM e tom do show), com o fader em 0 dB e o balanço no centro, porque o volume, o
 * balanço e o mudo vão nas faixas do projeto. O Maestro inteiro vira um WAV só, com as subfaixas
 * dele já misturadas como estão no mixer (as que estão mudas ficam de fora).
 */
function rppStems(song: Song, state: ProjectState, frames: number, sampleRate: number, cancelled: () => boolean): RppStem[] {
  const songClips = state.clips.filter((c) => c.songId === song.id);
  const order = new Map(state.tracks.map((t, i) => [t.id, i]));
  const orphan = songClips.find((c) => !order.has(c.trackId));
  if (orphan) throw new Error(`O clipe "${orphan.name}" de "${song.name}" aponta para uma faixa inexistente. Corrija o roteamento antes de exportar.`);
  const maestro = maestroFamily(state.tracks);
  const stems: RppStem[] = [];

  const tc = songClips.filter((c) => isTimecodeTrackId(c.trackId)).sort((a, b) => a.startTime - b.startTime)[0];
  if (tc) {
    stems.push({
      rowId: tc.trackId,
      name: 'TIMECODE (LTC)',
      timecode: true,
      render: async () => {
        const buf = await timecodeBuffer(tc);
        return { data: encodeWavPcm24(buf), seconds: buf.duration, offset: Math.max(0, tc.startTime) };
      },
    });
  }

  const unity = state.tracks.map((t) => ({ ...t, volume: 0.8, pan: 0, antiClip: false }));
  const ids = Array.from(new Set(songClips.map((c) => c.trackId)))
    .filter((id) => !isTimecodeTrackId(id))
    .sort((a, b) => order.get(a)! - order.get(b)!);
  const rows = new Set<string>();
  for (const id of ids) rows.add(maestro.has(id) ? MAESTRO_ROOT_ID : id);
  for (const rowId of rows) {
    const row = state.tracks.find((t) => t.id === rowId);
    if (!row) continue;
    const isMaestro = rowId === MAESTRO_ROOT_ID;
    // no Maestro, as subfaixas mantêm o volume do mixer entre si, no centro; a de cima fica em 0 dB
    // (o balanço dela vai na faixa do projeto)
    const tracks = isMaestro
      ? state.tracks.map((t) => (t.id === MAESTRO_ROOT_ID ? { ...t, volume: 0.8, pan: 0, antiClip: false } : maestro.has(t.id) ? { ...t, pan: 0, antiClip: false } : t))
      : unity;
    const wanted = isMaestro
      ? (t: Track) => maestro.has(t.id) && (t.id === MAESTRO_ROOT_ID || !state.tracks.find((x) => x.id === t.id)?.mute)
      : (t: Track) => t.id === rowId;
    stems.push({
      rowId,
      name: row.name,
      timecode: false,
      render: async () => {
        const buf = await renderOffline(song, tracks, state.clips, false, wanted, false, cancelled, 0.8, 1, true);
        return { data: encodeWavPcm24(fitFrames(buf, frames)), seconds: frames / sampleRate, offset: 0 };
      },
    });
  }
  return stems;
}

/** Faixas do projeto na ordem do mixer, com as pastas; só entram as que têm áudio (ou subfaixas com áudio). */
function rppTrackTree(state: ProjectState, items: Map<string, RppOutItem[]>): RppOutTrack[] {
  const maestro = maestroFamily(state.tracks);
  // O LR Master e o LR mágico são jeitos de mandar guia e banda para lados diferentes ao vivo.
  // No projeto cada faixa já é separada: vale o balanço da mixagem (o de antes do LR mágico).
  const prevPans = state.magicRoutingActive ? (state as ProjectState & { prevOutputChannels?: Record<string, number> | null }).prevOutputChannels ?? null : null;
  const mixPan = (t: Track) => (prevPans && t.id in prevPans ? prevPans[t.id] : state.magicRoutingActive ? 0 : t.pan);
  const known = new Set(state.tracks.map((t) => t.id));
  const node = (t: Track): RppOutTrack | null => {
    const children = t.id === MAESTRO_ROOT_ID
      ? []
      : state.tracks.filter((c) => c.parentId === t.id && !maestro.has(c.id)).map(node).filter((n): n is RppOutTrack => !!n);
    const own = items.get(t.id) ?? [];
    if (own.length === 0 && children.length === 0) return null;
    const timecode = isTimecodeTrackId(t.id);
    return {
      name: timecode ? 'TIMECODE (LTC)' : t.name,
      volume: timecode ? 1 : faderToGain(t.volume),
      pan: timecode ? 0 : mixPan(t),
      // o timecode é um chiado para a mesa de luz/vídeo: vai mudo para não sair no alto-falante
      mute: timecode ? true : t.mute,
      solo: timecode ? false : t.solo,
      items: own,
      ...(children.length ? { children } : {}),
    };
  };
  return state.tracks
    .filter((t) => !t.parentId || !known.has(t.parentId))
    .map(node)
    .filter((n): n is RppOutTrack => !!n);
}

async function runRppExport(
  songs: Song[],
  folders: string[],
  plan: ReturnType<typeof planExport>,
  target: ExportTarget,
  state: ProjectState,
  hooks: ExportHooks,
): Promise<ExportResult> {
  const sampleRate = 48000;
  const slicesBySong = songs.map((s) => songOutSlices(s, state.clips, sampleRate));
  const frames = songs.map((s) => songOutFrames(s, state.clips, sampleRate));
  const starts = layoutSongs(frames.map((f) => f / sampleRate));
  const items = new Map<string, RppOutItem[]>();
  const tempo: RppOutTempo[] = [];
  const incomplete: string[] = [];
  const empty: string[] = [];
  const run: { status: ExportResult['status'] } = { status: 'done' };
  let total = songs.reduce((n, s) => n + new Set(state.clips.filter((c) => c.songId === s.id).map((c) => c.trackId)).size, 0) + 1;
  let saved = 0;
  let songsSaved = 0;
  const report = (label: string, part: number) =>
    hooks.onProgress({ fraction: total ? Math.min(1, (saved + part) / total) : 0, label, saved, total, location: target.location });

  report('Preparando...', 0);

  /** Grava um arquivo; com o disco cheio, pergunta e tenta de novo. false = a pessoa encerrou. */
  const writeFile = async (rel: string, data: ArrayBuffer, name: string): Promise<boolean> => {
    for (;;) {
      try {
        await target.write(rel, data);
        return true;
      } catch (err) {
        if (!(err instanceof DiskFullError)) throw err;
        const choice = await hooks.onDiskFull({ saved, total, needed: data.byteLength, file: name, checkFree: target.freeSpace });
        if (choice === 'stop') { run.status = 'stopped'; return false; }
      }
    }
  };

  for (let si = 0; si < songs.length; si++) {
    const song = songs[si];
    const start = starts[si];
    // andamento de cada música no começo dela (vale mesmo se o áudio dela falhar: o tempo fica certo)
    let outAt = start;
    const slices: TempoSlice[] = slicesBySong[si].map((sl) => {
      const t = { srcStart: sl.srcStart, srcEnd: sl.srcEnd, alpha: sl.alpha, outStart: outAt };
      outAt += sl.frames / sampleRate;
      return t;
    });
    tempo.push(...songTempoPoints(song, slices));

    const songLabel = songs.length > 1 ? `Música ${si + 1} de ${songs.length} – ${song.name}` : song.name;
    if (run.status !== 'done') { incomplete.push(song.name); continue; }
    report(`${songLabel} · carregando áudio`, 0);
    try {
      const done = await withSongAudio(song.id, async () => {
        const stems = rppStems(song, state, frames[si], sampleRate, hooks.cancelled);
        const guess = new Set(state.clips.filter((c) => c.songId === song.id).map((c) => c.trackId)).size;
        total += stems.length - guess;
        const used = new Map<string, number>();
        let count = 0;
        for (const stem of stems) {
          if (hooks.cancelled()) { run.status = 'cancelled'; break; }
          report(`${songLabel} · ${stem.name}`, 0);
          let out: { data: ArrayBuffer; seconds: number; offset: number };
          try {
            out = await stem.render();
          } catch (err) {
            if ((err as DOMException)?.name === 'AbortError') { run.status = 'cancelled'; break; }
            throw err;
          }
          if (hooks.cancelled()) { run.status = 'cancelled'; break; }
          const base = rppFileName(stem.name);
          let n = 1;
          let name = base;
          while (used.has(name.toLowerCase())) name = `${base} (${++n})`;
          used.set(name.toLowerCase(), 1);
          const file = `${name}.wav`;
          const rel = `Audio/${folders[si]}/${file}`;
          report(`${songLabel} · salvando ${file}`, 0.9);
          if (!(await writeFile(`${plan.baseRel}${rel}`, out.data, file))) break;
          const songSeconds = frames[si] / sampleRate;
          const length = stem.timecode ? Math.min(out.seconds, Math.max(0.01, songSeconds - out.offset)) : out.seconds;
          const list = items.get(stem.rowId) ?? [];
          // "volume igual entre os VS": o ajuste da música vai no volume do item, só na banda
          const volume = stem.timecode || isFixedLevelTrack(stem.rowId, state.tracks) ? 1 : songLevelGain(state, song.id);
          list.push({ name: `${song.name} - ${stem.name}`, position: start + out.offset, length, file: rel, volume });
          items.set(stem.rowId, list);
          saved++;
          count++;
        }
        if (stems.length === 0) empty.push(song.name);
        else if (count < stems.length) incomplete.push(song.name);
        return count;
      });
      if (done > 0) songsSaved++;
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') { run.status = 'cancelled'; incomplete.push(song.name); continue; }
      if (err instanceof DiskFullError) throw err;
      console.warn('[bounce] falha na música', song.name, err);
      incomplete.push(`${song.name} — ${reasonOf(err)}`);
    }
  }

  const baseDir = plan.baseRel.replace(/\/$/, '');
  if (run.status === 'cancelled') {
    return { status: 'cancelled', saved, total, songsSaved, songsTotal: songs.length, incomplete, empty, location: target.location, reveal: null };
  }
  if (saved === 0 && run.status === 'done') {
    throw new Error(songs.length === 1 ? `"${songs[0].name}" não tem nenhuma faixa com áudio para exportar.` : 'Nenhuma das músicas tem faixas com áudio para exportar.');
  }

  // o .rpp vai por último: só aponta para os áudios que foram mesmo gravados
  const rpp = buildRpp({
    sampleRate,
    timestamp: Math.floor(Date.now() / 1000),
    tempo,
    regions: songs.map((s, i) => ({ name: s.name, start: starts[i], end: starts[i] + frames[i] / sampleRate })),
    tracks: rppTrackTree(state, items),
    masterVolume: faderToGain(state.masterVolume),
  });
  const rppName = `${rppFileName(baseDir.replace(/ - PROJETO RPP$/, '')) || 'Projeto'}.rpp`;
  report(`Salvando ${rppName}...`, 0.5);
  const bytes = new TextEncoder().encode(rpp);
  const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  if (run.status === 'done' || run.status === 'stopped') {
    const prev = run.status;
    run.status = 'done';
    const ok = await writeFile(`${plan.baseRel}${rppName}`, data, rppName);
    if (ok) saved++;
    run.status = ok ? prev : 'stopped';
  }
  report('Finalizando...', 0);
  await target.finish();
  return {
    status: run.status,
    saved,
    total,
    songsSaved,
    songsTotal: songs.length,
    incomplete,
    empty,
    location: target.location,
    reveal: target.reveal && saved > 0 ? () => target.reveal!(baseDir) : null,
  };
}
