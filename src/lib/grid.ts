import type { Song } from '@/types';

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
}

export function songGrid(song: Pick<Song, 'bpm' | 'downbeat' | 'beatsPerBar'> | null | undefined): SongGrid | null {
  if (!song?.bpm || song.bpm <= 0) return null;
  const beat = 60 / song.bpm;
  return { beat, beatsPerBar: song.beatsPerBar ?? 4, downbeat: Math.max(0, song.downbeat ?? 0) };
}

function stepSeconds(grid: SongGrid, step: SnapStep): number | null {
  if (step === 'bar') return grid.beat * grid.beatsPerBar;
  if (step === 'beat') return grid.beat;
  if (step === 'half') return grid.beat / 2;
  return null;
}

export function snapTime(seconds: number, grid: SongGrid | null, step: SnapStep): number {
  if (!grid) return Math.max(0, seconds);
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
}

/** Linhas visíveis no intervalo, mais densas conforme o zoom (px por segundo). */
export function gridLines(grid: SongGrid, from: number, to: number, pxPerSecond: number): GridLine[] {
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
