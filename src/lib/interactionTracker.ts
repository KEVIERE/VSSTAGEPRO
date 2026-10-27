// Rastreia se o usuário está mexendo no mouse/trackpad (arrastando clipe, rolando a timeline,
// dando zoom) para o trabalho pesado em segundo plano (preparo instantâneo, ajuste de BPM/tom)
// ceder a vez e nunca competir pela thread principal com uma interação em andamento.
// É só um sinal leve de "ocupado agora"; não substitui o controle de cada gesto.
let lastActivity = 0;
let pointersDown = 0;

function mark() {
  lastActivity = performance.now();
}

if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', () => { pointersDown++; mark(); }, { passive: true, capture: true });
  const release = () => { pointersDown = Math.max(0, pointersDown - 1); mark(); };
  window.addEventListener('pointerup', release, { passive: true, capture: true });
  window.addEventListener('pointercancel', release, { passive: true, capture: true });
  window.addEventListener('pointermove', mark, { passive: true, capture: true });
  window.addEventListener('wheel', mark, { passive: true, capture: true });
  window.addEventListener('keydown', mark, { passive: true, capture: true });
}

const IDLE_WINDOW_MS = 220;

/** true enquanto o usuário está arrastando, rolando ou dando zoom (e por uma folga curta depois). */
export function isUserInteracting(): boolean {
  return pointersDown > 0 || (performance.now() - lastActivity) < IDLE_WINDOW_MS;
}
