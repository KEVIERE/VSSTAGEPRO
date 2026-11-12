import { useLayoutEffect, useState, type RefObject } from 'react';

/**
 * Janela flutuante que sempre cabe inteira na tela (Maestro por IA, contagem), sem cortar nada e
 * sem barra de rolagem: fica a 16% do topo quando cabe; senão sobe o quanto precisar; e, se nem
 * assim couber (tela muito baixa), a janela inteira é reduzida na proporção certa para caber.
 * A redução é visual (transform), então a altura medida é sempre a natural do conteúdo.
 */
export function useFitOnScreen(ref: RefObject<HTMLElement>, margin = 12): { top: number; scale: number } {
  const [box, setBox] = useState(() => ({ top: Math.round(window.innerHeight * 0.16), scale: 1 }));
  const [, setViewport] = useState(() => window.innerHeight);

  // a cada desenho: o conteúdo muda por dentro (lista de falas aberta, aviso novo, linha de intensidade)
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const vh = window.innerHeight;
    const natural = el.offsetHeight;
    if (!natural) return;
    const scale = Math.min(1, (vh - margin * 2) / natural);
    const top = Math.max(margin, Math.min(Math.round(vh * 0.16), vh - margin - natural * scale));
    if (top !== box.top || Math.abs(scale - box.scale) > 0.001) setBox({ top, scale });
  });

  // a janela do programa mudou de tamanho: desenha de novo para medir
  useLayoutEffect(() => {
    const onResize = () => setViewport(window.innerHeight);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return box;
}
