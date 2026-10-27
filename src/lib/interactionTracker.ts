// Rastreia se o usuário está executando um gesto ativo (arrastando clipe, rolando ativamente a timeline)
// para o trabalho pesado em segundo plano não disputar processamento durante o gesto.
// Movimento passivo do cursor (pointermove/hover) NÃO bloqueia o preparo das músicas.
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
  window.addEventListener('wheel', mark, { passive: true, capture: true });
}

const IDLE_WINDOW_MS = 80;

/** true apenas enquanto o usuário está com o botão pressionado (arrastando) ou rolando com a roda/trackpad. */
export function isUserInteracting(): boolean {
  return pointersDown > 0 || (performance.now() - lastActivity) < IDLE_WINDOW_MS;
}
