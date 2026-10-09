import { useCallback, useEffect, useRef } from 'react';

const CLOSE_DELAY_MS = 250;

/** Fecha um menu pouco depois que o mouse sai dele, como nas DAWs; voltar a tempo cancela. */
export function useHoverDismiss(open: boolean, onClose: () => void, delay = CLOSE_DELAY_MS) {
  const timer = useRef<number | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  const cancel = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const schedule = useCallback(() => {
    if (timer.current !== null) return;
    timer.current = window.setTimeout(() => {
      timer.current = null;
      // digitando num campo do menu: não fecha embaixo do usuário
      if (document.activeElement instanceof HTMLInputElement) return;
      closeRef.current();
    }, delay);
  }, [delay]);

  useEffect(() => {
    if (!open) cancel();
  }, [open, cancel]);

  useEffect(() => cancel, [cancel]);

  return { cancel, schedule };
}
