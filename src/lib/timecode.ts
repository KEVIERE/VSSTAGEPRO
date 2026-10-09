import type { Track } from '@/types';

export const TIMECODE_TRACK_ID = 'track-timecode';
export const NO_OUTPUT = -1;
// -6 dB na escala do fader (0.8 = 0 dB, linear abaixo disso)
export const TIMECODE_DEFAULT_VOLUME = 0.8 * Math.pow(10, -6 / 20);
export const TIMECODE_COLOR = '#ff9f0a';

export function isTimecodeTrackId(id: string | null | undefined): boolean {
  return id === TIMECODE_TRACK_ID;
}

export function makeTimecodeTrack(): Track {
  return {
    id: TIMECODE_TRACK_ID, name: 'TIMECODE (LTC)', type: 'audio', color: TIMECODE_COLOR,
    volume: TIMECODE_DEFAULT_VOLUME, pan: 0, mute: false, solo: false, antiClip: false,
    isSubgroup: false, parentId: null, children: [], height: 40, visible: true,
    outputChannel: NO_OUTPUT, meterLevel: 0, clipIndicator: false, clipPeak: 0, faderLocked: true,
  };
}

/** Garante a faixa de timecode sempre em primeiro, sem solo e nunca na saída do Master. */
export function withTimecodeFirst(tracks: Track[]): Track[] {
  const existing = tracks.find((t) => t.id === TIMECODE_TRACK_ID);
  const rest = tracks.filter((t) => t.id !== TIMECODE_TRACK_ID);
  const tc: Track = existing
    ? { ...existing, parentId: null, isSubgroup: false, solo: false, pan: 0, outputChannel: existing.outputChannel > 0 ? existing.outputChannel : NO_OUTPUT }
    : makeTimecodeTrack();
  if (existing && tracks[0] === existing && tc.outputChannel === existing.outputChannel && !existing.solo && existing.pan === 0) return tracks;
  return [tc, ...rest];
}

export function outputLabel(channel: number): string {
  if (channel === NO_OUTPUT) return 'Sem Saída';
  if (channel === 0) return 'Master L/R';
  return `Saída ${channel}`;
}

/** Saídas físicas já ocupadas por outras faixas (o Master usa 1 e 2). */
export function usedOutputs(tracks: Track[], exceptId: string): Set<number> {
  const used = new Set<number>([1, 2]);
  for (const t of tracks) {
    if (t.id === exceptId || t.parentId) continue;
    if (t.outputChannel > 0) used.add(t.outputChannel);
  }
  return used;
}
