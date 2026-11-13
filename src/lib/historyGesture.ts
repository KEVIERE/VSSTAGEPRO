// Um arrasto (fader, knob) vira um passo só no Desfazer: o primeiro movimento entra no histórico
// (guardando como estava antes) e os outros, até soltar o mouse, não. Assim o ⌘Z volta o arrasto
// inteiro de uma vez, mesmo com várias faixas andando juntas.
import { useStore } from '@/store';

let active = false;
let paused = false;

export function beginHistoryGesture(): void {
  endHistoryGesture();
  active = true;
}

/** Chamar depois de cada mudança do arrasto. */
export function historyGestureStep(): void {
  if (!active || paused) return;
  useStore.temporal.getState().pause();
  paused = true;
}

export function endHistoryGesture(): void {
  if (paused) useStore.temporal.getState().resume();
  active = false;
  paused = false;
}
