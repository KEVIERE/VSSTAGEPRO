// Sons do metrônomo para o Recriar metrônomo. O "VS Stage" é a amostra gravada (clickSampleData,
// tocada pelo clickGenerator). Madeira, Bip e Baqueta são feitos aqui mesmo, por conta.
// Agradável e Bloco são toques gravados (clickRecordedSounds), já recortados no ataque.
// Todos começam no primeiro instante (o ataque fica em cima da batida) e saem no mesmo volume
// da amostra padrão: mesma energia nos primeiros 50 ms. Sem AudioBuffer, para dar para testar.

import {
  AGRADAVEL_ACENTO_B64, AGRADAVEL_B64, BLOCO_B64, RECORDED_CLICK_RATE,
} from './clickRecordedSounds.ts';

export type ClickSoundId = 'vs' | 'madeira' | 'bip' | 'baqueta' | 'agradavel' | 'bloco';

export const CLICK_SOUNDS: { id: ClickSoundId; label: string; tip: string; twoSounds?: boolean }[] = [
  { id: 'vs', label: 'VS Stage', tip: 'O click padrão do VS Stage' },
  { id: 'madeira', label: 'Madeira', tip: 'Bloco de madeira: seco, com corpo, fácil de ouvir com a banda' },
  { id: 'bip', label: 'Bip', tip: 'Bip de metrônomo digital: tom limpo e contínuo' },
  { id: 'baqueta', label: 'Baqueta', tip: 'Baqueta com baqueta, como a contagem do baterista' },
  {
    id: 'agradavel', label: 'Agradável', twoSounds: true,
    tip: 'Dois sons: agudo no 1 de cada compasso, grave nos outros tempos',
  },
  { id: 'bloco', label: 'Bloco', tip: 'Bloco gravado: toque cheio e encorpado, em estéreo' },
];

/** Um toque em estéreo: [esquerda, direita]. */
export type ClickHit = [Float32Array, Float32Array];

/** O som de cada batida; `accent` é o do 1 do compasso, quando o som tem dois. */
export interface ClickSoundSamples {
  normal: ClickHit;
  accent?: ClickHit;
}

export const DEFAULT_CLICK_SOUND: ClickSoundId = 'vs';

export function isClickSound(v: unknown): v is ClickSoundId {
  return typeof v === 'string' && CLICK_SOUNDS.some((s) => s.id === v);
}

export function clickSoundLabel(id: ClickSoundId): string {
  return CLICK_SOUNDS.find((s) => s.id === id)?.label ?? 'VS Stage';
}

/** Energia (RMS) dos primeiros 50 ms da amostra padrão do VS Stage. */
export const CLICK_TARGET_RMS = 0.158;
const PEAK_LIMIT = 0.89;

// ---------- peças da síntese ----------

/** Ruído branco sempre igual (o mesmo som em toda música e em todo teste). */
function noise(length: number, seed: number): Float32Array {
  let a = seed >>> 0;
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    out[i] = (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
  }
  return out;
}

type FilterKind = 'bandpass' | 'highpass' | 'lowpass';

/** Filtro de 2 polos (receita RBJ), aplicado no lugar. */
function biquad(data: Float32Array, sampleRate: number, kind: FilterKind, freq: number, q: number): Float32Array {
  const w = 2 * Math.PI * Math.min(freq, sampleRate * 0.45) / sampleRate;
  const cos = Math.cos(w);
  const alpha = Math.sin(w) / (2 * q);
  let b0: number; let b1: number; let b2: number;
  if (kind === 'bandpass') { b0 = alpha; b1 = 0; b2 = -alpha; }
  else if (kind === 'highpass') { b0 = (1 + cos) / 2; b1 = -(1 + cos); b2 = (1 + cos) / 2; }
  else { b0 = (1 - cos) / 2; b1 = 1 - cos; b2 = (1 - cos) / 2; }
  const a0 = 1 + alpha;
  const a1 = -2 * cos;
  const a2 = 1 - alpha;
  let x1 = 0; let x2 = 0; let y1 = 0; let y2 = 0;
  for (let i = 0; i < data.length; i++) {
    const x = data[i];
    const y = (b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    data[i] = y;
  }
  return data;
}

/** Ataque curto no começo e saída suave no fim, para não estalar. */
function edges(data: Float32Array, sampleRate: number, attackMs: number, fadeMs = 6): Float32Array {
  const att = Math.max(1, Math.round(attackMs * sampleRate / 1000));
  const fade = Math.max(1, Math.round(fadeMs * sampleRate / 1000));
  for (let i = 0; i < Math.min(att, data.length); i++) data[i] *= i / att;
  for (let i = 0; i < Math.min(fade, data.length); i++) data[data.length - 1 - i] *= i / fade;
  return data;
}

/** Deixa o som com a mesma energia da amostra padrão, sem passar do pico limite. */
export function matchClickLevel(data: Float32Array, sampleRate: number): Float32Array {
  // sempre 50 ms: som mais curto conta o resto como silêncio, igual à amostra padrão
  const n = Math.round(0.05 * sampleRate);
  let ss = 0;
  for (let i = 0; i < Math.min(n, data.length); i++) ss += data[i] * data[i];
  const rms = Math.sqrt(ss / Math.max(1, n));
  if (rms <= 0) return data;
  let gain = CLICK_TARGET_RMS / rms;
  let peak = 0;
  for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
  if (peak * gain > PEAK_LIMIT) gain = PEAK_LIMIT / peak;
  for (let i = 0; i < data.length; i++) data[i] *= gain;
  return data;
}

// ---------- os sons ----------

function madeira(sr: number): Float32Array {
  const len = Math.round(0.12 * sr);
  const out = new Float32Array(len);
  const knock = biquad(noise(len, 11), sr, 'bandpass', 2400, 1.2);
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    out[i] = Math.sin(2 * Math.PI * 1150 * t) * Math.exp(-t / 0.024)
      + 0.45 * Math.sin(2 * Math.PI * 2950 * t) * Math.exp(-t / 0.009)
      + 0.9 * knock[i] * Math.exp(-t / 0.0015);
  }
  return edges(out, sr, 0.3);
}

function bip(sr: number): Float32Array {
  const len = Math.round(0.07 * sr);
  const out = new Float32Array(len);
  const hold = 0.03;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const env = t < hold ? 1 : Math.exp(-(t - hold) / 0.008);
    out[i] = (Math.sin(2 * Math.PI * 1600 * t) + 0.12 * Math.sin(2 * Math.PI * 4800 * t)) * env;
  }
  return edges(out, sr, 1);
}

function baqueta(sr: number): Float32Array {
  const len = Math.round(0.08 * sr);
  const out = new Float32Array(len);
  const n = noise(len, 23);
  const body = biquad(biquad(Float32Array.from(n), sr, 'bandpass', 2900, 6), sr, 'bandpass', 2900, 6);
  const shine = biquad(Float32Array.from(n), sr, 'bandpass', 4700, 5);
  const snap = biquad(Float32Array.from(n), sr, 'highpass', 1500, 0.7);
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    out[i] = 6 * body[i] * Math.exp(-t / 0.016)
      + 2.5 * shine[i] * Math.exp(-t / 0.01)
      + 0.3 * snap[i] * Math.exp(-t / 0.003)
      + 0.5 * Math.sin(2 * Math.PI * 2350 * t) * Math.exp(-t / 0.012);
  }
  return edges(out, sr, 0.2);
}

type SynthId = 'madeira' | 'bip' | 'baqueta';
type RecordedId = 'agradavel' | 'bloco';

const SYNTHS: Record<SynthId, (sr: number) => Float32Array> = { madeira, bip, baqueta };

// ---------- toques gravados ----------

/** Lê o PCM de 16 bits estéreo intercalado (base64) de clickRecordedSounds. */
export function decodeRecordedHit(b64: string): ClickHit {
  const bin = atob(b64);
  const frames = Math.floor(bin.length / 4);
  const L = new Float32Array(frames);
  const R = new Float32Array(frames);
  const s16 = (i: number) => {
    const v = bin.charCodeAt(i) | (bin.charCodeAt(i + 1) << 8);
    return (v >= 0x8000 ? v - 0x10000 : v) / 32768;
  };
  for (let f = 0; f < frames; f++) {
    L[f] = s16(f * 4);
    R[f] = s16(f * 4 + 2);
  }
  return [L, R];
}

function lanczos(t: number, a: number): number {
  if (t === 0) return 1;
  if (Math.abs(t) >= a) return 0;
  const pt = Math.PI * t;
  return (a * Math.sin(pt) * Math.sin(pt / a)) / (pt * pt);
}

/**
 * Muda a taxa de amostragem (Lanczos de 8 lóbulos). A amostra 0 continua na amostra 0: o ataque
 * não sai do lugar.
 */
export function resampleHit(data: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return Float32Array.from(data);
  const ratio = from / to;
  const n = Math.max(1, Math.round(data.length / ratio));
  const out = new Float32Array(n);
  const A = 8;
  // ao baixar a taxa, o filtro alarga para não dobrar os agudos
  const scale = Math.min(1, to / from);
  const reach = Math.ceil(A / scale);
  for (let j = 0; j < n; j++) {
    const x = j * ratio;
    const i0 = Math.floor(x);
    let sum = 0;
    for (let k = Math.max(0, i0 - reach + 1); k <= Math.min(data.length - 1, i0 + reach); k++) {
      sum += data[k] * lanczos((x - k) * scale, A);
    }
    out[j] = sum * scale;
  }
  return out;
}

const RECORDED: Record<RecordedId, { normal: string; accent?: string }> = {
  agradavel: { normal: AGRADAVEL_B64, accent: AGRADAVEL_ACENTO_B64 },
  bloco: { normal: BLOCO_B64 },
};

function recordedSamples(id: RecordedId, sampleRate: number): ClickSoundSamples {
  const src = RECORDED[id];
  const load = (b64: string): ClickHit => {
    const [L, R] = decodeRecordedHit(b64);
    return [resampleHit(L, RECORDED_CLICK_RATE, sampleRate), resampleHit(R, RECORDED_CLICK_RATE, sampleRate)];
  };
  const normal = load(src.normal);
  const accent = src.accent ? load(src.accent) : undefined;
  // volume: a energia do toque normal igual à do click padrão; o do 1 sobe ou desce junto, para
  // manter a diferença que tem na gravação
  const n = Math.round(0.05 * sampleRate);
  let ss = 0;
  for (let i = 0; i < Math.min(n, normal[0].length); i++) ss += (normal[0][i] * normal[0][i] + normal[1][i] * normal[1][i]) / 2;
  let gain = CLICK_TARGET_RMS / Math.max(1e-9, Math.sqrt(ss / Math.max(1, n)));
  let peak = 0;
  for (const ch of [...normal, ...(accent ?? [])]) for (let i = 0; i < ch.length; i++) peak = Math.max(peak, Math.abs(ch[i]));
  if (peak * gain > PEAK_LIMIT) gain = PEAK_LIMIT / peak;
  for (const ch of [...normal, ...(accent ?? [])]) for (let i = 0; i < ch.length; i++) ch[i] *= gain;
  return accent ? { normal, accent } : { normal };
}

const cache = new Map<string, ClickSoundSamples>();

/**
 * Os toques do som escolhido na taxa pedida, já no volume da amostra padrão. Os feitos aqui são
 * mono (o mesmo nos dois lados); o Agradável tem o toque do 1 do compasso em `accent`.
 * O "VS Stage" não passa por aqui: é a amostra gravada do clickGenerator.
 */
export function clickSoundSamples(id: Exclude<ClickSoundId, 'vs'>, sampleRate: number): ClickSoundSamples {
  const key = `${id}@${sampleRate}`;
  const hit = cache.get(key);
  if (hit) return hit;
  let made: ClickSoundSamples;
  if (id === 'agradavel' || id === 'bloco') made = recordedSamples(id, sampleRate);
  else {
    const mono = matchClickLevel(SYNTHS[id](sampleRate), sampleRate);
    made = { normal: [mono, mono] };
  }
  cache.set(key, made);
  return made;
}

/**
 * Batidas para ouvir o som antes de escolher: 1 compasso e o 1 do compasso seguinte
 * (1 2 3 4 | 1), no andamento da música. Assim dá para ouvir a virada do compasso.
 */
export function previewTimes(bpm: number, beatsPerBar = 4): number[] {
  const spb = 60 / Math.min(240, Math.max(40, bpm > 0 ? bpm : 120));
  return Array.from({ length: beatsPerBar + 1 }, (_, i) => i * spb);
}

/** Na prévia, o 1 de cada compasso. */
export function previewAccents(beatsPerBar = 4): boolean[] {
  return Array.from({ length: beatsPerBar + 1 }, (_, i) => i % beatsPerBar === 0);
}

// ---------- o som escolhido fica guardado ----------

const STORE_KEY = 'vsstage.clickSound';

export function rememberedClickSound(): ClickSoundId {
  try {
    const v = globalThis.localStorage?.getItem(STORE_KEY);
    return isClickSound(v) ? v : DEFAULT_CLICK_SOUND;
  } catch {
    return DEFAULT_CLICK_SOUND;
  }
}

export function rememberClickSound(id: ClickSoundId): void {
  try { globalThis.localStorage?.setItem(STORE_KEY, id); } catch { /* sem armazenamento: só não lembra */ }
}
