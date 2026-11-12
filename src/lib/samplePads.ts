// Pads do Modo Show: 9 pads (teclas 1 a 9) em 10 bancos (A a J), 90 sons no total. O usuário
// põe os WAV ou MP3 dele e toca ao vivo. Aqui ficam as regras e o estado da tela; o som sai
// por padPlayer e os arquivos ficam guardados por padStorage. Sem áudio, para dar para testar.

export const PAD_COUNT = 9;
export const BANK_COUNT = 10;
export const BANK_LABELS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
/** Som mais longo que isso não entra (cada som fica inteiro na memória para tocar na hora). */
export const MAX_PAD_SECONDS = 180;
/** Arquivo maior que isso não entra. */
export const MAX_PAD_BYTES = 60 * 1024 * 1024;

/** Cor de cada pad da grade, na ordem 1 a 9. */
export const PAD_COLORS = ['#ff6b5b', '#ffab1f', '#ffd83d', '#3ee26e', '#2ed8c3', '#5aaaff', '#8b7bff', '#e46bff', '#ff7aa8'];

export interface PadInfo {
  /** Lugar do som: banco × 9 + pad (0 a 89). */
  slot: number;
  name: string;
  color: string;
  /** Volume no padrão dos faders (0,8 = 0 dB). */
  volume: number;
  /** Repete até apertar de novo. */
  loop: boolean;
  /** Segundos. */
  duration: number;
}

export function padSlot(bank: number, pad: number): number {
  return bank * PAD_COUNT + pad;
}

export function slotBank(slot: number): number {
  return Math.floor(slot / PAD_COUNT);
}

export function slotPad(slot: number): number {
  return slot % PAD_COUNT;
}

/** Tecla 1 a 9 → pad 0 a 8 (outra tecla: null). */
export function padForKey(key: string): number | null {
  return /^[1-9]$/.test(key) ? Number(key) - 1 : null;
}

const AUDIO_EXT = /\.(wav|wave|mp3|aif|aiff|m4a|aac|flac|ogg)$/i;

/** O que impede o arquivo de entrar num pad (ou null se pode). */
export function padFileProblem(file: { name: string; type?: string; size: number }): string | null {
  const isAudio = (file.type ?? '').startsWith('audio/') || AUDIO_EXT.test(file.name);
  if (!isAudio) return 'use um arquivo de áudio (WAV, MP3, AIFF ou M4A)';
  if (file.size > MAX_PAD_BYTES) return 'arquivo grande demais para um pad (máximo 60 MB)';
  if (file.size === 0) return 'o arquivo está vazio';
  return null;
}

/** Nome do pad a partir do arquivo: sem a extensão e no máximo 28 letras. */
export function padNameFromFile(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim();
  return (base || 'Som').slice(0, 28);
}

export function newPadInfo(slot: number, fileName: string, duration: number): PadInfo {
  return { slot, name: padNameFromFile(fileName), color: PAD_COLORS[slotPad(slot)], volume: 0.8, loop: false, duration };
}

/** "0:07" ou "1:32". */
export function formatPadTime(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Para soltar vários arquivos de uma vez: o primeiro vai no pad onde soltou e os outros nos
 * pads vazios seguintes do mesmo banco. Devolve os lugares, na ordem dos arquivos (só os que
 * couberem).
 */
export function dropTargets(bank: number, pad: number, count: number, used: Set<number>): number[] {
  const out = [padSlot(bank, pad)];
  for (let p = pad + 1; p < PAD_COUNT && out.length < count; p++) {
    const slot = padSlot(bank, p);
    if (!used.has(slot)) out.push(slot);
  }
  return out.slice(0, count);
}

// ---------- Estado da tela ----------

export interface PadsState {
  /** O painel dos pads está aberto. */
  visible: boolean;
  bank: number;
  infos: Map<number, PadInfo>;
  /** Pads tocando agora. */
  playing: Set<number>;
  /** Pads carregando um arquivo. */
  loading: Set<number>;
  /** Volume geral dos pads (padrão dos faders). */
  master: number;
  message: { ok: boolean; text: string } | null;
  /** Atraso medido da saída dos pads, em milissegundos (null antes de abrir a saída). */
  latencyMs: number | null;
}

const BANK_KEY = 'vsstage.pads.bank';
const MASTER_KEY = 'vsstage.pads.master';

function stored(key: string, fallback: number, ok: (v: number) => boolean): number {
  try {
    const v = Number(globalThis.localStorage?.getItem(key));
    return globalThis.localStorage?.getItem(key) !== null && ok(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

let state: PadsState = {
  visible: false,
  bank: stored(BANK_KEY, 0, (v) => Number.isInteger(v) && v >= 0 && v < BANK_COUNT),
  infos: new Map(),
  playing: new Set(),
  loading: new Set(),
  master: stored(MASTER_KEY, 0.8, (v) => v >= 0 && v <= 1.5),
  message: null,
  latencyMs: null,
};
const listeners = new Set<() => void>();

export function getPadsState(): PadsState {
  return state;
}

export function subscribePads(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function setPadsState(patch: Partial<PadsState>): void {
  state = { ...state, ...patch };
  if (patch.bank !== undefined) {
    try { globalThis.localStorage?.setItem(BANK_KEY, String(patch.bank)); } catch { /* só não lembra */ }
  }
  if (patch.master !== undefined) {
    try { globalThis.localStorage?.setItem(MASTER_KEY, String(patch.master)); } catch { /* só não lembra */ }
  }
  listeners.forEach((l) => l());
}

export function togglePadsPanel(): void {
  setPadsState({ visible: !state.visible });
}

/** Troca um item do Set sem mexer no original (o React só redesenha com Set novo). */
export function withItem(set: Set<number>, slot: number, on: boolean): Set<number> {
  const next = new Set(set);
  if (on) next.add(slot);
  else next.delete(slot);
  return next;
}

/** Quantos sons cada banco tem (o botão do banco acende quando tem som). */
export function bankCounts(infos: Map<number, PadInfo>): number[] {
  const counts = Array.from({ length: BANK_COUNT }, () => 0);
  infos.forEach((_, slot) => { counts[slotBank(slot)]++; });
  return counts;
}
