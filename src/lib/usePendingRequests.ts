import { useCallback, useEffect, useState } from 'react';
import { directorListMusicians } from '@/lib/musicianApi';
import type { DirectorMusician } from '@/lib/musicianTypes';

const POLL_MS = 15000;

type ShowKey = { showId: string; directorKey: string } | null;

/** Músicos que criaram a conta e pediram para entrar no show: o diretor aceita ou recusa. */
export function usePendingRequests(show: ShowKey): { pending: DirectorMusician[]; refresh: () => void } {
  const [pending, setPending] = useState<DirectorMusician[]>([]);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!show) { setPending([]); return; }
    let alive = true;
    const check = async () => {
      try {
        const list = await directorListMusicians(show.showId, show.directorKey);
        if (alive) setPending(list.filter((m) => m.status === 'pending'));
      } catch { /* mantém a última lista; tenta de novo no próximo ciclo */ }
    };
    check();
    const id = setInterval(check, POLL_MS);
    return () => { alive = false; clearInterval(id); };
  }, [show, tick]);

  return { pending, refresh };
}
