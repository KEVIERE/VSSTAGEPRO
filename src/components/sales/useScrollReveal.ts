import { useEffect, useRef, useState } from 'react';

export function useScrollReveal<T extends HTMLElement = HTMLDivElement>(options?: {
  threshold?: number;
  rootMargin?: string;
  once?: boolean;
}) {
  const threshold = options?.threshold ?? 0.01;
  const rootMargin = options?.rootMargin ?? '120px 0px 120px 0px';
  const once = options?.once ?? true;
  const ref = useRef<T>(null);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Se já estiver visível ou próximo da tela (mesmo em mobile), revela imediatamente
    const rect = el.getBoundingClientRect();
    const vh = window.innerHeight || document.documentElement.clientHeight || 800;
    if (rect.top < vh + 100) {
      setRevealed(true);
      return;
    }

    let observer: IntersectionObserver | null = null;
    if (typeof IntersectionObserver !== 'undefined') {
      observer = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) {
            setRevealed(true);
            if (once && observer) observer.unobserve(el);
          } else if (!once) {
            setRevealed(false);
          }
        },
        { threshold, rootMargin }
      );
      observer.observe(el);
    } else {
      setRevealed(true);
    }

    // Fallback de segurança contra "tela preta": garante que todo o conteúdo
    // seja revelado após breve delay caso o navegador/mobile atrase o observer
    const safetyTimer = window.setTimeout(() => {
      setRevealed(true);
    }, 900);

    return () => {
      window.clearTimeout(safetyTimer);
      observer?.disconnect();
    };
  }, [threshold, rootMargin, once]);

  return { ref, revealed };
}
