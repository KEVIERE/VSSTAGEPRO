import { useStore } from '@/store';
import { bpmAdjustToAlpha, stretchClipAudio, tempoFromBpm } from '@/lib/timeStretch';
import { computeNextSongId } from '@/lib/playFlow';
import { getClipPlayerWorkletUrl } from '@/lib/clipPlayerWorklet';
import { clipPlayLength, ensureSongLoaded, getClipAudio, getClipPlayAudio, getClipSource, isSongLoaded, loadFailure, missingClipIds, retainSongs } from '@/lib/audioLibrary';
import { HEAD_SECONDS, headsFromOpenAudio, loadHeads, loadStretchedHeads, wantsStretchedHead } from '@/lib/instantStart';
import type { HeadAudio, StretchedHead } from '@/lib/instantStart';
import { entryExists, markUsed, readEntry, readyDir, renderedName, writeEntry } from '@/lib/readyStore';
import { sortedRegions } from '@/lib/regions';
import { entryPoint, hasSliceParams, medleySlices, paramsAt, playableEnd, skipJumpAt, sliceParams } from '@/lib/medley';
import { publishMeters, resetMeters } from '@/lib/meterBus';
import { isTimecodeTrackId, NO_OUTPUT, TIMECODE_TRACK_ID } from '@/lib/timecode';
import { TimecodePlayer } from '@/lib/timecodePlayer';
import type { AudioClip, Song, SongRegion, Track } from '@/types';

const RETIME_LEAD = 0.06;

// Fader scale: 0.8 = 0 dB (unity), 1.5 = +12 dB, 0 = silence
export function faderToGain(volume: number): number {
  if (volume >= 0.8) return Math.pow(10, ((volume - 0.8) / 0.7) * 0.6);
  return volume / 0.8;
}

export function volumeToDb(volume: number): number {
  if (volume <= 0.0001) return -Infinity;
  return 20 * Math.log10(faderToGain(volume));
}

const NON_MELODIC_ROOTS = new Set(['track-bateria', 'track-percussoes', 'track-click', 'track-maestro']);

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
  return track.children.some((id) => {
    const c = allTracks.find((x) => x.id === id);
    return c ? treeHasSolo(c, allTracks) : false;
  });
}

const isStemClip = (c: AudioClip) => !isTimecodeTrackId(c.trackId);

export function channelGainFor(track: Track, allTracks: Track[], volume: number): number {
  // o timecode só obedece ao próprio mudo: solo e mudo das outras faixas não o calam
  if (isTimecodeTrackId(track.id)) return track.mute ? 0 : faderToGain(volume);
  const anySolo = allTracks.some((t) => t.solo && !isTimecodeTrackId(t.id));
  const audible = (!anySolo || chainHas(track, allTracks, (t) => t.solo) || treeHasSolo(track, allTracks))
    && !chainHas(track, allTracks, (t) => t.mute);
  return audible ? faderToGain(volume) : 0;
}

interface ChannelNode {
  gain: GainNode;
  panner: StereoPannerNode;
  analyser: AnalyserNode;
  source: AudioBufferSourceNode | null;
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
  pending: PreparedPending[];
}

function effectivePan(trackId: string, trackPan: number, lrActive: boolean): number {
  if (isTimecodeTrackId(trackId)) return 0;
  if (!lrActive) return trackPan;
  if (trackId === 'track-click' || trackId === 'track-maestro') return -1;
  return 1;
}

// Com BPM ou tom fora do original, todas as faixas passam pelo mesmo processamento (mesmo atraso).
function songNeedsProcessing(song: Song | undefined): boolean {
  if (!song) return false;
  if ((song.bpmAdjust ?? 0) !== 0 || song.tuner !== 0) return true;
  return !!song.medley?.some((p) => (p.bpmAdjust ?? 0) !== 0 || (p.tuner ?? 0) !== 0);
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
const RENDER_CONCURRENCY = Math.min(2, Math.max(1, (navigator.hardwareConcurrency || 2) - 1));
const RENDER_DELAY_MS = 700;
const RENDER_TIMEOUT_MS = 60_000;

interface SongNode {
  clipId: string;
  node: AudioWorkletNode;
  trackId: string;
}

class AudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private masterAnalyser: AnalyserNode | null = null;
  private meterSmoothed = new Map<string, number>();
  private meterScratch = new Float32Array(256);
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
  private prepared: Map<string, PreparedBundle> = new Map();
  private preparing: Map<string, Promise<void>> = new Map();
  private stableMode = localStorage.getItem(STABLE_MODE_LS) !== '0';
  private sinkId: string | null = null;
  private nodeRenderKey = new WeakMap<AudioWorkletNode, string>();
  private renderTimers = new Map<string, number>();
  private renderRuns = new Map<string, number>();
  private renderingSongs = new Map<string, { done: number; total: number }>();
  // A música no ar ainda toca só pelo começo pronto (o áudio inteiro está abrindo).
  private headOnly = false;
  // As faixas no ar ainda leem o começo já ajustado.
  private partialActive = false;
  private partialTimer: number | null = null;
  private outputMerger: ChannelMergerNode | null = null;
  private masterSplitter: ChannelSplitterNode | null = null;
  private outputCount = 2;
  private routedTo = new Map<string, string>();
  private timecode: TimecodePlayer | null = null;
  private timecodeClipId: string | null = null;

  getContext(): AudioContext {
    if (!this.ctx || this.ctx.state === 'closed') {
      // Modo Show: blocos de áudio maiores, alguns milissegundos a mais de atraso e muito mais folga contra estalos.
      this.ctx = new AudioContext({ latencyHint: this.stableMode ? 'playback' : 'interactive' });
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = faderToGain(useStore.getState().masterVolume);
      this.masterAnalyser = this.ctx.createAnalyser();
      this.masterAnalyser.fftSize = 256;
      this.masterGain.connect(this.masterAnalyser);
      this.configureOutputs();
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
    this.workletReady = null;
    this.ctx = null;
    this.masterGain = null;
    this.masterAnalyser = null;
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
      return `${c.id}|${c.trackId}|${c.startTime.toFixed(4)}|${c.duration.toFixed(4)}|${b.length}|${b.sampleRate}|${b.channels.length}`;
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

  // Uma música pela metade nunca vai ao ar: para e avisa quais áudios falharam e por quê.
  private refuseIncompleteSong(songId: string) {
    const store = useStore.getState();
    const missing = store.clips.filter((c) => missingClipIds(songId).includes(c.id));
    const song = store.songs.find((s) => s.id === songId);
    const songName = song?.name ?? 'a música';
    const listOf = (clips: typeof missing) => clips.slice(0, 5).map((c) => c.name).join(', ')
      + (clips.length > 5 ? ` e mais ${clips.length - 5}` : '');
    const gone = missing.filter((c) => loadFailure(c.id) === 'missing');
    const broken = missing.filter((c) => loadFailure(c.id) === 'format');
    const parts: string[] = [];
    if (gone.length) parts.push(`não encontrei no computador: ${listOf(gone)}. Os arquivos podem ter sido movidos ou apagados; abra o projeto de novo a partir da pasta onde eles estão`);
    if (broken.length) parts.push(`estes arquivos estão danificados ou num formato que não consigo ler: ${listOf(broken)}`);
    const lowMem = missing.filter((c) => !gone.includes(c) && !broken.includes(c));
    if (lowMem.length) parts.push(`faltou memória para abrir: ${listOf(lowMem)}. Feche outras abas ou programas e dê Play de novo`);
    this.stopAll();
    store.stop();
    store.setPlaybackError(`"${songName}" não foi tocada porque ${parts.join('; ')}.`);
  }

  private reportMissing(songId: string, startedIds: Iterable<string>) {
    const started = new Set(startedIds);
    const store = useStore.getState();
    const missing = store.clips.filter((c) => c.songId === songId && isStemClip(c) && !started.has(c.id) && store.tracks.some((t) => t.id === c.trackId));
    if (missing.length === 0) return;
    console.warn('[audioEngine] faixas sem áudio', missing.map((c) => c.name));
    const names = missing.slice(0, 4).map((c) => c.name).join(', ');
    store.setPlaybackError(`Não foi possível carregar ${missing.length === 1 ? 'a faixa' : 'as faixas'}: ${names}${missing.length > 4 ? '…' : ''}. Dê Stop e Play para tentar de novo.`);
  }

  private disposePreparedBundle(bundle: PreparedBundle) {
    for (const p of bundle.pending) {
      try { p.node.port.postMessage({ type: 'stop' }); } catch { /* ignore */ }
      try { p.node.disconnect(); } catch { /* ignore */ }
      try { p.clipGain.disconnect(); } catch { /* ignore */ }
      if (p.clipPanner) { try { p.clipPanner.disconnect(); } catch { /* ignore */ } }
    }
  }

  private invalidatePrepared(songId?: string) {
    if (songId) {
      const b = this.prepared.get(songId);
      if (b) {
        this.disposePreparedBundle(b);
        this.prepared.delete(songId);
      }
      return;
    }
    this.prepared.forEach((b) => this.disposePreparedBundle(b));
    this.prepared.clear();
  }

  /** Libera os pré-carregamentos das músicas que não estão mais em uso. */
  releaseUnretained(keepSongIds: Array<string | null | undefined>) {
    const keep = new Set(keepSongIds.filter(Boolean));
    for (const songId of Array.from(this.prepared.keys())) {
      if (!keep.has(songId)) this.invalidatePrepared(songId);
    }
  }

  private isPlayingSong(songId: string): boolean {
    return this.isPlaying && this.currentSongId === songId && this.activeClips.size > 0;
  }

  async prepareSong(songId: string): Promise<void> {
    // A música no ar já tem os reprodutores dela; ao parar eles são guardados para o próximo Play.
    if (this.isPlayingSong(songId)) return;
    if (!isSongLoaded(songId)) await ensureSongLoaded(songId);
    const sig = this.computePrepareSignature(songId);
    if (!sig) return;
    const existing = this.prepared.get(songId);
    if (existing && existing.signature === sig) return;
    const inflight = this.preparing.get(songId);
    if (inflight) return inflight;

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
        const left = buffer.channels[0];
        const right = buffer.channels[1] ?? left;
        const headFrames = Math.min(left.length, Math.floor(HEAD_SECONDS * sampleRate));

        const node = new AudioWorkletNode(ctx, 'clip-player', {
          numberOfInputs: 0,
          numberOfOutputs: 1,
          outputChannelCount: [2],
          processorOptions: {
            left: left.slice(0, headFrames),
            right: right.slice(0, headFrames),
            sampleRate,
            offsetSamples: 0,
            tempo,
            pitch: melodic ? pitchFromCents(cents) : 1,
            process: songNeedsProcessing(song),
            primeTargetFrames: 2048,
            fadeInFrames: 0,
          },
        });
        // O áudio inteiro vai sem cópia no reprodutor, para não pesar na música que está tocando.
        const fullLeft = left.slice();
        const fullRight = right === left ? fullLeft : right.slice();
        node.port.postMessage({ type: 'extend', left: fullLeft, right: fullRight }, fullRight === fullLeft ? [fullLeft.buffer] : [fullLeft.buffer, fullRight.buffer]);

        const clipGain = ctx.createGain();
        clipGain.gain.value = track.parentId ? channelGainFor(track, tracks, track.volume) : 1;
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

        const ready = new Promise<void>((resolve) => {
          node.port.onmessage = (ev) => {
            if (ev.data?.type === 'ready') resolve();
          };
        });

        pending.push({
          clipId: clip.id,
          node,
          clipStartTime: clip.startTime,
          clipDuration: clipPlayLength(clip),
          ready,
          sampleRate,
          bufferLength: left.length,
          clipGain,
          clipPanner,
          trackId: clip.trackId,
        });
        await new Promise((r) => setTimeout(r, 0));
      }

      const bundle: PreparedBundle = { songId, signature: sig, pending };

      await Promise.race([
        Promise.all(pending.map((p) => p.ready)),
        new Promise<void>((resolve) => setTimeout(resolve, 500)),
      ]);

      const currentSig = this.computePrepareSignature(songId);
      // Se a música começou a tocar com outros reprodutores, este preparo seria uma cópia a mais na memória.
      if (currentSig !== sig || this.isPlayingSong(songId) || !this.coversAllClips(songId, pending.map((p) => p.clipId))) {
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
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.8;
    gain.connect(panner);
    panner.connect(analyser);
    const node: ChannelNode = { gain, panner, analyser, source: null };
    this.channels.set(trackId, node);
    this.routeChannel(trackId);
    return node;
  }

  // Saídas físicas: o Master ocupa as saídas 1 e 2; cada canal pode ir direto para outra saída da interface.
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
    if (this.outputMerger && this.outputCount === actual) return;
    try { this.masterAnalyser.disconnect(); } catch { /* ignore */ }
    if (this.outputMerger) { try { this.outputMerger.disconnect(); } catch { /* ignore */ } }
    this.outputCount = actual;
    this.outputMerger = ctx.createChannelMerger(actual);
    this.masterSplitter = ctx.createChannelSplitter(2);
    this.masterAnalyser.connect(this.masterSplitter);
    this.masterSplitter.connect(this.outputMerger, 0, 0);
    this.masterSplitter.connect(this.outputMerger, 1, 1);
    this.outputMerger.connect(dest);
    this.routedTo.clear();
    this.channels.forEach((_, id) => this.routeChannel(id));
    useStore.getState().setOutputChannelCount(actual);
  }

  private routeChannel(trackId: string) {
    const ch = this.channels.get(trackId);
    if (!ch || !this.masterGain || !this.outputMerger) return;
    const track = useStore.getState().tracks.find((t) => t.id === trackId);
    const out = track?.outputChannel ?? 0;
    const physical = out > 0 && out <= this.outputCount ? out : 0;
    // o timecode nunca cai no Master: sem uma saída física válida ele fica mudo
    const key = isTimecodeTrackId(trackId) ? (physical ? `out-${physical}` : 'none') : (physical ? `out-${physical}` : 'master');
    if (this.routedTo.get(trackId) === key) return;
    try { ch.analyser.disconnect(); } catch { /* ignore */ }
    if (key === 'master') ch.analyser.connect(this.masterGain);
    else if (key !== 'none') ch.analyser.connect(this.outputMerger, 0, physical - 1);
    this.routedTo.set(trackId, key);
  }

  getOutputCount(): number {
    return this.outputCount;
  }

  /** O timecode desta música só sai se tiver uma saída física escolhida que a interface oferece. */
  timecodeOutputReady(): boolean {
    const tc = useStore.getState().tracks.find((t) => t.id === TIMECODE_TRACK_ID);
    return !!tc && tc.outputChannel !== NO_OUTPUT && tc.outputChannel > 0 && tc.outputChannel <= this.outputCount;
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
    return this.timecode;
  }

  // Coloca o timecode da música no mesmo ponto dos stems; se o áudio ainda está abrindo, entra assim que abrir.
  private startTimecode(songId: string, songPos: number, when: number, remind: boolean) {
    const clip = this.timecodeClip(songId);
    if (!clip) { this.timecode?.stop(); this.timecodeClipId = null; return; }
    if (remind && !this.timecodeOutputReady()) {
      useStore.getState().setPlaybackError('Lembrete: o TIMECODE (LTC) está "Sem Saída". Escolha no mixer a saída física da interface que vai para o telão ou a mesa de luz (ex.: Saída 5).');
    }
    const player = this.ensureTimecode();
    const audio = getClipAudio(clip.id);
    this.timecodeClipId = clip.id;
    if (audio) {
      player.start(clip.id, audio, songPos - clip.startTime, when);
      return;
    }
    player.stop();
    const gen = this.playGeneration;
    ensureSongLoaded(songId).then(() => {
      const late = getClipAudio(clip.id);
      if (!late || gen !== this.playGeneration || !this.isPlaying || this.currentSongId !== songId || !this.ctx) return;
      const at = this.ctx.currentTime + 0.05;
      const pos = (at - this.playbackStartTime) / (this.playbackAlpha || 1);
      player.start(clip.id, late, pos - clip.startTime, at);
    }).catch(() => { /* avisado pelo carregamento da música */ });
  }

  private jumpTimecode(songId: string, destPos: number, at: number) {
    const clip = this.timecodeClip(songId);
    const audio = clip ? getClipAudio(clip.id) : null;
    if (!clip || !audio || !this.timecode || this.timecodeClipId !== clip.id) return;
    this.timecode.scheduleJump(clip.id, audio, destPos - clip.startTime, at);
  }

  private startsInFlight = 0;

  isStarting(): boolean {
    return this.startsInFlight > 0;
  }

  async playSong(songId: string, startOffset = 0, options?: { fastSeek?: boolean }) {
    this.startsInFlight++;
    try {
      await this.startSong(songId, startOffset, options);
    } finally {
      this.startsInFlight--;
    }
  }

  private async startSong(songId: string, startOffset = 0, options?: { fastSeek?: boolean }) {
    let heads: Map<string, HeadAudio> | null = null;
    if (!isSongLoaded(songId)) {
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
        if (!isSongLoaded(songId)) {
          this.refuseIncompleteSong(songId);
          return;
        }
      }
    }
    const fastSeek = options?.fastSeek === true;
    this.stopAll();
    this.loopPasses.clear();
    const expectedSig = this.computePrepareSignature(songId);
    const bundle = this.prepared.get(songId) ?? null;
    const useBundle = !!(bundle && expectedSig && bundle.signature === expectedSig
      && this.coversAllClips(songId, bundle.pending.map((p) => p.clipId)));
    if (!useBundle && !heads && isSongLoaded(songId)) {
      const st = useStore.getState();
      heads = headsFromOpenAudio(st.clips.filter((c) => c.songId === songId && isStemClip(c) && getClipAudio(c.id) && st.tracks.some((t) => t.id === c.trackId)), startOffset);
    }
    const myGen = ++this.playGeneration;
    const ctx = this.getContext();
    if (ctx.state === 'suspended') await ctx.resume();
    await this.ensureWorklet();
    if (myGen !== this.playGeneration) return;

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
      const bpmAdjust = song?.bpmAdjust ?? 0;
      const alpha = bpmAdjustToAlpha(bpmAdjust);
      const cents = song ? song.tuner * 100 : 0;
      const tracks = store.tracks;
      const lr = store.lrMasterActive;

      this.isPlaying = true;
      this.currentSongId = songId;
      this.markOnAir(songId);
      this.playbackOffset = startOffset;
      this.playbackAlpha = alpha;
      this.playbackCents = cents;

      const headroom = 0.03;
      const scheduledStart = ctx.currentTime + headroom;
      this.playbackStartTime = scheduledStart - startOffset * alpha;
      this.startTimecode(songId, startOffset, scheduledStart, true);

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

        const gTarget = track.parentId ? channelGainFor(track, tracks, track.volume) : 1;
        try { p.clipGain.gain.cancelScheduledValues(ctx.currentTime); } catch { /* ignore */ }
        try { p.clipGain.gain.setValueAtTime(gTarget, ctx.currentTime); } catch { p.clipGain.gain.value = gTarget; }
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
        const offsetSamples = local > 0 ? Math.min(p.bufferLength, Math.floor(local * p.sampleRate)) : 0;
        try {
          p.node.port.postMessage({ type: 'seek', offsetSamples, startTime: whenWall, fadeInFrames: offsetSamples > 0 ? 512 : 1 });
        } catch { /* ignore */ }

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

      this.startMetering();
      this.scheduleSongEnd(songDuration);
      useStore.getState().setCurrentTime(startOffset);
      store.selectSong(songId);
      this.reportMissing(songId, this.activeClips.keys());
      this.rearmLoop();
      const st = useStore.getState();
      st.setNextSong(computeNextSongId(songId, st.playlist, st.playlistOrder, st.transport.playFlow));
      this.scheduleRender(songId, 0);
      return;
    }

    const clips = store.clips.filter((c) => c.songId === songId && isStemClip(c));
    if (clips.length === 0) return;

    const song = store.songs.find((s) => s.id === songId);
    const audioFor = (clip: typeof clips[number]) => heads ? heads.get(clip.id) ?? null : getClipPlayAudio(clip);
    const playClips = clips.filter((c) => store.tracks.some((t) => t.id === c.trackId) && audioFor(c));
    // Com BPM/tom alterados, o começo já ajustado evita ligar o processamento ao vivo de todas as faixas na largada.
    const stretched = wantsStretchedHead(song)
      ? await loadStretchedHeads(song, playClips, headPitchFor, 0)
      : null;
    if (myGen !== this.playGeneration) return;

    this.isPlaying = true;
    this.currentSongId = songId;
    this.markOnAir(songId);
    this.playbackOffset = startOffset;
    this.headOnly = !!heads;

    const songDuration = song?.duration ?? Math.max(...clips.map((c) => c.duration));
    const bpmAdjust = song?.bpmAdjust ?? 0;
    const alpha = bpmAdjustToAlpha(bpmAdjust);
    const tempo = tempoFromBpm(bpmAdjust);
    const cents = song ? song.tuner * 100 : 0;
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
    };
    const pending: Pending[] = [];
    const purgePending = () => {
      for (const p of pending) {
        try { p.node.port.postMessage({ type: 'stop' }); } catch { /* ignore */ }
        try { p.node.disconnect(); } catch { /* ignore */ }
        try { p.clipGain.disconnect(); } catch { /* ignore */ }
        if (p.clipPan) { try { p.clipPan.disconnect(); } catch { /* ignore */ } }
        this.clipGains.delete(p.clipId);
        this.clipPanners.delete(p.clipId);
      }
      pending.length = 0;
    };

    for (const clip of clips) {
      const buffer = audioFor(clip);
      if (!buffer) continue;
      const track = tracks.find((t) => t.id === clip.trackId);
      if (!track) continue;
      const target = track.parentId ? tracks.find((t) => t.id === track.parentId) ?? track : track;
      const melodic = isMelodicTrack(track, tracks);

      const sampleRate = buffer.sampleRate;
      const left = buffer.channels[0];
      const right = buffer.channels[1] ?? left;

      const offsetSeconds = Math.max(0, startOffset - clip.startTime);
      const offsetSamples = Math.floor(offsetSeconds * sampleRate);
      const bufferLength = heads ? heads.get(clip.id)!.fullFrames : left.length;
      const pitch = melodic ? pitchFromCents(cents) : 1;
      const ready = stretched?.get(clip.id);

      const node = new AudioWorkletNode(ctx, 'clip-player', {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        processorOptions: {
          left,
          right,
          sampleRate,
          offsetSamples,
          tempo,
          pitch,
          process: songNeedsProcessing(song),
          primeTargetFrames: fastSeek ? 1024 : 2048,
          fadeInFrames: fastSeek ? 1024 : 512,
          ...(ready ? { renderedLeft: ready.left, renderedRight: ready.right, renderedTempo: tempo, renderedPitch: pitch, renderedValidFrames: ready.validFrames } : {}),
        },
      });

      const clipGain = ctx.createGain();
      clipGain.gain.value = track.parentId ? channelGainFor(track, tracks, track.volume) : 1;
      node.connect(clipGain);

      const readyFor = (nodeRef: AudioWorkletNode) => new Promise<void>((resolve) => {
        nodeRef.port.onmessage = (ev) => {
          if (ev.data?.type === 'ready') resolve();
        };
      });

      if (track.parentId) {
        const clipPan = ctx.createStereoPanner();
        clipPan.pan.value = effectivePan(track.id, track.pan, lr);
        clipGain.connect(clipPan);
        const channel = this.ensureChannel(target.id);
        clipPan.connect(channel.gain);
        channel.gain.gain.value = channelGainFor(target, tracks, target.volume);
        channel.panner.pan.value = effectivePan(target.id, target.pan, lr);
        this.clipPanners.set(clip.id, clipPan);
        pending.push({ clipId: clip.id, node, clip, ready: readyFor(node), sampleRate, bufferLength, clipGain, clipPan });
      } else {
        const channel = this.ensureChannel(target.id);
        clipGain.connect(channel.gain);
        channel.gain.gain.value = channelGainFor(target, tracks, target.volume);
        channel.panner.pan.value = effectivePan(target.id, target.pan, lr);
        pending.push({ clipId: clip.id, node, clip, ready: readyFor(node), sampleRate, bufferLength, clipGain, clipPan: null });
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

    const headroom = fastSeek ? 0.03 : 0.05;
    const scheduledStart = ctx.currentTime + headroom;
    this.playbackStartTime = scheduledStart - startOffset * alpha;
    this.startTimecode(songId, startOffset, scheduledStart, !fastSeek);

    for (const p of pending) {
      const whenWall = scheduledStart + Math.max(0, (p.clip.startTime - startOffset)) * alpha;
      try { p.node.port.postMessage({ startTime: whenWall }); } catch { /* ignore */ }
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
    if (stretched) this.schedulePartialHandoff(songId, myGen, pending, stretched, startOffset, tempo);
    if (heads) void this.finishHeadStart(songId, myGen);
    else this.scheduleRender(songId, 0);
  }

  private clipsWithSource(songId: string) {
    const store = useStore.getState();
    return store.clips.filter((c) => c.songId === songId && isStemClip(c) && getClipSource(c.id) && store.tracks.some((t) => t.id === c.trackId));
  }

  // A música largou pelo começo pronto: quando o áudio inteiro abre, cada faixa continua nele sem corte.
  private async finishHeadStart(songId: string, gen: number) {
    await ensureSongLoaded(songId).catch(() => { /* tratado abaixo */ });
    if (gen !== this.playGeneration || !this.isPlayingSong(songId)) return;
    const store = useStore.getState();
    if (!isSongLoaded(songId)) {
      const name = store.songs.find((s) => s.id === songId)?.name ?? 'a música';
      store.setPlaybackError(`Parte do áudio de "${name}" não abriu a tempo: algumas faixas podem ficar mudas depois dos primeiros segundos. Dê Stop e Play para tentar de novo.`);
      return;
    }
    // Uma faixa por vez e sem cópia no reprodutor: o som no ar não sente a troca.
    for (const [clipId, active] of Array.from(this.activeClips.entries())) {
      if (gen !== this.playGeneration || this.activeClips.get(clipId) !== active) return;
      const clip = store.clips.find((c) => c.id === clipId);
      const audio = clip ? getClipPlayAudio(clip) : null;
      if (!audio) continue;
      const left = audio.channels[0].slice();
      const right = audio.channels[1] ? audio.channels[1].slice() : left;
      // a transferência zera o tamanho do array, então o tamanho é guardado antes
      active.bufferLength = left.length;
      try {
        active.node.port.postMessage({ type: 'extend', left, right }, right === left ? [left.buffer] : [left.buffer, right.buffer]);
      } catch { /* ignore */ }
      await new Promise((r) => setTimeout(r, 0));
    }
    if (gen !== this.playGeneration) return;
    this.headOnly = false;
    this.scheduleRender(songId, 0);
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
      this.handoffFromPartial(songId);
    };
    const delay = Math.max(0, (endWall - 1.5 - this.ctx!.currentTime) * 1000);
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
    const at = ctx.currentTime + RETIME_LEAD;
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
    if (this.retimeTimer) window.clearTimeout(this.retimeTimer);
    this.retimeTimer = window.setTimeout(() => {
      this.retimeTimer = null;
      if (this.isPlaying && this.currentSongId === songId) this.rearmLoop();
    }, RETIME_LEAD * 1000 + 30);
  }

  private armedLoop: { regionId: string; destId: string; start: number; at: number } | null = null;
  private sliceTimer: number | null = null;
  private settledDestId: string | null = null;
  private loopPasses = new Map<string, number>();
  private loopTimer: number | null = null;

  constructor() {
    useStore.subscribe((s, prev) => {
      if ((s.songs !== prev.songs || s.queuedRegion !== prev.queuedRegion) && this.isPlaying) this.rearmLoop();
      if (s.clips !== prev.clips || s.tracks !== prev.tracks) this.rerouteMovedClips();
      if (s.tracks !== prev.tracks) this.channels.forEach((_, id) => this.routeChannel(id));
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
      try { item.clipGain.disconnect(); } catch { /* ignore */ }
      if (item.clipPanner) { try { item.clipPanner.disconnect(); } catch { /* ignore */ } }
      const channel = this.ensureChannel(target.id);
      if (track.parentId) {
        const panner = item.clipPanner ?? ctx.createStereoPanner();
        panner.pan.value = effectivePan(track.id, track.pan, lrMasterActive);
        item.clipGain.connect(panner);
        panner.connect(channel.gain);
        item.clipPanner = panner;
        this.clipPanners.set(clipId, panner);
        item.clipGain.gain.value = channelGainFor(track, tracks, track.volume);
      } else {
        item.clipPanner = null;
        this.clipPanners.delete(clipId);
        item.clipGain.connect(channel.gain);
        item.clipGain.gain.value = 1;
      }
      channel.gain.gain.value = channelGainFor(target, tracks, target.volume);
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
    this.armedLoop = null;
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
      return;
    }
    const target = jump.dest;
    const at = this.playbackStartTime + jump.boundary * alpha;
    const armed = this.armedLoop;
    if (armed && armed.regionId === jump.sourceId && armed.destId === target.id && Math.abs(armed.start - target.start) < 1e-6 && Math.abs(armed.at - at) < 0.0005) return;

    this.disarmLoop(false);
    for (const clip of store.clips) {
      if (clip.songId !== song.id) continue;
      const active = this.activeClips.get(clip.id);
      if (!active) continue;
      const local = target.start - clip.startTime;
      const offsetSamples = local > 0 ? Math.min(active.bufferLength, Math.floor(local * active.sampleRate)) : 0;
      const resumeAt = at + Math.max(0, -local) * alpha;
      try {
        active.node.port.postMessage({ type: 'jump', at, resumeAt, offsetSamples, crossfadeFrames: 256, dropPartial: true });
      } catch { /* ignore */ }
    }
    this.jumpTimecode(song.id, target.start, at);
    this.armedLoop = { regionId: jump.sourceId, destId: target.id, start: target.start, at };
    if (this.songEndTimeout) { clearTimeout(this.songEndTimeout); this.songEndTimeout = null; }
    const delay = Math.max(0, (at - ctx.currentTime) * 1000);
    this.loopTimer = window.setTimeout(() => this.commitLoop(), delay);
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
    this.rearmLoop();
    if (!this.armedLoop) {
      const song = useStore.getState().songs.find((s) => s.id === this.currentSongId);
      if (song) this.scheduleSongEnd(song.duration);
    }
  }

  // A tela precisa saber qual música está no ar também quando o programa passa sozinho para a próxima.
  private markOnAir(songId: string) {
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

  private scheduleSongEnd(songDuration: number) {
    if (this.songEndTimeout) { clearTimeout(this.songEndTimeout); this.songEndTimeout = null; }
    // com um loop armado, o fim da música só é agendado quando o loop for desligado
    if (this.armedLoop) return;
    const pos = this.getCurrentTime();
    const song = useStore.getState().songs.find((s) => s.id === this.currentSongId);
    const end = song && pos < playableEnd(song) - 0.01 ? Math.min(songDuration, playableEnd(song)) : songDuration;
    const remaining = Math.max(0, (end - pos) * this.playbackAlpha * 1000);
    this.songEndTimeout = window.setTimeout(() => this.onSongEnd(), remaining);
  }

  private onSongEnd() {
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
      this.playSong(nextSongId, entryPoint(store.songs.find((s) => s.id === nextSongId)));
      const st = useStore.getState();
      st.setNextSong(computeNextSongId(nextSongId, st.playlist, st.playlistOrder, st.transport.playFlow));
      return;
    }

    const endedId = this.currentSongId;
    store.stop();
    this.stopAll();
    // Fim do bloco: a primeira música do bloco seguinte fica só selecionada, esperando o Play.
    if (transport.playFlow === 'bloco' && endedId) {
      const order = useStore.getState().playlistOrder;
      const following = order[order.indexOf(endedId) + 1];
      if (following) useStore.getState().selectSong(following);
    }
  }

  stopAll() {
    this.disarmLoop(false);
    if (this.sliceTimer) { clearTimeout(this.sliceTimer); this.sliceTimer = null; }
    if (this.retimeTimer) { clearTimeout(this.retimeTimer); this.retimeTimer = null; }
    const stoppedSongId = this.currentSongId;
    this.isPlaying = false;
    this.currentSongId = null;
    this.playGeneration++;
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
    if (stoppedSongId && !retained) this.cancelRender(stoppedSongId);
    const toDisconnect = retained ? [] : Array.from(this.activeClips.entries());
    const gainsSnapshot = retained ? new Map<string, GainNode>() : new Map(this.clipGains);
    const pannersSnapshot = retained ? new Map<string, StereoPannerNode>() : new Map(this.clipPanners);
    this.activeClips.clear();
    this.clipGains.clear();
    this.clipPanners.clear();
    const disconnect = () => {
      toDisconnect.forEach(([, active]) => {
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
    const sig = this.computePrepareSignature(songId);
    if (!sig || this.activeClips.size === 0 || !this.coversAllClips(songId, this.activeClips.keys())) return false;
    const old = this.prepared.get(songId);
    if (old) this.disposePreparedBundle(old);
    const fadeEnd = (this.ctx?.currentTime ?? 0) + 0.015;
    const pending: PreparedPending[] = [];
    this.activeClips.forEach((a, clipId) => {
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
    const bundle: PreparedBundle = { songId, signature: sig, pending };
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
    if (!this.currentSongId) return;
    if (!this.isPlaying) {
      useStore.getState().setCurrentTime(time);
      return;
    }
    const ctx = this.ctx;
    const store = useStore.getState();
    const songId = this.currentSongId;
    const clips = store.clips.filter((c) => c.songId === songId && isStemClip(c));
    const canSeekInPlace = ctx !== null && !this.headOnly && clips.length > 0 && clips.every((c) => this.activeClips.has(c.id) || (time >= c.startTime + c.duration));

    if (!canSeekInPlace) {
      this.seekLock = { active: true, targetTime: time };
      this.playSong(songId, time, { fastSeek: true }).catch((err) => {
        console.error('[seekTo] falha', err);
        this.seekLock.active = false;
      });
      return;
    }

    this.seekLock = { active: true, targetTime: time };
    const alpha = this.playbackAlpha || 1;
    const headroom = 0.03;
    const scheduledStart = ctx!.currentTime + headroom;
    this.playbackStartTime = scheduledStart - time * alpha;
    this.playbackOffset = time;
    this.startTimecode(songId, time, scheduledStart, false);

    const tracks = store.tracks;
    const song = store.songs.find((s) => s.id === songId);
    const cents = song ? song.tuner * 100 : 0;

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
          fadeInFrames: 1024,
          dropPartial: true,
          tempo: tempoFromBpm(song?.bpmAdjust ?? 0),
          pitch: melodic ? pitchFromCents(cents) : 1,
        });
      } catch { /* ignore */ }
      active.scheduledStartWall = whenWall;
    }

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
      const targetGain = channelGainFor(track, all, track.volume);
      const targetPan = effectivePan(track.id, track.pan, lrActive);
      store.clips.forEach((c) => {
        if (c.trackId === trackId) {
          const g = this.clipGains.get(c.id);
          if (g) this.rampParam(g.gain, targetGain);
          const p = this.clipPanners.get(c.id);
          if (p) this.rampParam(p.pan, targetPan);
        }
      });
      return;
    }
    const channel = this.channels.get(trackId);
    if (!channel) return;
    this.rampParam(channel.gain.gain, channelGainFor(track, all, track.volume));
    this.rampParam(channel.panner.pan, effectivePan(track.id, track.pan, lrActive));
  }

  setMasterVolume(volume: number) {
    if (this.masterGain) this.rampParam(this.masterGain.gain, faderToGain(volume));
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
    const data = this.meterScratch;
    channel.analyser.getFloatTimeDomainData(data);
    let peak = 0;
    for (let i = 0; i < data.length; i++) {
      const abs = Math.abs(data[i]);
      if (abs > peak) peak = abs;
    }
    const now = performance.now();
    const prev = this.meterSmoothed.get(trackId) ?? 0;
    const elapsed = Math.min(100, now - (this.meterLastUpdate.get(trackId) ?? now)) / 1000;
    this.meterLastUpdate.set(trackId, now);
    const released = prev * Math.pow(10, (-24 * elapsed) / 20);
    const smoothed = Math.max(peak, released);
    this.meterSmoothed.set(trackId, smoothed);
    return smoothed;
  }

  private startMetering() {
    this.stopMetering();
    const METER_INTERVAL_MS = 40;
    const STORE_INTERVAL_MS = 200;
    let lastMeterTick = 0;
    let lastStoreTick = 0;
    const levels = new Map<string, number>();
    const update = (now: number) => {
      if (!this.isPlaying) return;
      if (now - lastMeterTick >= METER_INTERVAL_MS) {
        lastMeterTick = now;
        const store = useStore.getState();
        for (const t of store.tracks) {
          const level = this.getMeterLevel(t.id);
          levels.set(t.id, level);
          if (level >= 1 && !t.clipIndicator) store.updateMeter(t.id, level);
        }
        const masterLevel = this.getMasterMeterLevel();
        levels.set('master', masterLevel);
        if (masterLevel >= 1 && store.masterClipPeak < masterLevel) store.updateMasterMeter(masterLevel);
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

  // Aplicação ao vivo: muda BPM/afinador sem reiniciar nem engasgar o áudio.
  applySongPlaybackParams(songId: string) {
    const store = useStore.getState();
    const song = store.songs.find((s) => s.id === songId);
    if (!song) return;
    for (const n of this.songNodes(songId)) this.nodeRenderKey.delete(n.node);
    if (this.currentSongId === songId) this.partialActive = false;
    this.scheduleRender(songId);

    const base = sliceParams(song, null);
    const baseTempo = tempoFromBpm(base.bpmAdjust);
    const baseCents = base.tuner * 100;

    // Atualiza o preparo em cache em vez de invalidá-lo, para que
    // Stop → Play imediato continue com os valores novos sem recriar nada.
    const prep = this.prepared.get(songId);
    if (prep) {
      const tracks = store.tracks;
      prep.signature = this.computePrepareSignature(songId) ?? prep.signature;
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
    this.disarmLoop(false);
    const at = this.ctx.currentTime + RETIME_LEAD;
    const posAt = (at - this.playbackStartTime) / (this.playbackAlpha || 1);
    const params = paramsAt(song, posAt);
    const newAlpha = bpmAdjustToAlpha(params.bpmAdjust);
    const newTempo = tempoFromBpm(params.bpmAdjust);
    const newCents = params.tuner * 100;
    this.playbackAlpha = newAlpha;
    this.playbackCents = newCents;
    this.playbackOffset = posAt;
    this.playbackStartTime = at - posAt * newAlpha;

    const tracks = store.tracks;
    const process = params.bpmAdjust !== 0 || params.tuner !== 0;

    this.activeClips.forEach((active, clipId) => {
      const clip = store.clips.find((c) => c.id === clipId);
      const track = clip ? tracks.find((t) => t.id === clip.trackId) : undefined;
      const melodic = track ? isMelodicTrack(track, tracks) : true;
      const pitch = melodic ? pitchFromCents(newCents) : 1;
      const local = posAt - active.clipStartTime;
      try {
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

    if (this.retimeTimer) window.clearTimeout(this.retimeTimer);
    this.retimeTimer = window.setTimeout(() => {
      this.retimeTimer = null;
      if (!this.isPlaying || this.currentSongId !== songId) return;
      this.rearmLoop();
    }, RETIME_LEAD * 1000 + 30);
    this.scheduleSongEnd(song.duration);
  }

  private retimeTimer: number | null = null;

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
    const store = useStore.getState();
    const song = store.songs.find((s) => s.id === songId);
    // com BPM/tom diferentes por fatia, o áudio é processado ao vivo
    if (!song || !songNeedsProcessing(song) || hasSliceParams(song) || !this.ctx) {
      this.setRendering(songId, false);
      return;
    }
    const token = this.renderRuns.get(songId) ?? 0;
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
      return this.nodeRenderKey.get(n.node) === key ? [] : [{ ...n, buffer, pitch, key, diskName }];
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
    await Promise.all(Array.from({ length: Math.min(RENDER_CONCURRENCY, targets.length) }, runNext));
    if (this.renderRuns.get(songId) !== token) return;

    // Só entrega se todas as faixas ficaram prontas: misturar faixas processadas e ao vivo desalinha os instrumentos.
    const alive = new Set(this.songNodes(songId).map((n) => n.node));
    if (results.some((r) => !r) || targets.some((t) => !alive.has(t.node))) {
      this.setRendering(songId, false);
      return;
    }
    targets.forEach((t, i) => {
      const r = results[i]!;
      try {
        // Canais lidos do disco dividem o mesmo bloco de memória: ele só pode ser transferido uma vez.
        const transfer = r.left.buffer === r.right.buffer ? [r.left.buffer] : [r.left.buffer, r.right.buffer];
        t.node.port.postMessage({ type: 'rendered', left: r.left, right: r.right, tempo, pitch: t.pitch }, transfer);
        this.nodeRenderKey.set(t.node, t.key);
      } catch { /* nó já descartado */ }
    });
    this.setRendering(songId, false);
    if (this.isPlaying && this.currentSongId === songId) this.swapToRendered(songId);
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

  async setOutputDevice(deviceId: string) {
    await this.applySink(this.getContext(), deviceId);
    this.sinkId = deviceId;
    // cada interface tem um número diferente de saídas físicas
    this.configureOutputs();
  }

  private async applySink(ctx: AudioContext, deviceId: string) {
    if ('setSinkId' in ctx) {
      await (ctx as unknown as { setSinkId: (id: string) => Promise<void> }).setSinkId(deviceId);
    }
  }

  generateWaveformPeaks(buffer: AudioBuffer, numPeaks = 800): number[] {
    const channels: Float32Array[] = [];
    for (let c = 0; c < Math.min(buffer.numberOfChannels, 2); c++) {
      channels.push(buffer.getChannelData(c));
    }
    const data = channels[0];
    const samplesPerPeak = Math.max(1, Math.floor(data.length / numPeaks));
    const peaks: number[] = [];
    for (let i = 0; i < numPeaks; i++) {
      let max = 0;
      const start = i * samplesPerPeak;
      const end = Math.min(start + samplesPerPeak, data.length);
      for (let j = start; j < end; j++) {
        for (const ch of channels) {
          const abs = Math.abs(ch[j]);
          if (abs > max) max = abs;
        }
      }
      peaks.push(max);
    }
    return peaks;
  }
}

export const audioEngine = new AudioEngine();
