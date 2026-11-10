// Que tipo de áudio é o clipe que vai ser masterizado (sem navegador, testável no Node):
//  - Guia e Maestro (inclusive a voz que a separação manda para a Guia): voz;
//  - clipe que toca sozinho na música (fora guia, click e maestro): a mixagem inteira, que
//    recebe a masterização completa;
//  - clipe que toca junto com outros instrumentos: stem do VS, que só é polido e mantém o
//    volume (o equilíbrio do VS é o volume de cada stem).
import type { InstrumentKind, MasterRole } from './mastering.ts';

interface TrackLike { id: string; parentId: string | null }
interface ClipLike { id: string; trackId: string; songId: string; startTime: number; duration: number; trimStart?: number; trimEnd?: number; mute?: boolean }

const VOICE_ROOTS = new Set(['track-guia', 'track-maestro']);
const CUE_ROOTS = new Set(['track-guia', 'track-maestro', 'track-click']);

const INSTRUMENT_BY_ROOT: Record<string, InstrumentKind> = {
  'track-bateria': 'bateria',
  'track-contrabaixo': 'baixo',
  'track-percussoes': 'percussao',
  'track-guitarras': 'guitarra',
  'track-violoes': 'violao',
  'track-sanfonas': 'sanfona',
  'track-teclados': 'teclado',
  'track-click': 'percussao',
};

function rootOf(trackId: string, tracks: TrackLike[]): string {
  let id = trackId;
  for (let k = 0; k < 4; k++) {
    const t = tracks.find((x) => x.id === id);
    if (!t?.parentId) return id;
    id = t.parentId;
  }
  return id;
}

function playRange(c: ClipLike): [number, number] {
  const start = c.startTime;
  const len = Math.max(0, c.duration - (c.trimStart ?? 0) - (c.trimEnd ?? 0));
  return [start, start + len];
}

export function masterRoleFor(clip: ClipLike, tracks: TrackLike[], clips: ClipLike[]): { role: MasterRole; instrument?: InstrumentKind } {
  const root = rootOf(clip.trackId, tracks);
  if (VOICE_ROOTS.has(root)) return { role: 'voice' };
  const [s0, e0] = playRange(clip);
  const together = clips.some((c) => {
    if (c.id === clip.id || c.songId !== clip.songId || c.mute) return false;
    if (CUE_ROOTS.has(rootOf(c.trackId, tracks))) return false;
    const [s1, e1] = playRange(c);
    // tocam juntos por pelo menos 1 s (ou metade do clipe, se for curto)
    return Math.min(e0, e1) - Math.max(s0, s1) >= Math.min(1, (e0 - s0) / 2);
  });
  if (!together && root !== 'track-click') return { role: 'mix' };
  return { role: 'instrument', instrument: INSTRUMENT_BY_ROOT[root] ?? 'outro' };
}
