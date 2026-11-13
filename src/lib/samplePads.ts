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
/** Modo segurar: apertou e soltou rápido, o som toca este tanto e para. */
export const HOLD_MIN_SECONDS = 0.2;
/** Descida ao soltar no modo segurar (sem estalo). */
export const HOLD_RELEASE_SECONDS = 0.08;

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
  /**
   * Corte do silêncio (segundos do arquivo): o som toca de `trimStart` a `trimEnd`. Sem os dois,
   * toca o arquivo inteiro. O arquivo guardado nunca muda.
   */
  trimStart?: number;
  trimEnd?: number;
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

/** Trecho que toca (segundos do arquivo): o corte, se houver, ou o arquivo inteiro. */
export function trimRegion(info: Pick<PadInfo, 'duration' | 'trimStart' | 'trimEnd'>): { start: number; end: number } {
  const d = Math.max(0, info.duration);
  if (info.trimStart === undefined || info.trimEnd === undefined) return { start: 0, end: d };
  const start = Math.max(0, Math.min(d, info.trimStart));
  const end = Math.max(start, Math.min(d, info.trimEnd));
  return end - start > 0.005 ? { start, end } : { start: 0, end: d };
}

export function isTrimmed(info: Pick<PadInfo, 'trimStart' | 'trimEnd'>): boolean {
  return info.trimStart !== undefined && info.trimEnd !== undefined;
}

/** Tempo que o som leva com o pitch (mais agudo = mais rápido), já com o corte. */
export function pitchedDuration(info: Pick<PadInfo, 'duration' | 'pitch' | 'trimStart' | 'trimEnd'>): number {
  const r = trimRegion(info);
  return (r.end - r.start) / pitchRate(info.pitch);
}

/**
 * Onde o som começa e termina de verdade (segundos), para cortar o silêncio: o começo é a primeira
 * amostra acima de -48 dBFS, com 1 ms antes para não comer o ataque ("bem na cabeça"); o fim é a
 * última acima de -60 dBFS, com 30 ms depois para o final soar natural. Som todo em silêncio: null.
 */
export function findSoundBounds(channels: ArrayLike<number>[], sampleRate: number): { start: number; end: number } | null {
  const len = channels.reduce((m, c) => Math.max(m, c.length), 0);
  if (!len || sampleRate <= 0) return null;
  const startThr = Math.pow(10, -48 / 20);
  const endThr = Math.pow(10, -60 / 20);
  const peakAt = (i: number) => {
    let p = 0;
    for (const c of channels) { const v = Math.abs(c[i] ?? 0); if (v > p) p = v; }
    return p;
  };
  let first = -1;
  for (let i = 0; i < len; i++) if (peakAt(i) > startThr) { first = i; break; }
  if (first < 0) return null;
  let last = first;
  for (let i = len - 1; i > first; i--) if (peakAt(i) > endThr) { last = i; break; }
  const start = Math.max(0, first - Math.round(sampleRate * 0.001)) / sampleRate;
  const end = Math.min(len, last + 1 + Math.round(sampleRate * 0.03)) / sampleRate;
  return { start, end };
}

/**
 * Modo segurar: quando o som para depois de soltar o pad. Soltou antes de 0,2 s, ele toca até
 * completar 0,2 s; soltou depois, para na hora.
 */
export function holdStopTime(startedAt: number, releasedAt: number, min = HOLD_MIN_SECONDS): number {
  return Math.max(releasedAt, startedAt + min);
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

/**
 * Knobs de efeito dos pads, valendo para todos: quanto de reverb e de delay volta (nos pads com o
 * efeito ligado), a velocidade do loop (o "roll" de DJ: repete um pedaço cada vez menor do som,
 * no tempo da música) e o filtro de DJ (para a esquerda abafa, para a direita afina).
 */
export interface PadFx {
  /** 0 a 1. */
  reverb: number;
  /** 0 a 1. */
  delay: number;
  /** 0 = desligado; até 1 = o pedaço mais curto (1/64 de tempo). */
  roll: number;
  /** -1 (só graves) a 1 (só agudos); 0 = sem filtro. */
  filter: number;
}

export const DEFAULT_PAD_FX: PadFx = { reverb: 0.5, delay: 0.5, roll: 0, filter: 0 };

/**
 * Começo do pedaço do roll: preso na grade do pedaço a partir do começo do som (que, cortado, cai
 * no tempo), para a repetição soar no ritmo e não num ponto qualquer.
 */
export function rollSliceStart(pos: number, len: number, soundLength: number): number {
  if (len <= 0) return 0;
  const grid = Math.floor(Math.max(0, pos) / len + 1e-9) * len;
  return Math.max(0, Math.min(grid, soundLength - len));
}

/** Tamanho do pedaço repetido em tempos da música; null = sem roll. */
export const ROLL_STEPS: Array<number | null> = [null, 1, 1 / 2, 1 / 4, 1 / 8, 1 / 16, 1 / 32, 1 / 64];

export function rollBeats(roll: number): number | null {
  const i = Math.round(Math.max(0, Math.min(1, roll)) * (ROLL_STEPS.length - 1));
  return ROLL_STEPS[i];
}

/** "OFF", "1", "1/2"... "1/64". */
export function rollLabel(roll: number): string {
  const b = rollBeats(roll);
  return b === null ? 'OFF' : b >= 1 ? String(b) : `1/${Math.round(1 / b)}`;
}

/** Segundos do pedaço do roll no BPM da música (null = sem roll). */
export function rollSeconds(roll: number, bpm: number): number | null {
  const b = rollBeats(roll);
  return b === null ? null : b * (60 / (bpm > 0 ? bpm : 120));
}

/** Volume da volta do reverb para o knob (0,5 = o de antes). */
export function reverbWet(amount: number): number {
  return Math.max(0, Math.min(1, amount)) * 1.1;
}

/** Volta e realimentação do delay para o knob (0,5 = o de antes; no máximo 0,75 de realimentação). */
export function delayAmount(amount: number): { wet: number; feedback: number } {
  const a = Math.max(0, Math.min(1, amount));
  return { wet: a * 0.9, feedback: 0.1 + a * 0.65 };
}

/** Filtro de DJ: frequência do passa-baixa e do passa-alta e a ressonância. */
export function djFilter(filter: number): { low: number; high: number; q: number } {
  const f = Math.max(-1, Math.min(1, filter));
  const near = Math.abs(f) < 0.02;
  return {
    low: near || f > 0 ? 20000 : 20000 * Math.pow(0.01, -f),
    high: near || f < 0 ? 20 : 20 * Math.pow(250, f),
    q: near ? 0.707 : 0.707 + Math.abs(f) * 2.5,
  };
}

/** Texto do filtro: "OFF", "LP 40", "HP 70". */
export function filterLabel(filter: number): string {
  if (Math.abs(filter) < 0.02) return 'OFF';
  return `${filter < 0 ? 'LP' : 'HP'} ${Math.round(Math.abs(filter) * 100)}`;
}

// ---------- Proteção de pico ----------

/** Onde a proteção de pico da soma dos pads começa a agir: -1 dBFS (o mesmo do limitador do master). */
export const PAD_CLIP_KNEE = Math.pow(10, -1 / 20);
/** Quanto acima de 0 dBFS a curva da proteção cobre (8 = +18 dB); acima disso fica no teto. */
export const PAD_CLIP_RANGE = 8;

/**
 * Proteção de pico da soma dos pads (vários pads juntos, reverb, delay e roll somam e passam de
 * 0 dBFS): até -1 dBFS o som passa igual; acima, dobra suave até no máximo 0 dBFS, sem estourar
 * na placa. Não atrasa nada, ao contrário de um limitador.
 */
export function padSoftClip(x: number): number {
  const a = Math.abs(x);
  if (a <= PAD_CLIP_KNEE) return x;
  const room = 1 - PAD_CLIP_KNEE;
  return Math.sign(x) * (PAD_CLIP_KNEE + room * Math.tanh((a - PAD_CLIP_KNEE) / room));
}

/**
 * Curva do WaveShaper da proteção. O WaveShaper só lê de -1 a 1, então a soma entra dividida por
 * PAD_CLIP_RANGE e a curva devolve o som no volume certo. Número ímpar de pontos, para o zero cair
 * bem no meio (silêncio continua silêncio).
 */
export function padClipCurve(points = 16385) {
  const n = Math.max(3, points % 2 === 1 ? points : points + 1);
  const curve = new Float32Array(n);
  const mid = (n - 1) / 2;
  for (let i = 0; i < n; i++) curve[i] = padSoftClip(((i - mid) / mid) * PAD_CLIP_RANGE);
  return curve;
}

/**
 * Onde o som está agora, em segundos do arquivo: começou em `anchorPos` no instante `anchorT` e
 * anda `rate` segundos por segundo; em loop, volta para o começo do trecho que repete.
 */
export function playheadAt(
  now: number,
  v: { anchorT: number; anchorPos: number; rate: number; loopStart: number; loopEnd: number; looping: boolean },
): number {
  const p = v.anchorPos + Math.max(0, now - v.anchorT) * v.rate;
  if (!v.looping || v.loopEnd <= v.loopStart) return p;
  if (p < v.loopEnd) return p;
  const len = v.loopEnd - v.loopStart;
  return v.loopStart + ((p - v.loopStart) % len);
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
  /** Knobs de efeito (valem para todos os pads). */
  fx: PadFx;
  /** Um por vez: tocar um pad para os outros. */
  choke: boolean;
  /** Segurar: os pads tocam enquanto estão apertados; apertou e soltou, toca só 0,2 s. */
  hold: boolean;
  message: { ok: boolean; text: string } | null;
  /** Atraso medido da saída dos pads, em milissegundos (null antes de abrir a saída). */
  latencyMs: number | null;
}

const BANK_KEY = 'vsstage.pads.bank';
const MASTER_KEY = 'vsstage.pads.master';
const OUTPUT_KEY = 'vsstage.pads.output';
const CHOKE_KEY = 'vsstage.pads.choke';
const HOLD_KEY = 'vsstage.pads.hold';
const FX_KEY = 'vsstage.pads.fx';

function storedFx(): PadFx {
  try {
    const v = JSON.parse(globalThis.localStorage?.getItem(FX_KEY) ?? 'null') as Partial<PadFx> | null;
    if (v && typeof v === 'object') {
      const num = (x: unknown, lo: number, hi: number, d: number) => (typeof x === 'number' && x >= lo && x <= hi ? x : d);
      return {
        reverb: num(v.reverb, 0, 1, DEFAULT_PAD_FX.reverb),
        delay: num(v.delay, 0, 1, DEFAULT_PAD_FX.delay),
        roll: num(v.roll, 0, 1, DEFAULT_PAD_FX.roll),
        filter: num(v.filter, -1, 1, DEFAULT_PAD_FX.filter),
      };
    }
  } catch { /* sem nada guardado */ }
  return { ...DEFAULT_PAD_FX };
}

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
  fx: storedFx(),
  choke: stored(CHOKE_KEY, 0, (v) => v === 0 || v === 1) === 1,
  hold: stored(HOLD_KEY, 0, (v) => v === 0 || v === 1) === 1,
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
    if (patch.hold !== undefined) globalThis.localStorage?.setItem(HOLD_KEY, patch.hold ? '1' : '0');
    if (patch.fx !== undefined) globalThis.localStorage?.setItem(FX_KEY, JSON.stringify(patch.fx));
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
  /** Segurar (idem). */
  hold?: boolean;
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

export function savedPadsOf(s: Pick<PadsState, 'bank' | 'master' | 'output' | 'infos'> & { choke?: boolean; hold?: boolean }): SavedPads | undefined {
  if (s.infos.size === 0) return undefined;
  const pads = [...s.infos.values()].sort((a, b) => a.slot - b.slot).map((i) => ({ ...i, path: padAssetPath(i) }));
  return { version: 1, bank: s.bank, master: s.master, output: s.output, choke: !!s.choke, hold: !!s.hold, pads };
}

/** Com "um por vez" ligado, os pads que param quando `slot` toca (todos os outros que estão tocando). */
export function chokedBy(slot: number, playing: Iterable<number>, choke: boolean): number[] {
  return choke ? [...playing].filter((s) => s !== slot) : [];
}
