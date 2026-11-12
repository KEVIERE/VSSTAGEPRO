// Toca os pads do Modo Show. Atraso mínimo: os pads têm o próprio contexto de áudio, com o menor
// bloco que o Mac aceita, na mesma placa de saída das músicas (saídas 1-2). O motor das músicas
// usa blocos grandes de propósito (modo estável, para não estalar no show) e o limitador do
// master olha o som alguns milissegundos antes de soltar: pelo caminho dele o pad saía atrasado.
// O volume segue o fader master do programa, o volume geral dos pads e o de cada pad.
// Apertar um pad que está tocando: sem loop, recomeça do início; com loop, para.

import { audioEngine } from '@/lib/audioEngine';
import { decodeBlob } from '@/lib/audioDecoder';
import { faderToGain } from '@/lib/faderScale';
import { useStore } from '@/store';
import { deletePad, loadPadAudio, loadPadInfos, savePad, savePadInfo } from '@/lib/padStorage';
import {
  MAX_PAD_SECONDS, PAD_COUNT, getPadsState, newPadInfo, padFileProblem, padSlot, setPadsState, slotBank, withItem,
  type PadInfo,
} from '@/lib/samplePads';

const buffers = new Map<number, AudioBuffer>();
const voices = new Map<number, { src: AudioBufferSourceNode; gain: GainNode }>();
let bus: { ctx: AudioContext; gain: GainNode; sink: string | null } | null = null;
let loaded: Promise<void> | null = null;

/** Volume da saída dos pads: fader master do programa × volume geral dos pads. */
function busGain(): number {
  return faderToGain(useStore.getState().masterVolume) * faderToGain(getPadsState().master);
}

/**
 * Saída dos pads: contexto próprio com o menor atraso possível (latencyHint 0), na placa em uso.
 * Abre quando o painel dos pads abre, para o primeiro toque já sair sem espera.
 */
export function openPadOutput(): { ctx: AudioContext; gain: GainNode } {
  if (!bus || bus.ctx.state === 'closed') {
    const ctx = new AudioContext({ latencyHint: 0 });
    const gain = ctx.createGain();
    gain.gain.value = busGain();
    gain.connect(ctx.destination);
    bus = { ctx, gain, sink: null };
    voices.clear();
  }
  const sink = audioEngine.getOutputSinkId();
  if (bus.sink !== sink && 'setSinkId' in bus.ctx) {
    bus.sink = sink;
    const ctx = bus.ctx;
    void (ctx as unknown as { setSinkId: (id: string) => Promise<void> }).setSinkId(sink)
      .catch(() => { /* placa indisponível: fica na saída padrão */ })
      .finally(() => reportLatency(ctx));
  }
  // o atraso da saída (placa e sistema) só aparece depois que o som começa a correr
  const ctx = bus.ctx;
  void ctx.resume().then(() => {
    reportLatency(ctx);
    setTimeout(() => reportLatency(ctx), 500);
  });
  return bus;
}

function reportLatency(ctx: AudioContext) {
  const out = (ctx as AudioContext & { outputLatency?: number }).outputLatency ?? 0;
  const ms = Math.round((ctx.baseLatency + out) * 10000) / 10;
  if (ms !== getPadsState().latencyMs) setPadsState({ latencyMs: ms });
}

// o fader master do programa vale também para os pads
useStore.subscribe((s, prev) => {
  if (s.masterVolume === prev.masterVolume || !bus) return;
  bus.gain.gain.setTargetAtTime(busGain(), bus.ctx.currentTime, 0.01);
});

function padBus(): { ctx: AudioContext; gain: GainNode } {
  return bus && bus.ctx.state !== 'closed' && bus.sink === audioEngine.getOutputSinkId() ? bus : openPadOutput();
}

function say(ok: boolean, text: string) {
  setPadsState({ message: { ok, text } });
}

/** Lê as informações dos 90 lugares (uma vez) e prepara os sons do banco aberto. */
export function loadPads(): Promise<void> {
  if (!loaded) {
    loaded = loadPadInfos()
      .then((list) => {
        setPadsState({ infos: new Map(list.map((i) => [i.slot, i])) });
        return prepareBank(getPadsState().bank);
      })
      .catch(() => { say(false, 'Não consegui ler os sons guardados dos pads.'); });
  }
  return loaded;
}

/** Decodifica os sons do banco (os de outros bancos saem da memória, menos os que estão tocando). */
export async function prepareBank(bank: number): Promise<void> {
  for (const slot of [...buffers.keys()]) {
    if (slotBank(slot) !== bank && !voices.has(slot)) buffers.delete(slot);
  }
  const { infos } = getPadsState();
  await Promise.all(Array.from({ length: PAD_COUNT }, async (_, p) => {
    const slot = padSlot(bank, p);
    if (!infos.has(slot) || buffers.has(slot)) return;
    try {
      const audio = await loadPadAudio(slot);
      if (audio) buffers.set(slot, await decodeBlob(new Blob([audio.bytes], { type: audio.type })));
    } catch { /* o pad fica sem som até carregar de novo */ }
  }));
}

export async function selectBank(bank: number): Promise<void> {
  setPadsState({ bank });
  await prepareBank(bank);
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
  setPadsState({ playing: withItem(getPadsState().playing, slot, false) });
}

/** Aperta o pad. */
export function triggerPad(slot: number): void {
  const info = getPadsState().infos.get(slot);
  const buffer = buffers.get(slot);
  if (!info || !buffer) return;
  if (voices.has(slot)) {
    release(slot);
    if (info.loop) return; // loop: apertar de novo para
  }
  const { ctx, gain: out } = padBus();
  if (ctx.state !== 'running') void ctx.resume();
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.loop = info.loop;
  const gain = ctx.createGain();
  gain.gain.value = faderToGain(info.volume);
  src.connect(gain);
  gain.connect(out);
  src.onended = () => {
    if (voices.get(slot)?.src !== src) return;
    voices.delete(slot);
    setPadsState({ playing: withItem(getPadsState().playing, slot, false) });
  };
  src.start();
  voices.set(slot, { src, gain });
  setPadsState({ playing: withItem(getPadsState().playing, slot, true) });
}

export function stopAllPads(): void {
  for (const slot of [...voices.keys()]) release(slot, 0.04);
}

export function setPadsMaster(volume: number): void {
  setPadsState({ master: volume });
  if (bus) bus.gain.gain.setTargetAtTime(busGain(), bus.ctx.currentTime, 0.01);
}

/** Muda nome, cor, volume ou loop do pad (o volume vale na hora para o som que está tocando). */
export async function updatePad(slot: number, patch: Partial<Omit<PadInfo, 'slot'>>): Promise<void> {
  const cur = getPadsState().infos.get(slot);
  if (!cur) return;
  const next = { ...cur, ...patch };
  const infos = new Map(getPadsState().infos);
  infos.set(slot, next);
  setPadsState({ infos });
  const v = voices.get(slot);
  if (v && patch.volume !== undefined) v.gain.gain.setTargetAtTime(faderToGain(patch.volume), v.gain.context.currentTime, 0.01);
  if (v && patch.loop !== undefined) v.src.loop = patch.loop;
  await savePadInfo(next).catch(() => say(false, 'Não deu para guardar a mudança do pad.'));
}

/** Põe o arquivo no pad: confere, decodifica, guarda e deixa pronto para tocar. */
export async function importPadFile(slot: number, file: File): Promise<boolean> {
  const problem = padFileProblem(file);
  if (problem) { say(false, `${file.name}: ${problem}.`); return false; }
  setPadsState({ loading: withItem(getPadsState().loading, slot, true), message: null });
  try {
    const bytes = await file.arrayBuffer();
    let buffer: AudioBuffer;
    try {
      buffer = await decodeBlob(new Blob([bytes], { type: file.type }));
    } catch {
      say(false, `${file.name}: não consegui abrir esse áudio.`);
      return false;
    }
    if (buffer.duration > MAX_PAD_SECONDS) {
      say(false, `${file.name}: o pad aceita sons de até 3 minutos.`);
      return false;
    }
    const old = getPadsState().infos.get(slot);
    const info = { ...newPadInfo(slot, file.name, buffer.duration), ...(old ? { color: old.color, volume: old.volume, loop: old.loop } : {}) };
    release(slot);
    try {
      await savePad(info, file.type || 'audio/wav', bytes);
    } catch {
      say(false, 'Não deu para guardar o som neste computador.');
      return false;
    }
    buffers.set(slot, buffer);
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
  const infos = new Map(getPadsState().infos);
  infos.delete(slot);
  setPadsState({ infos });
  await deletePad(slot).catch(() => say(false, 'Não deu para apagar o som guardado.'));
}
