// Medição e controle de volume no padrão das plataformas e do broadcast:
//  - loudness integrado em LUFS (ITU-R BS.1770-4 / EBU R128): filtro K, blocos de 400 ms com
//    75% de sobreposição, gate absoluto em -70 LUFS e gate relativo de -10 LU;
//  - true peak (pico real entre amostras) por sobreamostragem 4×;
//  - limitador com look-ahead: a redução começa antes do pico chegar, sem cortar a onda
//    (nada de saturação ou "clipper"), com release suave.
// Sem dependências do navegador: roda igual no app, na exportação e nos testes do Node.

export interface Biquad { b0: number; b1: number; b2: number; a1: number; a2: number }

/** Coeficientes do filtro K (BS.1770) para qualquer taxa de amostragem. */
export function kWeighting(sampleRate: number): [Biquad, Biquad] {
  // estágio 1: shelf de cabeça (~+4 dB acima de ~1,5 kHz)
  let f0 = 1681.974450955533;
  const G = 3.999843853973347;
  let Q = 0.7071752369554196;
  let K = Math.tan((Math.PI * f0) / sampleRate);
  const Vh = Math.pow(10, G / 20);
  const Vb = Math.pow(Vh, 0.4996667741545416);
  let a0 = 1 + K / Q + K * K;
  const shelf: Biquad = {
    b0: (Vh + (Vb * K) / Q + K * K) / a0,
    b1: (2 * (K * K - Vh)) / a0,
    b2: (Vh - (Vb * K) / Q + K * K) / a0,
    a1: (2 * (K * K - 1)) / a0,
    a2: (1 - K / Q + K * K) / a0,
  };
  // estágio 2: passa-altas RLB (~38 Hz)
  f0 = 38.13547087602444;
  Q = 0.5003270373238773;
  K = Math.tan((Math.PI * f0) / sampleRate);
  a0 = 1 + K / Q + K * K;
  const hp: Biquad = {
    b0: 1,
    b1: -2,
    b2: 1,
    a1: (2 * (K * K - 1)) / a0,
    a2: (1 - K / Q + K * K) / a0,
  };
  return [shelf, hp];
}

function filterInPlace(x: Float32Array, f: Biquad): void {
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const x0 = x[i];
    const y0 = f.b0 * x0 + f.b1 * x1 + f.b2 * x2 - f.a1 * y1 - f.a2 * y2;
    x2 = x1; x1 = x0; y2 = y1; y1 = y0;
    x[i] = y0;
  }
}

/** Canais em float (-1..1). Int16 também é aceito (convertido). */
export type Channels = ArrayLike<number>[];

function toFloat(ch: ArrayLike<number>, scale: number): Float32Array {
  const out = new Float32Array(ch.length);
  for (let i = 0; i < ch.length; i++) out[i] = ch[i] * scale;
  return out;
}

function scaleOf(ch: ArrayLike<number>): number {
  return ch instanceof Int16Array ? 1 / 32767 : 1;
}

/**
 * Loudness integrado (LUFS). -Infinity para silêncio. Para estéreo/mono (os únicos formatos do
 * app) os pesos de canal são 1. Mono conta como os dois lados iguais (-3 LU a menos que o estéreo
 * idêntico, como manda a norma).
 */
export function integratedLoudness(channels: Channels, sampleRate: number): number {
  if (channels.length === 0 || channels[0].length === 0) return -Infinity;
  const [shelf, hp] = kWeighting(sampleRate);
  const block = Math.round(0.4 * sampleRate);
  const hop = Math.round(0.1 * sampleRate);
  const n = channels[0].length;
  if (n < block) {
    // trecho curto: um bloco só com o que existe
    return blockLoudnessOfWhole(channels, sampleRate);
  }
  const nBlocks = Math.floor((n - block) / hop) + 1;
  const power = new Float64Array(nBlocks);
  for (const ch of channels) {
    const x = toFloat(ch, scaleOf(ch));
    filterInPlace(x, shelf);
    filterInPlace(x, hp);
    // somas acumuladas de x² para cada bloco sem recalcular
    const sq = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) sq[i + 1] = sq[i] + x[i] * x[i];
    for (let b = 0; b < nBlocks; b++) {
      const s = b * hop;
      power[b] += (sq[s + block] - sq[s]) / block;
    }
  }
  return gate(power);
}

function blockLoudnessOfWhole(channels: Channels, sampleRate: number): number {
  const [shelf, hp] = kWeighting(sampleRate);
  let p = 0;
  for (const ch of channels) {
    const x = toFloat(ch, scaleOf(ch));
    filterInPlace(x, shelf);
    filterInPlace(x, hp);
    let s = 0;
    for (let i = 0; i < x.length; i++) s += x[i] * x[i];
    p += s / Math.max(1, x.length);
  }
  return p > 0 ? -0.691 + 10 * Math.log10(p) : -Infinity;
}

function gate(power: Float64Array): number {
  const lufs = (p: number) => -0.691 + 10 * Math.log10(p);
  let sum = 0; let count = 0;
  for (const p of power) if (p > 0 && lufs(p) > -70) { sum += p; count++; }
  if (count === 0) return -Infinity;
  const relative = lufs(sum / count) - 10;
  sum = 0; count = 0;
  for (const p of power) if (p > 0 && lufs(p) > -70 && lufs(p) > relative) { sum += p; count++; }
  return count === 0 ? -Infinity : lufs(sum / count);
}

// Sobreamostragem 4× por FIR (sinc com janela de Kaiser), como os medidores de true peak.
const TP_TAPS = 12; // por fase
const TP_PHASES = 4;
const tpKernel: Float32Array[] = (() => {
  const phases: Float32Array[] = [];
  const beta = 6;
  const bessel = (x: number) => { let s = 1, t = 1; for (let k = 1; k < 25; k++) { t *= (x / (2 * k)) ** 2; s += t; } return s; };
  const half = TP_TAPS / 2;
  for (let p = 0; p < TP_PHASES; p++) {
    const h = new Float32Array(TP_TAPS);
    let sum = 0;
    for (let k = 0; k < TP_TAPS; k++) {
      const x = k - half + 1 - p / TP_PHASES;
      const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
      const r = x / half;
      const w = Math.abs(r) >= 1 ? 0 : bessel(beta * Math.sqrt(1 - r * r)) / bessel(beta);
      h[k] = sinc * w;
      sum += h[k];
    }
    for (let k = 0; k < TP_TAPS; k++) h[k] /= sum;
    phases.push(h);
  }
  return phases;
})();

/** Pico real entre amostras (linear). */
export function truePeak(channels: Channels): number {
  let peak = 0;
  for (const ch of channels) {
    const k = scaleOf(ch);
    const n = ch.length;
    for (let i = 0; i < n; i++) {
      const v = Math.abs(ch[i] * k);
      if (v > peak) peak = v;
    }
    // só vale olhar entre amostras onde o sinal já está alto
    const threshold = peak * 0.5;
    for (let i = TP_TAPS; i < n - TP_TAPS; i++) {
      if (Math.abs(ch[i] * k) < threshold && Math.abs(ch[i + 1] * k) < threshold) continue;
      for (let p = 1; p < TP_PHASES; p++) {
        const h = tpKernel[p];
        let acc = 0;
        const base = i - TP_TAPS / 2 + 1;
        for (let t = 0; t < TP_TAPS; t++) acc += ch[base + t] * k * h[t];
        const v = Math.abs(acc);
        if (v > peak) peak = v;
      }
    }
  }
  return peak;
}

export const dbToGain = (db: number) => Math.pow(10, db / 20);
export const gainToDb = (g: number) => (g > 0 ? 20 * Math.log10(g) : -Infinity);

/**
 * Limitador com look-ahead aplicado no lugar (canais float). O ganho é calculado sobre o pico
 * dos próximos `lookahead` segundos de todos os canais juntos (o estéreo não "anda"), desce a
 * tempo do pico e volta com release exponencial. Devolve a maior redução aplicada (dB, ≤ 0).
 */
export function lookaheadLimit(channels: Float32Array[], sampleRate: number, ceiling: number, options?: { lookahead?: number; release?: number }): number {
  const n = channels[0]?.length ?? 0;
  if (n === 0) return 0;
  const la = Math.max(1, Math.round((options?.lookahead ?? 0.005) * sampleRate));
  const rel = Math.exp(-1 / ((options?.release ?? 0.08) * sampleRate));
  // pico de todos os canais por amostra, com margem para o pico entre amostras
  const peak = new Float32Array(n);
  for (const ch of channels) for (let i = 0; i < n; i++) { const v = Math.abs(ch[i]); if (v > peak[i]) peak[i] = v; }
  // ganho necessário em cada amostra
  const need = new Float32Array(n);
  for (let i = 0; i < n; i++) need[i] = peak[i] > ceiling ? ceiling / peak[i] : 1;
  // mínimo numa janela à frente (fila monotônica): o ganho já está baixo quando o pico chega
  const minAhead = new Float32Array(n);
  const dq = new Int32Array(n);
  let head = 0, tail = 0;
  for (let i = n - 1; i >= 0; i--) {
    while (tail > head && need[dq[tail - 1]] >= need[i]) tail--;
    dq[tail++] = i;
    while (dq[head] > i + la) head++;
    minAhead[i] = need[dq[head]];
  }
  // média móvel do mínimo: a descida vira uma rampa de `la` amostras e, no instante do pico,
  // todas as amostras da média já estão no ganho exigido por ele (nunca passa do teto)
  let g = 1;
  let worst = 1;
  let acc = 0;
  const ring = new Float32Array(la).fill(1);
  let r = 0;
  acc = la;
  for (let i = 0; i < n; i++) {
    acc += minAhead[i] - ring[r];
    ring[r] = minAhead[i];
    r = (r + 1) % la;
    const smooth = Math.min(1, acc / la);
    // release: ao voltar, sobe aos poucos (fica sempre abaixo do suavizado, nunca acima)
    g = smooth < g ? smooth : smooth + (g - smooth) * rel;
    if (g < worst) worst = g;
    for (const ch of channels) ch[i] *= g;
  }
  return gainToDb(worst);
}

/** Ganho para levar `lufs` ao alvo sem o true peak passar do teto (dBTP). */
export function matchGain(lufs: number, peak: number, targetLufs: number, ceilingDbtp: number): number {
  if (!Number.isFinite(lufs) || peak <= 0) return 1;
  const wanted = dbToGain(targetLufs - lufs);
  const allowed = dbToGain(ceilingDbtp) / peak;
  return Math.min(wanted, allowed);
}
