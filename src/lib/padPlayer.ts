// Toca os pads do Modo Show.
// - Saída própria: os pads têm o próprio contexto de áudio, na mesma placa das músicas, sem o
//   limitador do master. O bloco é o MESMO do motor (engineLatency): no Mac a placa usa o menor
//   bloco pedido entre todas as saídas, e um bloco menor nos pads encurtava a folga das músicas
//   (estalo e engasgo ao abrir o Modo Show com música tocando).
// - Saída: Master (saídas 1-2, seguindo o fader master do programa) ou a saída da placa que o
//   usuário escolher, mono ou par estéreo, como um canal do mixer.
// - Cada pad: volume, pitch (muda a velocidade, como um sampler), reverb, delay no tempo da
//   música, ao contrário e loop. Apertar um pad que está tocando: sem loop recomeça, com loop para.
// - Os sons ficam no computador (padStorage) e vão junto no projeto (pacote .vss ou pasta).

import { audioEngine } from '@/lib/audioEngine';
import { afterPaint } from '@/lib/afterPaint';
import { decodeBlob } from '@/lib/audioDecoder';
import { padLatencyHint } from '@/lib/engineLatency';
import { faderToGain } from '@/lib/faderScale';
import { publishMeters } from '@/lib/meterBus';
import { meterBallistics, peakOf } from '@/lib/maestroInput';
import { deletePad, loadPadAudio, loadPadInfos, loadPadRecords, savePad, savePadInfo } from '@/lib/padStorage';
import { registerProjectExtras } from '@/lib/projectHooks';
import {
  FADE_SECONDS, HOLD_RELEASE_SECONDS, MAX_PAD_SECONDS, PAD_CLIP_RANGE, PAD_COUNT, chokedBy, padClipCurve, subscribePads, delayAmount, delaySeconds, djFilter, findSoundBounds, playheadAt, reverbWet,
  padRollSeconds, rollSliceStart, rollingSlots, trimRegion, holdStopTime, getPadsState, makeReverbImpulse, newPadInfo, normalizePadInfo,
  padAssetId, padAssetPath, padFileProblem, padSlot, pitchRate, savedPadsOf, setPadsState, setPadsStateSoon, slotBank, slotPad,
  usablePadOutput, withItem, withPlaying, type PadFx, type PadInfo, type PadOutput, type SavedPads,
} from '@/lib/samplePads';
import { useStore } from '@/store';

/** O arquivo de cada pad (do computador, do projeto aberto ou do arquivo importado). */
const sources = new Map<number, Blob>();
/**
 * Pads cujo arquivo em `sources` está na memória (lido do computador ou importado) e também
 * guardado no computador: esses podem sair da memória quando o banco fecha (sourceOf lê de novo).
 * Os do projeto aberto são pedaços do arquivo no disco: não ocupam memória e ficam.
 */
const memSources = new Set<number>();
/** Sons decodificados, do usado há mais tempo para o mais recente (ver keepBuffersInBudget). */
const buffers = new Map<number, AudioBuffer>();
/** Sons sendo decodificados agora (para não decodificar o mesmo pad duas vezes). */
const decoding = new Map<number, Promise<void>>();
/**
 * Geração de cada pad: muda quando o som do pad muda (projeto aberto, limpar, importar). Uma
 * leitura ou decodificação que começou antes da mudança não grava o som velho no pad.
 */
let epoch = 0;
const slotGen = new Map<number, number>();
/** Pads do projeto aberto que o espelho no computador ainda não gravou (ver mirrorProjectPads). */
const mirrorPending = new Set<number>();
function slotToken(slot: number): string {
  return `${epoch}.${slotGen.get(slot) ?? 0}`;
}
function bumpSlot(slot: number): void {
  slotGen.set(slot, (slotGen.get(slot) ?? 0) + 1);
  decoding.delete(slot);
  // importar/limpar grava (ou apaga) sozinho: o espelho do projeto pula este pad
  mirrorPending.delete(slot);
}
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
  split: ChannelSplitterNode | null;
  routeKey: string;
  sink: string | null;
  /** Bloco pedido ao criar (o motor pode trocar de modo depois; ver retireStaleOutput). */
  hint: AudioContextLatencyCategory;
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

/** A saída usa menos canais do que a placa tem aberto agora: reduzir ficou para depois (route). */
let shrinkPending = false;

/** Liga a soma dos pads na saída escolhida (Master = 1-2). */
function route(o: PadOut) {
  const count = Math.max(2, useStore.getState().outputChannelCount);
  const want = usablePadOutput(getPadsState().output, count);
  const dest = o.ctx.destination;
  // só os canais que o som usa: 2 no Master, e na saída direta até o último canal escolhido. Abrir
  // todos os canais da placa (16, 32...) fazia o Chromium misturar e mandar canais vazios a cada bloco
  const used = want.channel <= 0 ? 2 : want.channel + (want.stereo ? 1 : 0);
  const channels = Math.min(Math.max(2, dest.maxChannelCount || 2), Math.max(2, used));
  // mudar channelCount com o contexto rodando refaz o fluxo da placa (estalo no meio da música):
  // crescer é preciso para o som sair; diminuir espera música parada e nenhum pad tocando
  // (watchStaleHint tenta de novo a cada 2 s)
  const cur = dest.channelCount;
  const canShrink = voices.size === 0 && !useStore.getState().transport.isPlaying;
  const applied = channels >= cur || canShrink ? channels : cur;
  shrinkPending = applied !== channels;
  const key = `${applied}|${want.channel}|${want.stereo}`;
  if (o.routeKey === key) return;
  try {
    if (dest.channelCount !== applied) dest.channelCount = applied;
    dest.channelCountMode = 'explicit';
    dest.channelInterpretation = 'discrete';
  } catch { /* a saída não aceita mais canais: fica no estéreo */ }
  try { o.post.disconnect(); } catch { /* ignore */ }
  o.post.connect(o.meter);
  if (o.merger) { try { o.merger.disconnect(); } catch { /* ignore */ } }
  // o divisor antigo fica solto (sem ele, cada troca de saída deixava um nó ligado no grafo)
  if (o.split) { try { o.split.disconnect(); } catch { /* ignore */ } o.split = null; }
  const n = Math.max(2, dest.channelCount);
  const merger = o.ctx.createChannelMerger(n);
  const first = want.channel <= 0 ? 0 : want.channel - 1;
  if (want.channel <= 0 || want.stereo) {
    const split = o.ctx.createChannelSplitter(2);
    o.post.connect(split);
    split.connect(merger, 0, Math.min(first, n - 2));
    split.connect(merger, 1, Math.min(first + 1, n - 1));
    o.split = split;
  } else {
    // mono: esquerda e direita somadas na saída escolhida
    o.post.connect(merger, 0, Math.min(first, n - 1));
  }
  merger.connect(dest);
  o.merger = merger;
  o.routeKey = key;
  o.bus.gain.setTargetAtTime(busGain(), o.ctx.currentTime, 0.01);
}

/**
 * Contexto de áudio dos pads, já na placa das músicas quando dá (sinkId no construtor, Chromium
 * 110+): abrir na padrão e trocar depois com setSinkId reabria a saída logo no começo. Se o
 * construtor não aceitar, abre na padrão e `sink` volta null (openPadOutput troca com setSinkId).
 */
function newPadContext(sink: string): { ctx: AudioContext; sink: string | null } {
  if (sink) {
    try {
      // bloco curto: pad tocado na hora (ver padLatencyHint)
      const ctx = new AudioContext({ latencyHint: padLatencyHint(), sinkId: sink } as AudioContextOptions);
      return { ctx, sink: (ctx as unknown as { sinkId?: unknown }).sinkId === sink ? sink : null };
    } catch { /* placa recusada no construtor: abre na padrão e tenta com setSinkId */ }
  }
  const ctx = new AudioContext({ latencyHint: padLatencyHint() });
  return { ctx, sink: sink ? null : '' };
}

/** Saída dos pads: abre junto com o painel, para o primeiro toque já sair sem espera. */
export function openPadOutput(): PadOut {
  // bloco velho (o motor trocou de modo) e nada tocando: abre de novo com o bloco certo
  retireStaleOutput();
  if (!out || out.ctx.state === 'closed') {
    const hint = padLatencyHint();
    const made = newPadContext(audioEngine.getOutputSinkId());
    const ctx = made.ctx;
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
      meter, merger: null, split: null, routeKey: '', sink: made.sink, hint,
    };
    voices.clear();
    watchStaleHint();
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
  // Saída parada (ou recém-criada) com música tocando: não roda no meio da música (ver
  // resumeWhenStopped). Só o toque num pad cria e roda a saída na hora (triggerPad).
  if (o.ctx.state !== 'running' && useStore.getState().transport.isPlaying) {
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

/**
 * O motor trocou de modo (estável/rápido) depois que a saída dos pads abriu: ela ficou com o bloco
 * antigo. Bloco menor que o do motor encurta a folga das músicas (estalo); por isso fecha e abre
 * de novo, mas só com a música parada e nenhum pad tocando. Devolve se fechou.
 */
function retireStaleOutput(): boolean {
  const o = out;
  if (!o || o.ctx.state === 'closed' || o.hint === padLatencyHint()) return false;
  if (voices.size > 0 || useStore.getState().transport.isPlaying) return false;
  // sem voz, mas a cauda do reverb/delay ainda soa: fechar agora cortaria (mesmo teste de suspendWhenQuiet)
  if (o.ctx.state === 'running') {
    const data = new Float32Array(o.meter.fftSize);
    o.meter.getFloatTimeDomainData(data);
    if (peakOf(data) >= 1e-5) return false;
  }
  if (o.keepAlive) {
    try { o.keepAlive.stop(); } catch { /* já parou */ }
    o.keepAlive.disconnect();
    o.keepAlive = null;
  }
  out = null;
  void o.ctx.close().catch(() => { /* já fechou */ });
  return true;
}

/** Confere o bloco da saída a cada 2 s (ler a chave do motor custa quase nada). */
let staleTimer: ReturnType<typeof setInterval> | null = null;
function watchStaleHint(): void {
  if (staleTimer !== null) return;
  staleTimer = setInterval(() => {
    if (!out || out.ctx.state === 'closed') {
      if (staleTimer !== null) clearInterval(staleTimer);
      staleTimer = null;
      return;
    }
    if (retireStaleOutput()) {
      // aposentou com a música parada: abre já a nova, para o primeiro toque não esperar
      if (showReady) armPads();
      if (getPadsState().visible) warmPadOutput();
      return;
    }
    // redução de canais adiada (route): tenta de novo quando a música e os pads pararem
    if (shrinkPending) route(out);
  }, 2000);
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
function resumeWhenStopped(o: PadOut | null): void {
  if (unsubResume) return;
  const check = () => {
    resumeTimer = null;
    if (useStore.getState().transport.isPlaying) return;
    cancelResumeWhenStopped();
    // a saída nem existia (Modo Show aberto com música tocando): abre agora, com a música parada
    if (!o) { if (showReady) armPads(); return; }
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
  retireStaleOutput();
  // sem saída aberta e com música tocando: criar um AudioContext agora mexe na placa no meio da
  // música (engasgo). Espera a música parar; um toque num pad antes disso cria na hora
  if (!hasPadOutput() && useStore.getState().transport.isPlaying) { resumeWhenStopped(null); return; }
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
  // knob arrastado: o som muda na hora; a tela, uma vez por quadro; o localStorage, no fim
  setPadsStateSoon({ fx });
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

/** Já existe um AudioContext dos pads (aberto, rodando ou parado). */
function hasPadOutput(): boolean {
  return !!out && out.ctx.state !== 'closed';
}

/**
 * O painel de pads apareceu: deixa a saída pronta para o primeiro toque, mas sem criar um
 * AudioContext novo com música tocando (mexe na placa no meio da música). Nesse caso espera a
 * música parar (resumeWhenStopped); um toque num pad antes disso cria na hora.
 */
export function warmPadOutput(): void {
  if (!hasPadOutput() && useStore.getState().transport.isPlaying) { resumeWhenStopped(null); return; }
  openPadOutput();
}

/** Lê os pads guardados e decodifica os sons do banco aberto, sem abrir saída de áudio. */
export function loadPadSounds(): Promise<void> {
  return loadPads().then(() => prepareBank(getPadsState().bank));
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
    // a saída foi trocada (bloco novo): o medidor velho para e o próximo toque liga o da nova
    if ((voices.size === 0 && meterLevel < 0.001) || out !== o) {
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
  const token = slotToken(slot);
  const audio = await loadPadAudio(slot).catch(() => null);
  if (!audio) return null;
  const blob = new Blob([audio.bytes], { type: audio.type });
  // o som do pad mudou durante a leitura (projeto aberto, limpar, importar): não põe o velho de volta
  if (slotToken(slot) !== token) return sources.get(slot) ?? null;
  sources.set(slot, blob);
  memSources.add(slot);
  return blob;
}

// ---------- Memória dos sons decodificados ----------

/**
 * Teto dos sons decodificados (Float32), com as cópias de reverso e corte. Trocar de banco não
 * joga mais os outros fora: voltar a um banco usado já toca sem decodificar de novo. Passou do
 * teto, saem os usados há mais tempo (nunca os do banco aberto nem os que estão tocando).
 */
const BUFFER_BUDGET_BYTES = 200 * 1024 * 1024;

function bytesOf(b: AudioBuffer): number {
  return b.length * b.numberOfChannels * 4;
}

function slotBytes(slot: number): number {
  const b = buffers.get(slot);
  const r = reversed.get(slot);
  const t = trimmed.get(slot);
  return (b ? bytesOf(b) : 0) + (r ? bytesOf(r.buf) : 0) + (t ? bytesOf(t.buf) : 0);
}

/** Marca o som como usado agora (vai para o fim da fila de quem sai primeiro). */
function touchBuffer(slot: number): void {
  const b = buffers.get(slot);
  if (!b) return;
  buffers.delete(slot);
  buffers.set(slot, b);
}

function keepBuffersInBudget(): void {
  let total = 0;
  for (const slot of buffers.keys()) total += slotBytes(slot);
  if (total <= BUFFER_BUDGET_BYTES) return;
  const bank = getPadsState().bank;
  for (const slot of [...buffers.keys()]) {
    if (total <= BUFFER_BUDGET_BYTES) break;
    if (slotBank(slot) === bank || voices.has(slot)) continue;
    total -= slotBytes(slot);
    buffers.delete(slot);
    forgetCopies(slot);
  }
}

// ---------- Fila de decodificação ----------

/**
 * No máximo 2 decodificações ao mesmo tempo, em fila: abrir um banco com 9 sons longos
 * decodificava tudo junto e pesava na máquina (e na tela). Um pad tocado antes de ficar pronto
 * passa para a frente da fila.
 */
const MAX_DECODES = 2;
interface DecodeTask { slot: number; token: string; urgent: boolean; job: Promise<void> | null; done: () => void }
const decodeQueue: DecodeTask[] = [];
let decodesRunning = 0;

function requestDecode(slot: number, urgent = false): Promise<void> {
  // o painel (ao montar) e o keepPadsReady pedem o mesmo banco quase juntos: decodifica uma vez só
  let job = decoding.get(slot);
  if (job) {
    const i = urgent ? decodeQueue.findIndex((t) => t.slot === slot) : -1;
    if (i > 0) {
      const [task] = decodeQueue.splice(i, 1);
      task.urgent = true;
      decodeQueue.unshift(task);
    }
    return job;
  }
  const task: DecodeTask = { slot, token: slotToken(slot), urgent, job: null, done: () => {} };
  job = new Promise<void>((resolve) => { task.done = resolve; });
  task.job = job;
  decoding.set(slot, job);
  if (urgent) decodeQueue.unshift(task);
  else decodeQueue.push(task);
  pumpDecodes();
  return job;
}

function pumpDecodes(): void {
  while (decodesRunning < MAX_DECODES && decodeQueue.length > 0) {
    const task = decodeQueue.shift()!;
    decodesRunning++;
    void runDecode(task).finally(() => {
      decodesRunning--;
      if (decoding.get(task.slot) === task.job) decoding.delete(task.slot);
      task.done();
      pumpDecodes();
    });
  }
}

async function runDecode(task: DecodeTask): Promise<void> {
  const { slot, token } = task;
  const stale = () => slotToken(slot) !== token;
  // trocou de banco antes de chegar a vez: não gasta tempo com o banco que fechou
  if (stale() || buffers.has(slot) || !getPadsState().infos.has(slot)) return;
  if (!task.urgent && slotBank(slot) !== getPadsState().bank) return;
  try {
    const blob = await sourceOf(slot);
    if (!blob || stale()) return;
    const buffer = await decodeBlob(blob);
    // o pad mudou (projeto novo, limpar, importar) durante a decodificação: o som velho não entra
    if (stale()) return;
    buffers.set(slot, buffer);
    keepBuffersInBudget();
    prepareCopiesSoon(slot);
  } catch { /* o pad fica sem som até carregar de novo */ }
}

/** Decodifica os sons do banco (os de outros bancos ficam na memória até o teto, ver keepBuffersInBudget). */
export async function prepareBank(bank: number): Promise<void> {
  // os arquivos dos bancos fechados saem da memória quando estão guardados no computador
  // (sourceOf lê de novo); os pedaços do projeto aberto ficam (estão no disco, não na memória)
  for (const slot of [...memSources]) {
    if (slotBank(slot) !== bank && !voices.has(slot)) {
      sources.delete(slot);
      memSources.delete(slot);
    }
  }
  const { infos } = getPadsState();
  const jobs: Promise<void>[] = [];
  for (let p = 0; p < PAD_COUNT; p++) {
    const slot = padSlot(bank, p);
    if (!infos.has(slot)) continue;
    if (buffers.has(slot)) { touchBuffer(slot); prepareCopiesSoon(slot); continue; }
    jobs.push(requestDecode(slot));
  }
  keepBuffersInBudget();
  await Promise.all(jobs);
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

/**
 * Prepara na folga da tela a cópia que o pad vai tocar (trecho cortado e, no reverso, de trás para
 * frente). Antes ela era feita no toque: um som de 3 minutos invertido na hora atrasava o toque e
 * travava a tela. Sem reverso nem corte não há cópia: não faz nada.
 */
const copyJobs = new Set<number>();
function prepareCopiesSoon(slot: number): void {
  const info = getPadsState().infos.get(slot);
  if (!info || copyJobs.has(slot) || (!info.reverse && info.trimStart === undefined && info.trimEnd === undefined)) return;
  copyJobs.add(slot);
  afterPaint(() => {
    copyJobs.delete(slot);
    const now = getPadsState().infos.get(slot);
    const buffer = buffers.get(slot);
    if (!now || !buffer) return;
    playableBuffer(slot, now, buffer);
    keepBuffersInBudget();
  }, 1000);
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
  // som ainda não decodificado: continua mudo como antes, mas passa para a frente da fila
  if (info && !buffer) void requestDecode(slot, true);
  if (!info || !buffer) return;
  touchBuffer(slot);
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
    // a voz acabou: solta do grafo (os rabos de reverb e delay já estão nos efeitos e continuam)
    try { gain.disconnect(); } catch { /* já solta */ }
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
  // fader arrastado: o som muda na hora; a tela, uma vez por quadro; o localStorage, no fim
  setPadsStateSoon({ master: volume });
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

/** Gravações do ajuste do pad esperando o fim do arraste (uma por pad). */
const saveTimers = new Map<number, ReturnType<typeof setTimeout>>();

function savePadNow(slot: number): Promise<void> {
  const t = saveTimers.get(slot);
  if (t !== undefined) clearTimeout(t);
  saveTimers.delete(slot);
  // grava o que o pad tem agora (já com tudo que mudou no arraste); pad limpo não volta
  const info = getPadsState().infos.get(slot);
  if (!info) return Promise.resolve();
  // o espelho do projeto ainda não chegou a este pad: o registro guardado é do som anterior, e a
  // info nova por cima dele trocaria o som na próxima abertura. O espelho grava a info mais nova
  if (mirrorPending.has(slot)) return Promise.resolve();
  return savePadInfo(info).catch(() => say(false, 'Não deu para guardar a mudança do pad.'));
}

/** Soltou o knob ou o pitch: grava já o ajuste que estava esperando o fim do arraste. */
export function flushPadSave(slot: number): void {
  if (saveTimers.has(slot)) void savePadNow(slot);
}

/**
 * Muda um ajuste do pad; volume, pitch, loop e efeitos valem na hora para o som que está tocando.
 * `live` (arraste do knob ou do pitch): o som muda na hora, a tela é avisada uma vez por quadro e
 * o computador grava só 400 ms depois do último movimento (ou ao soltar, flushPadSave).
 */
export async function updatePad(slot: number, patch: Partial<Omit<PadInfo, 'slot'>>, live = false): Promise<void> {
  const cur = getPadsState().infos.get(slot);
  if (!cur) return;
  const next = { ...cur, ...patch };
  const infos = new Map(getPadsState().infos);
  infos.set(slot, next);
  if (live) setPadsStateSoon({ infos });
  else setPadsState({ infos });
  // reverso ligado ou corte mudado: a cópia que vai tocar já fica pronta antes do toque
  if (patch.reverse || 'trimStart' in patch || 'trimEnd' in patch) prepareCopiesSoon(slot);
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
  if (live) {
    const t = saveTimers.get(slot);
    if (t !== undefined) clearTimeout(t);
    saveTimers.set(slot, setTimeout(() => { void savePadNow(slot); }, 400));
    return;
  }
  await savePadNow(slot);
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
  // pela fila (na frente): uma decodificação daqui não grava som velho se o pad mudar no meio
  if (!buffers.has(slot)) await requestDecode(slot, true);
  const buffer = buffers.get(slot);
  if (!buffer) return false;
  const ch = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
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
    // som novo no pad: leitura ou decodificação do som anterior ainda em andamento não grava por cima
    bumpSlot(slot);
    sources.set(slot, new Blob([bytes], { type }));
    memSources.add(slot);
    buffers.set(slot, buffer);
    forgetCopies(slot);
    const infos = new Map(getPadsState().infos);
    infos.set(slot, info);
    setPadsState({ infos });
    keepBuffersInBudget();
    prepareCopiesSoon(slot);
    return true;
  } finally {
    setPadsState({ loading: withItem(getPadsState().loading, slot, false) });
  }
}

export async function clearPad(slot: number): Promise<void> {
  release(slot);
  // leitura ou decodificação em andamento deste pad não traz o som de volta
  bumpSlot(slot);
  const t = saveTimers.get(slot);
  if (t !== undefined) clearTimeout(t);
  saveTimers.delete(slot);
  buffers.delete(slot);
  forgetCopies(slot);
  sources.delete(slot);
  memSources.delete(slot);
  const infos = new Map(getPadsState().infos);
  infos.delete(slot);
  setPadsState({ infos });
  await deletePad(slot).catch(() => say(false, 'Não deu para apagar o som guardado.'));
}

// ---------- No projeto ----------

/** Projeto aberto com pads: eles entram no lugar dos atuais (e viram a cópia do computador). */
async function applyProjectPads(saved: SavedPads, files: Map<string, Blob>): Promise<void> {
  stopAllPads();
  // pads novos: toda leitura, decodificação e cópia no computador que começou antes fica sem valor
  epoch++;
  decoding.clear();
  for (const t of saveTimers.values()) clearTimeout(t);
  saveTimers.clear();
  sources.clear();
  memSources.clear();
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
  // até o espelho gravar cada um, ajuste nesses pads não grava por cima do registro antigo
  mirrorPending.clear();
  for (const slot of infos.keys()) mirrorPending.add(slot);
  const mine = epoch;
  await prepareBank(bank);
  if (epoch !== mine) return;
  await mirrorProjectPads(mine);
}

/** Mesmo pad e mesmo som (nome, tipo, tamanho do arquivo e duração iguais aos guardados). */
function sameStoredAudio(rec: { info: PadInfo; size?: number }, info: PadInfo, size: number): boolean {
  return rec.size === size && rec.info.name === info.name && (rec.info.type ?? '') === (info.type ?? '')
    && Math.abs((rec.info.duration ?? 0) - info.duration) < 1e-3;
}

function samePadInfo(a: PadInfo, b: PadInfo): boolean {
  const x = a as unknown as Record<string, unknown>;
  const y = b as unknown as Record<string, unknown>;
  for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) if (x[k] !== y[k]) return false;
  return true;
}

/** Vez de gravar no computador: com a música parada e na folga da tela. */
function quietTurn(): Promise<void> {
  return new Promise((resolve) => {
    const go = () => { afterPaint(resolve, 1000); };
    if (!useStore.getState().transport.isPlaying) { go(); return; }
    const unsub = useStore.subscribe((s) => {
      if (s.transport.isPlaying) return;
      unsub();
      go();
    });
  });
}

/**
 * Cópia no computador dos pads do projeto aberto, para eles continuarem se o programa abrir sem
 * projeto. Antes apagava tudo e regravava cada som de uma vez (centenas de MB lidos e gravados
 * logo ao abrir, até com música tocando). Agora: som igual ao guardado não é regravado, cada pad
 * vai um por vez, na folga da tela, e só com a música parada. Abrir outro projeto no meio para esta.
 */
async function mirrorProjectPads(mine: number): Promise<void> {
  let stored: Array<{ info: PadInfo; size?: number }>;
  // sem espelho, os ajustes voltam a gravar direto (como antes de abrir o projeto)
  try { stored = await loadPadRecords(); } catch { if (epoch === mine) mirrorPending.clear(); return; }
  const have = new Map(stored.map((r) => [r.info.slot, r]));
  const slots = new Set([...have.keys(), ...getPadsState().infos.keys()]);
  // pad mudado pelo operador depois de abrir (importar, limpar) já gravou sozinho: fica como está
  const startTokens = new Map([...slots].map((s) => [s, slotToken(s)]));
  for (const slot of slots) {
    await quietTurn();
    if (epoch !== mine) return;
    if (slotToken(slot) !== startTokens.get(slot)) continue;
    // o ajuste mais novo do pad (o operador pode ter mexido no volume enquanto esperava)
    const info = getPadsState().infos.get(slot);
    const rec = have.get(slot);
    try {
      if (!info) {
        if (rec) await deletePad(slot);
        continue;
      }
      const blob = sources.get(slot);
      if (!blob) continue;
      const type = info.type ?? (blob.type || 'audio/wav');
      let wrote = info;
      if (rec && sameStoredAudio(rec, info, blob.size)) {
        if (!samePadInfo(normalizePadInfo(rec.info), info)) await savePadInfo(info);
      } else {
        const bytes = await blob.arrayBuffer();
        if (epoch !== mine) return;
        if (slotToken(slot) !== startTokens.get(slot)) continue;
        wrote = getPadsState().infos.get(slot) ?? info;
        await savePad(wrote, type, bytes);
      }
      if (epoch !== mine) return;
      // ajuste feito durante a gravação ficou de fora (savePadNow não grava pendente): grava o mais novo
      const now = getPadsState().infos.get(slot);
      if (now && now !== wrote && slotToken(slot) === startTokens.get(slot)) {
        mirrorPending.delete(slot);
        await savePadInfo(now);
      }
    } catch {
      // a cópia é só conveniência: o projeto continua com os pads; ajustes voltam a gravar direto
      if (epoch === mine) mirrorPending.clear();
      return;
    } finally {
      // gravou ou pulou: a partir daqui os ajustes deste pad gravam sozinhos
      if (epoch === mine) mirrorPending.delete(slot);
    }
  }
  if (epoch === mine) mirrorPending.clear();
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
      if (blob) {
        sources.set(slot, blob);
        // agora é um pedaço do arquivo salvo (no disco): não precisa mais sair da memória
        memSources.delete(slot);
      }
    }
  },
});

// as informações dos pads guardados entram já na abertura: o salvar do projeto leva os pads
// mesmo que o Modo Show ainda não tenha sido aberto
void loadPads();
