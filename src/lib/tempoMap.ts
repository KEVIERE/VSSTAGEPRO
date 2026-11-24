// Mapa de andamento de uma faixa inteira: trechos de BPM constante, a partir dos ataques e das ativações do modelo de batidas.

export interface TempoSection { start: number; end: number; bpm: number; firstBeat: number; barPhase: number; barMargin: number; confidence: number; beatsPerBar?: number }

const ENV_FPS = 200;
let envFps = 200;
const TEMPO_STEP = 2;
const MIN_BPM = 70;
const MAX_BPM = 180;
const WINDOW_SEC = 16;
const MIN_SECTION_SEC = 12;
const SAME_TEMPO = 0.012;
const MIN_PULSE = 1.45;

export function onsetEnvelope(mono: Float32Array, sr: number): { env: Float32Array; low: Float32Array; high: Float32Array } {
  const hop = Math.max(1, Math.round(sr / ENV_FPS));
  envFps = sr / hop;
  const frames = Math.floor(mono.length / hop);
  const lowE = new Float32Array(frames);
  const highE = new Float32Array(frames);
  const aLow = 1 - Math.exp(-2 * Math.PI * 150 / sr);
  const aHigh = 1 - Math.exp(-2 * Math.PI * 2000 / sr);
  let lpL = 0, lpH = 0;
  for (let f = 0; f < frames; f++) {
    let l = 0, h = 0;
    for (let i = f * hop, e = i + hop; i < e; i++) {
      const v = mono[i];
      lpL += aLow * (v - lpL);
      lpH += aHigh * (v - lpH);
      const hp = v - lpH;
      l += lpL * lpL;
      h += hp * hp;
    }
    lowE[f] = Math.log1p(1000 * Math.sqrt(l / hop));
    highE[f] = Math.log1p(1000 * Math.sqrt(h / hop));
  }
  const env = new Float32Array(frames);
  const low = new Float32Array(frames);
  const high = new Float32Array(frames);
  for (let f = 1; f < frames; f++) {
    const dl = Math.max(0, lowE[f] - lowE[f - 1]);
    const dh = Math.max(0, highE[f] - highE[f - 1]);
    low[f] = dl;
    high[f] = dh;
    env[f] = dl + dh;
  }
  // tira a média local: trecho alto e trecho baixo pesam igual
  const reach = ENV_FPS / 2;
  let sum = 0;
  const out = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    sum += env[f];
    if (f > 2 * reach) sum -= env[f - 2 * reach - 1];
    const n = Math.min(f + 1, 2 * reach + 1);
    if (f >= reach) out[f - reach] = Math.max(0, env[f - reach] - sum / n);
  }
  return { env: out, low, high };
}

function tempoStates(): number[] {
  const s: number[] = [];
  for (let b = MIN_BPM; b <= MAX_BPM; b += 0.5) s.push(b);
  return s;
}

/** Quanto os ataques da janela se concentram numa grade desse BPM (1 = nada, maior = grade clara). */
function combScore(e: Float32Array, from: number, to: number, bpm: number, fps: number): number {
  const P = (60 / bpm) * fps;
  const B = 32;
  const h = new Float32Array(B), c = new Uint16Array(B);
  for (let f = from; f < to; f++) {
    const x = f / P;
    const i = Math.floor((x - Math.floor(x)) * B);
    h[i] += e[f]; c[i]++;
  }
  let total = 0, best = 0;
  for (let i = 0; i < B; i++) { h[i] = c[i] ? h[i] / c[i] : 0; total += h[i]; }
  for (let i = 0; i < B; i++) best = Math.max(best, h[i] + 0.5 * (h[(i + 1) % B] + h[(i + B - 1) % B]));
  return best / 2 / (total / B + 1e-9);
}

/** Força de cada andamento em cada 2 s da faixa. */
function tempogram(env: Float32Array, states: number[]): Float32Array[] {
  const fps = envFps;
  const win = Math.round(WINDOW_SEC * fps);
  const step = Math.round(TEMPO_STEP * fps);
  const out: Float32Array[] = [];
  for (let start = 0; ; start += step) {
    const end = Math.min(env.length, start + win);
    const row = new Float32Array(states.length);
    for (let s = 0; s < states.length; s++) row[s] = Math.max(0, combScore(env, start, end, states[s], fps) - 1);
    let m = 0;
    for (const v of row) m = Math.max(m, v);
    if (m > 0) for (let i = 0; i < row.length; i++) row[i] /= m;
    out.push(row);
    if (end >= env.length) break;
  }
  return out;
}

/** Melhor caminho de andamento: só troca quando a troca se paga por vários segundos. */
function bestPath(gram: Float32Array[], switchCost = 2.2, driftCost = 0.4): number[] {
  const S = gram[0].length;
  const T = gram.length;
  let prev = Float32Array.from(gram[0]);
  const back: Int16Array[] = [];
  for (let t = 1; t < T; t++) {
    const cur = new Float32Array(S);
    const b = new Int16Array(S);
    let gBest = 0;
    for (let s = 1; s < S; s++) if (prev[s] > prev[gBest]) gBest = s;
    for (let s = 0; s < S; s++) {
      let v = prev[s], from = s;
      if (s > 0 && prev[s - 1] - driftCost > v) { v = prev[s - 1] - driftCost; from = s - 1; }
      if (s < S - 1 && prev[s + 1] - driftCost > v) { v = prev[s + 1] - driftCost; from = s + 1; }
      if (prev[gBest] - switchCost > v) { v = prev[gBest] - switchCost; from = gBest; }
      cur[s] = v + gram[t][s];
      b[s] = from;
    }
    back.push(b);
    prev = cur;
  }
  let s = 0;
  for (let i = 1; i < S; i++) if (prev[i] > prev[s]) s = i;
  const path = new Array<number>(T);
  path[T - 1] = s;
  for (let t = T - 1; t > 0; t--) { s = back[t - 1][s]; path[t - 1] = s; }
  return path;
}

const median = (v: number[]) => { const a = [...v].sort((x, y) => x - y); return a[Math.floor(a.length / 2)]; };
const sameTempo = (a: number, b: number) => {
  const r = Math.max(a, b) / Math.min(a, b);
  return r < 1 + SAME_TEMPO || Math.abs(r - 2) < 2 * SAME_TEMPO;
};

/** Ajuste fino: BPM e fase que mais caem em cima dos ataques do trecho. */
function fitGrid(env: Float32Array, a: number, b: number, guess: number): { bpm: number; t0: number; score: number } {
  const evalBpm = (bpm: number) => {
    const p = 60 / bpm;
    const phases = 48;
    let best = -1, bestPh = 0, total = 0;
    for (let ph = 0; ph < phases; ph++) {
      const off = (ph / phases) * p;
      let sum = 0, n = 0;
      for (let t = a + off; t < b; t += p) { sum += beatValue(env, t); n++; }
      const v = sum / Math.max(1, n);
      total += v;
      if (v > best) { best = v; bestPh = off; }
    }
    return { score: best / (total / phases + 1e-9), phase: bestPh };
  };
  let bestBpm = guess, top = evalBpm(guess);
  for (let bpm = guess * 0.97; bpm <= guess * 1.03; bpm += 0.1) {
    const r = evalBpm(bpm);
    if (r.score > top.score) { top = r; bestBpm = bpm; }
  }
  for (let bpm = bestBpm - 0.1; bpm <= bestBpm + 0.1; bpm += 0.01) {
    const r = evalBpm(bpm);
    if (r.score > top.score) { top = r; bestBpm = bpm; }
  }
  const rounded = Math.round(bestBpm);
  const rr = evalBpm(rounded);
  if (Math.abs(bestBpm - rounded) < 0.2 && rr.score >= top.score * 0.975) { top = rr; bestBpm = rounded; }
  return { bpm: bestBpm, t0: a + top.phase, score: top.score };
}

function beatValue(env: Float32Array, t: number): number {
  const c = Math.round(t * envFps);
  let m = 0;
  for (let i = c - 2; i <= c + 2; i++) if (i >= 0 && i < env.length && env[i] > m) m = env[i];
  return m;
}

/** Ponto de troca: o instante até onde os ataques combinam mais com a grade A do que com a B. */
function refineSplit(env: Float32Array, approx: number, A: { bpm: number; t0: number }, B: { bpm: number; t0: number }): number {
  const reach = 12;
  const lo = Math.max(0, Math.floor((approx - reach) * envFps)), hi = Math.min(env.length, Math.floor((approx + reach) * envFps));
  const pA = (60 / A.bpm) * envFps, pB = (60 / B.bpm) * envFps;
  const oA = A.t0 * envFps, oB = B.t0 * envFps;
  const near = (f: number, o: number, p: number) => { const x = (f - o) / p; return Math.abs(x - Math.round(x)) * p <= 2.5; };
  let cum = 0, best = 0, bestF = lo;
  for (let f = lo; f < hi; f++) {
    cum += env[f] * ((near(f, oA, pA) ? pA / 5 : 0) - (near(f, oB, pB) ? pB / 5 : 0));
    if (cum > best) { best = cum; bestF = f; }
  }
  const t = bestF / envFps, p = 60 / B.bpm;
  return B.t0 + Math.ceil((t - B.t0) / p - 1e-6) * p;
}

// ---------- Espectro leve: harmonia (acordes), baixo e timbre, em poucos números por quadro ----------
const N_FFT = 2048;
export function fft(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}
interface Spec { fps: number; chroma: Float32Array[]; bass: Float32Array[]; bands: Float32Array[] }
export function spectralFeatures(mono: Float32Array, sr: number): Spec {
  const hop = Math.round(sr / 25);
  const frames = Math.max(0, Math.floor((mono.length - N_FFT) / hop));
  const hann = new Float64Array(N_FFT);
  for (let i = 0; i < N_FFT; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N_FFT);
  const pitch = new Int8Array(N_FFT / 2), band = new Int8Array(N_FFT / 2);
  for (let k = 1; k < N_FFT / 2; k++) {
    const hz = (k * sr) / N_FFT;
    pitch[k] = hz < 55 || hz > 2000 ? -1 : ((Math.round(12 * Math.log2(hz / 440)) % 12) + 12) % 12;
    band[k] = Math.min(23, Math.floor(4 * Math.log2(Math.max(hz, 40) / 40)));
  }
  const chroma: Float32Array[] = [], bass: Float32Array[] = [], bands: Float32Array[] = [];
  const re = new Float64Array(N_FFT), im = new Float64Array(N_FFT);
  for (let f = 0; f < frames; f++) {
    for (let i = 0; i < N_FFT; i++) { re[i] = mono[f * hop + i] * hann[i]; im[i] = 0; }
    fft(re, im);
    const c = new Float32Array(12), b = new Float32Array(12), e = new Float32Array(24);
    for (let k = 1; k < N_FFT / 2; k++) {
      const m = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
      e[band[k]] += m;
      if (pitch[k] >= 0) { c[pitch[k]] += m; if ((k * sr) / N_FFT < 220) b[pitch[k]] += m; }
    }
    for (let i = 0; i < 24; i++) e[i] = Math.log1p(e[i]);
    chroma.push(c); bass.push(b); bands.push(e);
  }
  return { fps: sr / hop, chroma, bass, bands };
}
function meanVec(v: Float32Array[], a: number, b: number): Float32Array {
  const n = v[0]?.length ?? 0, o = new Float32Array(n);
  const x = Math.max(0, a), y = Math.min(v.length, Math.max(b, a + 1));
  for (let f = x; f < y; f++) for (let i = 0; i < n; i++) o[i] += v[f][i];
  return o;
}
function cosDist(a: Float32Array, b: Float32Array): number {
  let d = 0, x = 0, y = 0;
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; x += a[i] * a[i]; y += b[i] * b[i]; }
  return x > 0 && y > 0 ? 1 - d / Math.sqrt(x * y) : 0;
}
function zscore(v: number[]): number[] {
  const m = v.reduce((a, b) => a + b, 0) / Math.max(1, v.length);
  const sd = Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, v.length)) || 1;
  return v.map((x) => (x - m) / sd);
}

/** Qual tempo é o 1: acorde e baixo mudam nele, bumbo cai nele e a caixa cai no 2 e no 4. */
function barPhase(fx: { low: Float32Array; high: Float32Array; spec: Spec }, start: number, end: number, bpm: number, bpb: number): { phase: number; margin: number } {
  const p = 60 / bpm, { spec } = fx;
  const beats: number[] = [];
  for (let t = start; t < end; t += p) beats.push(t);
  const at = (t: number) => Math.round(t * spec.fps);
  const change = (v: Float32Array[]) => beats.map((t) => cosDist(meanVec(v, at(t - p), at(t)), meanVec(v, at(t), at(t + p))));
  const harm = zscore(change(spec.chroma)), bassCh = zscore(change(spec.bass));
  const kick = zscore(beats.map((t) => beatValue(fx.low, t))), snare = zscore(beats.map((t) => beatValue(fx.high, t)));
  const score = new Array(bpb).fill(0);
  beats.forEach((_, k) => {
    for (let ph = 0; ph < bpb; ph++) {
      const pos = (((k - ph) % bpb) + bpb) % bpb;
      if (pos === 0) score[ph] += 1.5 * harm[k] + 1.5 * bassCh[k] + kick[k];
      if (bpb === 4 && pos === 2) score[ph] += 0.4 * kick[k] - 0.3 * harm[k];
      if (bpb === 4 && pos % 2 === 1) score[ph] += 0.6 * snare[k] - 0.3 * kick[k];
    }
  });
  const order = [...score].sort((a, b) => b - a);
  return { phase: score.indexOf(order[0]), margin: (order[0] - order[1]) / Math.max(1, beats.length / bpb) };
}

/** Maior mudança de timbre e harmonia perto de `near`: é onde uma música termina e a outra entra. */
function novelty(spec: Spec, near: number, reach = 7): number {
  const span = Math.round(1.5 * spec.fps);
  const c = Math.round(near * spec.fps), r = Math.round(reach * spec.fps);
  let best = near, top = -1;
  for (let f = Math.max(span, c - r); f <= Math.min(spec.bands.length - span, c + r); f++) {
    const d = cosDist(meanVec(spec.bands, f - span, f), meanVec(spec.bands, f, f + span)) * 40 + cosDist(meanVec(spec.chroma, f - span, f), meanVec(spec.chroma, f, f + span));
    const w = Math.exp(-0.5 * ((f - c) / (3.5 * spec.fps)) ** 2);
    if (d * w > top) { top = d * w; best = f / spec.fps; }
  }
  return best;
}

export interface BeatModel { beat: Float32Array; downbeat: Float32Array; fps: number }

function gateByModel(env: Float32Array, m: BeatModel): Float32Array {
  const out = new Float32Array(env.length);
  for (let f = 0; f < env.length; f++) {
    const c = (f / envFps) * m.fps, i = Math.round(c);
    let v = 0;
    for (let k = i - 1; k <= i + 1; k++) if (k >= 0 && k < m.beat.length && m.beat[k] > v) v = m.beat[k];
    out[f] = env[f] * (0.05 + v);
  }
  return out;
}

function modelPeaks(m: BeatModel, a: number, b: number): number[] {
  const out: number[] = [];
  for (let i = Math.max(3, Math.floor(a * m.fps)); i < Math.min(m.beat.length - 3, b * m.fps); i++) {
    if (m.beat[i] <= 0.5) continue;
    let top = true;
    for (let k = i - 3; k <= i + 3; k++) if (m.beat[k] > m.beat[i]) top = false;
    if (top && (!out.length || i / m.fps - out[out.length - 1] > 0.05)) out.push(i / m.fps);
  }
  return out;
}

/** Troca entre duas grades: o ponto em que as batidas do modelo deixam de cair na A e passam a cair na B. */
let attackEnv: Float32Array | null = null;

/** Batidas do modelo levadas para o ataque real (precisão de 5 ms em vez de 20 ms). */
function preciseBeats(m: BeatModel, lo: number, hi: number): number[] {
  const out: number[] = [];
  for (const t of modelPeaks(m, lo, hi)) {
    if (!attackEnv) { out.push(t); continue; }
    const c = Math.round(t * envFps), r = Math.round(0.03 * envFps);
    let top = -1, at = c;
    for (let f = Math.max(0, c - r); f <= Math.min(attackEnv.length - 1, c + r); f++) if (attackEnv[f] > top) { top = attackEnv[f]; at = f; }
    out.push(at / envFps);
  }
  return out;
}

/** Força média dos ataques em cima da grade, em relação ao que soa em volta, numa janela curta. */
function gridRate(e: Float32Array, g: { bpm: number; t0: number }, a: number, b: number): number {
  const p = 60 / g.bpm, r = Math.max(1, Math.round(0.008 * envFps)), side = Math.round(p * envFps * 0.5);
  let on = 0, around = 1e-9, n = 0;
  for (let k = Math.ceil((a - g.t0) / p); g.t0 + k * p < b; k++) {
    const c = Math.round((g.t0 + k * p) * envFps);
    let m = 0;
    for (let f = c - r; f <= c + r; f++) if (f >= 0 && f < e.length && e[f] > m) m = e[f];
    let s = 0, q = 0;
    for (let f = c - side; f <= c + side; f += 2) if (f >= 0 && f < e.length) { s += e[f]; q++; }
    on += m; around += q ? s / q : 0; n++;
  }
  return n ? on / around : 1;
}

const SPLIT = { w: 8, tol: 0.022 };

/** Troca: maximiza as batidas na grade A antes do ponto e na grade B depois dele. */
function modelSplit(m: BeatModel, spec: Spec, lo: number, hi: number, A: { bpm: number; t0: number }, B: { bpm: number; t0: number }): number {
  void spec;
  const pts = preciseBeats(m, lo, hi);
  const p = 60 / B.bpm;
  if (!pts.length) return B.t0 + Math.ceil(((lo + hi) / 2 - B.t0) / p) * p;
  const near = (t: number, g: { bpm: number; t0: number }) => { const q = 60 / g.bpm; return Math.abs(t - (g.t0 + Math.round((t - g.t0) / q) * q)) < SPLIT.tol; };
  let sum = 0, best = 0, end = -1;
  pts.forEach((t, i) => {
    const a = near(t, A), b = near(t, B);
    sum += a && !b ? 1 : b && !a ? -1 : 0;
    if (sum > best) { best = sum; end = i; }
  });
  // Parada ou ponte fica com a música que estava tocando: a nova começa na primeira sequência
  // firme de batidas na grade dela (4 de 6), não numa batida solta que caiu ali por acaso.
  const onlyB = (i: number) => near(pts[i], B) && !near(pts[i], A);
  let next = -1;
  for (let i = end + 1; i < pts.length; i++) {
    if (!onlyB(i)) continue;
    let hits = 0;
    const stop = Math.min(pts.length, i + 6);
    for (let k = i; k < stop; k++) if (onlyB(k)) hits++;
    if (hits >= Math.min(4, stop - i)) { next = i; break; }
  }
  if (next < 0) next = Math.min(pts.length - 1, end + 1);
  const left = end >= 0 ? pts[end] : lo, right = pts[next];
  let cut = next > 0 ? (pts[next - 1] + pts[next]) / 2 : pts[0];
  // Entre as duas certezas o modelo não marcou batida firme: decide a força dos ataques em cada grade.
  if (right - left > 1.5 && attackEnv) {
    let cum = 0, top = 0;
    cut = left;
    for (let x = left; x < right; x += 0.1) {
      cum += Math.log((gridRate(attackEnv, A, x - 1.5, x + 1.5) + 0.05) / (gridRate(attackEnv, B, x - 1.5, x + 1.5) + 0.05));
      if (cum > top) { top = cum; cut = x; }
    }
  }
  return B.t0 + Math.ceil((cut - B.t0) / p - 1e-6) * p;
}

function changeAt(spec: Spec, t: number): number {
  const f = Math.round(t * spec.fps), span = Math.max(3, Math.round(0.6 * spec.fps));
  if (f < span || f > spec.bands.length - span) return 0;
  return cosDist(meanVec(spec.bands, f - span, f), meanVec(spec.bands, f, f + span)) * 40 + cosDist(meanVec(spec.chroma, f - span, f), meanVec(spec.chroma, f, f + span));
}

/** Instante de mudança mais brusca do som (corte ou entrada de outra música). */
function sharpChange(spec: Spec, a: number, b: number): number {
  const span = Math.max(3, Math.round(0.6 * spec.fps));
  let top = -1, at = (a + b) / 2;
  for (let f = Math.max(span, Math.floor(a * spec.fps)); f <= Math.min(spec.bands.length - span, Math.ceil(b * spec.fps)); f++) {
    const d = cosDist(meanVec(spec.bands, f - span, f), meanVec(spec.bands, f, f + span)) * 40 + cosDist(meanVec(spec.chroma, f - span, f), meanVec(spec.chroma, f, f + span));
    if (d > top) { top = d; at = f / spec.fps; }
  }
  return at;
}

function noveltyIn(spec: Spec, a: number, b: number): number {
  const span = Math.round(1.5 * spec.fps);
  let top = -1, at = (a + b) / 2;
  for (let f = Math.max(span, Math.floor(a * spec.fps)); f <= Math.min(spec.bands.length - span, Math.ceil(b * spec.fps)); f++) {
    const d = cosDist(meanVec(spec.bands, f - span, f), meanVec(spec.bands, f, f + span)) * 40 + cosDist(meanVec(spec.chroma, f - span, f), meanVec(spec.chroma, f, f + span));
    if (d > top) { top = d; at = f / spec.fps; }
  }
  return at;
}

function modelBar(m: BeatModel, first: number, end: number, bpm: number, bpb: number): { phase: number; margin: number } {
  const p = 60 / bpm, s = new Array(bpb).fill(0), n = new Array(bpb).fill(0);
  let k = 0;
  for (let t = first; t < end; t += p, k++) {
    const c = Math.round(t * m.fps);
    let v = 0;
    for (let i = c - 1; i <= c + 1; i++) if (i >= 0 && i < m.downbeat.length && m.downbeat[i] > v) v = m.downbeat[i];
    s[k % bpb] += v; n[k % bpb]++;
  }
  const avg = s.map((v, i) => v / Math.max(1, n[i]));
  const order = [...avg].sort((x, y) => y - x);
  return { phase: avg.indexOf(order[0]), margin: order[0] / Math.max(order[1], 1e-6) };
}

/** Parte de um trecho em que as batidas não seguem a grade dele: outra música ali dentro. */
function offGridRun(m: BeatModel, a: number, b: number, g: { bpm: number; t0: number }): { from: number; to: number } | null {
  const pts = preciseBeats(m, a + 0.5, b - 0.5), p = 60 / g.bpm;
  if (pts.length < 20) return null;
  const on = pts.map((t) => Math.abs(t - (g.t0 + Math.round((t - g.t0) / p) * p)) < 0.03);
  const W = 12, bad: boolean[] = [];
  for (let i = 0; i + W <= pts.length; i++) bad.push(on.slice(i, i + W).filter(Boolean).length <= 4);
  let best: { x: number; y: number } | null = null;
  for (let i = 0; i < bad.length;) {
    if (!bad[i]) { i++; continue; }
    let j = i;
    while (j + 1 < bad.length && bad[j + 1]) j++;
    if (!best || j - i > best.y - best.x) best = { x: i, y: j };
    i = j + 1;
  }
  if (!best) return null;
  const from = pts[best.x], to = pts[Math.min(pts.length - 1, best.y + W - 1)];
  return to - from >= 10 ? { from, to } : null;
}

function coverage(m: BeatModel, a: number, b: number, g: { bpm: number; t0: number }): number {
  const pts = preciseBeats(m, a, b), p = 60 / g.bpm;
  return pts.length ? pts.filter((t) => Math.abs(t - (g.t0 + Math.round((t - g.t0) / p) * p)) < 0.03).length / pts.length : 0;
}

/** Afina BPM e fase pelas próprias batidas do trecho (reta pelos pontos que caem na grade). */
function refineByBeats<G extends { bpm: number; t0: number }>(m: BeatModel, a: number, b: number, g: G): G {
  const pts = preciseBeats(m, a, b);
  if (pts.length < 12) return g;
  let bpm = g.bpm, t0 = g.t0;
  // parte da fase em que mais batidas concordam: a grade inicial pode ter caído no contratempo
  const q = 60 / bpm;
  const phases = pts.map((t) => ((t - g.t0) % q + q) % q);
  let top = -1;
  for (const c of phases) {
    let n = 0;
    for (const x of phases) { const d = Math.abs(x - c); if (Math.min(d, q - d) < 0.03) n++; }
    if (n > top) { top = n; t0 = g.t0 + c; }
  }
  for (let round = 0; round < 4; round++) {
    const p = 60 / bpm;
    let n = 0, sk = 0, st = 0, skk = 0, skt = 0;
    const base = Math.round((pts[0] - t0) / p);
    for (const t of pts) {
      const k = Math.round((t - t0) / p);
      if (Math.abs(t - (t0 + k * p)) > 0.06) continue;
      const x = k - base;
      n++; sk += x; st += t; skk += x * x; skt += x * t;
    }
    const det = n * skk - sk * sk;
    if (n < 8 || det <= 0) break;
    const slope = (n * skt - sk * st) / det;
    if (!(slope > 0)) break;
    t0 = (st - slope * sk) / n - base * slope;
    bpm = 60 / slope;
  }
  return Math.abs(bpm / g.bpm - 1) < 0.02 ? { ...g, bpm, t0 } : g;
}

/** Melhor reta (BPM e fase) para estas batidas, partindo de um BPM próximo. */
function fitPoints(pts: number[], guess: number): { bpm: number; t0: number; hits: number } {
  const BINS = 48, q0 = 60 / guess, hist = new Int32Array(BINS);
  const ref = pts[0];
  for (const t of pts) hist[Math.floor((((t - ref) % q0 + q0) % q0) / q0 * BINS) % BINS]++;
  let top = 0, at = 0;
  for (let i = 0; i < BINS; i++) { const v = hist[i] + hist[(i + 1) % BINS] + hist[(i + BINS - 1) % BINS]; if (v > top) { top = v; at = i; } }
  let t0 = ref + ((at + 0.5) / BINS) * q0, p = q0;
  for (let round = 0; round < 4; round++) {
    let n = 0, sk = 0, st = 0, skk = 0, skt = 0;
    for (const t of pts) {
      const k = Math.round((t - t0) / p);
      if (Math.abs(t - (t0 + k * p)) > 0.05) continue;
      n++; sk += k; st += t; skk += k * k; skt += k * t;
    }
    const det = n * skk - sk * sk;
    if (n < 6 || det <= 0) break;
    const slope = (n * skt - sk * st) / det;
    if (slope <= 0 || Math.abs(slope / q0 - 1) > 0.035) break;
    p = slope; t0 = (st - slope * sk) / n;
  }
  let hits = 0;
  for (const t of pts) if (Math.abs(t - (t0 + Math.round((t - t0) / p) * p)) < 0.03) hits++;
  return { bpm: 60 / p, t0, hits };
}

/**
 * Duas músicas de andamento igual ou quase igual emendadas: uma grade só não explica o trecho, e
 * duas grades (uma de cada lado de um ponto) explicam bem mais batidas. Devolve o ponto e as grades.
 */
function splitByTwoGrids(m: BeatModel, a: number, b: number, guess: number) {
  const pts = preciseBeats(m, a, b);
  if (pts.length < 32) return null;
  const whole = fitPoints(pts, guess);
  let best: { k: number; gain: number; L: ReturnType<typeof fitPoints>; R: ReturnType<typeof fitPoints> } | null = null;
  for (let k = 14; k <= pts.length - 14; k += 2) {
    const L = fitPoints(pts.slice(0, k), guess), R = fitPoints(pts.slice(k), guess), gain = L.hits + R.hits - whole.hits;
    if (!best || gain > best.gain) best = { k, gain, L, R };
  }
  if (!best || best.gain < Math.max(10, pts.length * 0.15)) return null;
  const { L, R, k } = best, cut = (pts[k - 1] + pts[k]) / 2;
  const q = 60 / L.bpm, jump = Math.abs(((R.t0 + Math.round((cut - R.t0) / (60 / R.bpm)) * (60 / R.bpm) - L.t0) % q + q) % q);
  const shift = Math.min(jump, q - jump);
  const sameBpm = Math.abs(L.bpm - R.bpm) < 0.3;
  // batida exatamente no meio com o mesmo BPM é o modelo marcando o contratempo
  if (sameBpm && (shift < 0.045 || Math.abs(shift - q / 2) < 0.05)) return null;
  return { cut, L, R };
}

/**
 * Refina uma emenda: o ponto em que a grade A explica o máximo de batidas antes e a B depois,
 * olhando até as trocas vizinhas. Só move com vantagem clara (5 batidas ou mais).
 */
function refineSeam(m: BeatModel, lo: number, hi: number, cur: number, A: { bpm: number; t0: number }, B: { bpm: number; t0: number }): number {
  const pts = preciseBeats(m, lo, hi);
  if (pts.length < 16) return cur;
  const on = (t: number, g: { bpm: number; t0: number }) => { const q = 60 / g.bpm; return Math.abs(t - (g.t0 + Math.round((t - g.t0) / q) * q)) < 0.03; };
  const onB = pts.map((t) => (on(t, B) ? 1 : 0) as number);
  for (let i = onB.length - 2; i >= 0; i--) onB[i] += onB[i + 1];
  let left = 0, best = -1, at = 0, here = 0;
  for (let k = 0; k <= pts.length; k++) {
    const v = left + (k < pts.length ? onB[k] : 0);
    if (v > best) { best = v; at = k; }
    if (k < pts.length && pts[k] < cur) here = left + 1 + (k + 1 < pts.length ? onB[k + 1] : 0) - (on(pts[k], A) ? 0 : 1);
    if (k < pts.length && on(pts[k], A)) left++;
  }
  if (best - here < 5 || at <= 0 || at >= pts.length) return cur;
  const p = 60 / B.bpm, cut = (pts[at - 1] + pts[at]) / 2;
  return B.t0 + Math.ceil((cut - B.t0) / p - 1e-6) * p;
}

/** Quantas batidas (neste BPM) cabem entre dois 1 marcados pelo modelo; 0 se não der para saber. */
function beatsBetweenDownbeats(m: BeatModel, a: number, b: number, bpm: number): number {
  const peaks: number[] = [];
  for (let i = Math.max(3, Math.floor(a * m.fps)); i < Math.min(m.downbeat.length - 3, b * m.fps); i++) {
    if (m.downbeat[i] <= 0.3) continue;
    let top = true;
    for (let k = i - 3; k <= i + 3; k++) if (m.downbeat[k] > m.downbeat[i]) top = false;
    if (top) peaks.push(i / m.fps);
  }
  if (peaks.length < 5) return 0;
  const gaps = peaks.slice(1).map((t, i) => t - peaks[i]).sort((x, y) => x - y);
  return gaps[gaps.length >> 1] / (60 / bpm);
}

/** Click de DAW é quase sempre BPM inteiro: se o inteiro explica as batidas igual, ele vale (sem escorregar na música longa). */
function snapWholeBpm<G extends { bpm: number; t0: number }>(m: BeatModel, a: number, b: number, g: G): G {
  const whole = Math.round(g.bpm);
  if (whole === g.bpm || Math.abs(g.bpm - whole) > 0.08) return g;
  const pts = preciseBeats(m, a, b);
  if (pts.length < 16) return g;
  const q = 60 / whole, mid = pts[pts.length >> 1], k0 = Math.round((mid - g.t0) / (60 / g.bpm));
  const candidate = { ...g, bpm: whole, t0: g.t0 + k0 * (60 / g.bpm) - k0 * q };
  const fitted = refinePhase(pts, candidate);
  return coverage(m, a, b, fitted) >= coverage(m, a, b, g) - 0.01 ? fitted : g;
}

/** Fase mediana das batidas que já caem na grade, sem mexer no BPM. */
function refinePhase<G extends { bpm: number; t0: number }>(pts: number[], g: G): G {
  const q = 60 / g.bpm;
  const off = pts.map((t) => t - (g.t0 + Math.round((t - g.t0) / q) * q)).filter((d) => Math.abs(d) < 0.06).sort((x, y) => x - y);
  return off.length ? { ...g, t0: g.t0 + off[off.length >> 1] } : g;
}

function repairSections(m: BeatModel, env: Float32Array, spec: Spec, fits: Array<{ bpm: number; t0: number; score: number }>, starts: number[], duration: number) {
  for (let round = 0; round < 4; round++) {
    let changed = false;
    for (let i = 0; i < fits.length && !changed; i++) {
      const b = i === fits.length - 1 ? duration : starts[i + 1], run = offGridRun(m, starts[i], b, fits[i]);
      if (!run) continue;
      let bestBpm = 0, bestS = 0;
      for (let x = MIN_BPM; x <= MAX_BPM; x += 0.25) {
        const s = combScore(env, Math.floor(run.from * envFps), Math.floor(run.to * envFps), x, envFps);
        if (s > bestS) { bestS = s; bestBpm = x; }
      }
      const rough = fitGrid(env, run.from, run.to, modelOctave(m, run.from, run.to, bestBpm));
      const tuned = refineByBeats(m, run.from, run.to, rough);
      const fresh = coverage(m, run.from, run.to, tuned) > coverage(m, run.from, run.to, rough) ? tuned : rough;
      // andamento bem diferente do trecho: basta a grade nova explicar claramente mais batidas que a atual
      const cover = coverage(m, run.from, run.to, fresh), differs = Math.abs(fresh.bpm / fits[i].bpm - 1) >= 0.04;
      if (cover < 0.6 && !(differs && cover >= 0.45 && cover >= coverage(m, run.from, run.to, fits[i]) + 0.25)) continue;
      // mesmo andamento: só é outra música se a batida ficar deslocada por bastante tempo (parada não conta)
      if (Math.abs(fresh.bpm / fits[i].bpm - 1) < 0.008 && run.to - run.from < 20) continue;
      // mesma velocidade e batida exatamente no meio: é o modelo marcando o contratempo, não outra música
      if (Math.abs(fresh.bpm / fits[i].bpm - 1) < 0.008) {
        const q = 60 / fits[i].bpm, d = (((fresh.t0 - fits[i].t0) % q) + q) % q;
        if (Math.abs(d - q / 2) < 0.05) continue;
      }
      const atEnd = b - run.to < 6, atStart = run.from - starts[i] < 6;
      if (atStart) {
        const cut = modelSplit(m, spec, Math.max(starts[i], run.from - 2), Math.min(b, run.to + 8), fresh, fits[i]);
        fits.splice(i, 0, fresh); starts.splice(i + 1, 0, cut);
      } else if (atEnd) {
        const cut = modelSplit(m, spec, Math.max(starts[i], run.from - 8), b, fits[i], fresh);
        fits.splice(i + 1, 0, fresh); starts.splice(i + 1, 0, cut);
      } else {
        const c1 = modelSplit(m, spec, run.from - 6, run.from + 6, fits[i], fresh), c2 = modelSplit(m, spec, run.to - 6, Math.min(b, run.to + 6), fresh, fits[i]);
        if (c2 - c1 < 8) continue;
        fits.splice(i + 1, 0, fresh, { ...fits[i] }); starts.splice(i + 1, 0, c1, c2);
      }
      changed = true;
    }
    if (!changed) return;
  }
}

/** Metade ou dobro: quem decide é o intervalo entre as batidas que o modelo marcou no trecho. */
function modelOctave(m: BeatModel, a: number, b: number, bpm: number): number {
  const pts = modelPeaks(m, a + 1, b - 1);
  if (pts.length < 9) return bpm;
  const gaps = pts.slice(1).map((t, i) => t - pts[i]).sort((x, y) => x - y);
  const r = 60 / gaps[gaps.length >> 1] / bpm;
  if (r > 1.75 && r < 2.25 && bpm * 2 <= 210) return bpm * 2;
  if (r > 0.44 && r < 0.57 && bpm / 2 >= 55) return bpm / 2;
  return bpm;
}

/** Duas músicas de mesmo BPM emendadas: o andamento não muda, mas a batida salta de lugar. */
function phaseJump(m: BeatModel, a: number, b: number, g: { bpm: number; t0: number }): number | null {
  const pts = preciseBeats(m, a + 0.5, b - 0.5);
  if (pts.length < 28) return null;
  const p = 60 / g.bpm, off = pts.map((t) => { const d = (t - g.t0) % p; const x = d < 0 ? d + p : d; return x > p / 2 ? x - p : x; });
  const mode = (v: number[]) => { let top = 0, at = 0; for (const c of v) { let n = 0; for (const x of v) { const d = Math.abs(x - c); if (Math.min(d, p - d) < 0.025) n++; } if (n > top) { top = n; at = c; } } return { at, n: top }; };
  const single = mode(off).n;
  let best: { i: number; gain: number } | null = null;
  for (let i = 12; i <= off.length - 12; i += 2) {
    const l = mode(off.slice(0, i)), r = mode(off.slice(i)), d = Math.abs(l.at - r.at);
    if (Math.min(d, p - d) < 0.06) continue;
    const gain = l.n + r.n - single;
    if (gain >= Math.max(10, off.length * 0.25) && (!best || gain > best.gain)) best = { i, gain };
  }
  return best ? (pts[best.i - 1] + pts[best.i]) / 2 : null;
}


// ---------- Mapa por retas: as batidas são escolhidas primeiro e o andamento sai de uma reta por trecho ----------

/** Reta de um trecho: a batida k cai em origin + k x period. `from` e `to` são índices das batidas. */
interface BeatLine { period: number; origin: number; from: number; to: number; hits: number }

/** Distância em que uma batida ainda conta para a reta. */
const LINE_TOL = 0.025;
/** Erro típico de uma batida do modelo levada ao ataque. */
const LINE_SIGMA = 0.014;
/** Custo máximo de uma batida fora da reta, em sigmas ao quadrado: virada ou batida solta não decide nada sozinha. */
const LINE_CAP = 6;
/** Custo de abrir um trecho: a troca precisa se pagar em várias batidas. */
const LINE_SWITCH = 18;
/** Quantas batidas seguidas fora da reta encerram o crescimento dela. */
const LINE_MISS = 6;

const lineError = (l: { period: number; origin: number }, t: number) => t - (l.origin + Math.round((t - l.origin) / l.period) * l.period);

/** Mínimos quadrados só com as batidas perto da reta: o intercepto é livre e o período nunca segue uma batida solta. */
function fitBeatLine(pts: number[], from: number, to: number, guess: { period: number; origin: number }, tol = LINE_TOL): BeatLine | null {
  let { period, origin } = guess;
  let hits = 0;
  for (let round = 0; round < 5; round++) {
    let n = 0, sk = 0, st = 0, skk = 0, skt = 0;
    const base = Math.round((pts[from] - origin) / period);
    for (let i = from; i <= to; i++) {
      const k = Math.round((pts[i] - origin) / period);
      if (Math.abs(pts[i] - (origin + k * period)) > tol) continue;
      const x = k - base;
      n++; sk += x; st += pts[i]; skk += x * x; skt += x * pts[i];
    }
    const det = n * skk - sk * sk;
    if (n < 3 || det <= 0) return null;
    const slope = (n * skt - sk * st) / det;
    if (!(slope > 0) || Math.abs(slope / period - 1) > 0.03) return null;
    origin = (st - slope * sk) / n - base * slope;
    period = slope;
    hits = n;
  }
  return { period, origin, from, to, hits };
}

/** Reta que nasce numa janela curta de batidas e cresce para os dois lados enquanto as batidas caem nela. */
function growBeatLine(pts: number[], a: number, b: number): BeatLine | null {
  const gaps: number[] = [];
  for (let i = a + 1; i <= b; i++) gaps.push(pts[i] - pts[i - 1]);
  const T0 = median(gaps);
  if (T0 < 0.26 || T0 > 1.6) return null;
  let line = fitBeatLine(pts, a, b, { period: T0, origin: pts[a] }, 0.04);
  if (!line || line.hits < (b - a + 1) * 0.75) return null;
  let lo = a, hi = b;
  for (let round = 0; round < 400; round++) {
    let nextHi = hi, nextLo = lo, miss = 0, added = 0;
    for (let j = hi + 1; j < pts.length && miss < LINE_MISS && added < 8; j++) {
      if (Math.abs(lineError(line, pts[j])) <= LINE_TOL) { nextHi = j; miss = 0; added++; } else miss++;
    }
    miss = 0; added = 0;
    for (let j = lo - 1; j >= 0 && miss < LINE_MISS && added < 8; j--) {
      if (Math.abs(lineError(line, pts[j])) <= LINE_TOL) { nextLo = j; miss = 0; added++; } else miss++;
    }
    if (nextHi === hi && nextLo === lo) break;
    lo = nextLo; hi = nextHi;
    const fresh = fitBeatLine(pts, lo, hi, line);
    if (!fresh) break;
    line = fresh;
  }
  return { ...line, from: lo, to: hi };
}

/** Candidatas a reta: uma para cada região de batidas regulares da faixa. */
function lineCandidates(pts: number[]): BeatLine[] {
  const out: BeatLine[] = [];
  const SEED = 8;
  for (let a = 0; a + SEED - 1 < pts.length; a += 2) {
    const b = a + SEED - 1;
    let known = false;
    for (const l of out) {
      if (l.from > a || l.to < b) continue;
      let on = 0;
      for (let i = a; i <= b; i++) if (Math.abs(lineError(l, pts[i])) <= 0.015) on++;
      if (on >= SEED - 2) { known = true; break; }
    }
    if (known) continue;
    const line = growBeatLine(pts, a, b);
    if (line && line.hits >= SEED - 2) out.push(line);
    if (out.length >= 160) break;
  }
  return out;
}

/** Escolhe uma reta por batida: custo do erro de cada uma mais o custo de trocar. Devolve a reta (ou -1) de cada batida. */
function assignLines(pts: number[], lines: BeatLine[]): Int16Array {
  const N = pts.length, H = lines.length;
  const label = new Int16Array(N).fill(-1);
  if (!N || !H) return label;
  const back = new Int16Array(N * (H + 1));
  let prev = new Float64Array(H + 1), cur = new Float64Array(H + 1);
  const unit = (LINE_SIGMA * LINE_SIGMA);
  const costAt = (h: number, i: number) => {
    if (h === H) return LINE_CAP;
    const l = lines[h];
    if (i < l.from - 8 || i > l.to + 8) return 1e6;
    const e = lineError(l, pts[i]);
    return Math.min(LINE_CAP, (e * e) / unit);
  };
  for (let h = 0; h <= H; h++) prev[h] = costAt(h, 0);
  for (let i = 1; i < N; i++) {
    let top = 0;
    for (let h = 1; h <= H; h++) if (prev[h] < prev[top]) top = h;
    for (let h = 0; h <= H; h++) {
      const stay = prev[h], jump = prev[top] + LINE_SWITCH;
      back[i * (H + 1) + h] = stay <= jump ? h : top;
      cur[h] = Math.min(stay, jump) + costAt(h, i);
    }
    [prev, cur] = [cur, prev];
  }
  let s = 0;
  for (let h = 1; h <= H; h++) if (prev[h] < prev[s]) s = h;
  for (let i = N - 1; i >= 0; i--) {
    label[i] = s === H ? -1 : s;
    s = back[i * (H + 1) + s];
  }
  return label;
}

/** Trechos contínuos a partir da reta escolhida para cada batida; batidas sem reta ficam com o trecho anterior. */
function linesFromLabels(pts: number[], label: Int16Array, lines: BeatLine[]): BeatLine[] {
  const out: BeatLine[] = [];
  for (let i = 0; i < pts.length;) {
    const h = label[i];
    let j = i;
    while (j + 1 < pts.length && label[j + 1] === h) j++;
    if (h >= 0) {
      const fresh = fitBeatLine(pts, i, j, lines[h]) ?? { ...lines[h], from: i, to: j };
      out.push({ ...fresh, from: i, to: j });
    }
    i = j + 1;
  }
  return out;
}

/** Valor médio dos ataques numa grade: o ataque vale o pico em volta de cada batida. */
function gridValue(e: Float32Array, period: number, origin: number, a: number, b: number): number {
  let sum = 0, n = 0;
  for (let k = Math.ceil((a - origin) / period); origin + k * period < b; k++) { sum += beatValue(e, origin + k * period); n++; }
  return n ? sum / n : 0;
}

/** Fase e força da grade: o pico do perfil é onde a música realmente cai, e a altura dele diz o quanto a grade explica o trecho. */
function attackSupport(e: Float32Array, period: number, origin: number, a: number, b: number): { origin: number; value: number } {
  const R = Math.round(ATTACK_REACH * envFps);
  const profile = attackProfile(e, period, origin, a, b, R);
  const peak = profilePeak(profile);
  return { origin: origin + (peak.at - R) / envFps, value: peak.value };
}

/** Pico do perfil, com o instante em fração de quadro. */
function profilePeak(profile: ArrayLike<number>): { at: number; value: number } {
  let top = 1, best = -1;
  for (let i = 1; i < profile.length - 1; i++) {
    const v = profile[i] + 0.5 * (profile[i - 1] + profile[i + 1]);
    if (v > best) { best = v; top = i; }
  }
  const y0 = profile[top - 1], y1 = profile[top], y2 = profile[top + 1], den = y0 - 2 * y1 + y2;
  const frac = den < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (y0 - y2)) / den)) : 0;
  return { at: top + frac, value: Math.max(0, best) };
}

/** Ataques da mistura, com peso do modelo: conferem a fase achada no agudo. */
let mixAttackEnv: Float32Array | null = null;
/** Até onde o ataque pode estar da reta do modelo: ele costuma escorregar algumas dezenas de ms. */
const ATTACK_REACH = 0.07;

/** Soma os ataques de todas as batidas, alinhados na grade. */
function attackProfile(e: Float32Array, period: number, origin: number, a: number, b: number, R: number): Float64Array {
  const profile = new Float64Array(2 * R + 1);
  for (let k = Math.ceil((a - origin) / period); origin + k * period < b; k++) {
    const c = Math.round((origin + k * period) * envFps);
    if (c - R < 0 || c + R >= e.length) continue;
    for (let o = -R; o <= R; o++) profile[o + R] += e[c + o];
  }
  return profile;
}

/** Desvio mais comum entre o ataque mais forte de cada batida e a grade (moda, com peso pela força do ataque). */
function commonAttackOffset(e: Float32Array, period: number, origin: number, a: number, b: number): number {
  const STEP = 0.0025, R = Math.round(ATTACK_REACH / STEP), bins = new Float64Array(2 * R + 1);
  const reach = Math.round(ATTACK_REACH * envFps);
  const offs: Array<[number, number]> = [];
  for (let k = Math.ceil((a - origin) / period); origin + k * period < b; k++) {
    const t = origin + k * period, c = Math.round(t * envFps);
    let top = 0, at = -1;
    for (let f = Math.max(1, c - reach); f <= Math.min(e.length - 2, c + reach); f++) {
      if (e[f] > top && e[f] >= e[f - 1] && e[f] >= e[f + 1]) { top = e[f]; at = f; }
    }
    if (at < 0) continue;
    const d = at / envFps - t, bin = Math.round(d / STEP) + R;
    offs.push([d, top]);
    if (bin >= 0 && bin <= 2 * R) bins[bin] += top;
  }
  if (!offs.length) return 0;
  let best = -1, center = R;
  for (let i = 0; i <= 2 * R; i++) {
    const v = bins[i] + 0.7 * ((bins[i - 1] ?? 0) + (bins[i + 1] ?? 0)) + 0.3 * ((bins[i - 2] ?? 0) + (bins[i + 2] ?? 0));
    if (v > best) { best = v; center = i; }
  }
  const mode = (center - R) * STEP;
  let sum = 0, tot = 0;
  for (const [d, w] of offs) if (Math.abs(d - mode) <= 2.5 * STEP) { sum += w * d; tot += w; }
  return tot ? sum / tot : mode;
}

/** Até onde duas leituras da fase ainda dizem a mesma coisa. */
const PHASE_AGREE = 0.008;

/**
 * Fase do trecho a partir de três leituras: pico do agudo, pico da mistura e ataque mais comum. Agudo e
 * ataque comum vêm do mesmo envelope e podem errar juntos: quando os dois concordam entre si e a mistura
 * discorda dos dois, vale a mistura. Nos outros casos, a mediana.
 */
function finalPhase(e: Float32Array, period: number, origin: number, a: number, b: number): number {
  const R = Math.round(ATTACK_REACH * envFps);
  const high = (profilePeak(attackProfile(e, period, origin, a, b, R)).at - R) / envFps;
  const mix = mixAttackEnv ? (profilePeak(attackProfile(mixAttackEnv, period, origin, a, b, R)).at - R) / envFps : high;
  const common = commonAttackOffset(e, period, origin, a, b);
  if (mixAttackEnv && Math.abs(high - common) <= PHASE_AGREE && Math.abs(mix - high) > PHASE_AGREE && Math.abs(mix - common) > PHASE_AGREE) return origin + mix;
  return origin + [high, mix, common].sort((x, y) => x - y)[1];
}

/**
 * Período e fase do trecho nos ataques, perto da reta do modelo: a batida do modelo escorrega alguns ms
 * ao longo da faixa, e o ataque não. O BPM inteiro vale quando explica os ataques quase igual.
 */
function tuneOnAttacks(e: Float32Array, line: BeatLine, a: number, b: number, pts: number[] = []): BeatLine {
  if (b - a < 2) return line;
  const center = (a + b) / 2;
  const anchor = line.origin + Math.round((center - line.origin) / line.period) * line.period;
  const score = (bpm: number) => ({ bpm, ...attackSupport(e, 60 / bpm, anchor, a, b) });
  const bpm0 = 60 / line.period, span = bpm0 * 0.006;
  let top = score(bpm0);
  for (let x = bpm0 - span; x <= bpm0 + span; x += 0.02) { const r = score(x); if (r.value > top.value) top = r; }
  const fineStep = Math.max(0.002, bpm0 * 0.004 / Math.max(1, b - a));
  const c = top.bpm;
  for (let x = c - 0.02; x <= c + 0.02; x += fineStep) { const r = score(x); if (r.value > top.value) top = r; }
  const whole = Math.round(top.bpm);
  if (whole > 0 && Math.abs(top.bpm - whole) <= 0.3) {
    const r = score(whole);
    const drift = Math.abs(60 / top.bpm - 60 / whole) * ((b - a) / (60 / top.bpm));
    const inside = pts.filter((t) => t >= a && t < b);
    const onWhole = inside.filter((t) => Math.abs(lineError({ period: 60 / whole, origin: r.origin }, t)) <= 0.04).length;
    const onFree = inside.filter((t) => Math.abs(lineError({ period: 60 / top.bpm, origin: top.origin }, t)) <= 0.04).length;
    // o inteiro não vale se as batidas do próprio trecho mostram o andamento fora dele
    const offWhole = Math.abs(60 / whole - line.period) * ((b - a) / line.period) > 0.06;
    if (Math.abs(top.bpm - whole) <= 0.05 || drift <= 0.035 || (!offWhole && (r.value >= top.value * 0.85 || (inside.length >= 16 && onWhole >= onFree * 0.95)))) return { ...line, period: 60 / whole, origin: finalPhase(e, 60 / whole, r.origin, a, b) };
  }
  return { ...line, period: 60 / top.bpm, origin: finalPhase(e, 60 / top.bpm, top.origin, a, b) };
}

/** O modelo às vezes segue o contratempo: vale a fase com mais batidas dele, e o ataque geral confere. */
function onBeatSide(e: Float32Array, raw: Float32Array, pts: number[], line: BeatLine, a: number, b: number): BeatLine {
  const half = { period: line.period, origin: line.origin + line.period / 2 };
  let here = 0, there = 0;
  for (const t of pts) {
    if (t < a || t >= b) continue;
    if (Math.abs(lineError(line, t)) <= 0.05) here++;
    else if (Math.abs(lineError(half, t)) <= 0.05) there++;
  }
  const onLine = attackSupport(raw, line.period, line.origin, a, b).value;
  const onHalf = attackSupport(raw, line.period, half.origin, a, b).value;
  // ataque claro decide; se ele não for claro, decide a maioria das batidas do modelo
  const flip = onHalf > onLine * 1.3 || (onLine <= onHalf * 1.3 && there > here);
  return flip ? { ...line, origin: finalPhase(e, line.period, half.origin, a, b) } : line;
}

/** Emenda entre duas retas: até onde os ataques caem mais na grade A do que na B. Devolve a primeira batida de B depois disso. */
function seamOnAttacks(e: Float32Array, A: BeatLine, B: BeatLine, lo: number, hi: number): number {
  const ev: Array<{ t: number; v: number }> = [];
  const add = (l: BeatLine, sign: number, other: BeatLine) => {
    for (let k = Math.ceil((lo - l.origin) / l.period); l.origin + k * l.period < hi; k++) {
      const t = l.origin + k * l.period;
      if (Math.abs(lineError(other, t)) <= 0.012) continue;
      ev.push({ t, v: sign * beatValue(e, t) });
    }
  };
  add(A, 1, B); add(B, -1, A);
  ev.sort((x, y) => x.t - y.t);
  let cum = 0, best = 0, at = lo;
  for (const x of ev) {
    cum += x.v;
    if (cum > best) { best = cum; at = x.t; }
  }
  // as duas retas se cruzam perto da troca: a batida que serve às duas é a primeira da nova
  const first = B.origin + Math.ceil((at + 0.02 - B.origin) / B.period) * B.period;
  let closest = 0.012, cross = first;
  for (let k = -2; k < 7; k++) {
    const t = first + k * B.period, miss = Math.abs(lineError(A, t));
    if (miss < closest) { closest = miss; cross = t; }
  }
  return cross;
}

/** Até onde as duas retas podem estar uma da outra no ponto em que se cruzam. */
const CROSS_TOL = 0.012;

/**
 * Duas retas de andamento quase igual, sem salto de batida, se cruzam num ponto só, e é ali que o
 * andamento mudou. Fica o cruzamento se ele explica tantas batidas quanto a emenda medida nos ataques.
 */
function crossingSeam(pts: number[], A: BeatLine, B: BeatLine, lo: number, hi: number, current: number): number {
  if (Math.abs(A.period / B.period - 1) > 0.006) return current;
  let best = CROSS_TOL, at = -1;
  for (let k = Math.ceil((lo - B.origin) / B.period); B.origin + k * B.period < hi; k++) {
    const t = B.origin + k * B.period, miss = Math.abs(lineError(A, t));
    if (miss < best) { best = miss; at = t; }
  }
  if (at < 0 || Math.abs(at - current) < B.period / 2) return current;
  // erro das batidas com cada emenda; batida solta (virada, parada) pesa no máximo a folga da reta
  const cost = (cut: number) => {
    let sum = 0;
    for (const t of pts) {
      if (t < lo || t >= hi) continue;
      const miss = lineError(t < cut ? A : B, t);
      sum += Math.min(miss * miss, LINE_TOL * LINE_TOL);
    }
    return sum;
  };
  // perto do cruzamento as duas retas quase coincidem e o erro das batidas mal distingue uma emenda da
  // outra; sem salto de batida é a troca mais provável, e só uma piora clara a descarta
  return cost(at) <= cost(current) * 1.05 ? at : current;
}

/** Reta quebrada: t = origem + pA x min(k, kc) + pB x max(0, k - kc). Devolve os coeficientes e o erro das batidas. */
function fitBrokenLine(k: number[], t: number[], kc: number, use: boolean[]): { o: number; pA: number; pB: number; cost: number } | null {
  let n = 0, s1 = 0, s2 = 0, st = 0, s11 = 0, s12 = 0, s22 = 0, s1t = 0, s2t = 0;
  for (let i = 0; i < k.length; i++) {
    if (!use[i]) continue;
    const x1 = Math.min(k[i], kc), x2 = Math.max(0, k[i] - kc), y = t[i] - t[0];
    n++; s1 += x1; s2 += x2; st += y; s11 += x1 * x1; s12 += x1 * x2; s22 += x2 * x2; s1t += x1 * y; s2t += x2 * y;
  }
  // sistema 3 x 3 por eliminação
  const m = [[n, s1, s2, st], [s1, s11, s12, s1t], [s2, s12, s22, s2t]];
  for (let c = 0; c < 3; c++) {
    let top = c;
    for (let r = c + 1; r < 3; r++) if (Math.abs(m[r][c]) > Math.abs(m[top][c])) top = r;
    if (Math.abs(m[top][c]) < 1e-9) return null;
    [m[c], m[top]] = [m[top], m[c]];
    for (let r = 0; r < 3; r++) {
      if (r === c) continue;
      const f = m[r][c] / m[c][c];
      for (let q = c; q < 4; q++) m[r][q] -= f * m[c][q];
    }
  }
  const o = m[0][3] / m[0][0], pA = m[1][3] / m[1][1], pB = m[2][3] / m[2][2];
  let cost = 0;
  for (let i = 0; i < k.length; i++) {
    const r = t[i] - t[0] - (o + pA * Math.min(k[i], kc) + pB * Math.max(0, k[i] - kc));
    cost += Math.min(r * r, LINE_TOL * LINE_TOL);
  }
  return { o: o + t[0], pA, pB, cost };
}

/**
 * Andamentos quase iguais sem salto de batida: as duas retas se encontram num ponto só, e o melhor
 * ponto é o da reta quebrada que passa por todas as batidas dos dois trechos.
 */
function settleCloseSeams(e: Float32Array, pts: number[], lines: BeatLine[], starts: number[], duration: number): void {
  for (let i = 1; i < lines.length; i++) {
    const A = lines[i - 1], B = lines[i];
    if (Math.abs(A.period / B.period - 1) > 0.006) continue;
    const t = pts.slice(A.from, B.to + 1);
    if (t.length < 32) continue;
    const k = [0];
    for (let j = 1; j < t.length; j++) k.push(k[j - 1] + Math.max(1, Math.round((t[j] - t[j - 1]) / A.period)));
    let top: { kc: number; o: number; pA: number; pB: number; cost: number } | null = null;
    for (let q = 12; q < t.length - 12; q++) {
      const kc = k[q];
      const rough = fitBrokenLine(k, t, kc, t.map(() => true));
      if (!rough) continue;
      // batida solta (virada, parada) não entra na conta final
      const use = t.map((v, x) => Math.abs(v - (rough.o + rough.pA * Math.min(k[x], kc) + rough.pB * Math.max(0, k[x] - kc))) <= LINE_TOL);
      const fit = fitBrokenLine(k, t, kc, use);
      if (fit && (!top || fit.cost < top.cost)) top = { ...fit, kc };
    }
    if (!top) continue;
    const seam = top.o + top.pA * top.kc;
    // quebra longe das duas retas não é a mesma música mudando: fica a emenda dos ataques
    if (Math.abs(top.pA / A.period - 1) > 0.003 || Math.abs(top.pB / B.period - 1) > 0.003) continue;
    // duas músicas emendadas com a batida saltando: duas retas soltas explicam bem mais que uma quebrada
    let apart = 0;
    for (const v of t) {
      const miss = lineError(v < starts[i] ? A : B, v);
      apart += Math.min(miss * miss, LINE_TOL * LINE_TOL);
    }
    if (top.cost > apart * 1.1) continue;
    const c = pts.findIndex((v) => v >= seam - 0.02);
    if (c <= A.from + 8 || c >= B.to - 8) continue;
    const a0 = i === 1 ? 0.2 : starts[i - 1], b1 = i + 1 < lines.length ? starts[i + 1] : duration - 0.2;
    const left: BeatLine = { ...A, period: top.pA, origin: top.o, to: c - 1 };
    const right: BeatLine = { ...B, period: top.pB, origin: seam, from: c };
    lines[i - 1] = { ...tuneOnAttacks(e, left, a0, seam, pts), from: A.from, to: c - 1 };
    lines[i] = { ...tuneOnAttacks(e, right, seam, b1, pts), from: c, to: B.to };
    const n = lines[i];
    starts[i] = n.origin + Math.ceil((seam - n.period / 2 - n.origin) / n.period) * n.period;
  }
}

/** O mapa inteiro por retas. Devolve null quando as batidas não formam retas (a análise antiga decide). */
function beatLinesMap(m: BeatModel, env: Float32Array, rawEnv: Float32Array, duration: number): { lines: BeatLine[]; pts: number[]; starts: number[] } | null {
  const pts = preciseBeats(m, 0, duration);
  if (pts.length < 16) return null;
  let lines = lineCandidates(pts);
  if (!lines.length) return null;
  lines = lines.map(pulseLevel);
  for (let pass = 0; pass < 3; pass++) {
    const fitted = linesFromLabels(pts, assignLines(pts, lines), lines);
    if (!fitted.length) return null;
    lines = mergeLines(pts, fitted);
  }
  lines = mergeLines(pts, lines.map(pulseLevel));
  const edges = (list: BeatLine[], i: number) => [i === 0 ? 0.2 : pts[list[i].from] - 0.05, i + 1 < list.length ? pts[list[i + 1].from] - 0.05 : duration - 0.2];
  lines = lines.map((l, i, all) => { const [a, b] = edges(all, i); return onBeatSide(env, rawEnv, pts, tuneOnAttacks(env, l, a, b, pts), a, b); });
  lines = mergeTuned(env, pts, lines, duration);
  lines = lines.map((l, i, all) => { const [a, b] = edges(all, i); return octaveLine(m, env, l, a, b); });
  lines = mergeTuned(env, pts, lines, duration);
  lines = dropWeakShort(env, pts, lines, duration);
  lines = mergeTuned(env, pts, lines, duration);
  const starts = lines.map((l, i) => {
    if (i === 0) return 0;
    const seam = pts[l.from];
    const prev = i > 1 ? pts[lines[i - 1].from] + 1 : 0.2, next = i + 1 < lines.length ? pts[lines[i + 1].from] - 1 : duration - 0.2;
    const near = seamOnAttacks(env, lines[i - 1], l, Math.max(prev, seam - 8), Math.min(next, seam + 8));
    return crossingSeam(pts, lines[i - 1], l, prev, next, near);
  });
  settleCloseSeams(env, pts, lines, starts, duration);
  const explained = pts.filter((t) => {
    let i = lines.length - 1;
    while (i > 0 && t < starts[i]) i--;
    return Math.abs(lineError({ period: lines[i].period / 2, origin: lines[i].origin }, t)) <= 0.05;
  }).length;
  return explained >= pts.length * 0.5 ? { lines, pts, starts } : null;
}

/** Trecho curto só fica se a reta dele explica os ataques claramente melhor que as vizinhas no mesmo lugar. */
function dropWeakShort(e: Float32Array, pts: number[], input: BeatLine[], duration: number): BeatLine[] {
  const lines = [...input];
  for (let i = 0; i < lines.length && lines.length > 1;) {
    const a = i === 0 ? 0.2 : pts[lines[i].from] - 0.05, b = i + 1 < lines.length ? pts[lines[i + 1].from] - 0.05 : duration - 0.2;
    // modelo quase não marca batida ali (fim de música, parada): não é um andamento novo
    const beats = (b - a) / lines[i].period;
    let marked = 0;
    for (const t of pts) if (t >= a && t < b) marked++;
    const empty = marked < beats * 0.35;
    if (b - a >= 14 && !empty) { i++; continue; }
    // menos de 2 compassos não sustenta um andamento próprio
    const own = empty || beats < 8 ? 0 : attackSupport(e, lines[i].period, lines[i].origin, a, b).value;
    let other = 0;
    if (i > 0) other = Math.max(other, attackSupport(e, lines[i - 1].period, lines[i - 1].origin, a, b).value);
    if (i + 1 < lines.length) other = Math.max(other, attackSupport(e, lines[i + 1].period, lines[i + 1].origin, a, b).value);
    if (own < other * 1.35) {
      if (i > 0) lines[i - 1] = { ...lines[i - 1], to: lines[i].to };
      else lines[1] = { ...lines[1], from: lines[0].from };
      lines.splice(i, 1);
      i = Math.max(0, i - 1);
    } else i++;
  }
  return lines;
}

/** Ataques com peso do modelo, numa janela larga: tira o contratempo sem punir a batida que escorregou uns ms. */
function softGate(env: Float32Array, m: BeatModel): Float32Array {
  const out = new Float32Array(env.length);
  for (let f = 0; f < env.length; f++) {
    const i = Math.round((f / envFps) * m.fps);
    let v = 0;
    for (let k = i - 3; k <= i + 3; k++) if (k >= 0 && k < m.beat.length && m.beat[k] > v) v = m.beat[k];
    out[f] = env[f] * (0.15 + v);
  }
  return out;
}

/** Batida marcada em colcheia: a grade volta ao pulso, na metade cujos ataques são mais fortes. */
function octaveLine(m: BeatModel, e: Float32Array, line: BeatLine, a: number, b: number): BeatLine {
  const bpm = 60 / line.period;
  if (bpm <= 165) return line;
  if (bpm <= 180 && beatsBetweenDownbeats(m, a, b, bpm) < 6) return line;
  const period = line.period * 2;
  const v0 = gridValue(e, period, line.origin, a, b), v1 = gridValue(e, period, line.origin + line.period, a, b);
  return tuneOnAttacks(e, { ...line, period, origin: v0 >= v1 ? line.origin : line.origin + line.period }, a, b);
}

/** Vizinhos de andamento quase igual viram um trecho se uma grade só explica os ataques dos dois. */
function mergeTuned(e: Float32Array, pts: number[], input: BeatLine[], duration: number): BeatLine[] {
  const lines = [...input];
  const edge = (i: number) => (i === 0 ? 0.2 : pts[lines[i].from] - 0.05);
  const stop = (i: number) => (i + 1 < lines.length ? pts[lines[i + 1].from] - 0.05 : duration - 0.2);
  for (let changed = true; changed && lines.length > 1;) {
    changed = false;
    for (let i = 0; i + 1 < lines.length; i++) {
      const a = lines[i], b = lines[i + 1];
      // mesmo pulso em outro nível (metade ou dobro): as batidas do lento caem na grade do rápido
      const ratio = Math.max(a.period, b.period) / Math.min(a.period, b.period);
      if (Math.abs(ratio - 2) <= 0.03) {
        const fast = a.period < b.period ? a : b, slow = fast === a ? b : a;
        // trecho em meio tempo entre dois do mesmo andamento é a mesma música
        const beyond = slow === b ? lines[i + 2] : lines[i - 1];
        const between = !!beyond && Math.abs(beyond.period / fast.period - 1) <= 0.005;
        if (between || countOn(pts, { period: fast.period / 2, origin: fast.origin }, slow.from, slow.to, 0.04) >= (slow.to - slow.from + 1) * 0.8) {
          lines.splice(i, 2, { ...fast, from: a.from, to: b.to });
          changed = true;
          break;
        }
      }
      if (Math.abs(a.period / b.period - 1) > 0.02) continue;
      const a0 = edge(i), a1 = stop(i), b1 = stop(i + 1);
      const main = a1 - a0 >= b1 - a1 ? a : b;
      const whole = tuneOnAttacks(e, { ...main, from: a.from, to: b.to }, a0, b1, pts);
      const apart = attackSupport(e, a.period, a.origin, a0, a1).value + attackSupport(e, b.period, b.origin, a1, b1).value;
      // mesmo andamento sem salto de fase: é a mesma grade, mesmo que os ataques variem de um lado para o outro
      const q = main.period, jump = Math.abs(lineError({ period: q, origin: a.origin }, b.origin));
      const sameGrid = Math.abs(60 / a.period - 60 / b.period) <= 0.12 && jump <= 0.02;
      // a reta do trecho maior passa por tantas batidas do menor quanto a dele: o BPM diferente era só ruído
      const big = a1 - a0 >= b1 - a1 ? a : b, small = big === a ? b : a;
      const sameBeats = Math.abs(big.period / small.period - 1) <= 0.003 && countOn(pts, big, small.from, small.to, 0.03) >= countOn(pts, small, small.from, small.to, 0.03) * 0.9;
      if (sameGrid || sameBeats || attackSupport(e, whole.period, whole.origin, a0, b1).value >= apart * 0.93) {
        lines.splice(i, 2, sameGrid || sameBeats ? { ...big, from: a.from, to: b.to } : whole);
        changed = true;
        break;
      }
    }
  }
  return lines;
}

/** Batida marcada em tempos alternados: a grade fica no pulso, e as batidas continuam em cima dela. */
function pulseLevel(l: BeatLine): BeatLine {
  const bpm = 60 / l.period;
  return bpm < 72 && bpm * 2 <= 165 ? { ...l, period: l.period / 2 } : l;
}

const countOn = (pts: number[], l: { period: number; origin: number }, a: number, b: number, tol = LINE_TOL) => {
  let n = 0;
  for (let i = a; i <= b; i++) if (Math.abs(lineError(l, pts[i])) <= tol) n++;
  return n;
};

/** Mesmo andamento, com a batida no meio do tempo: é o modelo marcando o contratempo por uns compassos. */
function isOffbeatOf(a: BeatLine, b: BeatLine): boolean {
  if (Math.abs(a.period / b.period - 1) > 0.006) return false;
  const q = a.period, d = (((b.origin - a.origin) % q) + q) % q;
  return d > 0.35 * q && d < 0.65 * q;
}

/** Junta vizinhos que uma reta só explica, e tira trecho que não se sustenta nas próprias batidas. */
function mergeLines(pts: number[], input: BeatLine[]): BeatLine[] {
  const lines = [...input];
  for (let changed = true; changed && lines.length > 1;) {
    changed = false;
    for (let i = 0; i + 1 < lines.length; i++) {
      const a = lines[i], b = lines[i + 1];
      const main = a.to - a.from >= b.to - b.from ? a : b;
      const small = main === a ? b : a;
      if (Math.abs(a.period / b.period - 1) <= 0.04) {
        const whole = fitBeatLine(pts, a.from, b.to, main);
        const apart = countOn(pts, a, a.from, a.to) + countOn(pts, b, b.from, b.to);
        if (whole && countOn(pts, whole, a.from, b.to) >= apart - Math.max(1, apart * 0.03)) {
          lines.splice(i, 2, { ...whole, from: a.from, to: b.to });
          changed = true;
          break;
        }
      }
      if (isOffbeatOf(main, small) || small.hits < 5) {
        const fresh = fitBeatLine(pts, a.from, b.to, main) ?? main;
        lines.splice(i, 2, { ...fresh, from: a.from, to: b.to });
        changed = true;
        break;
      }
    }
  }
  return lines;
}

// Fase pela subida do ataque. O pico da derivada marca o começo da nota: em piano, violão e teclado
// isso vem de 15 a 30 ms antes da batida, e a fase de uma faixa sem bateria saía adiantada. A subida
// inteira, somada em todas as batidas, passa pela batida no mesmo ponto com e sem bateria.

/** Faixa em que voz, teclado, violão e caixa atacam; o grave e o brilho arrastam a subida. */
const RISE_LOW_HZ = 200;
const RISE_HIGH_HZ = 2000;
/** Ponto da subida do ataque que coincide com a batida. */
const RISE_LEVEL = 0.6;
/** Janela em volta de cada batida. */
const RISE_REACH = 0.1;
/** Quanto a soma das batidas precisa subir para haver ataque de verdade (som contínuo não tem fase). */
const RISE_MIN_CONTRAST = 0.1;
/** Até onde a subida pode corrigir a fase. */
const RISE_MAX_SHIFT = 0.045;

/** Coeficientes de um filtro de 2ª ordem Butterworth (passa-altas ou passa-baixas). */
function biquadCoefs(sr: number, hz: number, high: boolean): { b0: number; b1: number; b2: number; a1: number; a2: number } {
  const w = (2 * Math.PI * hz) / sr, c = Math.cos(w), alpha = Math.sin(w) / Math.SQRT2, a0 = 1 + alpha;
  const b0 = (high ? (1 + c) / 2 : (1 - c) / 2) / a0;
  return { b0, b1: (high ? -(1 + c) : 1 - c) / a0, b2: b0, a1: (-2 * c) / a0, a2: (1 - alpha) / a0 };
}

/** Nível da faixa média a cada 1 ms, sem guardar o sinal filtrado (a faixa inteira pesaria na memória). */
function riseEnvelope(mono: Float32Array, sr: number): { e: Float32Array; fps: number } {
  const hp = biquadCoefs(sr, RISE_LOW_HZ, true), lp = biquadCoefs(sr, RISE_HIGH_HZ, false);
  const hop = Math.max(1, Math.round(sr / 1000)), n = Math.floor(mono.length / hop), e = new Float32Array(n);
  let x1 = 0, x2 = 0, h1 = 0, h2 = 0, l1 = 0, l2 = 0;
  for (let f = 0; f < n; f++) {
    let sum = 0;
    for (let i = f * hop, end = i + hop; i < end; i++) {
      const v = mono[i];
      const h = hp.b0 * v + hp.b1 * x1 + hp.b2 * x2 - hp.a1 * h1 - hp.a2 * h2;
      const l = lp.b0 * h + lp.b1 * h1 + lp.b2 * h2 - lp.a1 * l1 - lp.a2 * l2;
      x2 = x1; x1 = v; h2 = h1; h1 = h; l2 = l1; l1 = l;
      sum += l * l;
    }
    e[f] = Math.sqrt(sum / hop);
  }
  return { e, fps: sr / hop };
}

/** Quanto a grade precisa andar para passar pelo ponto da subida do ataque. Null quando não há ataque claro. */
function riseOffset(rise: { e: Float32Array; fps: number }, period: number, origin: number, a: number, b: number): number | null {
  const { e, fps } = rise, R = Math.round(RISE_REACH * fps), profile = new Float64Array(2 * R + 1);
  let beats = 0;
  for (let k = Math.ceil((a - origin) / period); origin + k * period < b; k++) {
    const c = Math.round((origin + k * period) * fps);
    if (c - R < 0 || c + R >= e.length) continue;
    let top = 0;
    for (let o = -R; o <= R; o++) if (e[c + o] > top) top = e[c + o];
    if (top <= 0) continue;
    for (let o = -R; o <= R; o++) profile[o + R] += e[c + o] / top;
    beats++;
  }
  if (beats < 8) return null;
  let low = 0;
  for (let i = 0; i <= R + Math.round(0.01 * fps); i++) if (profile[i] < profile[low]) low = i;
  let high = low;
  for (let i = low; i <= Math.min(2 * R, R + Math.round(0.06 * fps)); i++) if (profile[i] > profile[high]) high = i;
  if (high <= low || (profile[high] - profile[low]) / beats < RISE_MIN_CONTRAST) return null;
  const level = profile[low] + RISE_LEVEL * (profile[high] - profile[low]);
  let j = low;
  while (j < high && profile[j] < level) j++;
  const part = j > low ? (level - profile[j - 1]) / Math.max(1e-9, profile[j] - profile[j - 1]) : 0;
  const shift = (j - 1 + part - R) / fps;
  return Math.abs(shift) <= RISE_MAX_SHIFT ? shift : null;
}

/** Leva cada reta para o ponto da subida do ataque; a emenda anda junto com a reta que começa nela. */
function phaseOnRise(res: { lines: BeatLine[]; pts: number[]; starts: number[] }, rise: { e: Float32Array; fps: number }, duration: number): { lines: BeatLine[]; pts: number[]; starts: number[] } {
  const shifts = res.lines.map((l, i) => riseOffset(rise, l.period, l.origin, i === 0 ? 0.2 : res.starts[i], i + 1 < res.lines.length ? res.starts[i + 1] : duration - 0.2) ?? 0);
  return {
    pts: res.pts,
    lines: res.lines.map((l, i) => ({ ...l, origin: l.origin + shifts[i] })),
    starts: res.starts.map((t, i) => (i === 0 ? t : t + shifts[i])),
  };
}

/** Ataque de uma batida só: onde a subida do nível cruza o ponto da batida, perto de `t`. */
function attackAt(rise: { e: Float32Array; fps: number }, t: number): number | null {
  const { e, fps } = rise, c = Math.round(t * fps), R = Math.round(0.03 * fps);
  if (c - R - 1 < 0 || c + R + 1 >= e.length) return null;
  let top = c - R;
  for (let i = c - R; i <= c + R; i++) if (e[i] > e[top]) top = i;
  let low = top;
  for (let i = top; i >= Math.max(0, top - Math.round(0.05 * fps)); i--) if (e[i] < e[low]) low = i;
  if (top <= low || e[low] >= e[top] * 0.8) return null;
  const level = e[low] + RISE_LEVEL * (e[top] - e[low]);
  let j = low;
  while (j < top && e[j] < level) j++;
  const part = j > low ? (level - e[j - 1]) / Math.max(1e-9, e[j] - e[j - 1]) : 0;
  return (j - 1 + part) / fps;
}

/** Até onde cada batida de um compasso de passagem pode estar da reta dele. */
const BRIDGE_TOL = 0.003;
/** O compasso de passagem só existe se explica os ataques bem melhor que a reta seguinte. */
const BRIDGE_GAIN = 2;
const BRIDGE_MIN_MISS = 0.003;

/**
 * Compasso de passagem entre dois andamentos (140, um compasso a 147, depois 148). Curto demais para
 * virar uma reta do modelo, mas as batidas dele não caem nem na reta anterior nem na seguinte: a reta
 * que liga a última batida da anterior à primeira da seguinte passa exatamente por todas elas.
 */
function withBridges(res: { lines: BeatLine[]; pts: number[]; starts: number[] }, rise: { e: Float32Array; fps: number }, beatsPerBar: number): { lines: BeatLine[]; pts: number[]; starts: number[]; bridges: Set<number> } {
  const lines = [...res.lines], starts = [...res.starts], bridges = new Set<number>();
  for (let i = 1; i < lines.length; i++) {
    if (bridges.has(i - 1)) continue;
    const A = lines[i - 1], B = lines[i];
    const ratio = Math.abs(A.period / B.period - 1);
    if (ratio < 0.005 || ratio > 0.15) continue;
    const lastA = A.origin + Math.floor((starts[i] - A.origin) / A.period + 1e-6) * A.period;
    let found: { t0: number; t1: number; q: number; miss: number } | null = null;
    for (let back = 0; back < 2 && !found; back++) {
      const t0 = lastA - back * A.period;
      const t1 = B.origin + Math.round((t0 + (beatsPerBar * (A.period + B.period)) / 2 - B.origin) / B.period) * B.period;
      const q = (t1 - t0) / beatsPerBar;
      if (q < Math.min(A.period, B.period) * 0.9995 || q > Math.max(A.period, B.period) * 1.0005) continue;
      let own = 0, other = 0, worst = 0, n = 0;
      for (let j = 1; j < beatsPerBar; j++) {
        const expected = t0 + j * q, at = attackAt(rise, expected);
        if (at === null) { n = -1; break; }
        const miss = Math.abs(at - expected);
        worst = Math.max(worst, miss);
        own += miss;
        other += Math.abs(at - (t1 - (beatsPerBar - j) * B.period));
        n++;
      }
      if (n !== beatsPerBar - 1 || worst > BRIDGE_TOL) continue;
      if (other / n >= BRIDGE_MIN_MISS && other >= BRIDGE_GAIN * own) found = { t0, t1, q, miss: own / n };
    }
    if (!found) continue;
    const c = res.pts.findIndex((t) => t >= found!.t0 - 0.02);
    const first = Math.max(0, c);
    const bridge: BeatLine = { period: found.q, origin: found.t0, from: first, to: Math.min(res.pts.length - 1, first + beatsPerBar - 1), hits: beatsPerBar };
    lines.splice(i, 0, bridge);
    starts.splice(i, 1, found.t0, found.t1);
    bridges.add(i);
    i++;
  }
  return { lines, pts: res.pts, starts, bridges };
}

/** Trechos da régua a partir das retas: cada trecho entra na primeira batida dele. */
function sectionsFromLines(m: BeatModel, res: { lines: BeatLine[]; pts: number[]; starts: number[]; bridges?: Set<number> }, duration: number, beatsPerBar: number): TempoSection[] {
  const { lines, starts, bridges } = res;
  const sections = lines.map((l, i) => {
    const end = i + 1 < lines.length ? starts[i + 1] : duration;
    const firstBeat = l.origin + Math.ceil((starts[i] - l.origin) / l.period - 1e-6) * l.period;
    // BPM inteiro fica inteiro; o resto guarda a medida completa e só a tela arredonda
    const raw = 60 / l.period, bpm = Math.abs(raw - Math.round(raw)) < 1e-6 ? Math.round(raw) : raw;
    const b = modelBar(m, firstBeat, end, bpm, beatsPerBar);
    return { start: starts[i], end, bpm, firstBeat, barPhase: b.phase, barMargin: b.margin, confidence: l.hits / Math.max(1, l.to - l.from + 1) };
  });
  // compasso de passagem é curto demais para o 1 do modelo: a contagem continua a do trecho anterior
  sections.forEach((s, i) => {
    if (!bridges?.has(i) || i === 0) return;
    const before = sections[i - 1];
    const k = Math.round((s.firstBeat - before.firstBeat) / (60 / before.bpm));
    const inBar = (((k - before.barPhase) % beatsPerBar) + beatsPerBar) % beatsPerBar;
    s.barPhase = (beatsPerBar - inBar) % beatsPerBar;
  });
  return sections;
}

export function analyzeTempoMap(mono: Float32Array, sr: number, beatsPerBar = 4, model?: BeatModel): { sections: TempoSection[]; ms: number } {
  const t0 = performance.now();
  const duration = mono.length / sr;
  const { env: rawEnv, low, high } = onsetEnvelope(mono, sr);
  // Com o modelo: só contam os ataques onde ele vê uma batida. Tira contratempo, virada e voz da conta.
  const env = model ? gateByModel(rawEnv, model) : rawEnv;
  attackEnv = rawEnv;
  if (model) {
    const tuned = softGate(high, model);
    mixAttackEnv = softGate(rawEnv, model);
    const byLines = beatLinesMap(model, tuned, rawEnv, duration);
    if (byLines) {
      const rise = riseEnvelope(mono, sr);
      const placed = withBridges(phaseOnRise(byLines, rise, duration), rise, beatsPerBar);
      return { sections: sectionsFromLines(model, placed, duration, beatsPerBar), ms: performance.now() - t0 };
    }
  }
  const spec = spectralFeatures(mono, sr);
  const states = tempoStates();
  const gram = tempogram(env, states);
  const path = bestPath(gram);

  // o caminho vira trechos (a janela é centrada: soma metade dela)
  let raw: Array<{ a: number; b: number; bpms: number[] }> = [];
  path.forEach((s, t) => {
    const bpm = states[s];
    const last = raw[raw.length - 1];
    const at = t * TEMPO_STEP;
    if (last && sameTempo(median(last.bpms), bpm)) { last.b = at + TEMPO_STEP; last.bpms.push(bpm); }
    else raw.push({ a: at, b: at + TEMPO_STEP, bpms: [bpm] });
  });
  // trecho curto demais não é uma música: entra no vizinho
  for (let changed = true; changed && raw.length > 1;) {
    changed = false;
    const i = raw.findIndex((r) => r.b - r.a < MIN_SECTION_SEC);
    if (i >= 0) {
      const j = i === 0 ? 1 : i - 1;
      const [x, y] = i < j ? [i, j] : [j, i];
      raw[x] = { a: raw[x].a, b: raw[y].b, bpms: [...raw[x].bpms, ...raw[y].bpms] };
      raw.splice(y, 1);
      changed = true;
    }
    for (let k = 1; k < raw.length; k++) {
      if (sameTempo(median(raw[k - 1].bpms), median(raw[k].bpms))) {
        raw[k - 1] = { a: raw[k - 1].a, b: raw[k].b, bpms: [...raw[k - 1].bpms, ...raw[k].bpms] };
        raw.splice(k, 1);
        changed = true;
        break;
      }
    }
  }

  const half = WINDOW_SEC / 2;
  const cuts = raw.map((r, i) => (i === 0 ? 0 : r.a + half));
  const fits = raw.map((r, i) => {
    const a = i === 0 ? 0 : cuts[i] + 3;
    const b = i === raw.length - 1 ? duration : cuts[i + 1] - 3;
    return fitGrid(env, a, Math.max(b, a + 4), median(r.bpms));
  });
  // troca só vale se a grade do trecho anterior NÃO explica o seguinte, e o trecho tem pulso claro
  for (let i = fits.length - 1; i > 0; i--) {
    const a = cuts[i] + 2, b = (i === fits.length - 1 ? duration : cuts[i + 1]) - 2;
    const own = combScore(env, Math.floor(a * envFps), Math.floor(b * envFps), fits[i].bpm, envFps);
    const prevGrid = combScore(env, Math.floor(a * envFps), Math.floor(b * envFps), fits[i - 1].bpm, envFps);
    if (own < MIN_PULSE || prevGrid >= own * 0.88) { fits.splice(i, 1); cuts.splice(i, 1); raw.splice(i, 1); }
  }
  const starts = fits.map((f, i) => {
    if (i === 0) return 0;
    const near = refineSplit(env, cuts[i], fits[i - 1], f);
    const t = model ? near : novelty(spec, near), p = 60 / f.bpm;
    return f.t0 + Math.ceil((t - f.t0) / p - 1e-6) * p;
  });
  if (model) {
    for (let i = 0; i < fits.length; i++) {
      const b = i === fits.length - 1 ? duration : starts[i + 1], o = modelOctave(model, starts[i], b, fits[i].bpm);
      if (o !== fits[i].bpm) fits[i] = fitGrid(env, starts[i] + 0.3, b - 0.3, o);
    }
  }
  if (model && fits.length > 1) {
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 0; i < fits.length; i++) {
        const a = starts[i], b = i === fits.length - 1 ? duration : starts[i + 1], len = b - a;
        const m = Math.min(len * 0.2, 6);
        fits[i] = fitGrid(env, a + m, b - m, fits[i].bpm);
      }
      for (let i = 1; i < fits.length; i++) {
        const prev = starts[i - 1], next = i + 1 < fits.length ? starts[i + 1] : duration;
        starts[i] = modelSplit(model, spec, prev + Math.min(6, (starts[i] - prev) * 0.4), next - Math.min(6, (next - starts[i]) * 0.4), fits[i - 1], fits[i]);
      }
    }
    for (let i = 0; i < fits.length; i++) {
      const b = i === fits.length - 1 ? duration : starts[i + 1];
      fits[i] = fitGrid(env, starts[i] + 0.3, b - 0.3, fits[i].bpm);
      if (i) { const p = 60 / fits[i].bpm; starts[i] = fits[i].t0 + Math.ceil((starts[i] - 0.05 - fits[i].t0) / p) * p; }
    }
  } else if (model) {
    fits[0] = fitGrid(env, 0.3, duration - 0.3, fits[0].bpm);
  }
  if (model) repairSections(model, env, spec, fits, starts, duration);
  if (model) for (let i = 0; i < fits.length; i++) {
    const b = i === fits.length - 1 ? duration : starts[i + 1];
    let want = modelOctave(model, starts[i], b, fits[i].bpm);
    // acima de 165 pode ser música rápida ou colcheia lida como batida: quem decide é a distância entre os 1
    if (want > 185 || (want > 165 && beatsBetweenDownbeats(model, starts[i], b, want) >= 6)) want /= 2;
    if (want < 72 && want * 2 <= 165) want *= 2;
    if (Math.abs(want / fits[i].bpm - 1) > 0.2) fits[i] = fitGrid(env, starts[i] + 0.3, b - 0.3, want);
  }
  // músicas de andamento igual ou quase igual emendadas
  if (model) for (let round = 0; round < 4; round++) {
    let changed = false;
    for (let i = 0; i < fits.length && !changed; i++) {
      const b = i === fits.length - 1 ? duration : starts[i + 1];
      const two = splitByTwoGrids(model, starts[i] + 0.3, b - 0.3, fits[i].bpm);
      if (!two) continue;
      const p = 60 / two.R.bpm, cut = two.R.t0 + Math.ceil((two.cut - two.R.t0) / p - 1e-6) * p;
      if (cut - starts[i] < 10 || b - cut < 10) continue;
      const left = { ...fits[i], bpm: two.L.bpm, t0: two.L.t0 };
      fits.splice(i, 1, left, { ...fits[i], bpm: two.R.bpm, t0: two.R.t0 });
      starts.splice(i + 1, 0, cut);
      changed = true;
    }
    if (!changed) break;
  }
  // cada emenda vai para onde as duas grades encaixam melhor, e cada trecho reancora nas próprias batidas
  if (model && fits.length > 1) for (let pass = 0; pass < 2; pass++) {
    for (let i = 1; i < fits.length; i++) {
      const next = i + 1 < fits.length ? starts[i + 1] : duration;
      const moved = refineSeam(model, starts[i - 1] + 2, next - 2, starts[i], fits[i - 1], fits[i]);
      if (moved - starts[i - 1] >= 8 && next - moved >= 8) starts[i] = moved;
    }
    for (let i = 0; i < fits.length; i++) {
      const b = i === fits.length - 1 ? duration : starts[i + 1], pts = preciseBeats(model, starts[i] + 0.3, b - 0.3);
      if (pts.length < 12) continue;
      const fresh = fitPoints(pts, fits[i].bpm);
      if (fresh.hits >= pts.filter((t) => { const q = 60 / fits[i].bpm; return Math.abs(t - (fits[i].t0 + Math.round((t - fits[i].t0) / q) * q)) < 0.03; }).length) fits[i] = { ...fits[i], bpm: fresh.bpm, t0: fresh.t0 };
    }
  }
  // grade que ficou no contratempo: as batidas do modelo mostram a fase certa
  if (model) for (let i = 0; i < fits.length; i++) {
    const b = i === fits.length - 1 ? duration : starts[i + 1];
    const tuned = refineByBeats(model, starts[i] + 0.5, b - 0.5, fits[i]);
    if (coverage(model, starts[i] + 0.5, b - 0.5, tuned) >= coverage(model, starts[i] + 0.5, b - 0.5, fits[i]) + 0.2) fits[i] = tuned;
    fits[i] = snapWholeBpm(model, starts[i] + 0.5, b - 0.5, fits[i]);
  }
  const sections = fits.map((f, i) => {
    const end = i === fits.length - 1 ? duration : starts[i + 1];
    const p = 60 / f.bpm;
    const firstBeat = f.t0 + Math.ceil((starts[i] - f.t0) / p - 1e-6) * p;
    const b = model ? modelBar(model, firstBeat, end, f.bpm, beatsPerBar) : barPhase({ low, high, spec }, firstBeat, end, f.bpm, beatsPerBar);
    return { start: starts[i], end, bpm: Math.round(f.bpm * 100) / 100, firstBeat, barPhase: b.phase, barMargin: b.margin, confidence: f.score };
  });
  return { sections, ms: performance.now() - t0 };
}

