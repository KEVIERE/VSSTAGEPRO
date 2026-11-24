import type { AudioClip, Song, SongTempoSegment } from '@/types';

export type SnapStep = 'bar' | 'beat' | 'half' | 'off';

export const SNAP_LABELS: Record<SnapStep, string> = {
  bar: 'Compasso',
  beat: 'Tempo',
  half: '1/2 tempo',
  off: 'Livre',
};

export interface SongGrid {
  beat: number;
  beatsPerBar: number;
  downbeat: number;
  /** Instantes exatos no tempo da timeline de cada pulso de click detectado na forma de onda */
  beatTimes?: number[];
  tempoSegments?: SongTempoSegment[];
}

export function songGrid(
  song: (Pick<Song, 'bpm' | 'downbeat' | 'beatsPerBar'> & { tempoSegments?: SongTempoSegment[] }) | null | undefined,
  _clickClip?: Pick<AudioClip, 'waveformPeaks' | 'duration' | 'startTime'> | null
): SongGrid | null {
  if (!song?.bpm || song.bpm <= 0) return null;
  const beat = 60 / song.bpm;
  const beatsPerBar = song.beatsPerBar ?? 4;
  // A timeline de cada música inicia cravada no compasso 1 e não quebrada, sincada na grade de acordo com o click
  const downbeat = 0;

  return {
    beat,
    beatsPerBar,
    downbeat,
    tempoSegments: song.tempoSegments,
  };
}

/** Tempos por compasso do trecho (uma valsa dentro do medley tem 3). */
export function segmentBar(seg: Pick<SongTempoSegment, 'beatsPerBar'>, fallback: number): number {
  return seg.beatsPerBar && seg.beatsPerBar > 0 ? seg.beatsPerBar : fallback;
}

/** Tempos antes do primeiro 1 do trecho (anacruse da música que entra). */
export function segmentPickup(seg: Pick<SongTempoSegment, 'barOffset'>): number {
  return seg.barOffset && seg.barOffset > 0 ? seg.barOffset : 0;
}

/** Instante do primeiro 1 do trecho. */
export function segmentFirstBar(seg: SongTempoSegment): number {
  return seg.startTime + (segmentPickup(seg) * 60) / seg.bpm;
}

/**
 * Última batida de um trecho não pode cair colada na primeira do seguinte: soaria um click duplo.
 * Devolve até onde o trecho ainda pode ter batida.
 */
export function segmentBeatLimit(seg: SongTempoSegment, next: SongTempoSegment | undefined): number {
  if (!next) return seg.endTime;
  return next.startTime - 0.25 * Math.min(60 / seg.bpm, 60 / next.bpm);
}

// FONTE ÚNICA DAS BATIDAS. A grade, o click gerado, a contagem do Maestro, o snap e o
// nearestGridBeat saem todos de beatSpans: batida k de um trecho = início + k x tempo.

/** O que a grade precisa saber da música para contar batidas. */
export interface GridTempo {
  bpm?: number;
  beatsPerBar?: number;
  tempoSegments?: SongTempoSegment[];
}

/** Um trecho pronto para contar batidas. */
export interface BeatSpan {
  /** Instante da batida 0. */
  start: number;
  beat: number;
  bpm: number;
  perBar: number;
  /** Tempos antes do primeiro 1. */
  pickup: number;
  /** Primeira batida que existe (a grade não tem batida antes do 0:00). */
  firstBeat: number;
  /** Última batida do trecho. No último trecho é infinita: ele vale até o fim da música. */
  lastBeat: number;
  /** Até onde o trecho pode ter linha. Infinito no último trecho. */
  limit: number;
  /** Número, na régua, do primeiro compasso do trecho. */
  firstBar: number;
}

function uniformSpan(beat: number, perBar: number, origin: number): BeatSpan {
  return {
    start: origin,
    beat,
    bpm: 60 / beat,
    perBar,
    pickup: 0,
    firstBeat: origin ? Math.ceil(-origin / beat - 1e-9) : 0,
    lastBeat: Infinity,
    limit: Infinity,
    firstBar: 1,
  };
}

/**
 * Trechos da música em ordem. Com menos de dois trechos a grade é uniforme, a partir do 0:00.
 * Cada compasso desenhado conta um número, inclusive o incompleto no fim de um trecho.
 */
export function beatSpans(tempo: GridTempo): BeatSpan[] {
  const songBpm = tempo.bpm && tempo.bpm > 0 ? tempo.bpm : 120;
  const fallbackBar = tempo.beatsPerBar ?? 4;
  const segs = tempo.tempoSegments;
  if (!segs || segs.length < 2) return [{ ...uniformSpan(60 / songBpm, fallbackBar, 0), bpm: songBpm }];
  const sorted = [...segs]
    .map((s) => (s.bpm > 0 ? s : { ...s, bpm: songBpm }))
    .sort((a, b) => a.startTime - b.startTime);
  let bar = 1;
  return sorted.map((seg, i) => {
    const next = sorted[i + 1];
    const beat = 60 / seg.bpm;
    const perBar = segmentBar(seg, fallbackBar);
    const pickup = segmentPickup(seg);
    const limit = next ? segmentBeatLimit(seg, next) : Infinity;
    const lastBeat = next ? Math.max(-1, Math.floor((limit - seg.startTime) / beat + 1e-9)) : Infinity;
    const firstBar = bar;
    if (lastBeat >= pickup) bar += Math.floor((lastBeat - pickup) / perBar) + 1;
    return { start: seg.startTime, beat, bpm: seg.bpm, perBar, pickup, firstBeat: 0, lastBeat, limit, firstBar };
  });
}

/** Os trechos de uma grade já montada (a grade uniforme pode ter origem própria). */
function spansOfGrid(grid: SongGrid): BeatSpan[] {
  if (!grid.tempoSegments || grid.tempoSegments.length < 2) return [uniformSpan(grid.beat, grid.beatsPerBar, grid.downbeat)];
  return beatSpans({ bpm: 60 / grid.beat, beatsPerBar: grid.beatsPerBar, tempoSegments: grid.tempoSegments });
}

const hasBeats = (s: BeatSpan) => s.lastBeat >= s.firstBeat;

/** Índice do trecho onde `seconds` cai (antes do primeiro: o primeiro; depois do último: o último). */
export function spanIndexAt(spans: BeatSpan[], seconds: number): number {
  let idx = 0;
  for (let i = 1; i < spans.length; i++) {
    if (seconds < spans[i].start - 1e-9) break;
    idx = i;
  }
  return idx;
}

/** Todas as batidas em [from, to), em ordem. É o click que a grade desenha. */
export function gridBeatTimes(tempo: GridTempo, from: number, to: number): number[] {
  const out: number[] = [];
  if (!Number.isFinite(to)) return out;
  for (const s of beatSpans(tempo)) {
    const a = Math.max(s.firstBeat, Math.ceil((from - s.start) / s.beat - 1e-9));
    const b = Math.min(s.lastBeat, Math.ceil((to - 1e-6 - s.start) / s.beat) - 1);
    for (let k = a; k <= b; k++) out.push(s.start + k * s.beat);
  }
  return out;
}

/** A batida da grade mais perto de `t`, com o trecho e o número dela. */
export function nearestBeatOf(spans: BeatSpan[], t: number): { span: BeatSpan; k: number; time: number } | null {
  const i = spanIndexAt(spans, t);
  let best: { span: BeatSpan; k: number; time: number } | null = null;
  let bestGap = Infinity;
  const look = (s: BeatSpan) => {
    if (!hasBeats(s)) return;
    const low = Math.max(s.firstBeat, Math.min(s.lastBeat, Math.floor((t - s.start) / s.beat)));
    for (const k of [low, low + 1]) {
      if (k > s.lastBeat) continue;
      const time = s.start + k * s.beat;
      const gap = Math.abs(time - t);
      if (gap <= bestGap) { bestGap = gap; best = { span: s, k, time }; }
    }
  };
  for (let j = Math.max(0, i - 1); j <= Math.min(spans.length - 1, i + 1); j++) look(spans[j]);
  // trechos vizinhos sem nenhuma batida (emenda colada): procura nos outros
  if (!best) spans.forEach(look);
  return best;
}

/**
 * Onde está a batida que já começou em `t`: trecho e número. `tolerance` (fração do tempo) faz o
 * ponto colado antes de uma batida contar como ela.
 */
function beatStartRef(spans: BeatSpan[], t: number, tolerance: number): { index: number; k: number } | null {
  const i = spanIndexAt(spans, t);
  const next = spans[i + 1];
  if (next && hasBeats(next) && t >= next.start - tolerance * next.beat) return { index: i + 1, k: next.firstBeat };
  for (let j = i; j >= 0; j--) {
    const s = spans[j];
    if (!hasBeats(s)) continue;
    const k = Math.floor((t - s.start) / s.beat + tolerance);
    return { index: j, k: Math.max(s.firstBeat, Math.min(s.lastBeat, k)) };
  }
  for (let j = i + 1; j < spans.length; j++) if (hasBeats(spans[j])) return { index: j, k: spans[j].firstBeat };
  return null;
}

/** Instante da batida que já começou em `t` (sem batida nenhuma: o próprio `t`). */
export function beatStartTime(spans: BeatSpan[], t: number, tolerance = 0): number {
  const ref = beatStartRef(spans, t, tolerance);
  return ref ? spans[ref.index].start + ref.k * spans[ref.index].beat : Math.max(0, t);
}

/** `count` batidas seguidas a partir da que já começou em `t`, atravessando as trocas de andamento. */
export function beatsFrom(spans: BeatSpan[], t: number, count: number, tolerance = 0): number[] {
  const out: number[] = [];
  const ref = beatStartRef(spans, t, tolerance);
  if (!ref) return out;
  let { index, k } = ref;
  while (out.length < count && index < spans.length) {
    const s = spans[index];
    if (k > s.lastBeat) {
      index++;
      if (index < spans.length) k = spans[index].firstBeat;
      continue;
    }
    out.push(s.start + k * s.beat);
    k++;
  }
  return out;
}

export function snapTime(seconds: number, grid: SongGrid | null, step: SnapStep): number {
  if (!grid || step === 'off') return Math.max(0, seconds);
  // cursor e áudios encaixam na grade do trecho onde o ponto cai, e o começo de cada trecho
  // também é um ponto da grade
  const spans = spansOfGrid(grid);
  const i = spanIndexAt(spans, seconds);
  const s = spans[i];
  const size = step === 'bar' ? s.beat * s.perBar : step === 'half' ? s.beat / 2 : s.beat;
  const origin = step === 'bar' ? s.start + s.pickup * s.beat : s.start;
  let snapped = origin + Math.round((seconds - origin) / size) * size;
  if (spans.length > 1 && snapped < s.start) snapped = s.start;
  const next = spans[i + 1];
  // passou do fim do trecho: o ponto certo é o começo do trecho seguinte
  if (next && snapped > s.limit) snapped = next.start;
  return Math.max(0, snapped);
}

/**
 * BPM que vale em `seconds`: o do trecho de andamento marcado na régua onde ele cai (medleys), ou o
 * BPM da música quando não há mudanças. Os mostradores de BPM usam este, não só o do começo.
 */
export function bpmAt(song: { bpm?: number; tempoSegments?: SongTempoSegment[] }, seconds: number): number {
  const segs = song.tempoSegments;
  if (segs && segs.length > 1) {
    const spans = beatSpans(song);
    return spans[spanIndexAt(spans, seconds)].bpm;
  }
  return song.bpm ?? 0;
}

/**
 * Início do compasso onde `seconds` está (na grade do trecho de andamento onde ele cai). Clicando
 * já colado na linha seguinte (último 15% do compasso), vale a linha seguinte.
 */
export function barStartAt(seconds: number, grid: SongGrid): number {
  const spans = spansOfGrid(grid);
  const s = spans[spanIndexAt(spans, seconds)];
  const origin = s.start + s.pickup * s.beat;
  const bar = s.beat * s.perBar;
  const k = Math.floor((seconds - origin) / bar + 0.15);
  const at = origin + k * bar;
  // na anacruse, o começo do trecho é a linha que vale
  return Math.max(0, spans.length > 1 ? Math.max(s.start, at) : at);
}

/** "compasso.tempo", contado a partir do primeiro tempo forte (pode ser negativo antes dele). */
export function barBeatLabel(seconds: number, grid: SongGrid): string {
  const spans = spansOfGrid(grid);
  const s = spans[spanIndexAt(spans, seconds)];
  const beats = Math.round((seconds - (s.start + s.pickup * s.beat)) / s.beat);
  const barIn = Math.floor(beats / s.perBar);
  const beatIn = beats - barIn * s.perBar;
  const bar = s.firstBar + barIn;
  return beatIn === 0 ? `${bar}` : `${bar}.${beatIn + 1}`;
}

export interface GridLine {
  time: number;
  kind: 'bar' | 'beat' | 'sub';
  bar: number;
  bpmChange?: number;
}

/** Linhas visíveis no intervalo, mais densas conforme o zoom (px por segundo). */
export function gridLines(grid: SongGrid, from: number, to: number, pxPerSecond: number): GridLine[] {
  const spans = spansOfGrid(grid);
  const lines: GridLine[] = [];
  for (let sIdx = 0; sIdx < spans.length; sIdx++) {
    const s = spans[sIdx];
    if (s.limit < from || s.start > to) continue;
    const beatPx = s.beat * pxPerSecond;
    const barPx = beatPx * s.perBar;
    let unit: number;
    if (beatPx >= 48) unit = s.beat / 2;
    else if (beatPx >= 12) unit = s.beat;
    else {
      const barsPerLine = Math.max(1, 2 ** Math.ceil(Math.log2(40 / Math.max(barPx, 1e-3))));
      unit = s.beat * s.perBar * barsPerLine;
    }
    // de longe só aparecem compassos: a conta parte do primeiro 1 do trecho
    const origin = beatPx >= 12 ? s.start : s.start + s.pickup * s.beat;
    const changed = sIdx > 0 && s.bpm !== spans[sIdx - 1].bpm;

    // anacruse vista de longe: a linha do 1 fica adiante, e a placa continua no ponto da troca
    if (changed && s.pickup > 0 && beatPx < 12 && s.start >= from && s.start <= to) {
      lines.push({ time: s.start, kind: 'beat', bar: s.firstBar - 1, bpmChange: s.bpm });
    }

    const lowest = Math.max(from, s.start + s.firstBeat * s.beat);
    const first = Math.ceil((lowest - origin) / unit - 1e-6);
    const segFirst = s.firstBeat === 0 ? Math.max(0, first) : first;
    const segLast = Math.floor((Math.min(to, s.limit) - origin) / unit + 1e-6);
    if (spans.length === 1 && segLast - segFirst > 4000) return lines;

    for (let i = segFirst; i <= segLast; i++) {
      const time = origin + i * unit;
      // o ponto da mudança é desenhado pelo trecho seguinte (com a placa), não duas vezes
      if (time > s.limit) break;
      const beats = Math.round((time - s.start) / s.beat * 2) / 2 - s.pickup;
      const isBar = Number.isInteger(beats) && ((beats % s.perBar) + s.perBar) % s.perBar === 0;
      const kind: GridLine['kind'] = isBar ? 'bar' : Number.isInteger(beats) ? 'beat' : 'sub';
      const line: GridLine = { time, kind, bar: s.firstBar + Math.floor(beats / s.perBar) };
      // a placa fica no ponto da troca; anacruse no mesmo BPM não é mudança
      if (changed && Math.abs(time - s.start) < 1e-6) line.bpmChange = s.bpm;
      lines.push(line);
    }
  }
  return lines;
}

/** Índice do trecho que começa na mudança de andamento mais perto de `time` (o primeiro trecho não é mudança). */
export function tempoChangeIndex(segments: SongTempoSegment[] | undefined, time: number): number {
  if (!segments || segments.length < 2) return -1;
  let best = -1;
  for (let i = 1; i < segments.length; i++) {
    if (best < 0 || Math.abs(segments[i].startTime - time) < Math.abs(segments[best].startTime - time)) best = i;
  }
  return best;
}

/**
 * Trechos com a mudança de andamento `index` levada para `to`. Fica sempre a pelo menos um tempo
 * das mudanças vizinhas, para nenhum trecho sumir.
 * Com `keepPhase`, as batidas do trecho ficam onde estão: a troca anda em tempos inteiros do próprio
 * trecho e o 1 continua no lugar. Sem ele, o trecho recomeça no 1 do ponto exato (Alt e "Ajustar").
 */
export function moveTempoChange(
  segments: SongTempoSegment[], index: number, to: number,
  opts: { keepPhase?: boolean; beatsPerBar?: number } = {},
): SongTempoSegment[] {
  const segs = [...segments].sort((a, b) => a.startTime - b.startTime);
  if (index < 1 || index >= segs.length) return segs;
  const prev = segs[index - 1];
  const seg = segs[index];
  const min = prev.startTime + 60 / prev.bpm;
  const max = seg.endTime - 60 / seg.bpm;
  if (max <= min) return segs;
  const t = Math.min(max, Math.max(min, to));
  if (opts.keepPhase) {
    const beat = 60 / seg.bpm;
    const lowest = Math.ceil((min - seg.startTime) / beat - 1e-9);
    const highest = Math.floor((max - seg.startTime) / beat + 1e-9);
    if (highest < lowest) return segs;
    const k = Math.max(lowest, Math.min(highest, Math.round((t - seg.startTime) / beat)));
    if (k === 0) return segs;
    const perBar = segmentBar(seg, opts.beatsPerBar ?? 4);
    const pickup = (((segmentPickup(seg) - k) % perBar) + perBar) % perBar;
    const startTime = seg.startTime + k * beat;
    const { barOffset: _old, ...rest } = seg;
    segs[index - 1] = { ...prev, endTime: startTime };
    segs[index] = { ...rest, startTime, downbeat: startTime + pickup * beat, ...(pickup ? { barOffset: pickup } : {}) };
    return segs;
  }
  segs[index - 1] = { ...prev, endTime: t };
  // a troca foi posta à mão: o trecho passa a começar no 1 do ponto novo
  const { barOffset: _pickup, ...moved } = seg;
  segs[index] = { ...moved, startTime: t, downbeat: t };
  return segs;
}

/** Ponto mais perto de `time` que cai na grade do trecho de antes da mudança `index` (compasso, tempo ou meio tempo). */
export function snapTempoChange(segments: SongTempoSegment[], index: number, time: number, beatsPerBar: number, step: Exclude<SnapStep, 'off'> = 'beat'): number {
  const segs = [...segments].sort((a, b) => a.startTime - b.startTime);
  const prev = segs[index - 1];
  if (!prev) return time;
  const beat = 60 / prev.bpm;
  const size = step === 'bar' ? beat * segmentBar(prev, beatsPerBar) : step === 'half' ? beat / 2 : beat;
  const origin = step === 'bar' ? segmentFirstBar(prev) : prev.startTime;
  return origin + Math.round((time - origin) / size) * size;
}

/**
 * BPM digitado numa música de andamento único cuja grade foi encaixada na batida real. BPM igual não mexe
 * em nada. BPM novo mantém o ponto de partida da grade e a anacruse; a batida solta de um ataque cortado
 * continua no lugar, e a grade parte do trecho que vem depois dela.
 */
export function uniformSegments(segments: SongTempoSegment[], bpm: number, beatsPerBar: number): SongTempoSegment[] | undefined {
  const sorted = [...segments].sort((a, b) => a.startTime - b.startTime);
  if (sorted.every((s) => s.bpm === bpm)) return segments;
  const end = sorted[sorted.length - 1].endTime;
  const beat = 60 / bpm;
  const [first, second] = sorted;
  const firstBeat = 60 / first.bpm;
  const loose = !!second && second.bpm === first.bpm && second.startTime - first.startTime <= firstBeat + 0.036;
  const base = loose ? second : first;
  const perBar = segmentBar(base, beatsPerBar);
  const pickup = segmentPickup(base) % perBar;
  const startTime = base.startTime;
  const meter = base.beatsPerBar ? { beatsPerBar: base.beatsPerBar } : {};
  const main: SongTempoSegment = { startTime, endTime: end, bpm, downbeat: startTime + pickup * beat, ...(pickup ? { barOffset: pickup } : {}), ...meter };
  if (loose) {
    const lead = (pickup + 1) % perBar;
    const { barOffset: _old, ...head } = first;
    return [{ ...head, bpm, endTime: startTime, downbeat: first.startTime + lead * beat, ...(lead ? { barOffset: lead } : {}) }, main];
  }
  // o corte interno é em compassos inteiros: a anacruse vale igual nos dois lados
  const bar = beat * perBar;
  const bars = Math.floor((end - startTime) / bar);
  if (bars < 2) return undefined;
  const cut = startTime + Math.floor(bars / 2) * bar;
  const offset = pickup ? { barOffset: pickup } : {};
  return [
    { startTime, endTime: cut, bpm, downbeat: startTime + pickup * beat, ...offset, ...meter },
    { startTime: cut, endTime: end, bpm, downbeat: cut + pickup * beat, ...offset, ...meter },
  ];
}

/** O último trecho vale até o fim da música, mesmo que ela tenha crescido depois da medição. */
export function openLastSegment(segments: SongTempoSegment[], songEnd: number): SongTempoSegment[] {
  const sorted = [...segments].sort((a, b) => a.startTime - b.startTime);
  const at = sorted.length - 1;
  if (at >= 0 && sorted[at].endTime < songEnd) sorted[at] = { ...sorted[at], endTime: songEnd };
  return sorted;
}

/** Trechos seguidos de mesmo BPM, mesma fase e mesmo compasso (corte interno, sem placa) viram um só. */
export function mergeSameLineSegments(segments: SongTempoSegment[], beatsPerBar: number): SongTempoSegment[] {
  const out: SongTempoSegment[] = [];
  for (const seg of [...segments].sort((a, b) => a.startTime - b.startTime)) {
    const prev = out[out.length - 1];
    if (prev && prev.bpm === seg.bpm && segmentBar(prev, beatsPerBar) === segmentBar(seg, beatsPerBar)) {
      const beat = 60 / prev.bpm;
      const beats = (seg.startTime - prev.startTime) / beat;
      const k = Math.round(beats);
      const perBar = segmentBar(prev, beatsPerBar);
      const bars = (segmentPickup(seg) + k - segmentPickup(prev)) / perBar;
      if (Math.abs(beats - k) * beat <= 1e-3 && Math.abs(bars - Math.round(bars)) < 1e-6) {
        out[out.length - 1] = { ...prev, endTime: Math.max(prev.endTime, seg.endTime) };
        continue;
      }
    }
    out.push(seg);
  }
  return out;
}

/**
 * Um trecho que sobrou sozinho. A grade só usa trechos a partir de dois, então, se a fase dele não é a
 * da grade simples do 0:00, ele vira dois no mesmo BPM (sem placa na régua e sem click a mais).
 * Devolve undefined quando a grade simples já é igual.
 */
export function keepSegmentPhase(seg: SongTempoSegment, beatsPerBar: number, songEnd = seg.endTime): SongTempoSegment[] | undefined {
  const beat = 60 / seg.bpm;
  const perBar = segmentBar(seg, beatsPerBar);
  const pickup = segmentPickup(seg);
  const firstBar = seg.startTime + pickup * beat;
  const onPlain = (t: number, size: number) => Math.abs(t - Math.round(t / size) * size) <= 1e-6;
  if (perBar === beatsPerBar && onPlain(seg.startTime, beat) && onPlain(firstBar, beat * perBar)) return undefined;
  const end = Math.max(seg.endTime, songEnd);
  const total = Math.floor((end - seg.startTime) / beat + 1e-9);
  if (total < 2) return undefined;
  // corta num 1 de compasso quando dá
  let k = pickup + perBar * Math.max(1, Math.floor((total - pickup) / perBar / 2));
  if (k >= total) k = Math.floor(total / 2);
  const cut = seg.startTime + k * beat;
  const after = (((pickup - k) % perBar) + perBar) % perBar;
  const { barOffset: _old, ...plain } = seg;
  return [
    { ...seg, endTime: cut },
    { ...plain, startTime: cut, endTime: end, downbeat: cut + after * beat, ...(after ? { barOffset: after } : {}) },
  ];
}

/** Perto de uma batida (até isto), cravar o compasso só renumera: as batidas não andam. */
const BAR_MARK_NEAR = 0.03;

/**
 * Shift + botão direito na régua: `time` passa a ser um 1 de compasso. Em cima de uma batida, só a
 * numeração muda. Fora dela, a grade do trecho anda até o ponto, no mesmo BPM.
 */
export function markBarStart(tempo: GridTempo, time: number, songEnd: number): SongTempoSegment[] | undefined {
  const fallback = tempo.beatsPerBar ?? 4;
  const songBpm = tempo.bpm && tempo.bpm > 0 ? tempo.bpm : 120;
  const sorted = tempo.tempoSegments && tempo.tempoSegments.length > 1
    ? [...tempo.tempoSegments].sort((a, b) => a.startTime - b.startTime)
    : null;
  // andamento único guardado em dois trechos (só para manter a fase) conta como um trecho só
  const oneLine = !sorted || sorted.every((s) => {
    const beats = (s.startTime - sorted[0].startTime) / (60 / sorted[0].bpm);
    return s.bpm === sorted[0].bpm && Math.abs(beats - Math.round(beats)) < 1e-6;
  });
  const single = !sorted || oneLine;
  const segs: SongTempoSegment[] = !sorted
    ? [{ startTime: 0, endTime: Math.max(songEnd, time), bpm: songBpm }]
    : oneLine ? [{ ...sorted[0], endTime: Math.max(songEnd, sorted[sorted.length - 1].endTime) }] : sorted;
  let index = 0;
  for (let i = 1; i < segs.length; i++) if (time >= segs[i].startTime - 1e-9) index = i;
  const seg = segs[index];
  const beat = 60 / seg.bpm;
  const perBar = segmentBar(seg, fallback);
  const nearest = Math.round((time - seg.startTime) / beat);
  let startTime = seg.startTime;
  let count = nearest;
  if (Math.abs(time - (seg.startTime + nearest * beat)) > Math.min(BAR_MARK_NEAR, beat / 8)) {
    // o primeiro trecho continua cobrindo desde o 0:00
    const base = index === 0 ? 0 : seg.startTime;
    count = Math.max(0, Math.floor((time - base) / beat));
    startTime = time - count * beat;
  }
  const pickup = ((count % perBar) + perBar) % perBar;
  const { barOffset: _old, ...plain } = seg;
  const marked: SongTempoSegment = { ...plain, startTime, downbeat: startTime + pickup * beat, ...(pickup ? { barOffset: pickup } : {}) };
  if (single) return keepSegmentPhase(marked, fallback, songEnd);
  const out = [...segs];
  out[index] = marked;
  if (index > 0) out[index - 1] = { ...out[index - 1], endTime: startTime };
  return out;
}

/**
 * Depois de empurrar a música para a direita: o primeiro trecho volta a cobrir desde o 0:00, na fase
 * dele, com os tempos que sobram antes do primeiro 1 como anacruse. Mesma regra do extendToStart do
 * mapa. A batida solta de um ataque cortado continua no lugar, e a grade nova entra antes dela.
 */
export function reachSongStart(segments: SongTempoSegment[], beatsPerBar: number): SongTempoSegment[] {
  if (!segments.length) return segments;
  const sorted = [...segments].sort((a, b) => a.startTime - b.startTime);
  const [first, second] = sorted;
  const firstBeat = 60 / first.bpm;
  const loose = !!second && second.bpm === first.bpm && second.startTime - first.startTime <= firstBeat + 0.036;
  const base = loose ? second : first;
  const beat = 60 / base.bpm;
  const perBar = segmentBar(base, beatsPerBar);
  const firstBar = base.startTime + segmentPickup(base) * beat;
  const n = Math.floor(firstBar / beat + 1e-6);
  let startTime = firstBar - n * beat;
  if (Math.abs(startTime) < 1e-6) startTime = 0;
  const pickup = ((n % perBar) + perBar) % perBar;
  const { barOffset: _old, ...plain } = base;
  const head: SongTempoSegment = { ...plain, startTime, downbeat: startTime + pickup * beat, ...(pickup ? { barOffset: pickup } : {}) };
  if (loose) {
    // só entra se sobrar pelo menos uma batida antes da batida solta
    if (first.startTime - startTime < beat * 0.75) return sorted;
    return [{ ...head, endTime: first.startTime }, ...sorted];
  }
  // batida que cairia colada antes do 0:00 entra como uma batida no próprio 0:00
  if (startTime > 1e-6 && beat - startTime <= 0.03 && startTime < first.endTime) {
    const lead = (pickup + 1) % perBar;
    const { barOffset: _unused, ...clean } = head;
    return [{ ...clean, startTime: 0, endTime: startTime, downbeat: lead * beat, ...(lead ? { barOffset: lead } : {}) }, head, ...sorted.slice(1)];
  }
  return [head, ...sorted.slice(1)];
}
