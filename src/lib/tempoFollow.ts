import type { Song, SongTempoSegment } from '@/types';
import { analyzeTempoMap, fft, onsetEnvelope, type BeatModel } from './tempoMap.ts';
import { clickGridTimes, clickHits } from './clickEdit.ts';
import { segmentBar, segmentPickup } from './grid.ts';

/**
 * Segue a batida de uma música (ou medley) uma a uma e transforma em trechos de andamento da grade.
 * Só contas: recebe as ativações do modelo de batidas (0 a 1, 50 por segundo) e o áudio mono.
 * O resultado usa o mesmo `tempoSegments` da régua, então projeto antigo não muda em nada.
 */

export interface FollowedBeats {
  beats: number[];
  /** Índices em `beats` que são o 1 do compasso. */
  downbeats: number[];
  beatsPerBar: number;
}

function activationPeaks(a: Float32Array, fps: number): number[] {
  const peaks: number[] = [];
  for (let i = 3; i < a.length - 3; i++) {
    if (a[i] <= 0.5) continue;
    let top = true;
    for (let k = i - 3; k <= i + 3; k++) if (a[k] > a[i]) top = false;
    if (top && (!peaks.length || i / fps - peaks[peaks.length - 1] > 0.05)) peaks.push(i / fps);
  }
  return peaks;
}

/** Período local: mediana dos intervalos entre batidas em volta de cada ponto (±6 s). Muda de uma vez na troca de música. */
function localPeriod(peaks: number[], n: number, fps: number): Float32Array {
  const out = new Float32Array(n);
  const gaps: Array<[number, number]> = [];
  for (let i = 1; i < peaks.length; i++) {
    const d = peaks[i] - peaks[i - 1];
    if (d >= 0.24 && d <= 1.6) gaps.push([peaks[i], d]);
  }
  const all = gaps.map(([, d]) => d).sort((a, b) => a - b);
  let last = all.length ? all[all.length >> 1] : 0.5;
  let lo = 0;
  let hi = 0;
  for (let f = 0; f < n; f += 20) {
    const t = f / fps;
    while (lo < gaps.length && gaps[lo][0] < t - 6) lo++;
    while (hi < gaps.length && gaps[hi][0] <= t + 6) hi++;
    if (hi - lo >= 5) {
      const near = gaps.slice(lo, hi).map(([, d]) => d).sort((a, b) => a - b);
      last = near[near.length >> 1];
    }
    out.fill(last, f, Math.min(n, f + 20));
  }
  return out;
}

/** Em cada batida, qual delas é o 1: Viterbi sobre a fase do compasso, com custo para mudar (só muda em troca real). */
function barPhases(strength: number[], bar: number): { phase: Int8Array; score: number } {
  const n = strength.length;
  const phase = new Int8Array(n);
  if (!n) return { phase, score: 0 };
  const SWITCH = 2.5;
  const gain = (i: number, s: number) => (((i - s) % bar) + bar) % bar === 0 ? strength[i] : -strength[i] / (bar - 1);
  let cur = new Float64Array(bar);
  const from = new Int8Array(n * bar);
  for (let s = 0; s < bar; s++) cur[s] = gain(0, s);
  for (let i = 1; i < n; i++) {
    const next = new Float64Array(bar);
    let top = 0;
    for (let s = 1; s < bar; s++) if (cur[s] > cur[top]) top = s;
    for (let s = 0; s < bar; s++) {
      const stay = cur[s];
      const jump = cur[top] - SWITCH;
      from[i * bar + s] = stay >= jump ? s : top;
      next[s] = Math.max(stay, jump) + gain(i, s);
    }
    cur = next;
  }
  let best = 0;
  for (let s = 1; s < bar; s++) if (cur[s] > cur[best]) best = s;
  const score = cur[best] / n;
  for (let i = n - 1, s = best; i >= 0; i--) {
    phase[i] = s;
    s = from[i * bar + s];
  }
  return { phase, score };
}

export function followBeats(mono: Float32Array, sr: number, beat: Float32Array, down: Float32Array, modelFps = 50, beatsPerBar = 4): FollowedBeats {
  const { env } = onsetEnvelope(mono, sr);
  const fps = sr / Math.max(1, Math.round(sr / 200));
  const n = env.length;
  if (n < fps * 2) return { beats: [], downbeats: [], beatsPerBar: 4 };
  let mx = 0;
  for (let f = 0; f < n; f++) if (env[f] > mx) mx = env[f];
  const score = new Float32Array(n);
  for (let f = 0; f < n; f++) {
    const c = Math.round((f / fps) * modelFps);
    let a = 0;
    for (let k = c - 1; k <= c + 1; k++) if (k >= 0 && k < beat.length && beat[k] > a) a = beat[k];
    score[f] = a * (0.35 + (0.65 * env[f]) / (mx || 1));
  }
  const per = localPeriod(activationPeaks(beat, modelFps), n, fps);
  const C = new Float32Array(n);
  const back = new Int32Array(n).fill(-1);
  const TIGHT = 9;
  for (let f = 0; f < n; f++) {
    const P = per[f] * fps;
    const lo = Math.max(0, Math.round(f - P * 1.12));
    const hi = Math.round(f - P * 0.88);
    let best = 0;
    let from = -1;
    for (let x = lo; x <= hi; x++) {
      const r = Math.log((f - x) / P);
      const v = C[x] - TIGHT * r * r;
      if (from < 0 || v > best) { best = v; from = x; }
    }
    C[f] = score[f] + (from >= 0 ? Math.max(best, 0) : 0);
    back[f] = from >= 0 && best > 0 ? from : -1;
  }
  let end = n - 1;
  for (let f = Math.max(0, n - Math.round(per[n - 1] * fps * 1.2)); f < n; f++) if (C[f] > C[end]) end = f;
  const idx: number[] = [];
  for (let f = end; f >= 0; f = back[f]) idx.push(f);
  idx.reverse();
  const beats = idx.map((f) => f / fps);
  if (beats.length < 8) return { beats: [], downbeats: [], beatsPerBar: 4 };
  const lead: number[] = [];
  for (let t = beats[0] - per[0]; t >= 0; t -= per[0]) lead.unshift(t);
  const all = [...lead, ...beats];

  const strength = all.map((t) => {
    const c = Math.round(t * modelFps);
    let v = 0;
    for (let k = c - 1; k <= c + 1; k++) if (k >= 0 && k < down.length && down[k] > v) v = down[k];
    return v;
  });
  const bar = beatsPerBar;
  const { phase } = barPhases(strength, bar);
  const downbeats: number[] = [];
  for (let i = 0; i < all.length; i++) if (((i - phase[i]) % bar + bar) % bar === 0) downbeats.push(i);
  return { beats: all, downbeats, beatsPerBar: bar };
}

/**
 * Junta compassos seguidos num trecho de BPM constante enquanto a reta passa a até `tol` segundos de
 * todas as batidas. Cada trecho começa num 1 de compasso e tem compassos inteiros, como a grade espera.
 */
export function beatsToSegments(f: FollowedBeats, duration: number, tol = 0.03): SongTempoSegment[] {
  const { beats, downbeats, beatsPerBar: bar } = f;
  if (downbeats.length < 2) return [];
  const fits = (a: number, b: number) => {
    const p = (beats[b] - beats[a]) / (b - a);
    for (let k = a + 1; k < b; k++) if (Math.abs(beats[a] + (k - a) * p - beats[k]) > tol) return false;
    return true;
  };
  const cuts: number[] = [];
  let i = 0;
  while (i < downbeats.length - 1) {
    const a = downbeats[i];
    let good = i + 1;
    for (let j = i + 1; j < downbeats.length; j++) {
      // só compassos inteiros: mudança de fase do 1 obriga a abrir outro trecho
      if ((downbeats[j] - a) % bar !== 0 || downbeats[j] - downbeats[j - 1] !== bar) break;
      if (fits(a, downbeats[j])) good = j;
      else if (j - good >= 3) break;
    }
    cuts.push(a);
    i = good;
  }
  const lastCut = downbeats[i];
  cuts.push(lastCut);
  const segs: SongTempoSegment[] = [];
  for (let c = 0; c < cuts.length - 1; c++) {
    const a = cuts[c];
    const b = cuts[c + 1];
    const bpm = (60 * (b - a)) / (beats[b] - beats[a]);
    segs.push({ startTime: beats[a], endTime: beats[b], bpm: Math.round(bpm * 100) / 100, downbeat: beats[a] });
  }
  if (segs.length) segs[segs.length - 1].endTime = Math.max(duration, segs[segs.length - 1].endTime);
  return segs;
}

/**
 * Leva o começo do primeiro trecho para trás em tempos inteiros: a introdução também tem grade e click.
 * Os tempos que sobram antes do primeiro 1 viram anacruse. Batida que cairia colada antes do 0:00
 * entra como uma batida no próprio 0:00, no mesmo BPM.
 */
export function extendToStart(segments: SongTempoSegment[], beatsPerBar: number): SongTempoSegment[] {
  if (!segments.length) return segments;
  const [first, ...rest] = segments;
  const beat = 60 / first.bpm;
  const perBar = first.beatsPerBar ?? beatsPerBar;
  const firstBar = first.startTime + (first.barOffset ?? 0) * beat;
  const n = Math.floor(firstBar / beat + 1e-6);
  const startTime = firstBar - n * beat;
  const pickup = ((n % perBar) + perBar) % perBar;
  const { barOffset: _old, ...clean } = first;
  const head: SongTempoSegment = { ...clean, startTime, downbeat: startTime + pickup * beat, ...(pickup ? { barOffset: pickup } : {}) };
  if (startTime > 1e-6 && beat - startTime <= 0.03 && startTime < first.endTime) {
    const lead = (pickup + 1) % perBar;
    const { barOffset: _unused, ...plain } = head;
    return [{ ...plain, startTime: 0, endTime: startTime, downbeat: lead * beat, ...(lead ? { barOffset: lead } : {}) }, head, ...rest];
  }
  return [head, ...rest];
}

/** Trechos medidos no arquivo levados para a régua, com a grade indo do 0:00 até o fim da música. */
export function placeOnTimeline(segments: SongTempoSegment[], offset: number, duration: number, beatsPerBar: number): SongTempoSegment[] {
  const moved = segments
    .map((s) => {
      const one = (s as ReadSegment).one;
      return { ...s, startTime: s.startTime + offset, endTime: s.endTime + offset, downbeat: (s.downbeat ?? s.startTime) + offset, ...(one !== undefined ? { one: one + offset } : {}) };
    })
    .filter((s) => s.endTime > 0);
  if (!moved.length) return segments;
  let placed = extendToStart(moved, beatsPerBar);
  // trecho que o corte do clipe deixou sem nenhuma batida não entra na régua
  while (placed.length > 1 && placed[0].startTime >= placed[0].endTime) placed = extendToStart(placed.slice(1), beatsPerBar);
  placed[placed.length - 1] = { ...placed[placed.length - 1], endTime: Math.max(duration, placed[placed.length - 1].endTime) };
  return placed;
}

/**
 * Música de um andamento só cuja batida não cai no 0:00. A grade só usa trechos a partir de dois, então
 * o trecho é dividido em compassos inteiros, no mesmo BPM (sem placa na régua e sem click a mais).
 */
export function splitSingleSegment(seg: SongTempoSegment, beatsPerBar: number): SongTempoSegment[] {
  const beat = 60 / seg.bpm;
  const bar = beat * (seg.beatsPerBar ?? beatsPerBar);
  const bars = Math.floor((seg.endTime - seg.startTime) / bar);
  if (bars < 2) return [seg];
  const cut = seg.startTime + Math.floor(bars / 2) * bar;
  return [{ ...seg, endTime: cut }, { ...seg, startTime: cut, downbeat: cut + (seg.barOffset ?? 0) * beat }];
}

// Leitura da faixa de click. Cada trecho é uma reta t = origem + período x batida: a decisão olha
// todas as batidas do trecho de uma vez, e o período nunca é reajustado no meio da decisão.

/** Folga mínima da reta: cada ataque precisa passar a até isto da grade do trecho. */
const CLICK_LINE_TOL = 0.002;
/** Piso do ruído de leitura dos ataques (click de DAW lido com precisão de amostra). */
const CLICK_NOISE_FLOOR = 0.0003;
/** O BPM inteiro só vale se a reta inteira continuar a até isto de todas as batidas. */
const CLICK_WHOLE_BPM_TOL = 0.001;
/** Primeiro ataque cortado: desvio até onde ele ainda é a mesma batida da grade. */
const CLICK_LEAD_MAX = 0.035;
/** Distância da grade que conta como ataque coberto. */
export const CLICK_COVER_TOL = 0.005;
/** Abaixo disto o mapa não explica o click e não é salvo em silêncio. */
export const MIN_CLICK_COVERAGE = 0.98;
/** Teto da folga medida pelo ruído: passar disso já é andamento mudando, não desvio de leitura. */
const CLICK_TOL_CAP = 0.02;
/** Trecho com menos que isto dos ataques na grade é o trecho ruim do aviso. */
const WEAK_SECTION_COVERAGE = 0.9;
/** Com os trechos ruins somando mais que isto dos ataques, o mapa não vale. */
const MAX_WEAK_SHARE = 0.4;

interface ClickLine { first: number; last: number; period: number; origin: number; half: boolean }

/**
 * Trecho da leitura do click. A grade e o `barOffset` são sempre os da leitura pelo volume e timbre; as
 * marcas abaixo não vão para o projeto.
 * - `accent`: o 1 ali vem do próprio click, com certeza (o modelo não mexe).
 * - `one`: instante de um 1 achado só pelo som do click, onde a leitura pelo volume não via acento. É ele
 *   que vale no mapa final, sem mexer nas batidas.
 * - `held`: a leitura pelo volume tem acento em algum trecho, então o corte do clipe não apaga a fase.
 */
export type ReadSegment = SongTempoSegment & { accent?: boolean; one?: number; held?: boolean };

const mod = (v: number, n: number) => ((v % n) + n) % n;

/** Sem as marcas da leitura. */
function plainSegment(s: ReadSegment): SongTempoSegment {
  if (!('accent' in s) && !('one' in s) && !('held' in s)) return s;
  const { accent: _a, one: _o, held: _h, ...rest } = s;
  return rest;
}

/** Fase (tempos antes do primeiro 1) que a leitura marca no trecho: a do som, quando existe. */
export function readPickup(s: ReadSegment, beatsPerBar: number): number {
  const perBar = segmentBar(s, beatsPerBar);
  if (s.one === undefined) return segmentPickup(s) % perBar;
  return mod(Math.round((s.one - s.startTime) / (60 / s.bpm)), perBar);
}

export type PhaseReason = 'igual' | 'mudou' | 'poucos-compassos' | 'sem-apoio' | 'toco' | 'misturado';

export interface PhaseDecision {
  start: number;
  end: number;
  bars: number;
  before: number;
  after: number;
  scores: number[];
  reason: PhaseReason;
}

export interface BarPhaseResult {
  segments: SongTempoSegment[];
  changed: boolean;
  decisions: PhaseDecision[];
}

/** O mesmo trecho com outro 1. Quem não tinha fase e continua no começo segue sem ela. */
export function withPhase(seg: SongTempoSegment, phase: number): SongTempoSegment {
  const { barOffset: old, ...rest } = seg;
  const keep = phase > 0 || old !== undefined;
  return { ...rest, downbeat: seg.startTime + (phase * 60) / seg.bpm, ...(keep ? { barOffset: phase } : {}) };
}

/**
 * Copia para os trechos salvos o 1 de uma leitura do click. As batidas salvas ficam. Quando a fase muda
 * dentro de um trecho salvo (dois clipes no mesmo BPM, o segundo entrando fora do compasso), ele é dividido
 * ali, na própria grade, e cada pedaço fica com o 1 da leitura. Vale o 1 do som (`one`) quando a leitura tem.
 * Com `stored` (mapa salvo que já guarda o 1), a fase só muda onde o mapa é o da leitura de sempre: a fase
 * salva igual à do volume. Fase salva diferente veio de outro lugar e fica.
 */
export function copyBarPhase(segments: SongTempoSegment[], reference: ReadSegment[], beatsPerBar: number, stored = false): BarPhaseResult {
  const sorted = [...segments].sort((a, b) => a.startTime - b.startTime);
  const refs = [...reference].sort((a, b) => a.startTime - b.startTime);
  const out: SongTempoSegment[] = [];
  const decisions: PhaseDecision[] = [];
  for (const seg of sorted) {
    const perBar = segmentBar(seg, beatsPerBar);
    const beat = 60 / seg.bpm;
    const before = segmentPickup(seg) % perBar;
    const note = (piece: SongTempoSegment, from: number, to: number, reason: PhaseReason) => {
      out.push(piece);
      decisions.push({ start: piece.startTime, end: piece.endTime, bars: 0, before: from, after: to, scores: [], reason });
    };
    const inside = refs.filter((r) => Math.min(r.endTime, seg.endTime) - Math.max(r.startTime, seg.startTime) > beat * 0.5);
    if (!inside.length || inside.some((r) => Math.abs(r.bpm - seg.bpm) > 0.05 || segmentBar(r, beatsPerBar) !== perBar)) {
      note(seg, before, before, 'sem-apoio');
      continue;
    }
    // onde cada contagem da leitura começa na grade salva (em batidas) e a fase dela contada do trecho
    const marks: Array<{ at: number; phase: number }> = [];
    const total = Math.round((seg.endTime - seg.startTime) / beat);
    const phaseOf = (one: number) => mod(Math.round((one - seg.startTime) / beat), perBar);
    for (const r of inside) {
      const plainOne = r.startTime + (segmentPickup(r) * 60) / r.bpm;
      let phase = phaseOf(r.one ?? plainOne);
      if (stored && phaseOf(plainOne) !== before) phase = before;
      const last = marks[marks.length - 1];
      if (last && last.phase === phase) continue;
      const at = last ? Math.round((r.startTime - seg.startTime) / beat) : 0;
      if (last && (at <= last.at || at >= total)) continue;
      marks.push({ at, phase });
    }
    if (marks.length === 1) {
      const [{ phase }] = marks;
      note(phase === before ? seg : withPhase(seg, phase), before, phase, phase === before ? 'igual' : 'mudou');
      continue;
    }
    const { barOffset: _old, ...rest } = seg;
    marks.forEach((m, j) => {
      const startTime = seg.startTime + m.at * beat;
      const endTime = marks[j + 1] ? seg.startTime + marks[j + 1].at * beat : seg.endTime;
      const pickup = mod(m.phase - m.at, perBar);
      // pedaços da mesma reta guardam a fase mesmo quando ela é zero: é ela que separa um do outro
      note({ ...rest, startTime, endTime, downbeat: startTime + pickup * beat, barOffset: pickup }, mod(before - m.at, perBar), pickup, 'mudou');
    });
  }
  return { segments: out, changed: out.length !== sorted.length || out.some((seg, i) => seg !== sorted[i]), decisions };
}

/** O que saiu da leitura dos ataques do click. */
export interface ClickRead {
  segments: ReadSegment[];
  halfRanges: Array<[number, number]>;
  /** Toda reta com compassos próprios tem acento: o 1 vem do click inteiro, sem o modelo. */
  accented: boolean;
  /** Ataques que são batida: sem o contratempo de swing ou de colcheia pontuada. */
  pulseHits: number[];
  /** Folga da reta e da cobertura, medidas no ruído destes ataques. */
  lineTol: number;
  coverTol: number;
}

/** Folga da reta e da cobertura, a partir do ruído medido nos próprios ataques. */
function clickTolerances(noise: number): { lineTol: number; coverTol: number } {
  return {
    lineTol: Math.min(CLICK_TOL_CAP, Math.max(CLICK_LINE_TOL, 4 * noise)),
    coverTol: Math.min(CLICK_TOL_CAP, Math.max(CLICK_COVER_TOL, 3 * noise)),
  };
}

/**
 * Subdivisão desigual (swing, colcheia pontuada): os intervalos alternam longo e curto e a soma do par é
 * constante. O pulso é essa soma, e o ataque que abre o intervalo curto é subdivisão, não batida.
 */
function unevenOffbeats(hits: number[]): Set<number> {
  const off = new Set<number>();
  const gaps = hits.slice(1).map((v, i) => v - hits[i]);
  const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.003, Math.min(a, b) * 0.06);
  const uneven = (a: number, b: number) => {
    const r = Math.max(a, b) / Math.max(1e-6, Math.min(a, b));
    return r >= 1.25 && r <= 4.2;
  };
  for (let i = 0; i + 3 < gaps.length;) {
    if (!uneven(gaps[i], gaps[i + 1])) { i++; continue; }
    let end = i + 1;
    while (end + 1 < gaps.length && near(gaps[end + 1], gaps[end - 1])) end++;
    // pelo menos quatro pulsos inteiros: uma virada ou um rall não formam esse padrão
    if (end - i + 1 >= 8) {
      for (let j = i; j <= end; j++) {
        const next = j < end ? gaps[j + 1] : gaps[j - 1];
        if (gaps[j] < next) off.add(j);
      }
      // o último ataque da sequência fecha um intervalo longo: ele também é contratempo
      if (gaps[end] > gaps[end - 1]) off.add(end + 1);
      i = end + 1;
    } else i++;
  }
  return off;
}

/** Força de cada ataque: 1 é o ataque comum; acima disso, o volume e o timbre fora do normal. */
function accentStrengths(peaks: number[], timbre?: number[]): number[] {
  const loud = medianOf(peaks.filter((v) => v > 0)) || 1;
  const tone = timbre?.length ? medianOf(timbre.filter((v) => v > 0)) : 0;
  return peaks.map((p, i) => {
    let v = 1 + Math.max(0, p / loud - 1);
    if (tone > 0) {
      const d = Math.abs((timbre?.[i] ?? tone) / tone - 1);
      // timbre igual (a mesma amostra) varia pouco: só diferença clara conta como acento
      if (d >= 0.1) v += d;
    }
    return v;
  });
}

/** Ataques de cada lado que dão o volume de referência em volta de um ataque. */
const LOCAL_LOUD_SPAN = 8;

/**
 * A mesma força de `accentStrengths`, mas o volume de cada ataque é medido contra os ataques fracos em
 * volta (o quartil de baixo de oito de cada lado), e não contra a música inteira: a automação de volume
 * do click (metade mais baixa, fade) não muda a diferença entre o 1 e os outros tempos do mesmo compasso.
 */
function localAccentStrengths(peaks: number[], timbre?: number[]): number[] {
  const tone = timbre?.length ? medianOf(timbre.filter((v) => v > 0)) : 0;
  return peaks.map((p, i) => {
    const near = peaks.slice(Math.max(0, i - LOCAL_LOUD_SPAN), i + LOCAL_LOUD_SPAN + 1).filter((v) => v > 0).sort((a, b) => a - b);
    const loud = near[Math.floor(0.25 * (near.length - 1))] || 1;
    let v = 1 + Math.max(0, p / loud - 1);
    if (tone > 0) {
      const d = Math.abs((timbre?.[i] ?? tone) / tone - 1);
      if (d >= 0.1) v += d;
    }
    return v;
  });
}

/** Timbre do ataque: cruzamentos por zero nos primeiros 10 ms (grave conta pouco, agudo conta muito). */
function attackTimbre(mono: Float32Array, hits: number[], sr: number): number[] {
  const n = Math.max(8, Math.round(0.01 * sr));
  return hits.map((h) => {
    let changes = 0;
    for (let i = h + 1; i < Math.min(mono.length, h + n); i++) if (mono[i] >= 0 !== mono[i - 1] >= 0) changes++;
    return changes / n;
  });
}

// Acento pelo próprio som: click de dois sons (a amostra do 1 e a dos outros tempos) se separa em dois
// grupos pela forma do espectro do ataque, sem olhar o volume. O som do 1 pode ser mais baixo que os outros.
const SHAPE_SIZE = 256;
const SHAPE_BINS = 72;
/**
 * Separação mínima entre os dois sons, medida no áudio que o worker recebe (a redução para 22050 Hz suja o
 * ataque): clicks de uma amostra só chegam a 7,2 e 2,88; o click de dois sons mede 28,4 e 18,7.
 */
const SOUND_MIN_DPRIME = 14;
const SOUND_MIN_DISTANCE = 7;
/** O grupo do acento precisa voltar sempre no mesmo intervalo. */
const SOUND_MIN_REGULAR = 0.9;
// período 2 (tic-tac) fica de fora: dois sons alternados não dizem qual deles é o 1
const SOUND_PERIODS = new Set([3, 4, 5, 6, 12]);

/** Forma do espectro no começo de cada ataque: log da energia menos a média, então o volume não conta. */
export function attackShapes(mono: Float32Array, hits: number[]): Float64Array[] {
  const win = Float64Array.from({ length: SHAPE_SIZE }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (SHAPE_SIZE - 1)));
  const re = new Float64Array(SHAPE_SIZE), im = new Float64Array(SHAPE_SIZE);
  return hits.map((h) => {
    const from = Math.max(0, h - 8);
    for (let i = 0; i < SHAPE_SIZE; i++) { re[i] = (mono[from + i] ?? 0) * win[i]; im[i] = 0; }
    fft(re, im);
    const v = new Float64Array(SHAPE_BINS);
    let mean = 0;
    for (let k = 0; k < SHAPE_BINS; k++) {
      v[k] = Math.log(1e-7 + re[k + 1] * re[k + 1] + im[k + 1] * im[k + 1]);
      mean += v[k] / SHAPE_BINS;
    }
    for (let k = 0; k < SHAPE_BINS; k++) v[k] -= mean;
    return v;
  });
}

function shapeDistance(a: Float64Array, b: Float64Array): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) d += (a[i] - b[i]) * (a[i] - b[i]);
  return d;
}

function shapeMean(list: Float64Array[]): Float64Array {
  const out = new Float64Array(SHAPE_BINS);
  for (const v of list) for (let i = 0; i < SHAPE_BINS; i++) out[i] += v[i] / list.length;
  return out;
}

/**
 * Força de cada ataque pelo som (2 no acento, 1 nos outros). Só vale com dois sons inequívocos e com o
 * grupo menor voltando num intervalo fixo de batidas. Fora disso devolve null e nada muda.
 */
export function soundAccents(shapes: Float64Array[], beats: number[]): number[] | null {
  const n = shapes.length;
  if (n < 16) return null;
  const center = shapeMean(shapes);
  let far = 0, top = -1;
  shapes.forEach((v, i) => { const d = shapeDistance(v, center); if (d > top) { top = d; far = i; } });
  let a: Float64Array = shapes[far], b: Float64Array = center;
  let side = new Uint8Array(n);
  for (let round = 0; round < 25; round++) {
    const next = new Uint8Array(n);
    for (let i = 0; i < n; i++) next[i] = shapeDistance(shapes[i], a) < shapeDistance(shapes[i], b) ? 1 : 0;
    const g1 = shapes.filter((_, i) => next[i]), g0 = shapes.filter((_, i) => !next[i]);
    if (!g1.length || !g0.length) return null;
    a = shapeMean(g1);
    b = shapeMean(g0);
    const same = next.every((q, i) => q === side[i]);
    side = next;
    if (same) break;
  }
  const axis = a.map((q, i) => q - b[i]);
  const length = Math.sqrt(axis.reduce((p, q) => p + q * q, 0)) || 1;
  const at = shapes.map((v) => v.reduce((p, q, i) => p + (q - b[i]) * axis[i], 0) / length);
  const stats = (mark: number) => {
    const list = at.filter((_, i) => side[i] === mark);
    const mean = list.reduce((p, q) => p + q, 0) / Math.max(1, list.length);
    const sd = Math.sqrt(list.reduce((p, q) => p + (q - mean) * (q - mean), 0) / Math.max(1, list.length - 1));
    let low = Infinity, high = -Infinity;
    for (const v of list) { if (v < low) low = v; if (v > high) high = v; }
    return { count: list.length, mean, sd, low, high };
  };
  const one = stats(1), zero = stats(0);
  if (!one.count || !zero.count) return null;
  const distance = one.mean - zero.mean;
  const spread = Math.sqrt((one.sd * one.sd + zero.sd * zero.sd) / 2) || 1e-9;
  if (distance < SOUND_MIN_DISTANCE || distance / spread < SOUND_MIN_DPRIME || one.low <= zero.high) return null;

  // o acento é o som que aparece menos; metade para cada lado é tic-tac e cai fora pelo período
  const accent = one.count < zero.count ? 1 : 0;
  const marked = beats.flatMap((beat, i) => (side[i] === accent ? [beat] : []));
  if (marked.length < 4) return null;
  const counts = new Map<number, number>();
  for (let i = 1; i < marked.length; i++) counts.set(marked[i] - marked[i - 1], (counts.get(marked[i] - marked[i - 1]) ?? 0) + 1);
  let period = 0, times = 0;
  for (const [gap, c] of counts) if (c > times) { period = gap; times = c; }
  if (!SOUND_PERIODS.has(period) || times / (marked.length - 1) < SOUND_MIN_REGULAR) return null;
  return Array.from(side, (q) => (q === accent ? 2 : 1));
}

/**
 * Dentro do som do acento o volume ainda conta: no 6/8 com o mesmo som no 1 e no 4, o mais forte é o 1. O
 * volume é medido contra o outro som em volta, então a automação de volume da música não conta. O outro
 * som fica em 1, sem volume: senão a parte mais alta da música vira acento.
 */
function soundWithVolume(bySound: number[], peaks: number[]): number[] {
  const others = bySound.flatMap((g, i) => (g === 2 ? [] : [i]));
  const whole = medianOf(others.map((i) => peaks[i] ?? 0).filter((p) => p > 0)) || 1;
  let next = 0;
  const ratio = bySound.map((g, i) => {
    while (next < others.length && others[next] < i) next++;
    if (g !== 2) return 0;
    // dois ataques do outro som antes e dois depois
    const near = others.slice(Math.max(0, next - 2), next + 2).map((j) => peaks[j] ?? 0).filter((p) => p > 0);
    return (peaks[i] ?? 0) / (medianOf(near) || whole);
  });
  const own = ratio.filter((r, i) => bySound[i] === 2 && r > 0).sort((a, b) => a - b);
  const ref = own[Math.floor(0.1 * (own.length - 1))] || 1;
  return bySound.map((g, i) => (g === 2 ? 2 + Math.max(0, ratio[i] / ref - 1) : 1));
}

function medianOf(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[(sorted.length - 1) >> 1];
}

/** Tira ataque solto entre duas batidas (ruído): os dois intervalos em volta somam um pulso só. */
function withoutStrayHits(hits: number[]): number[] {
  const keep: number[] = [];
  for (let i = 0; i < hits.length; i++) {
    if (i > 0 && i + 1 < hits.length) {
      const before = hits[i] - hits[i - 1], after = hits[i + 1] - hits[i];
      const around: number[] = [];
      for (let k = Math.max(1, i - 4); k < Math.min(hits.length, i + 6); k++) if (k !== i && k !== i + 1) around.push(hits[k] - hits[k - 1]);
      const pulse = medianOf(around);
      if (pulse > 0 && before < pulse * 0.75 && after < pulse * 0.75 && Math.abs(before + after - pulse) <= pulse * 0.1) continue;
    }
    keep.push(i);
  }
  return keep;
}

/** Número da batida de cada ataque: soma 1 por intervalo, ou mais quando o click pausa. */
function beatNumbers(t: number[]): number[] {
  const gaps = t.slice(1).map((v, i) => v - t[i]);
  const k = new Array<number>(t.length).fill(0);
  for (let e = 0; e < gaps.length; e++) {
    const d = gaps[e];
    const left = medianOf(gaps.slice(Math.max(0, e - 4), e));
    const right = medianOf(gaps.slice(e + 1, e + 5));
    const near = (p: number) => p > 0 && Math.abs(d - p) <= p * 0.2;
    // dois intervalos iguais em seguida já são um pulso: trecho curto mais lento não é pausa
    const twin = (e > 0 && Math.abs(gaps[e - 1] - d) <= d * 0.03) || (e + 1 < gaps.length && Math.abs(gaps[e + 1] - d) <= d * 0.03);
    let step = 1;
    if (!twin && !near(left) && !near(right)) {
      let miss = Infinity;
      for (const p of [left, right]) {
        if (p <= 0) continue;
        const s = Math.max(1, Math.round(d / p));
        if (Math.abs(d - s * p) < miss) { miss = Math.abs(d - s * p); step = s; }
      }
    }
    k[e + 1] = k[e] + step;
  }
  return k;
}

/** Reta de mínimos quadrados dos ataques `a` a `b`, com a origem na batida de `a`. */
function fitClickLine(t: number[], k: number[], loose: boolean[], a: number, b: number): { period: number; origin: number; worst: number; worstAt: number } {
  const base = k[b] > k[a] ? (t[b] - t[a]) / (k[b] - k[a]) : 0;
  let n = 0, mx = 0, my = 0, xx = 0, xy = 0;
  for (let j = a; j <= b; j++) {
    if (loose[j]) continue;
    const x = k[j] - k[a], y = t[j] - t[a] - base * x;
    n++;
    const dx = x - mx;
    mx += dx / n;
    const dy = y - my;
    my += dy / n;
    xx += dx * (x - mx);
    xy += dx * (y - my);
  }
  const slope = xx > 0 ? xy / xx : 0;
  const period = base + slope;
  const origin = t[a] + my - slope * mx;
  let worst = 0, worstAt = a;
  for (let j = a; j <= b; j++) {
    if (loose[j]) continue;
    const e = Math.abs(t[j] - (origin + period * (k[j] - k[a])));
    if (e > worst) { worst = e; worstAt = j; }
  }
  return { period, origin, worst, worstAt };
}

/** Ataques que não servem para medir: um ponto fora da reta dos vizinhos, sem trocar de andamento. */
function looseHits(t: number[], k: number[], tol: number): boolean[] {
  const n = t.length;
  const loose = new Array<boolean>(n).fill(false);
  const bend = (i: number) => (k[i] - k[i - 1] === 1 && k[i + 1] - k[i] === 1 ? t[i] - (t[i - 1] + t[i + 1]) / 2 : NaN);
  for (let i = 2; i + 2 < n; i++) {
    const e = bend(i);
    if (!(Math.abs(e) > tol)) continue;
    const l = bend(i - 1), r = bend(i + 1);
    if (Math.abs(l + e / 2) <= Math.abs(e) * 0.25 && Math.abs(r + e / 2) <= Math.abs(e) * 0.25) loose[i] = true;
  }
  // nas pontas o ataque pode estar cortado: compara com a reta dos três vizinhos
  const edge = (at: number, a: number, m: number, b: number) => {
    if (b >= n || a < 0 || k[b] === k[a]) return;
    const p = (t[b] - t[a]) / (k[b] - k[a]);
    if (Math.abs(t[m] - (t[a] + p * (k[m] - k[a]))) > 0.0005) return;
    if (Math.abs(t[at] - (t[a] + p * (k[at] - k[a]))) > Math.max(0.001, tol / 2)) loose[at] = true;
  };
  if (n >= 5) {
    edge(0, 1, 2, 3);
    edge(n - 1, n - 4, n - 3, n - 2);
  }
  return loose;
}

/**
 * Onde cortar as retas: o menor custo entre erro das batidas e número de trechos, olhando todas as
 * divisões possíveis. A batida da quina pode ser a última de um trecho e a primeira do outro.
 */
function cutClickLines(t: number[], k: number[], loose: boolean[], penalty: number, tol: number): Array<[number, number]> {
  const n = t.length;
  if (n < 3) return n >= 2 ? [[0, n - 1]] : [];
  const best = new Float64Array(n).fill(Infinity);
  const from = new Int32Array(n).fill(-1);
  for (let i = 0; i < n - 1; i++) {
    const start = i === 0 ? 0 : Math.min(best[i], best[i - 1]);
    if (!Number.isFinite(start)) continue;
    const near = medianOf(t.slice(i + 1, Math.min(n, i + 5)).map((v, q) => (v - t[i + q]) / Math.max(1, k[i + q + 1] - k[i + q])));
    let c = 0, mx = 0, my = 0, xx = 0, xy = 0, yy = 0;
    for (let j = i; j < n; j++) {
      if (!loose[j]) {
        const x = k[j] - k[i], y = t[j] - t[i] - near * x;
        c++;
        const dx = x - mx;
        mx += dx / c;
        const dy = y - my;
        my += dy / c;
        xx += dx * (x - mx);
        xy += dx * (y - my);
        yy += dy * (y - my);
      }
      if (j - i < 2 || c < 2) continue;
      const sse = Math.max(0, yy - (xx > 0 ? (xy * xy) / xx : 0));
      const cost = start + sse + penalty;
      if (cost < best[j]) { best[j] = cost; from[j] = i; }
      if (sse > (tol * tol * c + penalty) * 4) break;
    }
  }
  if (from[n - 1] < 0) return [[0, n - 1]];
  const runs: Array<[number, number]> = [];
  for (let j = n - 1; j >= 0;) {
    const i = from[j];
    if (i < 0) { runs.unshift([0, j]); break; }
    runs.unshift([i, j]);
    if (i === 0) break;
    j = best[i] <= best[i - 1] ? i : i - 1;
  }
  return runs;
}

/** Dois ataques seguidos do mesmo lado, fora da folga: o andamento mudou. Um só é ruído de leitura. */
function sustainedMiss(t: number[], k: number[], loose: boolean[], a: number, b: number, f: { period: number; origin: number }, tol: number): boolean {
  let side = 0;
  for (let j = a; j <= b; j++) {
    if (loose[j]) continue;
    const e = t[j] - (f.origin + f.period * (k[j] - k[a]));
    const now = Math.abs(e) > tol ? Math.sign(e) : 0;
    if (now && now === side) return true;
    side = now;
  }
  return false;
}

/**
 * Trecho em que as batidas saíram da reta é dividido no ponto de maior desvio. No rall, cada intervalo é
 * um andamento: o trecho desce até dois ataques e a grade passa por todos eles.
 */
function splitWideRun(t: number[], k: number[], loose: boolean[], a: number, b: number, tol: number, out: Array<[number, number]>): void {
  const f = fitClickLine(t, k, loose, a, b);
  if (f.worst <= tol || b - a < 2 || (b - a >= 4 && !sustainedMiss(t, k, loose, a, b, f, tol))) { out.push([a, b]); return; }
  const at = Math.max(a + 1, Math.min(b - 1, f.worstAt));
  splitWideRun(t, k, loose, a, at, tol, out);
  splitWideRun(t, k, loose, at, b, tol, out);
}

/**
 * Dois trechos vizinhos no mesmo pulso viram um só. Dobro ou metade só é subdivisão quando o trecho é
 * curto e fica entre dois do mesmo pulso (A-B-A): numa emenda de duas músicas, a batida da quina coincide
 * sempre, mesmo com andamentos diferentes.
 */
function mergeSamePulse(lines: ClickLine[], t: number[], loose: boolean[], tol: number): ClickLine[] {
  const out = [...lines];
  const span = (l: ClickLine) => t[l.last] - t[l.first];
  const join = (a: ClickLine, b: ClickLine, before?: ClickLine, after?: ClickLine): ClickLine | null => {
    const r = a.period / b.period;
    const same = Math.abs(r - 1) < 0.001, slower = Math.abs(r - 2) < 0.02, faster = Math.abs(r - 0.5) < 0.01;
    if (!same && !slower && !faster) return null;
    const main = span(a) >= span(b) ? a : b;
    const other = main === a ? b : a;
    if (!same) {
      const far = main === a ? after : before;
      if (!far || Math.abs(far.period / main.period - 1) > 0.002) return null;
      if (span(other) > 0.75 * Math.min(span(main), span(far))) return null;
    }
    const step = !same && other.period < main.period ? main.period / 2 : main.period;
    for (let j = other.first; j <= other.last; j++) {
      if (loose[j]) continue;
      if (Math.abs(t[j] - (main.origin + Math.round((t[j] - main.origin) / step) * step)) > tol) return null;
    }
    const m = Math.floor((t[a.first] - main.origin) / main.period + 0.25);
    return { first: a.first, last: b.last, period: main.period, origin: main.origin + m * main.period, half: a.half || b.half || step < main.period };
  };
  for (let i = 0; i + 1 < out.length;) {
    const joined = join(out[i], out[i + 1], out[i - 1], out[i + 2]);
    if (joined) {
      out.splice(i, 2, joined);
      if (i > 0) i--;
    } else i++;
  }
  return out;
}

/** BPM da reta: o inteiro se ele ainda passa por todas as batidas; senão, a medida completa. */
function settleLineBpm(line: ClickLine, t: number[], loose: boolean[], noise: number): { bpm: number; origin: number } {
  const step = line.half ? line.period / 2 : line.period;
  const beatOf = (j: number) => Math.round((t[j] - line.origin) / step) * (step / line.period);
  let free = 0;
  for (let j = line.first; j <= line.last; j++) {
    if (!loose[j]) free = Math.max(free, Math.abs(t[j] - (line.origin + line.period * beatOf(j))));
  }
  const whole = Math.round(60 / line.period);
  if (whole > 0) {
    const period = 60 / whole;
    let sum = 0, c = 0;
    for (let j = line.first; j <= line.last; j++) {
      if (loose[j]) continue;
      sum += t[j] - period * beatOf(j);
      c++;
    }
    if (c) {
      const origin = sum / c;
      let worst = 0;
      for (let j = line.first; j <= line.last; j++) {
        if (!loose[j]) worst = Math.max(worst, Math.abs(t[j] - (origin + period * beatOf(j))));
      }
      if (worst <= Math.max(CLICK_WHOLE_BPM_TOL, free + 0.0003, 3 * noise)) return { bpm: whole, origin };
    }
  }
  return { bpm: 60 / line.period, origin: line.origin };
}

const METER_CANDIDATES = [2, 3, 4, 5, 6, 12];
/** Acento que volta no compasso com esta parte do contraste do 1, ou mais, é o mesmo acento do 1. */
const SAME_ACCENT = 0.9;

interface LineMeter { perBar: number; phase: number; strong: boolean; low: number; high: number; repeated?: boolean }

/**
 * Compasso e fase do trecho pelo acento: testa os períodos e fica com o de maior contraste. O do projeto
 * vale quando explica quase igual ou quando o acento achado cabe dentro dele (1 e 3 fortes em 4/4).
 * Sem acento claro, o compasso do projeto e nenhuma anacruse. Com `check`, o acento que se repete dentro
 * do compasso sai como `repeated` (sem força): ele não diz qual batida é o 1.
 */
function readLineMeter(line: ClickLine, origin: number, period: number, t: number[], accents: number[], projectBar: number, local?: number[], check = false): LineMeter {
  const read = (p: number) => {
    const sum = new Array<number>(p).fill(0), count = new Array<number>(p).fill(0);
    for (let j = line.first; j <= line.last; j++) {
      const beat = (t[j] - origin) / period;
      const whole = Math.round(beat);
      if (Math.abs(beat - whole) > 0.25) continue;
      const q = ((whole % p) + p) % p;
      sum[q] += accents[j] ?? 0;
      count[q]++;
    }
    if (count.some((c) => c === 0)) return null;
    const avg = sum.map((v, i) => v / count[i]);
    const top = Math.max(...avg);
    const rest = (avg.reduce((x, y) => x + y, 0) - top) / Math.max(1, p - 1);
    return { p, phase: avg.indexOf(top), top, rest, avg, contrast: rest > 0 ? top / rest : 1, bars: Math.min(...count) };
  };
  // acento que volta antes do fim do compasso (tic-tac, 1 e 3 iguais): diz o pulso, mas não qual é o 1. Só
  // não atrapalha o acento que fica abaixo do 1 em todo compasso (o 4 mais fraco do 6/8).
  const repeatsIn = (acc: number[], r: { p: number; phase: number }) => {
    if (r.p === 2) return true;
    const at: number[][] = Array.from({ length: r.p }, () => []);
    const wholes: number[] = [];
    for (let j = line.first; j <= line.last; j++) {
      const beat = (t[j] - origin) / period;
      const whole = Math.round(beat);
      if (Math.abs(beat - whole) > 0.25) continue;
      at[((whole % r.p) + r.p) % r.p].push(acc[j] ?? 0);
      wholes.push(j);
    }
    const avg = at.map((v) => v.reduce((x, y) => x + y, 0) / Math.max(1, v.length));
    const top = Math.max(...avg);
    const rest = (avg.reduce((x, y) => x + y, 0) - top) / Math.max(1, r.p - 1);
    const cut = (top + rest) / 2;
    const marked = wholes.flatMap((j) => ((acc[j] ?? 0) >= cut ? [Math.round((t[j] - origin) / period)] : []));
    const counts = new Map<number, number>();
    for (let i = 1; i < marked.length; i++) counts.set(marked[i] - marked[i - 1], (counts.get(marked[i] - marked[i - 1]) ?? 0) + 1);
    let gap = 0, times = 0;
    for (const [g, c] of counts) if (c > times) { gap = g; times = c; }
    if (!(gap > 0 && gap < r.p && r.p % gap === 0)) return false;
    if (gap === 1) return true;
    // quantis em vez de mínimo e máximo: um ataque cortado no começo do arquivo não decide
    const share = (v: number[], q: number) => { const s = [...v].sort((a, b) => a - b); return s[Math.round(q * (s.length - 1))] ?? 0; };
    const low = Math.min(...avg), floor = share(at[r.phase], 0.1);
    const weak = Math.max(...at.flatMap((v, q) => ((q - r.phase + r.p) % gap === 0 ? [] : [share(v, 0.9)])));
    for (let q = r.phase + gap; q < r.phase + r.p; q += gap) {
      const v = at[q % r.p];
      // perto do 1 na média ou alcançando os ataques do 1: é o mesmo acento. Misturado com os tempos
      // fracos: é volume solto, não acento
      if (avg[q % r.p] - low >= SAME_ACCENT * (top - low) || share(v, 0.9) >= floor || share(v, 0.1) <= weak) return true;
    }
    return false;
  };
  // o acento só sai quando a leitura com o volume medido em volta de cada ataque também vê a repetição:
  // a automação de volume (metade mais baixa, fade) faz o 3 forte alcançar o 1 fraco só na conta inteira
  const repeats = (r: { p: number; phase: number }) => check && repeatsIn(accents, r) && (!local || repeatsIn(local, r));
  const base = read(projectBar);
  let best = base;
  for (const p of METER_CANDIDATES) {
    if (p === projectBar) continue;
    const r = read(p);
    // pelo menos três compassos do período para ele valer no lugar do compasso do projeto
    if (r && r.bars >= 3 && (!best || r.contrast > best.contrast * 1.02)) best = r;
  }
  const none: LineMeter = { perBar: projectBar, phase: 0, strong: false, low: 1, high: 1 };
  if (!best || best.contrast < 1.15) return none;
  if (base && base.contrast >= 1.15 && (base.contrast >= best.contrast * 0.92 || projectBar % best.p === 0)) {
    if (repeats(base)) return { ...none, repeated: true };
    return { perBar: projectBar, phase: base.phase, strong: true, low: base.rest, high: base.top };
  }
  if (repeats(best)) return { ...none, perBar: best.p, repeated: true };
  return { perBar: best.p, phase: best.phase, strong: true, low: best.rest, high: best.top };
}

/**
 * Onde o 1 muda de lugar dentro da reta (compasso irregular): segue a fase do acento com Viterbi e devolve
 * a batida em que cada pedaço começa e os tempos antes do primeiro 1 dele.
 */
function linePieces(line: ClickLine, origin: number, period: number, t: number[], accents: number[], meter: LineMeter): Array<{ at: number; pickup: number }> {
  const single = [{ at: 0, pickup: meter.phase }];
  const total = Math.round((t[line.last] - origin) / period) + 1;
  if (!meter.strong || total < 3 * meter.perBar || meter.high <= meter.low) return single;
  const strength = new Array<number>(total).fill(0);
  for (let j = line.first; j <= line.last; j++) {
    const beat = (t[j] - origin) / period;
    const whole = Math.round(beat);
    if (Math.abs(beat - whole) > 0.25 || whole < 0 || whole >= total) continue;
    strength[whole] = Math.max(strength[whole], Math.min(1, Math.max(0, ((accents[j] ?? 0) - meter.low) / (meter.high - meter.low))));
  }
  const { phase } = barPhases(strength, meter.perBar);
  const pieces: Array<{ at: number; pickup: number }> = [];
  const pickupAt = (b: number) => ((phase[b] - b) % meter.perBar + meter.perBar) % meter.perBar;
  for (let b = 0; b < total; b++) {
    if (b === 0 || phase[b] !== phase[b - 1]) pieces.push({ at: b, pickup: pickupAt(b) });
  }
  return pieces.length > 1 ? pieces : single;
}

/** Dois jeitos de dividir a mesma reta põem o 1 nas mesmas batidas, das `total` da reta? */
function sameOnes(a: Array<{ at: number; pickup: number }>, b: Array<{ at: number; pickup: number }>, total: number, perBar: number): boolean {
  const oneAt = (list: Array<{ at: number; pickup: number }>, k: number) => {
    let q = 0;
    while (q + 1 < list.length && list[q + 1].at <= k) q++;
    return mod(list[q].at + list[q].pickup, perBar);
  };
  for (let k = 0; k < total; k++) if (oneAt(a, k) !== oneAt(b, k)) return false;
  return true;
}

/** Trechos do click, os intervalos em que ele toca subdivisão (meio tempo também é batida certa) e se ele tem acento. */
export function readClickHits(hits: number[], peaks: number[], duration: number, beatsPerBar = 4, timbre?: number[], shapes?: Float64Array[]): ClickRead {
  const offbeats = unevenOffbeats(hits);
  const onPulse = hits.flatMap((_, i) => (offbeats.has(i) ? [] : [i]));
  const pulseHits = onPulse.map((i) => hits[i]);
  const kept = withoutStrayHits(pulseHits).map((q) => onPulse[q]);
  const all = kept.map((i) => hits[i]);
  const empty: ClickRead = { segments: [], halfRanges: [], accented: false, pulseHits, lineTol: CLICK_LINE_TOL, coverTol: CLICK_COVER_TOL };
  if (all.length < 3) return empty;
  const allBeats = beatNumbers(all);
  const keptPeaks = kept.map((i) => peaks[i] ?? 0);
  const keptTimbre = timbre && kept.map((i) => timbre[i] ?? 0);
  // a leitura de sempre, pelo volume e pelo timbre: dela saem a grade e a fase de cada trecho
  const allBase = accentStrengths(keptPeaks, keptTimbre);
  // a leitura nova só confere: dois sons inequívocos valem mais que volume e timbre (o som do 1 pode ser o
  // mais baixo), e o volume em volta de cada ataque diz se o acento se repete no compasso
  const bySound = shapes ? soundAccents(kept.map((i) => shapes[i]), allBeats) : null;
  const allAccents = bySound ? soundWithVolume(bySound, keptPeaks) : allBase;
  const allLocal = bySound ? null : localAccentStrengths(keptPeaks, keptTimbre);

  // ruído medido na curvatura dos ataques; rampa e troca de andamento são minoria e não mexem na mediana
  const bends: number[] = [];
  for (let i = 1; i + 1 < all.length; i++) {
    if (allBeats[i] - allBeats[i - 1] === 1 && allBeats[i + 1] - allBeats[i] === 1) bends.push(Math.abs(all[i + 1] - 2 * all[i] + all[i - 1]));
  }
  const noise = Math.max(CLICK_NOISE_FLOOR, (1.4826 * medianOf(bends)) / Math.sqrt(6));
  const { lineTol: tol, coverTol } = clickTolerances(noise);
  const penalty = 4 * noise * noise * Math.log(Math.max(2, all.length));

  const allLoose = looseHits(all, allBeats, tol);
  // primeiro ataque fora da reta: a reta começa no segundo, e ele entra depois como batida própria
  const head = allLoose[0] ? 1 : 0;
  const t = all.slice(head), k = allBeats.slice(head), loose = allLoose.slice(head), pk = allAccents.slice(head);
  const pkBase = allBase.slice(head), pkLocal = allLocal?.slice(head);

  const raw = cutClickLines(t, k, loose, penalty, tol);
  // a quina que serve às duas retas é a primeira batida do trecho novo
  for (let r = 1; r < raw.length; r++) {
    const [a, b] = raw[r];
    if (a !== raw[r - 1][1] + 1) continue;
    const f = fitClickLine(t, k, loose, a, b);
    const corner = a - 1;
    if (Math.abs(t[corner] - (f.origin + f.period * (k[corner] - k[a]))) <= tol) raw[r] = [corner, b];
  }
  const pieces: Array<[number, number]> = [];
  for (const [a, b] of raw) splitWideRun(t, k, loose, a, b, tol, pieces);
  // uma reta só que passa por dois trechos vizinhos, dentro da folga, é um trecho só
  const runs: Array<[number, number]> = [];
  for (const piece of pieces) {
    const prev = runs[runs.length - 1];
    if (prev && fitClickLine(t, k, loose, prev[0], piece[1]).worst <= tol) prev[1] = piece[1];
    else runs.push([...piece]);
  }
  const lines = mergeSamePulse(runs.map(([a, b]) => {
    const f = fitClickLine(t, k, loose, a, b);
    return { first: a, last: b, period: f.period, origin: f.origin, half: false };
  }), t, loose, tol);

  const settled = lines.map((line) => ({ line, ...settleLineBpm(line, t, loose, noise) }));
  // Grade e fase saem da leitura de sempre (volume e timbre), igual para todo click. A leitura nova só marca
  // a reta: `accent` quando confirma a fase com certeza, `one` quando acha pelo som um 1 que a de sempre não
  // via. Onde ela não tem certeza (acento que se repete no compasso, as duas discordando), a fase continua a
  // de sempre e o modelo pode conferir depois.
  let held = false, sawAccent = false, unmarked = false;
  const segments: ReadSegment[] = [];
  // trecho curto demais para ter acento próprio (rall batida a batida) continua a contagem do anterior
  let counting: { start: number; beat: number; pickup: number; perBar: number } | null = null;
  // a mesma contagem na leitura nova: só passa adiante de reta com certeza
  let known: { start: number; beat: number; pickup: number; perBar: number } | null = null;
  settled.forEach(({ line, bpm, origin }, i) => {
    const beat = 60 / bpm;
    const span = (t[line.last] - t[line.first]) / beat;
    let meter = readLineMeter(line, origin, beat, t, pkBase, beatsPerBar);
    const strong = meter.strong;
    if (strong) held = true;
    else if (counting && span < 2 * counting.perBar) {
      const past = Math.round((origin - counting.start) / counting.beat);
      meter = { ...meter, perBar: counting.perBar, phase: mod(counting.pickup - past, counting.perBar) };
    }
    const own = meter.perBar !== beatsPerBar ? { beatsPerBar: meter.perBar } : {};
    const lineEnd = settled[i + 1] ? settled[i + 1].origin : duration;
    const pieces = linePieces(line, origin, beat, t, pkBase, meter);

    const fresh = readLineMeter(line, origin, beat, t, pk, beatsPerBar, pkLocal, true);
    // fase nova de cada pedaço, quando a leitura nova acha o 1 onde a de sempre não tinha acento
    let found: Array<{ at: number; pickup: number }> | null = null;
    let sure = false;
    if (strong) {
      // as duas leituras põem o 1 nas mesmas batidas da reta inteira (com as trocas de fase no mesmo lugar)
      sure = fresh.strong && fresh.perBar === meter.perBar && sameOnes(pieces, linePieces(line, origin, beat, t, pk, fresh), Math.round((t[line.last] - origin) / beat) + 1, meter.perBar);
      if (sure) sawAccent = true;
    } else if (pieces.length === 1 && fresh.strong && fresh.perBar === meter.perBar) {
      found = linePieces(line, origin, beat, t, pk, fresh);
      sawAccent = true;
    } else if (pieces.length === 1 && known && span < 2 * known.perBar && known.perBar === meter.perBar) {
      const past = Math.round((origin - known.start) / known.beat);
      found = [{ at: 0, pickup: mod(known.pickup - past, known.perBar) }];
    }
    if (!sure && !found && span >= 2 * meter.perBar) unmarked = true;

    const push = (at: number, to: number | null, pickup: number, many: boolean, mark: Partial<ReadSegment>) => {
      const startTime = origin + at * beat;
      const endTime = to !== null ? origin + to * beat : lineEnd;
      // pedaços da mesma reta guardam a fase mesmo quando ela é zero: é ela que separa um do outro
      const offset = pickup || many ? { barOffset: pickup } : {};
      segments.push({ startTime, endTime, bpm, downbeat: startTime + pickup * beat, ...offset, ...own, ...mark });
    };
    if (found) {
      // a grade fica a de sempre, dividida onde o 1 novo muda de lugar
      const [{ pickup: first }] = pieces;
      found.forEach((piece, q) => {
        const to = found![q + 1] ? found![q + 1].at : null;
        push(piece.at, to, mod(first - piece.at, meter.perBar), found!.length > 1, { accent: true, one: origin + (piece.at + piece.pickup) * beat });
      });
    } else {
      pieces.forEach((piece, q) => push(piece.at, pieces[q + 1] ? pieces[q + 1].at : null, piece.pickup, pieces.length > 1, sure ? { accent: true } : {}));
    }
    // contagem de sempre, exatamente como antes
    for (const piece of pieces) {
      counting = meter.strong || counting ? { start: origin + piece.at * beat, beat, pickup: piece.pickup, perBar: meter.perBar } : null;
    }
    const last = found ? found[found.length - 1] : pieces[pieces.length - 1];
    known = sure || found ? { start: origin + last.at * beat, beat, pickup: last.pickup, perBar: meter.perBar } : null;
  });
  const accented = sawAccent && !unmarked;

  // primeiro ataque cortado (arquivo que começa no meio do click): a grade passa por ele, no mesmo BPM
  if (head && segments.length) {
    const next = segments[0];
    const beat = 60 / next.bpm;
    const perBar = next.beatsPerBar ?? beatsPerBar;
    const miss = Math.abs(all[0] - (next.startTime - (allBeats[1] - allBeats[0]) * beat));
    if (miss > CLICK_COVER_TOL && miss <= CLICK_LEAD_MAX && all[0] < next.startTime) {
      const lead = ((next.barOffset ?? 0) + 1) % perBar;
      const own = next.beatsPerBar ? { beatsPerBar: next.beatsPerBar } : {};
      const mark: Partial<ReadSegment> = { ...(next.accent ? { accent: true } : {}), ...(next.one !== undefined ? { one: next.one } : {}) };
      segments.unshift({ startTime: all[0], endTime: next.startTime, bpm: next.bpm, downbeat: all[0] + lead * beat, ...(lead ? { barOffset: lead } : {}), ...own, ...mark });
    }
  }
  for (const s of segments) s.held = held;
  const halfRanges = settled.filter((s) => s.line.half).map((s): [number, number] => [t[s.line.first], t[s.line.last]]);
  return { segments, halfRanges, accented, pulseHits, lineTol: tol, coverTol };
}

/**
 * Trechos a partir das batidas exatas de um click: cada trecho é uma reta que passa por todas as
 * batidas dele (pausa no click não quebra a reta). O 1 vem do acento do click, quando ele tem.
 */
export function hitsToSegments(hits: number[], peaks: number[], duration: number, beatsPerBar = 4): SongTempoSegment[] {
  return readClickHits(hits, peaks, duration, beatsPerBar).segments;
}

/** Parte dos ataques a até `tol` da grade do mapa (1 = todos). Meio tempo só vale onde o click subdivide. */
export function clickCoverage(hits: number[], segments: SongTempoSegment[], tol = CLICK_COVER_TOL, halfRanges: Array<[number, number]> = []): number {
  if (!hits.length || !segments.length) return 0;
  const sorted = [...segments].sort((a, b) => a.startTime - b.startTime);
  let on = 0, s = 0;
  for (const t of [...hits].sort((a, b) => a - b)) {
    while (s + 1 < sorted.length && t >= sorted[s + 1].startTime - tol) s++;
    const seg = sorted[s];
    const beat = 60 / seg.bpm;
    const half = halfRanges.some(([a, b]) => t >= a - tol && t <= b + tol);
    const step = half ? beat / 2 : beat;
    const grid = seg.startTime + Math.max(0, Math.round((t - seg.startTime) / step)) * step;
    if (Math.abs(t - grid) <= tol) on++;
  }
  return on / hits.length;
}

/** Cobertura de cada trecho: os trechos ruins entram no aviso, e o resto do mapa continua valendo. */
export function weakClickSections(hits: number[], segments: SongTempoSegment[], tol = CLICK_COVER_TOL, halfRanges: Array<[number, number]> = []): { ranges: Array<[number, number]>; share: number } {
  const sorted = [...segments].sort((a, b) => a.startTime - b.startTime);
  if (!hits.length || !sorted.length) return { ranges: [], share: 0 };
  const list = [...hits].sort((a, b) => a - b);
  const ranges: Array<[number, number]> = [];
  let bad = 0;
  sorted.forEach((seg, i) => {
    const next = sorted[i + 1];
    const inside = list.filter((t) => (i === 0 || t >= seg.startTime - tol) && (!next || t < next.startTime - tol));
    if (!inside.length) return;
    if (clickCoverage(inside, [seg], tol, halfRanges) < WEAK_SECTION_COVERAGE) {
      bad += inside.length;
      ranges.push([inside[0], inside[inside.length - 1]]);
    }
  });
  return { ranges, share: bad / list.length };
}

/** Quanto dos ataques pode cair em trecho ruim sem o mapa inteiro ser recusado. */
export function canKeepWeakMap(weakShare: number | undefined): boolean {
  return (weakShare ?? 1) <= MAX_WEAK_SHARE;
}

export interface ClickTrackRead {
  segments: SongTempoSegment[];
  coverage?: number;
  hits?: number[];
  accented?: boolean;
  halfRanges?: Array<[number, number]>;
  lineTol?: number;
  /** Trechos em que o click não caiu na grade, e a parte dos ataques que eles somam. */
  weakRanges?: Array<[number, number]>;
  weakShare?: number;
}

/** Mapa lido do click, com a cobertura, os trechos ruins e os ataques usados para conferir. */
export function clickTrackMap(mono: Float32Array, sr: number, beatsPerBar = 4): ClickTrackRead {
  const hits = clickHits(mono, sr);
  if (hits.length >= 16) {
    const peaks = hits.map((h) => { let m = 0; for (let i = h; i < Math.min(mono.length, h + Math.round(0.03 * sr)); i++) m = Math.max(m, Math.abs(mono[i])); return m; });
    const times = hits.map((h) => h / sr);
    const read = readClickHits(times, peaks, mono.length / sr, beatsPerBar, attackTimbre(mono, hits, sr), attackShapes(mono, hits));
    if (read.segments.length) {
      const segments = extendToStart(read.segments, beatsPerBar);
      const coverage = clickCoverage(read.pulseHits, segments, read.coverTol, read.halfRanges);
      const weak = coverage < MIN_CLICK_COVERAGE ? weakClickSections(read.pulseHits, segments, read.coverTol, read.halfRanges) : { ranges: [], share: 0 };
      return { segments, coverage, hits: read.pulseHits, accented: read.accented, halfRanges: read.halfRanges, lineTol: read.lineTol, weakRanges: weak.ranges, weakShare: weak.share };
    }
  }
  const { sections } = analyzeTempoMap(mono, sr, beatsPerBar);
  const out = sections.map((s) => ({ startTime: s.firstBeat, endTime: s.end, bpm: s.bpm, downbeat: s.firstBeat }));
  for (let i = 0; i + 1 < out.length; i++) out[i].endTime = out[i + 1].startTime;
  return { segments: extendToStart(out, beatsPerBar) };
}

/**
 * Leva o mapa do click para a régua. Click sem acento e com o começo cortado não diz onde está o 1:
 * ele fica na primeira batida que toca, como a grade sempre fez. Trechos da leitura dizem isso pela marca
 * `held` (a leitura de sempre); o 1 achado pelo som (`one`) não depende dela.
 */
export function placeClickMap(segments: SongTempoSegment[], offset: number, duration: number, beatsPerBar: number, accented: boolean): SongTempoSegment[] {
  const placed = placeOnTimeline(segments, offset, duration, beatsPerBar);
  const head = placed[0] as ReadSegment | undefined;
  const keep = head && 'held' in head ? !!head.held : accented;
  if (keep || offset >= 0 || !head?.barOffset) return placed;
  const { barOffset: _unknown, ...first } = placed[0];
  return [{ ...first, downbeat: first.startTime }, ...placed.slice(1)];
}

/** Trechos só a partir do click: ataques exatos, sem precisar do modelo. */
export function clickTrackSegments(mono: Float32Array, sr: number, beatsPerBar = 4): SongTempoSegment[] {
  return clickTrackMap(mono, sr, beatsPerBar).segments;
}

export interface FinalTempoMap {
  bpm: number;
  tempoSegments?: SongTempoSegment[];
  beatsPerBar?: 3 | 4 | 6;
  downbeat?: number;
}

/**
 * Todos os trechos cabem numa reta só, com o compasso e o 1 no mesmo lugar? Com os ataques, quem decide é
 * cada ataque (o primeiro pode estar cortado). Sem eles, o BPM e a fase de cada trecho.
 */
function isOneLine(segments: SongTempoSegment[], tol: number, beatsPerBar: number, hits?: number[], halfRanges: Array<[number, number]> = []): boolean {
  const main = segments.reduce((a, b) => (b.endTime - b.startTime > a.endTime - a.startTime ? b : a));
  const period = 60 / main.bpm;
  const off = (t: number, step = period) => Math.abs(t - (main.startTime + Math.round((t - main.startTime) / step) * step));
  const mainBar = main.beatsPerBar ?? beatsPerBar;
  const barAt = (s: SongTempoSegment) => s.startTime + (s.barOffset ?? 0) * (60 / s.bpm);
  const sameLine = segments.every((s, i) => {
    if (s === main) return true;
    if ((s.beatsPerBar ?? beatsPerBar) !== mainBar) return false;
    // só compara o 1 se algum dos dois sabe onde ele está (click sem acento não diz)
    if (s.barOffset !== undefined || main.barOffset !== undefined) {
      const d = Math.round((barAt(s) - barAt(main)) / period);
      if (((d % mainBar) + mainBar) % mainBar !== 0) return false;
    }
    const beat = 60 / s.bpm;
    if (i === 0 && s.bpm === main.bpm && s.endTime - s.startTime <= beat * 1.01) return true;
    const beats = Math.max(0, Math.floor((s.endTime - s.startTime) / beat - 1e-6));
    return Math.abs(beat - period) * Math.max(1, beats) <= tol && off(s.startTime) <= tol;
  });
  if (!sameLine) return false;
  if (!hits?.length || segments.length < 2) return true;
  const list = [...hits].sort((a, b) => a - b);
  return list.every((t, i) => {
    if (i === 0) return true;
    const half = halfRanges.some(([a, b]) => t >= a - tol && t <= b + tol);
    return off(t, half ? period / 2 : period) <= tol;
  });
}

/**
 * Passo final do mapa, igual para o programa e para a prova. Com click, decide pelo erro das batidas:
 * andamento único só se uma reta passa por todas, e a grade fica na fase do click, sem placa na régua.
 */
export function finalizeTempoMap(
  segments: SongTempoSegment[],
  opts: {
    duration: number;
    beatsPerBar: number;
    isClick?: boolean;
    keepSingle?: boolean;
    /** Ataques do click na régua: com eles, só vira andamento único se todos caem na reta. */
    hits?: number[];
    halfRanges?: Array<[number, number]>;
    lineTol?: number;
  },
): FinalTempoMap | null {
  const read = (segments as ReadSegment[]).filter((s) => s.bpm > 0 && s.endTime > s.startTime).sort((a, b) => a.startTime - b.startTime);
  // a grade sai da leitura de sempre, sem as marcas; o 1 achado pelo som entra depois, sem mexer nas batidas
  const map = plainTempoMap(read.map(plainSegment), opts);
  return map && withSoundPhase(map, read, opts);
}

/**
 * O 1 que a leitura achou pelo som (`one`) copiado para o mapa final. As batidas ficam as do mapa: a grade
 * simples vira um trecho a partir do 0:00, e o andamento único é guardado em dois trechos.
 */
function withSoundPhase(map: FinalTempoMap, read: ReadSegment[], opts: { duration: number; beatsPerBar: number }): FinalTempoMap {
  const bpb = opts.beatsPerBar;
  if (!read.some((s) => s.one !== undefined && readPickup(s, bpb) !== segmentPickup(s) % segmentBar(s, bpb))) return map;
  const end = Math.max(opts.duration, read[read.length - 1].endTime);
  const targets = map.tempoSegments?.length ? map.tempoSegments : [{ startTime: 0, endTime: end, bpm: map.bpm, downbeat: 0 }];
  const copied = copyBarPhase(targets, read, bpb);
  if (!copied.changed) return map;
  const parts = copied.segments.length > 1 ? copied.segments : splitSingleSegment(copied.segments[0], bpb);
  return parts.length > 1 ? { ...map, tempoSegments: parts } : map;
}

function plainTempoMap(
  sorted: SongTempoSegment[],
  opts: {
    duration: number;
    beatsPerBar: number;
    isClick?: boolean;
    keepSingle?: boolean;
    hits?: number[];
    halfRanges?: Array<[number, number]>;
    lineTol?: number;
  },
): FinalTempoMap | null {
  if (!sorted.length) return null;
  const last = sorted[sorted.length - 1];
  sorted[sorted.length - 1] = { ...last, endTime: Math.max(opts.duration, last.endTime) };
  const changes = opts.isClick
    ? !isOneLine(sorted, opts.lineTol ?? CLICK_LINE_TOL, opts.beatsPerBar, opts.hits, opts.halfRanges)
    : realTempoChanges(sorted).length > 0;
  if (changes) return { bpm: mainBpm(sorted), tempoSegments: sorted };

  // a grade simples, a partir do 0:00, já passa pelas batidas e o 1 cai no começo?
  const fitsPlainGrid = (s: SongTempoSegment) => {
    if ((s.beatsPerBar ?? opts.beatsPerBar) !== opts.beatsPerBar) return false;
    const beat = 60 / s.bpm, bar = beat * opts.beatsPerBar;
    const firstBar = s.startTime + (s.barOffset ?? 0) * beat;
    return Math.abs(s.startTime - Math.round(s.startTime / beat) * beat) <= CLICK_WHOLE_BPM_TOL
      && Math.abs(firstBar - Math.round(firstBar / bar) * bar) <= CLICK_WHOLE_BPM_TOL;
  };
  if (opts.isClick && sorted.length > 1) {
    const main = sorted.reduce((a, b) => (b.endTime - b.startTime > a.endTime - a.startTime ? b : a));
    return fitsPlainGrid(main) ? { bpm: main.bpm } : { bpm: main.bpm, tempoSegments: sorted };
  }
  // a fase é a do trecho maior: o trecho de uma batida colado no 0:00 só marca onde o arquivo começa
  const main = sorted.reduce((a, b) => (b.endTime - b.startTime > a.endTime - a.startTime ? b : a));
  const whole = { ...main, endTime: sorted[sorted.length - 1].endTime };
  if (opts.isClick && fitsPlainGrid(whole)) return { bpm: whole.bpm };
  // sem click, a fase medida no áudio vale, menos no caminho que pede o BPM único (VS por IA)
  if (!opts.isClick && opts.keepSingle === false) return { bpm: whole.bpm };
  // a reta do trecho maior volta até o começo da música, com a batida colada no 0:00 se houver
  const placed = opts.isClick ? [whole] : extendToStart([whole], opts.beatsPerBar);
  const head = placed[placed.length - 1], stub = placed.slice(0, -1);
  const parts = splitSingleSegment(head, opts.beatsPerBar);
  return parts.length > 1 || stub.length ? { bpm: whole.bpm, tempoSegments: [...stub, ...parts] } : { bpm: whole.bpm };
}

/** Trecho de uma batida só, no mesmo andamento do seguinte: o que extendToStart cola no começo do arquivo. */
function isStartBeat(first: SongTempoSegment, next: SongTempoSegment): boolean {
  return first.bpm === next.bpm && first.endTime - first.startTime <= (60 / first.bpm) * 1.01;
}

/** Assinatura do mapa: se mudou desde a medição, alguém editou à mão. Conta o 1 e o compasso de cada trecho. */
export function tempoMapSignature(segments: SongTempoSegment[] | undefined): string {
  return (segments ?? []).map((s) => `${s.startTime.toFixed(3)}:${s.bpm.toFixed(3)}:${s.barOffset ?? 0}:${s.beatsPerBar ?? 0}`).join('|');
}

/** Assinatura que as versões anteriores gravavam (só início e BPM). */
function oldTempoMapSignature(segments: SongTempoSegment[] | undefined): string {
  return (segments ?? []).map((s) => `${s.startTime.toFixed(3)}:${s.bpm.toFixed(3)}`).join('|');
}

/** Identidade do mapa que a pessoa recusou: BPM e assinatura. Fica gravada na própria música. */
export function tempoKeepKey(song: Pick<Song, 'bpm' | 'tempoSegments'>): string {
  return `${song.bpm}@${tempoMapSignature(song.tempoSegments)}`;
}

/** Distância de cada ataque até a grade (batida ou meio tempo; em grade certa, até subdivisão inteira). */
export function hitGridErrors(song: Pick<Song, 'bpm' | 'beatsPerBar' | 'tempoSegments'>, hits: number[], duration: number, tol = 0.01): number[] {
  if (!hits.length) return [];
  const grid = clickGridTimes(song, duration + 1).sort((a, b) => a - b);
  if (!grid.length) return hits.map(() => Infinity);
  const list = [...hits].sort((a, b) => a - b);
  const nearest: number[] = [];
  let g = 0;
  for (const t of list) {
    while (g + 1 < grid.length && Math.abs(grid[g + 1] - t) <= Math.abs(grid[g] - t)) g++;
    nearest.push(g);
  }
  const toStep = (t: number, at: number, parts: number) => {
    const from = t >= grid[at] ? at : at - 1;
    const a = grid[Math.max(0, from)], b = grid[Math.min(grid.length - 1, from + 1)];
    const size = b - a;
    if (size <= 0) return Math.abs(t - grid[at]);
    return Math.abs(t - (a + (Math.round(((t - a) / size) * parts) / parts) * size));
  };
  const at = (parts: number) => list.map((t, i) => toStep(t, nearest[i], parts));
  const offCount = (list2: number[]) => list2.filter((d) => d > tol).length;
  const base = at(2);
  if (offCount(base) / list.length <= 0.1) return base;
  // click em tercina ou semicolcheia: a grade está certa se toda batida dela cai num ataque
  let covered = 0, total = 0, h = 0;
  for (const beat of grid) {
    if (beat < list[0] - tol || beat > list[list.length - 1] + tol) continue;
    total++;
    while (h + 1 < list.length && Math.abs(list[h + 1] - beat) <= Math.abs(list[h] - beat)) h++;
    if (Math.abs(list[h] - beat) <= tol) covered++;
  }
  if (!total || covered / total < 0.98) return base;
  let best = base;
  for (const parts of [3, 4, 6]) {
    const now = at(parts);
    if (offCount(now) < offCount(best)) best = now;
  }
  return best;
}

/** Parte dos ataques a mais de `tol` da grade atual da música. */
export function mapOffShare(song: Pick<Song, 'bpm' | 'beatsPerBar' | 'tempoSegments'>, hits: number[], duration: number, tol = 0.01): number {
  if (!hits.length) return 0;
  const errors = hitGridErrors(song, hits, duration, tol);
  return errors.filter((d) => d > tol).length / hits.length;
}

/** Mapa salvo pode ser trocado pela leitura do click? Manual, REAPER e MIDI nunca, nem o que a pessoa já recusou. */
export function canReplaceTempoMap(song: Pick<Song, 'bpmSource' | 'tempoSegments' | 'tempoMapSource' | 'tempoMapSig' | 'tempoMapKept'> & { bpm?: number }): boolean {
  const source = song.tempoMapSource;
  if (source === 'manual' || source === 'reaper' || source === 'midi') return false;
  // BPM digitado, marcado na régua ou vindo do REAPER (é o que os projetos antigos registram)
  if (song.bpmSource === 'manual') return false;
  if (song.tempoMapKept && song.bpm !== undefined && song.tempoMapKept === tempoKeepKey({ bpm: song.bpm, tempoSegments: song.tempoSegments })) return false;
  if (!source) return true;
  return song.tempoMapSig === tempoMapSignature(song.tempoSegments) || song.tempoMapSig === oldTempoMapSignature(song.tempoSegments);
}

/**
 * Decide a troca de um mapa salvo: a leitura nova precisa passar na cobertura e explicar os ataques, e a
 * grade salva precisa errar claramente mais (muitos ataques fora, ou erro mediano ou máximo bem maior).
 */
export function shouldReplaceTempoMap(
  song: Pick<Song, 'bpm' | 'beatsPerBar' | 'tempoSegments' | 'bpmSource' | 'tempoMapSource' | 'tempoMapSig' | 'tempoMapKept' | 'duration'>,
  hits: number[],
  next: { map: FinalTempoMap | null; coverage?: number },
): boolean {
  if (!next.map || !canReplaceTempoMap(song) || !hits.length) return false;
  if ((next.coverage ?? 0) < MIN_CLICK_COVERAGE) return false;
  const candidate = { bpm: next.map.bpm, beatsPerBar: song.beatsPerBar, tempoSegments: next.map.tempoSegments };
  if (mapOffShare(candidate, hits, song.duration) > 0.02) return false;
  if (mapOffShare(song, hits, song.duration) > 0.1) return true;
  const stats = (s: Pick<Song, 'bpm' | 'beatsPerBar' | 'tempoSegments'>) => {
    const e = hitGridErrors(s, hits, song.duration).sort((a, b) => a - b);
    return { max: e[e.length - 1], median: e[(e.length - 1) >> 1] };
  };
  const now = stats(song), fresh = stats(candidate);
  return (now.max >= 0.008 && fresh.max <= now.max * 0.5) || (now.median >= 0.002 && fresh.median <= now.median * 0.5);
}

/** O algoritmo que as versões antigas usavam para ler o click: serve só para reconhecer um mapa salvo por ele. */
function oldClickRuns(hits: number[]): Array<{ start: number; bpm: number }> {
  const runs: Array<{ a: number; b: number; period: number }> = [];
  for (let i = 0; i + 8 < hits.length;) {
    const near = hits.slice(i + 1, i + 9).map((t, k) => t - hits[i + k]).sort((x, y) => x - y);
    let period = near[near.length >> 1], j = i;
    for (let n = i + 1; n < hits.length; n++) {
      const k = Math.round((hits[n] - hits[i]) / period);
      if (k < 1 || Math.abs(hits[n] - (hits[i] + k * period)) > 0.012) break;
      if (k >= 8) period = (hits[n] - hits[i]) / k;
      j = n;
    }
    if (j - i < 8) { i = Math.max(i + 1, j); continue; }
    runs.push({ a: i, b: j, period });
    i = j + 1;
  }
  const merged: typeof runs = [];
  for (const r of runs) {
    const last = merged[merged.length - 1];
    const k = last ? Math.round((hits[r.a] - hits[last.a]) / last.period) : 0;
    if (last && Math.abs(60 / r.period - 60 / last.period) < 0.05 && Math.abs(hits[r.a] - (hits[last.a] + k * last.period)) <= 0.012) last.b = r.b;
    else merged.push({ ...r });
  }
  return merged.map((r) => {
    const bpm = 60 / r.period, whole = Math.round(bpm);
    return { start: hits[r.a], bpm: Math.abs(bpm - whole) < 0.03 ? whole : Math.round(bpm * 100) / 100 };
  });
}

/**
 * Mapa antigo, sem registro de origem: a versão anterior não marcava o ajuste à mão de uma placa. Só é
 * automático se for igual ao que o algoritmo antigo gera destes ataques.
 */
export function oldMapLooksEdited(song: Pick<Song, 'tempoSegments' | 'tempoMapSource'>, hits: number[]): boolean {
  const segs = song.tempoSegments;
  if (song.tempoMapSource || !segs || segs.length < 2) return false;
  const sorted = [...segs].sort((a, b) => a.startTime - b.startTime);
  const old = oldClickRuns([...hits].sort((a, b) => a - b));
  if (old.length !== sorted.length) return true;
  // o primeiro trecho foi levado até o 0:00: dele só o BPM é comparado
  return sorted.some((s, i) => Math.abs(s.bpm - old[i].bpm) > 0.02 || (i > 0 && Math.abs(s.startTime - old[i].start) > 0.015));
}

/**
 * Onde o mapa muda de verdade: BPM diferente, ou a batida salta de lugar no mesmo BPM (duas músicas
 * de andamento igual emendadas). Devolve os índices dos trechos que começam uma mudança.
 */
export function realTempoChanges(segments: SongTempoSegment[], minBpm = 0.3, maxJump = 0.035): number[] {
  const out: number[] = [];
  for (let i = 1; i < segments.length; i++) {
    const a = segments[i - 1], b = segments[i];
    if (Math.abs(a.bpm - b.bpm) >= minBpm) { out.push(i); continue; }
    const p = 60 / a.bpm;
    // BPM quase igual, mas uma grade só escorregaria mais que a folga dentro do trecho menor: é troca
    const shorter = Math.min(a.endTime - a.startTime, b.endTime - b.startTime);
    if (Math.abs(p - 60 / b.bpm) * (shorter / p) > maxJump) { out.push(i); continue; }
    const k = Math.round((b.startTime - a.startTime) / p);
    if (Math.abs(b.startTime - (a.startTime + k * p)) > maxJump) out.push(i);
  }
  return out;
}

/** BPM que representa a música: o que vale por mais tempo. */
export function mainBpm(segments: SongTempoSegment[]): number {
  const byBpm = new Map<number, number>();
  for (const s of segments) byBpm.set(s.bpm, (byBpm.get(s.bpm) ?? 0) + (s.endTime - s.startTime));
  let top = 0, longest = -Infinity;
  for (const [bpm, length] of byBpm) if (length > longest) { longest = length; top = bpm; }
  return top;
}

/**
 * A banda saiu da grade? Olha o desvio mediano a cada 8 batidas: parada ou virada desviam uma batida
 * solta e a mediana não se mexe; andamento que escorrega desloca a janela inteira.
 */
function drifts(peaks: number[], origin: number, period: number, maxShare: number): boolean {
  if (peaks.length < 16) return false;
  // o modelo às vezes marca o contratempo por uns compassos: meio tempo exato ainda é a mesma grade
  const half = period / 2;
  const raw = peaks.map((t) => t - (origin + Math.round((t - origin) / half) * half));
  // desvio constante é só o modelo marcando um pouco antes ou depois do ataque: não é a banda saindo da grade
  const center = [...raw].sort((a, b) => a - b)[raw.length >> 1];
  const off = raw.map((v) => v - center);
  let bad = 0;
  let total = 0;
  for (let i = 0; i + 8 <= off.length; i += 4) {
    const w = off.slice(i, i + 8).sort((a, b) => a - b);
    total++;
    if (Math.abs(w[4]) > 0.035) bad++;
  }
  return bad / Math.max(1, total) > maxShare;
}

/**
 * A banda oscila em volta do andamento? Mede o período local em janelas de 8 batidas: batida marcada
 * em tempos alternados ou no contratempo não muda o período, e andamento que escorrega muda.
 */
function wanders(peaks: number[], period: number, maxShare: number): boolean {
  if (peaks.length < 16) return false;
  let off = 0, total = 0;
  for (let i = 0; i + 8 < peaks.length; i += 2) {
    const span = peaks[i + 8] - peaks[i];
    const beats = Math.round(span / period);
    if (beats < 4) continue;
    total++;
    if (Math.abs(span / beats / period - 1) > 0.015) off++;
  }
  return total > 0 && off / total > maxShare;
}

// Ritardando no final, sem click. Os ataques sozinhos não provam nada: num fim de música quase qualquer
// curva acha ataques. Por isso a decisão pede três sinais independentes, nesta ordem: as batidas do modelo
// escorregam da grade e não voltam, o período que se repete no fim é mais longo, e os ataques caem na curva
// bem melhor do que na grade reta. Faltando um deles, fica o andamento anterior.

/** Ativação mínima para o pico do modelo contar. */
const RIT_PEAK = 0.3;
/** Pico a até isto da grade ainda está no andamento (o modelo marca de 20 em 20 ms). */
const RIT_ON_GRID = 0.022;
/** A partir disto o pico está atrasado: sem faixa morta entre os dois, a primeira batida do rall conta. */
const RIT_LATE = 0.022;
/** Quanto o atraso pode recuar de um pico para o outro sem deixar de ser desaceleração. */
const RIT_BACKSTEP = 0.05;
/** Atraso que o último pico precisa ter. */
const RIT_MIN_FINAL_LAG = 0.09;
/** Picos atrasados seguidos, até o fim da música. */
const RIT_MIN_LATE_PEAKS = 4;
/** Autocorrelação mínima do período final. */
const RIT_MIN_REPEAT = 0.15;
/** Os ataques na curva precisam valer isto vezes os ataques na grade reta. */
const RIT_OVER_GRID = 1.25;
/** E pelo menos esta parte do ataque típico da música. */
const RIT_OVER_BODY = 0.45;

interface RitFlux { e: Float32Array; t0: number; fps: number }

/** Último instante com música soando: nível acima de 8% do trecho forte (a cauda do acorde final conta). */
function musicEndTime(mono: Float32Array, sr: number, from: number): number {
  const hop = Math.round(0.05 * sr);
  const start = Math.max(0, Math.round(from * sr));
  const rms: number[] = [];
  for (let i = start; i + hop < mono.length; i += hop) {
    let sum = 0;
    for (let k = i; k < i + hop; k++) sum += mono[k] * mono[k];
    rms.push(Math.sqrt(sum / hop));
  }
  const sorted = [...rms].sort((a, b) => a - b);
  const floor = (sorted[Math.floor(sorted.length * 0.9)] || 0) * 0.08;
  let last = rms.length - 1;
  while (last > 0 && rms[last] < floor) last--;
  return (start + last * hop) / sr;
}

function strongModelPeaks(beat: Float32Array, fps: number, from: number, to: number): number[] {
  const out: number[] = [];
  const end = Math.min(beat.length - 3, Math.round(to * fps));
  for (let i = Math.max(3, Math.round(from * fps)); i < end; i++) {
    if (beat[i] < RIT_PEAK) continue;
    let top = true;
    for (let k = i - 3; k <= i + 3; k++) if (beat[k] > beat[i]) top = false;
    if (top) out.push(i / fps);
  }
  return out;
}

/** Último pico ainda na grade, com os picos seguintes atrasando até o fim. Sem isso, não há ritardando. */
function lateModelPeaks(model: BeatModel, seg: SongTempoSegment, end: number): { ground: number; lastPeak: number; lags: Array<{ t: number; lag: number }> } | null {
  const p = 60 / seg.bpm;
  const dev = (t: number) => t - (seg.startTime + Math.round((t - seg.startTime) / p) * p);
  const body = strongModelPeaks(model.beat, model.fps, Math.max(seg.startTime, end - 50), end - 14).map(dev).sort((a, b) => a - b);
  if (body.length < 8) return null;
  const center = body[body.length >> 1];
  const list = strongModelPeaks(model.beat, model.fps, Math.max(seg.startTime, end - 16), end + 0.3);
  if (list.length < RIT_MIN_LATE_PEAKS + 1) return null;
  let ground = -1;
  for (let i = list.length - 1; i >= 0; i--) {
    if (Math.abs(dev(list[i]) - center) <= RIT_ON_GRID) { ground = i; break; }
  }
  if (ground < 0 || ground > list.length - RIT_MIN_LATE_PEAKS - 1) return null;
  // o atraso pode passar de meio pulso: conta a partir do pico anterior
  const lags: Array<{ t: number; lag: number }> = [];
  let prev = 0;
  for (let i = ground + 1; i < list.length; i++) {
    let lag = dev(list[i]) - center;
    while (lag - prev > p / 2) lag -= p;
    while (lag - prev < -p / 2) lag += p;
    if (lag < RIT_LATE || (lags.length && lag < prev - RIT_BACKSTEP)) return null;
    lags.push({ t: list[i], lag });
    prev = lag;
  }
  if (lags.length < RIT_MIN_LATE_PEAKS || prev < RIT_MIN_FINAL_LAG) return null;
  return { ground: list[ground], lastPeak: list[list.length - 1], lags };
}

/**
 * Ataques de nota na faixa de 200 a 2000 Hz, onde piano, violão e voz atacam mesmo sem bateria.
 * Compara com o quadro de antes aceitando a banda vizinha, para vibrato não contar como ataque.
 */
function noteAttackFlux(mono: Float32Array, sr: number, from: number, to: number): RitFlux {
  const size = 1024, hop = Math.max(1, Math.round(sr / 200)), lag = 2, perOctave = 12, lowHz = 200, highHz = 2000;
  const start = Math.max(0, Math.round(from * sr));
  const frames = Math.max(0, Math.floor((Math.min(mono.length, Math.round(to * sr)) - start - size) / hop));
  const hann = new Float64Array(size);
  for (let i = 0; i < size; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size);
  const bands = Math.ceil(Math.log2(highHz / lowHz) * perOctave);
  const bandOf = new Int16Array(size / 2 + 1).fill(-1);
  for (let k = 1; k <= size / 2; k++) {
    const hz = (k * sr) / size;
    if (hz >= lowHz && hz < highHz) bandOf[k] = Math.floor(Math.log2(hz / lowHz) * perOctave);
  }
  const spectra: Float32Array[] = [];
  const re = new Float64Array(size), im = new Float64Array(size);
  for (let f = 0; f < frames; f++) {
    const at = start + f * hop;
    for (let i = 0; i < size; i++) { re[i] = mono[at + i] * hann[i]; im[i] = 0; }
    fft(re, im);
    const band = new Float32Array(bands);
    for (let k = 1; k <= size / 2; k++) {
      const b = bandOf[k];
      if (b < 0) continue;
      const m = Math.hypot(re[k], im[k]);
      if (m > band[b]) band[b] = m;
    }
    for (let b = 0; b < bands; b++) band[b] = Math.log1p(100 * band[b]);
    spectra.push(band);
  }
  const flux = new Float32Array(frames);
  for (let f = lag; f < frames; f++) {
    const was = spectra[f - lag], now = spectra[f];
    let sum = 0;
    for (let b = 0; b < bands; b++) {
      let ref = was[b];
      if (b > 0 && was[b - 1] > ref) ref = was[b - 1];
      if (b + 1 < bands && was[b + 1] > ref) ref = was[b + 1];
      if (now[b] > ref) sum += now[b] - ref;
    }
    flux[f] = sum;
  }
  // tira a média local: trecho alto e trecho baixo pesam igual
  const reach = Math.round((0.25 * sr) / hop);
  const out = new Float32Array(frames);
  let sum = 0;
  for (let i = 0; i < frames; i++) {
    sum += flux[i];
    if (i > 2 * reach) sum -= flux[i - 2 * reach - 1];
    const c = i - reach;
    if (c >= 0) out[c] = Math.max(0, flux[c] - sum / Math.min(i + 1, 2 * reach + 1));
  }
  return { e: out, t0: start / sr + size / 2 / sr, fps: sr / hop };
}

/** Em cada quadro, o ataque mais forte a até `reach` segundos, valendo menos quanto mais longe. */
function nearestAttack(flux: RitFlux, reach: number): RitFlux {
  const r = Math.round(reach * flux.fps), n = flux.e.length;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let top = 0;
    for (let k = Math.max(0, i - r); k <= Math.min(n - 1, i + r); k++) {
      const v = flux.e[k] * (1 - Math.abs(k - i) / (r + 1));
      if (v > top) top = v;
    }
    out[i] = top;
  }
  return { e: out, t0: flux.t0, fps: flux.fps };
}

/** Período que mais se repete entre `from` e `to`, entre 1,06 e 1,55 do pulso (o fim ficou mais lento). */
function slowerPeriod(flux: RitFlux, pulse: number, from: number, to: number): { period: number; value: number } {
  const a = Math.max(2, Math.round((from - flux.t0) * flux.fps));
  const b = Math.min(flux.e.length - 3, Math.round((to - flux.t0) * flux.fps));
  const n = b - a;
  if (n < 20) return { period: 0, value: 0 };
  const e = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const j = a + i;
    e[i] = (flux.e[j - 2] + 2 * flux.e[j - 1] + 3 * flux.e[j] + 2 * flux.e[j + 1] + flux.e[j + 2]) / 9;
  }
  let mean = 0;
  for (const v of e) mean += v;
  mean /= n;
  let energy = 0;
  for (const v of e) energy += (v - mean) * (v - mean);
  if (energy <= 0) return { period: 0, value: 0 };
  const lo = Math.round(1.06 * pulse * flux.fps), hi = Math.round(1.55 * pulse * flux.fps);
  let best = 0, value = -1;
  for (let lag = lo; lag <= hi && lag < n - 4; lag++) {
    let sum = 0;
    for (let i = 0; i < n - lag; i++) sum += (e[i] - mean) * (e[i + lag] - mean);
    const v = sum / ((energy * (n - lag)) / n);
    if (v > value) { value = v; best = lag; }
  }
  return { period: best / flux.fps, value };
}

/** Até onde o fim de cada compasso do rall pode estar da curva. */
const RIT_BAR_REACH = 0.03;
/** Passo da busca do fim de compasso. */
const RIT_BAR_STEP = 0.002;
/** Largura do ataque na conta do compasso. */
const RIT_SHARP = 0.012;

/**
 * Onde termina cada compasso do rall. Um ataque sozinho erra dezenas de ms; o compasso inteiro, com o
 * andamento constante dentro dele, não. O fim de cada compasso é o que põe mais ataque em cima das
 * batidas dele, e a curva só diz onde procurar.
 */
function ritBarEnds(flux: RitFlux, start: number, curve: number[], perBar: number): number[] {
  const sharp = nearestAttack(flux, RIT_SHARP);
  const value = (t: number) => {
    const i = Math.round((t - sharp.t0) * sharp.fps);
    return i >= 0 && i < sharp.e.length ? sharp.e[i] : 0;
  };
  const bars = Math.ceil(curve.length / perBar);
  const span = Math.round(RIT_BAR_REACH / RIT_BAR_STEP);
  const out = new Array<number>(bars);
  let from = start;
  for (let b = 0; b < bars; b++) {
    const stop = Math.min(curve.length, (b + 1) * perBar), n = stop - b * perBar, guess = curve[stop - 1];
    // o último fim fica na curva: no acorde final o ataque espalha e a medida solta erra para os dois lados
    let end = guess;
    if (b < bars - 1) {
      let top = -Infinity;
      for (let s = -span; s <= span; s++) {
        const candidate = guess + s * RIT_BAR_STEP, beat = (candidate - from) / n;
        let sum = 0;
        for (let k = 1; k <= n; k++) sum += value(from + k * beat);
        if (sum > top) { top = sum; end = candidate; }
      }
    }
    out[b] = end;
    from = end;
  }
  return out;
}

/**
 * Música que desacelera nos últimos compassos: troca o fim do último trecho por um trecho por compasso,
 * com o período crescendo. Fade, nota longa ou fermata não têm os três sinais e ficam como estavam.
 */
export function followEndingRit(mono: Float32Array, sr: number, model: BeatModel, segments: SongTempoSegment[], beatsPerBar: number): SongTempoSegment[] {
  if (!segments.length) return segments;
  const seg = segments[segments.length - 1];
  const duration = mono.length / sr;
  const p = 60 / seg.bpm;
  const end = musicEndTime(mono, sr, Math.max(0, duration - 60));
  const late = lateModelPeaks(model, seg, end);
  if (!late) return segments;

  const from = Math.max(seg.startTime, end - 46);
  const flux = noteAttackFlux(mono, sr, from, Math.min(duration, end + 1.5));
  const attack = nearestAttack(flux, 0.035);
  const value = (t: number) => {
    const i = Math.round((t - attack.t0) * attack.fps);
    return i >= 0 && i < attack.e.length ? attack.e[i] : 0;
  };
  const onGrid = (t: number) => seg.startTime + Math.round((t - seg.startTime) / p) * p;
  const start = onGrid(late.ground);
  if (start <= seg.startTime + p) return segments;

  // o modelo pode marcar mais um ou dois pulsos na cauda do acorde final: vale a janela mais clara
  let repeat = { period: 0, value: -1 };
  for (const { t } of late.lags.slice(-3)) {
    const r = slowerPeriod(flux, p, t - 2.4, t + 0.2);
    if (r.value > repeat.value) repeat = r;
  }
  if (repeat.value < RIT_MIN_REPEAT || repeat.period < 1.06 * p) return segments;

  const perBar = seg.beatsPerBar ?? beatsPerBar;
  // quanto o período cresce a cada batida: só perto do que o período final mediu, em compassos inteiros
  let best: { mean: number; growth: number; beats: number } | null = null;
  for (let bars = 1; bars <= 4; bars++) {
    const beats = perBar * bars;
    const center = (repeat.period / p - 1) / beats;
    for (let growth = Math.max(0.012, center * 0.8); growth <= Math.min(0.09, center * 1.35); growth += 0.0005) {
      let t = start, sum = 0;
      for (let k = 1; k <= beats; k++) { t += p * (1 + growth * k); sum += value(t); }
      // a curva termina perto do último pico; o modelo pode marcar mais um pulso na cauda do acorde final
      if (t > late.lastPeak + 0.1 || t < late.lastPeak - 1.3) continue;
      if (!best || sum / beats > best.mean) best = { mean: sum / beats, growth, beats };
    }
  }
  if (!best) return segments;

  const curve: number[] = [];
  let flat = 0;
  for (let k = 1, t = start; k <= best.beats; k++) {
    t += p * (1 + best.growth * k);
    curve.push(t);
    flat += value(start + k * p);
  }
  flat /= best.beats;
  let body = 0, bodyCount = 0;
  for (let t = onGrid(Math.max(from, end - 40)); t < start - p; t += p) { body += value(t); bodyCount++; }
  body = bodyCount ? body / bodyCount : 0;
  if (best.mean < RIT_OVER_GRID * flat || best.mean < RIT_OVER_BODY * body) return segments;

  // a curva diz onde procurar; o fim de cada compasso vem dos ataques
  const barEnds = ritBarEnds(flux, start, curve, perBar);
  // um andamento por compasso, com o 1 no mesmo lugar da contagem que vinha
  const firstBar = seg.downbeat ?? seg.startTime;
  const place = ((Math.round((start - firstBar) / p) % perBar) + perBar) % perBar;
  const pickup = place ? perBar - place : 0;
  const meter = seg.beatsPerBar ? { beatsPerBar: seg.beatsPerBar } : {};
  const bars: SongTempoSegment[] = [];
  let at = start;
  for (let b = 0; b * perBar < best.beats; b++) {
    const first = b * perBar, last = Math.min(best.beats, first + perBar);
    const bpm = Math.round(((60 * (last - first)) / (barEnds[b] - at)) * 100) / 100;
    const beat = 60 / bpm;
    const length = (last - first) * beat;
    bars.push({ startTime: at, endTime: at + length, bpm, downbeat: at + pickup * beat, ...(pickup ? { barOffset: pickup } : {}), ...meter, rit: true });
    at += length;
  }
  bars[bars.length - 1].endTime = Math.max(duration, bars[bars.length - 1].endTime);
  return [...segments.slice(0, -1), { ...seg, endTime: start }, ...bars];
}

/**
 * VS por IA, música de um andamento com ritardando final: a entrada já pôs o 1 numa cabeça de compasso,
 * então a grade vai direto do 0:00 até o ritardando, sem emenda nenhuma no meio da contagem.
 */
export function plainGridBeforeRit(segments: SongTempoSegment[]): SongTempoSegment[] {
  const first = segments.findIndex((s) => s.rit);
  if (first < 1) return segments;
  const body = segments.slice(0, first).reduce((a, b) => (b.endTime - b.startTime > a.endTime - a.startTime ? b : a));
  const meter = body.beatsPerBar ? { beatsPerBar: body.beatsPerBar } : {};
  return [{ startTime: 0, endTime: segments[first].startTime, bpm: body.bpm, downbeat: 0, ...meter }, ...segments.slice(first)];
}

/** O mapa só muda no ritardando final? Então é uma música de um andamento, não um medley. */
export function isFinalRitOnly(segments: SongTempoSegment[]): boolean {
  const changes = realTempoChanges(segments);
  return changes.length > 0 && changes.every((i) => segments[i].rit === true);
}

/**
 * Mapa final da faixa. Onde o andamento é fixo, vale a grade exata do trecho (BPM cravado, sem o
 * tremor de batida a batida). Só onde a banda oscila e a grade não acompanha, a batida é seguida.
 */
export function buildTempoSegments(mono: Float32Array, sr: number, model: BeatModel, beatsPerBar = 4, maxDriftShare = 0.3): { segments: SongTempoSegment[]; coverage: number } {
  const duration = mono.length / sr;
  const { sections } = analyzeTempoMap(mono, sr, beatsPerBar, model);
  const peaks = activationPeaks(model.beat, model.fps);
  let followed: FollowedBeats | null = null;
  const out: SongTempoSegment[] = [];
  for (const s of sections) {
    const p = 60 / s.bpm;
    // as pontas ficam de fora: perto da troca ainda pode soar a música vizinha
    const inside = peaks.filter((t) => t >= s.start + 7 && t < s.end - 7);
    if (drifts(inside, s.firstBeat, p, maxDriftShare) && wanders(inside, p, maxDriftShare)) {
      followed ??= followBeats(mono, sr, model.beat, model.downbeat, model.fps, beatsPerBar);
      const f = followed;
      const keep = f.downbeats.filter((i) => f.beats[i] >= s.start && f.beats[i] < s.end);
      const part = beatsToSegments({ ...f, downbeats: keep }, s.end);
      // quem oscila fica perto do andamento do trecho: BPM muito longe é o seguidor perdido, e a reta vale
      if (part.length && part.every((x) => Math.abs(x.bpm / s.bpm - 1) <= 0.1)) {
        out.push(...part);
        continue;
      }
    }
    const start = s.firstBeat + s.barPhase * p;
    // tempos antes do primeiro 1: anacruse do mesmo trecho, para o anterior não invadir a música nova
    const meter = s.beatsPerBar ? { beatsPerBar: s.beatsPerBar } : {};
    if (s.barPhase > 0 && out.length) out.push({ startTime: s.firstBeat, endTime: s.end, bpm: s.bpm, downbeat: start, barOffset: s.barPhase, ...meter });
    else out.push({ startTime: start, endTime: s.end, bpm: s.bpm, downbeat: start, ...meter });
  }
  out.sort((a, b) => a.startTime - b.startTime);
  for (let i = 0; i < out.length; i++) out[i].endTime = i + 1 < out.length ? out[i + 1].startTime : Math.max(duration, out[i].endTime);
  const segments = extendToStart(followEndingRit(mono, sr, model, out, beatsPerBar), beatsPerBar);
  return { segments, coverage: mapCoverage(segments, peaks) };
}

/**
 * Parte da faixa em que um BPM único continua na fase. Em janelas de 16 batidas, mede onde o ataque
 * cai na grade: andamento fixo deixa esse ponto parado, e andamento que muda faz ele andar.
 */
export function singleGridShare(mono: Float32Array, sr: number, bpm: number): number {
  const { env } = onsetEnvelope(mono, sr);
  const fps = sr / Math.max(1, Math.round(sr / 200));
  const beat = 60 / bpm, frames = beat * fps, R = Math.floor(frames / 2);
  const windows: Array<{ level: number; offset: number | null }> = [];
  for (let w = 0; (w + 16) * frames < env.length; w += 8) {
    const profile = new Float64Array(2 * R + 1);
    for (let k = w; k < w + 16; k++) {
      const c = Math.round(k * frames);
      for (let o = -R; o <= R; o++) if (c + o >= 0 && c + o < env.length) profile[o + R] += env[c + o];
    }
    let top = 0, sum = 0;
    for (let i = 0; i <= 2 * R; i++) { sum += profile[i]; if (profile[i] > profile[top]) top = i; }
    // sem pico claro a grade não passa pelos ataques dessa janela
    windows.push({ level: sum, offset: profile[top] >= 1.5 * (sum / (2 * R + 1)) ? (top - R) / fps : null });
  }
  // janela quase sem som (introdução, parada) não diz nada
  const levels = windows.map((w) => w.level).sort((x, y) => x - y);
  const floor = (levels[levels.length >> 1] ?? 0) * 0.3;
  const heard = windows.filter((w) => w.level >= floor);
  const offsets = heard.flatMap((w) => (w.offset === null ? [] : [w.offset]));
  if (heard.length < 4) return 1;
  const near = (a: number, b: number) => { const d = Math.abs(a - b) % beat; return Math.min(d, beat - d) <= 0.035; };
  let best = 0;
  for (const c of offsets) best = Math.max(best, offsets.filter((v) => near(v, c)).length);
  return best / heard.length;
}

/** Abaixo disto o BPM único não descreve a faixa: gravar o click nele seria gravar click errado. */
export const MIN_SINGLE_GRID_SHARE = 0.62;

/** A partir desta duração a faixa passa pelo mapa de andamento (abaixo disto ele nem é tentado). */
export const MIN_TEMPO_MAP_SEC = 30;

/**
 * VS por IA: faltou o mapa e o click não pode ser gravado? Sem o mapa não há como conferir o BPM: o
 * detector simples erra em razão com o real (116 no lugar de 174, 70 no lugar de 140) e a fase segue
 * estável, então nenhuma conferência de fase pega. Click errado no show é pior que click nenhum.
 */
export function clickNeedsTempoMap(duration: number, hasMap: boolean): boolean {
  return duration >= MIN_TEMPO_MAP_SEC && !hasMap;
}

/** Batida até esta distância antes do 0:00 do arquivo conta como a batida do próprio começo. */
const FILE_START_BEAT = 0.03;

/** Até onde a entrada do áudio pode estar da batida medida e ainda ser a própria batida (o ruído da medida). */
const FIRST_SOUND_REACH = 0.003;

/**
 * Faixa exportada com silêncio antes: quando o áudio entra em cima de uma batida medida, dentro do
 * ruído da medida, a entrada é a batida exata. Entrada mais longe é só um gate abrindo fora do tempo,
 * e a fase continua a medida nos ataques da música inteira.
 */
export function anchorOnFirstSound(segments: SongTempoSegment[], soundAt: number): SongTempoSegment[] {
  if (!segments.length) return segments;
  const first = segments[0];
  const beat = 60 / first.bpm;
  const near = first.startTime + Math.round((soundAt - first.startTime) / beat) * beat;
  const shift = soundAt - near;
  if (shift === 0 || Math.abs(shift) > FIRST_SOUND_REACH) return segments;
  return segments.map((s) => ({ ...s, startTime: s.startTime + shift, endTime: s.endTime + shift, downbeat: (s.downbeat ?? s.startTime) + shift }));
}

/**
 * Tira o trecho de uma batida só que extendToStart cola no 0:00 do arquivo. No VS por IA a música
 * ganha uma entrada, então o começo do arquivo não é mais o começo da régua: a fase vem do trecho de
 * verdade, senão a grade inteira andaria até 30 ms.
 */
export function dropStartStub(segments: SongTempoSegment[]): SongTempoSegment[] {
  const [first, second] = segments;
  return second && isStartBeat(first, second) ? segments.slice(1) : segments;
}

/**
 * Entrada da faixa, medida depois do mapa: o primeiro 1 cai na cabeça de um compasso inteiro do primeiro
 * andamento, com pelo menos um compasso de entrada.
 */
export function leadInFromMap(segments: SongTempoSegment[], beatsPerBar: number): number {
  const first = segments[0];
  const bar = (60 / first.bpm) * (first.beatsPerBar ?? beatsPerBar);
  let down = first.downbeat ?? first.startTime;
  // o 1 que cai colado antes do começo do arquivo é o primeiro compasso da música
  while (down - bar >= -FILE_START_BEAT) down -= bar;
  return Math.max(1, Math.ceil(down / bar - 1e-6)) * bar - down;
}

/**
 * VS por IA: do mapa medido no arquivo para a régua. A faixa entra depois da entrada de compasso, a fase
 * vem do mapa (ou do primeiro som, em música sem bateria) e a grade cobre do 0:00 até o fim.
 */
export function placeAiTempoMap(measured: SongTempoSegment[] | null, firstSound: number | null, beatsPerBar: number, duration: number): { leadIn: number; tempoSegments?: SongTempoSegment[] } | null {
  if (!measured?.length) return null;
  // a batida colada no 0:00 sai antes: ela não está na reta da música, e a entrada é conferida nessa reta
  const lined = dropStartStub(measured);
  const mapped = firstSound !== null ? anchorOnFirstSound(lined, firstSound) : lined;
  // a grade reta do 0:00 ao ritardando passa pelo trecho maior do corpo
  const body = isFinalRitOnly(mapped) ? mapped.filter((s) => !s.rit).reduce((a, b) => (b.endTime - b.startTime > a.endTime - a.startTime ? b : a)) : mapped[0];
  const leadIn = leadInFromMap([body], beatsPerBar);
  if (!realTempoChanges(mapped).length) return { leadIn };
  const onRuler = mapped.map((s) => ({ ...s, startTime: s.startTime + leadIn, endTime: s.endTime + leadIn, downbeat: (s.downbeat ?? s.startTime) + leadIn }));
  const tempoSegments = isFinalRitOnly(onRuler) ? plainGridBeforeRit(onRuler) : extendToStart(onRuler, beatsPerBar);
  tempoSegments[tempoSegments.length - 1].endTime = leadIn + duration;
  return { leadIn, tempoSegments };
}

/** Parte das batidas do modelo que cai na grade do mapa inteiro (1 = todas). */
export function mapCoverage(segments: SongTempoSegment[], peaks: number[]): number {
  let on = 0, total = 0;
  for (const seg of segments) {
    const p = 60 / seg.bpm;
    for (const t of peaks) {
      if (t < seg.startTime || t >= seg.endTime) continue;
      total++;
      if (Math.abs(t - (seg.startTime + Math.round((t - seg.startTime) / p) * p)) <= 0.035) on++;
    }
  }
  return total ? on / total : 0;
}

/** Abaixo disto o mapa não explica a música: vale o BPM único, em vez de uma grade errada. */
export const MIN_MAP_COVERAGE = 0.5;
