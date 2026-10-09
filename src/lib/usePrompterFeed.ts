import { useCallback, useEffect, useRef, useState } from 'react';
import type { PrompterSnapshot } from '@/lib/prompterTypes';
import { serverLagMs } from '@/lib/liveClock';

const POLL_MS = 1000;
const TICK_MS = 100;

export type FeedError = 'invalid_code' | 'too_many_attempts' | 'offline' | null;

export interface PrompterFeed {
  snap: PrompterSnapshot | null;
  sync: { lagMs: number; receivedAt: number };
  now: number;
  error: FeedError;
  refresh: () => Promise<void>;
}

export function usePrompterFeed(
  code: string | null, fetcher: (code: string) => Promise<PrompterSnapshot>,
): PrompterFeed {
  const [snap, setSnap] = useState<PrompterSnapshot | null>(null);
  const [sync, setSync] = useState({ lagMs: 0, receivedAt: 0 });
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState<FeedError>(null);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const refresh = useCallback(async () => {
    if (!code) return;
    try {
      const s = await fetcherRef.current(code);
      setSnap(s);
      setSync({ lagMs: serverLagMs(s.server_now, s.show.live_at), receivedAt: Date.now() });
      setError(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      if (msg === 'invalid_code') { setSnap(null); setError('invalid_code'); }
      else if (msg === 'too_many_attempts') setError('too_many_attempts');
      else setError('offline');
    }
  }, [code]);

  useEffect(() => {
    setSnap(null);
    setError(null);
    if (!code) return;
    let alive = true;
    let timer = 0;
    const loop = async () => {
      await refresh();
      if (alive) timer = window.setTimeout(loop, POLL_MS);
    };
    loop();
    return () => { alive = false; window.clearTimeout(timer); };
  }, [code, refresh]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  return { snap, sync, now, error, refresh };
}
