import type { LegacySongMarker, Song, SongRegion } from '@/types';

export const REGION_COLORS: Array<{ name: string; value: string }> = [
  { name: 'Verde', value: '#30d158' },
  { name: 'Azul', value: '#0a84ff' },
  { name: 'Vermelho', value: '#ff453a' },
  { name: 'Amarelo', value: '#ffd60a' },
  { name: 'Laranja', value: '#ff9f0a' },
  { name: 'Rosa', value: '#ff375f' },
  { name: 'Ciano', value: '#64d2ff' },
  { name: 'Branco', value: '#f2f2f7' },
];

const SUGGESTED_NAMES = ['Intro', 'Verso', 'Pré-Refrão', 'Refrão', 'Ponte', 'Solo', 'Final'];
const DEFAULT_BARS = 4;
const BEATS_PER_BAR = 4;
const FALLBACK_MIN_LENGTH = 0.25;
export const RESIZE_MIN_LENGTH = 0.05;

export function beatSeconds(bpm: number | undefined): number | null {
  return bpm && bpm > 0 ? 60 / bpm : null;
}

export function minRegionLength(bpm: number | undefined): number {
  return beatSeconds(bpm) ?? FALLBACK_MIN_LENGTH;
}

function defaultLength(bpm: number | undefined): number {
  const beat = beatSeconds(bpm) ?? 0.5;
  return beat * BEATS_PER_BAR * DEFAULT_BARS;
}

export function sortedRegions(regions: SongRegion[] | undefined): SongRegion[] {
  return [...(regions ?? [])].sort((a, b) => a.start - b.start);
}

export function suggestRegionStyle(existing: SongRegion[]): { name: string; color: string } {
  const used = new Set(existing.map((r) => r.name.toLowerCase()));
  const name = SUGGESTED_NAMES.find((n) => !used.has(n.toLowerCase())) ?? `Região ${existing.length + 1}`;
  const color = REGION_COLORS[existing.length % REGION_COLORS.length].value;
  return { name, color };
}

/**
 * Espaço livre para uma região nova a partir de `at`. Se `at` cair dentro de
 * uma região, começa no fim dela. Devolve null quando não cabe nem uma batida.
 */
export function freeSlotAt(song: Song, at: number): { start: number; end: number } | null {
  const regions = sortedRegions(song.regions);
  let start = Math.min(song.duration, Math.max(0, at));
  const inside = regions.find((r) => start >= r.start && start < r.end);
  if (inside) start = inside.end;
  const next = regions.find((r) => r.start >= start);
  const limit = next ? next.start : song.duration;
  const end = Math.min(limit, start + defaultLength(song.bpm));
  if (end - start < minRegionLength(song.bpm) - 1e-6) return null;
  return { start, end };
}

/** Limites que a região pode ocupar sem invadir as vizinhas. */
export function neighbourBounds(song: Song, regionId: string): { min: number; max: number } {
  const regions = sortedRegions(song.regions);
  const idx = regions.findIndex((r) => r.id === regionId);
  const prev = idx > 0 ? regions[idx - 1] : null;
  const next = idx >= 0 && idx < regions.length - 1 ? regions[idx + 1] : null;
  return { min: prev ? prev.end : 0, max: next ? next.start : song.duration };
}

export type RegionLayout = Record<string, { start: number; end: number }>;

const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }) =>
  a.start < b.end - 1e-6 && b.start < a.end - 1e-6;

/**
 * Onde cada região fica ao soltar uma região movida para `proposedStart`:
 * espaço livre → fica lá; em cima de outra → as duas trocam de lugar;
 * se a troca não couber → vai para o espaço livre mais próximo. Null se não couber em lugar nenhum.
 */
export function resolveRegionMove(song: Song, regionId: string, proposedStart: number): RegionLayout | null {
  const moving = (song.regions ?? []).find((r) => r.id === regionId);
  if (!moving) return null;
  const len = moving.end - moving.start;
  const others = sortedRegions(song.regions).filter((r) => r.id !== regionId);
  const start = Math.min(Math.max(0, proposedStart), Math.max(0, song.duration - len));
  const target = { start, end: start + len };
  const fits = (slot: { start: number; end: number }, skip: Set<string>) =>
    slot.start >= -1e-6 && slot.end <= song.duration + 1e-6 && others.every((o) => skip.has(o.id) || !overlaps(o, slot));

  const hits = others.filter((o) => overlaps(o, target));
  if (hits.length === 0) return { [regionId]: target };

  const center = start + len / 2;
  const hit = hits.reduce((best, o) => (
    Math.abs((o.start + o.end) / 2 - center) < Math.abs((best.start + best.end) / 2 - center) ? o : best
  ));
  const hitLen = hit.end - hit.start;
  const adjacent = Math.abs(moving.end - hit.start) < 1e-3 || Math.abs(hit.end - moving.start) < 1e-3;
  let swap: RegionLayout;
  if (adjacent) {
    const spanStart = Math.min(moving.start, hit.start);
    swap = moving.start < hit.start
      ? { [hit.id]: { start: spanStart, end: spanStart + hitLen }, [regionId]: { start: spanStart + hitLen, end: spanStart + hitLen + len } }
      : { [regionId]: { start: spanStart, end: spanStart + len }, [hit.id]: { start: spanStart + len, end: spanStart + len + hitLen } };
  } else {
    swap = {
      [regionId]: { start: hit.start, end: hit.start + len },
      [hit.id]: { start: moving.start, end: moving.start + hitLen },
    };
  }
  const skip = new Set([hit.id]);
  if (fits(swap[regionId], skip) && fits(swap[hit.id], skip) && !overlaps(swap[regionId], swap[hit.id])) return swap;

  let best: { start: number; end: number } | null = null;
  let cursor = 0;
  for (const b of [...others, { start: song.duration, end: song.duration }]) {
    if (b.start - cursor >= len - 1e-6) {
      const s = Math.min(Math.max(cursor, start), b.start - len);
      if (!best || Math.abs(s - start) < Math.abs(best.start - start)) best = { start: s, end: s + len };
    }
    cursor = Math.max(cursor, b.end);
  }
  return best ? { [regionId]: best } : null;
}

// Tolerância evita que um Stop logo após o início de uma região volte para ela mesma:
// apertar Stop parado no início de uma região volta para a anterior, como numa DAW.
const STOP_BACK_TOLERANCE = 0.25;

export function previousRegionStart(regions: SongRegion[] | undefined, position: number): number {
  let target = 0;
  for (const r of regions ?? []) {
    if (r.start < position - STOP_BACK_TOLERANCE && r.start > target) target = r.start;
  }
  return target;
}

export function regionAt(regions: SongRegion[] | undefined, position: number): SongRegion | null {
  return (regions ?? []).find((r) => position >= r.start && position < r.end) ?? null;
}

export function convertLegacyMarkers(markers: LegacySongMarker[], duration: number, bpm: number | undefined): SongRegion[] {
  const sorted = [...markers].sort((a, b) => a.position - b.position);
  const out: SongRegion[] = [];
  sorted.forEach((m, i) => {
    const start = Math.max(0, m.position);
    const next = sorted[i + 1];
    const end = next ? next.position : Math.min(duration || Infinity, start + defaultLength(bpm));
    if (end - start <= 0.01) return;
    out.push({ id: m.id, name: m.name, color: m.color, start, end, loop: false });
  });
  return out;
}

export const REPEAT_OPTIONS: Array<number | undefined> = [undefined, 2, 4, 8];

export function repeatLabel(repeat: number | undefined): string {
  return repeat ? `${repeat}x` : '∞';
}

export function nextRepeat(repeat: number | undefined): number | undefined {
  const i = REPEAT_OPTIONS.indexOf(repeat);
  return REPEAT_OPTIONS[(i + 1) % REPEAT_OPTIONS.length];
}

export function formatRegionTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

export function withoutLoops(song: Song): Song {
  if (!song.regions?.some((r) => r.loop)) return song;
  return { ...song, regions: song.regions.map((r) => (r.loop ? { ...r, loop: false } : r)) };
}
