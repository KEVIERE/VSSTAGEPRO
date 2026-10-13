import { useEffect, useRef, useState } from 'react';

export function useScrollReveal<T extends HTMLElement = HTMLDivElement>(options?: {
  threshold?: number;
  rootMargin?: string;
  once?: boolean;
}) {
  const isMobile = typeof window !== 'undefined' && (
    window.innerWidth < 768 ||
    /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
  );

  const threshold = options?.threshold ?? 0.01;
  const rootMargin = options?.rootMargin ?? '120px 0px 120px 0px';
  const once = options?.once ?? true;
  const ref = useRef<T>(null);
  // No mobile, SEMPRE começa revealed = true para nunca gerar tela preta!
  const [revealed, setRevealed] = useState(() => isMobile);

  useEffect(() => {
    if (isMobile) {
      setRevealed(true);
      return;
    }

    const el = ref.current;
    if (!el) return;

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

    const safetyTimer = window.setTimeout(() => {
      setRevealed(true);
    }, 500);

    return () => {
      window.clearTimeout(safetyTimer);
      observer?.disconnect();
    };
  }, [threshold, rootMargin, once, isMobile]);

  return { ref, revealed };
}
