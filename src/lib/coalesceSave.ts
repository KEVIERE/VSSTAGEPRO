// O produtor pode apertar "Salvar no projeto" várias vezes seguidas: vale a última. O programa do
// diretor espera os pedidos pararem um pouco e salva uma vez só, já com a letra mais nova. Pedido
// que chega durante um salvamento gera mais um salvamento no fim (nunca dois ao mesmo tempo).

export interface CoalesceOptions {
  /** Quanto esperar depois do último pedido antes de salvar. */
  delayMs: number;
  /** Outro salvamento em andamento (ex.: o ⌘S da pessoa): espera ele terminar. */
  busy: () => boolean;
  run: () => Promise<boolean>;
  /** Resultado do salvamento que cobriu todos os pedidos. */
  onDone: (ok: boolean) => void;
  retryMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
}

export function createCoalescedSave(opts: CoalesceOptions) {
  const setTimer = opts.setTimer ?? ((fn, ms) => window.setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((id) => window.clearTimeout(id as number));
  const retryMs = opts.retryMs ?? 1000;
  let timer: unknown = null;
  let running = false;
  let again = false;

  const arm = (ms: number) => {
    if (timer !== null) clearTimer(timer);
    timer = setTimer(fire, ms);
  };

  async function fire() {
    timer = null;
    if (opts.busy()) {
      arm(retryMs);
      return;
    }
    running = true;
    again = false;
    let ok = false;
    try {
      ok = await opts.run();
    } finally {
      running = false;
    }
    if (again) arm(opts.delayMs);
    else opts.onDone(ok);
  }

  return {
    request() {
      if (running) again = true;
      else arm(opts.delayMs);
    },
    pending: () => running || timer !== null,
  };
}
