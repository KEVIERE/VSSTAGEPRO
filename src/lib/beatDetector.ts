import { guess } from 'web-audio-beat-detector';
import type { ClipAudio } from '@/lib/audioLibrary';

const MIN_BPM = 70;
const MAX_BPM = 180;
const MAX_ANALYSIS_SECONDS = 90;
const MAX_CLICK_SECONDS = 240;
const MIN_RUN = 12;

export interface TempoResult {
  bpm: number;
  /** Segundos até o primeiro tempo forte (início do compasso 1) */
  downbeat: number;
  fromClick: boolean;
}

function foldIntoRange(bpm: number): number {
  let b = bpm;
  while (b < MIN_BPM) b *= 2;
  while (b > MAX_BPM) b /= 2;
  return b;
}

function tidyBpm(bpm: number): number {
  const r = Math.round(bpm);
  return Math.abs(bpm - r) < 0.08 ? r : Math.round(bpm * 100) / 100;
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);
}

type Onsets = { times: number[]; peaks: number[] };

function envelope(audio: ClipAudio): { env: Float32Array; hop: number; len: number; max: number } {
  const sr = audio.sampleRate;
  const len = Math.min(audio.length, Math.floor(MAX_CLICK_SECONDS * sr));
  const hop = Math.max(1, Math.floor(sr / 400));
  const frames = Math.floor(len / hop);
  const env = new Float32Array(frames);
  let max = 0;
  for (let f = 0; f < frames; f++) {
    let m = 0;
    const base = f * hop;
    for (let i = 0; i < hop; i++) {
      for (const ch of audio.channels) {
        const v = Math.abs(ch[base + i]);
        if (v > m) m = v;
      }
    }
    env[f] = m;
    if (m > max) max = m;
  }
  return { env, hop, len, max };
}

// Ataques do click com precisão de amostra: subidas rápidas acima do limiar.
function onsetsAt(audio: ClipAudio, env: Float32Array, hop: number, len: number, threshold: number): Onsets {
  const sr = audio.sampleRate;
  const chs = audio.channels;
  const refractory = Math.floor(0.1 * sr / hop);
  const times: number[] = [];
  const peaks: number[] = [];
  let last = -refractory;
  for (let f = 1; f < env.length; f++) {
    if (f - last < refractory) continue;
    if (env[f] < threshold || env[f - 1] >= threshold * 0.6) continue;
    const base = (f - 1) * hop;
    let exact = base;
    for (let i = 0; i < hop * 2 && base + i < len; i++) {
      const s = base + i;
      if (chs.some((ch) => Math.abs(ch[s]) >= threshold)) { exact = s; break; }
    }
    let peak = 0;
    for (let k = f; k < Math.min(env.length, f + 8); k++) peak = Math.max(peak, env[k]);
    times.push(exact / sr);
    peaks.push(peak);
    last = f;
  }
  return { times, peaks };
}

// Período mais frequente entre ataques; ignora contagem, pausas e viradas isoladas.
function modePeriod(times: number[]): number | null {
  const iois: number[] = [];
  for (let i = 1; i < times.length; i++) {
    const d = times[i] - times[i - 1];
    if (d > 0.15 && d < 1.6) iois.push(d);
  }
  if (iois.length < MIN_RUN) return null;
  const BIN = 0.004;
  const hist = new Map<number, number>();
  for (const d of iois) {
    const b = Math.round(d / BIN);
    hist.set(b, (hist.get(b) ?? 0) + 1);
    hist.set(b - 1, (hist.get(b - 1) ?? 0) + 0.5);
    hist.set(b + 1, (hist.get(b + 1) ?? 0) + 0.5);
  }
  let best = 0;
  let bestCount = -1;
  for (const [b, c] of hist) if (c > bestCount) { best = b; bestCount = c; }
  const center = best * BIN;
  const near = iois.filter((d) => Math.abs(d - center) < center * 0.04);
  return near.length >= 8 ? mean(near) : null;
}

// Maior trecho em que cada ataque cai na grade (aceita batidas faltando no meio).
function longestRun(times: number[], period: number): number[] {
  let best: number[] = [];
  let cur: number[] = [0];
  for (let i = 1; i < times.length; i++) {
    const d = times[i] - times[cur[cur.length - 1]];
    const m = Math.round(d / period);
    if (m >= 1 && m <= 4 && Math.abs(d - m * period) < period * 0.08) {
      cur.push(i);
    } else {
      if (cur.length > best.length) best = cur;
      cur = [i];
    }
  }
  return cur.length > best.length ? cur : best;
}

// Mínimos quadrados: cada ataque cai num índice inteiro da grade t0 + k*período.
function fitGrid(times: number[], period: number): { period: number; t0: number; idx: number[] } | null {
  const origin = times[0];
  const idx = times.map((t) => Math.round((t - origin) / period));
  const n = times.length;
  let sk = 0, st = 0, skk = 0, skt = 0;
  for (let i = 0; i < n; i++) { sk += idx[i]; st += times[i]; skk += idx[i] * idx[i]; skt += idx[i] * times[i]; }
  const den = n * skk - sk * sk;
  if (den === 0) return null;
  const p = (n * skt - sk * st) / den;
  return { period: p, t0: (st - p * sk) / n, idx };
}

// Click em colcheias: as batidas pares são todas mais fortes (não só a cabeça do compasso).
function subdivisionParity(idx: number[], peaks: number[]): number | null {
  const avgWhere = (pred: (k: number) => boolean) => {
    const v = peaks.filter((_, i) => pred(idx[i]));
    return v.length >= 4 ? mean(v) : null;
  };
  for (const parity of [0, 1]) {
    const loud = avgWhere((k) => ((k % 2) + 2) % 2 === parity);
    const soft = avgWhere((k) => ((k % 2) + 2) % 2 !== parity);
    const a = avgWhere((k) => ((k % 4) + 4) % 4 === parity);
    const b = avgWhere((k) => ((k % 4) + 4) % 4 === parity + 2);
    if (loud && soft && a && b && loud > soft * 1.25 && Math.max(a, b) / Math.min(a, b) < 1.15) return parity;
  }
  return null;
}

// Click com acento: o tempo forte costuma ser mais alto que os outros.
function findDownbeat(times: number[], peaks: number[], t0: number, period: number, beatsPerBar: number): number {
  const sums = new Array(beatsPerBar).fill(0);
  const counts = new Array(beatsPerBar).fill(0);
  times.forEach((t, i) => {
    const k = Math.round((t - t0) / period);
    const phase = ((k % beatsPerBar) + beatsPerBar) % beatsPerBar;
    sums[phase] += peaks[i];
    counts[phase]++;
  });
  const avg = sums.map((s, i) => (counts[i] ? s / counts[i] : 0));
  const best = avg.indexOf(Math.max(...avg));
  const others = avg.filter((_, i) => i !== best);
  const otherAvg = others.reduce((a, b) => a + b, 0) / Math.max(1, others.length);
  const accented = otherAvg > 0 && avg[best] > otherAvg * 1.12;
  let first = t0 + (accented ? best : 0) * period;
  while (first - period * beatsPerBar >= -0.001) first -= period * beatsPerBar;
  return Math.max(0, first);
}

function tempoFromOnsets({ times, peaks }: Onsets, beatsPerBar: number): TempoResult | null {
  if (times.length < MIN_RUN + 4) return null;
  const rough = modePeriod(times);
  if (!rough) return null;
  const run = longestRun(times, rough);
  if (run.length < MIN_RUN) return null;
  let runTimes = run.map((i) => times[i]);
  let runPeaks = run.map((i) => peaks[i]);
  let fit = fitGrid(runTimes, rough);
  if (!fit) return null;

  const parity = subdivisionParity(fit.idx, runPeaks);
  if (parity !== null) {
    const keep = fit.idx.map((k) => ((k % 2) + 2) % 2 === parity);
    runTimes = runTimes.filter((_, i) => keep[i]);
    runPeaks = runPeaks.filter((_, i) => keep[i]);
    if (runTimes.length < 8) return null;
    fit = fitGrid(runTimes, fit.period * 2);
    if (!fit) return null;
  }

  const bpm = foldIntoRange(60 / fit.period);
  const beatPeriod = 60 / bpm;
  const ratio = Math.round(beatPeriod / fit.period);
  const t0 = fit.t0;
  const onBeat = runTimes.map((t) => {
    const k = Math.round((t - t0) / fit!.period);
    return ratio <= 1 || k % ratio === 0;
  });
  const downbeat = findDownbeat(
    runTimes.filter((_, i) => onBeat[i]), runPeaks.filter((_, i) => onBeat[i]), t0, beatPeriod, beatsPerBar,
  );
  return { bpm: tidyBpm(bpm), downbeat, fromClick: true };
}

export function detectClickTempo(audio: ClipAudio, beatsPerBar = 4): TempoResult | null {
  const { env, hop, len, max } = envelope(audio);
  if (max < 300) return null;
  // Contagem ou um pico isolado mais alto escondem as batidas normais: tenta limiares mais baixos.
  for (const ratio of [0.25, 0.12, 0.05]) {
    const result = tempoFromOnsets(onsetsAt(audio, env, hop, len, max * ratio), beatsPerBar);
    if (result) return result;
  }
  return null;
}

// Para músicas sem click: devolve null quando a medição não é confiável, melhor não mostrar do que chutar.
export async function detectBpm(audioBuffer: AudioBuffer): Promise<TempoResult | null> {
  try {
    const span = Math.min(MAX_ANALYSIS_SECONDS, audioBuffer.duration);
    const { bpm, offset } = await guess(audioBuffer, 0, span, { minTempo: MIN_BPM, maxTempo: MAX_BPM });
    if (!Number.isFinite(bpm) || bpm < MIN_BPM || bpm > MAX_BPM) return null;
    return { bpm: Math.round(bpm), downbeat: Math.max(0, offset || 0), fromClick: false };
  } catch {
    return null;
  }
}

export interface TempoSegment {
  startTime: number;
  endTime: number;
  bpm: number;
  downbeat: number;
}

export interface MultiTempoResult {
  bpm: number;
  downbeat: number;
  segments: TempoSegment[];
  isMultiTempo: boolean;
}

/**
 * Detecta o mapa de andamento da música, identificando se há múltiplos andamentos
 * (ex.: início lento que acelera ou trecho que desacelera).
 */
export async function detectMultiTempo(audioBuffer: AudioBuffer): Promise<MultiTempoResult> {
  const duration = audioBuffer.duration;
  const initial = await detectBpm(audioBuffer).catch(() => null);
  const baseBpm = initial?.bpm || 120;
  const baseDownbeat = initial?.downbeat || 0;

  if (duration < 45) {
    return {
      bpm: baseBpm,
      downbeat: baseDownbeat,
      segments: [{ startTime: 0, endTime: duration, bpm: baseBpm, downbeat: baseDownbeat }],
      isMultiTempo: false,
    };
  }

  const windowDuration = 35;
  const step = 20;
  const windowTempos: { time: number; bpm: number }[] = [];

  for (let t = 0; t + windowDuration <= duration; t += step) {
    try {
      const res = await guess(audioBuffer, t, windowDuration, { minTempo: MIN_BPM, maxTempo: MAX_BPM });
      if (res && Number.isFinite(res.bpm) && res.bpm >= MIN_BPM && res.bpm <= MAX_BPM) {
        windowTempos.push({ time: t, bpm: Math.round(res.bpm) });
      }
    } catch { /* continua */ }
  }

  if (windowTempos.length >= 2) {
    const firstBpm = windowTempos[0].bpm;
    let splitIdx = -1;
    for (let i = 1; i < windowTempos.length; i++) {
      if (Math.abs(windowTempos[i].bpm - firstBpm) >= 8) {
        const subsequentBpms = windowTempos.slice(i).map((w) => w.bpm);
        const avgSubsequent = subsequentBpms.reduce((a, b) => a + b, 0) / subsequentBpms.length;
        if (Math.abs(avgSubsequent - firstBpm) >= 8) {
          splitIdx = i;
          break;
        }
      }
    }

    if (splitIdx > 0) {
      const splitTime = windowTempos[splitIdx].time;
      const secondBpm = Math.round(
        windowTempos.slice(splitIdx).reduce((acc, w) => acc + w.bpm, 0) / (windowTempos.length - splitIdx)
      );

      return {
        bpm: firstBpm,
        downbeat: baseDownbeat,
        segments: [
          { startTime: 0, endTime: splitTime, bpm: firstBpm, downbeat: baseDownbeat },
          { startTime: splitTime, endTime: duration, bpm: secondBpm, downbeat: 0 },
        ],
        isMultiTempo: true,
      };
    }
  }

  return {
    bpm: baseBpm,
    downbeat: baseDownbeat,
    segments: [{ startTime: 0, endTime: duration, bpm: baseBpm, downbeat: baseDownbeat }],
    isMultiTempo: false,
  };
}

/**
 * Detecta múltiplos andamentos a partir da trilha de Click (especial para Medleys / Popuris).
 * Identifica transições estáveis entre seções e cria os segmentos de andamento correspondentes.
 */
export function detectClickMultiTempo(
  audio: ClipAudio,
  beatsPerBar = 4
): { segments: TempoSegment[]; bpm: number; isMultiTempo: boolean; downbeat: number } | null {
  const { env, hop, len, max } = envelope(audio);
  if (max < 300) return null;

  const onsets = onsetsAt(audio, env, hop, len, max * 0.12);
  const times = onsets.times;
  if (times.length < 24) return null;

  const maxTime = times[times.length - 1];
  const windowSec = 16;
  const stepSec = 4;
  const localTempos: Array<{ time: number; bpm: number }> = [];

  for (let t = 0; t + windowSec <= maxTime; t += stepSec) {
    const windowTimes = times.filter((x) => x >= t && x < t + windowSec);
    if (windowTimes.length >= 8) {
      const rough = modePeriod(windowTimes);
      if (rough) {
        const bpm = foldIntoRange(60 / rough);
        localTempos.push({ time: t, bpm: tidyBpm(bpm) });
      }
    }
  }

  if (localTempos.length >= 4) {
    const rawSegments: Array<{ startTime: number; endTime: number; bpm: number }> = [];
    let curBpm = localTempos[0].bpm;
    let segStart = 0;

    for (let i = 1; i < localTempos.length; i++) {
      const candBpm = localTempos[i].bpm;
      if (Math.abs(candBpm - curBpm) >= 6) {
        const subsequent = localTempos.slice(i, i + 3).map((w) => w.bpm);
        const avg = subsequent.reduce((a, b) => a + b, 0) / subsequent.length;
        if (Math.abs(avg - curBpm) >= 5) {
          const splitTime = Math.round(localTempos[i].time * 10) / 10;
          rawSegments.push({
            startTime: segStart,
            endTime: splitTime,
            bpm: curBpm,
          });
          curBpm = Math.round(avg * 10) / 10;
          segStart = splitTime;
          i += 2;
        }
      }
    }

    if (rawSegments.length >= 1) {
      rawSegments.push({
        startTime: segStart,
        endTime: Math.ceil(maxTime),
        bpm: curBpm,
      });

      const segments: TempoSegment[] = rawSegments.map((s) => {
        // Ancora o tempo 1 deste segmento num compasso inteiro de verdade (usa a fórmula de
        // compasso da música), em vez de cravar na primeira batida solta detectada.
        const segTimes = times.filter((x) => x >= s.startTime && x <= s.endTime);
        const segPeriod = 60 / s.bpm;
        let downbeat = s.startTime;
        if (segTimes.length >= beatsPerBar) {
          const fit = fitGrid(segTimes, segPeriod);
          if (fit) {
            let first = fit.t0;
            while (first - segPeriod * beatsPerBar >= s.startTime - 1e-3) first -= segPeriod * beatsPerBar;
            while (first < s.startTime) first += segPeriod;
            downbeat = first;
          }
        }
        return { startTime: s.startTime, endTime: s.endTime, bpm: s.bpm, downbeat };
      });

      return {
        segments,
        bpm: segments[0].bpm,
        isMultiTempo: true,
        downbeat: segments[0].downbeat || 0,
      };
    }
  }

  return null;
}

