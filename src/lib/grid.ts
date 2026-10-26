import type { AudioClip, Song } from '@/types';

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
}

/**
 * Extrai os instantes exatos de cada pulso de click diretamente dos picos visíveis da forma de onda.
 * Garante 100% de precisão visual: a linha vertical da grade corta dead-center no ápice do diamante do click.
 */
export function extractBeatTimesFromClickPeaks(
  peaks: number[] | undefined,
  duration: number,
  clipStartTime: number,
  expectedBpm = 120
): number[] {
  if (!peaks || peaks.length < 20 || duration <= 0) return [];
  const n = peaks.length;
  const peaksPerSec = n / duration;
  const expectedSpb = 60 / Math.max(40, Math.min(260, expectedBpm));
  const minDistanceSamples = Math.max(2, Math.round(expectedSpb * 0.45 * peaksPerSec));

  const nonZero = peaks.filter((p) => p > 0.04);
  if (nonZero.length < 5) return [];
  nonZero.sort((a, b) => a - b);
  const medianPeak = nonZero[Math.floor(nonZero.length * 0.5)];
  const threshold = Math.max(0.08, medianPeak * 0.35);

  const beatTimes: number[] = [];
  let lastIdx = -minDistanceSamples;

  for (let i = 0; i < n; i++) {
    const v = peaks[i];
    const prev = i > 0 ? peaks[i - 1] : 0;
    const next = i < n - 1 ? peaks[i + 1] : 0;

    if (v >= threshold && v >= prev && v >= next && (i - lastIdx) >= minDistanceSamples) {
      // Refinamento do centro do diamante com média ponderada:
      let sumW = 0;
      let sumPos = 0;
      const radius = 2;
      for (let r = -radius; r <= radius; r++) {
        const idx = i + r;
        if (idx >= 0 && idx < n) {
          const w = Math.max(0, peaks[idx] - threshold * 0.5);
          sumW += w;
          sumPos += idx * w;
        }
      }
      const refinedIdx = sumW > 0 ? sumPos / sumW : i;
      const timeInClip = (refinedIdx / Math.max(1, n - 1)) * duration;
      beatTimes.push(clipStartTime + timeInClip);
      lastIdx = i;
    }
  }

  return beatTimes;
}

export function songGrid(
  song: Pick<Song, 'bpm' | 'downbeat' | 'beatsPerBar'> | null | undefined,
  clickClip?: Pick<AudioClip, 'waveformPeaks' | 'duration' | 'startTime'> | null
): SongGrid | null {
  if (!song?.bpm || song.bpm <= 0) return null;
  const beat = 60 / song.bpm;
  const beatsPerBar = song.beatsPerBar ?? 4;
  const downbeat = Math.max(0, song.downbeat ?? 0);

  let beatTimes: number[] | undefined;
  if (clickClip && clickClip.waveformPeaks && clickClip.waveformPeaks.length >= 20) {
    const extracted = extractBeatTimesFromClickPeaks(
      clickClip.waveformPeaks,
      clickClip.duration,
      clickClip.startTime,
      song.bpm
    );
    if (extracted.length >= 8) {
      beatTimes = extracted;
    }
  }

  return {
    beat,
    beatsPerBar,
    downbeat,
    beatTimes,
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

  // Se houver batidas detectadas diretamente no áudio do click:
  if (grid.beatTimes && grid.beatTimes.length > 0) {
    const bTimes = grid.beatTimes;
    const beatsPerBar = grid.beatsPerBar || 4;
    const dbIndex = bTimes.findIndex((t) => Math.abs(t - grid.downbeat) < (grid.beat * 0.45));
    const firstDownbeatIdx = dbIndex >= 0 ? dbIndex : 0;

    let closest = seconds;
    let minDiff = Infinity;

    for (let i = 0; i < bTimes.length; i++) {
      const time = bTimes[i];
      if (Math.abs(seconds - time) > 3) continue;

      const relIdx = i - firstDownbeatIdx;
      const isBar = ((relIdx % beatsPerBar) + beatsPerBar) % beatsPerBar === 0;

      if (step === 'bar' && !isBar) continue;

      const diff = Math.abs(seconds - time);
      if (diff < minDiff) {
        minDiff = diff;
        closest = time;
      }
    }

    if (minDiff < Infinity) return Math.max(0, closest);
  }

  const size = stepSeconds(grid, step);
  if (!size) return Math.max(0, seconds);
  const snapped = grid.downbeat + Math.round((seconds - grid.downbeat) / size) * size;
  return Math.max(0, snapped);
}

/** "compasso.tempo", contado a partir do primeiro tempo forte (pode ser negativo antes dele). */
export function barBeatLabel(seconds: number, grid: SongGrid): string {
  if (grid.beatTimes && grid.beatTimes.length > 0) {
    const bTimes = grid.beatTimes;
    const beatsPerBar = grid.beatsPerBar || 4;
    const dbIndex = bTimes.findIndex((t) => Math.abs(t - grid.downbeat) < (grid.beat * 0.45));
    const firstDownbeatIdx = dbIndex >= 0 ? dbIndex : 0;

    let bestIdx = 0;
    let minD = Infinity;
    for (let i = 0; i < bTimes.length; i++) {
      const d = Math.abs(seconds - bTimes[i]);
      if (d < minD) {
        minD = d;
        bestIdx = i;
      }
    }
    if (minD < grid.beat * 0.45) {
      const relIdx = bestIdx - firstDownbeatIdx;
      const bar = Math.floor(relIdx / beatsPerBar);
      const beat = ((relIdx % beatsPerBar) + beatsPerBar) % beatsPerBar;
      return beat === 0 ? `${bar + 1}` : `${bar + 1}.${beat + 1}`;
    }
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
  // Se a música possuir batidas cravadas no áudio/waveform do click:
  if (grid.beatTimes && grid.beatTimes.length > 0) {
    const lines: GridLine[] = [];
    const bTimes = grid.beatTimes;
    const beatsPerBar = grid.beatsPerBar || 4;

    const dbIndex = bTimes.findIndex((t) => Math.abs(t - grid.downbeat) < (grid.beat * 0.45));
    const firstDownbeatIdx = dbIndex >= 0 ? dbIndex : 0;

    let prevBpm = Math.round(grid.beat ? 60 / grid.beat : 120);

    for (let i = 0; i < bTimes.length; i++) {
      const time = bTimes[i];
      const relIdx = i - firstDownbeatIdx;
      const isBar = ((relIdx % beatsPerBar) + beatsPerBar) % beatsPerBar === 0;
      const barNum = Math.floor(relIdx / beatsPerBar) + 1;

      // Detecta mudança de andamento relevante sustentada (>= 2.0 BPM)
      let bpmChange: number | undefined;
      if (isBar && i + beatsPerBar < bTimes.length) {
        const barDur = bTimes[i + beatsPerBar] - time;
        if (barDur > 0.2) {
          const curBarBpm = Math.round(((60 * beatsPerBar) / barDur) * 10) / 10;
          if (Math.abs(curBarBpm - prevBpm) >= 2.0) {
            let confirmed = true;
            if (i + beatsPerBar * 2 < bTimes.length) {
              const nextBarDur = bTimes[i + beatsPerBar * 2] - bTimes[i + beatsPerBar];
              const nextBpm = Math.round(((60 * beatsPerBar) / nextBarDur) * 10) / 10;
              confirmed = Math.abs(nextBpm - prevBpm) >= 1.5;
            }
            if (confirmed) {
              bpmChange = curBarBpm;
              prevBpm = curBarBpm;
            }
          }
        }
      }

      if (time >= from - 0.05 && time <= to + 0.05) {
        lines.push({
          time,
          kind: isBar ? 'bar' : 'beat',
          bar: barNum,
          bpmChange,
        });
      }
    }

    return lines;
  }

  // Modo padrão (BPM uniforme por fórmula)
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
