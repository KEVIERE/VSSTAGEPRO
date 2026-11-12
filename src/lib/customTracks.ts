// Trilhas criadas pela pessoa (botão direito > Nova trilha). O programa reorganiza as faixas
// sozinho pelo nome dos arquivos a cada música importada; as criadas à mão ficam onde a pessoa
// pôs, com os clipes que ela colocou nelas.
import type { Track } from '@/types';
import { MAESTRO_IA_TRACK_ID } from './narrations.ts';
import { isTimecodeTrackId } from './timecode.ts';

/** Guia, Click e Maestro não têm subfaixas: a trilha nova pedida em cima delas vai para cá. */
export const FALLBACK_FOLDER_ID = 'track-outros';

/** Onde entra a trilha nova pedida em cima de `anchorId`: na pasta dela, logo depois dela. */
export function newTrackPlace(tracks: Track[], anchorId: string): { parentId: string; index: number } | null {
  const anchor = tracks.find((t) => t.id === anchorId);
  if (!anchor || isTimecodeTrackId(anchor.id)) return null;
  if (anchor.isSubgroup) return { parentId: anchor.id, index: anchor.children.length };
  const parent = anchor.parentId ? tracks.find((t) => t.id === anchor.parentId) : undefined;
  if (parent?.isSubgroup) {
    const at = parent.children.indexOf(anchor.id);
    return { parentId: parent.id, index: at < 0 ? parent.children.length : at + 1 };
  }
  const folder = tracks.find((t) => t.id === FALLBACK_FOLDER_ID && t.isSubgroup)
    ?? tracks.find((t) => t.isSubgroup && !isTimecodeTrackId(t.id));
  return folder ? { parentId: folder.id, index: folder.children.length } : null;
}

const key = (name: string) => name.trim().toLocaleLowerCase('pt-BR');

/** Nome que ainda não existe na pasta: "Nova trilha", "Nova trilha 2"... */
export function uniqueTrackName(tracks: Track[], parentId: string, wanted: string): string {
  const base = wanted.trim() || 'Nova trilha';
  const taken = new Set(tracks.filter((t) => t.parentId === parentId).map((t) => key(t.name)));
  if (!taken.has(key(base))) return base;
  for (let n = 2; ; n++) {
    const name = `${base} ${n}`;
    if (!taken.has(key(name))) return name;
  }
}

/** Só sai trilha de dentro de pasta. Pastas, Guia, Click, Maestro, Timecode e Maestro IA ficam. */
export function canDeleteTrack(track: Track | undefined): boolean {
  return !!track && !!track.parentId && !track.isSubgroup && !isTimecodeTrackId(track.id) && track.id !== MAESTRO_IA_TRACK_ID;
}

/** Trilhas criadas à mão que continuam valendo: dentro de uma pasta que existe. */
export function customTrackIds(tracks: Track[]): Set<string> {
  const folders = new Set(tracks.filter((t) => t.isSubgroup).map((t) => t.id));
  return new Set(tracks.filter((t) => t.custom && !t.isSubgroup && t.parentId && folders.has(t.parentId)).map((t) => t.id));
}

/**
 * Ordem das subfaixas de uma pasta depois de reorganizar: as automáticas na ordem nova e cada
 * criada à mão logo depois da faixa que vinha antes dela (ou no começo, se era a primeira).
 */
export function mergeCustomChildren(previous: string[], auto: string[], custom: Set<string>): string[] {
  const out = auto.filter((id) => !custom.has(id));
  let anchor: string | null = null;
  for (const id of previous) {
    if (custom.has(id)) {
      out.splice(anchor ? out.indexOf(anchor) + 1 : 0, 0, id);
      anchor = id;
    } else if (out.includes(id)) {
      anchor = id;
    }
  }
  return out;
}
