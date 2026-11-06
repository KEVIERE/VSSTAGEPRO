import { useEffect, useState } from 'react';
import { screenShowLogo } from '@/lib/showLogo';
import { isLocalClient } from '@/lib/localNetwork';

const LOGO_REFRESH_MS = 60_000;

/**
 * Endereço da logo da banda.
 *
 * Na Rede Local ela vem no próprio estado (`snap.logo`), servida pelo Mac do diretor: a função da
 * nuvem exige a chave do diretor e respondia 403 para quem entrava pela rede, então o produtor e a
 * TV ficavam sem logo. `localLogo` é o que `producerState`/`screenState` acabaram de devolver.
 */
export function useShowLogo(code: string | null, localLogo?: { url: string; updatedAt: string | null } | null): string | null {
  const [logo, setLogo] = useState<{ url: string; updatedAt: string | null } | null>(null);
  const local = isLocalClient();

  useEffect(() => {
    if (!code || local) return;
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
  }, [code, local]);

  if (local) return localLogo?.url ?? null;
  return logo?.url ?? null;
}
