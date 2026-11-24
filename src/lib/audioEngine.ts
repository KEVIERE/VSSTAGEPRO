import { useStore } from '@/store';
import { bpmAdjustToAlpha, stretchClipAudio, tempoFromBpm } from '@/lib/timeStretch';
import { waveformPeaks } from '@/lib/waveformPeaks';
import { computeNextSongId } from '@/lib/playFlow';
import { getClipPlayerWorkletUrl } from '@/lib/clipPlayerWorklet';
import { clipPlayLength, ensureSongLoaded, getClipAudio, onAudioLibraryCleared, getClipPlayAudio, getClipSource, isSongLoaded, loadFailure, missingClipIds, openClipAudio, putClipAudio, retainSongs } from '@/lib/audioLibrary';
import { deviceSampleRate } from '@/lib/audioDecoder';
import { loadHeads, loadStretchedHeads, wantsStretchedHead } from '@/lib/instantStart';
import { audioStreamer, diskStreamer, DISK_CHUNK_FRAMES, PRIORITY_NEXT, PRIORITY_ON_AIR } from '@/lib/audioStreamer';
import type { DiskHandle, InitialWindow, RangeReader, StreamHandle } from '@/lib/audioStreamer';
import { openRangeReader, openRangeReaders } from '@/lib/diskSource';
import type { HeadAudio, StretchedHead } from '@/lib/instantStart';
import { entryExists, markUsed, readEntry, readyDir, renderedName, writeEntry } from '@/lib/readyStore';
import { sortedRegions } from '@/lib/regions';
import { isFixedLevelTrack, songLevelGain } from '@/lib/songLevel';
import { entryPoint, hasSliceParams, medleySlices, paramsAt, playableEnd, skipJumpAt, sliceParams } from '@/lib/medley';
import { publishMeters, resetMeters } from '@/lib/meterBus';
import { isTimecodeTrackId, masterSilenced, NO_OUTPUT, TIMECODE_TRACK_ID } from '@/lib/timecode';
import { interfaceMissing, resolveMasterOutput, resolveRoute, type MasterOutput } from '@/lib/outputRoute';
import { TimecodePlayer } from '@/lib/timecodePlayer';
import { LoudnessWindow, kWeightingNodes } from '@/lib/loudnessMeter';
import { AntiClipInsert, antiClipActive, loadPeakLimiter } from '@/lib/antiClip';
import { isUserInteracting } from '@/lib/interactionTracker';
import { iniciarAudioDiag, registrarDiag } from '@/lib/audioDiag';
import { MAESTRO_IA_TRACK_ID } from '@/lib/narrations';
import { canRestampSignature, clipsToAttachLive } from '@/lib/liveAttach';
import { placeRemountOnGrid, quietSwapFrame } from '@/lib/clickRemount';
import { remountClickAudio, type ClickRemount } from '@/lib/clickRemountClient';
import { measureStep, nominalStretchLeadMs, reduceForMeasure } from '@/lib/stretchLatency';
import { evaluateFadeCurve } from '@/types';
import type { AudioClip, Song, SongRegion, Track } from '@/types';
import type { ClipAudio } from '@/lib/audioLibrary';

const RETIME_LEAD = 0.06;
/** Salto de loop mais perto que isto de uma troca de BPM/tom acontece primeiro, e a troca vem logo depois. */
const RETIME_JUMP_GAP = 0.005;
// Medidas guardadas do adiantamento do SoundTouch (uma por faixa e andamento).
const STRETCH_LEADS_MAX = 512;
// Pedaço da cópia reduzida feito de uma vez na thread da tela: 5 s de áudio, cerca de 1 ms de trabalho.
const REDUCE_PIECE_FRAMES = 30000;
const LEAD_WORKER_IDLE_MS = 30_000;
const METER_FFT = 2048;
export const MAGIC_SUM_GAIN = 0.5;
// Trecho lido do disco antes de largar. Os primeiros ~0,7 s seguram o Play (como antes); mais um
// pedaço (DISK_CHUNK_FRAMES, ~1,4 s) é lido logo em seguida e entra junto se chegar dentro de
// START_EXTRA_WAIT_MS. Só quando a primeira leitura voltou rápido (START_FAST_FIRST_MS).
// Com só 0,7 s no reprodutor, uma trava da tela logo depois do Play (menu, Modo show) deixava a
// faixa sem dado antes de o leitor antecipado entregar o próximo trecho: o som engasgava.
const START_FIRST_SECONDS = 0.7;
const START_WINDOW_SECONDS = 4;
// Espera máxima pelo resto da janela: além disso o Play sairia perceptivelmente mais lento, e o
// leitor antecipado (prioridade da música no ar) busca o que faltar logo depois.
const START_EXTRA_WAIT_MS = 50;
// Primeira leitura (todas as faixas) mais lenta que isso: o leitor é lento (conversão de taxa) e o
// extra não chegaria a tempo; só atrasaria o leitor antecipado.
const START_FAST_FIRST_MS = 80;
// Clipes que começam mais que isso depois do ponto de Play ficam fora da leitura da largada.
const START_SKIP_AHEAD_S = 8;
// Quanto o Play espera um preparo da mesma música que já está em andamento.
const PLAY_WAITS_PREPARE_MS = 500;

/**
 * Trechos da largada de cada faixa, na ordem: o primeiro e, logo depois dele, o extra que chegou
 * a tempo (cada um do jeito que veio do leitor, sem juntar num bloco novo).
 */
function windowsOf(first: Map<string, InitialWindow>, extra: Map<string, Int16Array[]>): Map<string, InitialWindow[]> {
  const out = new Map<string, InitialWindow[]>();
  for (const [id, w] of first) {
    const list: InitialWindow[] = [w];
    const more = extra.get(id);
    if (more?.[0]?.length) list.push({ start: w.start + (w.channels[0]?.length ?? 0), channels: more });
    out.set(id, list);
  }
  return out;
}

// Margem da troca do começo ajustado (BPM/tom) para o áudio inteiro: o timer roda na tela, e com
// 1,5 s uma trava maior que isso deixava todas as faixas mudas no fim do trecho ajustado.
const HANDOFF_MARGIN_SECONDS = 4;
// Folga do horário da troca: o aviso vai a todas as faixas antes de o horário chegar.
const HANDOFF_LEAD = 0.2;
// Depois de um Play, por quanto tempo as análises de fundo esperam (ver isSettling).
const SETTLE_MS = 5000;
// Depois da troca cruzada do LR mágico (rampa de 15 ms), quando a entrada do caminho fechado sai.
const PATH_PARK_MS = 50;

/** Dois caminhos montados [normal, separado]; só o ativo fica com a entrada ligada. */
interface PathSwitch {
  gates: [GainNode, GainNode];
  /** Ligação de entrada de cada caminho: [origem, destino]. */
  links: [[AudioNode, AudioNode], [AudioNode, AudioNode]];
  linked: [boolean, boolean];
  timer: ReturnType<typeof setTimeout> | null;
}

import { directOutFaderGain, faderToGain } from '@/lib/faderScale';
import { lateClipIds, setDiskLag } from '@/lib/diskLag';
export { faderToGain };

export function volumeToDb(volume: number): number {
  if (volume <= 0.0001) return -Infinity;
  return 20 * Math.log10(faderToGain(volume));
}

// Limiter de segurança de masterização (brickwall transparente, estilo broadcast/live-sound):
// protege o master de qualquer estouro/distorção sem "maximizar" ou alterar o volume percebido.
// Ratio 20:1 é o máximo da Web Audio API — na prática funciona como um limiter, não um compressor normal.
export function createSafetyLimiter(ctx: BaseAudioContext): DynamicsCompressorNode {
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -1;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.15;
  return limiter;
}

// Trilhas não-melódicas: apenas bateria, percussões, click e maestro não sofrem transposição de tom (tuner).
// A faixa "Guia" (voz guia) É melódica e deve transpor junto com a música quando o tuner for alterado.
const NON_MELODIC_ROOTS = new Set(['track-bateria', 'track-percussoes', 'track-click', 'track-maestro']);

/**
 * Fala do Maestro (a voz do maestro por IA e a régua das falas): entram quase sem rampa, para a
 * primeira sílaba cair exatamente na linha da grade, junto com o click.
 */
export function isSpeechTrack(track: Track): boolean {
  return track.id === MAESTRO_IA_TRACK_ID || track.parentId === 'track-maestro';
}

/**
 * Faixas que entram quase secas no Play (0,2 ms): fala do Maestro e Click. Com a rampa normal
 * (10 a 20 ms) o primeiro click saía abafado, porque o som dele chega no pico em ~7 ms.
 */
export function entersDry(track: Track): boolean {
  // a faixa Maestro de cima também é fala (gravada ou o Maestro IA consolidado)
  return isSpeechTrack(track) || track.id === 'track-maestro' || track.id === 'track-click' || track.parentId === 'track-click';
}

/**
 * Rampa de entrada (em amostras) de uma faixa que começa a tocar. O click sempre entra seco: o som
 * dele chega ao pico em ~7 ms, e uma rampa maior abafa e atrasa a batida em que a pessoa entrou.
 * Fala entra seca no Play e com 5 ms num pulo (cair no meio de uma sílaba não pode estalar).
 */
export function entryFadeFrames(track: Track | undefined, normal: number, fast: boolean): number {
  if (track && (track.id === 'track-click' || track.parentId === 'track-click')) return 10;
  if (track && entersDry(track)) return fast ? 256 : 10;
  return normal;
}

export function isMelodicTrack(track: Track, all: Track[]): boolean {
  let t: Track | undefined = track;
  while (t) {
    if (NON_MELODIC_ROOTS.has(t.id)) return false;
    t = t.parentId ? all.find((x) => x.id === t!.parentId) : undefined;
  }
  return true;
}

function chainHas(track: Track, allTracks: Track[], pred: (t: Track) => boolean): boolean {
  let t: Track | undefined = track;
  while (t) {
    if (pred(t)) return true;
    t = t.parentId ? allTracks.find((x) => x.id === t!.parentId) : undefined;
  }
  return false;
}

function treeHasSolo(track: Track, allTracks: Track[]): boolean {
  if (track.solo) return true;
  const fromChildren = track.children.some((id) => {
    const c = allTracks.find((x) => x.id === id);
    return c ? treeHasSolo(c, allTracks) : false;
  });
  if (fromChildren) return true;
  return allTracks.some((c) => c.parentId === track.id && treeHasSolo(c, allTracks));
}

const isStemClip = (c: AudioClip) => !isTimecodeTrackId(c.trackId);
const isClickTrack = (track: Track | undefined) => !!track && (track.id === 'track-click' || track.parentId === 'track-click');
/** Andamentos remontados do click que cada música pede (música atual e fatias do medley). */
const CLICK_TEMPOS_MAX = 4;
/** Memória máxima do estoque de click remontado. Item da música no ar ou em preparo nunca sai. */
const CLICK_STOCK_BYTES = 320 * 1024 * 1024;
/** O salto do loop tem de estar pelo menos isto depois da troca do click; senão a troca espera ele passar. */
const CLICK_SWAP_GUARD = 0.03;
/** Play com BPM/tom alterados espera até isto pelo click remontado, para a primeira batida não passar pelo SoundTouch. */
const CLICK_STOCK_WAIT_MS = 450;

export function channelGainFor(track: Track, allTracks: Track[], volume: number): number {
  // o timecode só obedece ao próprio mudo: solo e mudo das outras faixas não o calam
  if (isTimecodeTrackId(track.id)) return track.mute ? 0 : faderToGain(volume);
  const anySolo = allTracks.some((t) => t.solo && !isTimecodeTrackId(t.id));
  const inSoloChain = chainHas(track, allTracks, (t) => t.solo) || treeHasSolo(track, allTracks);
  // Padrão de estúdio (Logic Pro / Pro Tools): Solo SEMPRE vence Mudo na própria faixa/grupo —
  // soar uma faixa que ficou muda antes (ex.: trilha de ambiência mutada por padrão pela IA)
  // precisa tocar imediatamente, sem precisar desligar o mudo manualmente primeiro.
  if (inSoloChain) return faderToGain(volume);
  const audible = !anySolo && !chainHas(track, allTracks, (t) => t.mute);
  return audible ? faderToGain(volume) : 0;
}

// Ganho do modo DAW por clipe (gain/mute/solo): sempre vale na reprodução e na
// exportação, independente do DAW estar ligado para edição — ligar/desligar o DAW só
// mostra ou esconde os controles. Solo de clipe é restrito à própria música (como o
// solo de faixa é restrito à mixagem inteira), senão um solo isolado silenciaria shows
// com várias músicas abertas ao mesmo tempo.
// Padrão de estúdio: Solo sempre vence Mudo no próprio clipe (mesma regra de channelGainFor).
export function clipGainFor(clip: AudioClip, songClips: AudioClip[]): number {
  if (clip.solo) return clip.gain ?? 1;
  if (clip.mute) return 0;
  const anySolo = songClips.some((c) => c.solo);
  if (anySolo && !clip.solo) return 0;
  return clip.gain ?? 1;
}

// Agenda a rampa de fade in/out do clipe no próprio clipGain, por cima do ganho base
// (faixa × clipe). Entra em vigor a partir de "agora" (currentTime), cobrindo tanto o
// início normal do clipe quanto pular/retroceder para dentro do meio de um fade — nesse
// caso calcula quanto da rampa já passou e agenda só o resto, sem salto de volume.
// "local"/playDuration/localOffset ficam em segundos de música (mesma unidade de
// clip.fadeIn/fadeOut/duration); whenWall é o relógio real do contexto. alpha converte
// delta de música em delta de relógio (wall = música × alpha), igual ao resto da engine.
// glide > 0 (fader, mudo ou solo mexidos com o clipe tocando): em vez de pular para o valor novo,
// desliza do volume atual até ele nesse tempo e segue o fade a partir dali, sem estalo.
// from: reagenda só a partir desse instante (salto de loop ou troca de BPM já marcados). O que
// está agendado antes dele continua valendo: até ali a música segue no relógio antigo.
function scheduleClipFade(
  clipGain: GainNode,
  ctx: BaseAudioContext,
  baseGain: number,
  clip: AudioClip,
  playDuration: number,
  playbackStartTime: number,
  alpha: number,
  glide = 0,
  from?: number,
) {
  const fadeIn = Math.max(0, clip.fadeIn ?? 0);
  const fadeOut = Math.max(0, clip.fadeOut ?? 0);
  const now = from === undefined ? ctx.currentTime : Math.max(from, ctx.currentTime);
  try {
    // rampa em andamento que atravessa o instante fica cortada nele, no valor que ela teria ali
    if (from !== undefined && clipGain.gain.cancelAndHoldAtTime) clipGain.gain.cancelAndHoldAtTime(now);
    else clipGain.gain.cancelScheduledValues(now);
  } catch { /* ignore */ }

  const clipWallStart = playbackStartTime + clip.startTime * alpha;
  const clipWallEnd = clipWallStart + playDuration * alpha;

  if (fadeIn <= 0 && fadeOut <= 0) {
    if (now < clipWallStart) {
      try {
        clipGain.gain.setValueAtTime(0, now);
        clipGain.gain.setValueAtTime(baseGain, clipWallStart);
        clipGain.gain.setValueAtTime(0, clipWallEnd);
      } catch {
        clipGain.gain.value = baseGain;
      }
    } else if (now < clipWallEnd) {
      try {
        clipGain.gain.setValueAtTime(baseGain, now);
        clipGain.gain.setValueAtTime(0, clipWallEnd);
      } catch {
        clipGain.gain.value = baseGain;
      }
    } else {
      try { clipGain.gain.setValueAtTime(0, now); } catch { clipGain.gain.value = 0; }
    }
    return;
  }

  const fadeOutStartOffset = Math.max(fadeIn, playDuration - fadeOut);
  const wallFadeInEnd = clipWallStart + fadeIn * alpha;
  const wallFadeOutStart = clipWallStart + fadeOutStartOffset * alpha;

  const curveIn = clip.fadeCurveIn ?? 'linear';
  const curveOut = clip.fadeCurveOut ?? 'linear';

  // Se o ponto de reprodução ainda não alcançou o início do clipe:
  if (now + glide < clipWallStart) {
    try {
      // 1. Silêncio antes do clipe começar (NUNCA vaza áudio antes do início do clipe!)
      clipGain.gain.setValueAtTime(0, now);
      // 2. No exato instante em que o clipe começa, crava em 0
      clipGain.gain.setValueAtTime(0, clipWallStart);

      // 3. Rampa exata do Fade In: inicia no início do clipe e dura o tamanho do fade
      if (fadeIn > 0) {
        const STEPS = curveIn === 'linear' ? 1 : 16;
        for (let i = 1; i <= STEPS; i++) {
          const frac = i / STEPS;
          const t = clipWallStart + frac * fadeIn * alpha;
          const g = evaluateFadeCurve(curveIn, frac, true) * baseGain;
          clipGain.gain.linearRampToValueAtTime(g, t);
        }
      } else {
        clipGain.gain.setValueAtTime(baseGain, clipWallStart);
      }

      // 4. Platô: mantém baseGain do fim do Fade In até o início do Fade Out
      if (fadeOut > 0 && wallFadeOutStart > wallFadeInEnd) {
        clipGain.gain.setValueAtTime(baseGain, wallFadeOutStart);
      }

      // 5. Rampa exata do Fade Out
      if (fadeOut > 0) {
        const STEPS = curveOut === 'linear' ? 1 : 16;
        for (let i = 1; i <= STEPS; i++) {
          const frac = i / STEPS;
          const t = wallFadeOutStart + frac * fadeOut * alpha;
          const g = evaluateFadeCurve(curveOut, frac, false) * baseGain;
          clipGain.gain.linearRampToValueAtTime(g, t);
        }
      } else {
        clipGain.gain.setValueAtTime(0, clipWallEnd);
      }
    } catch {
      clipGain.gain.value = baseGain;
    }
    return;
  }

  // Se já estamos dentro da reprodução do clipe (com glide, o ponto de referência é o fim do deslize):
  const ref = now + Math.max(0, glide);
  const currentOffset = (ref - clipWallStart) / alpha;
  let currentG = baseGain;
  if (currentOffset < fadeIn && fadeIn > 0) {
    currentG = evaluateFadeCurve(curveIn, currentOffset / fadeIn, true) * baseGain;
  } else if (currentOffset >= fadeOutStartOffset && fadeOut > 0) {
    const frac = Math.min(1, (currentOffset - fadeOutStartOffset) / fadeOut);
    currentG = evaluateFadeCurve(curveOut, frac, false) * baseGain;
  } else if (currentOffset >= playDuration) {
    currentG = 0;
  }

  try {
    if (ref > now) {
      clipGain.gain.setValueAtTime(clipGain.gain.value, now);
      clipGain.gain.linearRampToValueAtTime(currentG, ref);
    } else {
      clipGain.gain.setValueAtTime(currentG, now);
    }

    // Continua o Fade In restante se estivermos no meio dele
    if (ref < wallFadeInEnd && fadeIn > 0) {
      const STEPS = curveIn === 'linear' ? 1 : 16;
      for (let i = 1; i <= STEPS; i++) {
        const frac = i / STEPS;
        const t = clipWallStart + frac * fadeIn * alpha;
        if (t > ref) {
          const g = evaluateFadeCurve(curveIn, frac, true) * baseGain;
          clipGain.gain.linearRampToValueAtTime(g, t);
        }
      }
    }

    // Platô até o Fade Out
    if (fadeOut > 0 && wallFadeOutStart > ref) {
      clipGain.gain.setValueAtTime(baseGain, wallFadeOutStart);
    }

    // Fade Out
    if (fadeOut > 0 && ref < clipWallEnd) {
      const STEPS = curveOut === 'linear' ? 1 : 16;
      for (let i = 1; i <= STEPS; i++) {
        const frac = i / STEPS;
        const t = wallFadeOutStart + frac * fadeOut * alpha;
        if (t > ref) {
          const g = evaluateFadeCurve(curveOut, frac, false) * baseGain;
          clipGain.gain.linearRampToValueAtTime(g, t);
        }
      }
    } else if (ref < clipWallEnd) {
      clipGain.gain.setValueAtTime(0, clipWallEnd);
    }
  } catch {
    clipGain.gain.value = baseGain;
  }
}

interface ChannelNode {
  gain: GainNode;
  panner: StereoPannerNode;
  /** Volume igual entre os VS: ganho da música no ar, depois do fader e antes do medidor. */
  level: GainNode;
  /** Anti-clip: limitador de pico (-0,1 dBFS) entre o nível e o medidor, liga e desliga por canal. */
  antiClip: AntiClipInsert;
  analyser: AnalyserNode;
  source: AudioBufferSourceNode | null;
  /** Separa L/R do canal quando ele sai num par estéreo da interface */
  splitter?: ChannelSplitterNode;
  /** Medidor estéreo: o sinal do canal separado em L e R, cada lado com o seu analisador */
  meterSplit: ChannelSplitterNode;
  meterL: AnalyserNode;
  meterR: AnalyserNode;
}

interface ActiveClip {
  node: AudioWorkletNode;
  clipStartTime: number;
  scheduledStartWall: number;
  durationSeconds: number;
  sampleRate: number;
  bufferLength: number;
  clipGain: GainNode;
  clipPanner: StereoPannerNode | null;
  trackId: string;
}

interface PreparedPending {
  clipId: string;
  node: AudioWorkletNode;
  clipStartTime: number;
  clipDuration: number;
  ready: Promise<void>;
  sampleRate: number;
  bufferLength: number;
  clipGain: GainNode;
  clipPanner: StereoPannerNode | null;
  trackId: string;
}

interface PreparedBundle {
  songId: string;
  signature: string;
  /** Reprodutores alimentados direto do disco (a música não precisa estar aberta na memória). */
  disk?: boolean;
  pending: PreparedPending[];
  /** Estado e identidade da fonte na criação do reprodutor. */
  snapshots: Map<string, { audio: ReturnType<typeof getClipAudio>; trimStart: number; duration: number; trackId: string }>;
}

function effectivePan(trackId: string, trackPan: number, lrActive: boolean): number {
  if (isTimecodeTrackId(trackId)) return 0;
  if (!lrActive) return trackPan;
  if (trackId === 'track-guia' || trackId === 'track-click' || trackId === 'track-maestro') return -1;
  return 1;
}

// Com BPM ou tom fora do original, todas as faixas passam pelo mesmo processamento (mesmo atraso).
function songNeedsProcessing(song: Song | undefined): boolean {
  if (!song) return false;
  if ((song.bpmAdjust ?? 0) !== 0 || song.tuner !== 0) return true;
  return !!song.medley?.some((p) => (p.bpmAdjust ?? 0) !== 0 || (p.tuner ?? 0) !== 0);
}

/** O que muda o som de uma música ao vivo: BPM e tom dela e de cada fatia do medley. */
function playbackKey(song: Song): string {
  return `${song.bpmAdjust ?? 0}|${song.tuner}|${(song.medley ?? []).map((p) => `${p.id}:${p.bpmAdjust ?? ''}:${p.tuner ?? ''}`).join(',')}`;
}

function pitchFromCents(cents: number): number {
  return Math.pow(2, cents / 1200);
}

/** Tom aplicado a uma faixa: bateria, percussão, click e guia nunca mudam de tom. */
export function headPitchFor(clip: AudioClip): number {
  const { songs, tracks } = useStore.getState();
  const track = tracks.find((t) => t.id === clip.trackId);
  if (track && !isMelodicTrack(track, tracks)) return 1;
  return pitchFromCents((songs.find((s) => s.id === clip.songId)?.tuner ?? 0) * 100);
}

const STABLE_MODE_LS = 'vs_stable_audio';
const RENDER_CONCURRENCY = Math.min(8, Math.max(2, (navigator.hardwareConcurrency || 4) - 1));
const RENDER_DELAY_MS = 350;
const RENDER_TIMEOUT_MS = 60_000;
interface SongNode {
  clipId: string;
  node: AudioWorkletNode;
  trackId: string;
}

class AudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private masterLimiter: DynamicsCompressorNode | null = null;
  private masterAnalyser: AnalyserNode | null = null;
  private meterSmoothed = new Map<string, number>();
  // Medidores leem 2048 amostras (~43 ms) a cada ~33 ms: nenhuma amostra fica sem ser vista.
  // Com 256 eles enxergavam só ~16% do sinal, perdiam picos e o anti-clip baixava de menos.
  private meterScratch = new Float32Array(METER_FFT);
  // Pico do master ANTES do limiter de segurança: é ele que diz se o master está estourando
  // (depois do limiter o sinal nunca passa do teto, e o clip nunca aparecia).
  private masterPreAnalyser: AnalyserNode | null = null;
  private meterLastUpdate = new Map<string, number>();
  private channels: Map<string, ChannelNode> = new Map();
  private meterInterval: number | null = null;
  private clipGains = new Map<string, GainNode>();
  private clipPanners = new Map<string, StereoPannerNode>();
  private activeClips = new Map<string, ActiveClip>();
  private playbackStartTime = 0;
  private playbackOffset = 0;
  private isPlaying = false;
  private currentSongId: string | null = null;
  private songEndTimeout: number | null = null;
  private playbackAlpha = 1;
  private playbackCents = 0;
  private playGeneration = 0;
  private workletReady: Promise<void> | null = null;
  private seekLock: { active: boolean; targetTime: number } = { active: false, targetTime: 0 };
  private seekRequest = 0;
  private prepared: Map<string, PreparedBundle> = new Map();
  private preparing: Map<string, Promise<void>> = new Map();
  private stableMode = localStorage.getItem(STABLE_MODE_LS) !== '0';
  // placa escolhida pelo usuário; null = segue a saída padrão do Mac
  private sinkId: string | null = null;
  // placa padrão do Mac em que o áudio foi fixado enquanto não há placa escolhida
  private defaultSinkId: string | null = null;
  private nodeRenderKey = new WeakMap<AudioWorkletNode, string>();
  private renderTimers = new Map<string, number>();
  private renderRuns = new Map<string, number>();
  private renderingSongs = new Map<string, { done: number; total: number }>();
  // Evita repetir o mesmo aviso de áudio ausente a cada nova tentativa da mesma música no ar.
  private warnedSongs = new Map<string, number>();
  // A música no ar ainda toca só pelo começo pronto (o áudio inteiro está abrindo).
  private headOnly = false;
  // Clipes que já terminaram de tocar nesta passada (drained no worklet)
  private endedClips = new Set<string>();
  // As faixas no ar ainda leem o começo já ajustado.
  private partialActive = false;
  private partialTimer: number | null = null;
  private outputMerger: ChannelMergerNode | null = null;
  private masterSplitter: ChannelSplitterNode | null = null;
  private masterRouteKey: string | null = null;
  private masterMeterL: AnalyserNode | null = null;
  private masterMeterR: AnalyserNode | null = null;
  private outputCount = 2;
  private routedTo = new Map<string, string>();
  private timecode: TimecodePlayer | null = null;
  private timecodeClipId: string | null = null;
  // Entrega em andamento do áudio de cada reprodutor (ver audioStreamer).
  private feeds = new Map<AudioWorkletNode, StreamHandle>();
  // Reprodutores que largaram pelo começo pronto e já receberam o áudio inteiro.
  private headFed = new WeakMap<AudioWorkletNode, ClipAudio>();
  // Faixas no ar que ficaram sem dado a tempo (o áudio chegou atrasado do disco) e desde quando.
  private starvedSince = new Map<string, number>();
  private starvedTimer: ReturnType<typeof setTimeout> | null = null;

  private createPlayer(ctx: AudioContext, totalFrames: number, options: Record<string, unknown>): AudioWorkletNode {
    const node = new AudioWorkletNode(ctx, 'clip-player', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      processorOptions: { totalFrames, ...options },
    });
    node.onprocessorerror = () => this.handleDeadPlayer(node);
    return node;
  }

  /** Passa a entregar o áudio ao reprodutor em trechos, começando por `fromFrame`. */
  private feed(node: AudioWorkletNode, audio: ClipAudio, fromFrame: number, priority: number, options?: { totalFrames?: number; availableFrames?: number }): StreamHandle {
    this.feeds.get(node)?.cancel();
    const target = options?.totalFrames !== undefined ? { channels: audio.channels, length: options.totalFrames } : audio;
    const handle = audioStreamer.start(node.port, target, { from: fromFrame, priority, availableFrames: options?.availableFrames });
    this.feeds.set(node, handle);
    void handle.done.then(() => { if (this.feeds.get(node) === handle) this.feeds.delete(node); });
    return handle;
  }

  // Músicas cujos reprodutores leem direto do disco, e quando a do ar terminou de chegar.
  private diskSongs = new Set<string>();
  private onAirDiskDone: { songId: string; done: Promise<void> } | null = null;

  private feedDisk(node: AudioWorkletNode, reader: RangeReader, fromFrame: number, priority: number, initial?: InitialWindow[]): DiskHandle {
    this.feeds.get(node)?.cancel();
    const handle = diskStreamer.start(node.port, reader, { from: fromFrame, priority, initial });
    this.feeds.set(node, handle);
    void handle.done.then(() => { if (this.feeds.get(node) === handle) this.feeds.delete(node); });
    return handle;
  }

  /** Assinatura de um preparo lido do disco: só o que está na timeline, sem precisar do áudio aberto. */
  private diskSignature(songId: string): string | null {
    const store = useStore.getState();
    const song = store.songs.find((s) => s.id === songId);
    if (!song) return null;
    const clips = store.clips.filter((c) => c.songId === songId && isStemClip(c)).sort((a, b) => a.id.localeCompare(b.id));
    if (clips.length === 0) return null;
    return `disk|${song.bpmAdjust}|${song.tuner}|` + clips.map((c) => `${c.id}|${c.trackId}|${c.startTime.toFixed(4)}|${c.duration.toFixed(4)}|${(c.trimStart ?? 0).toFixed(4)}|${(c.trimEnd ?? 0).toFixed(4)}|${c.gain ?? 1}|${c.mute ? 1 : 0}|${c.solo ? 1 : 0}|${(c.fadeIn ?? 0).toFixed(3)}|${(c.fadeOut ?? 0).toFixed(3)}|${c.fadeCurveIn ?? 'linear'}|${c.fadeCurveOut ?? 'linear'}|${getClipSource(c.id)?.size ?? 0}`).join('~');
  }

  private bundleSignature(songId: string, bundle: PreparedBundle | null | undefined): string | null {
    return bundle?.disk ? this.diskSignature(songId) : this.computePrepareSignature(songId);
  }

  /** Lê já o trecho da largada de cada faixa (a música anterior segue tocando enquanto isso). */
  private async readStartWindows(clips: AudioClip[], readers: Map<string, RangeReader>, startOffset: number) {
    const out = new Map<string, InitialWindow>();
    const firstLen = new Map<string, number>();
    const t0 = performance.now();
    await Promise.all(clips.map(async (clip) => {
      const r = readers.get(clip.id);
      if (!r) return;
      // clipe que só entra bem depois do ponto de Play (falas do Maestro lá na frente): o leitor
      // antecipado busca na hora dele. Ler agora só disputava o disco com as faixas da largada.
      if (clip.startTime - startOffset > START_SKIP_AHEAD_S) return;
      const from = Math.min(r.length, Math.floor(Math.max(0, startOffset - clip.startTime) * r.sampleRate));
      if (from >= r.length) return;
      const want = Math.max(1, Math.round(START_FIRST_SECONDS * r.sampleRate));
      try {
        out.set(clip.id, { start: from, channels: await r.read(from, want) });
        firstLen.set(clip.id, want);
      } catch { /* o leitor antecipado tenta de novo */ }
    }));
    const firstMs = performance.now() - t0;
    const extra = new Map<string, Int16Array[]>();
    // Leitura lenta (WAV em outra taxa, convertido nos 2 workers do wavReader, ou disco ocupado):
    // pular o extra. Ele chegaria tarde, seria descartado e ainda ocuparia os workers na frente
    // dos primeiros trechos que o leitor antecipado pede logo depois do Play.
    if (firstMs >= START_FAST_FIRST_MS) {
      registrarDiag({ tipo: 'largada', duracaoMs: 0, leituraMs: firstMs });
      return windowsOf(out, extra);
    }
    // Resto da janela: um pedaço do leitor antecipado por faixa, todas juntas, com espera curta.
    // O que chegar a tempo entra no trecho da largada; o resto o leitor antecipado busca em seguida.
    let closed = false;
    const rest = Array.from(out.entries()).map(async ([id, w]) => {
      const r = readers.get(id);
      const got = w.channels[0]?.length ?? 0;
      if (!r || got < (firstLen.get(id) ?? Infinity)) return; // já chegou no fim do clipe
      const at = w.start + got;
      const n = Math.min(r.length - at, Math.round(START_WINDOW_SECONDS * r.sampleRate) - got, DISK_CHUNK_FRAMES);
      if (n <= 0) return;
      try {
        const chans = await r.read(at, n);
        if (!closed && chans[0]?.length) extra.set(id, chans);
      } catch { /* o leitor antecipado tenta de novo */ }
    });
    if (rest.length > 0) {
      let timer: ReturnType<typeof setTimeout> | null = null;
      const w0 = performance.now();
      await Promise.race([
        Promise.all(rest),
        new Promise<void>((resolve) => { timer = setTimeout(resolve, START_EXTRA_WAIT_MS); }),
      ]);
      if (timer) clearTimeout(timer);
      closed = true;
      // para medir no show: quanto a largada esperou pelo extra e quantas faixas ele cobriu
      registrarDiag({ tipo: 'largada', duracaoMs: performance.now() - w0, leituraMs: firstMs, faixa: `${extra.size}/${rest.length}` });
    }
    // O extra vai como um segundo trecho, logo depois do primeiro: sem juntar os dois num bloco
    // novo (o reprodutor guarda cada um como chegou).
    return windowsOf(out, extra);
  }

  private unfeed(node: AudioWorkletNode) {
    this.feeds.get(node)?.cancel();
    this.feeds.delete(node);
  }

  private focusFeed(node: AudioWorkletNode, fromFrame: number, priority?: number) {
    this.feeds.get(node)?.focus(fromFrame, priority);
  }

  private listen(node: AudioWorkletNode, songId: string, clipId: string, onReady?: () => void) {
    node.port.onmessage = (ev) => {
      const type = ev.data?.type;
      if (type === 'ready') onReady?.();
      else if (type === 'ended') this.handleClipEnded(songId, clipId);
      else if (type === 'underrun') {
        // vai para o diário (window.__vsAudioDiag) antes do aviso da tela, que filtra atraso curto
        registrarDiag({ tipo: 'underrun', faixa: clipId, ...(typeof ev.data.ahead === 'number' ? { folgaQuadros: ev.data.ahead } : {}) });
        this.noteStarved(songId, clipId, true);
      } else if (type === 'recovered') {
        registrarDiag({ tipo: 'recovered', faixa: clipId });
        this.noteStarved(songId, clipId, false);
      } else if (type === 'late') {
        // ordem de largada chegou atrasada; o reprodutor já entrou adiantado pelo atraso
        registrarDiag({ tipo: 'largada-atrasada', faixa: clipId, duracaoMs: ev.data.ms });
      }
    };
  }

  // Nada fica mudo sem aviso: se o áudio de uma faixa chega atrasado, a faixa segue no tempo
  // certo em silêncio. Se o atraso passar do tempo de espera, uma etiqueta no canto diz qual faixa
  // está esperando o disco (atraso curto, enquanto a música carrega, passa sem aviso).
  private noteStarved(songId: string, clipId: string, starved: boolean) {
    if (!this.isPlaying || this.currentSongId !== songId || !this.activeClips.has(clipId)) return;
    if (!starved) this.starvedSince.delete(clipId);
    else if (!this.starvedSince.has(clipId)) this.starvedSince.set(clipId, performance.now());
    this.refreshStarved();
  }

  private refreshStarved() {
    if (this.starvedTimer) { clearTimeout(this.starvedTimer); this.starvedTimer = null; }
    for (const id of this.starvedSince.keys()) if (!this.isPlaying || !this.activeClips.has(id)) this.starvedSince.delete(id);
    const { late, nextCheckIn } = lateClipIds(this.starvedSince, performance.now());
    const lateSet = new Set(late);
    setDiskLag(useStore.getState().clips.filter((c) => lateSet.has(c.id)).map((c) => c.name));
    if (nextCheckIn !== null) this.starvedTimer = setTimeout(() => { this.starvedTimer = null; this.refreshStarved(); }, nextCheckIn);
  }

  private clearStarved() {
    if (this.starvedTimer) { clearTimeout(this.starvedTimer); this.starvedTimer = null; }
    this.starvedSince.clear();
    setDiskLag([]);
  }

  /** Taxa de amostragem do motor, se ele já estiver aberto (o tocador lê o áudio nesta taxa, sem converter). */
  currentSampleRate(): number | null {
    return this.ctx && this.ctx.state !== 'closed' ? this.ctx.sampleRate : null;
  }

  getContext(): AudioContext {
    if (!this.ctx || this.ctx.state === 'closed') {
      // Modo Show: blocos de áudio maiores, alguns milissegundos a mais de atraso e muito mais folga contra estalos.
      // A taxa fica presa à do áudio aberto: o tocador lê amostra por amostra, sem converter. Se a
      // saída padrão do Mac mudou de taxa depois (placa ligada com o programa aberto), o show
      // tocaria fora de velocidade e de tom; assim o navegador converte só na saída.
      const rate = deviceSampleRate();
      this.ctx = new AudioContext({ latencyHint: this.stableMode ? 'playback' : 'interactive', sampleRate: rate });
      if (this.ctx.sampleRate !== rate) console.warn('[audioEngine] taxa do motor diferente da do áudio aberto', this.ctx.sampleRate, rate);
      // O sistema suspendeu o áudio com a música tocando (placa trocada, Mac sem memória): volta
      // sozinho. Antes tudo ficava mudo até um Play novo ou trocar de música.
      const born = this.ctx;
      born.onstatechange = () => {
        if (born === this.ctx && born.state === 'suspended' && this.isPlaying) void born.resume().catch(() => { /* tenta no próximo Play */ });
      };
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = faderToGain(useStore.getState().masterVolume);
      // Limiter de segurança no bus master: protege o show de estourar/distorcer, sem alterar o volume percebido.
      this.masterLimiter = createSafetyLimiter(this.ctx);
      this.masterAnalyser = this.ctx.createAnalyser();
      this.masterAnalyser.fftSize = METER_FFT;
      this.masterPreAnalyser = this.ctx.createAnalyser();
      this.masterPreAnalyser.fftSize = METER_FFT;
      this.masterGain.connect(this.masterPreAnalyser);
      this.limiterSplit = false;
      this.masterLimitOut = this.ctx.createGain();
      // masterGain -> limiter -> masterLimitOut é montado em applyLimiterMode (os dois caminhos)
      this.limiterGates = null;
      // contexto novo começa em 0 s: o relógio da última leitura volta junto, senão o LUFS fica parado
      this.loudness.clear();
      this.loudLastAt = -Infinity;
      this.loudL = null;
      this.loudR = null;
      this.applyLimiterMode();
      this.masterAntiClipSplit = null;
      this.masterAntiClipGates = null;
      this.applyMasterAntiClip();
      this.configureOutputs();
      // o limitador do anti-clip já fica carregado: ligar o botão age na hora
      loadPeakLimiter(this.ctx).catch((err) => console.warn('[anti-clip] limitador indisponível', err));
      if (this.sinkId) {
        this.applySink(this.ctx, this.sinkId)
          .then(() => this.configureOutputs())
          .catch(() => { /* placa indisponível: fica na saída padrão */ });
      }
    }
    return this.ctx;
  }

  isStableMode(): boolean {
    return this.stableMode;
  }

  /**
   * Placa de saída em uso ('' = a padrão do sistema). Os pads do Modo Show tocam na mesma placa,
   * com um contexto de áudio próprio de atraso mínimo.
   */
  getOutputSinkId(): string {
    return this.sinkId ?? this.defaultSinkId ?? '';
  }

  // Trocar o tamanho do bloco exige recriar o motor de áudio; só é feito com o play parado.
  async setStableMode(on: boolean): Promise<boolean> {
    if (on === this.stableMode) return true;
    if (this.isPlaying || this.startsInFlight > 0) return false;
    this.stableMode = on;
    localStorage.setItem(STABLE_MODE_LS, on ? '1' : '0');
    const old = this.ctx;
    if (!old) return true;
    this.stopAll();
    this.invalidatePrepared();
    this.renderTimers.forEach((t) => window.clearTimeout(t));
    this.renderTimers.clear();
    this.renderRuns.clear();
    this.renderingSongs.clear();
    useStore.getState().setPreparingParams(null);
    this.channels.clear();
    this.routedTo.clear();
    this.timecode?.dispose();
    this.timecode = null;
    this.outputMerger = null;
    this.masterSplitter = null;
    this.masterRouteKey = null;
    this.workletReady = null;
    this.ctx = null;
    this.defaultSinkId = null;
    this.masterGain = null;
    this.masterLimiter = null;
    this.masterAnalyser = null;
    this.masterPreAnalyser = null;
    this.masterLimiterR = null;
    this.masterLimiterL1 = null;
    this.limiterNodes = [];
    // troca de caminho pendente mexeria em nós do contexto antigo depois de fechado
    if (this.limiterGates?.timer) clearTimeout(this.limiterGates.timer);
    this.limiterGates = null;
    this.limiterSplit = false;
    this.masterLimitOut = null;
    this.loudL = null;
    this.loudR = null;
    this.masterAntiClip = [];
    this.masterAntiClipNodes = [];
    if (this.masterAntiClipGates?.timer) clearTimeout(this.masterAntiClipGates.timer);
    this.masterAntiClipGates = null;
    this.masterAntiClipSplit = null;
    await old.close().catch(() => { /* já fechado */ });
    await this.prewarm().catch(() => { /* reabre no próximo play */ });
    return true;
  }

  async prewarm(): Promise<void> {
    const ctx = this.getContext();
    if (ctx.state === 'suspended') await ctx.resume();
    await this.ensureWorklet();
  }

  private computePrepareSignature(songId: string): string | null {
    const store = useStore.getState();
    const song = store.songs.find((s) => s.id === songId);
    if (!song || !isSongLoaded(songId)) return null;
    const clips = store.clips
      .filter((c) => c.songId === songId && isStemClip(c) && getClipAudio(c.id))
      .sort((a, b) => a.id.localeCompare(b.id));
    if (clips.length === 0) return null;
    const clipSig = clips.map((c) => {
      const b = getClipPlayAudio(c)!;
      return `${c.id}|${c.trackId}|${c.startTime.toFixed(4)}|${c.duration.toFixed(4)}|${b.length}|${b.sampleRate}|${b.channels.length}|${c.gain ?? 1}|${c.mute ? 1 : 0}|${c.solo ? 1 : 0}|${(c.fadeIn ?? 0).toFixed(3)}|${(c.fadeOut ?? 0).toFixed(3)}|${c.fadeCurveIn ?? 'linear'}|${c.fadeCurveOut ?? 'linear'}`;
    }).join('~');
    return `${song.bpmAdjust}|${song.tuner}|${clipSig}`;
  }

  // Faixas da música que têm destino no mixer: todas precisam estar no reprodutor.
  private playableClipIds(songId: string): string[] {
    const store = useStore.getState();
    return store.clips
      .filter((c) => c.songId === songId && isStemClip(c) && store.tracks.some((t) => t.id === c.trackId))
      .map((c) => c.id);
  }

  private coversAllClips(songId: string, clipIds: Iterable<string>): boolean {
    const have = new Set(clipIds);
    return this.playableClipIds(songId).every((id) => have.has(id));
  }

  // Uma faixa que falhou NUNCA para a música: toca tudo que carregou e só avisa (sem bloquear)
  // quais áudios específicos ficaram de fora. Parar a reprodução é só o usuário, no Stop.
  private warnIncompleteSong(songId: string) {
    const store = useStore.getState();
    const missing = store.clips.filter((c) => missingClipIds(songId).includes(c.id));
    if (missing.length === 0) return;
    const song = store.songs.find((s) => s.id === songId);
    const songName = song?.name ?? 'a música';
    const listOf = (clips: typeof missing) => clips.slice(0, 5).map((c) => c.name).join(', ')
      + (clips.length > 5 ? ` e mais ${clips.length - 5}` : '');
    const gone = missing.filter((c) => loadFailure(c.id) === 'missing');
    const broken = missing.filter((c) => loadFailure(c.id) === 'format');
    const lowMem = missing.filter((c) => !gone.includes(c) && !broken.includes(c));
    const parts: string[] = [];
    if (gone.length) parts.push(`não encontrei no computador: ${listOf(gone)}`);
    if (broken.length) parts.push(`arquivo danificado ou num formato que não consigo ler: ${listOf(broken)}`);
    if (lowMem.length) parts.push(`ainda carregando (toca assim que abrir): ${listOf(lowMem)}`);
    store.setPlaybackError(`"${songName}" está tocando normalmente; só ${parts.join('; ')}.`);
  }

  private reportMissing(songId: string, startedIds: Iterable<string>) {
    const started = new Set(startedIds);
    const store = useStore.getState();
    const missing = store.clips.filter((c) => c.songId === songId && isStemClip(c) && !started.has(c.id) && store.tracks.some((t) => t.id === c.trackId));
    if (missing.length === 0) return;
    console.warn('[audioEngine] faixas sem áudio', missing.map((c) => c.name));
    const names = missing.slice(0, 4).map((c) => c.name).join(', ');
    // A música continua tocando normalmente com as outras faixas; isto é só um aviso informativo.
    store.setPlaybackError(`A música está tocando; só não entrou ${missing.length === 1 ? 'a faixa' : 'as faixas'}: ${names}${missing.length > 4 ? '…' : ''}.`);
    // Nenhuma faixa fica muda pelo resto da música: continua tentando entrar sozinha assim que o áudio abrir.
    this.lateAttachMissingClips(songId, this.playGeneration, 0);
  }

  // Entra ao vivo com uma faixa que não conseguiu começar junto com o resto (memória ocupada,
  // decodificação ainda em andamento): quando o áudio dela abrir, ela se junta no ponto exato
  // da música sem interromper nada que já está tocando. Tenta de novo sozinha até conseguir.
  private lateAttachMissingClips(songId: string, gen: number, attempt: number) {
    const LATE_ATTACH_MAX_ATTEMPTS = 20;
    window.setTimeout(() => {
      if (gen !== this.playGeneration || !this.isPlayingSong(songId) || !this.ctx) return;
      const { attachedAny, stillLeft } = this.attachLiveAndRearm(songId);
      if (stillLeft && attempt < LATE_ATTACH_MAX_ATTEMPTS) {
        this.lateAttachMissingClips(songId, gen, attempt + 1);
      } else if (!attachedAny && stillLeft) {
        // esgotou as tentativas automáticas: deixa de insistir, mas nunca para a música
        console.warn('[audioEngine] algumas faixas não entraram após várias tentativas', songId);
      }
    }, Math.min(5000, 600 + attempt * 500));
  }

  private liveAttachTimer: number | null = null;

  /**
   * Clipe que entrou na música com ela no ar (fala do Maestro IA gerada ou gerada de novo durante
   * o Play, áudio consolidado, gravação, colagem) ganha reprodutor na hora, no ponto certo. Antes
   * ele só tocava depois de um novo Play: a fala nova ficava muda e parecia que era preciso ir
   * para outra música e voltar.
   */
  private scheduleLiveAttach() {
    if (this.liveAttachTimer !== null) return;
    // junta as mudanças do mesmo instante (a contagem inteira chega fala por fala)
    this.liveAttachTimer = window.setTimeout(() => {
      this.liveAttachTimer = null;
      const songId = this.currentSongId;
      // largada em andamento: os reprodutores dela ainda nem estão em activeClips
      if (!songId || !this.isPlayingSong(songId) || this.startsInFlight > 0 || !this.ctx) return;
      this.attachLiveAndRearm(songId);
    }, 0);
  }

  /** Liga os clipes que faltam e entrega a eles o salto de loop já armado, para não saírem do tempo. */
  private attachLiveAndRearm(songId: string): { attachedAny: boolean; stillLeft: boolean } {
    const result = this.attachClipsNow(songId);
    if (result.attachedAny) {
      if (this.armedLoop) this.disarmLoop(true);
      this.rearmLoop();
    }
    return result;
  }

  /** Cria agora o reprodutor de cada clipe da música no ar que tem áudio aberto e ainda não toca. */
  private attachClipsNow(songId: string): { attachedAny: boolean; stillLeft: boolean } {
    const ctx = this.ctx;
    const store = useStore.getState();
    const song = store.songs.find((s) => s.id === songId);
    if (!ctx || !song) return { attachedAny: false, stillLeft: false };
    const tracks = store.tracks;
    const lr = store.lrMasterActive;
    const clips = store.clips.filter((c) => c.songId === songId && isStemClip(c) && store.tracks.some((t) => t.id === c.trackId));
    if (clips.every((c) => this.activeClips.has(c.id))) return { attachedAny: false, stillLeft: false };

    // Entra um pouco à frente, com o ponto calculado para esse instante: largando "agora", a
    // ordem chegava depois do horário e a faixa ficava atrasada em relação às outras.
    this.settleArmed();
    const at = ctx.currentTime + RETIME_LEAD;
    const nowPos = (at - this.playbackStartTime) / (this.playbackAlpha || 1);
    // BPM e tom em vigor neste ponto (num medley cada parte tem os seus), como no Play e no salto
    const params = paramsAt(song, nowPos);
    const alpha = this.playbackAlpha || bpmAdjustToAlpha(params.bpmAdjust);
    const tempo = tempoFromBpm(params.bpmAdjust);
    const cents = this.playbackCents;

    const toAttach = clipsToAttachLive(
      clips.map((c) => ({ id: c.id, songId: c.songId, trackId: c.trackId, startTime: c.startTime, playLength: clipPlayLength(c) })),
      songId,
      new Set([...this.activeClips.keys(), ...this.exhaustedClips()]),
      new Set(tracks.map((t) => t.id)),
      (id) => { const c = clips.find((x) => x.id === id); return !!c && getClipPlayAudio(c) !== null; },
      nowPos,
    );
    let attachedAny = false;
    for (const info of toAttach) {
      const clip = clips.find((c) => c.id === info.id)!;
      const buffer = getClipPlayAudio(clip);
      const track = tracks.find((t) => t.id === clip.trackId);
      if (!buffer || !track) continue;
      attachedAny = true;

      const target = track.parentId ? tracks.find((t) => t.id === track.parentId) ?? track : track;
      const melodic = isMelodicTrack(track, tracks);
      const sampleRate = buffer.sampleRate;
      const pitch = melodic ? pitchFromCents(cents) : 1;
      const local = Math.max(0, nowPos - clip.startTime);
      const offsetSamples = Math.floor(local * sampleRate);
      const whenWall = at + Math.max(0, clip.startTime - nowPos) * alpha;

      const node = this.createPlayer(ctx, buffer.length, {
        sampleRate,
        offsetSamples,
        tempo, pitch,
        process: songNeedsProcessing(song),
        primeTargetFrames: 1024,
        fadeInFrames: entryFadeFrames(track, 512, offsetSamples > 0),
      });
      this.feed(node, buffer, offsetSamples, PRIORITY_ON_AIR);
      const clipGain = ctx.createGain();
      const gTarget = (track.parentId ? channelGainFor(track, tracks, track.volume) : 1) * clipGainFor(clip, clips);
      node.connect(clipGain);
      // canal que ainda não existia (primeira fala na faixa Maestro): nasce com o fader e o pan dele
      const freshChannel = !this.channels.has(target.id);
      const channel = this.ensureChannel(target.id);
      if (freshChannel) {
        channel.gain.gain.value = channelGainFor(target, tracks, target.volume);
        channel.panner.pan.value = effectivePan(target.id, target.pan, lr);
      }
      let clipPan: StereoPannerNode | null = null;
      if (track.parentId) {
        clipPan = ctx.createStereoPanner();
        clipPan.pan.value = effectivePan(track.id, track.pan, lr);
        clipGain.connect(clipPan);
        clipPan.connect(channel.gain);
      } else {
        clipGain.connect(channel.gain);
      }
      scheduleClipFade(clipGain, ctx, gTarget, clip, clipPlayLength(clip), this.playbackStartTime, alpha);
      try { node.port.postMessage({ startTime: whenWall }); } catch { /* ignore */ }
      this.clipGains.set(clip.id, clipGain);
      if (clipPan) this.clipPanners.set(clip.id, clipPan);
      this.listen(node, songId, clip.id);
      this.endedClips.delete(clip.id);
      this.activeClips.set(clip.id, {
        node,
        clipStartTime: clip.startTime,
        scheduledStartWall: whenWall,
        durationSeconds: clipPlayLength(clip),
        sampleRate,
        bufferLength: buffer.length,
        clipGain,
        clipPanner: clipPan,
        trackId: clip.trackId,
      });
    }

    if (attachedAny) void this.ensureClickRemounts(songId);
    const stillLeft = clips.some((c) => !this.activeClips.has(c.id) && getClipPlayAudio(c) === null);
    return { attachedAny, stillLeft };
  }

  // Reprodutores cujo processador parou com erro na thread de áudio (memória cheia, por exemplo):
  // ficam mudos para sempre. Nunca são guardados nem reaproveitados no próximo Play.
  private deadNodes = new WeakSet<AudioWorkletNode>();
  /** Recriações de cada clipe no Play atual: o erro se repetindo, para de recriar (não disputa CPU com a música). */
  private deadRetries = new Map<string, number>();
  private deadRetriesGen = -1;

  private handleDeadPlayer(node: AudioWorkletNode) {
    if (this.deadNodes.has(node)) return;
    this.deadNodes.add(node);
    console.warn('[audioEngine] um reprodutor parou com erro; ele é recriado');
    this.unfeed(node);
    // preparo guardado com ele: descartado (o próximo Play cria tudo de novo)
    for (const [songId, b] of Array.from(this.prepared.entries())) {
      if (b.pending.some((p) => p.node === node)) this.invalidatePrepared(songId);
    }
    for (const [clipId, a] of Array.from(this.activeClips.entries())) {
      if (a.node !== node) continue;
      try { a.node.disconnect(); } catch { /* ignore */ }
      try { a.clipGain.disconnect(); } catch { /* ignore */ }
      if (a.clipPanner) { try { a.clipPanner.disconnect(); } catch { /* ignore */ } }
      this.activeClips.delete(clipId);
      this.clipGains.delete(clipId);
      this.clipPanners.delete(clipId);
      if (this.deadRetriesGen !== this.playGeneration) {
        this.deadRetriesGen = this.playGeneration;
        this.deadRetries.clear();
      }
      const tries = (this.deadRetries.get(clipId) ?? 0) + 1;
      this.deadRetries.set(clipId, tries);
      if (tries > 3) {
        // sem recriar mais neste Play (attachClipsNow pula o clipe); volta no próximo Play
        console.warn('[audioEngine] o reprodutor do clipe falhou de novo; ele volta no próximo Play', clipId);
        continue;
      }
      // a faixa volta sozinha, no ponto certo, com um reprodutor novo
      this.scheduleLiveAttach();
    }
  }

  /** Clipes que já falharam demais neste Play e não são recriados até o próximo. */
  private exhaustedClips(): string[] {
    if (this.deadRetriesGen !== this.playGeneration) return [];
    return Array.from(this.deadRetries.entries()).filter(([, n]) => n > 3).map(([id]) => id);
  }

  private hasDeadNode(bundle: PreparedBundle | null | undefined): boolean {
    return !!bundle && bundle.pending.some((p) => this.deadNodes.has(p.node));
  }

  private preparedSnapshots(songId: string) {
    const snapshots = new Map<string, { audio: ReturnType<typeof getClipAudio>; trimStart: number; duration: number; trackId: string }>();
    for (const clip of useStore.getState().clips) {
      if (clip.songId === songId && isStemClip(clip)) {
        snapshots.set(clip.id, { audio: getClipAudio(clip.id), trimStart: clip.trimStart ?? 0, duration: clipPlayLength(clip), trackId: clip.trackId });
      }
    }
    return snapshots;
  }

  /** Reaproveita o Worklet somente quando o áudio e início continuam idênticos e o fim foi encurtado. */
  refreshPreparedAfterEndCut(songId: string): boolean {
    const bundle = this.prepared.get(songId);
    const st = useStore.getState();
    const song = st.songs.find((item) => item.id === songId);
    if (!bundle || !song || songNeedsProcessing(song)) return false;
    const clips = st.clips.filter((clip) => clip.songId === songId && isStemClip(clip));
    if (clips.length !== bundle.pending.length) return false;
    for (const clip of clips) {
      const before = bundle.snapshots.get(clip.id);
      if (!before || before.audio !== getClipAudio(clip.id) || before.trimStart !== (clip.trimStart ?? 0)
        || before.trackId !== clip.trackId || clipPlayLength(clip) > before.duration + 1e-6) return false;
    }
    const signature = this.computePrepareSignature(songId);
    if (!signature) return false;
    for (const item of bundle.pending) {
      const clip = clips.find((c) => c.id === item.clipId)!;
      item.clipStartTime = clip.startTime;
      item.clipDuration = clipPlayLength(clip);
    }
    bundle.signature = signature;
    return true;
  }

  private disposePreparedBundle(bundle: PreparedBundle) {
    for (const p of bundle.pending) {
      this.unfeed(p.node);
      try { p.node.port.postMessage({ type: 'stop' }); } catch { /* ignore */ }
      try { p.node.disconnect(); } catch { /* ignore */ }
      try { p.clipGain.disconnect(); } catch { /* ignore */ }
      if (p.clipPanner) { try { p.clipPanner.disconnect(); } catch { /* ignore */ } }
    }
  }

  invalidatePrepared(songId?: string) {
    if (songId) {
      const b = this.prepared.get(songId);
      if (b) {
        this.disposePreparedBundle(b);
        this.prepared.delete(songId);
      }
      if (!this.isPlayingSong(songId)) this.diskSongs.delete(songId);
      return;
    }
    this.prepared.forEach((b) => this.disposePreparedBundle(b));
    this.prepared.clear();
    this.clickStock.clear();
  }

  // Músicas que ainda valem a pena preparar (no ar, selecionada e próxima). null: ninguém disse ainda.
  private wanted: Set<string> | null = null;

  private isWanted(songId: string): boolean {
    return !this.wanted || this.wanted.has(songId);
  }

  /** Libera os pré-carregamentos das músicas que não estão mais em uso. */
  releaseUnretained(keepSongIds: Array<string | null | undefined>) {
    const keep = new Set(keepSongIds.filter((id): id is string => !!id));
    // Um preparo que ainda estava esperando (música no ar chegando do disco) não fica na memória
    // de uma música que o operador só clicou de passagem.
    this.wanted = keep;
    for (const songId of Array.from(this.prepared.keys())) {
      if (!keep.has(songId)) this.invalidatePrepared(songId);
    }
    this.retainTimecodes();
  }

  // O LTC montado da selecionada e o da próxima não se expulsam do cache um ao outro.
  private retainTimecodes() {
    const wanted = this.wanted;
    if (!this.timecode || !wanted) return;
    this.timecode.retain(useStore.getState().clips.filter((c) => wanted.has(c.songId) && isTimecodeTrackId(c.trackId)).map((c) => c.id));
  }

  private isPlayingSong(songId: string): boolean {
    return this.isPlaying && this.currentSongId === songId && this.activeClips.size > 0;
  }

  /** A que entra quando a do ar acabar (mesma regra do fim de música, em handleSongEnd). */
  private upcomingSongId(): string | null {
    if (!this.currentSongId) return null;
    const store = useStore.getState();
    const { transport } = store;
    const armed = transport.nextSongId && transport.nextSongId !== this.currentSongId && store.playlistOrder.includes(transport.nextSongId)
      ? transport.nextSongId : null;
    return armed ?? computeNextSongId(this.currentSongId, store.playlist, store.playlistOrder, transport.playFlow);
  }

  // Música escolhida pelo operador com o show tocando: só é preparada depois de ficar
  // selecionada por um tempo. Clique de passagem e rolagem não preparam nada; a escolha de
  // verdade (no "uma por vez" a próxima é sempre a selecionada) fica pronta antes do fim.
  private static readonly SELECTION_SETTLE_MS = 1500;
  private selectedSince: { id: string; at: number } | null = null;
  private selectionRetry: number | null = null;

  private skipWhilePlaying(songId: string): boolean {
    if (!this.isPlaying || !this.currentSongId || songId === this.currentSongId) return false;
    if (songId === this.upcomingSongId()) return false;
    if (songId !== useStore.getState().selectedSongId) return true;
    const now = performance.now();
    if (this.selectedSince?.id !== songId) this.selectedSince = { id: songId, at: now };
    const waited = now - this.selectedSince.at;
    if (waited >= AudioEngine.SELECTION_SETTLE_MS) return false;
    if (this.selectionRetry !== null) window.clearTimeout(this.selectionRetry);
    this.selectionRetry = window.setTimeout(() => {
      this.selectionRetry = null;
      if (useStore.getState().selectedSongId === songId) void this.prepareSong(songId).catch(() => { /* silencioso */ });
    }, AudioEngine.SELECTION_SETTLE_MS - waited + 20);
    return true;
  }

  async prepareSong(songId: string): Promise<void> {
    // A música no ar já tem os reprodutores dela; ao parar eles são guardados para o próximo Play.
    if (this.isPlayingSong(songId)) return;
    // Já preparada e sem mudança (ou preparando): não espera nada nem prepara de novo.
    const ready = this.prepared.get(songId);
    if (ready && !this.hasDeadNode(ready) && ready.signature === this.bundleSignature(songId, ready)) {
      void this.preloadTimecode(songId);
      return;
    }
    const preparing = this.preparing.get(songId);
    if (preparing) return preparing;
    // Com o show tocando, só a próxima é preparada. Clicar/selecionar outra música criava todos os
    // reprodutores dela e lia a música inteira do disco no meio do show (engasgo no som no ar), e
    // ela nem pode ir ao ar sem parar antes. Ao parar, o App prepara a selecionada de novo.
    if (this.skipWhilePlaying(songId)) return;
    // A música no ar termina de abrir primeiro: as duas disputando o disco e o processador era
    // o que fazia a faixa no ar ficar sem dado a tempo.
    const onAir = this.isPlaying ? this.currentSongId : null;
    if (onAir && onAir !== songId) {
      const air = this.onAirDiskDone;
      if (air && air.songId === onAir) await air.done;
      // lida do disco: ela já está inteira no reprodutor, basta o resto chegar (abrir de novo na
      // memória era ler e converter a música no ar inteira, no começo dela)
      else if (this.diskSongs.has(onAir) && !this.headOnly) await this.onAirFeedsDone();
      else if (!isSongLoaded(onAir)) await ensureSongLoaded(onAir).catch(() => { /* avisado pela música no ar */ });
    }
    if (this.isPlayingSong(songId) || !this.isWanted(songId)) return;
    // a próxima pode ter mudado durante a espera
    if (this.skipWhilePlaying(songId)) return;
    // o timecode (um arquivo só) abre junto, para o LTC largar com os stems
    void this.preloadTimecode(songId);
    if (!isSongLoaded(songId)) {
      // Igual à música no ar: a próxima lê do disco em trechos, sem abrir e converter tudo antes.
      const readers = await openRangeReaders(this.clipsWithSource(songId));
      if (readers) return this.prepareFromDisk(songId, readers);
      await ensureSongLoaded(songId);
    }
    const sig = this.computePrepareSignature(songId);
    if (!sig) return;
    const existing = this.prepared.get(songId);
    if (existing && existing.signature === sig) return;
    const inflight = this.preparing.get(songId);
    if (inflight) return inflight;

    const snapshots = this.preparedSnapshots(songId);
    const task = (async () => {
      if (existing) {
        this.disposePreparedBundle(existing);
        this.prepared.delete(songId);
      }
      const ctx = this.getContext();
      if (ctx.state === 'suspended') return;
      try {
        await this.ensureWorklet();
      } catch {
        return;
      }

      const store = useStore.getState();
      const song = store.songs.find((s) => s.id === songId);
      if (!song) return;
      const clips = store.clips.filter((c) => c.songId === songId && isStemClip(c) && getClipAudio(c.id));
      if (clips.length === 0) return;

      const bpmAdjust = song.bpmAdjust ?? 0;
      const tempo = tempoFromBpm(bpmAdjust);
      const cents = song.tuner * 100;
      const tracks = store.tracks;
      const lr = store.lrMasterActive;

      const pending: PreparedPending[] = [];

      for (const clip of clips) {
        const buffer = getClipPlayAudio(clip);
        if (!buffer) continue;
        const track = tracks.find((t) => t.id === clip.trackId);
        if (!track) continue;
        const target = track.parentId ? tracks.find((t) => t.id === track.parentId) ?? track : track;
        const melodic = isMelodicTrack(track, tracks);
        const sampleRate = buffer.sampleRate;
        if (this.isPlayingSong(songId) || this.computePrepareSignature(songId) !== sig) {
          this.disposePreparedBundle({ songId, signature: sig, pending, snapshots });
          return;
        }

        const node = this.createPlayer(ctx, buffer.length, {
          sampleRate,
          offsetSamples: 0,
          tempo,
          pitch: melodic ? pitchFromCents(cents) : 1,
          process: songNeedsProcessing(song),
          primeTargetFrames: 2048,
          fadeInFrames: 0,
        });
        // O áudio vai em trechos, atrás da música no ar, sem cópia grande na thread principal.
        this.feed(node, buffer, 0, PRIORITY_NEXT);

        const clipGain = ctx.createGain();
        clipGain.gain.value = (track.parentId ? channelGainFor(track, tracks, track.volume) : 1) * clipGainFor(clip, clips);
        node.connect(clipGain);

        let clipPanner: StereoPannerNode | null = null;
        if (track.parentId) {
          clipPanner = ctx.createStereoPanner();
          clipPanner.pan.value = effectivePan(track.id, track.pan, lr);
          clipGain.connect(clipPanner);
          const channel = this.ensureChannel(target.id);
          clipPanner.connect(channel.gain);
        } else {
          const channel = this.ensureChannel(target.id);
          clipGain.connect(channel.gain);
        }

        const ready = new Promise<void>((resolve) => this.listen(node, songId, clip.id, resolve));

        pending.push({
          clipId: clip.id,
          node,
          clipStartTime: clip.startTime,
          clipDuration: clipPlayLength(clip),
          ready,
          sampleRate,
          bufferLength: buffer.length,
          clipGain,
          clipPanner,
          trackId: clip.trackId,
        });
        await new Promise((r) => setTimeout(r, 0));
      }

      const bundle: PreparedBundle = { songId, signature: sig, pending, snapshots };

      await Promise.race([
        Promise.all(pending.map((p) => p.ready)),
        new Promise<void>((resolve) => setTimeout(resolve, 500)),
      ]);

      const currentSig = this.computePrepareSignature(songId);
      // Se a música começou a tocar com outros reprodutores, este preparo seria uma cópia a mais na memória.
      if (currentSig !== sig || this.isPlayingSong(songId) || !this.isWanted(songId) || !this.coversAllClips(songId, pending.map((p) => p.clipId))) {
        this.disposePreparedBundle(bundle);
        return;
      }
      this.prepared.set(songId, bundle);
      this.scheduleRender(songId, 0);
    })().finally(() => {
      this.preparing.delete(songId);
    });

    this.preparing.set(songId, task);
    return task;
  }

  private prepareFromDisk(songId: string, readers: Map<string, RangeReader>): Promise<void> {
    const sig = this.diskSignature(songId);
    if (!sig) return Promise.resolve();
    const existing = this.prepared.get(songId);
    if (existing && existing.disk && existing.signature === sig) return Promise.resolve();
    const inflight = this.preparing.get(songId);
    if (inflight) return inflight;
    const task = (async () => {
      if (existing) {
        this.disposePreparedBundle(existing);
        this.prepared.delete(songId);
      }
      const ctx = this.getContext();
      if (ctx.state === 'suspended') return;
      try { await this.ensureWorklet(); } catch { return; }
      const store = useStore.getState();
      const song = store.songs.find((s) => s.id === songId);
      if (!song) return;
      const tracks = store.tracks;
      const lr = store.lrMasterActive;
      const clips = store.clips.filter((c) => c.songId === songId && isStemClip(c) && (readers.has(c.id) || getClipPlayAudio(c)));
      const tempo = tempoFromBpm(song.bpmAdjust ?? 0);
      const cents = song.tuner * 100;
      const pending: PreparedPending[] = [];
      const snapshots = this.preparedSnapshots(songId);
      for (const clip of clips) {
        const track = tracks.find((t) => t.id === clip.trackId);
        if (!track) continue;
        const reader = readers.get(clip.id) ?? null;
        const buffer = reader ? null : getClipPlayAudio(clip);
        if (!reader && !buffer) continue;
        const sampleRate = reader ? reader.sampleRate : buffer!.sampleRate;
        const length = reader ? reader.length : buffer!.length;
        const target = track.parentId ? tracks.find((t) => t.id === track.parentId) ?? track : track;
        const node = this.createPlayer(ctx, length, {
          sampleRate,
          offsetSamples: 0,
          tempo,
          pitch: isMelodicTrack(track, tracks) ? pitchFromCents(cents) : 1,
          process: songNeedsProcessing(song),
          primeTargetFrames: 2048,
          fadeInFrames: 0,
        });
        if (reader) this.feedDisk(node, reader, 0, PRIORITY_NEXT);
        else this.feed(node, buffer!, 0, PRIORITY_NEXT);
        const clipGain = ctx.createGain();
        clipGain.gain.value = (track.parentId ? channelGainFor(track, tracks, track.volume) : 1) * clipGainFor(clip, clips);
        node.connect(clipGain);
        let clipPanner: StereoPannerNode | null = null;
        const channel = this.ensureChannel(target.id);
        if (track.parentId) {
          clipPanner = ctx.createStereoPanner();
          clipPanner.pan.value = effectivePan(track.id, track.pan, lr);
          clipGain.connect(clipPanner);
          clipPanner.connect(channel.gain);
        } else {
          clipGain.connect(channel.gain);
        }
        const ready = new Promise<void>((resolve) => this.listen(node, songId, clip.id, resolve));
        pending.push({ clipId: clip.id, node, clipStartTime: clip.startTime, clipDuration: clipPlayLength(clip), ready, sampleRate, bufferLength: length, clipGain, clipPanner, trackId: clip.trackId });
        // Um reprodutor por vez (cada construtor roda na thread de áudio), como no caminho da
        // memória; e se a música deixou de interessar no meio, para logo em vez de criar o resto.
        await new Promise((r) => setTimeout(r, 0));
        if (this.isPlayingSong(songId) || !this.isWanted(songId) || this.skipWhilePlaying(songId)) {
          this.disposePreparedBundle({ songId, signature: sig, pending, snapshots, disk: true });
          return;
        }
      }
      const bundle: PreparedBundle = { songId, signature: sig, pending, snapshots, disk: true };
      if (this.diskSignature(songId) !== sig || this.isPlayingSong(songId) || !this.isWanted(songId) || !this.coversAllClips(songId, pending.map((p) => p.clipId))) {
        this.disposePreparedBundle(bundle);
        return;
      }
      this.prepared.set(songId, bundle);
      this.diskSongs.add(songId);
      void this.ensureClickRemounts(songId);
    })().finally(() => {
      this.preparing.delete(songId);
    });
    this.preparing.set(songId, task);
    return task;
  }

  private ensureWorklet(): Promise<void> {
    if (this.workletReady) return this.workletReady;
    const ctx = this.getContext();
    this.workletReady = ctx.audioWorklet.addModule(getClipPlayerWorkletUrl()).catch((err) => {
      this.workletReady = null;
      throw err;
    });
    return this.workletReady;
  }

  private ensureChannel(trackId: string): ChannelNode {
    if (this.channels.has(trackId)) return this.channels.get(trackId)!;
    const ctx = this.getContext();
    const gain = ctx.createGain();
    const panner = ctx.createStereoPanner();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = METER_FFT;
    analyser.smoothingTimeConstant = 0.8;
    const level = ctx.createGain();
    // o timecode nunca muda de volume
    level.gain.value = this.channelLevel(trackId);
    gain.connect(panner);
    panner.connect(level);
    const antiClip = new AntiClipInsert(ctx, level, analyser);
    antiClip.set(antiClipActive(useStore.getState().tracks.find((t) => t.id === trackId)), true);
    // medidor estéreo: um galho do sinal (depois do anti-clip) separado em L e R
    const meterSplit = ctx.createChannelSplitter(2);
    const meterL = ctx.createAnalyser();
    const meterR = ctx.createAnalyser();
    meterL.fftSize = METER_FFT;
    meterR.fftSize = METER_FFT;
    meterSplit.connect(meterL, 0);
    meterSplit.connect(meterR, 1);
    const node: ChannelNode = { gain, panner, level, antiClip, analyser, source: null, meterSplit, meterL, meterR };
    this.levelTargets.set(node, level.gain.value);
    this.channels.set(trackId, node);
    this.routeChannel(trackId);
    return node;
  }

  // Saídas físicas: o Master ocupa as saídas 1 e 2; cada canal pode ir direto para outra saída
  // da interface, em mono (N) ou num par estéreo (N/N+1).
  private configureOutputs() {
    const ctx = this.ctx;
    if (!ctx || !this.masterAnalyser) return;
    const dest = ctx.destination;
    const count = Math.max(2, dest.maxChannelCount || 2);
    try {
      dest.channelCount = count;
      dest.channelCountMode = 'explicit';
      dest.channelInterpretation = 'discrete';
    } catch { /* a saída não aceita mais canais: fica no estéreo */ }
    const actual = Math.max(2, dest.channelCount);
    // a tela sempre mostra as saídas da placa em uso (abrir um projeto não pode voltar para 2)
    useStore.getState().setOutputChannelCount(actual);
    if (this.outputMerger && this.outputCount === actual) return;
    try { this.masterAnalyser.disconnect(); } catch { /* ignore */ }
    if (this.outputMerger) { try { this.outputMerger.disconnect(); } catch { /* ignore */ } }
    this.outputCount = actual;
    this.outputMerger = ctx.createChannelMerger(actual);
    this.masterSplitter = ctx.createChannelSplitter(2);
    this.masterAnalyser.connect(this.masterSplitter);
    // medidor estéreo do master: L e R da saída 1-2
    // medidores do master: recria se forem de outro contexto (ligar o "Áudio estável" troca o
    // contexto; ligar um nó de outro contexto dava erro aqui e o programa ficava mudo)
    if (!this.masterMeterL || this.masterMeterL.context !== ctx) this.masterMeterL = ctx.createAnalyser();
    if (!this.masterMeterR || this.masterMeterR.context !== ctx) this.masterMeterR = ctx.createAnalyser();
    this.masterMeterL.fftSize = METER_FFT;
    this.masterMeterR.fftSize = METER_FFT;
    this.masterSplitter.connect(this.masterMeterL, 0);
    this.masterSplitter.connect(this.masterMeterR, 1);
    this.masterRouteKey = null;
    this.routeMaster();
    this.connectLoudness(ctx);
    this.outputMerger.connect(dest);
    this.routedTo.clear();
    this.channels.forEach((_, id) => this.routeChannel(id));
  }

  /** Saída em que o Master está agora (escolhida, ou 1/2 se a placa não puder). */
  private masterTarget(): MasterOutput {
    const st = useStore.getState();
    return resolveMasterOutput({
      channel: st.masterOutputChannel, stereo: st.masterOutputStereo, magic: st.magicRoutingActive,
      outputCount: this.outputCount, interfaceMissing: interfaceMissing(st.audioInterface, st.audioInterfaceConnected),
    });
  }

  // Liga o Master na saída escolhida. Medidores e loudness continuam no divisor: não mudam.
  private routeMaster() {
    if (!this.masterAnalyser || !this.masterSplitter || !this.outputMerger) return;
    const target = this.masterTarget();
    const st = useStore.getState();
    const silenced = masterSilenced({
      off: !!st.masterOutputOff, magic: st.magicRoutingActive, outputCount: this.outputCount,
      interfaceMissing: interfaceMissing(st.audioInterface, st.audioInterfaceConnected),
    }, st.tracks);
    const key = silenced ? 'off' : `${target.channel}|${target.stereo}`;
    if (this.masterRouteKey === key) return;
    try { this.masterSplitter.disconnect(this.outputMerger); } catch { /* ainda não estava ligado */ }
    try { this.masterAnalyser.disconnect(this.outputMerger); } catch { /* só ligado no modo mono */ }
    if (silenced) {
      // Desligado: não envia para a placa, e os canais com saída própria seguem direto
    } else if (target.stereo) {
      this.masterSplitter.connect(this.outputMerger, 0, target.channel - 1);
      this.masterSplitter.connect(this.outputMerger, 1, target.channel);
    } else {
      // mono: L e R somados na saída escolhida, igual aos canais
      this.masterAnalyser.connect(this.outputMerger, 0, target.channel - 1);
    }
    this.masterRouteKey = key;
  }

  private routeChannel(trackId: string) {
    const ch = this.channels.get(trackId);
    if (!ch || !this.ctx || !this.masterGain || !this.outputMerger) return;
    const state = useStore.getState();
    const track = state.tracks.find((t) => t.id === trackId);
    const isTc = isTimecodeTrackId(trackId);
    const chosen = track?.outputChannel ?? 0;
    // o Master pode ter caído na saída do timecode (placa menor): o LTC cala, nunca mistura com a música
    const out = isTc && this.timecodeHitsMaster(chosen) ? NO_OUTPUT : chosen;
    // o timecode (LTC) é sempre mono
    const stereo = !isTc && !!track?.outputStereo;
    // Par ou saída que a interface atual não tem, LR mágico ligado, ou placa do projeto
    // desconectada: volta para o Master (o timecode fica mudo). "Desligado": lugar nenhum.
    const { physical, key } = resolveRoute({
      out, off: out === NO_OUTPUT, stereo, timecode: isTc, magic: state.magicRoutingActive,
      outputCount: this.outputCount, interfaceMissing: interfaceMissing(state.audioInterface, state.audioInterfaceConnected),
    });
    const direct = physical ? key : null;
    if (this.routedTo.get(trackId) === key) return;
    try { ch.analyser.disconnect(); } catch { /* ignore */ }
    if (ch.splitter) { try { ch.splitter.disconnect(); } catch { /* ignore */ } }
    // o galho do medidor estéreo continua ligado em qualquer saída
    ch.analyser.connect(ch.meterSplit);
    if (key === 'master') {
      ch.analyser.connect(this.masterGain);
    } else if (direct && stereo) {
      const splitter = ch.splitter ?? (ch.splitter = this.ctx.createChannelSplitter(2));
      ch.analyser.connect(splitter);
      splitter.connect(this.outputMerger, 0, physical - 1);
      splitter.connect(this.outputMerger, 1, physical);
    } else if (direct) {
      // mono: L e R somados na saída escolhida
      ch.analyser.connect(this.outputMerger, 0, physical - 1);
    }
    this.routedTo.set(trackId, key);
    // entrou ou saiu do Master: o fader geral do Master desligado passa a valer ou deixa de valer
    this.updateChannelLevel(trackId, ch, 0.03);
  }

  private timecodeHitsMaster(channel: number): boolean {
    if (channel <= 0) return false;
    const m = this.masterTarget();
    return channel === m.channel || (m.stereo && channel === m.channel + 1);
  }

  getOutputCount(): number {
    return this.outputCount;
  }

  // Botão ANTI-CLIP do mixer (e desfazer/refazer): liga ou desliga o limitador de cada canal.
  private syncAntiClip(tracks: Track[]) {
    this.channels.forEach((ch, id) => ch.antiClip.set(antiClipActive(tracks.find((t) => t.id === id))));
  }

  /** O timecode desta música só sai se tiver uma saída física escolhida que a interface oferece. */
  timecodeOutputReady(): boolean {
    const state = useStore.getState();
    const tc = state.tracks.find((t) => t.id === TIMECODE_TRACK_ID);
    if (interfaceMissing(state.audioInterface, state.audioInterfaceConnected)) return false;
    return !!tc && tc.outputChannel !== NO_OUTPUT && tc.outputChannel > 0 && tc.outputChannel <= this.outputCount
      && !this.timecodeHitsMaster(tc.outputChannel);
  }

  private timecodeClip(songId: string): AudioClip | undefined {
    return useStore.getState().clips.find((c) => c.songId === songId && isTimecodeTrackId(c.trackId));
  }

  private ensureTimecode(): TimecodePlayer {
    if (this.timecode) return this.timecode;
    const ctx = this.getContext();
    const channel = this.ensureChannel(TIMECODE_TRACK_ID);
    const tc = useStore.getState().tracks.find((t) => t.id === TIMECODE_TRACK_ID);
    if (tc) channel.gain.gain.value = channelGainFor(tc, [tc], tc.volume);
    channel.panner.pan.value = 0;
    this.timecode = new TimecodePlayer(ctx, channel.gain);
    this.retainTimecodes();
    return this.timecode;
  }

  /** Quando o resto do áudio das faixas no ar terminou de chegar ao reprodutor. */
  private onAirFeedsDone(): Promise<void> {
    const handles = Array.from(this.activeClips.values()).map((a) => this.feeds.get(a.node)).filter((h): h is StreamHandle => !!h);
    return Promise.all(handles.map((h) => h.done)).then(() => undefined);
  }

  private timecodeLoads = new Map<string, Promise<ClipAudio | null>>();

  // Abre na memória só o arquivo do timecode da música (normalmente mono), sem abrir os stems:
  // lendo do disco, o LTC esperava a música inteira abrir e entrava segundos depois da largada.
  private loadTimecodeAudio(songId: string): Promise<ClipAudio | null> {
    const clip = this.timecodeClip(songId);
    if (!clip) return Promise.resolve(null);
    const have = getClipAudio(clip.id);
    if (have) return Promise.resolve(have);
    const src = getClipSource(clip.id);
    if (!src) return Promise.resolve(null);
    const inflight = this.timecodeLoads.get(clip.id);
    if (inflight) return inflight;
    const task = openClipAudio(songId, clip.id, src)
      .then((audio) => {
        // o timecode pode ter sido trocado ou apagado enquanto abria
        if (getClipSource(clip.id) !== src) return null;
        if (!getClipAudio(clip.id)) putClipAudio(clip.id, songId, audio);
        return getClipAudio(clip.id);
      })
      .catch((err) => {
        console.warn('[timecode] não consegui abrir o LTC', err);
        return null;
      })
      .finally(() => { if (this.timecodeLoads.get(clip.id) === task) this.timecodeLoads.delete(clip.id); });
    this.timecodeLoads.set(clip.id, task);
    return task;
  }

  /** Deixa o LTC da música aberto e já montado antes do Play. */
  private async preloadTimecode(songId: string): Promise<void> {
    const clip = this.timecodeClip(songId);
    if (!clip || !this.isWanted(songId)) return;
    const audio = await this.loadTimecodeAudio(songId);
    // o operador pode ter só passado pela música enquanto o arquivo abria: aí não monta nada
    if (!audio || !this.isWanted(songId) || this.timecodeClip(songId)?.id !== clip.id || !this.ctx || this.ctx.state === 'closed') return;
    const player = this.ensureTimecode();
    // um LTC que entrou depois da última lista (importado agora) também fica retido
    this.retainTimecodes();
    await player.preload(clip.id, audio);
  }

  // Coloca o timecode da música no mesmo ponto dos stems; se o áudio ainda está abrindo, entra assim que abrir.
  private startTimecode(songId: string, songPos: number, when: number, remind: boolean) {
    const clip = this.timecodeClip(songId);
    if (!clip) { this.timecode?.stop(); this.timecodeClipId = null; return; }
    const tcOut = useStore.getState().tracks.find((t) => t.id === TIMECODE_TRACK_ID)?.outputChannel ?? NO_OUTPUT;
    if (remind && this.timecodeHitsMaster(tcOut)) {
      useStore.getState().setPlaybackError(`O TIMECODE (LTC) está mudo: o Master está saindo na Saída ${tcOut}. Escolha no mixer outra saída para o timecode.`);
    } else if (remind && !this.timecodeOutputReady()) {
      useStore.getState().setPlaybackError('Lembrete: o TIMECODE (LTC) está "Sem Saída". Escolha no mixer a saída física da interface que vai para o telão ou a mesa de luz (ex.: Saída 5).');
    }
    const player = this.ensureTimecode();
    // o timecode anda no andamento das faixas (BPM ajustado), nunca no tom (tuner)
    player.setRate(1 / (this.playbackAlpha || 1));
    const audio = getClipAudio(clip.id);
    this.timecodeClipId = clip.id;
    if (audio) {
      player.start(clip.id, audio, songPos - clip.startTime, when);
      return;
    }
    player.stop();
    const gen = this.playGeneration;
    void this.loadTimecodeAudio(songId).then((late) => {
      if (!late || gen !== this.playGeneration || !this.isPlaying || this.currentSongId !== songId || !this.ctx || this.timecodeClipId !== clip.id) return;
      // um salto de loop que já passou entra na conta antes de calcular o ponto do LTC
      this.settleArmed();
      const at = this.ctx.currentTime + 0.05;
      const pos = (at - this.playbackStartTime) / (this.playbackAlpha || 1);
      player.setRate(1 / (this.playbackAlpha || 1));
      player.start(clip.id, late, pos - clip.startTime, at);
      // o salto já armado foi para os stems sem o LTC (o áudio dele ainda não tinha aberto)
      const armed = this.armedLoop;
      if (armed) this.jumpTimecode(songId, armed.start, armed.at);
    });
  }

  private jumpTimecode(songId: string, destPos: number, at: number) {
    const clip = this.timecodeClip(songId);
    const audio = clip ? getClipAudio(clip.id) : null;
    if (!clip || !audio || !this.timecode || this.timecodeClipId !== clip.id) return;
    this.timecode.scheduleJump(clip.id, audio, destPos - clip.startTime, at);
  }

  private startsInFlight = 0;
  /** Pulo pedido enquanto a largada ainda se prepara (só o último vale). */
  private pendingSeek: number | null = null;

  isStarting(): boolean {
    return this.startsInFlight > 0;
  }

  // Quando o último Play terminou de largar. Nos segundos seguintes o disco ainda está entregando
  // o começo de cada faixa, e essa entrega depende da thread da tela.
  private lastStartAt = 0;

  /**
   * Largando, ou logo depois de largar: as análises de fundo (volume igual, IA de tom) esperam.
   * Antes elas só esperavam o Play e podiam rodar no começo de uma música no meio do show.
   */
  isSettling(ms = SETTLE_MS): boolean {
    return this.startsInFlight > 0 || performance.now() - this.lastStartAt < ms;
  }

  // Folga entre marcar o horário da largada e o áudio chegar nele. No Modo Show o som é calculado
  // em blocos maiores: com folga curta, a ordem de algumas faixas chegava depois do horário e
  // elas largavam atrasadas em relação às outras pelo resto da música.
  private startLead(min: number): number {
    const block = this.ctx?.baseLatency || 0;
    return Math.max(min, Math.min(0.2, 2 * block));
  }

  async playSong(songId: string, startOffset = 0, options?: { fastSeek?: boolean }) {
    this.startsInFlight++;
    try {
      await this.startSong(songId, startOffset, options);
    } finally {
      this.startsInFlight--;
      this.lastStartAt = performance.now();
      // clipe que entrou na música enquanto ela largava (a largada leu a lista antes dele)
      if (this.startsInFlight === 0 && this.isPlaying) this.scheduleLiveAttach();
    }
  }

  private async startSong(songId: string, startOffset = 0, options?: { fastSeek?: boolean }): Promise<void> {
    // Preparo desta música ainda em andamento (depois de editar): espera um pouco por ele. Largar
    // a frio junto criava dois conjuntos de reprodutores ao mesmo tempo bem no Play.
    const inflight = this.preparing.get(songId);
    if (inflight) {
      const gen = this.playGeneration;
      await Promise.race([inflight.catch(() => {}), new Promise((r) => setTimeout(r, PLAY_WAITS_PREPARE_MS))]);
      if (gen !== this.playGeneration) return;
    }
    let heads: Map<string, HeadAudio> | null = null;
    let disk: Map<string, RangeReader> | null = null;
    let initial: Map<string, InitialWindow[]> | null = null;
    const ready0 = this.prepared.get(songId);
    const diskBundleReady = !!(ready0?.disk && ready0.signature === this.diskSignature(songId));
    if (!isSongLoaded(songId) && !diskBundleReady) {
      const loadGen = this.playGeneration;
      // Como nos programas de gravação: cada faixa lê do disco a partir do ponto de largada,
      // sem abrir nem converter o arquivo inteiro. A música anterior segue até o trecho chegar.
      const withSource = this.clipsWithSource(songId);
      disk = await openRangeReaders(withSource);
      if (loadGen !== this.playGeneration) return;
      if (disk) {
        initial = await this.readStartWindows(withSource, disk, startOffset);
        if (loadGen !== this.playGeneration) return;
      }
    }
    if (!disk && !isSongLoaded(songId) && !diskBundleReady) {
      const loadGen = this.playGeneration;
      // Começo pronto no disco: a música larga na hora e o resto abre enquanto ela toca.
      heads = await loadHeads(this.clipsWithSource(songId), startOffset);
      if (loadGen !== this.playGeneration) return;
      if (heads) {
        ensureSongLoaded(songId).catch(() => { /* avisado ao terminar */ });
      } else {
        await ensureSongLoaded(songId);
        if (loadGen !== this.playGeneration) return;
        if (!isSongLoaded(songId)) {
          // libera tudo que não é esta música e tenta mais uma vez antes de desistir
          this.releaseUnretained([songId]);
          retainSongs([songId], { strict: true });
          await ensureSongLoaded(songId);
          if (loadGen !== this.playGeneration) return;
        }
        // Mesmo que alguma faixa não tenha aberto, a música sempre vai ao ar com o que
        // já carregou: nenhuma falha de carregamento impede o Play. Só avisa, sem travar.
        if (!isSongLoaded(songId)) this.warnIncompleteSong(songId);
      }
    }
    const fastSeek = options?.fastSeek === true;
    this.stopAll();
    // O pulo do cursor continua valendo durante a troca dos reprodutores.
    if (fastSeek) this.seekLock = { active: true, targetTime: startOffset };
    this.loopPasses.clear();
    const bundle = this.prepared.get(songId) ?? null;
    const expectedSig = this.bundleSignature(songId, bundle);
    const useBundle = !!(bundle && expectedSig && bundle.signature === expectedSig && !this.hasDeadNode(bundle)
      && this.coversAllClips(songId, bundle.pending.map((p) => p.clipId)));
    // preparo velho (a música foi editada): não fica ocupando memória ao lado dos novos reprodutores
    if (bundle && !useBundle) this.invalidatePrepared(songId);
    if (useBundle && bundle?.disk) this.diskSongs.add(songId);
    const myGen = ++this.playGeneration;
    const ctx = this.getContext();
    if (ctx.state === 'suspended') await ctx.resume();
    await this.ensureWorklet();
    if (myGen !== this.playGeneration) return;
    // O preparo foi descartado nessa espera (reprodutor com erro, edição): os nós dele já pararam.
    // Recomeça a largada, que abre o áudio pelo caminho certo em vez de tocar com nós mudos.
    if (useBundle && this.prepared.get(songId) !== bundle) return this.startSong(songId, startOffset, options);

    const store = useStore.getState();

    if (useBundle && bundle) {
      this.prepared.delete(songId);
      const clipsNow = store.clips.filter((c) => c.songId === songId && isStemClip(c));
      if (clipsNow.length === 0) {
        this.disposePreparedBundle(bundle);
        return;
      }

      const song = store.songs.find((s) => s.id === songId);
      const songDuration = song?.duration ?? Math.max(...clipsNow.map((c) => c.duration));
      const params = song ? paramsAt(song, startOffset) : { bpmAdjust: 0, tuner: 0 };
      const bpmAdjust = params.bpmAdjust;
      const alpha = bpmAdjustToAlpha(bpmAdjust);
      const cents = params.tuner * 100;
      const tracks = store.tracks;
      const lr = store.lrMasterActive;

      this.isPlaying = true;
      this.currentSongId = songId;
      this.endedClips.clear();
      this.markOnAir(songId);
      this.playbackOffset = startOffset;
      this.playbackAlpha = alpha;
      this.playbackCents = cents;

      const scheduledStart = ctx.currentTime + this.startLead(0.05);
      this.playbackStartTime = scheduledStart - startOffset * alpha;

      for (const p of bundle.pending) {
        const track = tracks.find((t) => t.id === p.trackId);
        if (!track) {
          try { p.node.port.postMessage({ type: 'stop' }); } catch { /* ignore */ }
          try { p.node.disconnect(); } catch { /* ignore */ }
          try { p.clipGain.disconnect(); } catch { /* ignore */ }
          if (p.clipPanner) { try { p.clipPanner.disconnect(); } catch { /* ignore */ } }
          continue;
        }
        const target = track.parentId ? tracks.find((t) => t.id === track.parentId) ?? track : track;
        const clip = clipsNow.find((c) => c.id === p.clipId);

        const gTarget = (track.parentId ? channelGainFor(track, tracks, track.volume) : 1) * (clip ? clipGainFor(clip, clipsNow) : 1);
        if (p.clipPanner) p.clipPanner.pan.value = effectivePan(track.id, track.pan, lr);
        const channel = this.ensureChannel(target.id);
        const chTarget = channelGainFor(target, tracks, target.volume);
        try { channel.gain.gain.cancelScheduledValues(ctx.currentTime); } catch { /* ignore */ }
        try { channel.gain.gain.setValueAtTime(chTarget, ctx.currentTime); } catch { channel.gain.gain.value = chTarget; }
        channel.panner.pan.value = effectivePan(target.id, target.pan, lr);

        this.clipGains.set(p.clipId, p.clipGain);
        if (p.clipPanner) this.clipPanners.set(p.clipId, p.clipPanner);

        const local = startOffset - p.clipStartTime;
        const whenWall = scheduledStart + Math.max(0, -local) * alpha;
        if (clip) scheduleClipFade(p.clipGain, ctx, gTarget, clip, p.clipDuration, this.playbackStartTime, alpha);
        else { try { p.clipGain.gain.cancelScheduledValues(ctx.currentTime); } catch { /* ignore */ } try { p.clipGain.gain.setValueAtTime(gTarget, ctx.currentTime); } catch { p.clipGain.gain.value = gTarget; } }
        const offsetSamples = local > 0 ? Math.min(p.bufferLength, Math.floor(local * p.sampleRate)) : 0;
        try {
          p.node.port.postMessage({ type: 'seek', offsetSamples, startTime: whenWall, fadeInFrames: entryFadeFrames(track, offsetSamples > 0 ? 512 : 1, offsetSamples > 0),
            tempo: tempoFromBpm(bpmAdjust), pitch: isMelodicTrack(track, tracks) ? pitchFromCents(cents) : 1,
            process: songNeedsProcessing(song), dropPartial: true });
        } catch { /* ignore */ }

        // o que ainda falta chegar deste reprodutor passa na frente, a partir do ponto de largada
        this.focusFeed(p.node, offsetSamples, PRIORITY_ON_AIR);
        this.listen(p.node, songId, p.clipId);

        this.activeClips.set(p.clipId, {
          node: p.node,
          clipStartTime: p.clipStartTime,
          scheduledStartWall: whenWall,
          durationSeconds: p.clipDuration,
          sampleRate: p.sampleRate,
          bufferLength: p.bufferLength,
          clipGain: p.clipGain,
          clipPanner: p.clipPanner,
          trackId: p.trackId,
        });
      }
      // O timecode entra depois que todas as faixas já receberam o horário da largada: montar o
      // LTC aqui no meio podia passar da folga e fazer as faixas largarem atrasadas.
      this.startTimecode(songId, startOffset, scheduledStart, true);

      this.startMetering();
      this.scheduleSongEnd(songDuration);
      useStore.getState().setCurrentTime(startOffset);
      store.selectSong(songId);
      this.reportMissing(songId, this.activeClips.keys());
      this.rearmLoop();
      const st = useStore.getState();
      st.setNextSong(computeNextSongId(songId, st.playlist, st.playlistOrder, st.transport.playFlow));
      // Preparada do disco: igual à largada sem preparo, avisa quando o resto chegou (a próxima
      // espera por isso em vez de abrir a música no ar inteira na memória) e só abre a música se
      // uma faixa falhou no disco ou se o BPM/tom pede o áudio ajustado em segundo plano.
      void this.ensureClickRemounts(songId);
      if (bundle.disk) void this.afterDiskStart(songId, myGen);
      else this.scheduleRender(songId, 0);
      this.applyPendingSeek();
      return;
    }

    const clips = store.clips.filter((c) => c.songId === songId && isStemClip(c));
    if (clips.length === 0) return;

    const song = store.songs.find((s) => s.id === songId);
    if (!fastSeek && song && songNeedsProcessing(song)) {
      await Promise.race([this.ensureClickRemounts(songId), new Promise((r) => setTimeout(r, CLICK_STOCK_WAIT_MS))]);
      if (myGen !== this.playGeneration) return;
    }
    const audioFor = (clip: typeof clips[number]) => heads ? heads.get(clip.id) ?? null : getClipPlayAudio(clip);
    const playClips = clips.filter((c) => store.tracks.some((t) => t.id === c.trackId) && (disk?.has(c.id) || audioFor(c)));
    // Com BPM/tom alterados, o começo já ajustado evita ligar o processamento ao vivo de todas as faixas na largada.
    // Esse começo é o do arquivo: com algum clipe cortado no início (split), todas processam ao vivo juntas.
    const stretched = wantsStretchedHead(song) && !playClips.some((c) => (c.trimStart ?? 0) > 0)
      ? await loadStretchedHeads(song, playClips, headPitchFor, 0)
      : null;
    if (myGen !== this.playGeneration) return;

    // O motor só conta como tocando na hora da largada: até lá o relógio ainda é o da música
    // anterior, e o cursor fica no ponto pedido (playbackOffset).
    this.markOnAir(songId);
    this.playbackOffset = startOffset;
    this.headOnly = !!heads;

    const songDuration = song?.duration ?? Math.max(...clips.map((c) => c.duration));
    const params = song ? paramsAt(song, startOffset) : { bpmAdjust: 0, tuner: 0 };
    const bpmAdjust = params.bpmAdjust;
    const alpha = bpmAdjustToAlpha(bpmAdjust);
    const tempo = tempoFromBpm(bpmAdjust);
    const cents = params.tuner * 100;
    const tracks = store.tracks;
    const lr = store.lrMasterActive;
    this.playbackAlpha = alpha;
    this.playbackCents = cents;

    // Fase 1: cria todos os clipes em modo idle (silêncio) e os deixa
    // pré-aquecer o motor em segundo plano. Nenhum sabe ainda quando começa.
    type Pending = {
      clipId: string;
      node: AudioWorkletNode;
      clip: typeof clips[number];
      ready: Promise<void>;
      sampleRate: number;
      bufferLength: number;
      clipGain: GainNode;
      clipPan: StereoPannerNode | null;
      /** Click já remontado: a largada troca a voz inicial pela que lê o áudio remontado. */
      remounted: { offsetSamples: number; fadeInFrames: number } | null;
    };
    const pending: Pending[] = [];
    const purgePending = () => {
      for (const p of pending) {
        this.unfeed(p.node);
        try { p.node.port.postMessage({ type: 'stop' }); } catch { /* ignore */ }
        try { p.node.disconnect(); } catch { /* ignore */ }
        try { p.clipGain.disconnect(); } catch { /* ignore */ }
        if (p.clipPan) { try { p.clipPan.disconnect(); } catch { /* ignore */ } }
        this.clipGains.delete(p.clipId);
        this.clipPanners.delete(p.clipId);
      }
      pending.length = 0;
    };

    if (disk) this.diskSongs.add(songId);
    for (const clip of clips) {
      const reader = disk?.get(clip.id) ?? null;
      const buffer = reader ? null : audioFor(clip);
      if (!reader && !buffer) continue;
      const track = tracks.find((t) => t.id === clip.trackId);
      if (!track) continue;
      const target = track.parentId ? tracks.find((t) => t.id === track.parentId) ?? track : track;
      const melodic = isMelodicTrack(track, tracks);

      const sampleRate = reader ? reader.sampleRate : buffer!.sampleRate;

      const offsetSeconds = Math.max(0, startOffset - clip.startTime);
      const offsetSamples = Math.floor(offsetSeconds * sampleRate);
      const bufferLength = reader ? reader.length : heads ? heads.get(clip.id)!.fullFrames : buffer!.length;
      const pitch = melodic ? pitchFromCents(cents) : 1;
      // O começo pronto do click passou pelo SoundTouch: o click usa o áudio remontado.
      const isClick = isClickTrack(track);
      const ready = isClick ? undefined : stretched?.get(clip.id);

      // A rampa de entrada (10 ms a 48 kHz) suaviza o começo de música, mas numa fala do Maestro ela
      // abafa a primeira sílaba: a contagem ("Um!") entrava depois da linha da grade e mais fraca.
      // Fala e click entram quase secos (0,2 ms para não estalar).
      const entryFade = entryFadeFrames(track, fastSeek ? 1024 : 512, fastSeek);

      const node = this.createPlayer(ctx, bufferLength, {
        sampleRate,
        offsetSamples,
        tempo,
        pitch,
        process: songNeedsProcessing(song),
        primeTargetFrames: fastSeek ? 1024 : 2048,
        fadeInFrames: entryFade,
        ...(ready ? { renderedLeft: ready.left, renderedRight: ready.right, renderedTempo: tempo, renderedPitch: pitch, renderedValidFrames: ready.validFrames, renderedLeadFrames: this.headLeadFrames(clip, tempo, pitch, sampleRate) } : {}),
      });
      const remounted = isClick && (params.bpmAdjust !== 0 || params.tuner !== 0) && this.handClickRemount(node, clip, tempo)
        ? { offsetSamples, fadeInFrames: entryFade }
        : null;
      // Nenhuma cópia do áudio inteiro no Play: vai junto só o trecho da largada, o resto em
      // trechos logo em seguida. Com o começo pronto do disco, só ele por enquanto.
      if (reader) this.feedDisk(node, reader, offsetSamples, PRIORITY_ON_AIR, initial?.get(clip.id));
      else this.feed(node, buffer!, offsetSamples, PRIORITY_ON_AIR, heads ? { totalFrames: bufferLength, availableFrames: buffer!.length } : undefined);

      const clipGain = ctx.createGain();
      clipGain.gain.value = (track.parentId ? channelGainFor(track, tracks, track.volume) : 1) * clipGainFor(clip, clips);
      node.connect(clipGain);

      const readyFor = (nodeRef: AudioWorkletNode, clipId: string) => new Promise<void>((resolve) => this.listen(nodeRef, songId, clipId, resolve));

      if (track.parentId) {
        const clipPan = ctx.createStereoPanner();
        clipPan.pan.value = effectivePan(track.id, track.pan, lr);
        clipGain.connect(clipPan);
        const channel = this.ensureChannel(target.id);
        clipPan.connect(channel.gain);
        channel.gain.gain.value = channelGainFor(target, tracks, target.volume);
        channel.panner.pan.value = effectivePan(target.id, target.pan, lr);
        this.clipPanners.set(clip.id, clipPan);
        pending.push({ clipId: clip.id, node, clip, ready: readyFor(node, clip.id), sampleRate, bufferLength, clipGain, clipPan, remounted });
      } else {
        const channel = this.ensureChannel(target.id);
        clipGain.connect(channel.gain);
        channel.gain.gain.value = channelGainFor(target, tracks, target.volume);
        channel.panner.pan.value = effectivePan(target.id, target.pan, lr);
        pending.push({ clipId: clip.id, node, clip, ready: readyFor(node, clip.id), sampleRate, bufferLength, clipGain, clipPan: null, remounted });
      }
      this.clipGains.set(clip.id, clipGain);
    }

    // Fase 2: espera todos confirmarem o pré-aquecimento. Em pulo rápido
    // (seek durante play), encurtamos drasticamente a janela para o cursor
    // reagir quase imediatamente.
    const primeTimeout = fastSeek ? 120 : 180;
    await Promise.race([
      Promise.all(pending.map((p) => p.ready)),
      new Promise<void>((resolve) => setTimeout(resolve, primeTimeout)),
    ]);
    if (myGen !== this.playGeneration) {
      purgePending();
      return;
    }

    const scheduledStart = ctx.currentTime + this.startLead(fastSeek ? 0.03 : 0.05);
    this.playbackStartTime = scheduledStart - startOffset * alpha;
    this.isPlaying = true;
    this.currentSongId = songId;
    this.endedClips.clear();

    for (const p of pending) {
      // Falhou durante o pré-aquecimento: fica fora de activeClips para a faixa ser recriada no
      // ponto certo pelo scheduleLiveAttach do fim da largada.
      if (this.deadNodes.has(p.node)) {
        try { p.node.disconnect(); } catch { /* ignore */ }
        try { p.clipGain.disconnect(); } catch { /* ignore */ }
        if (p.clipPan) { try { p.clipPan.disconnect(); } catch { /* ignore */ } }
        this.clipGains.delete(p.clipId);
        this.clipPanners.delete(p.clipId);
        continue;
      }
      const whenWall = scheduledStart + Math.max(0, (p.clip.startTime - startOffset)) * alpha;
      const track = tracks.find((t) => t.id === p.clip.trackId);
      const target = track?.parentId ? tracks.find((t) => t.id === track.parentId) ?? track : track;
      const baseGain = (target && track?.parentId ? channelGainFor(track, tracks, track.volume) : 1) * clipGainFor(p.clip, clips);
      scheduleClipFade(p.clipGain, ctx, baseGain, p.clip, clipPlayLength(p.clip), this.playbackStartTime, alpha);
      try {
        if (p.remounted) p.node.port.postMessage({ type: 'seek', offsetSamples: p.remounted.offsetSamples, startTime: whenWall, fadeInFrames: p.remounted.fadeInFrames });
        else p.node.port.postMessage({ startTime: whenWall });
      } catch { /* ignore */ }
      this.activeClips.set(p.clipId, {
        node: p.node,
        clipStartTime: p.clip.startTime,
        scheduledStartWall: whenWall,
        durationSeconds: clipPlayLength(p.clip),
        sampleRate: p.sampleRate,
        bufferLength: p.bufferLength,
        clipGain: p.clipGain,
        clipPanner: p.clipPan,
        trackId: p.clip.trackId,
      });
    }
    // depois das faixas, pelo mesmo motivo da largada pelo preparo
    this.startTimecode(songId, startOffset, scheduledStart, !fastSeek);

    this.startMetering();
    this.scheduleSongEnd(songDuration);

    useStore.getState().setCurrentTime(startOffset);
    store.selectSong(songId);
    if (!fastSeek) this.reportMissing(songId, this.activeClips.keys());
    this.rearmLoop();
    if (!fastSeek) {
      const st = useStore.getState();
      st.setNextSong(computeNextSongId(songId, st.playlist, st.playlistOrder, st.transport.playFlow));
    }
    void this.ensureClickRemounts(songId);
    if (stretched) this.schedulePartialHandoff(songId, myGen, pending, stretched, startOffset, tempo);
    if (heads) void this.finishHeadStart(songId, myGen);
    else if (disk) void this.afterDiskStart(songId, myGen);
    else this.scheduleRender(songId, 0);
    this.applyPendingSeek();
  }

  private applyPendingSeek() {
    const time = this.pendingSeek;
    this.pendingSeek = null;
    if (time !== null) this.seekTo(time);
  }

  // A música no ar lê do disco: espera todas as faixas chegarem inteiras. Só abre a música na
  // memória se precisar — faixa cujo disco falhou ou BPM/tom com áudio ajustado em segundo plano.
  private async afterDiskStart(songId: string, gen: number) {
    const handles = Array.from(this.activeClips.values()).map((a) => this.feeds.get(a.node)).filter((h): h is StreamHandle => !!h);
    const done = Promise.all(handles.map((h) => h.done)).then(() => undefined);
    this.onAirDiskDone = { songId, done };
    await done;
    if (gen !== this.playGeneration || !this.isPlayingSong(songId)) return;
    const failed = Array.from(this.activeClips.entries()).filter(([, a]) => {
      const h = handles.find((x) => this.feeds.get(a.node) === x);
      return !!h && 'failed' in h && (h as DiskHandle).failed;
    });
    // reprodutores guardados de um Play anterior já podem estar com o áudio ajustado
    const wantsRender = this.needsRender(songId);
    if (failed.length === 0 && !wantsRender) return;
    await ensureSongLoaded(songId).catch(() => { /* avisado pelo carregamento */ });
    if (gen !== this.playGeneration || !this.isPlayingSong(songId)) return;
    const store = useStore.getState();
    for (const [clipId, active] of failed) {
      const clip = store.clips.find((c) => c.id === clipId);
      const audio = clip ? getClipPlayAudio(clip) : null;
      if (!audio || !this.ctx) continue;
      const pos = (this.ctx.currentTime - this.playbackStartTime) / (this.playbackAlpha || 1);
      this.feed(active.node, audio, Math.max(0, Math.floor((pos - active.clipStartTime) * audio.sampleRate)), PRIORITY_ON_AIR);
    }
    if (wantsRender) this.scheduleRender(songId, 0);
  }

  /** BPM/tom alterados e algum reprodutor ainda sem o áudio ajustado em segundo plano. */
  private needsRender(songId: string): boolean {
    const store = useStore.getState();
    const song = store.songs.find((s) => s.id === songId);
    if (!song || !songNeedsProcessing(song) || hasSliceParams(song)) return false;
    const tempo = tempoFromBpm(song.bpmAdjust ?? 0);
    const cents = song.tuner * 100;
    const tracks = store.tracks;
    return this.songNodes(songId).some((n) => {
      const track = tracks.find((t) => t.id === n.trackId);
      if (!track) return false;
      const pitch = isMelodicTrack(track, tracks) ? pitchFromCents(cents) : 1;
      return this.nodeRenderKey.get(n.node) !== `${tempo}|${pitch}`;
    });
  }

  private clipsWithSource(songId: string) {
    const store = useStore.getState();
    return store.clips.filter((c) => c.songId === songId && isStemClip(c) && getClipSource(c.id) && store.tracks.some((t) => t.id === c.trackId));
  }

  // A música largou pelo começo pronto: quando o áudio inteiro abre, cada faixa continua nele sem corte.
  // A música NUNCA para por causa disso — ela segue tocando pelo começo pronto, e cada faixa é
  // estendida assim que o resto dela abrir. Faixas que demoram mais ganham novas tentativas em
  // segundo plano sem que o usuário precise fazer Stop/Play.
  private async finishHeadStart(songId: string, gen: number, attempt = 0) {
    await ensureSongLoaded(songId).catch(() => { /* tratado abaixo */ });
    if (gen !== this.playGeneration || !this.isPlayingSong(songId)) return;
    const store = useStore.getState();

    // O áudio inteiro abriu: cada faixa recebe o resto em trechos a partir de onde a música
    // está agora (o que já tocou vem por último), sem parar nem copiar tudo de uma vez.
    const stillMissing: string[] = [];
    const ctx = this.ctx;
    for (const [clipId, active] of Array.from(this.activeClips.entries())) {
      if (gen !== this.playGeneration || this.activeClips.get(clipId) !== active) return;
      const clip = store.clips.find((c) => c.id === clipId);
      const audio = clip ? getClipPlayAudio(clip) : null;
      if (!audio) {
        if (clip) stillMissing.push(clipId);
        continue;
      }
      if (this.headFed.get(active.node) === audio) continue;
      const pos = ctx ? (ctx.currentTime - this.playbackStartTime) / (this.playbackAlpha || 1) : this.playbackOffset;
      const fromFrame = Math.max(0, Math.floor((pos - active.clipStartTime) * audio.sampleRate));
      try {
        this.feed(active.node, audio, fromFrame, PRIORITY_ON_AIR);
        this.headFed.set(active.node, audio);
        active.bufferLength = audio.length;
      } catch {
        stillMissing.push(clipId);
      }
    }
    if (gen !== this.playGeneration) return;

    const HEAD_START_MAX_ATTEMPTS = 20; // ~1 minuto de novas tentativas antes de parar de insistir sozinho
    if (stillMissing.length > 0) {
      const permanentlyGone = stillMissing.filter((id) => {
        const f = loadFailure(id);
        return f === 'missing' || f === 'format';
      });
      const stillLoading = stillMissing.filter((id) => !permanentlyGone.includes(id));
      // Arquivo realmente ausente/corrompido: avisa uma vez por música no ar, sem bloquear o resto dela.
      if (permanentlyGone.length > 0 && this.warnedSongs.get(songId) !== gen) {
        this.warnedSongs.set(songId, gen);
        this.warnIncompleteSong(songId);
      }
      // Só falta de memória/tempo de decodificação: tenta de novo em segundo plano — a faixa
      // entra assim que abrir, sem que o usuário precise fazer nada. A música nunca para para esperar.
      if (stillLoading.length > 0 && attempt < HEAD_START_MAX_ATTEMPTS) {
        const delay = Math.min(4000, 500 + attempt * 400);
        window.setTimeout(() => {
          if (gen === this.playGeneration && this.isPlayingSong(songId)) {
            this.finishHeadStart(songId, gen, attempt + 1);
          }
        }, delay);
        return;
      }
    }

    // Não declare o reprodutor completo se ainda houver faixa sem dados.
    this.headOnly = stillMissing.length > 0;
    if (!this.headOnly) this.scheduleRender(songId, 0);
  }

  // O começo ajustado cobre só os primeiros segundos: antes dele acabar, todas as faixas passam juntas para o áudio inteiro.
  private schedulePartialHandoff(
    songId: string,
    gen: number,
    started: Array<{ clipId: string; clip: { startTime: number }; sampleRate: number }>,
    stretched: Map<string, StretchedHead>,
    startOffset: number,
    tempo: number,
  ) {
    let endWall = Number.POSITIVE_INFINITY;
    for (const p of started) {
      const head = stretched.get(p.clipId);
      if (!head) continue;
      const local = startOffset - p.clip.startTime;
      const fromFrame = local > 0 ? (local * p.sampleRate) / tempo : 0;
      const whenWall = this.playbackStartTime + p.clip.startTime * this.playbackAlpha;
      endWall = Math.min(endWall, Math.max(this.ctx!.currentTime, whenWall) + (head.validFrames - fromFrame) / p.sampleRate);
    }
    if (!Number.isFinite(endWall)) return;
    this.partialActive = true;
    if (this.partialTimer) window.clearTimeout(this.partialTimer);
    const fire = () => {
      this.partialTimer = null;
      if (gen !== this.playGeneration || !this.isPlayingSong(songId) || !this.partialActive) return;
      if (this.headOnly) {
        this.partialTimer = window.setTimeout(fire, 150);
        return;
      }
      // a troca não pode cair em cima do salto do loop: espera ele passar
      const current = useStore.getState().songs.find((s) => s.id === songId);
      const next = current && this.ctx ? this.upcomingJump(current, this.getCurrentTime()) : null;
      if (next && this.ctx && next.at <= this.ctx.currentTime + HANDOFF_LEAD + RETIME_JUMP_GAP) {
        this.partialTimer = window.setTimeout(fire, Math.max(5, (next.at - this.ctx.currentTime) * 1000 + 15));
        return;
      }
      this.handoffFromPartial(songId);
    };
    // Margem proporcional: com o trecho ajustado curto, 4 s fixos trocariam já na largada (o áudio
    // inteiro ainda nem chegou); metade do que resta, no mínimo 1,5 s, no máximo 4 s.
    const left = endWall - this.ctx!.currentTime;
    const margin = Math.min(HANDOFF_MARGIN_SECONDS, Math.max(1.5, left / 2));
    const delay = Math.max(0, (left - margin) * 1000);
    this.partialTimer = window.setTimeout(fire, delay);
  }

  private handoffFromPartial(songId: string) {
    const ctx = this.ctx;
    const store = useStore.getState();
    const song = store.songs.find((s) => s.id === songId);
    this.partialActive = false;
    if (!ctx || !song) return;
    this.settleArmed();
    this.disarmLoop(false);
    // folga maior que a das trocas do operador: a margem de 4 s permite, e o trecho ajustado
    // ainda cobre esse tempo
    const at = ctx.currentTime + HANDOFF_LEAD;
    const alpha = this.playbackAlpha || 1;
    const posAt = (at - this.playbackStartTime) / alpha;
    const tempo = tempoFromBpm(song.bpmAdjust ?? 0);
    const tracks = store.tracks;
    const process = songNeedsProcessing(song);
    this.activeClips.forEach((active) => {
      const track = tracks.find((t) => t.id === active.trackId);
      const pitch = track && !isMelodicTrack(track, tracks) ? 1 : pitchFromCents(song.tuner * 100);
      const local = posAt - active.clipStartTime;
      try {
        if (local >= 0) {
          const offsetSamples = Math.min(active.bufferLength, Math.floor(local * active.sampleRate));
          active.node.port.postMessage({ type: 'retime', tempo, pitch, process, offsetSamples, at, crossfadeFrames: 512, dropPartial: true });
        } else {
          const startTime = this.playbackStartTime + active.clipStartTime * alpha;
          active.node.port.postMessage({ type: 'seek', offsetSamples: 0, startTime, fadeInFrames: 1, dropPartial: true });
          active.scheduledStartWall = startTime;
        }
      } catch { /* ignore */ }
    });
    this.retimeAt = at;
    if (this.retimeTimer) window.clearTimeout(this.retimeTimer);
    this.retimeTimer = window.setTimeout(() => {
      this.retimeTimer = null;
      this.retimeAt = null;
      if (this.isPlaying && this.currentSongId === songId) this.rearmLoop();
    }, HANDOFF_LEAD * 1000 + 30);
    this.armJumpBehindRetime(song, at);
  }

  private armedLoop: { regionId: string; destId: string; start: number; at: number } | null = null;
  private sliceTimer: number | null = null;
  private settledDestId: string | null = null;
  private loopPasses = new Map<string, number>();
  private loopTimer: number | null = null;

  constructor() {
    // Com música tocando, a leitura da próxima vai em ritmo contido para não sufocar a thread de
    // áudio; parado, nada a proteger e ela lê na velocidade do disco.
    diskStreamer.setPacing(() => this.isPlaying);
    // mesma regra para a música em memória: sem isto ela carregaria em ritmo contido mesmo parada
    audioStreamer.setPacing(() => this.isPlaying);
    // diário de engasgos (só memória, nada na tela): window.__vsAudioDiag.copiar()
    iniciarAudioDiag();
    // Outro projeto (ou o mesmo reaberto, com os mesmos IDs): nenhum reprodutor guardado do
    // anterior pode ser reaproveitado com áudio, tom ou BPM antigos, nem continuar soando.
    onAudioLibraryCleared(() => {
      this.stopAll();
      this.invalidatePrepared();
      this.cancelAllRenders();
      this.diskSongs.clear();
      this.onAirDiskDone = null;
      // o LTC montado do projeto anterior sai da memória e não é reaproveitado por um clipe de
      // mesmo id (o mesmo projeto aberto de novo)
      this.timecode?.dispose();
      this.timecode = null;
      this.timecodeLoads.clear();
    });
    useStore.subscribe((s, prev) => {
      // Desfazer/Refazer (e qualquer outra mudança no estado) chega ao som: fader master e
      // BPM/tom de cada música — antes só os botões aplicavam, e o Ctrl+Z mudava só a tela.
      if (s.masterVolume !== prev.masterVolume) this.setMasterVolume(s.masterVolume);
      if (s.songs !== prev.songs) {
        const before = new Map(prev.songs.map((sg) => [sg.id, sg]));
        for (const sg of s.songs) {
          const old = before.get(sg.id);
          if (old && old !== sg && playbackKey(old) !== playbackKey(sg)) this.applySongPlaybackParams(sg.id);
        }
      }
      if (s.levelMatch !== prev.levelMatch || s.levelMatchLufs !== prev.levelMatchLufs || s.songLoudness !== prev.songLoudness || s.playlist !== prev.playlist || s.magicRoutingActive !== prev.magicRoutingActive) this.applySongLevel();
      // placa desconectada ou de volta: as saídas diretas voltam para o LR ou para a placa
      if (s.audioInterfaceConnected !== prev.audioInterfaceConnected || s.audioInterface !== prev.audioInterface) {
        this.routeMaster();
        this.routedTo.delete(TIMECODE_TRACK_ID);
        this.channels.forEach((_, id) => this.routeChannel(id));
      }
      if (s.magicRoutingActive !== prev.magicRoutingActive) {
        this.routeMaster();
        this.routedTo.delete(TIMECODE_TRACK_ID);
        this.channels.forEach((_, id) => this.routeChannel(id));
        this.applyLimiterMode();
      }
      // canal mudou de saída: o Master desligado pode precisar voltar (saída que a placa não tem)
      if (s.masterOutputOff !== prev.masterOutputOff || s.tracks !== prev.tracks) this.routeMaster();
      if (s.masterOutputOff !== prev.masterOutputOff) this.channels.forEach((ch, id) => this.updateChannelLevel(id, ch, 0.08));
      if (s.masterOutputChannel !== prev.masterOutputChannel || s.masterOutputStereo !== prev.masterOutputStereo) {
        this.routeMaster();
        this.routedTo.delete(TIMECODE_TRACK_ID);
        this.routeChannel(TIMECODE_TRACK_ID);
      }
      if (s.magicRoutingActive !== prev.magicRoutingActive || s.masterAntiClip !== prev.masterAntiClip) this.applyMasterAntiClip();
      if ((s.songs !== prev.songs || s.queuedRegion !== prev.queuedRegion) && this.isPlaying) this.rearmLoop();
      if (s.clips !== prev.clips || s.tracks !== prev.tracks) this.rerouteMovedClips();
      if (s.tracks !== prev.tracks) this.channels.forEach((_, id) => this.routeChannel(id));
      if (s.tracks !== prev.tracks) this.syncAntiClip(s.tracks);
      // Se clipes foram apagados, divididos ou cortados enquanto toca, recalcula o fim da música
      if (s.clips !== prev.clips && this.isPlaying && this.currentSongId) {
        this.scheduleSongEnd();
        // clipe novo na música no ar (fala do Maestro IA que chegou com o Play rodando) entra já
        this.scheduleLiveAttach();
      }
    });
  }

  // Clipe movido para outra faixa (tocando ou já preparado) passa a sair pela faixa nova na hora.
  private rerouteMovedClips() {
    const ctx = this.ctx;
    if (!ctx) return;
    const { clips, tracks, lrMasterActive } = useStore.getState();
    const items: [string, { trackId: string; clipGain: GainNode; clipPanner: StereoPannerNode | null }][] = [];
    this.activeClips.forEach((a, id) => items.push([id, a]));
    this.prepared.forEach((b) => b.pending.forEach((p) => items.push([p.clipId, p])));
    for (const [clipId, item] of items) {
      const clip = clips.find((c) => c.id === clipId);
      if (!clip || clip.trackId === item.trackId) continue;
      const track = tracks.find((t) => t.id === clip.trackId);
      if (!track) continue;
      const target = track.parentId ? tracks.find((t) => t.id === track.parentId) ?? track : track;
      const songClips = clips.filter((c) => c.songId === clip.songId);
      try { item.clipGain.disconnect(); } catch { /* ignore */ }
      if (item.clipPanner) { try { item.clipPanner.disconnect(); } catch { /* ignore */ } }
      const channel = this.ensureChannel(target.id);
      if (track.parentId) {
        const panner = item.clipPanner ?? ctx.createStereoPanner();
        // rampa curta: o pan pulando de valor no meio da música estala
        this.rampParam(panner.pan, effectivePan(track.id, track.pan, lrMasterActive));
        item.clipGain.connect(panner);
        panner.connect(channel.gain);
        item.clipPanner = panner;
        this.clipPanners.set(clipId, panner);
        // rampa: o clipe pode estar tocando, e o ganho em salto estala
        this.rampParam(item.clipGain.gain, channelGainFor(track, tracks, track.volume) * clipGainFor(clip, songClips));
      } else {
        item.clipPanner = null;
        this.clipPanners.delete(clipId);
        item.clipGain.connect(channel.gain);
        this.rampParam(item.clipGain.gain, clipGainFor(clip, songClips));
      }
      // o canal de destino pode estar soando outras faixas: rampa em vez de salto
      this.rampParam(channel.gain.gain, channelGainFor(target, tracks, target.volume));
      item.trackId = clip.trackId;
    }
  }

  private disarmLoop(notifyNodes: boolean) {
    if (this.loopTimer) { clearTimeout(this.loopTimer); this.loopTimer = null; }
    this.timecode?.cancelJump();
    if (this.armedLoop && notifyNodes) {
      this.activeClips.forEach((a) => {
        try { a.node.port.postMessage({ type: 'cancelJump' }); } catch { /* ignore */ }
      });
    }
    const wasArmed = !!this.armedLoop;
    this.armedLoop = null;
    // o salto não vai mais acontecer: o corte de cada clipe volta para o relógio de agora
    if (wasArmed && this.isPlaying && this.ctx) this.refreshClipFades(this.ctx.currentTime, this.playbackStartTime, this.playbackAlpha || 1);
  }

  /**
   * O ganho de cada clipe tem o fim dele marcado no relógio do áudio. Quando esse relógio muda de
   * posição (salto de loop, BPM trocado com a música tocando), a marca antiga cortaria o som na hora
   * errada. Reagenda tudo a partir de `from` com o relógio que vale daquele instante em diante.
   */
  private refreshClipFades(from: number, playbackStart: number, alpha: number) {
    const ctx = this.ctx;
    if (!ctx || this.activeClips.size === 0) return;
    const { clips, tracks } = useStore.getState();
    const songClips = clips.filter((c) => c.songId === this.currentSongId);
    this.activeClips.forEach((active, clipId) => {
      const clip = songClips.find((c) => c.id === clipId);
      if (!clip) return;
      const track = tracks.find((t) => t.id === clip.trackId);
      const base = (track?.parentId ? channelGainFor(track, tracks, track.volume) : 1) * clipGainFor(clip, songClips);
      scheduleClipFade(active.clipGain, ctx, base, { ...clip, startTime: active.clipStartTime }, active.durationSeconds, playbackStart, alpha, 0, from);
    });
  }

  /** Mexeu no ganho de um clipe com um salto marcado: o trecho depois do salto volta a valer. */
  private reapplyArmedFades() {
    const armed = this.armedLoop;
    if (!armed) return;
    const alpha = this.playbackAlpha || 1;
    this.refreshClipFades(armed.at, armed.at - armed.start * alpha, alpha);
  }

  // Decide o próximo salto: com uma região marcada como "Próximo", pula para ela ao fim da
  // região atual; senão repete a próxima região com loop. O salto acontece dentro do
  // reprodutor de áudio, no tempo exato, com crossfade de ~5ms.
  private findJump(song: Song, regions: SongRegion[], pos: number, queuedId: string | null): { sourceId: string; boundary: number; dest: { id: string; start: number } } | null {
    const region = this.findRegionJump(regions, pos, queuedId);
    // Fatias desmarcadas do medley são puladas pelo mesmo salto exato das regiões.
    const skip = skipJumpAt(song, pos);
    if (skip && (!region || skip.boundary < region.boundary - 1e-6)) {
      return { sourceId: `skip-${skip.destId}`, boundary: skip.boundary, dest: { id: skip.destId, start: skip.destStart } };
    }
    return region;
  }

  private findRegionJump(regions: SongRegion[], pos: number, queuedId: string | null): { sourceId: string; boundary: number; dest: SongRegion } | null {
    const queued = queuedId ? regions.find((r) => r.id === queuedId) : undefined;
    for (const r of regions) {
      if (r.end <= pos + 0.005 || r.end - r.start <= 0.05) continue;
      // Chegando na região marcada pelo caminho normal: um "salto" para o mesmo ponto apenas confirma a chegada.
      if (queued && r.id === queued.id) return { sourceId: `arrive-${r.id}`, boundary: r.start, dest: r };
      if (queued) return { sourceId: r.id, boundary: r.end, dest: queued };
      if (r.loop && (!r.repeat || (this.loopPasses.get(r.id) ?? 0) < r.repeat - 1)) return { sourceId: r.id, boundary: r.end, dest: r };
    }
    return null;
  }

  // Cada fatia do medley pode ter BPM/tom próprios: troca no instante exato da divisa.
  private syncSliceParams(song: Song, pos: number, jumpAt: number): boolean {
    if (!hasSliceParams(song)) return false;
    const alpha = this.playbackAlpha || 1;
    const ahead = pos + RETIME_LEAD / alpha;
    const differs = (p: { bpmAdjust: number; tuner: number }) => bpmAdjustToAlpha(p.bpmAdjust) !== this.playbackAlpha || p.tuner * 100 !== this.playbackCents;
    if (jumpAt > ahead && differs(paramsAt(song, ahead))) {
      this.retimeLive(song);
      return true;
    }
    const next = medleySlices(song).find((s) => s.start > ahead && s.start < jumpAt && differs(sliceParams(song, s)));
    if (next) {
      const delay = Math.max(0, ((next.start - pos) * alpha - RETIME_LEAD) * 1000 + 5);
      this.sliceTimer = window.setTimeout(() => {
        this.sliceTimer = null;
        if (this.isPlaying) this.rearmLoop();
      }, delay);
    }
    return false;
  }

  private rearmLoop() {
    this.settleArmed();
    if (this.sliceTimer) { clearTimeout(this.sliceTimer); this.sliceTimer = null; }
    const ctx = this.ctx;
    const store = useStore.getState();
    const song = this.currentSongId ? store.songs.find((s) => s.id === this.currentSongId) : undefined;
    if (!this.isPlaying || !ctx || !song) {
      this.disarmLoop(true);
      return;
    }
    // uma troca de BPM/tom já está a caminho; ela mesma rearma ao terminar
    if (this.retimeTimer) return;
    const alpha = this.playbackAlpha || 1;
    const pos = this.getCurrentTime();
    const queued = store.queuedRegion?.songId === song.id ? store.queuedRegion.regionId : null;
    const regions = sortedRegions(song.regions);
    for (const id of [...this.loopPasses.keys()]) {
      const r = regions.find((x) => x.id === id);
      if (!r || pos < r.start - 0.005 || pos >= r.end) this.loopPasses.delete(id);
    }
    const inQueued = queued ? regions.find((r) => r.id === queued && pos >= r.start - 0.005 && pos < r.end) : undefined;
    if (inQueued) {
      store.setQueuedRegion(null);
      return;
    }
    const jump = this.findJump(song, regions, pos, queued);
    if (this.syncSliceParams(song, pos, jump?.boundary ?? Number.POSITIVE_INFINITY)) return;
    if (!jump) {
      const had = !!this.armedLoop;
      this.disarmLoop(true);
      if (had) this.scheduleSongEnd(song.duration);
      this.flushDeferredRetime();
      return;
    }
    const target = jump.dest;
    const at = this.playbackStartTime + jump.boundary * alpha;
    const armed = this.armedLoop;
    if (armed && armed.regionId === jump.sourceId && armed.destId === target.id && Math.abs(armed.start - target.start) < 1e-6 && Math.abs(armed.at - at) < 0.0005) return;
    this.sendJump(song, jump, at, false);
  }

  /** Marca o salto em todos os clipes. `afterRetime`: ele vai para a fila, atrás da troca de BPM/tom já marcada. */
  private sendJump(song: Song, jump: { sourceId: string; dest: { id: string; start: number } }, at: number, afterRetime: boolean) {
    const ctx = this.ctx;
    if (!ctx) return;
    const alpha = this.playbackAlpha || 1;
    const target = jump.dest;
    this.disarmLoop(false);
    for (const clip of useStore.getState().clips) {
      if (clip.songId !== song.id) continue;
      const active = this.activeClips.get(clip.id);
      if (!active) continue;
      const local = target.start - clip.startTime;
      const offsetSamples = local > 0 ? Math.min(active.bufferLength, Math.floor(local * active.sampleRate)) : 0;
      const resumeAt = at + Math.max(0, -local) * alpha;
      try {
        active.node.port.postMessage({ type: 'jump', at, resumeAt, offsetSamples, crossfadeFrames: 256, dropPartial: true, ...(afterRetime ? { afterRetime: true } : {}) });
      } catch { /* ignore */ }
    }
    this.jumpTimecode(song.id, target.start, at);
    this.armedLoop = { regionId: jump.sourceId, destId: target.id, start: target.start, at };
    // depois do salto vale o relógio novo: o fim de cada clipe é remarcado a partir dele
    this.reapplyArmedFades();
    if (this.songEndTimeout) { clearTimeout(this.songEndTimeout); this.songEndTimeout = null; }
    const delay = Math.max(0, (at - ctx.currentTime) * 1000);
    this.loopTimer = window.setTimeout(() => this.commitLoop(), delay);
  }

  /** Próximo salto da música a partir de `pos`, com a hora dele no relógio de agora. */
  private upcomingJump(song: Song, pos: number): { jump: { sourceId: string; boundary: number; dest: { id: string; start: number } }; at: number } | null {
    const store = useStore.getState();
    const queued = store.queuedRegion?.songId === song.id ? store.queuedRegion.regionId : null;
    const jump = this.findJump(song, sortedRegions(song.regions), pos, queued);
    return jump ? { jump, at: this.playbackStartTime + jump.boundary * (this.playbackAlpha || 1) } : null;
  }

  /**
   * Cada reprodutor tem uma vaga de troca marcada, e a troca de BPM/tom ocupa essa vaga. Se o fim do loop
   * cai antes dela, o salto fica onde está e a troca é refeita logo depois dele; a música nunca passa
   * do fim do loop por causa de um ajuste de BPM.
   */
  private jumpComesFirst(song: Song, retimeAt: number): boolean {
    const next = this.upcomingJump(song, this.getCurrentTime());
    if (!next || next.at > retimeAt + RETIME_JUMP_GAP) return false;
    // uma troca já marcada ocupa a vaga e o salto antes dela não teria onde entrar
    const inFlight = this.retimeAt !== null && this.ctx !== null && this.retimeAt > this.ctx.currentTime;
    if (!this.armedLoop && !inFlight) this.sendJump(song, next.jump, next.at, false);
    return !!this.armedLoop;
  }

  /** Troca de BPM/tom que esperou o salto do loop: entra agora, se ainda houver o que trocar. */
  private flushDeferredRetime() {
    const id = this.retimeAfterJump;
    this.retimeAfterJump = null;
    if (!id || id !== this.currentSongId || !this.isPlaying) return;
    const song = useStore.getState().songs.find((s) => s.id === id);
    if (!song) return;
    const p = paramsAt(song, this.getCurrentTime());
    if (bpmAdjustToAlpha(p.bpmAdjust) === this.playbackAlpha && p.tuner * 100 === this.playbackCents) return;
    this.retimeLive(song);
  }

  /** Depois de uma troca de BPM/tom, o salto seguinte já fica marcado, na fila atrás dela. */
  private armJumpBehindRetime(song: Song, retimeAt: number) {
    const alpha = this.playbackAlpha || 1;
    const next = this.upcomingJump(song, (retimeAt - this.playbackStartTime) / alpha);
    if (next && next.at > retimeAt + RETIME_JUMP_GAP) this.sendJump(song, next.jump, next.at, true);
  }

  // Aplica o salto quando o relógio de áudio já passou dele, mesmo que o timer da tela atrase.
  private settleArmed() {
    const armed = this.armedLoop;
    if (!armed || !this.ctx || this.ctx.currentTime < armed.at) return;
    const alpha = this.playbackAlpha || 1;
    this.playbackStartTime = armed.at - armed.start * alpha;
    this.playbackOffset = armed.start;
    this.armedLoop = null;
    this.settledDestId = armed.destId;
    if (armed.regionId === armed.destId) this.loopPasses.set(armed.destId, (this.loopPasses.get(armed.destId) ?? 0) + 1);
  }

  private commitLoop() {
    this.loopTimer = null;
    if (!this.isPlaying || !this.ctx) return;
    const armed = this.armedLoop;
    if (armed && this.ctx.currentTime < armed.at) {
      this.loopTimer = window.setTimeout(() => this.commitLoop(), Math.max(5, (armed.at - this.ctx.currentTime) * 1000 + 5));
      return;
    }
    this.settleArmed();
    const st = useStore.getState();
    st.setCurrentTime(this.getCurrentTime());
    const dest = this.settledDestId;
    this.settledDestId = null;
    if (dest && st.queuedRegion?.regionId === dest) st.setQueuedRegion(null);
    this.flushDeferredRetime();
    this.rearmLoop();
    if (!this.armedLoop) {
      const song = useStore.getState().songs.find((s) => s.id === this.currentSongId);
      if (song) this.scheduleSongEnd(song.duration);
    }
    // Fala adicionada atrás do cursor dentro do loop: depois do salto ela está à frente e entra.
    this.scheduleLiveAttach();
  }

  // A tela precisa saber qual música está no ar também quando o programa passa sozinho para a próxima.
  private songLevel = 1;
  /** Último ganho pedido a cada canal (o valor do parâmetro muda durante a rampa). */
  private levelTargets = new WeakMap<ChannelNode, number>();

  // No LR mágico cada canal estéreo vai todo para um lado: o pan soma L+R (+6 dB num sinal igual
  // nos dois lados). A soma entra a -6 dB, então a faixa sai no mesmo volume, sem estourar o L.
  // O "volume igual" vale só para a banda: click, guia e Maestro ficam fixos; o timecode nunca muda.
  private channelLevel(trackId: string): number {
    if (isTimecodeTrackId(trackId)) return 1;
    const st = useStore.getState();
    const magic = st.magicRoutingActive ? MAGIC_SUM_GAIN : 1;
    // Master desligado: o fader dele é o geral do multipista. Canal que vai para o Master já
    // passa por esse fader, então só entra nos que têm saída própria.
    const route = this.routedTo.get(trackId);
    const general = route && route !== 'master' ? directOutFaderGain(!!st.masterOutputOff, st.masterVolume) : 1;
    return (isFixedLevelTrack(trackId, st.tracks) ? magic : this.songLevel * magic) * general;
  }

  private updateChannelLevel(trackId: string, ch: ChannelNode, time: number) {
    const g = this.channelLevel(trackId);
    if (Math.abs((this.levelTargets.get(ch) ?? ch.level.gain.value) - g) < 1e-6) return;
    this.levelTargets.set(ch, g);
    this.rampParam(ch.level.gain, g, time);
  }

  /** Ganho do "volume igual" para a música no ar, em todas as saídas da banda. */
  applySongLevel(songId: string | null = this.currentSongId) {
    this.songLevel = songId ? songLevelGain(useStore.getState(), songId) : 1;
    this.channels.forEach((ch, id) => this.updateChannelLevel(id, ch, 0.08));
  }

  private markOnAir(songId: string) {
    this.applySongLevel(songId);
    useStore.setState((s) => {
      const t = s.transport;
      if (t.currentSongId === songId && t.isPlaying) return s;
      return {
        transport: {
          ...t,
          currentSongId: songId,
          isPlaying: true,
          isPaused: false,
          isStopped: false,
          songProgress: t.currentSongId === songId ? t.songProgress : 0,
          nextSongCountdown: t.currentSongId === songId ? t.nextSongCountdown : 0,
        },
      };
    });
  }

  private handleClipEnded(songId: string, clipId: string) {
    if (!this.isPlaying || this.currentSongId !== songId || this.armedLoop) return;
    this.endedClips.add(clipId);
    if (this.activeClips.size > 0 && Array.from(this.activeClips.keys()).every((id) => this.endedClips.has(id))) {
      // Ao terminar o áudio mais longo do VS, já parte imediatamente para a próxima música sem engasgo
      this.onSongEnd();
    }
  }

  private scheduleSongEnd(songDuration?: number) {
    if (this.songEndTimeout) { clearTimeout(this.songEndTimeout); this.songEndTimeout = null; }
    // com um loop armado, o fim da música só é agendado quando o loop for desligado
    if (this.armedLoop) return;
    const pos = this.getCurrentTime();
    const store = useStore.getState();
    const song = store.songs.find((s) => s.id === this.currentSongId);
    if (!song) return;

    // Se o usuário splitou o VS e apagou a parte da direita, ou arrastou a aresta (trim),
    // o novo final é exatamente o ponto onde o áudio mais longo termina.
    const activeClipsList = store.clips.filter((c) => c.songId === song.id && isStemClip(c) && store.tracks.some((t) => t.id === c.trackId));
    const maxClipEnd = activeClipsList.length > 0
      ? Math.max(...activeClipsList.map((c) => c.startTime + clipPlayLength(c)))
      : song.duration;
    const baseDuration = Math.min(songDuration ?? song.duration, maxClipEnd);
    const end = pos < playableEnd(song) - 0.01 ? Math.min(baseDuration, playableEnd(song)) : baseDuration;
    const remaining = Math.max(0, (end - pos) * this.playbackAlpha * 1000);
    this.songEndTimeout = window.setTimeout(() => this.songEndDue(end, pos), remaining);
  }

  // O timer anda no relógio do sistema e a música no do áudio: com a thread de áudio atrasada, ele
  // chegava antes e cortava o final. Só encerra quando o áudio chegou lá. Relógio parado (placa
  // perdida) não segura a passagem para a próxima música.
  private songEndDue(end: number, lastPos: number) {
    this.songEndTimeout = null;
    if (!this.isPlaying) return;
    const pos = this.getCurrentTime();
    const left = (end - pos) * (this.playbackAlpha || 1);
    if (left > 0.02 && pos > lastPos + 1e-3) {
      this.songEndTimeout = window.setTimeout(() => this.songEndDue(end, pos), left * 1000);
      return;
    }
    this.onSongEnd();
  }

  // Passada da música (playGeneration) cujo fim já foi tratado.
  private songEndGen = -1;

  private onSongEnd() {
    // Dois avisos de fim (o último reprodutor esgotou e o timer do fim) chegam quase juntos. Se a
    // próxima ainda está abrindo do disco, a música que acabou continua "no ar" e o segundo aviso
    // mandava tocar a seguinte da próxima: a próxima era pulada no palco.
    if (this.songEndGen === this.playGeneration) return;
    this.songEndGen = this.playGeneration;
    if (this.songEndTimeout) { clearTimeout(this.songEndTimeout); this.songEndTimeout = null; }
    const store = useStore.getState();
    const { transport } = store;

    if (transport.playFlow === 'uma-uma') {
      store.stop();
      this.stopAll();
      return;
    }

    const armed = transport.nextSongId && transport.nextSongId !== this.currentSongId && store.playlistOrder.includes(transport.nextSongId)
      ? transport.nextSongId : null;
    const nextSongId = armed ?? computeNextSongId(this.currentSongId, store.playlist, store.playlistOrder, transport.playFlow);
    if (nextSongId) {
      const endedId = this.currentSongId;
      const endedGen = this.playGeneration;
      this.playSong(nextSongId, entryPoint(store.songs.find((s) => s.id === nextSongId)))
        .catch((err) => console.error('[auto] falha ao tocar a próxima', err))
        .finally(() => {
          // A próxima não largou (sem faixas, erro ao abrir): a tela não fica em TOCANDO sem som.
          if (this.startsInFlight > 0) return;
          const s = useStore.getState();
          if (!s.transport.isPlaying) return;
          const stuck = this.isPlaying && this.currentSongId === endedId && this.playGeneration === endedGen;
          if (this.isPlaying && !stuck) return;
          if (stuck) this.stopAll();
          s.stop(s.transport.currentTime);
          s.setPlaybackError('Não foi possível tocar a próxima música. Selecione a música e dê Play.');
        });
      const st = useStore.getState();
      st.setNextSong(computeNextSongId(nextSongId, st.playlist, st.playlistOrder, st.transport.playFlow));
      return;
    }

    const endedId = this.currentSongId;
    store.stop();
    this.stopAll();
    // Fim do bloco: a primeira música do bloco seguinte fica armada (selecionada, marcada como
    // próxima e com o áudio já preparado), esperando só o Play.
    if (transport.playFlow === 'bloco' && endedId) {
      const st = useStore.getState();
      const following = st.playlistOrder[st.playlistOrder.indexOf(endedId) + 1];
      if (following) {
        st.selectSong(following);
        st.setNextSong(following);
      }
    }
  }

  stopAll() {
    this.disarmLoop(false);
    if (this.sliceTimer) { clearTimeout(this.sliceTimer); this.sliceTimer = null; }
    if (this.retimeTimer) { clearTimeout(this.retimeTimer); this.retimeTimer = null; }
    this.retimeAt = null;
    this.retimeAfterJump = null;
    const stoppedSongId = this.currentSongId;
    this.isPlaying = false;
    this.pendingSeek = null;
    this.currentSongId = null;
    this.playGeneration++;
    this.clearStarved();
    this.seekRequest++;
    // Pulo pendente morre junto: senão o próximo Play deixava o cursor parado até alcançar o ponto antigo.
    this.seekLock.active = false;
    this.timecode?.stop();
    this.timecodeClipId = null;
    if (this.songEndTimeout) { clearTimeout(this.songEndTimeout); this.songEndTimeout = null; }
    const ctx = this.ctx;
    const now = ctx?.currentTime ?? 0;
    const fade = 0.012;
    this.clipGains.forEach((g) => {
      try {
        if (ctx) {
          g.gain.cancelScheduledValues(now);
          g.gain.setValueAtTime(g.gain.value, now);
          g.gain.linearRampToValueAtTime(0, now + fade);
        }
      } catch { /* ignore */ }
    });
    const retained = stoppedSongId && !this.headOnly ? this.retainForReuse(stoppedSongId) : false;
    this.headOnly = false;
    this.partialActive = false;
    if (this.partialTimer) { window.clearTimeout(this.partialTimer); this.partialTimer = null; }
    if (stoppedSongId && !retained) {
      this.cancelRender(stoppedSongId);
      this.diskSongs.delete(stoppedSongId);
    }
    if (this.onAirDiskDone?.songId === stoppedSongId) this.onAirDiskDone = null;
    const toDisconnect = retained ? [] : Array.from(this.activeClips.entries());
    const gainsSnapshot = retained ? new Map<string, GainNode>() : new Map(this.clipGains);
    const pannersSnapshot = retained ? new Map<string, StereoPannerNode>() : new Map(this.clipPanners);
    this.activeClips.clear();
    this.clipGains.clear();
    this.clipPanners.clear();
    const disconnect = () => {
      toDisconnect.forEach(([, active]) => {
        this.unfeed(active.node);
        try { active.node.port.postMessage({ type: 'stop' }); } catch { /* ignore */ }
        try { active.node.disconnect(); } catch { /* ignore */ }
      });
      gainsSnapshot.forEach((g) => { try { g.disconnect(); } catch { /* ignore */ } });
      pannersSnapshot.forEach((p) => { try { p.disconnect(); } catch { /* ignore */ } });
    };
    if (ctx) setTimeout(disconnect, Math.ceil(fade * 1000) + 5);
    else disconnect();
    this.stopMetering();

    resetMeters();
  }

  // Guarda os reprodutores parados (em silêncio) para o próximo Play não precisar recarregar o áudio.
  private retainForReuse(songId: string): boolean {
    const memorySig = this.computePrepareSignature(songId);
    const fromDisk = !memorySig && this.diskSongs.has(songId);
    const sig = memorySig ?? (fromDisk ? this.diskSignature(songId) : null);
    if (!sig || this.activeClips.size === 0 || !this.coversAllClips(songId, this.activeClips.keys())) return false;
    const old = this.prepared.get(songId);
    if (old) this.disposePreparedBundle(old);
    const fadeEnd = (this.ctx?.currentTime ?? 0) + 0.015;
    const pending: PreparedPending[] = [];
    this.activeClips.forEach((a, clipId) => {
      // o que ainda faltava chegar deste reprodutor sai da frente da próxima música no ar
      this.focusFeed(a.node, 0, PRIORITY_NEXT);
      pending.push({
        clipId,
        node: a.node,
        clipStartTime: a.clipStartTime,
        clipDuration: a.durationSeconds,
        ready: Promise.resolve(),
        sampleRate: a.sampleRate,
        bufferLength: a.bufferLength,
        clipGain: a.clipGain,
        clipPanner: a.clipPanner,
        trackId: a.trackId,
      });
    });
    const bundle: PreparedBundle = { songId, signature: sig, pending, snapshots: this.preparedSnapshots(songId), disk: fromDisk };
    this.prepared.set(songId, bundle);
    // Silencia só depois do fade-out; se um Play já reaproveitou os reprodutores, não mexe.
    window.setTimeout(() => {
      if (this.prepared.get(songId) !== bundle) return;
      for (const p of pending) {
        try { p.node.port.postMessage({ type: 'seek', offsetSamples: 0, silent: true, dropPartial: true }); } catch { /* ignore */ }
      }
    }, Math.max(20, ((fadeEnd - (this.ctx?.currentTime ?? 0)) * 1000) + 10));
    return true;
  }

  seekTo(time: number) {
    // largada em preparo: o motor ainda não toca, e o pulo vale assim que ela terminar
    if (!this.isPlaying && this.startsInFlight > 0) {
      this.pendingSeek = time;
      return;
    }
    if (!this.currentSongId) return;
    if (!this.isPlaying) {
      useStore.getState().setCurrentTime(time);
      return;
    }
    const ctx = this.ctx;
    const store = useStore.getState();
    const songId = this.currentSongId;
    const clips = store.clips.filter((c) => c.songId === songId && isStemClip(c) && store.tracks.some((t) => t.id === c.trackId));
    // Só impede o pulo no lugar quem TEM áudio aberto e ainda não está tocando (ex.: clipe colado agora).
    // Faixa sem áudio (arquivo ausente ou ainda abrindo) não pode forçar a reconstrução de todos os
    // reprodutores a cada clique no cursor — era isso que deixava o cursor lento e travando; essas
    // faixas entram sozinhas assim que o áudio abrir (lateAttach).
    const blocking = clips.filter((c) => !this.activeClips.has(c.id) && time < c.startTime + clipPlayLength(c) && !!getClipPlayAudio(c));
    const canSeekInPlace = ctx !== null && !this.headOnly && this.activeClips.size > 0 && blocking.length === 0;

    if (!canSeekInPlace) {
      this.seekLock = { active: true, targetTime: time };
      const request = ++this.seekRequest;
      const generation = this.playGeneration;
      // Não derruba a música enquanto a faixa inteira ainda abre. Apenas o último clique vale.
      void ensureSongLoaded(songId).catch((err) => console.warn('[seekTo] falha ao carregar', err)).then(() => {
        if (request !== this.seekRequest || generation !== this.playGeneration || !this.isPlayingSong(songId)) return;
        if (!isSongLoaded(songId)) {
          this.seekLock.active = false;
          this.warnIncompleteSong(songId);
          return;
        }
        this.playSong(songId, time, { fastSeek: true }).catch((err) => {
          console.error('[seekTo] falha', err);
          this.seekLock.active = false;
        });
      });
      return;
    }

    this.seekRequest++;
    this.endedClips.clear();
    this.seekLock = { active: true, targetTime: time };
    const tracks = store.tracks;
    const song = store.songs.find((s) => s.id === songId);
    const params = song ? paramsAt(song, time) : { bpmAdjust: 0, tuner: 0 };
    const alpha = bpmAdjustToAlpha(params.bpmAdjust);
    const cents = params.tuner * 100;
    const scheduledStart = ctx!.currentTime + this.startLead(0.05);
    this.playbackAlpha = alpha;
    this.playbackCents = cents;
    this.playbackStartTime = scheduledStart - time * alpha;
    this.playbackOffset = time;

    for (const clip of clips) {
      const active = this.activeClips.get(clip.id);
      if (!active) continue;
      const localOffset = time - clip.startTime;

      let offsetSamples = 0;
      let whenWall = scheduledStart;
      if (localOffset <= 0) {
        offsetSamples = 0;
        whenWall = scheduledStart + Math.max(0, (clip.startTime - time)) * alpha;
      } else {
        offsetSamples = Math.min(active.bufferLength, Math.floor(localOffset * active.sampleRate));
      }

      const track = tracks.find((t) => t.id === clip.trackId);
      const melodic = track ? isMelodicTrack(track, tracks) : true;
      try {
        active.node.port.postMessage({
          type: 'seek',
          offsetSamples,
          startTime: whenWall,
          fadeInFrames: entryFadeFrames(track, 1024, true),
          dropPartial: true,
          tempo: tempoFromBpm(params.bpmAdjust),
          pitch: melodic ? pitchFromCents(cents) : 1,
          process: songNeedsProcessing(song),
        });
      } catch { /* ignore */ }
      active.scheduledStartWall = whenWall;
      this.focusFeed(active.node, offsetSamples);

      // Reagenda automação do fade para a nova posição do cursor em tempo real
      const target = track?.parentId ? tracks.find((tr) => tr.id === track.parentId) ?? track : track;
      const baseGain = (target && track?.parentId ? channelGainFor(track, tracks, track.volume) : 1) * clipGainFor(clip, clips);
      scheduleClipFade(active.clipGain, ctx!, baseGain, clip, active.durationSeconds, this.playbackStartTime, alpha);
    }
    this.startTimecode(songId, time, scheduledStart, false);

    this.disarmLoop(false);
    if (song) {
      this.scheduleSongEnd(song.duration);
    }
    useStore.getState().setCurrentTime(time);
    this.rearmLoop();
  }

  beginUserSeek(time: number) {
    this.seekLock = { active: true, targetTime: time };
  }

  endUserSeek() {
    this.seekLock.active = false;
  }

  isUserSeeking(): boolean {
    return this.seekLock.active;
  }

  isRunning(): boolean {
    return this.isPlaying;
  }

  // Tarefas pesadas e adi\u00e1veis esperam o play parar para n\u00e3o disputar o processador com o som.
  async waitUntilIdle(): Promise<void> {
    while (this.isPlaying || this.startsInFlight > 0) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  getCurrentTime(): number {
    if (!this.isPlaying || !this.ctx) return this.playbackOffset;
    this.settleArmed();
    const alpha = this.playbackAlpha || 1;
    return (this.ctx.currentTime - this.playbackStartTime) / alpha;
  }

  /**
   * Posição do som que está saindo da placa agora, para a linha do cursor. getCurrentTime é o relógio
   * de render, que anda à frente do que se ouve pela latência de saída. Só para mostrar: quem agenda
   * áudio continua usando getCurrentTime.
   */
  getHeardTime(): number {
    const t = this.getCurrentTime();
    if (!this.isPlaying || !this.ctx) return t;
    const latency = (this.ctx.baseLatency || 0) + (this.ctx.outputLatency || 0);
    return Math.max(0, t - latency / (this.playbackAlpha || 1));
  }

  private rampParam(param: AudioParam, target: number, time = 0.012) {
    const ctx = this.ctx;
    if (!ctx) { param.value = target; return; }
    const now = ctx.currentTime;
    try {
      param.cancelScheduledValues(now);
      param.setValueAtTime(param.value, now);
      param.linearRampToValueAtTime(target, now + time);
    } catch {
      param.value = target;
    }
  }

  updateTrackParams(trackId: string, track: Track, allTracks?: Track[]) {
    const all = allTracks ?? [track];
    const lrActive = useStore.getState().lrMasterActive;
    if (track.parentId) {
      const store = useStore.getState();
      const trackGain = channelGainFor(track, all, track.volume);
      const targetPan = effectivePan(track.id, track.pan, lrActive);
      let settled = false;
      store.clips.forEach((c) => {
        if (c.trackId === trackId) {
          const g = this.clipGains.get(c.id);
          if (g) {
            const songClips = store.clips.filter((sc) => sc.songId === c.songId);
            const base = trackGain * clipGainFor(c, songClips);
            const active = this.activeClips.get(c.id);
            // O fader da faixa filha mora no mesmo ganho em que o fade do clipe está agendado:
            // a rampa simples apagava o fade (mexer em qualquer mudo/solo cortava o fade-out seco).
            if (active && this.ctx && ((c.fadeIn ?? 0) > 0 || (c.fadeOut ?? 0) > 0)) {
              if (!settled) { this.settleArmed(); settled = true; }
              scheduleClipFade(g, this.ctx, base, { ...c, startTime: active.clipStartTime }, active.durationSeconds, this.playbackStartTime, this.playbackAlpha || 1, 0.012);
            } else {
              this.rampParam(g.gain, base);
            }
          }
          const p = this.clipPanners.get(c.id);
          if (p) this.rampParam(p.pan, targetPan);
        }
      });
      this.reapplyArmedFades();
      return;
    }
    const channel = this.channels.get(trackId);
    if (!channel) return;
    const chGain = channelGainFor(track, all, track.volume);
    this.rampParam(channel.gain.gain, chGain);
    this.rampParam(channel.panner.pan, effectivePan(track.id, track.pan, lrActive));
    // Os clipes de uma faixa raiz (Guia, Click, Maestro) passam pelo ganho do canal acima, que já
    // aplica o fader e o mudo. Antes o fader também ia para o ganho de cada clipe: mexido durante
    // a música, o volume valia duas vezes (o fader em -6 dB soava -12 dB até a próxima música) e
    // o fade do clipe era cortado. Ao tocar, o clipe nasce só com o próprio ganho (clipGainFor).
  }

  // Ganho/mute/solo de UM clipe mudou (modo DAW): reaplica só o clipGain dele, sem
  // refazer o fade (o fade só é agendado ao iniciar a reprodução do clipe).
  updateClipParams(clipId: string) {
    const store = useStore.getState();
    const clip = store.clips.find((c) => c.id === clipId);
    if (!clip) return;
    this.invalidatePrepared(clip.songId);
    const g = this.clipGains.get(clipId);
    if (!g) return;
    const track = store.tracks.find((t) => t.id === clip.trackId);
    const trackGain = track?.parentId ? channelGainFor(track, store.tracks, track.volume) : 1;
    const songClips = store.clips.filter((c) => c.songId === clip.songId);
    const baseGain = trackGain * clipGainFor(clip, songClips);

    // Reagenda automação do fade em tempo real caso a reprodução esteja ativa
    if (this.ctx) {
      const active = this.activeClips.get(clipId);
      if (active) {
        const at = this.ctx.currentTime;
        const alpha = this.playbackAlpha || 1;
        const posAt = (at - this.playbackStartTime) / alpha;
        const localOffset = Math.max(0, posAt - active.clipStartTime);
        const whenWall = active.scheduledStartWall || (at - localOffset * alpha);
        scheduleClipFade(g, this.ctx, baseGain, clip, clipPlayLength(clip), this.playbackStartTime, alpha);
        this.reapplyArmedFades();
        return;
      }
    }
    this.rampParam(g.gain, baseGain);
  }

  setMasterVolume(volume: number) {
    if (this.masterGain) this.rampParam(this.masterGain.gain, faderToGain(volume));
    if (useStore.getState().masterOutputOff) this.channels.forEach((ch, id) => this.updateChannelLevel(id, ch, 0.012));
  }

  getMasterMeterLevel(): number {
    if (!this.masterAnalyser) return 0;
    const data = this.meterScratch;
    this.masterAnalyser.getFloatTimeDomainData(data);
    let peak = 0;
    for (let i = 0; i < data.length; i++) {
      const abs = Math.abs(data[i]);
      if (abs > peak) peak = abs;
    }
    const now = performance.now();
    const prev = this.meterSmoothed.get('master') ?? 0;
    const elapsed = Math.min(100, now - (this.meterLastUpdate.get('master') ?? now)) / 1000;
    this.meterLastUpdate.set('master', now);
    const released = prev * Math.pow(10, (-24 * elapsed) / 20);
    const smoothed = Math.max(peak, released);
    this.meterSmoothed.set('master', smoothed);
    return smoothed;
  }

  // LR mágico: L (guia/click/maestro) e R (banda) são sinais independentes. Um limiter ligado nos
  // dois lados baixaria a guia quando a banda pesa: aí cada lado ganha o seu limiter.
  private limiterSplit = false;
  private masterLimiterR: DynamicsCompressorNode | null = null;
  // lado L do caminho separado (o masterLimiter fica sempre estéreo, no caminho normal)
  private masterLimiterL1: DynamicsCompressorNode | null = null;
  private limiterNodes: AudioNode[] = [];
  // Portas de ganho dos dois caminhos [normal, separado]: os dois ficam montados e trocar o LR
  // mágico só cruza os ganhos. Desligar e religar o limiter com a música tocando cortava o master
  // por um instante (estalo) e mexia no grafo de áudio na hora do show.
  private limiterGates: PathSwitch | null = null;

  // Religa a entrada do caminho que vai abrir, cruza os ganhos e, depois da rampa, desliga a
  // entrada do que fechou: montado mas sem entrada, ele não processa zeros na thread de áudio.
  private switchPath(sw: PathSwitch, split: boolean) {
    const active = split ? 1 : 0;
    if (sw.timer) { clearTimeout(sw.timer); sw.timer = null; }
    this.linkPath(sw, active, true);
    this.rampParam(sw.gates[0].gain, split ? 0 : 1, 0.015);
    this.rampParam(sw.gates[1].gain, split ? 1 : 0, 0.015);
    // rampa de 15 ms: 50 ms dá folga para o relógio da tela atrasar sem cortar a rampa no meio
    sw.timer = setTimeout(() => { sw.timer = null; this.linkPath(sw, 1 - active, false); }, PATH_PARK_MS);
  }

  private linkPath(sw: PathSwitch, i: number, on: boolean) {
    if (sw.linked[i] === on) return;
    const [src, dst] = sw.links[i];
    try {
      if (on) src.connect(dst);
      else src.disconnect(dst);
      sw.linked[i] = on;
    } catch { /* contexto já fechado */ }
  }

  // Medidor de loudness do master
  private loudL: AnalyserNode | null = null;
  private loudR: AnalyserNode | null = null;
  private loudness = new LoudnessWindow();
  private loudScratch: Float32Array<ArrayBuffer> | null = null;
  private loudLastAt = -Infinity;

  // Filtro K na saída do master (o que vai para as saídas 1-2), um medidor por lado
  private connectLoudness(ctx: AudioContext) {
    if (!this.masterSplitter) return;
    const fftSize = 4096;
    const make = (ch: number) => {
      const [first, last] = kWeightingNodes(ctx);
      const an = ctx.createAnalyser();
      an.fftSize = fftSize;
      this.masterSplitter!.connect(first, ch);
      last.connect(an);
      return an;
    };
    this.loudL = make(0);
    this.loudR = make(1);
    this.loudScratch = new Float32Array(fftSize);
    this.loudness.clear();
    this.loudLastAt = -Infinity;
  }

  /**
   * Loudness do master em LUFS: momentâneo (400 ms) e curto (3 s). Quem mostra chama de tempos
   * em tempos (a cada ~50 ms); parado e em silêncio dá -Infinity.
   */
  getMasterLoudness(): { momentary: number; shortTerm: number } {
    const now = this.ctx?.currentTime ?? 0;
    if (!this.loudL || !this.loudR || !this.loudScratch) return { momentary: -Infinity, shortTerm: -Infinity };
    // relógio de um contexto anterior (mais adiantado): mede já, sem esperar o novo alcançar
    if (now < this.loudLastAt) this.loudLastAt = -Infinity;
    if (now - this.loudLastAt >= 0.04) {
      this.loudLastAt = now;
      let sum = 0;
      for (const an of [this.loudL, this.loudR]) {
        an.getFloatTimeDomainData(this.loudScratch);
        let ms = 0;
        const d = this.loudScratch;
        for (let i = 0; i < d.length; i++) ms += d[i] * d[i];
        sum += ms / d.length;
      }
      this.loudness.push(now, sum);
    }
    return this.loudness.read(now);
  }

  private applyLimiterMode() {
    const ctx = this.ctx;
    if (!ctx || !this.masterGain || !this.masterLimiter || !this.masterLimitOut) return;
    const split = !!useStore.getState().magicRoutingActive;
    if (!this.limiterGates) {
      // monta uma vez por contexto: normal (um limiter estéreo) e separado (um por lado)
      const L = this.masterLimiter;
      const normal = ctx.createGain();
      const separate = ctx.createGain();
      normal.gain.value = split ? 0 : 1;
      separate.gain.value = split ? 1 : 0;
      L.channelCount = 2;
      L.channelCountMode = 'clamped-max';
      this.masterGain.connect(normal);
      normal.connect(L);
      L.connect(this.masterLimitOut);
      const splitter = ctx.createChannelSplitter(2);
      const merger = ctx.createChannelMerger(2);
      const L1 = createSafetyLimiter(ctx);
      const R = createSafetyLimiter(ctx);
      for (const lim of [L1, R]) { lim.channelCount = 1; lim.channelCountMode = 'explicit'; }
      this.masterGain.connect(separate);
      separate.connect(splitter);
      splitter.connect(L1, 0);
      splitter.connect(R, 1);
      L1.connect(merger, 0, 0);
      R.connect(merger, 0, 1);
      merger.connect(this.masterLimitOut);
      this.masterLimiterL1 = L1;
      this.masterLimiterR = R;
      this.limiterNodes = [splitter, merger];
      // entrada de cada caminho: porta -> limiter estéreo / porta -> divisor dos lados
      const sw: PathSwitch = { gates: [normal, separate], links: [[normal, L], [separate, splitter]], linked: [true, true], timer: null };
      this.linkPath(sw, split ? 0 : 1, false); // o inativo já começa sem entrada (ganho 0)
      this.limiterGates = sw;
      this.limiterSplit = split;
      return;
    }
    if (split === this.limiterSplit) return;
    // Sem pico os dois caminhos dão o mesmo sinal: a troca cruzada em 15 ms não se ouve.
    this.switchPath(this.limiterGates, split);
    this.limiterSplit = split;
  }

  // Anti-clip do master: o mesmo limitador de pico dos canais (-0,1 dBFS), depois do limiter de
  // segurança e antes do medidor e das saídas. No LR mágico cada lado tem o seu, como o limiter
  // de segurança: um pico da banda não abaixa a guia/click.
  private masterLimitOut: GainNode | null = null;
  private masterAntiClip: AntiClipInsert[] = [];
  private masterAntiClipNodes: AudioNode[] = [];
  private masterAntiClipSplit: boolean | null = null;
  // portas [normal, separado] do anti-clip do master (ver applyMasterAntiClip)
  private masterAntiClipGates: PathSwitch | null = null;

  private applyMasterAntiClip() {
    const ctx = this.ctx;
    const from = this.masterLimitOut;
    const to = this.masterAnalyser;
    if (!ctx || !from || !to) return;
    const st = useStore.getState();
    const on = !!st.masterAntiClip;
    const split = !!st.magicRoutingActive;
    if (this.masterAntiClipGates) {
      this.masterAntiClip.forEach((a) => a.set(on));
      if (split === this.masterAntiClipSplit) return;
      // Os dois caminhos já estão montados (e com o limitador ligado, se o anti-clip estiver):
      // trocar o LR mágico só cruza os ganhos. Antes cada troca desmontava o anti-clip e criava
      // reprodutores novos na thread de áudio, com o master cortado no meio: engasgo e estalo.
      this.switchPath(this.masterAntiClipGates, split);
      this.masterAntiClipSplit = split;
      return;
    }
    // monta uma vez por contexto: normal (estéreo) e separado (um limitador por lado)
    const normal = ctx.createGain();
    const separate = ctx.createGain();
    normal.gain.value = split ? 0 : 1;
    separate.gain.value = split ? 1 : 0;
    from.connect(normal);
    from.connect(separate);
    this.masterAntiClip = [new AntiClipInsert(ctx, normal, to)];
    this.masterAntiClipNodes = [normal, separate];
    const splitter = ctx.createChannelSplitter(2);
    const merger = ctx.createChannelMerger(2);
    separate.connect(splitter);
    for (let c = 0; c < 2; c++) {
      const side = ctx.createGain();
      const out = ctx.createGain();
      for (const n of [side, out]) { n.channelCount = 1; n.channelCountMode = 'explicit'; }
      splitter.connect(side, c);
      out.connect(merger, 0, c);
      this.masterAntiClip.push(new AntiClipInsert(ctx, side, out));
      this.masterAntiClipNodes.push(side, out);
    }
    merger.connect(to);
    this.masterAntiClipNodes.push(splitter, merger);
    // entrada de cada caminho: saída do limiter -> porta (a porta é a entrada do anti-clip)
    const sw: PathSwitch = { gates: [normal, separate], links: [[from, normal], [from, separate]], linked: [true, true], timer: null };
    this.linkPath(sw, split ? 0 : 1, false);
    this.masterAntiClipGates = sw;
    this.masterAntiClipSplit = split;
    this.masterAntiClip.forEach((a) => a.set(on, true));
  }

  /** Pico do master antes do limiter (linear), nos últimos ~43 ms. */
  getMasterPrePeak(): number {
    if (!this.masterPreAnalyser) return 0;
    const data = this.meterScratch;
    this.masterPreAnalyser.getFloatTimeDomainData(data);
    let peak = 0;
    for (let i = 0; i < data.length; i++) {
      const abs = Math.abs(data[i]);
      if (abs > peak) peak = abs;
    }
    return peak;
  }

  // Quanto o limiter de segurança do master está segurando agora, em dB (0 = sem atuação, negativo = reduzindo).
  getMasterLimiterReduction(): number {
    if (this.limiterSplit && this.masterLimiterL1 && this.masterLimiterR) return Math.min(this.masterLimiterL1.reduction, this.masterLimiterR.reduction);
    return this.masterLimiter?.reduction ?? 0;
  }

  applyLRMaster(active: boolean) {
    const store = useStore.getState();
    store.tracks.forEach((t) => {
      if (t.parentId) return;
      const ch = this.channels.get(t.id);
      if (ch) this.rampParam(ch.panner.pan, effectivePan(t.id, t.pan, active));
    });
    store.clips.forEach((c) => {
      const p = this.clipPanners.get(c.id);
      if (!p) return;
      const track = store.tracks.find((t) => t.id === c.trackId);
      if (!track) return;
      this.rampParam(p.pan, effectivePan(track.id, track.pan, active));
    });
  }

  getMeterLevel(trackId: string): number {
    const channel = this.channels.get(trackId);
    if (!channel) return 0;
    return this.smoothMeter(trackId, this.peakOf(channel.analyser));
  }

  /** Pico agora (linear) de um analisador. */
  private peakOf(analyser: AnalyserNode): number {
    const data = this.meterScratch;
    analyser.getFloatTimeDomainData(data);
    let peak = 0;
    for (let i = 0; i < data.length; i++) {
      const abs = Math.abs(data[i]);
      if (abs > peak) peak = abs;
    }
    return peak;
  }

  /** Pico e média (RMS) de um analisador numa leitura só. */
  private peakAndRms(analyser: AnalyserNode): [number, number] {
    const data = this.meterScratch;
    analyser.getFloatTimeDomainData(data);
    let peak = 0;
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      const v = data[i];
      const abs = v < 0 ? -v : v;
      if (abs > peak) peak = abs;
      sum += v * v;
    }
    return [peak, Math.sqrt(sum / data.length)];
  }

  /** Média do sinal agora (RMS, linear) de um analisador: o que um VU de verdade mede. */
  private rmsOf(analyser: AnalyserNode): number {
    const data = this.meterScratch;
    analyser.getFloatTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
    return Math.sqrt(sum / data.length);
  }

  /** Queda de 24 dB/s, como os medidores de mesa: sobe na hora, desce devagar. */
  private smoothMeter(key: string, peak: number): number {
    const now = performance.now();
    const prev = this.meterSmoothed.get(key) ?? 0;
    const elapsed = Math.min(100, now - (this.meterLastUpdate.get(key) ?? now)) / 1000;
    this.meterLastUpdate.set(key, now);
    const released = prev * Math.pow(10, (-24 * elapsed) / 20);
    const smoothed = Math.max(peak, released);
    this.meterSmoothed.set(key, smoothed);
    return smoothed;
  }

  /** Medidor estéreo do canal: níveis do lado esquerdo e do direito. */
  getMeterLevelsLR(trackId: string): [number, number] | null {
    const channel = this.channels.get(trackId);
    if (!channel) return null;
    return [this.smoothMeter(`${trackId}:L`, this.peakOf(channel.meterL)), this.smoothMeter(`${trackId}:R`, this.peakOf(channel.meterR))];
  }

  /** Medidor estéreo do master (saída 1-2). */
  getMasterMeterLevelsLR(): [number, number] | null {
    if (!this.masterMeterL || !this.masterMeterR) return null;
    return [this.smoothMeter('master:L', this.peakOf(this.masterMeterL)), this.smoothMeter('master:R', this.peakOf(this.masterMeterR))];
  }

  /** Média (RMS) do master, L e R, para os VUs de ponteiro (a balística fica no VU). */
  getMasterRmsLR(): [number, number] | null {
    if (!this.masterMeterL || !this.masterMeterR) return null;
    return [this.rmsOf(this.masterMeterL), this.rmsOf(this.masterMeterR)];
  }

  private startMetering() {
    this.stopMetering();
    const METER_INTERVAL_MS = 33; // ~30 fps para medidores VU
    const STORE_INTERVAL_MS = 100; // 10 Hz para estado textual e teleprompter sem sobrecarregar a CPU
    let lastMeterTick = 0;
    let lastStoreTick = 0;
    const levels = new Map<string, number>();
    const update = (now: number) => {
      if (!this.isPlaying) return;
      if (now - lastMeterTick >= METER_INTERVAL_MS) {
        lastMeterTick = now;
        const store = useStore.getState();
        for (const t of store.tracks) {
          // medidor estéreo: cada lado separado (ID:L e ID:R)
          const lr = this.getMeterLevelsLR(t.id);
          if (lr) { levels.set(`${t.id}:L`, lr[0]); levels.set(`${t.id}:R`, lr[1]); }
          // O nível do canal é o do lado mais alto. O analisador do canal soma L e R pela metade:
          // com pan total (LR mágico, LR master) ele mostrava 6 dB a menos e o LED de clip só
          // acendia em +6 dBFS. Só na saída mono direta a soma é o que sai de verdade.
          const level = lr && !isTimecodeTrackId(t.id) && !this.routedTo.get(t.id)?.startsWith('out-')
            ? Math.max(lr[0], lr[1])
            : this.getMeterLevel(t.id);
          levels.set(t.id, level);
          if (level >= 1 && !t.clipIndicator) store.updateMeter(t.id, level);
        }
        // Master: cada lado lido uma vez só, pico e média juntos (antes cada um era lido duas vezes
        // e mais uma pela soma L+R, que também mostrava menos com o LR mágico).
        const pkL = this.masterMeterL ? this.peakAndRms(this.masterMeterL) : null;
        const pkR = this.masterMeterR ? this.peakAndRms(this.masterMeterR) : null;
        if (pkL && pkR) {
          levels.set('master', this.smoothMeter('master', Math.max(pkL[0], pkR[0])));
          levels.set('master:L', this.smoothMeter('master:L', pkL[0]));
          levels.set('master:R', this.smoothMeter('master:R', pkR[0]));
          // VUs de ponteiro: a média do sinal, não o pico
          const masterRms = [pkL[1], pkR[1]];
          levels.set('master-rms:L', masterRms[0]); levels.set('master-rms:R', masterRms[1]);
        } else {
          levels.set('master', this.getMasterMeterLevel());
        }
        // com o anti-clip do master ligado a saída não passa do teto: o indicador de clip fica apagado
        const masterPre = store.masterAntiClip ? 0 : this.getMasterPrePeak();
        if (masterPre >= 1 && store.masterClipPeak < masterPre) store.updateMasterMeter(masterPre);
        // Redução do limiter de segurança (dB, 0 ou negativo) — mesmo canal do meterBus, lido como valor cru (não é amplitude linear).
        levels.set('master-gr', this.getMasterLimiterReduction());
        publishMeters(levels);
      }

      if (now - lastStoreTick >= STORE_INTERVAL_MS) {
        const currentTime = this.getCurrentTime();
        if (this.seekLock.active && Math.abs(currentTime - this.seekLock.targetTime) < 0.15) this.seekLock.active = false;
        if (!this.seekLock.active) {
          lastStoreTick = now;
          const store = useStore.getState();
          const song = store.songs.find((s) => s.id === this.currentSongId);
          const progress = song ? Math.min(1, currentTime / song.duration) : 0;
          const countdown = song && store.transport.nextSongId ? Math.max(0, song.duration - currentTime) : store.transport.nextSongCountdown;
          store.setPlaybackTick(currentTime, progress, countdown);
        }
      }

      this.meterInterval = requestAnimationFrame(update);
    };
    this.meterInterval = requestAnimationFrame(update);
  }

  private stopMetering() {
    if (this.meterInterval) {
      cancelAnimationFrame(this.meterInterval);
      this.meterInterval = null;
    }
  }

  async enumerateDevices(): Promise<MediaDeviceInfo[]> {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === 'audiooutput');
  }

  private appliedParams = new Map<string, string>();

  // Aplicação ao vivo: muda BPM/afinador sem reiniciar nem engasgar o áudio.
  applySongPlaybackParams(songId: string) {
    const store = useStore.getState();
    const song = store.songs.find((s) => s.id === songId);
    if (!song) return;
    // o botão e o estado podem pedir a mesma troca: só uma vai para o áudio
    const key = playbackKey(song);
    if (this.appliedParams.get(songId) === key) return;
    this.appliedParams.set(songId, key);
    for (const n of this.songNodes(songId)) this.nodeRenderKey.delete(n.node);
    if (this.currentSongId === songId) this.partialActive = false;
    this.scheduleRender(songId);

    const base = sliceParams(song, null);
    const baseTempo = tempoFromBpm(base.bpmAdjust);
    const baseCents = base.tuner * 100;

    // Atualiza o preparo em cache em vez de invalidá-lo, para que
    // Stop → Play imediato continue com os valores novos sem recriar nada.
    let prep = this.prepared.get(songId);
    // Só renova a assinatura de um preparo com os mesmos clipes: renovar sempre fazia um preparo
    // de clipes velhos (fala trocada, clipe movido) valer de novo no próximo Play.
    const restamped = prep ? this.bundleSignature(songId, prep) : null;
    if (prep && !canRestampSignature(prep.signature, restamped)) {
      this.invalidatePrepared(songId);
      prep = undefined;
    }
    if (prep) {
      const tracks = store.tracks;
      prep.signature = restamped ?? prep.signature;
      for (const p of prep.pending) {
        const t = tracks.find((tr) => tr.id === p.trackId);
        const melodic = t ? isMelodicTrack(t, tracks) : true;
        try { p.node.port.postMessage({ tempo: baseTempo, pitch: melodic ? pitchFromCents(baseCents) : 1, process: songNeedsProcessing(song) }); } catch { /* ignore */ }
      }
    }

    if (!this.isPlaying || this.currentSongId !== songId || !this.ctx) return;
    this.retimeLive(song);
  }

  // Todas as faixas trocam juntas num instante exato, a partir da mesma posição da música.
  private retimeLive(song: Song) {
    if (!this.ctx) return;
    const store = useStore.getState();
    const songId = song.id;
    this.settleArmed();
    const at = this.ctx.currentTime + RETIME_LEAD;
    if (this.jumpComesFirst(song, at)) {
      this.retimeAfterJump = songId;
      return;
    }
    this.disarmLoop(false);
    const posAt = (at - this.playbackStartTime) / (this.playbackAlpha || 1);
    const params = paramsAt(song, posAt);
    const newAlpha = bpmAdjustToAlpha(params.bpmAdjust);
    const newTempo = tempoFromBpm(params.bpmAdjust);
    const newCents = params.tuner * 100;
    this.playbackAlpha = newAlpha;
    this.playbackCents = newCents;
    this.playbackOffset = posAt;
    this.playbackStartTime = at - posAt * newAlpha;
    this.timecode?.retime(1 / newAlpha, at);
    this.refreshClipFades(at, this.playbackStartTime, newAlpha);

    const tracks = store.tracks;
    const process = params.bpmAdjust !== 0 || params.tuner !== 0;

    // O click vai por último: copiar o áudio remontado dele não pode atrasar a ordem das outras faixas.
    const clickLast = (trackId: string) => Number(isClickTrack(tracks.find((t) => t.id === trackId)));
    const inOrder = Array.from(this.activeClips.entries()).sort((x, y) => clickLast(x[1].trackId) - clickLast(y[1].trackId));
    inOrder.forEach(([clipId, active]) => {
      const clip = store.clips.find((c) => c.id === clipId);
      const track = clip ? tracks.find((t) => t.id === clip.trackId) : undefined;
      const melodic = track ? isMelodicTrack(track, tracks) : true;
      const pitch = melodic ? pitchFromCents(newCents) : 1;
      const local = posAt - active.clipStartTime;
      try {
        // click: o áudio remontado deste andamento vai antes da troca, e a voz nova já nasce nele
        if (process && clip && isClickTrack(track)) this.handClickRemount(active.node, clip, newTempo);
        if (local >= 0) {
          const offsetSamples = Math.min(active.bufferLength, Math.floor(local * active.sampleRate));
          active.node.port.postMessage({ type: 'retime', tempo: newTempo, pitch, process, offsetSamples, at, crossfadeFrames: 384 });
        } else {
          active.node.port.postMessage({ tempo: newTempo, pitch, process });
          const newStart = at + -local * newAlpha;
          active.node.port.postMessage({ type: 'seek', offsetSamples: 0, startTime: newStart, fadeInFrames: 1 });
          active.scheduledStartWall = newStart;
        }
      } catch { /* ignore */ }
    });

    this.retimeAt = at;
    if (this.retimeTimer) window.clearTimeout(this.retimeTimer);
    this.retimeTimer = window.setTimeout(() => {
      this.retimeTimer = null;
      this.retimeAt = null;
      if (!this.isPlaying || this.currentSongId !== songId) return;
      this.rearmLoop();
    }, RETIME_LEAD * 1000 + 30);
    this.scheduleSongEnd(song.duration);
    // o salto já sai marcado aqui: esperar o timer deixava o fim do loop passar sem salto nenhum
    this.armJumpBehindRetime(song, at);
  }

  private retimeTimer: number | null = null;
  /** Hora da troca de BPM/tom que já está marcada nos reprodutores. */
  private retimeAt: number | null = null;
  /** Música cuja troca de BPM/tom espera o salto do loop que está para acontecer. */
  private retimeAfterJump: string | null = null;

  private songNodes(songId: string): SongNode[] {
    if (this.isPlaying && this.currentSongId === songId) {
      return Array.from(this.activeClips.entries()).map(([clipId, a]) => ({ clipId, node: a.node, trackId: a.trackId }));
    }
    return this.prepared.get(songId)?.pending.map((p) => ({ clipId: p.clipId, node: p.node, trackId: p.trackId })) ?? [];
  }

  private setRendering(songId: string, on: boolean, progress = { done: 0, total: 0 }) {
    if (on) this.renderingSongs.set(songId, progress);
    else this.renderingSongs.delete(songId);
    const watchdog = this.renderWatchdogs.get(songId);
    if (watchdog) { window.clearTimeout(watchdog); this.renderWatchdogs.delete(songId); }
    if (on) {
      // Se uma faixa travar, a música segue com o processamento ao vivo e o aviso some; o que já ficou pronto continua guardado.
      this.renderWatchdogs.set(songId, window.setTimeout(() => this.cancelRender(songId), RENDER_TIMEOUT_MS));
    }
    let done = 0;
    let total = 0;
    this.renderingSongs.forEach((p) => { done += p.done; total += p.total; });
    const store = useStore.getState();
    const prev = store.preparingParams;
    const next = this.renderingSongs.size > 0 ? { done, total } : null;
    if (prev?.done !== next?.done || prev?.total !== next?.total || !prev !== !next) store.setPreparingParams(next);
  }

  private cancelRender(songId: string) {
    const timer = this.renderTimers.get(songId);
    if (timer) { window.clearTimeout(timer); this.renderTimers.delete(songId); }
    this.renderRuns.set(songId, (this.renderRuns.get(songId) ?? 0) + 1);
    this.setRendering(songId, false);
  }

  cancelAllRenders() {
    new Set([...this.renderingSongs.keys(), ...this.renderTimers.keys()]).forEach((id) => this.cancelRender(id));
  }

  private renderWatchdogs = new Map<string, number>();

  // Prepara em segundo plano o áudio com BPM/tom alterados; enquanto isso a música toca com o processamento ao vivo.
  private scheduleRender(songId: string, delay = RENDER_DELAY_MS) {
    const prev = this.renderTimers.get(songId);
    if (prev) window.clearTimeout(prev);
    this.renderRuns.set(songId, (this.renderRuns.get(songId) ?? 0) + 1);
    this.renderTimers.set(songId, window.setTimeout(() => {
      this.renderTimers.delete(songId);
      this.renderSong(songId).catch(() => this.setRendering(songId, false));
    }, delay));
  }

  private async renderSong(songId: string) {
    const token = this.renderRuns.get(songId) ?? 0;
    // O click vai primeiro e por conta própria: o andamento dele não depende do resto das faixas.
    await this.ensureClickRemounts(songId);
    if (this.renderRuns.get(songId) !== token) return;
    const store = useStore.getState();
    const song = store.songs.find((s) => s.id === songId);
    // com BPM/tom diferentes por fatia, o áudio é processado ao vivo
    if (!song || !songNeedsProcessing(song) || hasSliceParams(song) || !this.ctx) {
      this.setRendering(songId, false);
      return;
    }
    // Música tocando direto do disco não tem o áudio aberto na memória, e o ajuste precisa dele:
    // abre aqui, depois que a leitura das faixas no ar terminou, para não disputar o disco com elas.
    const closed = this.songNodes(songId).some((n) => { const c = store.clips.find((x) => x.id === n.clipId); return !!c && !getClipPlayAudio(c); });
    if (closed) {
      const onAir = this.onAirDiskDone;
      if (onAir?.songId === songId) await onAir.done;
      if (this.renderRuns.get(songId) !== token) return;
      await ensureSongLoaded(songId).catch(() => { /* avisado pelo carregamento */ });
      if (this.renderRuns.get(songId) !== token || !this.ctx) return;
    }
    const tempo = tempoFromBpm(song.bpmAdjust ?? 0);
    const cents = song.tuner * 100;
    const tracks = store.tracks;

    const rate = this.ctx.sampleRate;
    const targets = this.songNodes(songId).flatMap((n) => {
      const track = tracks.find((t) => t.id === n.trackId);
      const clip = store.clips.find((c) => c.id === n.clipId);
      const buffer = clip ? getClipPlayAudio(clip) : null;
      const source = clip ? getClipSource(clip.id) : null;
      if (!clip || !track || !buffer) return [];
      const pitch = isMelodicTrack(track, tracks) ? pitchFromCents(cents) : 1;
      const key = `${tempo}|${pitch}`;
      const diskName = source && buffer.sampleRate === rate ? renderedName(clip.songId, clip.id, source, rate, buffer.length, tempo, pitch) : null;
      return this.nodeRenderKey.get(n.node) === key ? [] : [{ ...n, clip, buffer, pitch, key, diskName }];
    });
    if (targets.length === 0) {
      this.setRendering(songId, false);
      return;
    }

    const dir = await readyDir();
    if (this.renderRuns.get(songId) !== token) return;
    targets.forEach((t) => { if (t.diskName) markUsed(t.diskName); });
    const saved = await Promise.all(targets.map((t) => (dir && t.diskName ? entryExists(dir, t.diskName) : false)));
    if (this.renderRuns.get(songId) !== token) return;
    const toMake = saved.filter((s) => !s).length;
    // O aviso só aparece quando há faixa para ajustar de verdade; ler o que já está guardado leva segundos.
    let made = 0;
    if (toMake > 0) this.setRendering(songId, true, { done: 0, total: toMake });

    // Poucas faixas por vez e resultado guardado em 16 bits: processar todas juntas estourava a memória.
    const results: Array<{ left: Int16Array; right: Int16Array } | null> = new Array(targets.length).fill(null);
    let cursor = 0;
    const runNext = async (): Promise<void> => {
      while (cursor < targets.length) {
        if (this.renderRuns.get(songId) !== token) return;
        // Enquanto o usuário está arrastando, rolando ou dando zoom, este trabalho cede a vez
        // em vez de competir pela thread principal e travar a interação.
        while (isUserInteracting()) {
          if (this.renderRuns.get(songId) !== token) return;
          await new Promise((r) => setTimeout(r, 30));
        }
        const i = cursor++;
        const t = targets[i];
        if (dir && t.diskName && saved[i]) {
          const entry = await readEntry(dir, t.diskName);
          if (entry && entry.sampleRate === rate) {
            results[i] = { left: entry.channels[0], right: entry.channels[1] ?? entry.channels[0] };
            continue;
          }
        }
        const r = await stretchClipAudio(t.buffer, tempo, t.pitch).catch(() => null);
        if (!r) continue;
        results[i] = r;
        if (dir && t.diskName) {
          await writeEntry(dir, t.diskName, rate, r.left === r.right ? [r.left] : [r.left, r.right], r.left.length, r.left.length)
            .catch((err) => console.warn('[audioEngine] não consegui guardar a faixa ajustada', err));
        }
        if (this.renderRuns.get(songId) !== token) return;
        made++;
        if (toMake > 0) this.setRendering(songId, true, { done: Math.min(made, toMake), total: toMake });
      }
    };
    const liveConcurrency = this.isPlaying ? 1 : Math.min(RENDER_CONCURRENCY, targets.length);
    await Promise.all(Array.from({ length: Math.max(1, liveConcurrency) }, runNext));
    if (this.renderRuns.get(songId) !== token) return;

    // Só entrega se todas as faixas ficaram prontas: misturar faixas processadas e ao vivo desalinha os instrumentos.
    const alive = new Set(this.songNodes(songId).map((n) => n.node));
    if (results.some((r) => !r) || targets.some((t) => !alive.has(t.node))) {
      this.setRendering(songId, false);
      return;
    }
    // Quanto cada faixa saiu adiantada: medido nela mesma, depois de pronta ou lida do disco.
    const leads: number[] = [];
    for (let i = 0; i < targets.length; i++) {
      while (isUserInteracting()) {
        if (this.renderRuns.get(songId) !== token) return;
        await new Promise((r) => setTimeout(r, 30));
      }
      leads.push(await this.stretchLeadFrames(targets[i].clip, targets[i].buffer, results[i]!, tempo, targets[i].pitch));
      if (this.renderRuns.get(songId) !== token) return;
    }

    targets.forEach((t, i) => {
      const r = results[i]!;
      try {
        // Canais lidos do disco dividem o mesmo bloco de memória: ele só pode ser transferido uma vez.
        const transfer = r.left.buffer === r.right.buffer ? [r.left.buffer] : [r.left.buffer, r.right.buffer];
        t.node.port.postMessage({ type: 'rendered', left: r.left, right: r.right, tempo, pitch: t.pitch, leadFrames: leads[i] }, transfer);
        this.nodeRenderKey.set(t.node, t.key);
      } catch { /* nó já descartado */ }
    });
    this.setRendering(songId, false);
    if (this.isPlaying && this.currentSongId === songId) this.swapToRendered(songId);
  }

  // ---------- Banda na grade com o BPM alterado ----------
  // O SoundTouch entrega a faixa adiantada, e quanto depende do material. O arquivo guardado continua
  // como saiu do processador; o adiantamento é medido em cada faixa e o reprodutor desconta na leitura.
  private stretchLeads = new Map<string, number>();
  private leadWorker: Worker | null = null;
  private leadJobs = new Map<string, (ms: number | null) => void>();
  private leadJobId = 0;
  private leadIdleTimer: number | null = null;

  private stretchLeadKey(clip: AudioClip, tempo: number, pitch: number): string {
    return `${clip.id}|${clip.trimStart ?? 0}|${clip.trimEnd ?? 0}|${tempo.toFixed(6)}|${pitch.toFixed(6)}`;
  }

  /** Começo já processado: vale a medida da faixa inteira, se existir; senão a conta nominal. */
  private headLeadFrames(clip: AudioClip, tempo: number, pitch: number, rate: number): number {
    if (Math.abs(tempo - 1) < 1e-4) return 0;
    return this.stretchLeads.get(this.stretchLeadKey(clip, tempo, pitch)) ?? Math.round((nominalStretchLeadMs(tempo, pitch) * rate) / 1000);
  }

  private async stretchLeadFrames(
    clip: AudioClip, source: { channels: Int16Array[]; sampleRate: number }, out: { left: Int16Array; right: Int16Array }, tempo: number, pitch: number,
  ): Promise<number> {
    // no BPM original o próprio processamento já devolve a faixa para a grade
    if (Math.abs(tempo - 1) < 1e-4) return 0;
    const key = this.stretchLeadKey(clip, tempo, pitch);
    const known = this.stretchLeads.get(key);
    if (known !== undefined) return known;
    const rate = source.sampleRate;
    const step = measureStep(rate);
    const input = await this.reduceInSteps(source.channels[0], source.channels[1] ?? source.channels[0], step);
    const output = await this.reduceInSteps(out.left, out.right, step);
    const ms = await this.askStretchLead(input, output, rate / step, tempo, pitch);
    const frames = Math.round(((ms ?? nominalStretchLeadMs(tempo, pitch)) * rate) / 1000);
    if (this.stretchLeads.size >= STRETCH_LEADS_MAX) this.stretchLeads.delete(this.stretchLeads.keys().next().value as string);
    this.stretchLeads.set(key, frames);
    return frames;
  }

  /** Cópia reduzida do áudio, em pedaços: a tela não para enquanto ela é feita. */
  private async reduceInSteps(left: Int16Array, right: Int16Array, step: number): Promise<Int16Array> {
    const out = new Int16Array(Math.floor(left.length / step));
    const piece = step * REDUCE_PIECE_FRAMES;
    for (let at = 0; at < out.length;) {
      at += reduceForMeasure(left, right, step, out, at, piece);
      if (at < out.length) await new Promise((r) => setTimeout(r, 0));
    }
    return out;
  }

  private askStretchLead(input: Int16Array, output: Int16Array, rate: number, tempo: number, pitch: number): Promise<number | null> {
    if (this.leadIdleTimer !== null) { window.clearTimeout(this.leadIdleTimer); this.leadIdleTimer = null; }
    if (!this.leadWorker) {
      const w = new Worker(new URL('@/workers/timeStretch.worker.ts', import.meta.url), { type: 'module' });
      const finish = (id: string, ms: number | null) => {
        this.leadJobs.get(id)?.(ms);
        this.leadJobs.delete(id);
        if (this.leadJobs.size > 0 || this.leadWorker !== w) return;
        this.leadIdleTimer = window.setTimeout(() => {
          this.leadIdleTimer = null;
          if (this.leadJobs.size > 0 || this.leadWorker !== w) return;
          w.terminate();
          this.leadWorker = null;
        }, LEAD_WORKER_IDLE_MS);
      };
      w.onmessage = (ev: MessageEvent<{ id: string; ok: boolean; leadMs?: number }>) => {
        finish(ev.data.id, ev.data.ok && typeof ev.data.leadMs === 'number' ? ev.data.leadMs : null);
      };
      w.onerror = () => {
        // sem a medida vale a conta nominal; o worker quebrado não fica guardado
        if (this.leadWorker === w) this.leadWorker = null;
        w.terminate();
        const open = Array.from(this.leadJobs.keys());
        open.forEach((id) => { this.leadJobs.get(id)?.(null); this.leadJobs.delete(id); });
      };
      this.leadWorker = w;
    }
    const worker = this.leadWorker;
    const id = `lead_${++this.leadJobId}`;
    return new Promise((resolve) => {
      this.leadJobs.set(id, resolve);
      worker.postMessage({ id, kind: 'lead', input, output, rate, tempo, pitch }, [input.buffer, output.buffer]);
    });
  }

  // Troca todas as faixas para o áudio já preparado no mesmo instante, com crossfade, sem mudar a posição.
  private swapToRendered(songId: string) {
    this.partialActive = false;
    const ctx = this.ctx;
    const store = useStore.getState();
    const song = store.songs.find((s) => s.id === songId);
    if (!ctx || !song) return;
    this.settleArmed();
    this.disarmLoop(false);
    const SWAP_LEAD = 0.06;
    const at = ctx.currentTime + SWAP_LEAD;
    const alpha = this.playbackAlpha || 1;
    const posAt = (at - this.playbackStartTime) / alpha;
    const tempo = tempoFromBpm(song.bpmAdjust ?? 0);
    const tracks = store.tracks;
    this.activeClips.forEach((active) => {
      const local = posAt - active.clipStartTime;
      if (local < 0) return;
      const track = tracks.find((t) => t.id === active.trackId);
      const pitch = track && !isMelodicTrack(track, tracks) ? 1 : pitchFromCents(song.tuner * 100);
      const offsetSamples = Math.min(active.bufferLength, Math.floor(local * active.sampleRate));
      try {
        active.node.port.postMessage({ type: 'retime', tempo, pitch, process: true, offsetSamples, at, crossfadeFrames: 512 });
      } catch { /* ignore */ }
    });
    window.setTimeout(() => {
      if (this.isPlaying && this.currentSongId === songId) this.rearmLoop();
    }, SWAP_LEAD * 1000 + 30);
  }

  // ---------- Click sem SoundTouch ----------
  // Com BPM ou tom alterados, o click não passa pelo processador: o som de cada batida é copiado
  // inteiro para o lugar dela no andamento novo (clickRemount, num worker) e o reprodutor lê esse
  // áudio como já processado. Faixa que não é só click (voz gravada junto) segue o caminho normal.
  private clickStock = new Map<string, ClickRemount>();
  private clickJobs = new Map<string, Promise<void>>();

  private clickStockKey(clip: AudioClip, tempo: number): string {
    return `${clip.id}|${clip.trimStart ?? 0}|${clip.trimEnd ?? 0}|${tempo.toFixed(6)}`;
  }

  /** Andamentos em que o click desta música precisa estar pronto (um por fatia com BPM/tom). */
  private clickTempos(song: Song): number[] {
    const out = new Set<number>();
    const add = (p: { bpmAdjust: number; tuner: number }) => {
      if (p.bpmAdjust !== 0 || p.tuner !== 0) out.add(tempoFromBpm(p.bpmAdjust));
    };
    add(sliceParams(song, null));
    if (hasSliceParams(song)) medleySlices(song).forEach((slice) => add(sliceParams(song, slice)));
    return Array.from(out).slice(0, CLICK_TEMPOS_MAX);
  }

  /** Um pedido por música de cada vez; cada um olha o estado atual e pula o que já está pronto. */
  private ensureClickRemounts(songId: string): Promise<void> {
    const prev = this.clickJobs.get(songId) ?? Promise.resolve();
    const job: Promise<void> = prev
      .then(() => this.runClickRemounts(songId))
      .catch((err) => console.warn('[audioEngine] click segue pelo caminho normal', err))
      .finally(() => { if (this.clickJobs.get(songId) === job) this.clickJobs.delete(songId); });
    this.clickJobs.set(songId, job);
    return job;
  }

  private async runClickRemounts(songId: string): Promise<void> {
    const store = useStore.getState();
    const song = store.songs.find((s) => s.id === songId);
    if (!song || !songNeedsProcessing(song)) return;
    const tempos = this.clickTempos(song);
    // por clipe, não por reprodutor: o click fica pronto antes de existir reprodutor (BPM mudado parado)
    const clickClips = store.clips.filter((c) => c.songId === songId && isClickTrack(store.tracks.find((t) => t.id === c.trackId)));
    for (const clip of clickClips) {
      // lido uma vez só, mesmo com vários andamentos
      let source: { channels: Int16Array[]; sampleRate: number } | null = null;
      for (const tempo of tempos) {
        const key = this.clickStockKey(clip, tempo);
        if (this.clickStock.has(key)) continue;
        source = source ?? await this.clickSamples(clip);
        if (!source) break;
        const audioKey = `${clip.id}|${clip.trimStart ?? 0}|${clip.trimEnd ?? 0}`;
        const made = await remountClickAudio(audioKey, source.channels, source.sampleRate, tempo).catch(() => null);
        if (!made) break;
        placeRemountOnGrid(source.channels[0], source.channels[1] ?? source.channels[0], made, source.sampleRate, tempo);
        this.clickStock.delete(key);
        this.clickStock.set(key, made);
        this.trimClickStock(songId);
      }
      this.deliverClickRemount(songId, clip);
    }
  }

  /** Limite por memória: sai o mais antigo que não seja da música no ar nem da que está sendo preparada. */
  private trimClickStock(preparing: string) {
    const bytes = (r: ClickRemount) => r.left.byteLength + (r.right === r.left ? 0 : r.right.byteLength);
    let total = 0;
    this.clickStock.forEach((r) => { total += bytes(r); });
    if (total <= CLICK_STOCK_BYTES) return;
    const store = useStore.getState();
    const keepSongs = new Set([preparing, this.currentSongId, store.transport.currentSongId, store.transport.nextSongId]);
    const keepClips = new Set(store.clips.filter((c) => keepSongs.has(c.songId)).map((c) => c.id));
    for (const [key, r] of this.clickStock) {
      if (total <= CLICK_STOCK_BYTES) break;
      if (keepClips.has(key.slice(0, key.indexOf('|')))) continue;
      this.clickStock.delete(key);
      total -= bytes(r);
    }
  }

  /** O áudio tocável do clipe: da memória ou, com a música lida do disco, em blocos. */
  private async clickSamples(clip: AudioClip): Promise<{ channels: Int16Array[]; sampleRate: number } | null> {
    const open = getClipPlayAudio(clip);
    if (open) return { channels: open.channels, sampleRate: open.sampleRate };
    const reader = await openRangeReader(clip).catch(() => null);
    if (!reader) return null;
    const channels = Array.from({ length: Math.min(2, reader.channelCount) }, () => new Int16Array(reader.length));
    let chunk = 0;
    for (let at = 0; at < reader.length; at += DISK_CHUNK_FRAMES) {
      const piece = await reader.read(at, Math.min(DISK_CHUNK_FRAMES, reader.length - at)).catch(() => null);
      if (!piece?.[0]) return null;
      channels.forEach((ch, c) => ch.set(piece[c] ?? piece[0], at));
      // uma folga a cada ~11 s de áudio: não disputa o disco com as faixas no ar e não atrasa o click
      if (++chunk % 8 === 0) await new Promise((r) => setTimeout(r, 4));
    }
    return { channels, sampleRate: reader.sampleRate };
  }

  /** Manda ao reprodutor o click remontado deste andamento. Uma cópia: a guardada serve no próximo Play. */
  private handClickRemount(node: AudioWorkletNode, clip: AudioClip, tempo: number): boolean {
    const stock = this.clickStock.get(this.clickStockKey(clip, tempo));
    if (!stock) return false;
    const left = stock.left.slice();
    const right = stock.right === stock.left ? left : stock.right.slice();
    try {
      const transfer = left === right ? [left.buffer] : [left.buffer, right.buffer];
      node.port.postMessage({ type: 'rendered', left, right, tempo, pitch: 1 }, transfer);
    } catch {
      return false;
    }
    this.nodeRenderKey.set(node, `${tempo}|1`);
    return true;
  }

  private deliverClickRemount(songId: string, clip: AudioClip) {
    const song = useStore.getState().songs.find((s) => s.id === songId);
    const node = this.songNodes(songId).find((n) => n.clipId === clip.id)?.node;
    const ctx = this.ctx;
    if (!song || !node || !ctx) return;
    const onAir = this.isPlaying && this.currentSongId === songId;
    const params = onAir
      ? paramsAt(song, (ctx.currentTime - this.playbackStartTime) / (this.playbackAlpha || 1))
      : sliceParams(song, null);
    if (params.bpmAdjust === 0 && params.tuner === 0) return;
    const tempo = tempoFromBpm(params.bpmAdjust);
    if (this.nodeRenderKey.get(node) === `${tempo}|1`) return;
    if (!this.handClickRemount(node, clip, tempo)) return;
    const hits = this.clickStock.get(this.clickStockKey(clip, tempo))?.hits;
    if (onAir && hits) this.swapClickQuietly(songId, clip.id, node, tempo, hits);
  }

  // Com a música tocando, o click passa para o áudio remontado no meio de duas batidas.
  private swapClickQuietly(songId: string, clipId: string, node: AudioWorkletNode, tempo: number, hits: number[]) {
    const ctx = this.ctx;
    const active = this.activeClips.get(clipId);
    if (!ctx || !active || active.node !== node) return;
    const gen = this.playGeneration;
    const margin = RETIME_LEAD + 0.02;
    const alpha = this.playbackAlpha || 1;
    const local = (ctx.currentTime + margin - this.playbackStartTime) / alpha - active.clipStartTime;
    if (local < 0) {
      // ainda não entrou: a voz nova nasce antes de soar
      try { node.port.postMessage({ type: 'seek', offsetSamples: 0, startTime: active.scheduledStartWall, fadeInFrames: 10 }); } catch { /* ignore */ }
      return;
    }
    const frame = quietSwapFrame(hits, Math.floor(local * active.sampleRate));
    const wantAt = this.playbackStartTime + (active.clipStartTime + frame / active.sampleRate) * alpha;
    window.setTimeout(() => {
      const now = this.activeClips.get(clipId);
      const a = this.playbackAlpha || 1;
      if (gen !== this.playGeneration || !this.isPlayingSong(songId) || now?.node !== node) return;
      // o andamento mudou enquanto esperava: a troca nova cuida disso
      if (this.nodeRenderKey.get(node) !== `${tempo}|1` || Math.abs(1 / a - tempo) > 1e-6) return;
      this.settleArmed();
      const at = Math.max(wantAt, ctx.currentTime + RETIME_LEAD);
      // o reprodutor guarda um salto por vez: com o loop quase virando, a troca espera ele passar
      const armed = this.armedLoop;
      if (armed && armed.at < at + CLICK_SWAP_GUARD) {
        window.setTimeout(() => this.swapClickQuietly(songId, clipId, node, tempo, hits), Math.max(0, (armed.at - ctx.currentTime) * 1000) + 40);
        return;
      }
      const offsetSamples = Math.min(now.bufferLength, Math.floor(((at - this.playbackStartTime) / a - now.clipStartTime) * now.sampleRate));
      try {
        node.port.postMessage({ type: 'retime', tempo, pitch: 1, process: true, offsetSamples, at, crossfadeFrames: 128 });
      } catch { /* ignore */ }
      if (armed) this.resendLoopJump(songId, clipId, now, armed, at, gen);
    }, Math.max(0, (wantAt - ctx.currentTime - margin) * 1000));
  }

  // A troca do click ocupou o lugar do salto do loop no reprodutor dele. Só o click recebe o mesmo
  // salto de novo, logo depois da troca; as outras faixas continuam com o salto que já têm.
  private resendLoopJump(songId: string, clipId: string, active: ActiveClip, armed: NonNullable<AudioEngine['armedLoop']>, swapAt: number, gen: number) {
    const send = () => {
      const ctx = this.ctx;
      if (!ctx || gen !== this.playGeneration || !this.isPlayingSong(songId) || this.armedLoop !== armed) return;
      if (this.activeClips.get(clipId)?.node !== active.node) return;
      if (ctx.currentTime < swapAt + 0.004) {
        window.setTimeout(send, 4);
        return;
      }
      const alpha = this.playbackAlpha || 1;
      const local = armed.start - active.clipStartTime;
      const offsetSamples = local > 0 ? Math.min(active.bufferLength, Math.floor(local * active.sampleRate)) : 0;
      const resumeAt = armed.at + Math.max(0, -local) * alpha;
      try {
        active.node.port.postMessage({ type: 'jump', at: armed.at, resumeAt, offsetSamples, crossfadeFrames: 256, dropPartial: true });
      } catch { /* ignore */ }
    };
    const ctx = this.ctx;
    window.setTimeout(send, ctx ? Math.max(0, (swapAt - ctx.currentTime) * 1000 + 8) : 8);
  }

  private sinkQueue: Promise<unknown> = Promise.resolve();

  // Trocas de placa uma de cada vez, na ordem pedida (a última sempre vale).
  private queueSink<T>(job: () => Promise<T>): Promise<T> {
    const run = this.sinkQueue.then(job, job);
    this.sinkQueue = run.catch(() => undefined);
    return run;
  }

  setOutputDevice(deviceId: string): Promise<void> {
    return this.queueSink(async () => {
      const id = await this.resolveSinkId(deviceId);
      await this.applySink(this.getContext(), id);
      this.sinkId = id;
      // cada interface tem um número diferente de saídas físicas
      this.configureOutputs();
    });
  }

  /**
   * Relê quantas saídas a placa atual tem (ao abrir o programa e ao conectar/desconectar placas).
   * Sem placa escolhida, acompanha a placa padrão do Mac: conectar uma interface nova já libera as saídas dela.
   */
  refreshOutputs(): Promise<void> {
    return this.queueSink(async () => {
      const ctx = this.getContext();
      if (!this.sinkId) {
        const id = await this.resolveSinkId('default');
        if (id !== this.defaultSinkId) {
          try {
            await this.applySink(ctx, id);
            this.defaultSinkId = id;
          } catch { /* fica na saída atual */ }
        }
      }
      this.configureOutputs();
    });
  }

  // O item "Default - ..." da lista não é aceito como saída no app do Mac: usa a placa real por trás dele.
  private async resolveSinkId(deviceId: string): Promise<string> {
    if (deviceId !== 'default') return deviceId;
    const devices = await this.enumerateDevices().catch(() => [] as MediaDeviceInfo[]);
    const def = devices.find((d) => d.deviceId === 'default');
    const real = def && devices.find((d) => d.deviceId !== 'default' && d.deviceId !== 'communications' && d.groupId === def.groupId);
    // '' = saída padrão do sistema
    return real?.deviceId ?? '';
  }

  private async applySink(ctx: AudioContext, deviceId: string) {
    if ('setSinkId' in ctx) {
      await (ctx as unknown as { setSinkId: (id: string) => Promise<void> }).setSinkId(deviceId);
    }
  }

  generateWaveformPeaks(buffer: AudioBuffer, numPeaks = 4000): number[] {
    return waveformPeaks(buffer, numPeaks);
  }

  /**
   * Reposiciona clipes em tempo real durante a reprodução (comportamento de DAW profissional).
   * Conforme o clipe é arrastado para a esquerda ou direita, o áudio é resincronizado instantaneamente.
   */
  /** Para e desconecta imediatamente clipes removidos (ex.: tecla Delete) enquanto a música toca. */
  stopClipsLive(clipIds: string[]) {
    if (!this.isPlaying) return;
    for (const clipId of clipIds) {
      const active = this.activeClips.get(clipId);
      if (!active) continue;
      this.unfeed(active.node);
      try { active.node.port.postMessage({ type: 'stop' }); } catch { /* ignore */ }
      try { active.node.disconnect(); } catch { /* ignore */ }
      try { active.clipGain.disconnect(); } catch { /* ignore */ }
      if (active.clipPanner) { try { active.clipPanner.disconnect(); } catch { /* ignore */ } }
      this.activeClips.delete(clipId);
    }
    if (clipIds.some((id) => this.starvedSince.has(id))) this.refreshStarved();
  }

  updateLiveClipPosition(clipId: string, newStartTime: number, endCutOnly = false) {
    if (!this.isPlaying || !this.ctx) return;
    const active = this.activeClips.get(clipId);
    if (!active) return;

    active.clipStartTime = newStartTime;
    const nowTime = this.getCurrentTime();
    const alpha = this.playbackAlpha || 1;
    const local = nowTime - newStartTime;

    const store = useStore.getState();
    const clip = store.clips.find((c) => c.id === clipId);
    if (clip) {
      active.durationSeconds = clipPlayLength(clip);
      const audio = getClipPlayAudio(clip);
      if (audio && !endCutOnly) {
        // Áudio do clipe mudou (corte no início, colagem): troca em trechos a partir do cursor.
        active.bufferLength = audio.length;
        const fromFrame = Math.max(0, Math.floor(local * audio.sampleRate));
        try { this.feed(active.node, audio, fromFrame, PRIORITY_ON_AIR); } catch { /* ignore */ }
      } else if (!audio && !endCutOnly && this.diskSongs.has(clip.songId)) {
        // Música lida do disco: reabre o trecho do clipe com o corte novo.
        const node = active.node;
        void openRangeReader(clip).then((reader) => {
          if (!reader || this.activeClips.get(clipId) !== active) return;
          active.bufferLength = reader.length;
          const nowLocal = this.getCurrentTime() - active.clipStartTime;
          this.feedDisk(node, reader, Math.max(0, Math.floor(nowLocal * reader.sampleRate)), PRIORITY_ON_AIR);
        });
      }
      const track = store.tracks.find((t) => t.id === clip.trackId);
      const target = track?.parentId ? store.tracks.find((t) => t.id === track.parentId) ?? track : track;
      const baseGain = (target && track?.parentId ? channelGainFor(track, store.tracks, track.volume) : 1) * clipGainFor(clip, store.clips);
      scheduleClipFade(active.clipGain, this.ctx, baseGain, { ...clip, startTime: newStartTime }, active.durationSeconds, this.playbackStartTime, alpha);
      this.reapplyArmedFades();
    }

    try {
      if (local >= 0 && local < active.durationSeconds) {
        // Playhead está dentro do clipe na nova posição: toca imediatamente no tempo correto
        const offsetSamples = Math.min(Math.max(0, active.bufferLength - 1), Math.max(0, Math.floor(local * active.sampleRate)));
        active.scheduledStartWall = this.ctx.currentTime;
        active.node.port.postMessage({
          type: 'seek',
          offsetSamples,
          startTime: this.ctx.currentTime,
          fadeInFrames: 64,
        });
      } else if (local < 0) {
        // Clipe jogado para a frente do cursor atual: agenda para iniciar quando o cursor chegar
        const scheduledStart = this.playbackStartTime + newStartTime * alpha;
        active.scheduledStartWall = scheduledStart;
        active.node.port.postMessage({
          type: 'seek',
          offsetSamples: 0,
          startTime: scheduledStart,
          fadeInFrames: 1,
        });
      } else {
        // Clipe jogado para trás do cursor (já passou): silencia
        active.node.port.postMessage({
          type: 'seek',
          offsetSamples: active.bufferLength,
          startTime: Number.POSITIVE_INFINITY,
          silent: true,
        });
      }
    } catch { /* ignore */ }
  }
}

export const audioEngine = new AudioEngine();
