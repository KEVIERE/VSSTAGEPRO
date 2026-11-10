// Masterização por IA de um clipe, em float 32 bits e sem depender do navegador (roda no worker
// da masterização, nos testes do Node e no script scripts/medir-masterizacao.mjs).
//
// Como um engenheiro de masterização, primeiro OUVE (mede) e depois decide:
//  - analisa loudness (LUFS), pico real (dBTP), espectro em terços de oitava, estéreo e
//    dinâmica; reconhece música já masterizada e arquivo LR (guia/click num lado, música no
//    outro);
//  - compara o equilíbrio tonal com o de masters comerciais de sertanejo/forró e corrige só o
//    que está fora da faixa delas, com EQ largo (nunca inventa grave que a gravação não tem);
//  - centraliza o grave (abaixo de ~110 Hz) e ajusta a largura do estéreo se estiver estreito
//    ou aberto demais;
//  - comprime em 3 bandas com limiares tirados da própria música (só a parte forte comprime);
//  - leva ao loudness do perfil escolhido com um limitador de true peak (look-ahead, release
//    adaptativo), teto de -1 dBTP, sem cortar a onda; se chegar ao alvo exigir esmagar a
//    música, para antes e avisa.
// Voz e instrumentos separados (stems) mantêm o próprio loudness: num VS cada clipe é uma
// faixa da mixagem e subir cada uma até um alvo fixo desmontaria o equilíbrio.
import { dbToGain, gainToDb, truePeak } from './loudness.ts';
import { THIRD_OCTAVES, longTermSpectrum, normalizeCurve, totalBandDb } from './masterAnalysis.ts';
import {
  FilterChain, LIMIT_BLOCK, applyBlockGains, biquadDb, designBiquad, kPowerBlocks, limiterGains,
  loudnessFromBlocks, loudnessLean, lr4, multibandCompress, truePeakBlocks, truePeakBlocksPrecise, truePeakPrecise, widebandCompress,
} from './masterDsp.ts';
import type { BandSettings, FilterKind } from './masterDsp.ts';

export type MasterRole = 'mix' | 'voice' | 'instrument';
export type MasterProfile = 'equilibrado' | 'show' | 'streaming';
export type InstrumentKind = 'bateria' | 'baixo' | 'guitarra' | 'violao' | 'teclado' | 'sanfona' | 'percussao' | 'outro';

export const MASTER_CEILING_DBTP = -1;

/** Perfis de loudness (como o "target loudness" do Moises). */
export const MASTER_PROFILES: Record<MasterProfile, { label: string; lufs: number; maxLossDb: number; intensity: number; exact: boolean }> = {
  // padrão: o alvo das masters automáticas -10 LUFS, com folga para o soco do bumbo
  equilibrado: { label: 'Equilibrado', lufs: -10, maxLossDb: 3, intensity: 1, exact: false },
  // perto das masters comerciais de sertanejo (mediana medida: -7,9 LUFS)
  show: { label: 'Show', lufs: -8, maxLossDb: 4.5, intensity: 1.4, exact: false },
  // plataformas normalizam em -14 LUFS: sai exatamente nesse volume
  streaming: { label: 'Streaming', lufs: -14, maxLossDb: 2, intensity: 0.7, exact: true },
};

// Equilíbrio tonal de referência: média e desvio, por terço de oitava (20 Hz a 20 kHz), de 11
// masters comerciais de sertanejo/forró (curva relativa: média de 100 Hz a 8 kHz = 0 dB),
// medidos com longTermSpectrum. Corrige só o que sai da faixa média ± metade do desvio.
const REF_TONAL = [-19.9, -15.3, -4.8, -1.4, 3.1, 5.8, 4.9, 4.5, 2.1, 3.3, 4.8, 4.2, 4.8, 4.1, 3.1, 3.6, 2.5, 0.5, 0.3, -0.3, -1.7, -3.4, -4.7, -5.2, -7.2, -7.4, -7.8, -9.4, -11.7, -17.3, -48.3];
const REF_SPREAD = [5.8, 5.6, 3.5, 3.9, 3.9, 3, 2.3, 2.5, 3.3, 3.4, 3.8, 2.3, 1.8, 2.3, 1.5, 2, 1.8, 2.1, 2.1, 2, 1.4, 1.6, 1.9, 1.9, 2, 2, 2, 1.9, 2.8, 4.5, 32.9];

/** Ajustes finos da cadeia (ficam num objeto só para os testes e o script de medição). */
export const MASTER_TUNING = {
  /** força da correção tonal (1 = leva até a borda da faixa das referências) */
  eqStrength: 0.75,
  /** faixa aceita em volta da média das referências, em desvios-padrão */
  eqTolerance: 0.35,
  /** limiar do multibanda: percentil do nível da banda nos trechos com som */
  mbPercentile: 85,
  mbBands: [
    { ratio: 2.2, kneeDb: 6, attackMs: 15, releaseMs: 200, maxGrDb: 6 },
    { ratio: 1.7, kneeDb: 8, attackMs: 12, releaseMs: 160, maxGrDb: 4 },
    { ratio: 2.0, kneeDb: 6, attackMs: 3, releaseMs: 80, maxGrDb: 5 },
  ] as Array<Omit<BandSettings, 'thresholdDb'>>,
  /** limitador: look-ahead e releases (s) */
  limiter: { lookahead: 0.005, releaseFast: 0.03, releaseSlow: 0.4 },
  /** música já masterizada: loudness acima disso e PLR abaixo disso */
  masteredLufs: -11.5,
  masteredPlr: 11.5,
};

/** Curva de referência suavizada (o vale de 125 Hz da média é dos bumbos/baixos, não regra). */
export const REFERENCE_TONAL: number[] = REF_TONAL.map((v, i, a) => (i === 0 || i === a.length - 1 ? v : (a[i - 1] + 2 * v + a[i + 1]) / 4));

export interface MasterOptions {
  role?: MasterRole;
  profile?: MasterProfile;
  instrument?: InstrumentKind;
  /** Compatibilidade: `vocal: true` = papel de voz. */
  vocal?: boolean;
  /** Processa os próprios arrays recebidos (sem cópia; usado no worker). */
  inPlace?: boolean;
  /** Só limpa o subgrave e segura o pico (lado da guia/click de um arquivo LR). */
  passive?: boolean;
  /**
   * Voz ou stem levados ao loudness do perfil (como uma master completa), em vez de manter o
   * volume original. O tratamento continua o do tipo de áudio (sem a curva tonal de mixagem).
   */
  forceProfile?: boolean;
}

export interface EqBand { kind: FilterKind; freq: number; q: number; gainDb: number }

export interface MasterPlan {
  role: MasterRole;
  profile: MasterProfile;
  instrument?: InstrumentKind;
  /** Loudness de saída desejado (LUFS) e quanto o limitador pode tirar de loudness */
  targetLufs: number;
  maxLossDb: number;
  highpassHz: number;
  eq: EqBand[];
  /** Correção desejada por terço de oitava (dB), antes de virar EQ */
  correction: number[];
  monoBassHz: number | null;
  /** Ganho do lado acima de 300 Hz (dB): + abre o estéreo, − fecha */
  widthDb: number;
  multiband: { crossovers: [number, number]; bands: BandSettings[] } | null;
  wideband: BandSettings | null;
  alreadyMastered: boolean;
  notes: string[];
}

export interface MasterReport {
  lufsBefore: number;
  lufsAfter: number;
  peakBeforeDbtp: number;
  peakAfterDbtp: number;
  /** Maior redução da compressão (dB, ≤ 0) */
  compressionDb: number;
  /** Redução média da compressão nos trechos em que ela age (dB, ≥ 0) */
  compressionAvgDb: number;
  /** Maior redução do limitador (dB, ≤ 0) */
  limiterDb: number;
  role: MasterRole;
  profile: MasterProfile;
  targetLufs: number;
  /** Alvo não alcançado de propósito: chegar lá esmagaria a música */
  targetCapped: boolean;
  /** Arquivo LR: cada lado foi tratado separado */
  lr: boolean;
  /** Distância (dB RMS) do equilíbrio tonal até a referência, antes e depois (só mix) */
  tonalDistanceBefore: number;
  tonalDistanceAfter: number;
  eq: EqBand[];
  monoBassHz: number | null;
  widthDb: number;
  notes: string[];
}

// ---------------------------------------------------------------- análise

export interface MasterAnalysis {
  sampleRate: number;
  channels: number;
  lufs: number;
  truePeak: number;
  /** Curva tonal relativa (terços de oitava) */
  tonal: number[];
  /** Potência por terço de cada quadro com som, já em média quadrática por canal */
  frameBands: Float64Array[];
  /** Potência média do meio e do lado por terço (dB, escala da FFT) */
  midDb: number[];
  sideDb: number[];
  sideToMidDb: number;
  lowSideToMidDb: number;
  correlation: number;
  /** Energia abaixo de 150 Hz de cada lado (dB) */
  lowLeftDb: number;
  lowRightDb: number;
}

function lowEnergyDb(x: Float32Array, sampleRate: number): number {
  const f = new FilterChain(lr4('lowpass', 150, sampleRate));
  const tmp = new Float32Array(4096);
  let s = 0;
  for (let i = 0; i < x.length; i += tmp.length) {
    const len = Math.min(tmp.length, x.length - i);
    tmp.set(x.subarray(i, i + len));
    f.run(tmp, 0, len);
    for (let k = 0; k < len; k++) s += tmp[k] * tmp[k];
  }
  return s > 0 ? 10 * Math.log10(s / Math.max(1, x.length)) : -200;
}

export function analyzeForMaster(ch: Float32Array[], sampleRate: number): MasterAnalysis {
  const spec = longTermSpectrum(ch, sampleRate, { keepFrames: true });
  let allMid = 0, allSide = 0, lowMid = 0, lowSide = 0;
  spec.centers.forEach((fc, i) => {
    const m = Math.pow(10, spec.midDb[i] / 10), s = Math.pow(10, spec.sideDb[i] / 10);
    allMid += m; allSide += s;
    if (fc <= 140) { lowMid += m; lowSide += s; }
  });
  const ratio = (s: number, m: number) => (m > 0 && s > 0 ? 10 * Math.log10(s / m) : -200);
  let sLL = 0, sRR = 0, sLR = 0;
  const L = ch[0], R = ch[1] ?? ch[0];
  for (let i = 0; i < L.length; i++) { sLL += L[i] * L[i]; sRR += R[i] * R[i]; sLR += L[i] * R[i]; }
  return {
    sampleRate,
    channels: ch.length,
    lufs: loudnessLean(ch, sampleRate),
    truePeak: truePeak(ch),
    tonal: spec.frames ? normalizeCurve(totalBandDb(spec)) : THIRD_OCTAVES.map(() => 0),
    frameBands: (spec.frameBands ?? []).map((f) => f.map((p) => p * spec.msScale)),
    midDb: spec.midDb,
    sideDb: spec.sideDb,
    sideToMidDb: ch.length > 1 ? ratio(allSide, allMid) : -200,
    lowSideToMidDb: ch.length > 1 ? ratio(lowSide, lowMid) : -200,
    correlation: sLL > 0 && sRR > 0 ? sLR / Math.sqrt(sLL * sRR) : 1,
    lowLeftDb: lowEnergyDb(L, sampleRate),
    lowRightDb: lowEnergyDb(R, sampleRate),
  };
}

/** Arquivo LR (guia/click num lado, música no outro): lados sem relação e grave só de um lado. */
export function isLrFile(a: MasterAnalysis): boolean {
  return a.channels === 2 && a.correlation < 0.3 && Math.abs(a.lowLeftDb - a.lowRightDb) > 9;
}

// ---------------------------------------------------------------- decisões (a "IA")

/** Curva tonal estimada depois de centralizar o grave e mexer na largura (meio + lado filtrado). */
export function tonalAfterStereo(a: MasterAnalysis, monoBassHz: number | null, widthDb: number): number[] {
  const side = [
    ...(monoBassHz ? lr4('highpass', monoBassHz, a.sampleRate) : []),
    ...(widthDb ? [designBiquad('highshelf', 300, a.sampleRate, 0.7, widthDb)] : []),
  ];
  const total = THIRD_OCTAVES.map((f, i) => {
    const sideGainDb = side.reduce((s, b) => s + biquadDb(b, f, a.sampleRate), 0);
    return 10 * Math.log10(Math.pow(10, a.midDb[i] / 10) + Math.pow(10, (a.sideDb[i] + sideGainDb) / 10));
  });
  return normalizeCurve(total);
}

/**
 * Diferença de nível entre a curva e a referência: mediana das bandas de 60 Hz a 8 kHz que a
 * gravação tem. A curva relativa é centrada na média de 100 Hz a 8 kHz; se faltarem agudos (ou
 * graves), essa média escorrega e tudo pareceria fora. A mediana não se deixa levar.
 */
function tonalOffset(curve: number[], original: number[]): number {
  const d: number[] = [];
  for (let i = 0; i < THIRD_OCTAVES.length; i++) {
    const f = THIRD_OCTAVES[i];
    if (f < 60 || f > 8000 || original[i] < REFERENCE_TONAL[i] - 15) continue;
    d.push(curve[i] - REFERENCE_TONAL[i]);
  }
  if (!d.length) return 0;
  d.sort((a, b) => a - b);
  return d.length % 2 ? d[(d.length - 1) / 2] : (d[d.length / 2 - 1] + d[d.length / 2]) / 2;
}

/**
 * Distância (dB RMS) de uma curva até a referência, de 40 Hz a 12,5 kHz, sem as bandas que a
 * gravação original não tem (15 dB ou mais abaixo da referência): essas o EQ não deve inventar.
 */
export function tonalDistance(curve: number[], original: number[] = curve): number {
  let s = 0, c = 0;
  const offset = tonalOffset(curve, original);
  for (let i = 0; i < THIRD_OCTAVES.length; i++) {
    const f = THIRD_OCTAVES[i];
    if (f < 40 || f > 12500 || original[i] < REFERENCE_TONAL[i] - 15) continue;
    const d = curve[i] - offset - REFERENCE_TONAL[i];
    s += d * d; c++;
  }
  return c ? Math.sqrt(s / c) : 0;
}

const bandIndex = (hz: number) => Math.round(17 + 3 * Math.log2(hz / 1000));

/**
 * Correção tonal desejada (dB por terço de oitava) para chegar perto da referência. `original`
 * é a curva da gravação antes do estéreo: banda que ela não tem (15 dB abaixo da referência ou
 * mais) não recebe reforço, senão só subiria ruído.
 */
export function tonalCorrection(tonal: number[], strength: number, tolerance = 0.5, original: number[] = tonal): number[] {
  const n = THIRD_OCTAVES.length;
  const raw = new Array<number>(n).fill(0);
  const offset = tonalOffset(tonal, original);
  for (let i = 0; i < n; i++) {
    const f = THIRD_OCTAVES[i];
    if (f < 30 || f > 13000) continue;
    const diff = REFERENCE_TONAL[i] - (tonal[i] - offset);
    const tol = Math.max(0.75, REF_SPREAD[i] * tolerance);
    let c = Math.abs(diff) <= tol ? 0 : diff - Math.sign(diff) * tol;
    if (original[i] < REFERENCE_TONAL[i] - 15) c = Math.min(c, 0.5);
    raw[i] = c * strength;
  }
  // EQ de masterização é largo: suaviza com o terço vizinho de cada lado
  const out = raw.map((v, i) => ((raw[i - 1] ?? v) + 2 * v + (raw[i + 1] ?? v)) / 4);
  return out.map((c, i) => {
    const f = THIRD_OCTAVES[i];
    const maxBoost = f < 45 ? 2.5 : f > 8000 ? 3 : 3.5;
    return Math.max(-4.5, Math.min(maxBoost, c));
  });
}

const EQ_BANK: Array<{ kind: FilterKind; freq: number; q: number }> = [
  { kind: 'peaking', freq: 55, q: 1.0 },
  { kind: 'peaking', freq: 110, q: 1.1 },
  { kind: 'peaking', freq: 220, q: 1.1 },
  { kind: 'peaking', freq: 440, q: 1.1 },
  { kind: 'peaking', freq: 880, q: 1.1 },
  { kind: 'peaking', freq: 1760, q: 1.1 },
  { kind: 'peaking', freq: 3500, q: 1.1 },
  { kind: 'peaking', freq: 7000, q: 1.1 },
  { kind: 'highshelf', freq: 11000, q: 0.7 },
];

function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c] || 1e-12;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const k = M[r][c] / d;
      for (let j = c; j <= n; j++) M[r][j] -= k * M[c][j];
    }
  }
  return M.map((row, i) => row[n] / (row[i] || 1e-12));
}

/** Transforma a correção desejada num EQ de poucos filtros largos (mínimos quadrados). */
export function fitEq(correction: number[], sampleRate: number): EqBand[] {
  const idx = THIRD_OCTAVES.map((f, i) => i).filter((i) => THIRD_OCTAVES[i] >= 30 && THIRD_OCTAVES[i] <= 14000 && THIRD_OCTAVES[i] < sampleRate * 0.45);
  if (correction.every((c) => Math.abs(c) < 0.3)) return [];
  const resp = (gains: number[], i: number) => EQ_BANK.reduce((s, b, k) => s + (gains[k] === 0 ? 0 : biquadDb(designBiquad(b.kind, b.freq, sampleRate, b.q, gains[k]), THIRD_OCTAVES[i], sampleRate)), 0);
  // base linear: resposta de cada filtro com 1 dB
  const basis = EQ_BANK.map((b) => idx.map((i) => biquadDb(designBiquad(b.kind, b.freq, sampleRate, b.q, 1), THIRD_OCTAVES[i], sampleRate)));
  const K = EQ_BANK.length;
  // regularização: prefere poucos filtros suaves a sinos vizinhos brigando entre si
  const lambda = 0.4;
  const AtA = Array.from({ length: K }, (_, a) => Array.from({ length: K }, (_, b) => basis[a].reduce((s, v, t) => s + v * basis[b][t], 0) + (a === b ? lambda : 0)));
  let g = new Array<number>(K).fill(0);
  for (let it = 0; it < 4; it++) {
    const res = idx.map((i) => correction[i] - resp(g, i));
    const Atr = basis.map((row) => row.reduce((s, v, t) => s + v * res[t], 0));
    const dg = solve(AtA, Atr);
    g = g.map((v, k) => Math.max(-4.5, Math.min(4.5, v + dg[k])));
  }
  return EQ_BANK.map((b, k) => ({ ...b, gainDb: Math.round(g[k] * 10) / 10 })).filter((b) => Math.abs(b.gainDb) >= 0.2);
}

const percentile = (v: number[], p: number) => {
  if (!v.length) return -120;
  const s = [...v].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round((p / 100) * (s.length - 1))))];
};

/** Níveis (dB, média quadrática) de cada quadro numa faixa de frequência, depois de um EQ. */
function bandLevels(a: MasterAnalysis, loHz: number, hiHz: number, eqDb: number[]): number[] {
  const sel = THIRD_OCTAVES.map((f, i) => i).filter((i) => THIRD_OCTAVES[i] >= loHz && THIRD_OCTAVES[i] < hiHz);
  const w = sel.map((i) => Math.pow(10, eqDb[i] / 10));
  return a.frameBands.map((f) => {
    let p = 0;
    sel.forEach((i, k) => { p += f[i] * w[k]; });
    return p > 0 ? 10 * Math.log10(p) : -120;
  });
}

const fmt = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1).replace('.', ',')}`;
const freqName = (hz: number) => (hz >= 1000 ? `${(hz / 1000).toFixed(hz >= 10000 ? 0 : 1).replace('.', ',')} kHz` : `${Math.round(hz)} Hz`);

const INSTRUMENT_HP: Record<InstrumentKind, number> = { bateria: 28, baixo: 28, guitarra: 70, violao: 60, teclado: 30, sanfona: 50, percussao: 40, outro: 30 };

/** Decide a cadeia inteira a partir da análise. */
export function planMaster(a: MasterAnalysis, options: MasterOptions = {}): MasterPlan {
  const role: MasterRole = options.role ?? (options.vocal ? 'voice' : 'mix');
  const profile: MasterProfile = options.profile ?? 'equilibrado';
  const prof = MASTER_PROFILES[profile];
  const notes: string[] = [];
  const stereo = a.channels > 1;
  const plr = gainToDb(a.truePeak) - a.lufs;
  const alreadyMastered = role === 'mix' && a.lufs > MASTER_TUNING.masteredLufs && plr < MASTER_TUNING.masteredPlr;

  let highpassHz = 22;
  let correction = THIRD_OCTAVES.map(() => 0);
  let eq: EqBand[] = [];
  let monoBassHz: number | null = null;
  let widthDb = 0;
  let multiband: MasterPlan['multiband'] = null;
  let wideband: BandSettings | null = null;
  let targetLufs = a.lufs;
  let maxLossDb = 1;

  if (role === 'mix') {
    const T = MASTER_TUNING;
    if (stereo) {
      // grave fora do centro some no PA em mono e embola: centraliza (na master pronta, só se for grave)
      if (a.lowSideToMidDb > (alreadyMastered ? -6 : -20)) monoBassHz = 110;
      if (!alreadyMastered) {
        if (a.correlation < 0.35 || a.sideToMidDb > -5.5) widthDb = -1.5;
        else if (a.sideToMidDb < -15) widthDb = 1.5;
        else if (a.sideToMidDb < -12.5) widthDb = 0.8;
      }
    }
    // o EQ olha a música como ela fica depois do estéreo: o grave que sai das laterais conta
    const tonal = stereo ? tonalAfterStereo(a, monoBassHz, widthDb) : a.tonal;
    if (alreadyMastered) {
      // master pronta: nada de filtro que gire a fase (recriaria os picos que o limitador dela
      // já aparou); EQ só se o timbre estiver bem fora e com metade da força
      highpassHz = 0;
      if (tonalDistance(tonal, a.tonal) > 3) correction = tonalCorrection(tonal, T.eqStrength * 0.5, T.eqTolerance, a.tonal);
    } else {
      // subgrave excessivo (abaixo de 25 Hz) sobe o corte: só come headroom do limitador
      if (a.tonal[bandIndex(20)] > REFERENCE_TONAL[bandIndex(20)] + 6) highpassHz = 30;
      correction = tonalCorrection(tonal, T.eqStrength, T.eqTolerance, a.tonal);
    }
    eq = fitEq(correction, a.sampleRate);
    // compressão em 3 bandas com limiar tirado da própria música (depois do EQ)
    const eqDb = THIRD_OCTAVES.map((f) => eq.reduce((s, b) => s + biquadDb(designBiquad(b.kind, b.freq, a.sampleRate, b.q, b.gainDb), f, a.sampleRate), 0));
    const xo: [number, number] = [140, 4500];
    const edges: Array<[number, number]> = [[0, xo[0]], [xo[0], xo[1]], [xo[1], 30000]];
    const offset = -(prof.intensity - 1) * 5; // equilibrado 0, show −2 dB, streaming +1,5 dB
    if (!alreadyMastered && a.frameBands.length >= 8) {
      multiband = {
        crossovers: xo,
        bands: edges.map(([lo, hi], k) => {
          const lv = bandLevels(a, lo, hi, eqDb);
          const spread = percentile(lv, 95) - percentile(lv, 50);
          // banda já sem dinâmica: quase não mexe
          const base = T.mbBands[k];
          const ratio = spread < 4 ? 1 + (base.ratio - 1) * 0.35 : base.ratio;
          return { ...base, ratio, thresholdDb: percentile(lv, T.mbPercentile) + offset };
        }),
      };
    }
    targetLufs = prof.exact ? prof.lufs : Math.max(prof.lufs, a.lufs);
    // master pronta: o limitador só pode tirar o que o pico acima do teto obriga (mais um pouco)
    maxLossDb = alreadyMastered ? Math.min(prof.maxLossDb, Math.max(0.5, gainToDb(a.truePeak) - (MASTER_CEILING_DBTP - 0.15) + 0.3)) : prof.maxLossDb;
    if (alreadyMastered) notes.push('a música já veio masterizada: ajuste leve, sem achatar');
  } else if (role === 'voice') {
    highpassHz = 75;
    // polimento: tira embolado (200–400 Hz) e dá presença/ar, só quando faltam
    const avg = (lo: number, hi: number) => {
      const v = THIRD_OCTAVES.map((f, i) => [f, a.tonal[i]] as const).filter(([f]) => f >= lo && f <= hi).map(([, t]) => t);
      return v.reduce((s, t) => s + t, 0) / Math.max(1, v.length);
    };
    const body = avg(1000, 3000);
    const mud = avg(200, 400) - body;
    const presence = avg(2500, 5000) - avg(500, 1000);
    const air = avg(8000, 12000) - body;
    if (mud > 9) eq.push({ kind: 'peaking', freq: 300, q: 1.0, gainDb: -Math.min(3, (mud - 9) * 0.5) });
    if (presence < -8) eq.push({ kind: 'peaking', freq: 3500, q: 1.0, gainDb: Math.min(2.5, (-8 - presence) * 0.4) });
    if (air < -12) eq.push({ kind: 'highshelf', freq: 10000, q: 0.7, gainDb: Math.min(2, (-12 - air) * 0.3) });
    eq = eq.map((b) => ({ ...b, gainDb: Math.round(b.gainDb * 10) / 10 })).filter((b) => Math.abs(b.gainDb) >= 0.2);
    const eqDb = THIRD_OCTAVES.map((f) => eq.reduce((s, b) => s + biquadDb(designBiquad(b.kind, b.freq, a.sampleRate, b.q, b.gainDb), f, a.sampleRate), 0));
    if (a.frameBands.length >= 8) {
      const all = bandLevels(a, 60, 30000, eqDb);
      // dois estágios, como em estúdio: nivelador lento (as frases fortes descem, as fracas
      // ficam) e compressor rápido só nas sílabas mais fortes
      wideband = { thresholdDb: percentile(all, 55), ratio: 2, kneeDb: 10, attackMs: 40, releaseMs: 400, maxGrDb: 8 };
      const body = bandLevels(a, 120, 6000, eqDb);
      // de-esser: só os 10% mais fortes acima de 6 kHz (os "s" e "ch")
      const hi = bandLevels(a, 6000, 30000, eqDb);
      multiband = {
        crossovers: [120, 6000],
        bands: [
          { thresholdDb: 0, ratio: 1, kneeDb: 1, attackMs: 10, releaseMs: 100, maxGrDb: 0 },
          { thresholdDb: percentile(body, 85), ratio: 3, kneeDb: 6, attackMs: 5, releaseMs: 80, maxGrDb: 6 },
          { thresholdDb: percentile(hi, 90), ratio: 4, kneeDb: 4, attackMs: 1, releaseMs: 50, maxGrDb: 8 },
        ],
      };
    }
    if (stereo && a.lowSideToMidDb > -20) monoBassHz = 150;
    targetLufs = a.lufs;
    maxLossDb = 1.5;
  } else if (options.passive) {
    highpassHz = 20;
    targetLufs = a.lufs;
    maxLossDb = 1.5;
  } else {
    const kind = options.instrument ?? 'outro';
    highpassHz = INSTRUMENT_HP[kind];
    if (stereo && a.lowSideToMidDb > -20) monoBassHz = kind === 'baixo' ? 150 : 100;
    const all = bandLevels(a, 20, 30000, THIRD_OCTAVES.map(() => 0));
    if (a.frameBands.length >= 8 && kind !== 'bateria' && kind !== 'percussao') {
      const s: Record<string, Omit<BandSettings, 'thresholdDb'> & { pct: number }> = {
        baixo: { ratio: 3, kneeDb: 6, attackMs: 15, releaseMs: 150, maxGrDb: 6, pct: 70 },
        guitarra: { ratio: 2, kneeDb: 6, attackMs: 15, releaseMs: 160, maxGrDb: 5, pct: 80 },
        violao: { ratio: 2, kneeDb: 6, attackMs: 15, releaseMs: 160, maxGrDb: 5, pct: 80 },
      };
      const p = s[kind] ?? { ratio: 1.7, kneeDb: 6, attackMs: 20, releaseMs: 200, maxGrDb: 4, pct: 80 };
      const { pct, ...rest } = p;
      wideband = { ...rest, thresholdDb: percentile(all, pct) };
    }
    targetLufs = a.lufs;
    maxLossDb = 1.5;
  }

  // voz/stem masterizados com perfil de volume (pedido do usuário)
  if (role !== 'mix' && !options.passive && options.forceProfile) {
    targetLufs = prof.exact ? prof.lufs : Math.max(prof.lufs, a.lufs);
    maxLossDb = prof.maxLossDb;
  }

  // notas para o usuário
  const big = eq.filter((b) => Math.abs(b.gainDb) >= 0.8).sort((x, y) => Math.abs(y.gainDb) - Math.abs(x.gainDb)).slice(0, 3);
  if (big.length) notes.push(`EQ: ${big.map((b) => `${fmt(b.gainDb)} dB em ${freqName(b.freq)}`).join(', ')}`);
  if (monoBassHz) notes.push(`grave centralizado abaixo de ${monoBassHz} Hz`);
  if (widthDb > 0) notes.push('estéreo um pouco mais aberto');
  if (widthDb < 0) notes.push('estéreo um pouco mais fechado (estava aberto demais)');

  return { role, profile, instrument: options.instrument, targetLufs, maxLossDb, highpassHz, eq, correction, monoBassHz, widthDb, multiband, wideband, alreadyMastered, notes };
}

// ---------------------------------------------------------------- renderização

function applyFilters(ch: Float32Array[], filters: () => FilterChain): void {
  for (const x of ch) filters().run(x);
}

function applyStereo(ch: Float32Array[], sampleRate: number, monoBassHz: number | null, widthDb: number): void {
  if (ch.length < 2 || (!monoBassHz && !widthDb)) return;
  const fs: ReturnType<typeof designBiquad>[] = [];
  if (monoBassHz) fs.push(...lr4('highpass', monoBassHz, sampleRate));
  if (widthDb) fs.push(designBiquad('highshelf', 300, sampleRate, 0.7, widthDb));
  const side = new FilterChain(fs);
  const [L, R] = ch;
  const tmp = new Float32Array(4096);
  for (let s = 0; s < L.length; s += tmp.length) {
    const len = Math.min(tmp.length, L.length - s);
    for (let i = 0; i < len; i++) tmp[i] = (L[s + i] - R[s + i]) / 2;
    side.run(tmp, 0, len);
    for (let i = 0; i < len; i++) {
      const m = (L[s + i] + R[s + i]) / 2;
      L[s + i] = m + tmp[i];
      R[s + i] = m - tmp[i];
    }
  }
}

interface LimitResult { lufs: number; limiterDb: number; capped: boolean; staticOnly: boolean }

/** Ganho + limitador de true peak, calibrados para o loudness alvo sem passar do limite de perda. */
function loudnessAndLimit(ch: Float32Array[], sampleRate: number, targetLufs: number, maxLossDb: number, ceilingDbtp: number, limiterMinGainDb = 1): LimitResult {
  const ceil = dbToGain(ceilingDbtp - 0.15); // margem para o pico entre amostras depois do ganho
  const kpow = kPowerBlocks(ch, sampleRate);
  const pre = loudnessFromBlocks(kpow, sampleRate);
  if (!Number.isFinite(pre)) return { lufs: pre, limiterDb: 0, capped: false, staticOnly: true };
  const maxBoost = Math.min(24, targetLufs - pre + maxLossDb + 6);
  const peaks = truePeakBlocks(ch, LIMIT_BLOCK, ceil / dbToGain(Math.max(0, maxBoost)) / 2);
  const evalAt = (gDb: number) => {
    const G = dbToGain(gDb);
    const g = limiterGains(peaks, sampleRate, G, ceil, MASTER_TUNING.limiter);
    const out = loudnessFromBlocks(kpow, sampleRate, (j) => { const v = ((g[j] + g[j + 1]) / 2) * G; return v * v; });
    return { g, out, loss: pre + gDb - out };
  };
  const ok = (r: { out: number; loss: number }) => r.out <= targetLufs + 0.05 && r.loss <= maxLossDb;
  // o maior ganho que não passa do alvo nem do limite de perda (os dois crescem com o ganho)
  let lo = Math.min(targetLufs - pre, maxBoost);
  let rlo = evalAt(lo);
  for (let k = 0; k < 12 && !ok(rlo); k++) { lo -= 2; rlo = evalAt(lo); }
  let hi = Math.min(maxBoost, lo + maxLossDb + 3);
  const rhi = evalAt(hi);
  if (ok(rhi)) { lo = hi; rlo = rhi; }
  else {
    for (let k = 0; k < 14; k++) {
      const mid = (lo + hi) / 2;
      const r = evalAt(mid);
      if (ok(r)) { lo = mid; rlo = r; } else hi = mid;
    }
  }
  // só ganho, sem limitador: o pico mais alto vai ao teto. Se o limitador não render pelo menos
  // `limiterMinGainDb` a mais que isso, não vale achatar a música (caso típico: master pronta)
  let maxPeak = 0;
  for (const p of peaks) if (p > maxPeak) maxPeak = p;
  const staticDb = Math.min(targetLufs - pre, maxPeak > 0 ? gainToDb(ceil / maxPeak) : 0);
  let staticOnly = false;
  if (pre + staticDb >= rlo.out - limiterMinGainDb) {
    staticOnly = true;
    lo = staticDb;
    rlo = { g: new Float32Array(peaks.length + 1).fill(1), out: pre + staticDb, loss: 0 };
  }
  const capped = rlo.out < targetLufs - 0.3;
  applyBlockGains(ch, rlo.g, dbToGain(lo));
  let worst = 1;
  for (const v of rlo.g) if (v < worst) worst = v;
  // conferência exata do pico real; o que passar (raro) leva mais uma passada só nesses picos
  const finalCeil = dbToGain(ceilingDbtp);
  for (let k = 0; k < 4; k++) {
    const tp = truePeakPrecise(ch, finalCeil * 0.7);
    if (tp <= finalCeil) break;
    const pk = truePeakBlocksPrecise(ch, LIMIT_BLOCK, finalCeil * 0.7);
    const g2 = limiterGains(pk, sampleRate, 1, finalCeil * dbToGain(-0.05 * (k + 1)));
    applyBlockGains(ch, g2, 1);
    for (const v of g2) if (v < worst) worst = Math.min(worst, v);
  }
  return { lufs: loudnessLean(ch, sampleRate), limiterDb: gainToDb(worst), capped, staticOnly };
}

export function renderMaster(ch: Float32Array[], sampleRate: number, plan: MasterPlan): { lufs: number; compressionDb: number; compressionAvgDb: number; limiterDb: number; capped: boolean; staticOnly: boolean } {
  const pre = [
    ...(plan.highpassHz > 0 ? lr4('highpass', plan.highpassHz, sampleRate) : []),
    ...plan.eq.map((b) => designBiquad(b.kind, b.freq, sampleRate, b.q, b.gainDb)),
  ];
  if (pre.length) applyFilters(ch, () => new FilterChain(pre));
  applyStereo(ch, sampleRate, plan.monoBassHz, plan.widthDb);
  let grMax = 0, grSum = 0, grCount = 0;
  const collect = (c: { grMax: number; grSum: number; grCount: number }) => { grMax = Math.max(grMax, c.grMax); grSum += c.grSum; grCount += c.grCount; };
  if (plan.wideband) collect(widebandCompress(ch, sampleRate, plan.wideband));
  if (plan.multiband) {
    const mb = multibandCompress(ch, sampleRate, plan.multiband.crossovers, plan.multiband.bands);
    mb.comps.forEach(collect);
    // compensação por banda (o "makeup" de cada banda): a compressão não muda o timbre médio;
    // o nível geral fica com o estágio de loudness
    const [lowLoss, midLoss, highLoss] = mb.lossDb;
    const [f1, f2] = plan.multiband.crossovers;
    const post = [
      ...(Math.abs(lowLoss - midLoss) >= 0.1 ? [designBiquad('lowshelf', f1, sampleRate, 0.6, lowLoss - midLoss)] : []),
      ...(Math.abs(highLoss - midLoss) >= 0.1 ? [designBiquad('highshelf', f2, sampleRate, 0.6, highLoss - midLoss)] : []),
    ];
    if (post.length) applyFilters(ch, () => new FilterChain(post));
  }
  // master pronta: o limitador precisa render 1,5 dB a mais que o ganho simples para valer
  // stem: o volume dele é o equilíbrio do VS, então o limitador sempre vale (não há ganho fixo)
  const minGain = plan.role !== 'mix' ? -Infinity : plan.alreadyMastered ? 1.5 : 1;
  const lim = loudnessAndLimit(ch, sampleRate, plan.targetLufs, plan.maxLossDb, MASTER_CEILING_DBTP, minGain);
  return { lufs: lim.lufs, compressionDb: -grMax, compressionAvgDb: grCount ? grSum / grCount : 0, limiterDb: lim.limiterDb, capped: lim.capped, staticOnly: lim.staticOnly };
}

// ---------------------------------------------------------------- entrada principal

function emptyReport(lufs: number, peakDb: number, role: MasterRole, profile: MasterProfile): MasterReport {
  return {
    lufsBefore: lufs, lufsAfter: lufs, peakBeforeDbtp: peakDb, peakAfterDbtp: peakDb, compressionDb: 0, compressionAvgDb: 0, limiterDb: 0,
    role, profile, targetLufs: lufs, targetCapped: false, lr: false, tonalDistanceBefore: 0, tonalDistanceAfter: 0, eq: [], monoBassHz: null, widthDb: 0, notes: [],
  };
}

export function masterChannels(input: Float32Array[], sampleRate: number, options: MasterOptions = {}): { channels: Float32Array[]; report: MasterReport } {
  const role: MasterRole = options.role ?? (options.vocal ? 'voice' : 'mix');
  const profile: MasterProfile = options.profile ?? 'equilibrado';
  const ch = options.inPlace ? input : input.map((c) => Float32Array.from(c));
  if (ch.length === 0 || ch[0].length === 0) return { channels: ch, report: emptyReport(-Infinity, -Infinity, role, profile) };
  const analysis = analyzeForMaster(ch, sampleRate);
  const lufsBefore = analysis.lufs;
  const peakBefore = gainToDb(analysis.truePeak);
  if (!Number.isFinite(lufsBefore)) return { channels: ch, report: emptyReport(lufsBefore, peakBefore, role, profile) };
  if (role === 'mix' && isLrFile(analysis)) {
    // LR: o lado com grave é a música (masteriza); o outro é guia/click (só segura o pico)
    const musicIdx = analysis.lowLeftDb >= analysis.lowRightDb ? 0 : 1;
    const music = masterChannels([ch[musicIdx]], sampleRate, { role: 'mix', profile, inPlace: true });
    const guide = masterChannels([ch[1 - musicIdx]], sampleRate, { role: 'instrument', passive: true, inPlace: true });
    const r = music.report;
    return {
      channels: ch,
      report: {
        ...r,
        lufsBefore,
        lufsAfter: loudnessLean(ch, sampleRate),
        peakBeforeDbtp: peakBefore,
        peakAfterDbtp: gainToDb(truePeakPrecise(ch, dbToGain(MASTER_CEILING_DBTP) * 0.7)),
        limiterDb: Math.min(r.limiterDb, guide.report.limiterDb),
        lr: true,
        notes: [`arquivo LR: masterizei a música (lado ${musicIdx === 0 ? 'esquerdo' : 'direito'}) e só segurei o pico da guia/click`, ...r.notes],
      },
    };
  }

  const plan = planMaster(analysis, { ...options, role, profile });
  const res = renderMaster(ch, sampleRate, plan);
  const after = role === 'mix' ? normalizeCurve(totalBandDb(longTermSpectrum(ch, sampleRate))) : null;
  const notes = [...plan.notes];
  if (res.capped && res.staticOnly && res.lufs < lufsBefore - 0.3) notes.push(`volume ${fmt(res.lufs - lufsBefore)} dB para o pico real ficar abaixo de ${MASTER_CEILING_DBTP} dBTP${peakBefore > MASTER_CEILING_DBTP ? ' (a original passava do teto)' : ''}`);
  else if (res.capped && options.forceProfile) notes.push(`parei em ${fmt(res.lufs)} LUFS: mais alto que isso esmagaria o áudio`);
  else if (res.capped && role !== 'mix' && res.lufs < lufsBefore - 0.3) notes.push(`volume ${fmt(res.lufs - lufsBefore)} dB: segurar o pico sem esmagar pediu isso`);
  else if (res.capped && role === 'mix') notes.push(`parei em ${fmt(res.lufs)} LUFS: mais alto que isso esmagaria a música`);
  return {
    channels: ch,
    report: {
      lufsBefore,
      lufsAfter: res.lufs,
      peakBeforeDbtp: peakBefore,
      peakAfterDbtp: gainToDb(truePeakPrecise(ch, dbToGain(MASTER_CEILING_DBTP) * 0.7)),
      compressionDb: res.compressionDb,
      compressionAvgDb: res.compressionAvgDb,
      limiterDb: res.limiterDb,
      role,
      profile,
      targetLufs: plan.targetLufs,
      targetCapped: res.capped,
      lr: false,
      tonalDistanceBefore: role === 'mix' ? tonalDistance(analysis.tonal) : 0,
      tonalDistanceAfter: after ? tonalDistance(after, analysis.tonal) : 0,
      eq: plan.eq,
      monoBassHz: plan.monoBassHz,
      widthDb: plan.widthDb,
      notes,
    },
  };
}
