// Toca os pads do Modo Show. O som sai pelo master do programa (fader geral, limitador e as
// mesmas saídas das músicas), passando pelo volume geral dos pads e pelo volume de cada pad.
// Apertar um pad que está tocando: sem loop, recomeça do início; com loop, para.

import { audioEngine } from '@/lib/audioEngine';
import { decodeBlob } from '@/lib/audioDecoder';
import { faderToGain } from '@/lib/faderScale';
import { deletePad, loadPadAudio, loadPadInfos, savePad, savePadInfo } from '@/lib/padStorage';
import {
  MAX_PAD_SECONDS, PAD_COUNT, getPadsState, newPadInfo, padFileProblem, padSlot, setPadsState, slotBank, withItem,
  type PadInfo,
} from '@/lib/samplePads';

const buffers = new Map<number, AudioBuffer>();
const voices = new Map<number, { src: AudioBufferSourceNode; gain: GainNode }>();
let bus: { ctx: AudioContext; gain: GainNode } | null = null;
let loaded: Promise<void> | null = null;

/** Saída dos pads; refeita se o motor de áudio trocar de contexto (Modo estável liga/desliga). */
function padBus(): { ctx: AudioContext; gain: GainNode } {
  const ctx = audioEngine.getContext();
  if (!bus || bus.ctx !== ctx) {
    const gain = ctx.createGain();
    gain.gain.value = faderToGain(getPadsState().master);
    gain.connect(audioEngine.getMasterInput());
    bus = { ctx, gain };
    voices.clear();
  }
  return bus;
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
  void ctx.resume();
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
  if (bus) bus.gain.gain.setTargetAtTime(faderToGain(volume), bus.ctx.currentTime, 0.01);
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
