import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '@/store';
import type { SavedShow } from '@/lib/useLiveBroadcast';
import type { ProjectState } from '@/types';
import { directorLyricsAck, directorLyricsGet, directorLyricsRestore } from '@/lib/prompterApi';

const POLL_MS = 15000;

export interface ProjectLyricsSync {
  /** O produtor pediu "Salvar no projeto" e os mapas já estão no projeto, faltando gravar o arquivo. */
  received: { songs: number; at: number } | null;
  dismiss: () => void;
  songsInProject: number;
}

export function useProjectLyricsSync(show: SavedShow | null): ProjectLyricsSync {
  const [received, setReceived] = useState<ProjectLyricsSync['received']>(null);
  const lyricMaps = useStore((s) => s.lyricMaps);
  const ownMaps = useRef<ProjectState['lyricMaps'] | null>(null);
  const restoredFor = useRef<ProjectState['lyricMaps'] | null>(null);

  // Ao abrir um projeto com mapas, devolve ao show as letras que ainda não estão online.
  useEffect(() => {
    if (!show || lyricMaps === ownMaps.current || lyricMaps === restoredFor.current) return;
    restoredFor.current = lyricMaps;
    const songIds = new Set(useStore.getState().songs.map((s) => s.id));
    const mine = Object.fromEntries(Object.entries(lyricMaps).filter(([id]) => songIds.has(id)));
    directorLyricsRestore(show.showId, show.directorKey, mine).catch(() => { restoredFor.current = null; });
  }, [show, lyricMaps]);

  useEffect(() => {
    if (!show) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await directorLyricsGet(show.showId, show.directorKey);
        if (cancelled || !res.requestedAt) return;
        if (res.savedAt && Date.parse(res.savedAt) >= Date.parse(res.requestedAt)) return;
        const st = useStore.getState();
        const songIds = new Set(st.songs.map((s) => s.id));
        const next: ProjectState['lyricMaps'] = { ...st.lyricMaps };
        for (const l of res.lyrics) {
          if (!songIds.has(l.song_id)) continue;
          if (l.pages.length > 0) next[l.song_id] = l.pages;
          else delete next[l.song_id];
        }
        ownMaps.current = next;
        st.setLyricMaps(next);
        await directorLyricsAck(show.showId, show.directorKey);
        if (!cancelled) setReceived({ songs: Object.keys(next).length, at: Date.now() });
      } catch {
        // Sem conexão: tenta de novo no próximo ciclo.
      }
    };
    tick();
    const id = window.setInterval(tick, POLL_MS);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [show]);

  const dismiss = useCallback(() => setReceived(null), []);
  return { received, dismiss, songsInProject: Object.keys(lyricMaps).length };
}
