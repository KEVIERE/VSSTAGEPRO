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
  const downbeat = Math.max(0, song.downbeat ?? 0);

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

export function snapTime(seconds: number, grid: SongGrid | null, step: SnapStep): number {
  if (!grid || step === 'off') return Math.max(0, seconds);

  const size = stepSeconds(grid, step);
  if (!size) return Math.max(0, seconds);
  const snapped = grid.downbeat + Math.round((seconds - grid.downbeat) / size) * size;
  return Math.max(0, snapped);
}

/** "compasso.tempo", contado a partir do primeiro tempo forte (pode ser negativo antes dele). */
export function barBeatLabel(seconds: number, grid: SongGrid): string {
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
        if (time > segEnd + 0.001) break;
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
