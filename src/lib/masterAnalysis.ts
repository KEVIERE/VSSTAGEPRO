// Medidas de engenharia de áudio para a masterização (e para os testes dela), puras e sem o
// navegador: rodam no worker da masterização, nos testes do Node e no script de medição.
//  - loudness em janelas (momentâneo 400 ms, curto 3 s) e faixa dinâmica LRA (EBU Tech 3342);
//  - PLR (true peak − loudness integrado) e PSR (true peak − maior loudness curto);
//  - espectro médio de longo prazo em terços de oitava, do meio (L+R) e do lado (L−R);
//  - correlação entre L e R e quanto do grave está fora do centro.
import { integratedLoudness, kWeighting, truePeak, gainToDb } from './loudness.ts';
import type { Biquad } from './loudness.ts';

// ---------------------------------------------------------------- FFT (radix 2, complexa)

const fftTables = new Map<number, { rev: Uint32Array; cos: Float64Array; sin: Float64Array }>();

function tablesFor(n: number) {
  let t = fftTables.get(n);
  if (t) return t;
  const bits = Math.round(Math.log2(n));
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
    rev[i] = r;
  }
  const cos = new Float64Array(n / 2);
  const sin = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) { cos[i] = Math.cos((2 * Math.PI * i) / n); sin[i] = -Math.sin((2 * Math.PI * i) / n); }
  t = { rev, cos, sin };
  fftTables.set(n, t);
  return t;
}

/** FFT complexa no lugar; `n` potência de 2. */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  const { rev, cos, sin } = tablesFor(n);
  for (let i = 0; i < n; i++) {
    const j = rev[i];
    if (j > i) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const step = n / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < half; k++) {
        const wr = cos[k * step];
        const wi = sin[k * step];
        const a = start + k;
        const b = a + half;
        const xr = re[b] * wr - im[b] * wi;
        const xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr; im[b] = im[a] - xi;
        re[a] += xr; im[a] += xi;
      }
    }
  }
}

// ---------------------------------------------------------------- terços de oitava

/** Centros dos terços de oitava (base 2, 1 kHz no centro), de ~20 Hz a ~20 kHz. */
export const THIRD_OCTAVES: number[] = Array.from({ length: 31 }, (_, i) => 1000 * Math.pow(2, (i - 17) / 3));

export interface LongTermSpectrum {
  centers: number[];
  /** Potência média por banda (dB, escala arbitrária igual para meio e lado) */
  midDb: number[];
  sideDb: number[];
  /** Quadros que passaram o gate (o silêncio não entra na média) */
  frames: number;
  /** Com `keepFrames`: potência (meio + lado) por banda de cada quadro que passou o gate */
  frameBands?: Float64Array[];
  /** Converte a potência da FFT em média quadrática por canal (Parseval com janela de Hann) */
  msScale: number;
}

/**
 * Espectro médio de longo prazo (LTAS) em terços de oitava. Só entram os quadros com som
 * (gate de -60 dBFS e de 20 dB abaixo da média), como os medidores de equilíbrio tonal.
 */
export function longTermSpectrum(channels: ArrayLike<number>[], sampleRate: number, options?: { size?: number; hop?: number; keepFrames?: boolean }): LongTermSpectrum {
  const size = options?.size ?? 8192;
  const hop = options?.hop ?? size / 2;
  const L = channels[0];
  const R = channels[1] ?? channels[0];
  const n = L?.length ?? 0;
  const nb = THIRD_OCTAVES.length;
  const binHz = sampleRate / size;
  // bins de cada banda (borda a borda em ±1/6 de oitava)
  const lo: number[] = [];
  const hi: number[] = [];
  for (const fc of THIRD_OCTAVES) {
    lo.push(Math.max(1, Math.round((fc * Math.pow(2, -1 / 6)) / binHz)));
    hi.push(Math.min(size / 2 - 1, Math.round((fc * Math.pow(2, 1 / 6)) / binHz)));
  }
  const win = new Float64Array(size);
  for (let i = 0; i < size; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size);
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  const frameMid: Float64Array[] = [];
  const frameSide: Float64Array[] = [];
  const frameEnergy: number[] = [];
  for (let s = 0; s + size <= n; s += hop) {
    let e = 0;
    for (let i = 0; i < size; i++) {
      const l = L[s + i], r = R[s + i];
      e += l * l + r * r;
      re[i] = l * win[i];
      im[i] = r * win[i];
    }
    e /= 2 * size;
    if (e < 1e-6) continue; // -60 dBFS
    fft(re, im);
    const mid = new Float64Array(nb);
    const side = new Float64Array(nb);
    for (let b = 0; b < nb; b++) {
      let pm = 0, ps = 0;
      for (let k = lo[b]; k <= hi[b]; k++) {
        // separa L e R da FFT conjunta: XL = (Z[k] + Z*[N-k]) / 2, XR = (Z[k] − Z*[N-k]) / 2i
        const zr = re[k], zi = im[k], cr = re[size - k], ci = -im[size - k];
        const lr = (zr + cr) / 2, li = (zi + ci) / 2;
        const rr = (zi - ci) / 2, ri = -(zr - cr) / 2;
        const mr = (lr + rr) / 2, mi = (li + ri) / 2;
        const sr = (lr - rr) / 2, si = (li - ri) / 2;
        pm += mr * mr + mi * mi;
        ps += sr * sr + si * si;
      }
      mid[b] = pm;
      side[b] = ps;
    }
    frameMid.push(mid);
    frameSide.push(side);
    frameEnergy.push(e);
  }
  const midSum = new Float64Array(nb);
  const sideSum = new Float64Array(nb);
  let used = 0;
  const kept: Float64Array[] = [];
  if (frameEnergy.length) {
    const mean = frameEnergy.reduce((a, b) => a + b, 0) / frameEnergy.length;
    const gateE = mean / 100; // 20 dB abaixo da média
    for (let f = 0; f < frameEnergy.length; f++) {
      if (frameEnergy[f] < gateE) continue;
      used++;
      for (let b = 0; b < nb; b++) { midSum[b] += frameMid[f][b]; sideSum[b] += frameSide[f][b]; }
      if (options?.keepFrames) kept.push(Float64Array.from(frameMid[f], (m, b) => m + frameSide[f][b]));
    }
  }
  const toDb = (p: number) => (p > 0 ? 10 * Math.log10(p / Math.max(1, used)) : -200);
  // soma de w² da Hann = 3N/8; bins positivos contam em dobro: média quadrática = 16/(3N²)·Σ|X|²
  const msScale = 16 / (3 * size * size);
  return { centers: THIRD_OCTAVES, midDb: Array.from(midSum, toDb), sideDb: Array.from(sideSum, toDb), frames: used, frameBands: options?.keepFrames ? kept : undefined, msScale };
}

/** Potência total (meio + lado) de cada banda, em dB. */
export function totalBandDb(s: LongTermSpectrum): number[] {
  return s.midDb.map((m, i) => 10 * Math.log10(Math.pow(10, m / 10) + Math.pow(10, s.sideDb[i] / 10)));
}

/** Curva relativa: a média das bandas de 100 Hz a 8 kHz vira 0 dB (compara músicas de volumes diferentes). */
export function normalizeCurve(db: number[], centers: number[] = THIRD_OCTAVES): number[] {
  let sum = 0, count = 0;
  for (let i = 0; i < db.length; i++) if (centers[i] >= 95 && centers[i] <= 8500) { sum += db[i]; count++; }
  const ref = count ? sum / count : 0;
  return db.map((v) => v - ref);
}

/** Desvio RMS (dB) entre duas curvas relativas, nas bandas entre `fromHz` e `toHz`. */
export function curveDistance(a: number[], b: number[], fromHz = 40, toHz = 16000, centers: number[] = THIRD_OCTAVES): number {
  let s = 0, c = 0;
  for (let i = 0; i < a.length; i++) {
    if (centers[i] < fromHz || centers[i] > toHz) continue;
    const d = a[i] - b[i];
    s += d * d; c++;
  }
  return c ? Math.sqrt(s / c) : 0;
}

// ---------------------------------------------------------------- loudness em janelas

function kFilter(x: ArrayLike<number>, f: Biquad[]): Float32Array {
  const out = Float32Array.from(x as ArrayLike<number>);
  for (const q of f) {
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < out.length; i++) {
      const x0 = out[i];
      const y0 = q.b0 * x0 + q.b1 * x1 + q.b2 * x2 - q.a1 * y1 - q.a2 * y2;
      x2 = x1; x1 = x0; y2 = y1; y1 = y0;
      out[i] = y0;
    }
  }
  return out;
}

/** Potência ponderada K (soma dos canais) em pedaços de 100 ms. */
function chunkPowers(channels: ArrayLike<number>[], sampleRate: number): Float64Array {
  const chunk = Math.round(0.1 * sampleRate);
  const n = channels[0]?.length ?? 0;
  const count = Math.floor(n / chunk);
  const out = new Float64Array(count);
  const k = kWeighting(sampleRate);
  for (const ch of channels) {
    const y = kFilter(ch, k);
    for (let c = 0; c < count; c++) {
      let s = 0;
      for (let i = c * chunk, e = i + chunk; i < e; i++) s += y[i] * y[i];
      out[c] += s / chunk;
    }
  }
  return out;
}

const lufsOf = (p: number) => (p > 0 ? -0.691 + 10 * Math.log10(p) : -Infinity);

/** Loudness em janelas de `windowChunks` × 100 ms, a cada 100 ms. */
function windowed(powers: Float64Array, windowChunks: number): number[] {
  const out: number[] = [];
  let acc = 0;
  for (let i = 0; i < powers.length; i++) {
    acc += powers[i];
    if (i >= windowChunks) acc -= powers[i - windowChunks];
    if (i >= windowChunks - 1) out.push(lufsOf(Math.max(0, acc) / windowChunks));
  }
  return out;
}

/** LRA (EBU Tech 3342): do percentil 10 ao 95 do loudness curto, com gate absoluto e de −20 LU. */
function lraOf(shortTerm: number[]): number {
  const abs = shortTerm.filter((v) => v > -70);
  if (abs.length < 2) return 0;
  const meanP = abs.reduce((a, v) => a + Math.pow(10, (v + 0.691) / 10), 0) / abs.length;
  const rel = lufsOf(meanP) - 20;
  const gated = abs.filter((v) => v > rel).sort((a, b) => a - b);
  if (gated.length < 2) return 0;
  const pct = (p: number) => gated[Math.min(gated.length - 1, Math.max(0, Math.round((p / 100) * (gated.length - 1))))];
  return pct(95) - pct(10);
}

export interface AudioMeasure {
  lufs: number;
  truePeakDbtp: number;
  samplePeakDb: number;
  /** Faixa de loudness (LU) */
  lra: number;
  /** true peak − LUFS integrado (dB): quanto "soco" sobra acima do volume médio */
  plr: number;
  /** true peak − maior loudness curto (dB) */
  psr: number;
  maxShortTerm: number;
  maxMomentary: number;
  /** Correlação L/R (1 = mono, 0 = sem relação, < 0 = fase invertida) */
  correlation: number;
  /** Lado em relação ao meio, banda toda (dB) */
  sideToMidDb: number;
  /** Lado em relação ao meio abaixo de 140 Hz (dB): quanto do grave está fora do centro */
  lowSideToMidDb: number;
  /** Amostras em ±1,0 ou acima (estouro num arquivo de 16/24 bits) */
  overs: number;
  /** Curva tonal relativa (terços de oitava, 0 dB = média de 100 Hz a 8 kHz) */
  tonal: number[];
}

export function measureAudio(channels: ArrayLike<number>[], sampleRate: number): AudioMeasure {
  const lufs = integratedLoudness(channels, sampleRate);
  const tp = gainToDb(truePeak(channels));
  let sp = 0, overs = 0;
  let sLL = 0, sRR = 0, sLR = 0;
  const L = channels[0];
  const R = channels[1] ?? channels[0];
  for (let i = 0; i < L.length; i++) {
    const l = L[i], r = R[i];
    const al = Math.abs(l), ar = Math.abs(r);
    if (al > sp) sp = al;
    if (ar > sp) sp = ar;
    if (al >= 1) overs++;
    if (ar >= 1 && channels.length > 1) overs++;
    sLL += l * l; sRR += r * r; sLR += l * r;
  }
  const powers = chunkPowers(channels, sampleRate);
  const st = windowed(powers, 30);
  const mo = windowed(powers, 4);
  const maxShortTerm = st.length ? Math.max(...st) : lufs;
  const maxMomentary = mo.length ? Math.max(...mo) : lufs;
  const spec = longTermSpectrum(channels, sampleRate);
  let lowMid = 0, lowSide = 0, allMid = 0, allSide = 0;
  spec.centers.forEach((fc, i) => {
    const m = Math.pow(10, spec.midDb[i] / 10), s = Math.pow(10, spec.sideDb[i] / 10);
    allMid += m; allSide += s;
    if (fc <= 140) { lowMid += m; lowSide += s; }
  });
  const ratioDb = (s: number, m: number) => (m > 0 && s > 0 ? 10 * Math.log10(s / m) : -Infinity);
  return {
    lufs,
    truePeakDbtp: tp,
    samplePeakDb: gainToDb(sp),
    lra: lraOf(st),
    plr: tp - lufs,
    psr: tp - maxShortTerm,
    maxShortTerm,
    maxMomentary,
    correlation: sLL > 0 && sRR > 0 ? sLR / Math.sqrt(sLL * sRR) : 1,
    sideToMidDb: ratioDb(allSide, allMid),
    lowSideToMidDb: ratioDb(lowSide, lowMid),
    overs,
    tonal: normalizeCurve(totalBandDb(spec)),
  };
}

/** Loudness curto (3 s, a cada 100 ms) para quem precisa da série inteira. */
export function shortTermSeries(channels: ArrayLike<number>[], sampleRate: number): number[] {
  return windowed(chunkPowers(channels, sampleRate), 30);
}
