import { useStore, partializeHistory, historyEqual, HISTORY_LIMIT, type HistoryState } from '@/store';

let pending: { snapshot: HistoryState; past: number; future: number } | null = null;

// Agrupa tudo o que acontece entre apertar e soltar o mouse numa única ação de Desfazer.
export function beginGesture() {
  if (pending) return;
  const t = useStore.temporal.getState();
  pending = {
    snapshot: partializeHistory(useStore.getState()),
    past: t.pastStates.length,
    future: t.futureStates.length,
  };
  t.pause();
}

export function endGesture() {
  if (!pending) return;
  const p = pending;
  pending = null;
  const t = useStore.temporal.getState();
  t.resume();
  // um Desfazer/Refazer acionado pelo próprio clique já mexeu no histórico
  if (t.pastStates.length !== p.past || t.futureStates.length !== p.future) return;
  if (historyEqual(p.snapshot, partializeHistory(useStore.getState()))) return;
  useStore.temporal.setState({
    pastStates: [...t.pastStates, p.snapshot].slice(-HISTORY_LIMIT),
    futureStates: [],
  });
}
