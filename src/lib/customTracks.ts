// Trilhas criadas pela pessoa (botão direito > Nova trilha). O programa reorganiza as faixas
// sozinho pelo nome dos arquivos a cada música importada; as criadas à mão ficam onde a pessoa
// pôs, com os clipes que ela colocou nelas.
import type { AudioClip, Track } from '@/types';
import { MAESTRO_IA_TRACK_ID } from './narrations.ts';
import { routeByName } from './nameRouter.ts';
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

// Instrumento de cada pasta quando o nome do arquivo não diz qual é.
const FOLDER_INSTRUMENT: Record<string, string> = {
  'track-bateria': 'Bateria',
  'track-contrabaixo': 'Contrabaixo',
  'track-percussoes': 'Percussão',
  'track-guitarras': 'Guitarra',
  'track-violoes': 'Violão',
  'track-sanfonas': 'Sanfona',
  'track-teclados': 'Teclado',
  'track-solos': 'Solo',
  'track-outros': 'Extra',
};

const plain = (name: string) => name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

/** Instrumento do clipe dentro da pasta: o que a IA ou o nome do arquivo dizem, se é desta pasta; senão o da pasta. */
export function folderInstrumentName(folder: Track, clip: Pick<AudioClip, 'fileName' | 'name'>, hint?: string | null): string {
  if (hint && hint.trim()) return hint.trim();
  const route = routeByName(clip.fileName) ?? routeByName(clip.name);
  if (route && route.target === folder.id) return route.instrumentName;
  return FOLDER_INSTRUMENT[folder.id] ?? folder.name;
}

export type InstrumentTrackPlan = { trackId: string } | { create: { name: string } };

/**
 * Pasta nunca recebe áudio: o clipe vai para a trilha do instrumento dentro dela, como na
 * importação. Usa a primeira "Violão 1", "Violão 2"... que ainda não tem áudio nesta música
 * (nunca um áudio por cima do outro); se todas têm, cria a próxima da sequência.
 * Devolve null quando `folderId` não é pasta.
 */
export function instrumentTrackIn(
  tracks: Track[],
  clips: Pick<AudioClip, 'id' | 'songId' | 'trackId'>[],
  folderId: string,
  clip: Pick<AudioClip, 'id' | 'songId' | 'fileName' | 'name'>,
  hint?: string | null,
): InstrumentTrackPlan | null {
  const folder = tracks.find((t) => t.id === folderId && t.isSubgroup);
  if (!folder) return null;
  const instrument = folderInstrumentName(folder, clip, hint);
  const base = plain(instrument);
  const busy = new Set(clips.filter((c) => c.songId === clip.songId && c.id !== clip.id).map((c) => c.trackId));
  let last = 0;
  let free: { id: string; n: number } | null = null;
  for (const id of folder.children) {
    const t = tracks.find((x) => x.id === id);
    const m = t ? plain(t.name).match(/^(.*?)\s*(\d+)$/) : null;
    if (!t || !m || m[1] !== base) continue;
    const n = Number(m[2]);
    last = Math.max(last, n);
    if (!busy.has(t.id) && (!free || n < free.n)) free = { id: t.id, n };
  }
  if (free) return { trackId: free.id };
  return { create: { name: uniqueTrackName(tracks, folderId, `${instrument} ${last + 1}`) } };
}

/** Nome da cópia: o próximo número da sequência do instrumento ("Violão 2" vira "Violão 3"). */
export function duplicateTrackName(tracks: Track[], parentId: string, name: string): string {
  const m = name.trim().match(/^(.*?)\s*(\d+)$/);
  const instrument = (m ? m[1] : name).trim() || 'Nova trilha';
  const base = plain(instrument);
  let last = m ? Number(m[2]) : 1;
  for (const t of tracks) {
    if (t.parentId !== parentId) continue;
    const other = plain(t.name).match(/^(.*?)\s*(\d+)$/);
    if (other && other[1] === base) last = Math.max(last, Number(other[2]));
  }
  return uniqueTrackName(tracks, parentId, `${instrument} ${last + 1}`);
}
