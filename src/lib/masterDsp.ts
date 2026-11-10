// Blocos de processamento da masterização, em float e sem o navegador:
//  - filtros biquad (fórmulas RBJ) com estado, para processar em pedaços;
//  - divisor de 3 bandas Linkwitz-Riley de 4ª ordem (somado de volta, fica plano);
//  - compressor por banda com detector RMS, joelho suave e estéreo ligado;
//  - limitador de true peak com look-ahead e release que se adapta à música, calculado em
//    blocos de 16 amostras (leve na memória) e aplicado com o ganho interpolado amostra a amostra.
import { kWeighting, tpKernel, TP_TAPS, dbToGain } from './loudness.ts';
import type { Biquad } from './loudness.ts';

export type FilterKind = 'lowpass' | 'highpass' | 'peaking' | 'lowshelf' | 'highshelf' | 'allpass';

/** Coeficientes RBJ (Audio EQ Cookbook), normalizados por a0. */
export function designBiquad(kind: FilterKind, f0: number, sampleRate: number, q = Math.SQRT1_2, gainDb = 0): Biquad {
  const f = Math.min(f0, sampleRate * 0.49);
  const A = Math.pow(10, gainDb / 40);
  const w = (2 * Math.PI * f) / sampleRate;
  const cw = Math.cos(w);
  const sw = Math.sin(w);
  const alpha = sw / (2 * q);
  let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number;
  switch (kind) {
    case 'lowpass':
      b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = (1 - cw) / 2;
      a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
      break;
    case 'highpass':
      b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = (1 + cw) / 2;
      a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
      break;
    case 'peaking':
      b0 = 1 + alpha * A; b1 = -2 * cw; b2 = 1 - alpha * A;
      a0 = 1 + alpha / A; a1 = -2 * cw; a2 = 1 - alpha / A;
      break;
    case 'lowshelf': {
      const s = 2 * Math.sqrt(A) * alpha;
      b0 = A * ((A + 1) - (A - 1) * cw + s); b1 = 2 * A * ((A - 1) - (A + 1) * cw); b2 = A * ((A + 1) - (A - 1) * cw - s);
      a0 = (A + 1) + (A - 1) * cw + s; a1 = -2 * ((A - 1) + (A + 1) * cw); a2 = (A + 1) + (A - 1) * cw - s;
      break;
    }
    case 'highshelf': {
      const s = 2 * Math.sqrt(A) * alpha;
      b0 = A * ((A + 1) + (A - 1) * cw + s); b1 = -2 * A * ((A - 1) + (A + 1) * cw); b2 = A * ((A + 1) + (A - 1) * cw - s);
      a0 = (A + 1) - (A - 1) * cw + s; a1 = 2 * ((A - 1) - (A + 1) * cw); a2 = (A + 1) - (A - 1) * cw - s;
      break;
    }
    default: // allpass
      b0 = 1 - alpha; b1 = -2 * cw; b2 = 1 + alpha;
      a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

/** Resposta em magnitude (dB) de um biquad numa frequência. */
export function biquadDb(f: Biquad, freq: number, sampleRate: number): number {
  const w = (2 * Math.PI * freq) / sampleRate;
  const c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
  const nr = f.b0 + f.b1 * c1 + f.b2 * c2, ni = -(f.b1 * s1 + f.b2 * s2);
  const dr = 1 + f.a1 * c1 + f.a2 * c2, di = -(f.a1 * s1 + f.a2 * s2);
  return 10 * Math.log10((nr * nr + ni * ni) / (dr * dr + di * di));
}

/** Cadeia de biquads com estado (para processar o áudio em pedaços seguidos). */
export class FilterChain {
  readonly filters: Biquad[];
  private readonly state: Float64Array;
  constructor(filters: Biquad[]) {
    this.filters = filters;
    this.state = new Float64Array(filters.length * 4);
  }
  run(x: Float32Array, from = 0, to = x.length): void {
    const st = this.state;
    for (let k = 0; k < this.filters.length; k++) {
      const f = this.filters[k];
      let x1 = st[4 * k], x2 = st[4 * k + 1], y1 = st[4 * k + 2], y2 = st[4 * k + 3];
      for (let i = from; i < to; i++) {
        const x0 = x[i];
        const y0 = f.b0 * x0 + f.b1 * x1 + f.b2 * x2 - f.a1 * y1 - f.a2 * y2;
        x2 = x1; x1 = x0; y2 = y1; y1 = y0;
        x[i] = y0;
      }
      st[4 * k] = x1; st[4 * k + 1] = x2; st[4 * k + 2] = y1; st[4 * k + 3] = y2;
    }
  }
}

/** Passa-baixas/passa-altas Linkwitz-Riley de 4ª ordem (dois Butterworth de 2ª em série). */
export function lr4(kind: 'lowpass' | 'highpass', f0: number, sampleRate: number): Biquad[] {
  const b = designBiquad(kind, f0, sampleRate, Math.SQRT1_2);
  return [b, b];
}

// ---------------------------------------------------------------- compressor de banda

export interface BandSettings {
  thresholdDb: number;
  ratio: number;
  kneeDb: number;
  attackMs: number;
  releaseMs: number;
  /** Maior redução permitida (dB, positivo) */
  maxGrDb: number;
}

/** Compressor com detector RMS (5 ms), ganho calculado em dB e suavizado por ataque/release. */
export class BandCompressor {
  private readonly s: BandSettings;
  private readonly det: number;
  private readonly att: number;
  private readonly rel: number;
  private env = 0;
  private gr = 0;
  /** soma e contagem da redução (dB) enquanto comprime, para o relatório */
  grSum = 0;
  grCount = 0;
  grMax = 0;
  constructor(s: BandSettings, sampleRate: number) {
    this.s = s;
    this.det = Math.exp(-1 / (0.005 * sampleRate));
    this.att = Math.exp(-1 / ((s.attackMs / 1000) * sampleRate));
    this.rel = Math.exp(-1 / ((s.releaseMs / 1000) * sampleRate));
  }
  /**
   * Comprime os canais (mesmo ganho em todos) de `from` a `to`. O detector anda a cada amostra;
   * o ganho é calculado a cada 8 amostras (0,17 ms em 48 kHz, bem abaixo do ataque mais rápido)
   * e interpolado entre os pontos, o que poupa o log/pow por amostra.
   */
  run(ch: Float32Array[], from: number, to: number): void {
    const { thresholdDb: T, ratio, kneeDb: W, maxGrDb } = this.s;
    const slope = 1 / ratio - 1;
    const nc = ch.length;
    const STEP = 8;
    let env = this.env, gr = this.gr;
    const det = this.det;
    const att = Math.pow(this.att, STEP), rel = Math.pow(this.rel, STEP);
    let gPrev = Math.pow(10, gr / 20);
    for (let s = from; s < to; s += STEP) {
      const e = Math.min(to, s + STEP);
      for (let i = s; i < e; i++) {
        let p = 0;
        for (let c = 0; c < nc; c++) { const v = ch[c][i]; p += v * v; }
        env = p / nc + (env - p / nc) * det;
      }
      const level = env > 1e-12 ? 10 * Math.log10(env) : -120;
      const over = level - T;
      let want = 0;
      if (over > W / 2) want = over * slope;
      else if (over > -W / 2) { const k = over + W / 2; want = (slope * k * k) / (2 * W); }
      if (want < -maxGrDb) want = -maxGrDb;
      gr = want < gr ? want + (gr - want) * att : want + (gr - want) * rel;
      if (gr < -0.05) { this.grSum -= gr; this.grCount++; if (-gr > this.grMax) this.grMax = -gr; }
      const gNext = Math.pow(10, gr / 20);
      const d = (gNext - gPrev) / (e - s);
      for (let c = 0; c < nc; c++) {
        const x = ch[c];
        let g = gPrev;
        for (let i = s; i < e; i++) { g += d; x[i] *= g; }
      }
      gPrev = gNext;
    }
    this.env = env; this.gr = gr;
  }
}

// ---------------------------------------------------------------- divisor de 3 bandas + compressão

/**
 * Compressor de 3 bandas no lugar: divide em grave/médio/agudo com Linkwitz-Riley 4ª ordem
 * (o grave passa pelo mesmo passa-tudo do 2º corte, então a soma fica plana), comprime cada
 * banda e soma de volta. Processa em pedaços: a memória extra é só a dos pedaços.
 */
export interface MultibandResult {
  comps: BandCompressor[];
  /** Quanto cada banda perdeu de potência na compressão (dB, ≥ 0): base da compensação por banda */
  lossDb: [number, number, number];
}

export function multibandCompress(ch: Float32Array[], sampleRate: number, crossovers: [number, number], bands: BandSettings[]): MultibandResult {
  const n = ch[0]?.length ?? 0;
  const nc = ch.length;
  const [f1, f2] = crossovers;
  const lp1 = ch.map(() => new FilterChain(lr4('lowpass', f1, sampleRate)));
  const hp1 = ch.map(() => new FilterChain(lr4('highpass', f1, sampleRate)));
  const ap2 = ch.map(() => new FilterChain([designBiquad('allpass', f2, sampleRate, Math.SQRT1_2)]));
  const lp2 = ch.map(() => new FilterChain(lr4('lowpass', f2, sampleRate)));
  const hp2 = ch.map(() => new FilterChain(lr4('highpass', f2, sampleRate)));
  const comps = bands.map((b) => new BandCompressor(b, sampleRate));
  const BLOCK = 4096;
  const low = ch.map(() => new Float32Array(BLOCK));
  const mid = ch.map(() => new Float32Array(BLOCK));
  const high = ch.map(() => new Float32Array(BLOCK));
  const powIn = [0, 0, 0], powOut = [0, 0, 0];
  for (let s = 0; s < n; s += BLOCK) {
    const len = Math.min(BLOCK, n - s);
    for (let c = 0; c < nc; c++) {
      const x = ch[c];
      for (let i = 0; i < len; i++) { low[c][i] = x[s + i]; mid[c][i] = x[s + i]; }
      lp1[c].run(low[c], 0, len);
      ap2[c].run(low[c], 0, len);
      hp1[c].run(mid[c], 0, len);
      high[c].set(mid[c].subarray(0, len));
      lp2[c].run(mid[c], 0, len);
      hp2[c].run(high[c], 0, len);
    }
    // banda com razão 1 não comprime: nem passa pelo detector
    const parts = [low, mid, high];
    for (let b = 0; b < 3; b++) {
      if (!(bands[b].ratio > 1)) continue;
      powIn[b] += power(parts[b], len);
      comps[b].run(parts[b], 0, len);
      powOut[b] += power(parts[b], len);
    }
    for (let c = 0; c < nc; c++) {
      const x = ch[c];
      for (let i = 0; i < len; i++) x[s + i] = low[c][i] + mid[c][i] + high[c][i];
    }
  }
  const loss = (b: number) => (powOut[b] > 0 && powIn[b] > 0 ? 10 * Math.log10(powIn[b] / powOut[b]) : 0);
  return { comps, lossDb: [loss(0), loss(1), loss(2)] };
}

function power(chs: Float32Array[], len: number): number {
  let p = 0;
  for (const x of chs) for (let i = 0; i < len; i++) p += x[i] * x[i];
  return p;
}

/** Compressor de banda larga no lugar (stems e voz). */
export function widebandCompress(ch: Float32Array[], sampleRate: number, settings: BandSettings): BandCompressor {
  const comp = new BandCompressor(settings, sampleRate);
  comp.run(ch, 0, ch[0]?.length ?? 0);
  return comp;
}

// ---------------------------------------------------------------- medidas em blocos

export const LIMIT_BLOCK = 16;

/**
 * Pico real (sobreamostragem 4×) de cada bloco de 16 amostras, de todos os canais juntos.
 * O valor entre a última amostra de um bloco e a primeira do seguinte conta no primeiro.
 */
export function truePeakBlocks(ch: Float32Array[], block = LIMIT_BLOCK, floor = 0.02): Float32Array {
  const n = ch[0]?.length ?? 0;
  const nb = Math.ceil(n / block);
  const out = new Float32Array(nb);
  const half = TP_TAPS / 2;
  const h1 = tpKernel[1], h2 = tpKernel[2], h3 = tpKernel[3];
  for (const x of ch) {
    for (let i = 0; i < n; i++) {
      let v = x[i] < 0 ? -x[i] : x[i];
      const b = i + 1 < n ? Math.abs(x[i + 1]) : 0;
      // entre amostras: só onde a vizinhança tem nível que pode chegar ao teto
      if (v > floor || b > floor) {
        const base = i - half + 1;
        let a1 = 0, a2 = 0, a3 = 0;
        if (base >= 0 && base + TP_TAPS <= n) {
          for (let t = 0; t < TP_TAPS; t++) { const s = x[base + t]; a1 += s * h1[t]; a2 += s * h2[t]; a3 += s * h3[t]; }
        } else {
          for (let t = 0; t < TP_TAPS; t++) {
            const k = base + t;
            if (k < 0 || k >= n) continue;
            const s = x[k]; a1 += s * h1[t]; a2 += s * h2[t]; a3 += s * h3[t];
          }
        }
        if (a1 < 0) a1 = -a1;
        if (a2 < 0) a2 = -a2;
        if (a3 < 0) a3 = -a3;
        if (a1 > v) v = a1;
        if (a2 > v) v = a2;
        if (a3 > v) v = a3;
      }
      const j = (i / block) | 0;
      if (v > out[j]) out[j] = v;
    }
  }
  return out;
}

// Conferência fina do pico real: 8× com sinc de 32 taps por fase e janela de Kaiser (β = 8),
// mais exata que o medidor de 4× (alguns medidores acham até 0,2 dB a mais que ele).
const P8 = 8;
const T8 = 32;
const kernel8: Float64Array[] = (() => {
  const beta = 8;
  const bessel = (x: number) => { let s = 1, t = 1; for (let k = 1; k < 30; k++) { t *= (x / (2 * k)) ** 2; s += t; } return s; };
  const half = T8 / 2;
  const out: Float64Array[] = [];
  for (let p = 0; p < P8; p++) {
    const h = new Float64Array(T8);
    for (let k = 0; k < T8; k++) {
      const x = k - half + 1 - p / P8;
      const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
      const r = x / half;
      h[k] = sinc * (Math.abs(r) >= 1 ? 0 : bessel(beta * Math.sqrt(1 - r * r)) / bessel(beta));
    }
    // ganho 1 em cada fase (como o medidor de 4×): sem isso os agudos leem a mais
    let sum = 0;
    for (let k = 0; k < T8; k++) sum += h[k];
    for (let k = 0; k < T8; k++) h[k] /= sum;
    out.push(h);
  }
  return out;
})();

/** Pico real fino (8×) de cada bloco, só onde alguma amostra vizinha passa de `near`. */
export function truePeakBlocksPrecise(ch: Float32Array[], block = LIMIT_BLOCK, near = 0): Float32Array {
  const n = ch[0]?.length ?? 0;
  const out = new Float32Array(Math.ceil(n / block));
  const half = T8 / 2;
  for (const x of ch) {
    for (let i = 0; i < n; i++) {
      let v = Math.abs(x[i]);
      if (v >= near || (i + 1 < n && Math.abs(x[i + 1]) >= near)) {
        const base = i - half + 1;
        for (let p = 1; p < P8; p++) {
          const h = kernel8[p];
          let acc = 0;
          for (let t = 0; t < T8; t++) {
            const k = base + t;
            if (k >= 0 && k < n) acc += x[k] * h[t];
          }
          const a = Math.abs(acc);
          if (a > v) v = a;
        }
      }
      const j = (i / block) | 0;
      if (v > out[j]) out[j] = v;
    }
  }
  return out;
}

/** Pico real fino (linear). Só calcula entre amostras onde alguma vizinha passa de `near`. */
export function truePeakPrecise(ch: ArrayLike<number>[], near = 0): number {
  let peak = 0;
  const half = T8 / 2;
  for (const x of ch) {
    const n = x.length;
    for (let i = 0; i < n; i++) {
      const a = Math.abs(x[i]);
      if (a > peak) peak = a;
      if (a < near && (i + 1 >= n || Math.abs(x[i + 1]) < near)) continue;
      const base = i - half + 1;
      for (let p = 1; p < P8; p++) {
        const h = kernel8[p];
        let acc = 0;
        for (let t = 0; t < T8; t++) {
          const k = base + t;
          if (k >= 0 && k < n) acc += x[k] * h[t];
        }
        const v = Math.abs(acc);
        if (v > peak) peak = v;
      }
    }
  }
  return peak;
}

/** Potência ponderada K (soma dos canais, soma das amostras) de cada bloco. */
export function kPowerBlocks(ch: Float32Array[], sampleRate: number, block = LIMIT_BLOCK): Float64Array {
  const n = ch[0]?.length ?? 0;
  const nb = Math.ceil(n / block);
  const out = new Float64Array(nb);
  const CH = block * 256;
  const tmp = new Float32Array(CH);
  for (const x of ch) {
    const k = new FilterChain(kWeighting(sampleRate));
    for (let s = 0; s < n; s += CH) {
      const len = Math.min(CH, n - s);
      tmp.set(x.subarray(s, s + len));
      k.run(tmp, 0, len);
      for (let b = 0, j = s / block; b < len; b += block, j++) {
        const e = Math.min(len, b + block);
        let acc = 0;
        for (let i = b; i < e; i++) acc += tmp[i] * tmp[i];
        out[j] += acc;
      }
    }
  }
  return out;
}

/** Loudness integrado (BS.1770) a partir das potências K por bloco, com ganho por bloco. */
export function loudnessFromBlocks(kpow: Float64Array, sampleRate: number, gainSq?: (j: number) => number, block = LIMIT_BLOCK): number {
  const chunkLen = 0.1 * sampleRate;
  const nChunks = Math.floor((kpow.length * block) / chunkLen);
  if (nChunks < 1) {
    let s = 0;
    for (let j = 0; j < kpow.length; j++) s += kpow[j] * (gainSq ? gainSq(j) : 1);
    const p = s / Math.max(1, kpow.length * block);
    return p > 0 ? -0.691 + 10 * Math.log10(p) : -Infinity;
  }
  const chunks = new Float64Array(nChunks);
  for (let j = 0; j < kpow.length; j++) {
    const c = Math.floor((j * block) / chunkLen);
    if (c >= nChunks) break;
    chunks[c] += kpow[j] * (gainSq ? gainSq(j) : 1);
  }
  for (let c = 0; c < nChunks; c++) chunks[c] /= chunkLen;
  return gatedLoudness(chunks);
}

/** Loudness integrado (BS.1770) sem alocar cópias do áudio inteiro. */
export function loudnessLean(ch: Float32Array[], sampleRate: number): number {
  return loudnessFromBlocks(kPowerBlocks(ch, sampleRate), sampleRate);
}

/** Gate do BS.1770 sobre pedaços de 100 ms (blocos de 400 ms com 75% de sobreposição). */
export function gatedLoudness(chunks: Float64Array): number {
  const lufs = (p: number) => -0.691 + 10 * Math.log10(p);
  const blocks: number[] = [];
  if (chunks.length < 4) {
    let s = 0;
    for (const v of chunks) s += v;
    const p = s / Math.max(1, chunks.length);
    return p > 0 ? lufs(p) : -Infinity;
  }
  for (let i = 0; i + 4 <= chunks.length; i++) blocks.push((chunks[i] + chunks[i + 1] + chunks[i + 2] + chunks[i + 3]) / 4);
  let sum = 0, count = 0;
  for (const p of blocks) if (p > 0 && lufs(p) > -70) { sum += p; count++; }
  if (!count) return -Infinity;
  const rel = lufs(sum / count) - 10;
  sum = 0; count = 0;
  for (const p of blocks) if (p > 0 && lufs(p) > -70 && lufs(p) > rel) { sum += p; count++; }
  return count ? lufs(sum / count) : -Infinity;
}

// ---------------------------------------------------------------- limitador

export interface LimiterOptions {
  /** Look-ahead (s): a descida do ganho começa esse tempo antes do pico. */
  lookahead?: number;
  /** Release rápido (picos isolados) e lento (trechos densos), em segundos. */
  releaseFast?: number;
  releaseSlow?: number;
  /** Ataque da envoltória lenta (s): quanto tempo a redução precisa durar para ser "sustentada" */
  slowAttack?: number;
}

/**
 * Ganho do limitador por bloco (comprimento nb + 1, o último é o fim) para um ganho de entrada
 * `inputGain`: nenhum bloco passa de `ceiling` (true peak, linear). A descida é em S (duas médias
 * móveis sobre o mínimo à frente) e o release fica mais lento quanto mais o limitador vem
 * trabalhando (picos isolados voltam rápido; trecho denso não "bombeia").
 */
export function limiterGains(peaks: Float32Array, sampleRate: number, inputGain: number, ceiling: number, options?: LimiterOptions, block = LIMIT_BLOCK): Float32Array {
  const nb = peaks.length;
  const need = new Float32Array(nb + 1).fill(1);
  for (let j = 0; j < nb; j++) {
    const p = peaks[j] * inputGain;
    need[j] = p > ceiling ? ceiling / p : 1;
  }
  // a interpolação entre blocos não pode passar do que o bloco anterior pede
  for (let j = nb; j >= 1; j--) if (need[j - 1] < need[j]) need[j] = need[j - 1];
  const la = Math.max(2, Math.round(((options?.lookahead ?? 0.005) * sampleRate) / block));
  const la1 = Math.ceil(la / 2), la2 = la - la1 + 1;
  const hold = la1 + la2;
  const m = nb + 1;
  // mínimo à frente (fila monotônica)
  const ahead = new Float32Array(m);
  const dq = new Int32Array(m);
  let head = 0, tail = 0;
  for (let j = m - 1; j >= 0; j--) {
    while (tail > head && need[dq[tail - 1]] >= need[j]) tail--;
    dq[tail++] = j;
    while (dq[head] > j + hold) head++;
    ahead[j] = need[dq[head]];
  }
  // duas médias móveis (descida em S); antes do começo vale o primeiro valor (a música pode
  // já começar forte e não haveria tempo de descer)
  const smooth = (src: Float32Array, len: number) => {
    const out = new Float32Array(m);
    const first = src[0];
    let acc = len * first;
    for (let j = 0; j < m; j++) {
      acc += src[j] - (j >= len ? src[j - len] : first);
      out[j] = Math.min(1, acc / len);
    }
    return out;
  };
  const s2 = smooth(smooth(ahead, la1), la2);
  // release duplo: uma envoltória lenta acompanha só a redução sustentada (ataque de 80 ms, um
  // pico curto quase não a move) e o ganho volta rápido até ela. Picos isolados (bumbo, caixa)
  // voltam em ~30 ms e quase não tiram volume; trecho denso fica com redução estável, sem
  // modular o grave a cada batida.
  const dt = block / sampleRate;
  const rFast = Math.exp(-dt / (options?.releaseFast ?? 0.03));
  const sAtt = Math.exp(-dt / (options?.slowAttack ?? 0.08));
  const sRel = Math.exp(-dt / (options?.releaseSlow ?? 0.4));
  // redução "sustentada" = a menor redução dos últimos 50 ms (máximo do ganho na janela):
  // um pico isolado não puxa a envoltória lenta, só trechos em que o limitador não para
  const win = Math.max(1, Math.round(0.05 / dt));
  const sustained = new Float32Array(m);
  {
    const q = new Int32Array(m);
    let h = 0, t = 0;
    for (let j = 0; j < m; j++) {
      while (t > h && s2[q[t - 1]] <= s2[j]) t--;
      q[t++] = j;
      while (q[h] <= j - win) h++;
      sustained[j] = s2[q[h]];
    }
  }
  const g = new Float32Array(m);
  let cur = s2[0], slowEnv = 1;
  for (let j = 0; j < m; j++) {
    const target = s2[j];
    const sus = sustained[j];
    slowEnv = sus + (slowEnv - sus) * (sus < slowEnv ? sAtt : sRel);
    if (target < cur) cur = target;
    else {
      const to = Math.min(target, slowEnv);
      cur = to + (cur - to) * rFast;
    }
    g[j] = cur;
  }
  return g;
}

/** Aplica ganho fixo × ganho do limitador (interpolado dentro de cada bloco), no lugar. */
export function applyBlockGains(ch: Float32Array[], gains: Float32Array, inputGain: number, block = LIMIT_BLOCK): void {
  const n = ch[0]?.length ?? 0;
  const nb = Math.ceil(n / block);
  const last = gains.length - 1;
  for (const x of ch) {
    for (let j = 0; j < nb; j++) {
      const g0 = gains[j] * inputGain;
      const g1 = gains[j + 1 > last ? last : j + 1] * inputGain;
      const d = (g1 - g0) / block;
      const s = j * block;
      const e = s + block < n ? s + block : n;
      let g = g0;
      for (let i = s; i < e; i++) { x[i] *= g; g += d; }
    }
  }
}

/** Ganho linear de dB, para quem importa só este módulo. */
export const db = dbToGain;
