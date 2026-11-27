// O que o MIDI do VS vira na música: mapa de andamento (tempoSegments), compasso, regiões das
// marcações e tom. Só contas, sem o programa: roda igual no app e nos testes.
//
// Batida da grade: a semínima nos compassos de x/4 e x/2 (2/2 vira 4 tempos de semínima) e a nota
// do denominador nos de x/8 e x/16 (6/8 tem 6 tempos de colcheia), como o click desses compassos.
// Cada batida sai do relógio do MIDI: troca de andamento no meio de uma batida vira uma batida
// própria com a duração exata, e a grade nunca sai mais de meio milissegundo do arquivo.

import type { SongTempoSegment } from '../types.ts';
import type { MidiFileInfo, MidiSmpteOffset } from './midiFile.ts';

const DEFAULT_US = 500_000; // 120 BPM

interface TempoPoint { q: number; sec: number; spq: number }

/** Último ponto com `key(p) <= x` (busca binária: um MIDI pode ter milhares de trocas). */
function pointAt(points: TempoPoint[], x: number, key: (p: TempoPoint) => number): TempoPoint {
  let lo = 0, hi = points.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (key(points[mid]) <= x) lo = mid; else hi = mid - 1;
  }
  return points[lo];
}
const byQ = (p: TempoPoint) => p.q;
const bySec = (p: TempoPoint) => p.sec;

export interface MidiClock {
  /** Semínimas desde o começo do arquivo. */
  quarters(tick: number): number;
  /** Segundos desde o começo do arquivo (sem SMPTE offset). */
  seconds(tick: number): number;
  /** Segundos de uma posição em semínimas. */
  secondsAtQuarter(q: number): number;
}

/** Relógio do arquivo: ticks em semínimas e em segundos, pela divisão e pelas trocas de andamento. */
export function midiClock(info: Pick<MidiFileInfo, 'division' | 'tempos'>): MidiClock {
  // sem andamento no tick 0, vale 120 BPM até a primeira troca
  const tempos = info.tempos[0]?.tick === 0 ? info.tempos : [{ tick: 0, usPerQuarter: DEFAULT_US }, ...info.tempos];
  const points: TempoPoint[] = [];
  const div = info.division;
  if (div.kind === 'ppq') {
    let sec = 0;
    let prev = { tick: 0, spq: tempos[0].usPerQuarter / 1e6 };
    for (const t of tempos) {
      sec += ((t.tick - prev.tick) / div.ppq) * prev.spq;
      prev = { tick: t.tick, spq: t.usPerQuarter / 1e6 };
      points.push({ q: t.tick / div.ppq, sec, spq: prev.spq });
    }
    const secondsAtQuarter = (q: number) => { const p = pointAt(points, q, byQ); return p.sec + (q - p.q) * p.spq; };
    return { quarters: (tick) => tick / div.ppq, seconds: (tick) => secondsAtQuarter(tick / div.ppq), secondsAtQuarter };
  }
  // SMPTE: o tick é tempo absoluto; o andamento só diz onde caem as semínimas
  const tps = div.fps * div.ticksPerFrame;
  let q = 0;
  let prev = { sec: 0, spq: tempos[0].usPerQuarter / 1e6 };
  for (const t of tempos) {
    const sec = t.tick / tps;
    q += (sec - prev.sec) / prev.spq;
    prev = { sec, spq: t.usPerQuarter / 1e6 };
    points.push({ q, sec, spq: prev.spq });
  }
  return {
    seconds: (tick) => tick / tps,
    quarters: (tick) => { const s = tick / tps; const p = pointAt(points, s, bySec); return p.q + (s - p.sec) / p.spq; },
    secondsAtQuarter: (qq) => { const p = pointAt(points, qq, byQ); return p.sec + (qq - p.q) * p.spq; },
  };
}

export function smpteOffsetSeconds(o: MidiSmpteOffset): number {
  return o.hours * 3600 + o.minutes * 60 + o.seconds + (o.frames + o.subframes / 100) / (o.fps || 30);
}

/**
 * Quanto o SMPTE offset desloca o MIDI em relação ao áudio. 0 ou hora cheia (01:00:00:00, o padrão
 * de vídeo e do Pro Tools): nada. Senão, o que passa da hora cheia, que a pessoa escolhe aplicar ou não.
 */
export function smpteShift(o: MidiSmpteOffset | null): number {
  if (!o) return 0;
  const total = smpteOffsetSeconds(o);
  const rest = total - Math.floor(total / 3600 + 1e-9) * 3600;
  if (rest < 0.001 || rest > 3600 - 0.001) return 0;
  // um pouco antes da hora cheia (pré-rolagem): o MIDI começa antes do áudio
  return rest > 1800 ? rest - 3600 : rest;
}

export function smpteLabel(o: MidiSmpteOffset): string {
  const two = (n: number) => String(n).padStart(2, '0');
  return `${two(o.hours)}:${two(o.minutes)}:${two(o.seconds)}:${two(o.frames)}`;
}

/** Tempos por compasso e tamanho da batida (em semínimas) da grade para um compasso do MIDI. */
export function meterBeats(numerator: number, denominator: number): { perBar: number; unit: number } {
  if (denominator >= 8) return { perBar: numerator, unit: 4 / denominator };
  const perBar = (numerator * 4) / denominator;
  if (Number.isInteger(perBar) && perBar > 0) return { perBar, unit: 1 };
  // x/1 estranho: conta na nota do denominador
  return { perBar: numerator, unit: 4 / denominator };
}

const MAJOR = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const MINOR = ['Cm', 'C#m', 'Dm', 'Ebm', 'Em', 'Fm', 'F#m', 'Gm', 'G#m', 'Am', 'Bbm', 'Bm'];

/** Tom pela armadura (FF 59): sustenidos/bemóis e maior/menor. */
export function midiKeyName(sf: number, minor: boolean): string {
  const majorPc = (((sf * 7) % 12) + 12) % 12;
  return minor ? MINOR[(majorPc + 9) % 12] : MAJOR[majorPc];
}

const END_NAME = /^(fim|end|stop)$/i;

interface Section { name: string; sec: number }

/** Marcações que viram seção: marcadores; sem eles, cue points; sem eles, textos da faixa de condutor. */
function sectionTexts(info: MidiFileInfo, clock: MidiClock): Section[] {
  const pick = (kind: 'marker' | 'cue' | 'text') => info.texts.filter((t) => t.kind === kind && (kind !== 'text' || (info.format === 1 && t.track === 0)));
  let list = pick('marker');
  if (!list.length) list = pick('cue');
  if (!list.length) list = pick('text').filter((t) => t.tick > 0);
  const out: Section[] = [];
  for (const t of list) {
    const name = t.text.trim();
    if (!name) continue;
    const sec = clock.seconds(t.tick);
    const last = out[out.length - 1];
    if (last && Math.abs(last.sec - sec) < 1e-6) { if (!END_NAME.test(name)) out[out.length - 1] = { name, sec }; continue; }
    out.push({ name, sec });
  }
  return out;
}

export interface MidiSummary {
  hasTempo: boolean;
  bpmStart: number;
  /** Trocas de andamento depois do primeiro. */
  tempoChanges: number;
  meterStart: string;
  /** Trocas de compasso depois do primeiro. */
  meterChanges: number;
  markers: string[];
  key: string | null;
  smpte: string | null;
  /** Deslocamento do SMPTE offset que pode ser aplicado (0: nada a perguntar). */
  smpteShift: number;
  lengthSeconds: number;
  notes: number;
  smpteDivision: boolean;
  warnings: string[];
}

/** O que o arquivo traz, para mostrar antes de a pessoa decidir. */
export function summarizeMidi(info: MidiFileInfo): MidiSummary {
  const clock = midiClock(info);
  const firstMeter = info.meters[0] && info.meters[0].tick === 0 ? info.meters[0] : { numerator: 4, denominator: 4 };
  const first = info.tempos[0] && info.tempos[0].tick === 0 ? info.tempos[0].usPerQuarter : DEFAULT_US;
  const { unit } = meterBeats(firstMeter.numerator, firstMeter.denominator);
  const key = info.keys[0] ? midiKeyName(info.keys[0].sf, info.keys[0].minor) : null;
  return {
    hasTempo: info.tempos.length > 0,
    bpmStart: 60 / ((first / 1e6) * unit),
    tempoChanges: Math.max(0, info.tempos.length - (info.tempos[0]?.tick === 0 ? 1 : 0)),
    meterStart: `${firstMeter.numerator}/${firstMeter.denominator}`,
    meterChanges: Math.max(0, info.meters.length - (info.meters[0]?.tick === 0 ? 1 : 0)),
    markers: sectionTexts(info, clock).filter((s) => !END_NAME.test(s.name)).map((s) => s.name),
    key,
    smpte: info.smpteOffset ? smpteLabel(info.smpteOffset) : null,
    smpteShift: smpteShift(info.smpteOffset),
    lengthSeconds: clock.seconds(info.endTick),
    notes: info.counts.notes,
    smpteDivision: info.division.kind === 'smpte',
    warnings: info.warnings,
  };
}

interface Beat { t: number; perBar: number; inBar: number; meter: number }

/** Todas as batidas da grade até um compasso depois do último evento de andamento ou compasso. */
function midiBeats(info: MidiFileInfo, clock: MidiClock): Beat[] {
  const meters = info.meters.length && info.meters[0].tick === 0 ? info.meters : [{ tick: 0, numerator: 4, denominator: 4 }, ...info.meters];
  let lastTick = 0;
  for (const t of info.tempos) if (t.tick > lastTick) lastTick = t.tick;
  for (const m of meters) if (m.tick > lastTick) lastTick = m.tick;
  const lastQ = clock.quarters(lastTick);
  const beats: Beat[] = [];
  for (let m = 0; m < meters.length; m++) {
    const { perBar, unit } = meterBeats(meters[m].numerator, meters[m].denominator);
    const from = clock.quarters(meters[m].tick);
    const isLast = m === meters.length - 1;
    const to = isLast ? Math.max(from, lastQ) + 2 * perBar * unit : clock.quarters(meters[m + 1].tick);
    for (let k = 0; ; k++) {
      const q = from + k * unit;
      if (q >= to - 1e-9 && !(isLast && k === 0)) break;
      beats.push({ t: clock.secondsAtQuarter(q), perBar, inBar: k % perBar, meter: m });
      if (beats.length > 200_000) return beats;
    }
  }
  return beats;
}

interface Run { first: number; last: number; perBar: number }

const DRIFT = 0.0005;

/** Trechos de batida igual; rampas (uma batida por trecho) juntam enquanto ficam a meio milissegundo do arquivo. */
function beatRuns(beats: Beat[]): Run[] {
  const runs: Run[] = [];
  const dur = (i: number) => beats[i + 1].t - beats[i].t;
  let start = 0;
  for (let i = 1; i < beats.length - 1; i++) {
    const meterBreak = beats[i].meter !== beats[i - 1].meter;
    if (meterBreak || Math.abs(dur(i) - dur(i - 1)) > 1e-7) {
      runs.push({ first: start, last: i, perBar: beats[start].perBar });
      start = i;
    }
  }
  runs.push({ first: start, last: beats.length - 1, perBar: beats[start].perBar });
  // junta trechos vizinhos do mesmo compasso (o último fica: ele vale até o fim da música)
  const fits = (first: number, last: number, cuts: number[]) => {
    const d = (beats[last].t - beats[first].t) / (last - first);
    return cuts.every((c) => Math.abs(beats[c].t - (beats[first].t + (c - first) * d)) <= DRIFT);
  };
  const merged: Array<Run & { cuts: number[] }> = [];
  for (let r = 0; r < runs.length; r++) {
    const run = runs[r];
    const prev = merged[merged.length - 1];
    const isFinal = r === runs.length - 1;
    if (prev && !isFinal && prev.perBar === run.perBar && beats[run.first].meter === beats[prev.first].meter
      && fits(prev.first, run.last, [...prev.cuts, run.first])) {
      prev.cuts.push(run.first);
      prev.last = run.last;
      continue;
    }
    merged.push({ ...run, cuts: [] });
  }
  return merged;
}

export interface MidiSongPlan {
  hasTempo: boolean;
  bpm: number;
  /** Compasso da música, quando o programa tem (3, 4 ou 6); os outros ficam em cada trecho. */
  beatsPerBar?: 3 | 4 | 6;
  /** Mapa com as trocas (2 trechos ou mais); sem trocas fica só o BPM. */
  tempoSegments?: SongTempoSegment[];
  regions: Array<{ name: string; start: number; end: number }>;
  musicKey?: string;
}

export interface MidiPlanOptions {
  /** Tamanho da música (segundos), para o fim da última região e do último trecho. */
  duration: number;
  /** Segundos somados a cada instante do MIDI (SMPTE offset aceito, ou o começo da música num projeto). */
  shift?: number;
}

const round6 = (x: number) => Math.round(x * 1e6) / 1e6;

/** Tudo o que a música recebe do MIDI escolhido. */
export function planMidiSong(info: MidiFileInfo, opts: MidiPlanOptions): MidiSongPlan {
  const clock = midiClock(info);
  const shift = opts.shift ?? 0;
  const duration = Math.max(0, opts.duration);
  const firstMeter = info.meters[0] && info.meters[0].tick === 0 ? info.meters[0] : { numerator: 4, denominator: 4 };
  const songBar = meterBeats(firstMeter.numerator, firstMeter.denominator).perBar;
  const plan: MidiSongPlan = { hasTempo: info.tempos.length > 0, bpm: 120, regions: [] };

  // batidas no tempo da música; as de antes do 0:00 saem
  const all = midiBeats(info, clock).map((b) => ({ ...b, t: b.t + shift }));
  let beats = all.filter((b) => b.t >= -1e-6);
  // e as de depois do fim também (num projeto, as das músicas seguintes): fica só a primeira delas,
  // que fecha a duração da última batida da música
  if (duration > 0) {
    const after = beats.findIndex((b) => b.t >= duration - 1e-6);
    if (after >= 0) beats = beats.slice(0, after + 1);
  }
  if (beats.length < 2) beats = all.filter((b) => b.t >= -1e-6).slice(0, 2);
  if (beats.length < 2) beats = all.slice(-2);
  const runs = beatRuns(beats);
  const segs: SongTempoSegment[] = [];
  for (const run of runs) {
    const span = run.last - run.first;
    const beat = (beats[run.last].t - beats[run.first].t) / Math.max(1, span);
    const bpm = 60 / beat;
    const startTime = Math.max(0, round6(beats[run.first].t));
    const pickup = (run.perBar - beats[run.first].inBar) % run.perBar;
    segs.push({
      startTime,
      endTime: 0,
      bpm: Number(bpm.toFixed(6)),
      downbeat: round6(startTime + pickup * beat),
      ...(pickup ? { barOffset: pickup } : {}),
      beatsPerBar: run.perBar,
    });
  }
  // o BPM da música é o do começo do próprio MIDI, não o do trecho de entrada
  plan.bpm = segs[0]?.bpm ?? 120;
  // o MIDI começa depois do 0:00 (SMPTE): um trecho de entrada com batidas inteiras até ele
  if (segs.length && segs[0].startTime > 0.001) {
    const first = segs[0];
    const lead = first.startTime;
    const beat = 60 / first.bpm;
    // menos de meio tempo de entrada: sem batida nela (a do 0:00 ficaria colada na do MIDI)
    const n = lead >= beat / 2 ? Math.max(1, Math.round(lead / beat)) : 1;
    const bpm = lead >= beat / 2 ? (60 * n) / lead : first.bpm;
    segs.unshift({ startTime: 0, endTime: 0, bpm: Number(bpm.toFixed(6)), downbeat: round6(lead), barOffset: n, beatsPerBar: first.beatsPerBar });
  }
  // o compasso da música é o que vale no começo dela (num projeto com várias músicas, a terceira
  // pode estar em 3/4 enquanto o arquivo começa em 4/4)
  const startBar = beats[0]?.perBar ?? songBar;
  if (startBar === 3 || startBar === 4 || startBar === 6) plan.beatsPerBar = startBar;
  const songPerBar = plan.beatsPerBar ?? 4;
  // compasso que o programa não tem na música (5/4, 7/8...) ou começo no meio do compasso: só valem
  // com o mapa, então ele fica em 2 trechos, cortado num 1
  if (segs.length === 1 && (segs[0].beatsPerBar !== songPerBar || segs[0].barOffset)) {
    const s = segs[0];
    const beat = 60 / s.bpm;
    const cut = round6((s.downbeat ?? s.startTime) + (s.beatsPerBar ?? songPerBar) * beat);
    const { barOffset: _pickup, ...plain } = s;
    segs.push({ ...plain, startTime: cut, downbeat: cut });
  }
  if (segs.length > 1) {
    for (let i = 0; i < segs.length; i++) {
      segs[i].endTime = i + 1 < segs.length ? segs[i + 1].startTime : Math.max(duration, segs[i].startTime + 1);
      if (segs[i].beatsPerBar === songPerBar) delete segs[i].beatsPerBar;
    }
    plan.tempoSegments = segs;
  }

  // marcações: cada uma abre uma região que vai até a próxima (FIM/END fecham sem abrir outra)
  const marks = sectionTexts(info, clock).map((s) => ({ ...s, sec: s.sec + shift })).filter((s) => s.sec < duration - 0.05);
  for (let i = 0; i < marks.length; i++) {
    const m = marks[i];
    if (END_NAME.test(m.name)) continue;
    const start = Math.max(0, m.sec);
    const end = Math.min(duration, marks[i + 1]?.sec ?? duration);
    if (end - start < 0.05) continue;
    // marcador antes do 0:00 (SMPTE): só vale se ainda tiver trecho depois dele
    plan.regions.push({ name: m.name, start: round6(start), end: round6(end) });
  }
  const key = info.keys[0];
  // C maior (armadura vazia) é o que muitos programas gravam sem saber o tom: não vale como tom
  if (key && (key.sf !== 0 || key.minor)) plan.musicKey = midiKeyName(key.sf, key.minor);
  return plan;
}

/** Trecho de um MIDI usado por uma música de um projeto (REAPER): o que cai entre `start` e `end` do arquivo. */
export function planMidiWindow(info: MidiFileInfo, opts: { start: number; end: number; shift?: number }): MidiSongPlan {
  return planMidiSong(info, { duration: Math.max(0, opts.end - opts.start), shift: (opts.shift ?? 0) - opts.start });
}
