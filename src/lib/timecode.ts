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
  // o sinal LTC é mono: o timecode nunca usa par estéreo
  const tc: Track = existing
    ? { ...existing, parentId: null, isSubgroup: false, solo: false, pan: 0, outputChannel: existing.outputChannel > 0 ? existing.outputChannel : NO_OUTPUT, outputStereo: false }
    : makeTimecodeTrack();
  if (existing && tracks[0] === existing && tc.outputChannel === existing.outputChannel && !existing.solo && existing.pan === 0 && !existing.outputStereo) return tracks;
  return [tc, ...rest];
}

/** Nome da saída "nenhuma" numa faixa de música (o timecode chama de "Sem Saída"). */
export const OFF_LABEL = 'Desligado';

export function outputLabel(channel: number, stereo = false): string {
  if (channel === NO_OUTPUT) return 'Sem Saída';
  if (channel === 0) return 'Master L/R';
  return stereo ? `Saída ${channel}/${channel + 1}` : `Saída ${channel}`;
}

/** Par estéreo começa sempre numa saída ímpar: 1/2, 3/4, 5/6… */
export function isPairStart(channel: number): boolean {
  return channel > 0 && channel % 2 === 1;
}

/** Saídas físicas que a faixa ocupa: mono usa N, estéreo usa N e N+1. */
export function trackOutputs(track: Pick<Track, 'outputChannel' | 'outputStereo'>): number[] {
  if (track.outputChannel <= 0) return [];
  return track.outputStereo ? [track.outputChannel, track.outputChannel + 1] : [track.outputChannel];
}

/** Maior saída física que a faixa precisa (0 = Master ou sem saída). */
export function lastOutput(track: Pick<Track, 'outputChannel' | 'outputStereo'>): number {
  const outs = trackOutputs(track);
  return outs.length ? outs[outs.length - 1] : 0;
}

/** Saídas físicas já ocupadas por outras faixas (o Master usa 1 e 2). */
export function usedOutputs(tracks: Track[], exceptId: string): Set<number> {
  const used = new Set<number>([1, 2]);
  for (const t of tracks) {
    if (t.id === exceptId || t.parentId) continue;
    trackOutputs(t).forEach((n) => used.add(n));
  }
  return used;
}

export interface OutputOption {
  value: number;
  stereo: boolean;
  label: string;
  disabled: boolean;
  hint?: string;
}

/**
 * Saídas que a faixa pode escolher numa interface com `count` canais.
 * Música: Master L/R, Desligado (não sai em lugar nenhum) + saídas mono 1..N, ou pares estéreo 1/2, 3/4, 5/6…
 * Timecode: sempre mono, nunca no Master nem numa saída já usada pela música.
 */
export function outputOptions(track: Track, tracks: Track[], count: number, stereo: boolean): OutputOption[] {
  const outs = (last: number) => Array.from({ length: Math.max(0, last) }, (_, i) => i + 1);
  if (isTimecodeTrackId(track.id)) {
    const used = usedOutputs(tracks, track.id);
    return [
      { value: NO_OUTPUT, stereo: false, label: 'Sem Saída', disabled: false },
      ...outs(count).map((n) => ({
        value: n,
        stereo: false,
        label: outputLabel(n),
        disabled: used.has(n),
        hint: n <= 2 ? 'Master' : used.has(n) ? 'em uso' : undefined,
      })),
    ];
  }
  const tcOut = tracks.find((t) => t.id === TIMECODE_TRACK_ID)?.outputChannel ?? NO_OUTPUT;
  return [
    { value: 0, stereo: false, label: outputLabel(0), disabled: false },
    { value: NO_OUTPUT, stereo: false, label: OFF_LABEL, disabled: false },
    ...(stereo ? outs(count - 1).filter(isPairStart) : outs(count)).map((n) => {
      const hitsTc = tcOut > 0 && trackOutputs({ outputChannel: n, outputStereo: stereo }).includes(tcOut);
      return { value: n, stereo, label: outputLabel(n, stereo), disabled: hitsTc, hint: hitsTc ? 'timecode' : undefined };
    }),
  ];
}

/** A opção é a saída atual da faixa? (Master e "Sem Saída" não têm modo mono/estéreo.) */
export function isCurrentOutput(track: Track, opt: OutputOption): boolean {
  if (track.outputChannel !== opt.value) return false;
  return opt.value <= 0 || !!track.outputStereo === opt.stereo;
}
