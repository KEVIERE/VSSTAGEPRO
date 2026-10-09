import { useCallback, useEffect, useState } from 'react';

const KEY = 'playlistCollapsed';

function load(): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

/** Músicas recolhidas na playlist expandida; a que entra no ar abre sozinha. */
export function useCollapsedRows(currentSongId: string | null) {
  const [collapsed, setCollapsed] = useState<Set<string>>(load);

  const update = useCallback((fn: (prev: Set<string>) => Set<string>) => {
    setCollapsed((prev) => {
      const next = fn(prev);
      localStorage.setItem(KEY, JSON.stringify([...next]));
      return next;
    });
  }, []);

  useEffect(() => {
    if (!currentSongId) return;
    update((prev) => {
      if (!prev.has(currentSongId)) return prev;
      const next = new Set(prev);
      next.delete(currentSongId);
      return next;
    });
  }, [currentSongId, update]);

  const toggle = useCallback((songId: string) => update((prev) => {
    const next = new Set(prev);
    if (next.has(songId)) next.delete(songId);
    else next.add(songId);
    return next;
  }), [update]);

  const setAll = useCallback((songIds: string[], collapse: boolean) => update((prev) => {
    const next = new Set(prev);
    for (const id of songIds) {
      if (collapse) next.add(id);
      else next.delete(id);
    }
    return next;
  }), [update]);

  return { collapsed, toggle, setAll };
}
