import { useEffect, useRef, useState } from 'react';

/**
 * Avisa uma vez quando o bloco entra na tela (para disparar uma animação curta).
 * Sem IntersectionObserver (navegador muito antigo), já começa revelado.
 */
export function useScrollReveal<T extends HTMLElement = HTMLDivElement>(options?: {
  threshold?: number;
  rootMargin?: string;
}) {
  const ref = useRef<T>(null);
  const [revealed, setRevealed] = useState(() => typeof IntersectionObserver === 'undefined');
  const threshold = options?.threshold ?? 0;
  const rootMargin = options?.rootMargin ?? '0px 0px -15% 0px';

  useEffect(() => {
    const el = ref.current;
    if (!el || revealed) return;
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setRevealed(true);
        io.disconnect();
      }
    }, { threshold, rootMargin });
    io.observe(el);
    return () => io.disconnect();
  }, [revealed, threshold, rootMargin]);

  return { ref, revealed };
}
