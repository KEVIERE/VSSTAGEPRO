// "Música" sintética para os testes da masterização: bumbo, caixa, chimbal, baixo, acordes e
// uma voz, em estéreo, com parte mais fraca e refrão mais forte. Determinística (mesmo áudio
// em toda execução) e sem nenhum arquivo de música no repositório.
import { integratedLoudness, dbToGain } from '../../src/lib/loudness.ts';
import { designBiquad, FilterChain } from '../../src/lib/masterDsp.ts';

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296 * 2 - 1; };
}

/**
 * @param {object} o
 * @param {number} [o.seconds] duração
 * @param {number} [o.sr] taxa de amostragem
 * @param {number} [o.lufs] loudness final (LUFS)
 * @param {number} [o.bassSide] fração do baixo que vai para o lado (grave aberto no estéreo)
 * @param {boolean} [o.dull] sem agudos (passa-baixas em 2,5 kHz)
 * @param {boolean} [o.boomy] embolado (+7 dB em 250 Hz)
 * @param {boolean} [o.noBass] sem bumbo e baixo (arranjo sem grave)
 * @param {number} [o.seed]
 */
export function synthMix(o = {}) {
  const sr = o.sr ?? 48000;
  const seconds = o.seconds ?? 16;
  const n = Math.round(sr * seconds);
  const L = new Float32Array(n), R = new Float32Array(n);
  const rand = rng(o.seed ?? 7);
  const beat = 0.5;
  const bassNotes = [55, 55, 73.4, 82.4];
  const chordRoots = [220, 220, 293.7, 329.6];
  let hp = 0, prevNoise = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const section = t < seconds / 2 ? 0.55 : 1; // estrofe mais fraca, refrão mais forte
    const b = Math.floor(t / beat);
    const tb = t - b * beat;
    const bar = Math.floor(b / 4) % 4;
    let mono = 0, side = 0;
    if (!o.noBass) {
      // bumbo: seno com queda de afinação, a cada tempo
      const kf = 50 + 90 * Math.exp(-tb * 40);
      mono += 0.9 * Math.sin(2 * Math.PI * kf * tb) * Math.exp(-tb * 9);
      // baixo
      const bf = bassNotes[bar];
      const benv = Math.min(1, tb * 200) * Math.exp(-tb * 2.5);
      const bass = 0.45 * benv * (Math.sin(2 * Math.PI * bf * t) + 0.3 * Math.sin(4 * Math.PI * bf * t));
      mono += bass * (1 - (o.bassSide ?? 0));
      side += bass * (o.bassSide ?? 0);
    }
    // caixa nos tempos 2 e 4
    const noise = rand();
    if (b % 2 === 1) mono += 0.55 * Math.exp(-tb * 22) * (0.6 * noise + 0.4 * Math.sin(2 * Math.PI * 190 * tb));
    // chimbal em colcheias (ruído agudo)
    hp = noise - prevNoise; prevNoise = noise;
    const te = t % (beat / 2);
    const hat = 0.16 * Math.exp(-te * 70) * hp;
    // acordes (dente de serra em 3 notas), um pouco abertos no estéreo
    let pad = 0, padS = 0;
    const root = chordRoots[bar];
    for (const ratio of [1, 1.26, 1.5]) {
      for (let k = 1; k <= 6; k++) {
        const ph = 2 * Math.PI * root * ratio * k * t;
        pad += Math.sin(ph) / k;
        padS += Math.sin(ph * 1.003) / k;
      }
    }
    pad *= 0.06; padS *= 0.06;
    // "voz": tom com vibrato e formantes em ~700 Hz e ~2,6 kHz
    const vf = 330 * (1 + 0.01 * Math.sin(2 * Math.PI * 5.5 * t));
    let voice = 0;
    for (let k = 1; k <= 12; k++) {
      const f = vf * k;
      const w = Math.exp(-(((f - 700) / 350) ** 2)) + 0.5 * Math.exp(-(((f - 2600) / 600) ** 2)) + 0.08;
      voice += w * Math.sin(2 * Math.PI * f * t) / k;
    }
    voice *= 0.22 * (0.6 + 0.4 * Math.sin(2 * Math.PI * 0.25 * t) ** 2);
    const m = section * (mono + voice + pad * 0.5 + padS * 0.5);
    const s = section * (side + (pad - padS) * 0.5 + hat * 0.4);
    L[i] = m + s + section * hat * 0.6;
    R[i] = m - s + section * hat * 0.6;
  }
  const ch = [L, R];
  const filters = [];
  if (o.dull) filters.push(designBiquad('lowpass', 2500, sr, 0.707), designBiquad('lowpass', 2500, sr, 0.707));
  if (o.boomy) filters.push(designBiquad('peaking', 250, sr, 1.0, 7));
  if (filters.length) for (const x of ch) new FilterChain(filters).run(x);
  const g = dbToGain((o.lufs ?? -16) - integratedLoudness(ch, sr));
  for (const x of ch) for (let i = 0; i < n; i++) x[i] *= g;
  return ch;
}

/** Clique de metrônomo + "voz-guia" (sem grave) para o lado L de um arquivo LR. */
export function synthGuide(n, sr = 48000) {
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const tb = t % 0.5;
    x[i] = 0.5 * Math.exp(-tb * 300) * Math.sin(2 * Math.PI * 2000 * tb);
    const say = Math.floor(t) % 4 === 0 ? 1 : 0;
    x[i] += say * 0.15 * Math.sin(2 * Math.PI * 480 * t) * Math.sin(2 * Math.PI * 3 * t) ** 2;
  }
  return x;
}
