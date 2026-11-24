// Espectrograma log-mel do Beat This!: 22050 Hz, FFT 1024, salto 441, 128 faixas (30 a 11000 Hz, slaney).
const SR = 22050, NFFT = 1024, HOP = 441, MELS = 128;
const hz2mel = (f: number) => (f < 1000 ? (3 * f) / 200 : 15 + (27 * Math.log10(f / 1000)) / Math.log10(6.4));
const mel2hz = (m: number) => (m < 15 ? (200 * m) / 3 : 1000 * 6.4 ** ((m - 15) / 27));
function filters(): Array<{ from: number; w: Float32Array }> {
  const lo = hz2mel(30), hi = hz2mel(11000), pts = Array.from({ length: MELS + 2 }, (_, i) => mel2hz(lo + ((hi - lo) * i) / (MELS + 1)));
  return Array.from({ length: MELS }, (_, m) => {
    const v: number[] = []; let from = -1;
    for (let k = 0; k <= NFFT / 2; k++) {
      const f = (k * SR) / NFFT, g = Math.max(0, Math.min((f - pts[m]) / (pts[m + 1] - pts[m]), (pts[m + 2] - f) / (pts[m + 2] - pts[m + 1])));
      if (g > 0) { if (from < 0) from = k; v[k - from] = g; }
    }
    return { from: Math.max(0, from), w: Float32Array.from(v) };
  });
}
function rfftMag(re: Float64Array, im: Float64Array, out: Float32Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let b = n >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { const t = re[i]; re[i] = re[j]; re[j] = t; } }
  im.fill(0);
  for (let len = 2; len <= n; len <<= 1) {
    const a = (-2 * Math.PI) / len, wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) { let cr = 1, ci = 0; for (let k = 0; k < len / 2; k++) {
      const p = i + k, q = p + len / 2, xr = re[q] * cr - im[q] * ci, xi = re[q] * ci + im[q] * cr;
      re[q] = re[p] - xr; im[q] = im[p] - xi; re[p] += xr; im[p] += xi; const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t; } }
  }
  for (let k = 0; k <= n / 2; k++) out[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k]) / Math.sqrt(n);
}
export function logMel(x: Float32Array): { data: Float32Array; frames: number } {
  const fb = filters(), pad = NFFT / 2, frames = 1 + Math.floor(x.length / HOP), data = new Float32Array(frames * MELS);
  const win = Float64Array.from({ length: NFFT }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / NFFT));
  const at = (i: number) => { const n = x.length; if (i < 0) return x[Math.min(n - 1, -i)]; if (i >= n) return x[Math.max(0, 2 * n - 2 - i)]; return x[i]; };
  const re = new Float64Array(NFFT), im = new Float64Array(NFFT), mag = new Float32Array(NFFT / 2 + 1);
  for (let f = 0; f < frames; f++) {
    const s = f * HOP - pad;
    for (let i = 0; i < NFFT; i++) re[i] = at(s + i) * win[i];
    rfftMag(re, im, mag);
    for (let m = 0; m < MELS; m++) { let v = 0; const { from, w } = fb[m]; for (let i = 0; i < w.length; i++) v += mag[from + i] * w[i]; data[f * MELS + m] = Math.log1p(1000 * v); }
  }
  return { data, frames };
}
