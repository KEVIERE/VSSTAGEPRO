import type { PlaylistEntry, ShowSet, Song } from '@/types';

export const DEFAULT_SHOW_NAME = 'Show Padrão';

type ShowState = {
  playlist: PlaylistEntry[];
  shows: ShowSet[];
  activeShowId: string | null;
  defaultPlaylist: PlaylistEntry[] | null;
  songs: Song[];
};

export function activeShowName(s: Pick<ShowState, 'shows' | 'activeShowId'>): string {
  return s.shows.find((sh) => sh.id === s.activeShowId)?.name ?? DEFAULT_SHOW_NAME;
}

let seq = 0;
function entryId(): string {
  seq += 1;
  return `pl-show-${Date.now().toString(36)}-${seq}-${Math.random().toString(36).slice(2, 7)}`;
}

export function newShowId(): string {
  return `show-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Shows com a sequência do show ativo atualizada com o que está na Playlist agora. */
export function syncedShows(s: ShowState): ShowSet[] {
  if (!s.activeShowId) return s.shows;
  return s.shows.map((sh) => sh.id === s.activeShowId ? { ...sh, playlist: s.playlist } : sh);
}

/** A sequência original do projeto, esteja um show ativo ou não. */
export function projectPlaylist(s: ShowState): PlaylistEntry[] {
  return s.activeShowId ? (s.defaultPlaylist ?? []) : s.playlist;
}

export function refreshEntries(entries: PlaylistEntry[], songs: Song[]): PlaylistEntry[] {
  const byId = new Map(songs.map((sg) => [sg.id, sg]));
  return entries
    .filter((e) => byId.has(e.songId))
    .map((e, i) => ({ ...e, duration: byId.get(e.songId)!.duration || e.duration, order: i }));
}

export function entriesForSongs(songIds: string[], s: ShowState, previous: PlaylistEntry[] = []): PlaylistEntry[] {
  const known = new Map<string, PlaylistEntry>();
  for (const e of [...projectPlaylist(s), ...previous]) known.set(e.songId, e);
  const songs = new Map(s.songs.map((sg) => [sg.id, sg]));
  const out: PlaylistEntry[] = [];
  for (const songId of songIds) {
    const base = known.get(songId);
    const song = songs.get(songId);
    if (!base && !song) continue;
    out.push({
      id: entryId(),
      songId,
      name: base?.name ?? song!.name,
      order: out.length,
      bpm: base?.bpm ?? song?.bpm,
      blockId: base?.blockId ?? null,
      duration: song?.duration ?? base?.duration ?? 0,
    });
  }
  return out;
}

/** Troca a sequência da Playlist para o show escolhido (null = Show Padrão). */
export function switchShow(s: ShowState, id: string | null): Partial<ShowState> & { playlistOrder: string[] } | null {
  if (id === s.activeShowId) return null;
  const shows = syncedShows(s);
  const base = projectPlaylist(s);
  const target = id ? shows.find((sh) => sh.id === id) : null;
  if (id && !target) return null;
  const playlist = refreshEntries(target ? target.playlist : base, s.songs);
  return {
    shows,
    activeShowId: id,
    defaultPlaylist: id ? base : null,
    playlist,
    playlistOrder: playlist.map((p) => p.songId),
  };
}

export function removeSongFromShows(s: ShowState, songId: string): Pick<ShowState, 'shows' | 'defaultPlaylist'> {
  const strip = (list: PlaylistEntry[]) => list.filter((p) => p.songId !== songId).map((p, i) => ({ ...p, order: i }));
  return {
    shows: s.shows.map((sh) => ({ ...sh, playlist: strip(sh.playlist) })),
    defaultPlaylist: s.defaultPlaylist ? strip(s.defaultPlaylist) : null,
  };
}

export function normalizeShows(raw: unknown): ShowSet[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((sh): sh is ShowSet =>
    !!sh && typeof sh === 'object' && typeof sh.id === 'string' && typeof sh.name === 'string' && Array.isArray(sh.playlist));
}
