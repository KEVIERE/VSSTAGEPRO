import { bpmAdjustToAlpha } from '@/lib/timeStretch';
import type { MedleyPart, Song } from '@/types';

export interface MedleySlice extends MedleyPart {
  end: number;
}

export interface PlaybackParams {
  bpmAdjust: number;
  tuner: number;
}

const MIN_SLICE = 1;

export function isMedley(song: Song | undefined): boolean {
  return !!song?.medley && song.medley.length > 1;
}

export function sortedParts(parts: MedleyPart[] | undefined): MedleyPart[] {
  return [...(parts ?? [])].sort((a, b) => a.start - b.start);
}

export function medleySlices(song: Song): MedleySlice[] {
  if (!isMedley(song)) return [];
  const parts = sortedParts(song.medley);
  return parts.map((p, i) => ({ ...p, end: i < parts.length - 1 ? parts[i + 1].start : song.duration }));
}

export function sliceAt(slices: MedleySlice[], position: number): MedleySlice | null {
  if (slices.length === 0) return null;
  return slices.find((s) => position >= s.start && position < s.end) ?? slices[slices.length - 1];
}

export function isSliceEnabled(part: MedleyPart): boolean {
  return part.enabled !== false;
}

export function sliceParams(song: Song, part: MedleyPart | null | undefined): PlaybackParams {
  return {
    bpmAdjust: part?.bpmAdjust ?? song.bpmAdjust ?? 0,
    tuner: part?.tuner ?? song.tuner ?? 0,
  };
}

export function paramsAt(song: Song, position: number): PlaybackParams {
  return sliceParams(song, sliceAt(medleySlices(song), position));
}

/** Alguma fatia toca com BPM/tom diferente do resto da música. */
export function hasSliceParams(song: Song | undefined): boolean {
  if (!song || !isMedley(song)) return false;
  const base = sliceParams(song, null);
  return medleySlices(song).some((s) => {
    const p = sliceParams(song, s);
    return p.bpmAdjust !== base.bpmAdjust || p.tuner !== base.tuner;
  });
}

export function nextSliceStart(song: Song, position: number): number | null {
  const next = medleySlices(song).find((s) => s.start > position + 1e-6);
  return next ? next.start : null;
}

/** Onde a música começa: na primeira fatia marcada. */
export function entryPoint(song: Song | undefined): number {
  if (!song || !isMedley(song)) return 0;
  return medleySlices(song).find(isSliceEnabled)?.start ?? 0;
}

/** Fim do que vai tocar: fim da última fatia marcada. */
export function playableEnd(song: Song): number {
  const slices = medleySlices(song);
  if (slices.length === 0) return song.duration;
  const enabled = slices.filter(isSliceEnabled);
  return enabled.length > 0 ? enabled[enabled.length - 1].end : song.duration;
}

/** Salto sobre fatias desmarcadas que vêm logo depois da fatia atual. */
export function skipJumpAt(song: Song, position: number): { boundary: number; destId: string; destStart: number } | null {
  const slices = medleySlices(song);
  const idx = slices.findIndex((s) => position >= s.start && position < s.end);
  if (idx < 0 || idx >= slices.length - 1 || isSliceEnabled(slices[idx + 1])) return null;
  const dest = slices.slice(idx + 2).find(isSliceEnabled);
  if (!dest) return null;
  return { boundary: slices[idx].end, destId: dest.id, destStart: dest.start };
}

/** Limites para mover um corte sem encostar nos vizinhos. */
export function cutBounds(song: Song, partId: string): { min: number; max: number } {
  const parts = sortedParts(song.medley);
  const idx = parts.findIndex((p) => p.id === partId);
  const prev = idx > 0 ? parts[idx - 1] : null;
  const next = idx >= 0 && idx < parts.length - 1 ? parts[idx + 1] : null;
  return { min: (prev ? prev.start : 0) + MIN_SLICE, max: (next ? next.start : song.duration) - MIN_SLICE };
}

function newPartId(): string {
  return `part-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
}

/** Partes do medley depois de um corte em `at`; null se o corte ficar colado em outro. */
export function partsWithCut(song: Song, at: number): MedleyPart[] | null {
  const parts = song.medley && song.medley.length > 0
    ? sortedParts(song.medley)
    : [{ id: newPartId(), name: 'Música 1', start: 0 }];
  if (at < MIN_SLICE || at > song.duration - MIN_SLICE) return null;
  if (parts.some((p) => Math.abs(p.start - at) < MIN_SLICE)) return null;
  const used = new Set(parts.map((p) => p.name.toLowerCase()));
  let n = parts.length + 1;
  while (used.has(`música ${n}`)) n++;
  return sortedParts([...parts, { id: newPartId(), name: `Música ${n}`, start: at }]);
}

export function sliceDuration(song: Song, slice: MedleySlice): number {
  return (slice.end - slice.start) * bpmAdjustToAlpha(sliceParams(song, slice).bpmAdjust);
}

/** Tempo real da música no show: só fatias marcadas, cada uma no seu BPM. */
export function playedDuration(song: Song | undefined, fallback: number): number {
  if (!song) return fallback;
  if (!isMedley(song)) return song.duration * bpmAdjustToAlpha(song.bpmAdjust ?? 0);
  return medleySlices(song).filter(isSliceEnabled).reduce((acc, s) => acc + sliceDuration(song, s), 0);
}

export function currentAndNextSlice(song: Song | undefined, position: number): { current: MedleySlice | null; next: MedleySlice | null } {
  if (!song || !isMedley(song)) return { current: null, next: null };
  const slices = medleySlices(song);
  const current = sliceAt(slices, position);
  const idx = current ? slices.indexOf(current) : -1;
  const next = slices.slice(idx + 1).find(isSliceEnabled) ?? null;
  return { current, next };
}
