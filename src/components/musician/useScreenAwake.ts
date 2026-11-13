import { useEffect } from 'react';

/**
 * Tela acesa enquanto a Área do Músico está aberta: o músico lê a cifra sem tocar no aparelho, e o
 * celular apagava no meio da música. Usa a trava de tela do navegador (Chrome do Android, Safari
 * do iPhone a partir do iOS 16.4). O navegador solta a trava ao trocar de aba ou bloquear a tela;
 * ela é pedida de novo quando a página volta e no próximo toque (pedido recusado também).
 */
export function useScreenAwake() {
  useEffect(() => {
    if (!('wakeLock' in navigator)) return;
    let alive = true;
    let asking = false;
    let lock: WakeLockSentinel | null = null;
    const ask = async () => {
      if (!alive || asking || document.visibilityState !== 'visible' || (lock && !lock.released)) return;
      asking = true;
      try {
        const got = await navigator.wakeLock.request('screen');
        if (alive) lock = got;
        else void got.release().catch(() => {});
      } catch { /* recusado (economia de bateria, página em segundo plano): tenta no próximo toque */ }
      finally { asking = false; }
    };
    const again = () => { void ask(); };
    void ask();
    document.addEventListener('visibilitychange', again);
    window.addEventListener('pointerdown', again, { passive: true });
    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', again);
      window.removeEventListener('pointerdown', again);
      if (lock) void lock.release().catch(() => {});
    };
  }, []);
}
