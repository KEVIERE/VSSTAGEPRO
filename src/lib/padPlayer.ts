// Toca os pads do Modo Show.
// - Atraso mínimo: os pads têm o próprio contexto de áudio, com o menor bloco que o sistema aceita
//   (latencyHint 0), na mesma placa das músicas. O motor das músicas usa blocos grandes de
//   propósito (modo estável) e o limitador do master segura o som uns milissegundos.
// - Saída: Master (saídas 1-2, seguindo o fader master do programa) ou a saída da placa que o
//   usuário escolher, mono ou par estéreo, como um canal do mixer.
// - Cada pad: volume, pitch (muda a velocidade, como um sampler), reverb, delay no tempo da
//   música, ao contrário e loop. Apertar um pad que está tocando: sem loop recomeça, com loop para.
// - Os sons ficam no computador (padStorage) e vão junto no projeto (pacote .vss ou pasta).

import { audioEngine } from '@/lib/audioEngine';
import { decodeBlob } from '@/lib/audioDecoder';
import { faderToGain } from '@/lib/faderScale';
import { publishMeters } from '@/lib/meterBus';
import { meterBallistics, peakOf } from '@/lib/maestroInput';
import { clearPads, deletePad, loadPadAudio, loadPadInfos, savePad, savePadInfo } from '@/lib/padStorage';
import { registerProjectExtras } from '@/lib/projectHooks';
import {
  FADE_SECONDS, HOLD_RELEASE_SECONDS, MAX_PAD_SECONDS, PAD_CLIP_RANGE, PAD_COUNT, chokedBy, padClipCurve, subscribePads, delayAmount, delaySeconds, djFilter, findSoundBounds, playheadAt, reverbWet,
  padRollSeconds, rollSliceStart, rollingSlots, trimRegion, holdStopTime, getPadsState, makeReverbImpulse, newPadInfo, normalizePadInfo,
  padAssetId, padAssetPath, padFileProblem, padSlot, pitchRate, savedPadsOf, setPadsState, slotBank, slotPad,
  usablePadOutput, withItem, withPlaying, type PadFx, type PadInfo, type PadOutput, type SavedPads,
} from '@/lib/samplePads';
import { useStore } from '@/store';

/** O arquivo de cada pad (do computador, do projeto aberto ou do arquivo importado). */
const sources = new Map<number, Blob>();
const buffers = new Map<number, AudioBuffer>();
/** Cópias prontas para tocar: o trecho cortado e o som de trás para frente (de cada pad). */
const reversed = new Map<number, { from: AudioBuffer; buf: AudioBuffer }>();
const trimmed = new Map<number, { key: string; from: AudioBuffer; buf: AudioBuffer }>();
/** Onde o som começa de verdade em cada arquivo (para o roll não repetir silêncio). */
const onsets = new WeakMap<AudioBuffer, number>();
interface Voice {
  src: AudioBufferSourceNode;
  gain: GainNode;
  reverb: boolean;
  delay: boolean;
  startedAt: number;
  /** Para saber onde o som está (o roll repete a partir dali): posição no arquivo em `anchorT`. */
  anchorT: number;
  anchorPos: number;
  /** Velocidade (pitch). */
  rate: number;
  /** Duração do arquivo, em segundos. */
  length: number;
  /** O roll está repetindo um pedaço, a partir de `rollStart`. */
  rolling: boolean;
  rollStart: number;
}
const voices = new Map<number, Voice>();
let loaded: Promise<void> | null = null;

interface PadOut {
  ctx: AudioContext;
  /** Soma dos pads (volume geral × fader master quando sai no Master). */
  bus: GainNode;
  reverbSend: GainNode;
  delaySend: GainNode;
  delay: DelayNode;
  reverbWet: GainNode;
  delayWet: GainNode;
  feedback: GainNode;
  /** Filtro de DJ depois da soma: passa-baixa e passa-alta. */
  low: BiquadFilterNode;
  high: BiquadFilterNode;
  /** Saída depois do filtro (vai para o medidor e para a placa). */
  post: GainNode;
  /** Sinal inaudível que mantém a placa acordada enquanto o Modo Show está aberto (com algum pad com som). */
  keepAlive: ConstantSourceNode | null;
  /** Medidor da soma (o LED ao lado do fader geral). */
  meter: AnalyserNode;
  /** Ligação da soma com as saídas da placa. */
  merger: ChannelMergerNode | null;
  routeKey: string;
  sink: string | null;
}
let out: PadOut | null = null;

function say(ok: boolean, text: string) {
  setPadsState({ message: { ok, text } });
}

/** Volume da soma: volume geral dos pads, e o fader master quando sai no Master. */
function busGain(): number {
  const { master, output } = getPadsState();
  const viaMaster = usablePadOutput(output, useStore.getState().outputChannelCount).channel === 0;
  return faderToGain(master) * (viaMaster ? faderToGain(useStore.getState().masterVolume) : 1);
}

function songBpm(): number {
  const s = useStore.getState();
  const id = s.transport.currentSongId ?? s.selectedSongId;
  return s.songs.find((x) => x.id === id)?.bpm ?? 120;
}

/** Liga a soma dos pads na saída escolhida (Master = 1-2). */
function route(o: PadOut) {
  const count = Math.max(2, useStore.getState().outputChannelCount);
  const want = usablePadOutput(getPadsState().output, count);
  const dest = o.ctx.destination;
  const channels = Math.max(2, dest.maxChannelCount || 2);
  const key = `${channels}|${want.channel}|${want.stereo}`;
  if (o.routeKey === key) return;
  try {
    dest.channelCount = channels;
    dest.channelCountMode = 'explicit';
    dest.channelInterpretation = 'discrete';
  } catch { /* a saída não aceita mais canais: fica no estéreo */ }
  try { o.post.disconnect(); } catch { /* ignore */ }
  o.post.connect(o.meter);
  if (o.merger) { try { o.merger.disconnect(); } catch { /* ignore */ } }
  const n = Math.max(2, dest.channelCount);
  const merger = o.ctx.createChannelMerger(n);
  const first = want.channel <= 0 ? 0 : want.channel - 1;
  if (want.channel <= 0 || want.stereo) {
    const split = o.ctx.createChannelSplitter(2);
    o.post.connect(split);
    split.connect(merger, 0, Math.min(first, n - 2));
    split.connect(merger, 1, Math.min(first + 1, n - 1));
  } else {
    // mono: esquerda e direita somadas na saída escolhida
    o.post.connect(merger, 0, Math.min(first, n - 1));
  }
  merger.connect(dest);
  o.merger = merger;
  o.routeKey = key;
  o.bus.gain.setTargetAtTime(busGain(), o.ctx.currentTime, 0.01);
}

/** Saída dos pads: abre junto com o painel, para o primeiro toque já sair sem espera. */
export function openPadOutput(): PadOut {
  let fresh = false;
  if (!out || out.ctx.state === 'closed') {
    fresh = true;
    const ctx = new AudioContext({ latencyHint: 0 });
    const bus = ctx.createGain();
    bus.gain.value = busGain();
    // reverb: sala com cauda de ~2 s
    const reverbSend = ctx.createGain();
    const convolver = ctx.createConvolver();
    const [l, r] = makeReverbImpulse(ctx.sampleRate);
    const ir = ctx.createBuffer(2, l.length, ctx.sampleRate);
    ir.getChannelData(0).set(l);
    ir.getChannelData(1).set(r);
    convolver.buffer = ir;
    const fx = getPadsState().fx;
    const reverbWetNode = ctx.createGain();
    reverbWetNode.gain.value = reverbWet(fx.reverb);
    reverbSend.connect(convolver).connect(reverbWetNode).connect(bus);
    // delay: uma semínima no BPM da música, repetindo e escurecendo
    const delaySend = ctx.createGain();
    const delay = ctx.createDelay(2);
    delay.delayTime.value = delaySeconds(songBpm());
    const feedback = ctx.createGain();
    const dly = delayAmount(fx.delay);
    feedback.gain.value = dly.feedback;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 4200;
    const delayWet = ctx.createGain();
    delayWet.gain.value = dly.wet;
    delaySend.connect(delay);
    delay.connect(tone);
    tone.connect(feedback).connect(delay);
    tone.connect(delayWet).connect(bus);
    // filtro de DJ depois da soma (com os efeitos), e a saída final
    const low = ctx.createBiquadFilter();
    low.type = 'lowpass';
    const high = ctx.createBiquadFilter();
    high.type = 'highpass';
    const flt = djFilter(fx.filter);
    low.frequency.value = flt.low;
    high.frequency.value = flt.high;
    low.Q.value = flt.q;
    high.Q.value = flt.q;
    // proteção de pico: os pads saem direto na placa, sem o limitador do master, e a soma (vários
    // pads, reverb, delay e roll) passa de 0 dBFS. Até -1 dBFS passa igual; acima, dobra suave
    // até 0 dBFS. WaveShaper sem sobreamostragem: não soma atraso nenhum
    const clipIn = ctx.createGain();
    clipIn.gain.value = 1 / PAD_CLIP_RANGE;
    const clip = ctx.createWaveShaper();
    clip.curve = padClipCurve();
    clip.oversample = 'none';
    const post = ctx.createGain();
    bus.connect(low).connect(high).connect(clipIn).connect(clip).connect(post);
    const meter = ctx.createAnalyser();
    meter.fftSize = 2048;
    post.connect(meter);
    out = {
      ctx, bus, reverbSend, delaySend, delay, reverbWet: reverbWetNode, delayWet, feedback, low, high, post, keepAlive: null,
      meter, merger: null, routeKey: '', sink: null,
    };
    voices.clear();
  }
  const o = out;
  const sink = audioEngine.getOutputSinkId();
  if (o.sink !== sink && 'setSinkId' in o.ctx) {
    o.sink = sink;
    void (o.ctx as unknown as { setSinkId: (id: string) => Promise<void> }).setSinkId(sink)
      .catch(() => { /* placa indisponível: fica na saída padrão */ })
      .finally(() => { o.routeKey = ''; route(o); reportLatency(o.ctx); });
  }
  route(o);
  // Saída parada fora do Modo Show (suspendWhenQuiet) com música tocando: o painel de pads aberto
  // não faz ela voltar no meio da música (ver resumeWhenStopped). O toque num pad volta na hora.
  if (!fresh && o.ctx.state !== 'running' && useStore.getState().transport.isPlaying) {
    resumeWhenStopped(o);
    return o;
  }
  // o atraso da saída (placa e sistema) só aparece depois que o som começa a correr
  void o.ctx.resume().then(() => {
    reportLatency(o.ctx);
    setTimeout(() => reportLatency(o.ctx), 500);
  });
  return o;
}

function reportLatency(ctx: AudioContext) {
  const extra = (ctx as AudioContext & { outputLatency?: number }).outputLatency ?? 0;
  const ms = Math.round((ctx.baseLatency + extra) * 10000) / 10;
  if (ms !== getPadsState().latencyMs) setPadsState({ latencyMs: ms });
}

/** O Modo Show está aberto (os pads ficam prontos enquanto ele estiver). */
let showReady = false;
/** Espera o som dos pads acabar de vez para parar a saída fora do Modo Show. */
let quietTimer: ReturnType<typeof setInterval> | null = null;

function stopQuietTimer(): void {
  if (quietTimer !== null) clearInterval(quietTimer);
  quietTimer = null;
}

/** Saída parada esperando a música parar para rodar de novo (ver resumeWhenStopped). */
let unsubResume: (() => void) | null = null;
let resumeTimer: ReturnType<typeof setTimeout> | null = null;
/** Música parada há esse tempo: a próxima do repertório, dada logo em seguida, não pega a troca. */
const RESUME_AFTER_STOP_MS = 2000;

function cancelResumeWhenStopped(): void {
  unsubResume?.();
  unsubResume = null;
  if (resumeTimer !== null) clearTimeout(resumeTimer);
  resumeTimer = null;
}

/**
 * A saída parou fora do Modo Show (suspendWhenQuiet) e o Modo Show voltou com a música tocando.
 * Voltar a rodar agora mudaria o bloco da placa no meio da música, que é o que a parada evita.
 * Espera a música parar (e ficar parada 2 s) e só então roda de novo, ainda antes do primeiro
 * toque. Um toque num pad antes disso roda na hora (triggerPad): é o operador pedindo o som.
 */
function resumeWhenStopped(o: PadOut): void {
  if (unsubResume) return;
  const check = () => {
    resumeTimer = null;
    if (useStore.getState().transport.isPlaying) return;
    cancelResumeWhenStopped();
    if (showReady && out === o && o.ctx.state === 'suspended') {
      void o.ctx.resume().then(() => reportLatency(o.ctx)).catch(() => { /* o toque num pad tenta de novo */ });
    }
  };
  unsubResume = useStore.subscribe((s) => {
    if (s.transport.isPlaying) {
      // voltou a tocar antes dos 2 s: espera a próxima parada
      if (resumeTimer !== null) { clearTimeout(resumeTimer); resumeTimer = null; }
      return;
    }
    if (resumeTimer === null) resumeTimer = setTimeout(check, RESUME_AFTER_STOP_MS);
  });
}

/**
 * Deixa a saída aberta, rodando e acordada com um sinal inaudível (-120 dB). Só com algum pad com
 * som: sem pad nenhum não há o que tocar, e a saída de bloco mínimo aberta à toa encurta o bloco
 * da placa para as músicas também. O primeiro som (importado, do computador ou do projeto) já liga.
 */
function armPads(): void {
  if (!showReady || getPadsState().infos.size === 0) return;
  stopQuietTimer();
  const o = padOut();
  // voltou ao Modo Show depois de a saída parar: roda de novo antes do primeiro toque. Com música
  // tocando, espera ela parar (ver resumeWhenStopped); o sinal inaudível já fica ligado e passa a
  // correr quando a saída voltar
  if (o.ctx.state !== 'running' && useStore.getState().transport.isPlaying) resumeWhenStopped(o);
  else if (o.ctx.state !== 'running') void o.ctx.resume();
  if (o.keepAlive) return;
  const k = o.ctx.createConstantSource();
  k.offset.value = 1e-6;
  k.connect(o.ctx.destination);
  k.start();
  o.keepAlive = k;
}

/**
 * Fora do Modo Show ninguém toca os pads: a saída para de rodar, mas só depois de 90 s seguidos
 * sem voz tocando e com o medidor em silêncio (a cauda mais longa do delay, no máximo do knob e a
 * 1,5 s por repetição, cai abaixo de -100 dB antes disso: nada fica cortado nem guardado na
 * memória do efeito) e com as músicas paradas (parar a saída muda o bloco da placa, e isso não
 * acontece com música tocando). Voltar ao Modo Show faz ela rodar de novo.
 */
const QUIET_SECONDS_TO_SUSPEND = 90;
function suspendWhenQuiet(): void {
  if (quietTimer !== null || !out) return;
  const data = new Float32Array(out.meter.fftSize);
  let quiet = 0;
  quietTimer = setInterval(() => {
    const o = out;
    if (showReady || !o || o.ctx.state !== 'running') { stopQuietTimer(); return; }
    let silent = voices.size === 0 && o.meter.fftSize === data.length;
    if (silent) {
      o.meter.getFloatTimeDomainData(data);
      silent = peakOf(data) < 1e-5;
    }
    quiet = silent ? quiet + 1 : 0;
    if (quiet < QUIET_SECONDS_TO_SUSPEND || useStore.getState().transport.isPlaying) return;
    stopQuietTimer();
    void o.ctx.suspend().catch(() => { /* fica rodando em silêncio */ });
  }, 1000);
}

/**
 * Pads sempre prontos no Modo Show: abre a saída, deixa os sons do banco decodificados e mantém a
 * placa acordada com um sinal inaudível. Sem ele, depois de um tempo em silêncio o sistema
 * desliga a saída para economizar, e o primeiro toque atrasa enquanto ela volta.
 */
export function keepPadsReady(on: boolean): void {
  showReady = on;
  if (!on) {
    cancelResumeWhenStopped();
    if (out?.keepAlive) {
      try { out.keepAlive.stop(); } catch { /* já parou */ }
      out.keepAlive.disconnect();
      out.keepAlive = null;
    }
    suspendWhenQuiet();
    return;
  }
  armPads();
  void loadPads().then(() => {
    armPads();
    return prepareBank(getPadsState().bank);
  });
}

// o primeiro som entrou com o Modo Show aberto (importado, do computador ou de um projeto): a saída
// já fica pronta antes do primeiro toque
subscribePads(() => {
  if (showReady && !out?.keepAlive && getPadsState().infos.size > 0) armPads();
});

/** Muda os knobs de efeito; valem na hora para o que está tocando. */
export function setPadsFx(patch: Partial<PadFx>): void {
  const fx = { ...getPadsState().fx, ...patch };
  setPadsState({ fx });
  if (!out) return;
  const o = out;
  const t = o.ctx.currentTime;
  if (patch.reverb !== undefined) o.reverbWet.gain.setTargetAtTime(reverbWet(fx.reverb), t, 0.02);
  if (patch.delay !== undefined) {
    const d = delayAmount(fx.delay);
    o.delayWet.gain.setTargetAtTime(d.wet, t, 0.02);
    o.feedback.gain.setTargetAtTime(d.feedback, t, 0.02);
  }
  if (patch.filter !== undefined) {
    const f = djFilter(fx.filter);
    o.low.frequency.setTargetAtTime(f.low, t, 0.015);
    o.high.frequency.setTargetAtTime(f.high, t, 0.015);
    o.low.Q.setTargetAtTime(f.q, t, 0.015);
    o.high.Q.setTargetAtTime(f.q, t, 0.015);
  }
  // o knob muda o tamanho só dos pads com ROLL ligado; os outros nem sentem
  if (patch.roll !== undefined) {
    for (const slot of rollingSlots(voices.keys(), getPadsState().infos)) applyRoll(slot, voices.get(slot)!);
  }
}

/** Onde o som da voz está agora, em segundos do arquivo. */
function headOf(v: Voice, now: number): number {
  return playheadAt(now, {
    anchorT: v.anchorT, anchorPos: v.anchorPos, rate: v.rate,
    loopStart: v.src.loopStart, loopEnd: v.src.loopEnd > 0 ? v.src.loopEnd : v.length, looping: v.src.loop,
  });
}

/**
 * Roll (velocidade do loop), só nos pads com ROLL ligado: repete um pedaço do som, do ponto onde
 * ele está, do tamanho do knob no tempo da música. Desligado, o som segue de onde estava (em
 * loop só se o pad tem loop).
 */
function applyRoll(slot: number, v: Voice, startAt?: number): void {
  const now = v.src.context.currentTime;
  const { fx, infos } = getPadsState();
  const sec = padRollSeconds(fx.roll, songBpm(), infos.get(slot)?.roll);
  const pos = headOf(v, now);
  v.anchorT = now;
  v.anchorPos = pos;
  if (sec === null) {
    if (!v.rolling) return;
    v.rolling = false;
    v.src.loop = !!getPadsState().infos.get(slot)?.loop;
    v.src.loopStart = 0;
    v.src.loopEnd = 0;
    return;
  }
  const len = Math.max(0.004, Math.min(v.length, sec * v.rate));
  if (!v.rolling) {
    // começa no pedaço da grade onde o som está (ou no primeiro som, num toque novo)
    v.rollStart = startAt !== undefined
      ? Math.max(0, Math.min(startAt, v.length - len))
      : rollSliceStart(pos, len, v.length);
    v.rolling = true;
  }
  const end = v.rollStart + len;
  if (pos >= end) v.anchorPos = v.rollStart + ((pos - v.rollStart) % len);
  v.src.loopEnd = end;
  v.src.loopStart = v.rollStart;
  v.src.loop = true;
}

function padOut(): PadOut {
  return out && out.ctx.state !== 'closed' && out.sink === audioEngine.getOutputSinkId() ? out : openPadOutput();
}

// Medidor da soma dos pads ('pads' no barramento dos medidores), no padrão do mixer. Só roda
// enquanto há som tocando ou o LED ainda está descendo.
let meterLevel = 0;
let meterFrame: number | null = null;
function runMeter() {
  if (meterFrame !== null || !out) return;
  const o = out;
  const data = new Float32Array(o.meter.fftSize);
  let last = performance.now();
  let lastPublish = 0;
  const tick = (now: number) => {
    if (now - lastPublish >= 33) {
      o.meter.getFloatTimeDomainData(data);
      meterLevel = meterBallistics(meterLevel, peakOf(data), (now - last) / 1000);
      last = now;
      lastPublish = now;
      publishMeters(new Map([['pads', meterLevel]]));
    }
    if (voices.size === 0 && meterLevel < 0.001) {
      meterFrame = null;
      meterLevel = 0;
      publishMeters(new Map([['pads', 0]]));
      return;
    }
    meterFrame = requestAnimationFrame(tick);
  };
  meterFrame = requestAnimationFrame(tick);
}

/** Relógio da saída dos pads (para o visor contar o tempo que falta). */
export function padClock(): number {
  return out?.ctx.currentTime ?? 0;
}

// fader master, placa e música mudam: volume, saída e tempo do delay acompanham
useStore.subscribe((s, prev) => {
  if (!out) return;
  if (s.masterVolume !== prev.masterVolume) out.bus.gain.setTargetAtTime(busGain(), out.ctx.currentTime, 0.01);
  if (s.outputChannelCount !== prev.outputChannelCount) route(out);
  if (s.songs !== prev.songs || s.transport.currentSongId !== prev.transport.currentSongId || s.selectedSongId !== prev.selectedSongId) {
    out.delay.delayTime.setTargetAtTime(delaySeconds(songBpm()), out.ctx.currentTime, 0.05);
    for (const [slot, v] of voices) if (v.rolling) applyRoll(slot, v);
  }
});

// ---------- Carregar ----------

/** Lê as informações dos 90 lugares guardados no computador (uma vez) e prepara o banco aberto. */
export function loadPads(): Promise<void> {
  if (!loaded) {
    loaded = loadPadInfos()
      .then((list) => {
        // um projeto aberto antes de ler o computador já trouxe os pads dele
        if (getPadsState().infos.size > 0) return;
        setPadsState({ infos: new Map(list.map((i) => [i.slot, normalizePadInfo(i)])) });
        return prepareBank(getPadsState().bank);
      })
      .catch(() => { say(false, 'Não consegui ler os sons guardados dos pads.'); });
  }
  return loaded;
}

async function sourceOf(slot: number): Promise<Blob | null> {
  const have = sources.get(slot);
  if (have) return have;
  const audio = await loadPadAudio(slot).catch(() => null);
  if (!audio) return null;
  const blob = new Blob([audio.bytes], { type: audio.type });
  sources.set(slot, blob);
  return blob;
}

/** Decodifica os sons do banco (os de outros bancos saem da memória, menos os que estão tocando). */
export async function prepareBank(bank: number): Promise<void> {
  for (const slot of [...buffers.keys()]) {
    if (slotBank(slot) !== bank && !voices.has(slot)) {
      buffers.delete(slot);
      forgetCopies(slot);
    }
  }
  const { infos } = getPadsState();
  await Promise.all(Array.from({ length: PAD_COUNT }, async (_, p) => {
    const slot = padSlot(bank, p);
    if (!infos.has(slot) || buffers.has(slot)) return;
    try {
      const blob = await sourceOf(slot);
      if (blob) buffers.set(slot, await decodeBlob(blob));
    } catch { /* o pad fica sem som até carregar de novo */ }
  }));
}

export async function selectBank(bank: number): Promise<void> {
  const { selected } = getPadsState();
  setPadsState({ bank, selected: padSlot(bank, slotPad(selected)) });
  await prepareBank(bank);
}

export function selectPad(slot: number): void {
  if (getPadsState().selected !== slot) setPadsState({ selected: slot });
}

// ---------- Tocar ----------

function reversedBuffer(slot: number, buffer: AudioBuffer): AudioBuffer {
  const have = reversed.get(slot);
  if (have && have.from === buffer) return have.buf;
  const rev = new AudioBuffer({ length: buffer.length, numberOfChannels: buffer.numberOfChannels, sampleRate: buffer.sampleRate });
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const src = buffer.getChannelData(c);
    const dst = rev.getChannelData(c);
    for (let i = 0, j = src.length - 1; i < src.length; i++, j--) dst[i] = src[j];
  }
  reversed.set(slot, { from: buffer, buf: rev });
  return rev;
}

/** O trecho cortado do som (cópia guardada; o arquivo continua inteiro), com 3 ms de saída suave. */
function trimmedBuffer(slot: number, info: PadInfo, buffer: AudioBuffer): AudioBuffer {
  const r = trimRegion({ ...info, duration: buffer.duration });
  if (r.start <= 0 && r.end >= buffer.duration) return buffer;
  const key = `${r.start}|${r.end}`;
  const have = trimmed.get(slot);
  if (have && have.key === key && have.from === buffer) return have.buf;
  const sr = buffer.sampleRate;
  const s0 = Math.max(0, Math.floor(r.start * sr));
  const s1 = Math.min(buffer.length, Math.ceil(r.end * sr));
  const out = new AudioBuffer({ length: Math.max(1, s1 - s0), numberOfChannels: buffer.numberOfChannels, sampleRate: sr });
  const fade = Math.min(out.length, Math.round(sr * 0.003));
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const dst = out.getChannelData(c);
    dst.set(buffer.getChannelData(c).subarray(s0, s1));
    for (let i = 0; i < fade; i++) dst[dst.length - 1 - i] *= i / fade;
  }
  trimmed.set(slot, { key, from: buffer, buf: out });
  return out;
}

/** O que o pad toca: o trecho cortado (se houver) e, no reverso, de trás para frente. */
function playableBuffer(slot: number, info: PadInfo, buffer: AudioBuffer): AudioBuffer {
  const cut = trimmedBuffer(slot, info, buffer);
  return info.reverse ? reversedBuffer(slot, cut) : cut;
}

/** Onde o som começa de verdade no que vai tocar (segundos), guardado por arquivo. */
function onsetOf(buffer: AudioBuffer): number {
  const have = onsets.get(buffer);
  if (have !== undefined) return have;
  const ch = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
  const at = findSoundBounds(ch, buffer.sampleRate)?.start ?? 0;
  onsets.set(buffer, at);
  return at;
}

function forgetCopies(slot: number): void {
  reversed.delete(slot);
  trimmed.delete(slot);
}

function release(slot: number, fade = 0.012) {
  const v = voices.get(slot);
  if (!v) return;
  voices.delete(slot);
  const t = v.gain.context.currentTime;
  v.gain.gain.cancelScheduledValues(t);
  v.gain.gain.setValueAtTime(v.gain.gain.value, t);
  v.gain.gain.linearRampToValueAtTime(0, t + fade);
  try { v.src.stop(t + fade + 0.005); } catch { /* já parou */ }
  setPadsState({ playing: withPlaying(getPadsState().playing, slot, null) });
}

function connectSends(v: Voice, o: PadOut, reverb: boolean, delay: boolean) {
  if (reverb !== v.reverb) {
    if (reverb) v.gain.connect(o.reverbSend);
    else try { v.gain.disconnect(o.reverbSend); } catch { /* ignore */ }
    v.reverb = reverb;
  }
  if (delay !== v.delay) {
    if (delay) v.gain.connect(o.delaySend);
    else try { v.gain.disconnect(o.delaySend); } catch { /* ignore */ }
    v.delay = delay;
  }
}

/** Aperta o pad: toca e deixa ele escolhido (o knob, o pitch e os efeitos passam a mexer nele). */
export function triggerPad(slot: number): void {
  selectPad(slot);
  const info = getPadsState().infos.get(slot);
  const buffer = buffers.get(slot);
  if (!info || !buffer) return;
  if (voices.has(slot)) {
    release(slot);
    // loop: apertar de novo para (no modo segurar, apertar de novo sempre recomeça)
    if (info.loop && !getPadsState().hold) return;
  }
  // um por vez: o pad novo para os outros (com uma descida curta, sem estalo)
  for (const other of chokedBy(slot, voices.keys(), getPadsState().choke)) release(other, 0.03);
  const o = padOut();
  if (o.ctx.state !== 'running') void o.ctx.resume();
  const src = o.ctx.createBufferSource();
  src.buffer = playableBuffer(slot, info, buffer);
  src.loop = info.loop;
  src.playbackRate.value = pitchRate(info.pitch);
  const gain = o.ctx.createGain();
  gain.gain.value = faderToGain(info.volume);
  src.connect(gain);
  gain.connect(o.bus);
  const now = o.ctx.currentTime;
  const voice: Voice = {
    src, gain, reverb: false, delay: false, startedAt: now,
    anchorT: now, anchorPos: 0, rate: src.playbackRate.value, length: src.buffer.duration, rolling: false, rollStart: 0,
  };
  // ROLL do pad ligado antes do toque: repete a partir do primeiro som (nunca o silêncio do começo)
  if (info.roll) applyRoll(slot, voice, onsetOf(src.buffer));
  connectSends(voice, o, info.reverb, info.delay);
  src.onended = () => {
    if (voices.get(slot)?.src !== src) return;
    voices.delete(slot);
    setPadsState({ playing: withPlaying(getPadsState().playing, slot, null) });
  };
  // com o roll já ligado, o som começa direto no pedaço que vai repetir
  const offset = voice.rolling ? voice.rollStart : 0;
  voice.anchorPos = offset;
  src.start(0, offset);
  voices.set(slot, voice);
  setPadsState({ playing: withPlaying(getPadsState().playing, slot, o.ctx.currentTime) });
  runMeter();
}

/**
 * Soltou o pad (mouse ou tecla). Só vale no modo segurar: o som para ao soltar, mas toca pelo
 * menos 0,2 s (apertou e soltou rápido = 0,2 s). Continua aceso até parar de verdade.
 */
export function releasePad(slot: number): void {
  const { infos, hold } = getPadsState();
  const info = infos.get(slot);
  const v = voices.get(slot);
  if (!hold || !info || !v) return;
  const ctx = v.gain.context;
  const at = holdStopTime(v.startedAt, ctx.currentTime);
  const g = v.gain.gain;
  g.cancelScheduledValues(at);
  g.setValueAtTime(faderToGain(info.volume), at);
  g.linearRampToValueAtTime(0, at + HOLD_RELEASE_SECONDS);
  try { v.src.stop(at + HOLD_RELEASE_SECONDS + 0.005); } catch { /* já parou */ }
}

export function stopAllPads(): void {
  for (const slot of [...voices.keys()]) release(slot, 0.04);
}

/** Abaixa todos os pads tocando até sumir, em 2 segundos. */
export function fadeAllPads(): void {
  for (const slot of [...voices.keys()]) release(slot, FADE_SECONDS);
}

export function setPadsMaster(volume: number): void {
  setPadsState({ master: volume });
  if (out) out.bus.gain.setTargetAtTime(busGain(), out.ctx.currentTime, 0.01);
}

/** Liga ou desliga o "um por vez" (tocar um pad para os outros). */
export function setPadsChoke(choke: boolean): void {
  setPadsState({ choke });
}

/** Liga ou desliga o "segurar" (os pads tocam enquanto estão apertados). */
export function setPadsHold(hold: boolean): void {
  setPadsState({ hold });
}

export function setPadsOutput(output: PadOutput): void {
  setPadsState({ output });
  if (out) route(out);
}

/** Muda um ajuste do pad; volume, pitch, loop e efeitos valem na hora para o som que está tocando. */
export async function updatePad(slot: number, patch: Partial<Omit<PadInfo, 'slot'>>): Promise<void> {
  const cur = getPadsState().infos.get(slot);
  if (!cur) return;
  const next = { ...cur, ...patch };
  const infos = new Map(getPadsState().infos);
  infos.set(slot, next);
  setPadsState({ infos });
  const v = voices.get(slot);
  if (v) {
    const t = v.gain.context.currentTime;
    if (patch.volume !== undefined) v.gain.gain.setTargetAtTime(faderToGain(patch.volume), t, 0.01);
    if (patch.pitch !== undefined) {
      v.anchorPos = headOf(v, t);
      v.anchorT = t;
      v.rate = pitchRate(patch.pitch);
      v.src.playbackRate.setTargetAtTime(v.rate, t, 0.01);
      if (v.rolling) applyRoll(slot, v);
    }
    // ROLL do pad ligado ou desligado tocando: vale na hora, só nesta voz (os outros pads seguem)
    if (patch.roll !== undefined) applyRoll(slot, v);
    if (patch.loop !== undefined && !v.rolling) {
      v.anchorPos = headOf(v, t);
      v.anchorT = t;
      v.src.loop = patch.loop;
    }
    if ((patch.reverb !== undefined || patch.delay !== undefined) && out) connectSends(v, out, next.reverb, next.delay);
  }
  await savePadInfo(next).catch(() => say(false, 'Não deu para guardar a mudança do pad.'));
}

/** Liga ou desliga o ROLL de um pad (vale na hora se ele está tocando). Devolve se ficou ligado. */
export async function togglePadRoll(slot: number): Promise<boolean> {
  const info = getPadsState().infos.get(slot);
  if (!info) return false;
  const on = !info.roll;
  await updatePad(slot, { roll: on });
  return on;
}

/**
 * Corta o silêncio do começo e do fim do som do pad (o arquivo guardado continua inteiro) ou, se
 * já está cortado, volta ao som inteiro. Devolve se ficou cortado.
 */
export async function toggleTrimPad(slot: number): Promise<boolean> {
  const info = getPadsState().infos.get(slot);
  if (!info) return false;
  if (info.trimStart !== undefined && info.trimEnd !== undefined) {
    await updatePad(slot, { trimStart: undefined, trimEnd: undefined });
    return false;
  }
  let buffer = buffers.get(slot);
  if (!buffer) {
    const blob = await sourceOf(slot);
    if (!blob) return false;
    buffer = await decodeBlob(blob);
    buffers.set(slot, buffer);
  }
  const ch = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer!.getChannelData(c));
  const bounds = findSoundBounds(ch, buffer.sampleRate);
  if (!bounds) { say(false, 'Esse som está todo em silêncio: não há o que cortar.'); return false; }
  const cut = bounds.start > 0.002 || bounds.end < buffer.duration - 0.002;
  if (!cut) { say(true, 'O som já começa e termina na hora: nada para cortar.'); return false; }
  await updatePad(slot, { trimStart: bounds.start, trimEnd: bounds.end });
  const head = Math.round(bounds.start * 1000);
  const tail = Math.round((buffer.duration - bounds.end) * 1000);
  say(true, `Cortado: ${head} ms no começo e ${tail} ms no fim.`);
  return true;
}

/** Põe o arquivo no pad: confere, decodifica, guarda e deixa pronto para tocar. */
export async function importPadFile(slot: number, file: File): Promise<boolean> {
  const problem = padFileProblem(file);
  if (problem) { say(false, `${file.name}: ${problem}.`); return false; }
  setPadsState({ loading: withItem(getPadsState().loading, slot, true), message: null, selected: slot });
  try {
    const bytes = await file.arrayBuffer();
    const type = file.type || 'audio/wav';
    let buffer: AudioBuffer;
    try {
      buffer = await decodeBlob(new Blob([bytes], { type }));
    } catch {
      say(false, `${file.name}: não consegui abrir esse áudio.`);
      return false;
    }
    if (buffer.duration > MAX_PAD_SECONDS) {
      say(false, `${file.name}: o pad aceita sons de até 3 minutos.`);
      return false;
    }
    const old = getPadsState().infos.get(slot);
    const keep = old
      ? { color: old.color, volume: old.volume, loop: old.loop, pitch: old.pitch, reverb: old.reverb, delay: old.delay, reverse: old.reverse, roll: !!old.roll }
      : {};
    const info: PadInfo = { ...newPadInfo(slot, file.name, buffer.duration), ...keep, type };
    release(slot);
    try {
      await savePad(info, type, bytes);
    } catch {
      say(false, 'Não deu para guardar o som neste computador.');
      return false;
    }
    sources.set(slot, new Blob([bytes], { type }));
    buffers.set(slot, buffer);
    forgetCopies(slot);
    const infos = new Map(getPadsState().infos);
    infos.set(slot, info);
    setPadsState({ infos });
    return true;
  } finally {
    setPadsState({ loading: withItem(getPadsState().loading, slot, false) });
  }
}

export async function clearPad(slot: number): Promise<void> {
  release(slot);
  buffers.delete(slot);
  forgetCopies(slot);
  sources.delete(slot);
  const infos = new Map(getPadsState().infos);
  infos.delete(slot);
  setPadsState({ infos });
  await deletePad(slot).catch(() => say(false, 'Não deu para apagar o som guardado.'));
}

// ---------- No projeto ----------

/** Projeto aberto com pads: eles entram no lugar dos atuais (e viram a cópia do computador). */
async function applyProjectPads(saved: SavedPads, files: Map<string, Blob>): Promise<void> {
  stopAllPads();
  sources.clear();
  buffers.clear();
  reversed.clear();
  trimmed.clear();
  const infos = new Map<number, PadInfo>();
  for (const p of saved.pads ?? []) {
    const blob = files.get(padAssetId(p.slot));
    if (!blob || blob.size === 0) continue;
    const info: Partial<PadInfo> & { slot: number } = { ...p };
    delete (info as { path?: string }).path;
    infos.set(p.slot, normalizePadInfo(info));
    sources.set(p.slot, blob);
  }
  const bank = Number.isInteger(saved.bank) ? Math.max(0, Math.min(9, saved.bank)) : 0;
  setPadsState({
    infos, bank, selected: padSlot(bank, 0), master: saved.master ?? 0.8,
    output: saved.output ?? getPadsState().output, choke: saved.choke ?? getPadsState().choke,
    hold: saved.hold ?? getPadsState().hold, playing: new Map(),
  });
  if (out) route(out);
  await prepareBank(bank);
  // cópia no computador, para os pads continuarem se o programa abrir sem projeto
  try {
    await clearPads();
    for (const info of infos.values()) {
      const blob = sources.get(info.slot);
      if (blob) await savePad(info, info.type ?? (blob.type || 'audio/wav'), await blob.arrayBuffer());
    }
  } catch { /* a cópia é só conveniência: o projeto continua com os pads */ }
}

registerProjectExtras({
  manifest: () => {
    const saved = savedPadsOf(getPadsState());
    return saved ? { samplePads: saved } : {};
  },
  assets: () => [...getPadsState().infos.values()].map((info) => ({
    id: padAssetId(info.slot),
    relPath: padAssetPath(info),
    blob: () => sourceOf(info.slot),
    current: () => sources.get(info.slot) ?? null,
  })),
  folderAssets: (manifest) => {
    const saved = manifest.samplePads as SavedPads | undefined;
    return (saved?.pads ?? []).map((p) => ({ id: padAssetId(p.slot), path: p.path }));
  },
  loaded: (manifest, files) => {
    const saved = manifest.samplePads as SavedPads | undefined;
    // projeto sem pads: os pads atuais continuam (e vão junto no próximo salvar)
    if (saved?.pads?.length) void applyProjectPads(saved, files);
  },
  rebind: (files) => {
    for (const slot of getPadsState().infos.keys()) {
      const blob = files.get(padAssetId(slot));
      if (blob) sources.set(slot, blob);
    }
  },
});

// as informações dos pads guardados entram já na abertura: o salvar do projeto leva os pads
// mesmo que o Modo Show ainda não tenha sido aberto
void loadPads();
