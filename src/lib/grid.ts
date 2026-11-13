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

function stepSeconds(grid: SongGrid, step: SnapStep): number | null {
  if (step === 'bar') return grid.beat * grid.beatsPerBar;
  if (step === 'beat') return grid.beat;
  if (step === 'half') return grid.beat / 2;
  return null;
}

/**
 * Trechos de andamento em ordem (mudanças de BPM marcadas na régua, para medleys). Com menos de
 * dois trechos a grade é uniforme e vale só o BPM da música.
 */
function sortedSegments(grid: SongGrid): SongTempoSegment[] | null {
  const segs = grid.tempoSegments;
  if (!segs || segs.length < 2) return null;
  return [...segs].sort((a, b) => a.startTime - b.startTime);
}

/** Índice do trecho onde `seconds` cai (antes do primeiro: o primeiro; depois do último: o último). */
function segmentIndexAt(segs: SongTempoSegment[], seconds: number): number {
  let idx = 0;
  for (let i = 0; i < segs.length; i++) if (seconds >= segs[i].startTime - 1e-9) idx = i;
  return idx;
}

export function snapTime(seconds: number, grid: SongGrid | null, step: SnapStep): number {
  if (!grid || step === 'off') return Math.max(0, seconds);

  // Medley com mudanças de BPM: encaixa na grade do trecho onde o ponto cai (cursor e áudios
  // seguem o mesmo andamento que a régua desenha), e o começo de cada trecho também é um ponto
  // da grade.
  const segs = sortedSegments(grid);
  if (segs) {
    const i = segmentIndexAt(segs, seconds);
    const seg = segs[i];
    const beat = 60 / seg.bpm;
    const size = step === 'bar' ? beat * grid.beatsPerBar : step === 'half' ? beat / 2 : beat;
    let snapped = seg.startTime + Math.round((seconds - seg.startTime) / size) * size;
    const next = segs[i + 1];
    // passou do fim do trecho: o ponto certo é o começo do trecho seguinte
    if (next && snapped > next.startTime - 1e-6) snapped = next.startTime;
    return Math.max(0, snapped);
  }

  const size = stepSeconds(grid, step);
  if (!size) return Math.max(0, seconds);
  const snapped = grid.downbeat + Math.round((seconds - grid.downbeat) / size) * size;
  return Math.max(0, snapped);
}

/** "compasso.tempo", contado a partir do primeiro tempo forte (pode ser negativo antes dele). */
export function barBeatLabel(seconds: number, grid: SongGrid): string {
  // Medley: conta os compassos de cada trecho no BPM dele, como a régua
  const segs = sortedSegments(grid);
  if (segs) {
    const i = segmentIndexAt(segs, seconds);
    let barsBefore = 0;
    for (let k = 0; k < i; k++) {
      const b = (60 / segs[k].bpm) * grid.beatsPerBar;
      barsBefore += Math.max(1, Math.round((segs[k].endTime - segs[k].startTime) / b));
    }
    const segBeats = Math.round((seconds - segs[i].startTime) / (60 / segs[i].bpm));
    const barIn = Math.floor(segBeats / grid.beatsPerBar);
    const beatIn = segBeats - barIn * grid.beatsPerBar;
    const bar = barsBefore + barIn;
    return beatIn === 0 ? `${bar + 1}` : `${bar + 1}.${beatIn + 1}`;
  }
  const beats = Math.round((seconds - grid.downbeat) / grid.beat);
  const bar = Math.floor(beats / grid.beatsPerBar);
  const beat = beats - bar * grid.beatsPerBar;
  return beat === 0 ? `${bar + 1}` : `${bar + 1}.${beat + 1}`;
}

export interface GridLine {
  time: number;
  kind: 'bar' | 'beat' | 'sub';
  bar: number;
  bpmChange?: number;
}

/** Linhas visíveis no intervalo, mais densas conforme o zoom (px por segundo). */
export function gridLines(grid: SongGrid, from: number, to: number, pxPerSecond: number): GridLine[] {
  // Se houver segmentos de andamento explícitos (mudanças reais de andamento cadastradas)
  if (grid.tempoSegments && grid.tempoSegments.length > 1) {
    const lines: GridLine[] = [];
    let currentBar = 1;

    for (let sIdx = 0; sIdx < grid.tempoSegments.length; sIdx++) {
      const seg = grid.tempoSegments[sIdx];
      const segBeat = 60 / seg.bpm;
      const segBarDur = segBeat * grid.beatsPerBar;
      const segStart = seg.startTime;
      const segEnd = seg.endTime;

      if (segEnd < from || segStart > to) {
        const segTotalBars = Math.max(1, Math.round((segEnd - segStart) / segBarDur));
        currentBar += segTotalBars;
        continue;
      }

      const beatPx = segBeat * pxPerSecond;
      const barPx = beatPx * grid.beatsPerBar;
      let unit: number;
      if (beatPx >= 48) unit = segBeat / 2;
      else if (beatPx >= 12) unit = segBeat;
      else {
        const barsPerLine = Math.max(1, 2 ** Math.ceil(Math.log2(40 / Math.max(barPx, 1e-3))));
        unit = segBeat * grid.beatsPerBar * barsPerLine;
      }

      const segFirst = Math.max(0, Math.ceil((Math.max(from, segStart) - segStart) / unit - 1e-6));
      const segLast = Math.floor((Math.min(to, segEnd) - segStart) / unit + 1e-6);

      for (let i = segFirst; i <= segLast; i++) {
        const time = segStart + i * unit;
        // o ponto da mudança é desenhado pelo trecho seguinte (com a placa), não duas vezes
        if (time > segEnd + 0.001 || (sIdx < grid.tempoSegments.length - 1 && time > segEnd - 0.001)) break;
        const beats = Math.round((time - segStart) / segBeat * 2) / 2;
        const isBar = Number.isInteger(beats) && ((beats % grid.beatsPerBar) + grid.beatsPerBar) % grid.beatsPerBar === 0;
        const kind: GridLine['kind'] = isBar ? 'bar' : Number.isInteger(beats) ? 'beat' : 'sub';
        const barInSeg = Math.floor(beats / grid.beatsPerBar);

        const isFirstBarOfNewSeg = sIdx > 0 && isBar && barInSeg === 0;
        const bpmChange = isFirstBarOfNewSeg ? seg.bpm : undefined;

        lines.push({
          time,
          kind,
          bar: currentBar + barInSeg,
          bpmChange,
        });
      }

      const segTotalBars = Math.max(1, Math.round((segEnd - segStart) / segBarDur));
      currentBar += segTotalBars;
    }

    return lines;
  }

  // Grade musical uniforme de estúdio profissional (Logic Pro / Pro Tools)
  const beatPx = grid.beat * pxPerSecond;
  const barPx = beatPx * grid.beatsPerBar;
  let unit: number;
  if (beatPx >= 48) unit = grid.beat / 2;
  else if (beatPx >= 12) unit = grid.beat;
  else {
    const barsPerLine = Math.max(1, 2 ** Math.ceil(Math.log2(40 / Math.max(barPx, 1e-3))));
    unit = grid.beat * grid.beatsPerBar * barsPerLine;
  }
  const first = Math.ceil((from - grid.downbeat) / unit - 1e-6);
  const last = Math.floor((to - grid.downbeat) / unit + 1e-6);
  const lines: GridLine[] = [];
  if (last - first > 4000) return lines;
  for (let i = first; i <= last; i++) {
    const time = grid.downbeat + i * unit;
    if (time < 0) continue;
    const beats = Math.round((time - grid.downbeat) / grid.beat * 2) / 2;
    const isBar = Number.isInteger(beats) && ((beats % grid.beatsPerBar) + grid.beatsPerBar) % grid.beatsPerBar === 0;
    const kind: GridLine['kind'] = isBar ? 'bar' : Number.isInteger(beats) ? 'beat' : 'sub';
    lines.push({ time, kind, bar: Math.floor(beats / grid.beatsPerBar) + 1 });
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
 */
export function moveTempoChange(segments: SongTempoSegment[], index: number, to: number): SongTempoSegment[] {
  const segs = [...segments].sort((a, b) => a.startTime - b.startTime);
  if (index < 1 || index >= segs.length) return segs;
  const prev = segs[index - 1];
  const seg = segs[index];
  const min = prev.startTime + 60 / prev.bpm;
  const max = seg.endTime - 60 / seg.bpm;
  if (max <= min) return segs;
  const t = Math.min(max, Math.max(min, to));
  segs[index - 1] = { ...prev, endTime: t };
  segs[index] = { ...seg, startTime: t, downbeat: t };
  return segs;
}

/** Ponto mais perto de `time` que cai na grade do trecho de antes da mudança `index` (compasso, tempo ou meio tempo). */
export function snapTempoChange(segments: SongTempoSegment[], index: number, time: number, beatsPerBar: number, step: Exclude<SnapStep, 'off'> = 'beat'): number {
  const segs = [...segments].sort((a, b) => a.startTime - b.startTime);
  const prev = segs[index - 1];
  if (!prev) return time;
  const beat = 60 / prev.bpm;
  const size = step === 'bar' ? beat * beatsPerBar : step === 'half' ? beat / 2 : beat;
  return prev.startTime + Math.round((time - prev.startTime) / size) * size;
}
