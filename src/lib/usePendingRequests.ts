import { useEffect, useState } from 'react';
import { directorListMusicians } from '@/lib/musicianApi';

const POLL_MS = 15000;

export function usePendingRequests(show: { showId: string; directorKey: string } | null): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!show) { setCount(0); return; }
    let alive = true;
    const check = async () => {
      try {
        const list = await directorListMusicians(show.showId, show.directorKey);
        if (alive) setCount(list.filter((m) => m.status === 'pending').length);
      } catch { /* mantém a última contagem; tenta de novo no próximo ciclo */ }
    };
    check();
    const id = setInterval(check, POLL_MS);
    return () => { alive = false; clearInterval(id); };
  }, [show]);

  return count;
}
