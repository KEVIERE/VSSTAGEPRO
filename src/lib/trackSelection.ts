// Seleção de várias faixas, como numa DAW: clique escolhe uma; ⌘ + clique soma ou tira; Shift +
// clique seleciona da faixa clicada antes (a âncora) até a clicada agora, na ordem da tela.
// Sem tela, para dar para testar; a ordem vem de quem chama (a timeline ou o mixer).

export type TrackPickMode = 'single' | 'toggle' | 'range';

export function trackPickMode(e: { metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean }): TrackPickMode {
  if (e.shiftKey) return 'range';
  if (e.metaKey || e.ctrlKey) return 'toggle';
  return 'single';
}

/**
 * Próxima seleção. `anchor` é a faixa de onde o Shift conta (a última clicada sem Shift).
 * Devolve as faixas selecionadas e a âncora nova.
 */
export function nextTrackSelection(
  prev: string[],
  anchor: string | null,
  clicked: string,
  mode: TrackPickMode,
  order: string[],
): { ids: string[]; anchor: string | null } {
  if (mode === 'toggle') {
    if (prev.includes(clicked)) {
      const ids = prev.filter((id) => id !== clicked);
      return { ids, anchor: ids.length ? (anchor && ids.includes(anchor) ? anchor : ids[ids.length - 1]) : null };
    }
    return { ids: [...prev, clicked], anchor: clicked };
  }
  if (mode === 'range' && anchor) {
    const a = order.indexOf(anchor);
    const b = order.indexOf(clicked);
    if (a >= 0 && b >= 0) return { ids: order.slice(Math.min(a, b), Math.max(a, b) + 1), anchor };
  }
  return { ids: [clicked], anchor: clicked };
}

/** A ordem das faixas como aparecem na tela, pelo atributo que cada linha (ou canal) leva. */
export function trackOrderOnScreen(attr: 'data-track-row' | 'data-mixer-track'): string[] {
  if (typeof document === 'undefined') return [];
  return [...document.querySelectorAll<HTMLElement>(`[${attr}]`)].map((el) => el.getAttribute(attr) ?? '').filter(Boolean);
}
