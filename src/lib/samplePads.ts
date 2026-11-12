// Pads do Modo Show: 9 pads (teclas 1 a 9) em 10 bancos (A a J), 90 sons no total. O usuário
// põe os WAV ou MP3 dele e toca ao vivo. Cada pad tem volume, pitch, reverb, delay, ao contrário
// e loop; os pads saem na saída da placa que o usuário escolher. Aqui ficam as regras e o estado
// da tela; o som sai por padPlayer, os arquivos ficam no computador (padStorage) e no projeto
// (padProject). Sem áudio, para dar para testar.

export const PAD_COUNT = 9;
export const BANK_COUNT = 10;
export const BANK_LABELS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
/** Som mais longo que isso não entra (cada som fica inteiro na memória para tocar na hora). */
export const MAX_PAD_SECONDS = 180;
/** Arquivo maior que isso não entra. */
export const MAX_PAD_BYTES = 60 * 1024 * 1024;
/** Pitch de cada pad, em semitons. */
export const PITCH_RANGE = 12;
/** Fade do botão Fade, em segundos. */
export const FADE_SECONDS = 2;

/** Cor de cada pad da grade, na ordem 1 a 9. */
export const PAD_COLORS = ['#ff4b4b', '#ff9a2e', '#ffd23f', '#3ee26e', '#2ed8c3', '#38b6ff', '#6f7dff', '#c86bff', '#ff6bb0'];

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
  /** Semitons, de -12 a +12 (muda a velocidade junto, como um sampler). */
  pitch: number;
  reverb: boolean;
  delay: boolean;
  /** Toca de trás para frente. */
  reverse: boolean;
  /** Tipo do arquivo (audio/wav, audio/mpeg...), para guardar e salvar no projeto. */
  type?: string;
}

/** Para onde os pads saem: 0 = Master (saídas 1-2, seguindo o fader master); N = saída N da placa. */
export interface PadOutput {
  channel: number;
  stereo: boolean;
}

export const MASTER_OUTPUT: PadOutput = { channel: 0, stereo: true };

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
  return {
    slot, name: padNameFromFile(fileName), color: PAD_COLORS[slotPad(slot)], volume: 0.8, loop: false, duration,
    pitch: 0, reverb: false, delay: false, reverse: false,
  };
}

/** Pad guardado por uma versão antiga (sem pitch e efeitos): completa com os padrões. */
export function normalizePadInfo(v: Partial<PadInfo> & { slot: number }): PadInfo {
  return {
    name: 'Som', color: PAD_COLORS[slotPad(v.slot)], volume: 0.8, loop: false, duration: 0,
    pitch: 0, reverb: false, delay: false, reverse: false,
    ...v,
  };
}

/** "0:07" ou "1:32". */
export function formatPadTime(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Pitch para o visor: "0", "+3", "-12". */
export function pitchLabel(semitones: number): string {
  const s = Math.round(semitones);
  return s > 0 ? `+${s}` : String(s);
}

export function clampPitch(semitones: number): number {
  return Math.max(-PITCH_RANGE, Math.min(PITCH_RANGE, Math.round(semitones)));
}

/** Velocidade de reprodução para o pitch (12 semitons = dobro). */
export function pitchRate(semitones: number): number {
  return Math.pow(2, clampPitch(semitones) / 12);
}

/** Tempo que o som leva com o pitch (mais agudo = mais rápido). */
export function pitchedDuration(info: Pick<PadInfo, 'duration' | 'pitch'>): number {
  return info.duration / pitchRate(info.pitch);
}

/** Nome da saída: "Master", "Saída 3/4", "Saída 5". */
export function padOutputLabel(out: PadOutput): string {
  if (out.channel <= 0) return 'Master';
  return out.stereo ? `Saída ${out.channel}/${out.channel + 1}` : `Saída ${out.channel}`;
}

/** Saídas que a placa tem: Master, os pares estéreo (3/4, 5/6...) e as saídas mono. */
export function padOutputOptions(count: number, stereo: boolean): PadOutput[] {
  const n = Math.max(2, count);
  if (stereo) {
    const pairs: PadOutput[] = [MASTER_OUTPUT];
    for (let c = 1; c + 1 <= n; c += 2) pairs.push({ channel: c, stereo: true });
    return pairs;
  }
  return [MASTER_OUTPUT, ...Array.from({ length: n }, (_, i) => ({ channel: i + 1, stereo: false }))];
}

/** A saída escolhida ainda existe nesta placa? Se não, os pads voltam para o Master. */
export function usablePadOutput(out: PadOutput, count: number): PadOutput {
  const last = out.channel + (out.stereo ? 1 : 0);
  return out.channel > 0 && last <= Math.max(2, count) ? out : MASTER_OUTPUT;
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

// ---------- Efeitos ----------

/** Delay no tempo da música: uma semínima (1/4) no BPM, entre 0,1 e 1,5 s. */
export function delaySeconds(bpm: number): number {
  const b = bpm > 0 ? bpm : 120;
  return Math.max(0.1, Math.min(1.5, 60 / b));
}

/**
 * Resposta de sala para o reverb: ruído estéreo que some aos poucos (cauda de ~2 s), um pouco
 * escurecido, com 12 ms de pré-atraso. Sempre igual (semente fixa).
 */
export function makeReverbImpulse(sampleRate: number, seconds = 2.2): [Float32Array, Float32Array] {
  const n = Math.max(1, Math.round(sampleRate * seconds));
  const pre = Math.round(sampleRate * 0.012);
  const out: [Float32Array, Float32Array] = [new Float32Array(n), new Float32Array(n)];
  let a = 0x2f6b9c11;
  const rnd = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
  };
  for (const ch of out) {
    let lp = 0;
    for (let i = pre; i < n; i++) {
      const t = (i - pre) / sampleRate;
      lp += 0.45 * (rnd() - lp);
      ch[i] = lp * Math.exp(-t / 0.45) * 0.9;
    }
  }
  return out;
}

// ---------- Estado da tela ----------

export interface PadsState {
  /** O painel dos pads está aberto. */
  visible: boolean;
  bank: number;
  /** Pad escolhido (o knob, o pitch e os efeitos mexem nele). */
  selected: number;
  infos: Map<number, PadInfo>;
  /** Pads tocando agora e quando começaram (segundos do relógio da saída dos pads). */
  playing: Map<number, number>;
  /** Pads carregando um arquivo. */
  loading: Set<number>;
  /** Volume geral dos pads (padrão dos faders). */
  master: number;
  output: PadOutput;
  /** Um por vez: tocar um pad para os outros. */
  choke: boolean;
  message: { ok: boolean; text: string } | null;
  /** Atraso medido da saída dos pads, em milissegundos (null antes de abrir a saída). */
  latencyMs: number | null;
}

const BANK_KEY = 'vsstage.pads.bank';
const MASTER_KEY = 'vsstage.pads.master';
const OUTPUT_KEY = 'vsstage.pads.output';
const CHOKE_KEY = 'vsstage.pads.choke';

function stored(key: string, fallback: number, ok: (v: number) => boolean): number {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    const v = Number(raw);
    return raw !== null && raw !== undefined && ok(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

function storedOutput(): PadOutput {
  try {
    const v = JSON.parse(globalThis.localStorage?.getItem(OUTPUT_KEY) ?? 'null') as PadOutput | null;
    if (v && Number.isInteger(v.channel) && v.channel >= 0 && typeof v.stereo === 'boolean') return v;
  } catch { /* sem nada guardado */ }
  return MASTER_OUTPUT;
}

const firstBank = stored(BANK_KEY, 0, (v) => Number.isInteger(v) && v >= 0 && v < BANK_COUNT);
let state: PadsState = {
  visible: false,
  bank: firstBank,
  selected: padSlot(firstBank, 0),
  infos: new Map(),
  playing: new Map(),
  loading: new Set(),
  master: stored(MASTER_KEY, 0.8, (v) => v >= 0 && v <= 1.5),
  output: storedOutput(),
  choke: stored(CHOKE_KEY, 0, (v) => v === 0 || v === 1) === 1,
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
  try {
    if (patch.bank !== undefined) globalThis.localStorage?.setItem(BANK_KEY, String(patch.bank));
    if (patch.master !== undefined) globalThis.localStorage?.setItem(MASTER_KEY, String(patch.master));
    if (patch.output !== undefined) globalThis.localStorage?.setItem(OUTPUT_KEY, JSON.stringify(patch.output));
    if (patch.choke !== undefined) globalThis.localStorage?.setItem(CHOKE_KEY, patch.choke ? '1' : '0');
  } catch { /* só não lembra */ }
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

/** O mesmo para o Map dos pads tocando. */
export function withPlaying(map: Map<number, number>, slot: number, startedAt: number | null): Map<number, number> {
  const next = new Map(map);
  if (startedAt === null) next.delete(slot);
  else next.set(slot, startedAt);
  return next;
}

/** Quantos sons cada banco tem (o botão do banco acende quando tem som). */
export function bankCounts(infos: Map<number, PadInfo>): number[] {
  const counts = Array.from({ length: BANK_COUNT }, () => 0);
  infos.forEach((_, slot) => { counts[slotBank(slot)]++; });
  return counts;
}

/** O pad que o visor "Tocando" mostra: o último que começou. */
export function lastPlaying(playing: Map<number, number>): number | null {
  let best: number | null = null;
  let at = -Infinity;
  playing.forEach((t, slot) => { if (t >= at) { at = t; best = slot; } });
  return best;
}

// ---------- No projeto ----------

/** Como os pads ficam no arquivo do projeto (os sons vão como áudios do pacote, "pad:N"). */
export interface SavedPads {
  version: 1;
  bank: number;
  master: number;
  output: PadOutput;
  /** Um por vez (projetos salvos antes não têm: ficam com a escolha atual). */
  choke?: boolean;
  pads: Array<PadInfo & { path: string }>;
}

export function padAssetId(slot: number): string {
  return `pad:${slot}`;
}

const SAFE = /[\\/:*?"<>|]+/g;

/** Onde o som do pad fica numa pasta de projeto: "Pads/Banco A/1 - Vinheta.wav". */
export function padAssetPath(info: Pick<PadInfo, 'slot' | 'name' | 'type'>): string {
  const ext = /mpeg|mp3/.test(info.type ?? '') ? 'mp3'
    : /aif/.test(info.type ?? '') ? 'aif'
      : /mp4|m4a|aac/.test(info.type ?? '') ? 'm4a'
        : /flac/.test(info.type ?? '') ? 'flac'
          : /ogg/.test(info.type ?? '') ? 'ogg' : 'wav';
  const name = info.name.replace(SAFE, ' ').trim() || 'Som';
  return `Pads/Banco ${BANK_LABELS[slotBank(info.slot)]}/${slotPad(info.slot) + 1} - ${name}.${ext}`;
}

export function savedPadsOf(s: Pick<PadsState, 'bank' | 'master' | 'output' | 'infos'> & { choke?: boolean }): SavedPads | undefined {
  if (s.infos.size === 0) return undefined;
  const pads = [...s.infos.values()].sort((a, b) => a.slot - b.slot).map((i) => ({ ...i, path: padAssetPath(i) }));
  return { version: 1, bank: s.bank, master: s.master, output: s.output, choke: !!s.choke, pads };
}

/** Com "um por vez" ligado, os pads que param quando `slot` toca (todos os outros que estão tocando). */
export function chokedBy(slot: number, playing: Iterable<number>, choke: boolean): number[] {
  return choke ? [...playing].filter((s) => s !== slot) : [];
}
