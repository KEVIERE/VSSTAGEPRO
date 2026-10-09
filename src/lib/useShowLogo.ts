import { useEffect, useState } from 'react';
import { screenShowLogo } from '@/lib/showLogo';
import { isLocalClient } from '@/lib/localNetwork';

const LOGO_REFRESH_MS = 60_000;

export function useShowLogo(code: string | null): string | null {
  const [logo, setLogo] = useState<{ url: string; updatedAt: string | null } | null>(null);
  useEffect(() => {
    if (!code || isLocalClient()) return;
    let cancelled = false;
    const load = async () => {
      try {
        const info = await screenShowLogo(code);
        if (cancelled) return;
        setLogo((prev) => {
          if (!info.url) return null;
          return prev && prev.updatedAt === info.updatedAt ? prev : { url: info.url, updatedAt: info.updatedAt };
        });
      } catch { /* mantém o logo atual */ }
    };
    load();
    const id = window.setInterval(load, LOGO_REFRESH_MS);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [code]);
  return logo?.url ?? null;
}
