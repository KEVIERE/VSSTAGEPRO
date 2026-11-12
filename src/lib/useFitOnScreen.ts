import { useLayoutEffect, useState, type RefObject } from 'react';

/**
 * Janela flutuante que sempre cabe na tela (Maestro por IA, contagem): fica a 16% do topo quando
 * cabe; senão sobe o quanto precisar; e, se nem assim couber, rola por dentro. Antes ela ficava
 * presa a 16% do topo e, em tela mais baixa, a parte de baixo saía da tela e as palavras cortavam.
 */
export function useFitOnScreen(ref: RefObject<HTMLElement>, margin = 12): { top: number; maxHeight: number } {
  const [box, setBox] = useState(() => ({ top: Math.round(window.innerHeight * 0.16), maxHeight: window.innerHeight - margin * 2 }));

  // a cada desenho: o conteúdo muda por dentro (lista de falas aberta, aviso novo, linha de intensidade)
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const vh = window.innerHeight;
    const maxHeight = vh - margin * 2;
    const height = Math.min(el.scrollHeight, maxHeight);
    const top = Math.max(margin, Math.min(Math.round(vh * 0.16), vh - margin - height));
    if (top !== box.top || maxHeight !== box.maxHeight) setBox({ top, maxHeight });
  });

  // a janela do programa mudou de tamanho
  useLayoutEffect(() => {
    const onResize = () => setBox((b) => ({ ...b, maxHeight: window.innerHeight - margin * 2 }));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [margin]);

  return box;
}
