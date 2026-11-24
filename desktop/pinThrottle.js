// Freio contra adivinhar o PIN da rede local, sem nunca trancar quem digita o PIN certo.
//
// Numa mesa de som não existe "espere 5 minutos": o PIN certo sempre entra. Por isso nada é
// recusado por excesso de erros. Depois de alguns erros, cada tentativa daquele aparelho espera até
// 2 segundos e elas passam uma de cada vez. Quem errou duas vezes não sente nada; quem testa os
// 1 milhão de PINs leva semanas em vez de minutos.
const FREE_FAILURES = 5;
const STEP_MS = 500;
const MAX_DELAY_MS = 2000;
const FAILURE_WINDOW_MS = 5 * 60_000;
// Muitos erros na rede toda (vários aparelhos tentando juntos): todo mundo passa pela fila.
const GLOBAL_WINDOW_MS = 60_000;
const GLOBAL_FAILURES = 30;
const GLOBAL_DELAY_MS = 1000;
// Tentativas ao mesmo tempo de um único aparelho. Sem isso, um só enchia a fila dos outros.
const MAX_PENDING = 3;

const BUSY = Symbol('pin_busy');

class PinThrottle {
  constructor({ now = Date.now, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
    this.now = now;
    this.sleep = sleep;
    this.failures = new Map();
    this.recent = [];
    this.pending = new Map();
    this.queue = Promise.resolve();
  }

  count(addr) {
    const f = this.failures.get(addr);
    if (!f) return 0;
    if (this.now() - f.last >= FAILURE_WINDOW_MS) { this.failures.delete(addr); return 0; }
    return f.count;
  }

  globalCount() {
    const since = this.now() - GLOBAL_WINDOW_MS;
    while (this.recent.length && this.recent[0] <= since) this.recent.shift();
    return this.recent.length;
  }

  /** Quanto esta tentativa espera antes de ser conferida. */
  delayFor(addr) {
    const c = this.count(addr);
    const own = c < FREE_FAILURES ? 0 : Math.min(MAX_DELAY_MS, STEP_MS * (c - FREE_FAILURES + 1));
    return this.globalCount() >= GLOBAL_FAILURES ? Math.max(own, GLOBAL_DELAY_MS) : own;
  }

  /**
   * Erro de PIN ou senha. Um acerto não zera a conta: senão bastava entrar com o código fixo da
   * tela do palco entre uma tentativa e outra. A conta some sozinha depois de 5 minutos sem erro.
   */
  note(addr) {
    const now = this.now();
    this.failures.set(addr, { count: this.count(addr) + 1, last: now });
    this.globalCount();
    this.recent.push(now);
  }

  clear() {
    this.failures.clear();
    this.recent = [];
  }

  /** Roda a conferência na vez dela. Devolve `PinThrottle.BUSY` se o aparelho passou do limite de tentativas simultâneas. */
  async run(addr, check) {
    const open = this.pending.get(addr) || 0;
    if (open >= MAX_PENDING) return BUSY;
    this.pending.set(addr, open + 1);
    try {
      if (this.delayFor(addr) === 0) return await check();
      const turn = this.queue.then(async () => {
        await this.sleep(this.delayFor(addr));
        return check();
      });
      this.queue = turn.catch(() => {});
      return await turn;
    } finally {
      const left = (this.pending.get(addr) || 1) - 1;
      if (left > 0) this.pending.set(addr, left);
      else this.pending.delete(addr);
    }
  }
}

PinThrottle.BUSY = BUSY;

module.exports = { PinThrottle, FREE_FAILURES, MAX_DELAY_MS, MAX_PENDING };
