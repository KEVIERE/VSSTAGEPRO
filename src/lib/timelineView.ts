import { useSyncExternalStore } from 'react';

/**
 * Janela visível da timeline (em px do zoom atual, em blocos de VISIBLE_QUANTUM), fora do React.
 * O painel grava aqui; as ondas dos clipes leem direto, sem o ClipBlock re-renderizar a cada
 * rolagem ou zoom. Gravada no mesmo instante que o zoom (flushSync do applyZoom): a render já
 * sai com zoom e janela novos juntos.
 */
export interface TimelineVisible {
  start: number;
  end: number;
}

let current: TimelineVisible = { start: 0, end: 4000 };
const listeners = new Set<() => void>();

export function getTimelineVisible(): TimelineVisible {
  return current;
}

export function setTimelineVisible(next: TimelineVisible): void {
  if (next.start === current.start && next.end === current.end) return;
  current = { start: next.start, end: next.end };
  for (const l of listeners) l();
}

export function subscribeTimelineVisible(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useTimelineVisible(): TimelineVisible {
  return useSyncExternalStore(subscribeTimelineVisible, getTimelineVisible);
}
