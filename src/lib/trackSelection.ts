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
/**
 * Faixas que andam juntas quando o usuário mexe numa: se ela faz parte de uma seleção de várias,
 * todas as selecionadas; senão, só ela.
 */
export function linkedTrackIds(selected: string[], id: string): string[] {
  return selected.length > 1 && selected.includes(id) ? selected : [id];
}

/**
 * Volume novo de cada faixa ligada quando o fader de `id` vai para `volume`: as outras andam o
 * mesmo tanto (cada uma do ponto onde está, dentro de 0 a 1,5). Faixa com o fader travado fica.
 */
export function linkedVolumes(
  tracks: { id: string; volume: number; faderLocked?: boolean }[],
  ids: string[],
  id: string,
  volume: number,
): Map<string, number> {
  const clamp = (v: number) => Math.max(0, Math.min(1.5, Math.round(v * 1000) / 1000));
  const out = new Map<string, number>();
  const moved = tracks.find((t) => t.id === id);
  if (!moved) return out;
  const delta = clamp(volume) - moved.volume;
  for (const t of tracks) {
    if (!ids.includes(t.id) || t.faderLocked) continue;
    out.set(t.id, t.id === id ? clamp(volume) : clamp(t.volume + delta));
  }
  return out;
}

export function trackOrderOnScreen(attr: 'data-track-row' | 'data-mixer-track'): string[] {
  if (typeof document === 'undefined') return [];
  return [...document.querySelectorAll<HTMLElement>(`[${attr}]`)].map((el) => el.getAttribute(attr) ?? '').filter(Boolean);
}
