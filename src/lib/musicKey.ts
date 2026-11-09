// Tom da música: detecção pelo áudio, nome em cifra curta (G, Em, Bb, F#m) e transposição
// junto com o tuner. Sem dependências do navegador: roda igual no app e nos testes do Node.
//
// Detecção: cromagrama (energia de cada uma das 12 notas, somada em todas as oitavas) a partir
// de FFT em blocos, comparado por correlação com os perfis de Krumhansl-Kessler dos 24 tons.

export interface MusicKey { pc: number; minor: boolean }

// Nomes como os músicos escrevem a armadura (bemol ou sustenido conforme o tom).
const MAJOR_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const MINOR_NAMES = ['Cm', 'C#m', 'Dm', 'Ebm', 'Em', 'Fm', 'F#m', 'Gm', 'G#m', 'Am', 'Bbm', 'Bm'];
const PC: Record<string, number> = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, Fb: 4, F: 5, 'E#': 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11, Cb: 11 };

export function keyName(k: MusicKey): string {
  const pc = ((k.pc % 12) + 12) % 12;
  return k.minor ? MINOR_NAMES[pc] : MAJOR_NAMES[pc];
}

/** Aceita "G", "Em", "Bbm", "F# menor", "Sol maior"... Devolve null se não entender. */
export function parseKey(text: string | null | undefined): MusicKey | null {
  if (!text) return null;
  const t = text.trim();
  const latin: Record<string, string> = { do: 'C', 'dó': 'C', re: 'D', 'ré': 'D', mi: 'E', fa: 'F', 'fá': 'F', sol: 'G', la: 'A', 'lá': 'A', si: 'B' };
  const m = /^([A-Ga-g]|d[oó]|r[eé]|mi|f[aá]|sol|l[aá]|si)\s*([#♯b♭]?)\s*(m(?!aj)|min|menor|minor|maior|major|M)?\s*$/i.exec(t);
  if (!m) return null;
  const letter = latin[m[1].toLowerCase()] ?? m[1].toUpperCase();
  const acc = m[2] === '♯' ? '#' : m[2] === '♭' ? 'b' : m[2];
  const pc = PC[letter + acc];
  if (pc === undefined) return null;
  const q = (m[3] ?? '').toLowerCase();
  const minor = m[3] === 'm' || q === 'min' || q === 'menor' || q === 'minor';
  return { pc, minor };
}

export function transposeKey(k: MusicKey, semitones: number): MusicKey {
  return { pc: (((k.pc + Math.round(semitones)) % 12) + 12) % 12, minor: k.minor };
}

/** Tom que o público ouve: o tom da música com o tuner aplicado (ex.: G com +2 = A). */
export function songKeyLabel(song: { musicKey?: string | null; tuner?: number } | null | undefined): string {
  const k = parseKey(song?.musicKey);
  return k ? keyName(transposeKey(k, song?.tuner ?? 0)) : '';
}

// Perfis de Krumhansl-Kessler (peso de cada grau da escala).
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function correlate(chroma: ArrayLike<number>, profile: number[], shift: number): number {
  let mx = 0, my = 0;
  for (let i = 0; i < 12; i++) { mx += chroma[(i + shift) % 12]; my += profile[i]; }
  mx /= 12; my /= 12;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < 12; i++) {
    const x = chroma[(i + shift) % 12] - mx;
    const y = profile[i] - my;
    num += x * y; dx += x * x; dy += y * y;
  }
  return dx > 0 && dy > 0 ? num / Math.sqrt(dx * dy) : -1;
}

/** Melhor tom para um cromagrama (12 valores, C..B) e quanto ele venceu do segundo colocado. */
export function keyFromChroma(chroma: ArrayLike<number>): { key: MusicKey; score: number; margin: number } {
  const scores: Array<{ key: MusicKey; score: number }> = [];
  for (let pc = 0; pc < 12; pc++) {
    scores.push({ key: { pc, minor: false }, score: correlate(chroma, MAJOR_PROFILE, pc) });
    scores.push({ key: { pc, minor: true }, score: correlate(chroma, MINOR_PROFILE, pc) });
  }
  scores.sort((a, b) => b.score - a.score);
  return { key: scores[0].key, score: scores[0].score, margin: scores[0].score - scores[1].score };
}

// FFT radix-2 no lugar (re, im)
function fft(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ar = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const ai = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k + len / 2] = re[i + k] - ar; im[i + k + len / 2] = im[i + k] - ai;
        re[i + k] += ar; im[i + k] += ai;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}

/**
 * Cromagrama de um áudio mono. Usa blocos de ~0,19 s espalhados por até `maxSeconds` do áudio
 * (o meio da música tem mais harmonia que a introdução), só de 55 Hz a 2 kHz.
 */
export function chromagram(mono: ArrayLike<number>, sampleRate: number, maxSeconds = 120): Float64Array {
  const N = 8192;
  const chroma = new Float64Array(12);
  const total = mono.length;
  if (total < N) return chroma;
  const span = Math.min(total, Math.round(maxSeconds * sampleRate));
  const start = Math.max(0, Math.floor((total - span) / 2));
  const frames = Math.min(400, Math.max(1, Math.floor(span / N)));
  const step = Math.max(N, Math.floor(span / frames));
  const win = new Float64Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
  const binHz = sampleRate / N;
  const lo = Math.ceil(55 / binHz), hi = Math.min(N / 2 - 1, Math.floor(2000 / binHz));
  const pcOfBin = new Int8Array(N / 2);
  for (let b = lo; b <= hi; b++) pcOfBin[b] = ((Math.round(12 * Math.log2((b * binHz) / 440)) + 9) % 12 + 12) % 12;
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let f = 0; f < frames; f++) {
    const at = start + f * step;
    if (at + N > total) break;
    for (let i = 0; i < N; i++) { re[i] = mono[at + i] * win[i]; im[i] = 0; }
    fft(re, im);
    const frame = new Float64Array(12);
    let sum = 0;
    for (let b = lo; b <= hi; b++) {
      const mag = Math.sqrt(re[b] * re[b] + im[b] * im[b]);
      frame[pcOfBin[b]] += mag;
      sum += mag;
    }
    // cada bloco pesa igual (trechos altos não dominam), silêncio fica de fora
    if (sum > 1e-6) for (let p = 0; p < 12; p++) chroma[p] += frame[p] / sum;
  }
  return chroma;
}

/** Tom detectado de um áudio mono; `confident` é falso quando a música é ambígua. */
export function detectKey(mono: ArrayLike<number>, sampleRate: number): { key: string; confident: boolean } | null {
  const chroma = chromagram(mono, sampleRate);
  if (chroma.every((v) => v === 0)) return null;
  const r = keyFromChroma(chroma);
  return { key: keyName(r.key), confident: r.margin > 0.02 && r.score > 0.5 };
}
