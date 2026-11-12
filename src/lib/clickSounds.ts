// Sons do metrônomo para o Recriar metrônomo. O "VS Stage" é a amostra gravada (clickSampleData,
// tocada pelo clickGenerator); os outros são feitos aqui mesmo, por conta, sem arquivo e sem
// internet. Cada som é curto, começa no primeiro instante (o ataque fica em cima da batida) e
// sai no mesmo volume da amostra padrão: mesma energia nos primeiros 50 ms.
// Sem AudioBuffer, para dar para testar.

export type ClickSoundId = 'vs' | 'madeira' | 'bip' | 'baqueta' | 'cowbell' | 'chimbal';

export const CLICK_SOUNDS: { id: ClickSoundId; label: string; tip: string }[] = [
  { id: 'vs', label: 'VS Stage', tip: 'O click padrão do VS Stage' },
  { id: 'madeira', label: 'Madeira', tip: 'Bloco de madeira: seco, com corpo, fácil de ouvir com a banda' },
  { id: 'bip', label: 'Bip', tip: 'Bip de metrônomo digital: tom limpo e contínuo' },
  { id: 'baqueta', label: 'Baqueta', tip: 'Baqueta com baqueta, como a contagem do baterista' },
  { id: 'cowbell', label: 'Cowbell', tip: 'Cowbell de bateria eletrônica: metálico, atravessa a mix no fone' },
  { id: 'chimbal', label: 'Chimbal', tip: 'Chimbal fechado: o mais suave, bom para música lenta' },
];

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

/** Onda quadrada sem chiado de serrilhado: soma dos harmônicos ímpares até `maxHz`. */
function square(freq: number, t: number, maxHz: number): number {
  let v = 0;
  for (let k = 1; k * freq < maxHz; k += 2) v += Math.sin(2 * Math.PI * k * freq * t) / k;
  return v;
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
  const n = Math.min(data.length, Math.round(0.05 * sampleRate));
  let ss = 0;
  for (let i = 0; i < n; i++) ss += data[i] * data[i];
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

function cowbell(sr: number): Float32Array {
  const len = Math.round(0.26 * sr);
  const raw = new Float32Array(len);
  const maxHz = Math.min(12000, sr * 0.45);
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    raw[i] = square(587, t, maxHz) + square(845, t, maxHz);
  }
  const out = biquad(raw, sr, 'bandpass', 900, 1.6);
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    // pancada forte no começo e um resto que soa um pouco
    out[i] *= 0.7 * Math.exp(-t / 0.012) + 0.3 * Math.exp(-t / 0.07);
  }
  return edges(out, sr, 0.5, 12);
}

function chimbal(sr: number): Float32Array {
  const len = Math.round(0.09 * sr);
  const n = biquad(biquad(noise(len, 37), sr, 'highpass', 7000, 0.8), sr, 'highpass', 7000, 0.8);
  const metal = new Float32Array(len);
  const maxHz = Math.min(16000, sr * 0.45);
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    metal[i] = square(540, t, maxHz) + square(800, t, maxHz) + square(369.6, t, maxHz);
  }
  biquad(biquad(metal, sr, 'highpass', 7000, 0.8), sr, 'bandpass', 10000, 1);
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    out[i] = (n[i] + 0.35 * metal[i]) * Math.exp(-t / 0.018);
  }
  return edges(out, sr, 0.2);
}

const SYNTHS: Record<Exclude<ClickSoundId, 'vs'>, (sr: number) => Float32Array> = {
  madeira, bip, baqueta, cowbell, chimbal,
};

const cache = new Map<string, Float32Array>();

/**
 * Um toque do som escolhido (mono: o mesmo nos dois lados), já no volume da amostra padrão.
 * O "VS Stage" não passa por aqui: é a amostra gravada.
 */
export function synthClickSound(id: Exclude<ClickSoundId, 'vs'>, sampleRate: number): Float32Array {
  const key = `${id}@${sampleRate}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const data = matchClickLevel(SYNTHS[id](sampleRate), sampleRate);
  cache.set(key, data);
  return data;
}

/** Batidas de 1 compasso no andamento da música, para ouvir o som antes de escolher. */
export function previewTimes(bpm: number, beats = 4): number[] {
  const spb = 60 / Math.min(240, Math.max(40, bpm > 0 ? bpm : 120));
  return Array.from({ length: beats }, (_, i) => i * spb);
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
