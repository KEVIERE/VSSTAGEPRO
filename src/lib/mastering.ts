// Cadeia de masterização de um clipe, em float 32 bits e sem depender do navegador:
//  1. passa-altas (tira subgrave inaudível e DC: 25 Hz em instrumentos, 70 Hz em voz);
//  2. EQ discreto só em voz (presença e ar); instrumentos ficam com o timbre original;
//  3. compressor "glue" com detector RMS, joelho suave e ataque lento (cola sem esmagar o
//     ataque do bumbo/palhetada);
//  4. volume final igual ao do clipe original (loudness integrado em LUFS) — num VS cada clipe
//     é uma faixa da mixagem: subir cada faixa até um alvo fixo desmontaria o equilíbrio;
//  5. limitador com look-ahead, teto de -1 dBTP (true peak), sem cortar a onda.
import { dbToGain, gainToDb, integratedLoudness, lookaheadLimit, truePeak } from './loudness.ts';
import type { Biquad } from './loudness.ts';

export interface MasterReport {
  lufsBefore: number;
  lufsAfter: number;
  peakBeforeDbtp: number;
  peakAfterDbtp: number;
  compressionDb: number;
  limiterDb: number;
}

export const MASTER_CEILING_DBTP = -1;

function rbj(type: 'highpass' | 'peaking' | 'highshelf', f0: number, sr: number, q: number, gainDb = 0): Biquad {
  const A = Math.pow(10, gainDb / 40);
  const w = (2 * Math.PI * f0) / sr;
  const cw = Math.cos(w);
  const sw = Math.sin(w);
  const alpha = sw / (2 * q);
  let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number;
  if (type === 'highpass') {
    b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = (1 + cw) / 2;
    a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
  } else if (type === 'peaking') {
    b0 = 1 + alpha * A; b1 = -2 * cw; b2 = 1 - alpha * A;
    a0 = 1 + alpha / A; a1 = -2 * cw; a2 = 1 - alpha / A;
  } else {
    const s = 2 * Math.sqrt(A) * alpha;
    b0 = A * ((A + 1) + (A - 1) * cw + s); b1 = -2 * A * ((A - 1) + (A + 1) * cw); b2 = A * ((A + 1) + (A - 1) * cw - s);
    a0 = (A + 1) - (A - 1) * cw + s; a1 = 2 * ((A - 1) - (A + 1) * cw); a2 = (A + 1) - (A - 1) * cw - s;
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

function biquad(x: Float32Array, f: Biquad) {
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const x0 = x[i];
    const y0 = f.b0 * x0 + f.b1 * x1 + f.b2 * x2 - f.a1 * y1 - f.a2 * y2;
    x2 = x1; x1 = x0; y2 = y1; y1 = y0;
    x[i] = y0;
  }
}

/** Compressor com detector RMS ligado nos canais (o estéreo não anda). Devolve a maior redução (dB). */
function glueCompress(ch: Float32Array[], sr: number): number {
  const n = ch[0].length;
  // detector: RMS de ~10 ms
  const rmsCoef = Math.exp(-1 / (0.01 * sr));
  const env = new Float32Array(n);
  let ms = 0;
  for (let i = 0; i < n; i++) {
    let p = 0;
    for (const c of ch) p += c[i] * c[i];
    p /= ch.length;
    ms = p + (ms - p) * rmsCoef;
    env[i] = ms;
  }
  // limiar: 3 dB abaixo do nível que só os 10% mais fortes do clipe passam (só a parte forte comprime)
  const sorted = Float32Array.from(env.filter((_, i) => i % 64 === 0)).sort();
  const p90 = sorted[Math.floor(sorted.length * 0.9)] ?? 0;
  if (p90 <= 1e-9) return 0;
  const threshold = 10 * Math.log10(p90) - 3;
  const ratio = 2;
  const knee = 6;
  const att = Math.exp(-1 / (0.025 * sr));
  const rel = Math.exp(-1 / (0.25 * sr));
  let gr = 0;
  let worst = 0;
  for (let i = 0; i < n; i++) {
    const level = env[i] > 1e-12 ? 10 * Math.log10(env[i]) : -120;
    const over = level - threshold;
    let want = 0;
    if (over > knee / 2) want = over * (1 / ratio - 1);
    else if (over > -knee / 2) { const k = over + knee / 2; want = (1 / ratio - 1) * (k * k) / (2 * knee); }
    gr = want < gr ? want + (gr - want) * att : want + (gr - want) * rel;
    if (gr < worst) worst = gr;
    const g = dbToGain(gr);
    for (const c of ch) c[i] *= g;
  }
  return worst;
}

export function masterChannels(input: Float32Array[], sampleRate: number, options: { vocal: boolean }): { channels: Float32Array[]; report: MasterReport } {
  const ch = input.map((c) => Float32Array.from(c));
  const lufsBefore = integratedLoudness(ch, sampleRate);
  const peakBefore = truePeak(ch);
  if (!Number.isFinite(lufsBefore)) {
    return { channels: ch, report: { lufsBefore, lufsAfter: lufsBefore, peakBeforeDbtp: gainToDb(peakBefore), peakAfterDbtp: gainToDb(peakBefore), compressionDb: 0, limiterDb: 0 } };
  }
  const hp = rbj('highpass', options.vocal ? 70 : 25, sampleRate, 0.707);
  const eq = options.vocal ? [rbj('peaking', 3500, sampleRate, 1.0, 1.5), rbj('highshelf', 10000, sampleRate, 0.707, 1.0)] : [];
  for (const c of ch) {
    biquad(c, hp);
    for (const f of eq) biquad(c, f);
  }
  const compressionDb = glueCompress(ch, sampleRate);
  // devolve o loudness do original (a compressão e o filtro mudaram o nível)
  const mid = integratedLoudness(ch, sampleRate);
  if (Number.isFinite(mid)) {
    const g = dbToGain(lufsBefore - mid);
    for (const c of ch) for (let i = 0; i < c.length; i++) c[i] *= g;
  }
  // teto em true peak: limita numa margem que cobre o pico entre amostras e confere
  const ceiling = dbToGain(MASTER_CEILING_DBTP);
  let limiterDb = lookaheadLimit(ch, sampleRate, ceiling * 0.97);
  const tp = truePeak(ch);
  if (tp > ceiling) {
    const g = ceiling / tp;
    for (const c of ch) for (let i = 0; i < c.length; i++) c[i] *= g;
    limiterDb += gainToDb(g);
  }
  return {
    channels: ch,
    report: {
      lufsBefore,
      lufsAfter: integratedLoudness(ch, sampleRate),
      peakBeforeDbtp: gainToDb(peakBefore),
      peakAfterDbtp: gainToDb(truePeak(ch)),
      compressionDb,
      limiterDb,
    },
  };
}
