// Caderno por parte de medley: cada parte de uma música fatiada tem seu próprio caderno,
// guardado com a chave "idDaMúsica~idDaParte" (o banco aceita qualquer texto como song_id).
import type { SetlistPart, SetlistSong, SheetInfo, ShowLive } from './musicianTypes';

const SEP = '~';

export const partKey = (songId: string, partId: string) => `${songId}${SEP}${partId}`;

export function splitKey(key: string): { songId: string; partId: string | null } {
  const i = key.indexOf(SEP);
  return i < 0 ? { songId: key, partId: null } : { songId: key.slice(0, i), partId: key.slice(i + 1) };
}

export const isMedleySong = (song: SetlistSong | null | undefined): boolean => (song?.parts?.length ?? 0) > 1;

/** Parte do medley tocando agora: pelo id enviado pelo diretor ou pela posição na música. */
export function currentPart(song: SetlistSong | null | undefined, live: ShowLive | null, time: number): SetlistPart | null {
  if (!song || !isMedleySong(song)) return null;
  const parts = song.parts!;
  if (live?.sliceId && live.currentSongId === song.id) {
    const byId = parts.find((p) => p.id === live.sliceId);
    if (byId) return byId;
  }
  return parts.find((p) => time >= p.start && time < p.end) ?? parts[parts.length - 1];
}

/**
 * Caderno a mostrar para a música no ar. Num medley é o da parte tocando; se essa parte ainda
 * não tem caderno mas a música inteira tem (feito antes das partes), mostra o da música.
 */
export function liveSheetKey(song: SetlistSong | null | undefined, live: ShowLive | null, time: number, sheets: SheetInfo[]): string | null {
  if (!song) return null;
  const part = currentPart(song, live, time);
  if (!part) return song.id;
  const key = partKey(song.id, part.id);
  const has = (k: string) => sheets.some((s) => s.song_id === k);
  return !has(key) && has(song.id) ? song.id : key;
}

/** Música e parte (se houver) de uma chave de caderno. */
export function resolveKey(songs: Map<string, SetlistSong>, key: string | null): { song: SetlistSong | undefined; part: SetlistPart | null } {
  if (!key) return { song: undefined, part: null };
  const { songId, partId } = splitKey(key);
  const song = songs.get(songId);
  return { song, part: (partId && song?.parts?.find((p) => p.id === partId)) || null };
}
