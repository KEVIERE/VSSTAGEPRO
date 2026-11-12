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
  FADE_SECONDS, HOLD_RELEASE_SECONDS, MAX_PAD_SECONDS, PAD_COUNT, chokedBy, delaySeconds, holdStopTime, getPadsState, makeReverbImpulse, newPadInfo, normalizePadInfo,
  padAssetId, padAssetPath, padFileProblem, padSlot, pitchRate, savedPadsOf, setPadsState, slotBank, slotPad,
  usablePadOutput, withItem, withPlaying, type PadInfo, type PadOutput, type SavedPads,
} from '@/lib/samplePads';
import { useStore } from '@/store';

/** O arquivo de cada pad (do computador, do projeto aberto ou do arquivo importado). */
const sources = new Map<number, Blob>();
const buffers = new Map<number, AudioBuffer>();
const reversed = new Map<number, AudioBuffer>();
interface Voice { src: AudioBufferSourceNode; gain: GainNode; reverb: boolean; delay: boolean; startedAt: number }
const voices = new Map<number, Voice>();
let loaded: Promise<void> | null = null;

interface PadOut {
  ctx: AudioContext;
  /** Soma dos pads (volume geral × fader master quando sai no Master). */
  bus: GainNode;
  reverbSend: GainNode;
  delaySend: GainNode;
  delay: DelayNode;
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
  try { o.bus.disconnect(); } catch { /* ignore */ }
  o.bus.connect(o.meter);
  if (o.merger) { try { o.merger.disconnect(); } catch { /* ignore */ } }
  const n = Math.max(2, dest.channelCount);
  const merger = o.ctx.createChannelMerger(n);
  const first = want.channel <= 0 ? 0 : want.channel - 1;
  if (want.channel <= 0 || want.stereo) {
    const split = o.ctx.createChannelSplitter(2);
    o.bus.connect(split);
    split.connect(merger, 0, Math.min(first, n - 2));
    split.connect(merger, 1, Math.min(first + 1, n - 1));
  } else {
    // mono: esquerda e direita somadas na saída escolhida
    o.bus.connect(merger, 0, Math.min(first, n - 1));
  }
  merger.connect(dest);
  o.merger = merger;
  o.routeKey = key;
  o.bus.gain.setTargetAtTime(busGain(), o.ctx.currentTime, 0.01);
}

/** Saída dos pads: abre junto com o painel, para o primeiro toque já sair sem espera. */
export function openPadOutput(): PadOut {
  if (!out || out.ctx.state === 'closed') {
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
    const reverbWet = ctx.createGain();
    reverbWet.gain.value = 0.5;
    reverbSend.connect(convolver).connect(reverbWet).connect(bus);
    // delay: uma semínima no BPM da música, repetindo e escurecendo
    const delaySend = ctx.createGain();
    const delay = ctx.createDelay(2);
    delay.delayTime.value = delaySeconds(songBpm());
    const feedback = ctx.createGain();
    feedback.gain.value = 0.38;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 4200;
    const delayWet = ctx.createGain();
    delayWet.gain.value = 0.45;
    delaySend.connect(delay);
    delay.connect(tone);
    tone.connect(feedback).connect(delay);
    tone.connect(delayWet).connect(bus);
    const meter = ctx.createAnalyser();
    meter.fftSize = 2048;
    bus.connect(meter);
    out = { ctx, bus, reverbSend, delaySend, delay, meter, merger: null, routeKey: '', sink: null };
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
      reversed.delete(slot);
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
  if (have) return have;
  const rev = new AudioBuffer({ length: buffer.length, numberOfChannels: buffer.numberOfChannels, sampleRate: buffer.sampleRate });
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const src = buffer.getChannelData(c);
    const dst = rev.getChannelData(c);
    for (let i = 0, j = src.length - 1; i < src.length; i++, j--) dst[i] = src[j];
  }
  reversed.set(slot, rev);
  return rev;
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
    if (info.loop && !info.hold) return;
  }
  // um por vez: o pad novo para os outros (com uma descida curta, sem estalo)
  for (const other of chokedBy(slot, voices.keys(), getPadsState().choke)) release(other, 0.03);
  const o = padOut();
  if (o.ctx.state !== 'running') void o.ctx.resume();
  const src = o.ctx.createBufferSource();
  src.buffer = info.reverse ? reversedBuffer(slot, buffer) : buffer;
  src.loop = info.loop;
  src.playbackRate.value = pitchRate(info.pitch);
  const gain = o.ctx.createGain();
  gain.gain.value = faderToGain(info.volume);
  src.connect(gain);
  gain.connect(o.bus);
  const voice: Voice = { src, gain, reverb: false, delay: false, startedAt: o.ctx.currentTime };
  connectSends(voice, o, info.reverb, info.delay);
  src.onended = () => {
    if (voices.get(slot)?.src !== src) return;
    voices.delete(slot);
    setPadsState({ playing: withPlaying(getPadsState().playing, slot, null) });
  };
  src.start();
  voices.set(slot, voice);
  setPadsState({ playing: withPlaying(getPadsState().playing, slot, o.ctx.currentTime) });
  runMeter();
}

/**
 * Soltou o pad (mouse ou tecla). Só vale no modo segurar: o som para ao soltar, mas toca pelo
 * menos 1 segundo (apertou e soltou rápido = 1 segundo). Continua aceso até parar de verdade.
 */
export function releasePad(slot: number): void {
  const info = getPadsState().infos.get(slot);
  const v = voices.get(slot);
  if (!info?.hold || !v) return;
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
    if (patch.pitch !== undefined) v.src.playbackRate.setTargetAtTime(pitchRate(patch.pitch), t, 0.01);
    if (patch.loop !== undefined) v.src.loop = patch.loop;
    if ((patch.reverb !== undefined || patch.delay !== undefined) && out) connectSends(v, out, next.reverb, next.delay);
  }
  await savePadInfo(next).catch(() => say(false, 'Não deu para guardar a mudança do pad.'));
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
      ? { color: old.color, volume: old.volume, loop: old.loop, pitch: old.pitch, reverb: old.reverb, delay: old.delay, reverse: old.reverse, hold: old.hold }
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
    reversed.delete(slot);
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
  reversed.delete(slot);
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
    output: saved.output ?? getPadsState().output, choke: saved.choke ?? getPadsState().choke, playing: new Map(),
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
