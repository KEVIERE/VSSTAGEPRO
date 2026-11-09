// Cronômetro "Falta no show" do Modo Show. Conta no relógio de parede a partir do Iniciar, sem
// depender da música: trocar, pular ou parar música não mexe nele. A duração começa igual à do
// show selecionado; dois cliques no display trocam (ex.: 2:00 para um show de duas horas).
// Fica guardado neste computador: recarregar o programa no meio do show não perde a contagem.

export type ShowClockRun = { startedAt: number; durationSec: number };
export type ShowClockState = {
  /** Duração escolhida à mão, por show (segundos). Sem entrada: vale a duração do show. */
  custom: Record<string, number>;
  /** Contagem em andamento. */
  run: ShowClockRun | null;
};

const STORAGE_KEY = 'vs.showClock';
const MAX_SEC = 24 * 3600;

/** Chave do show selecionado (a lista padrão também tem a sua). */
export function showKeyOf(activeShowId: string | null | undefined): string {
  return activeShowId || 'padrao';
}

/** "2" = 2 h · "2:30" ou "2h30" = 2 h 30 min · "90min" · "1:45:30" = h:mm:ss. Devolve segundos ou null. */
export function parseShowDuration(text: string): number | null {
  const raw = text.trim().toLowerCase().replace(/\s+/g, '');
  const mins = /^(\d{1,4})min$/.exec(raw);
  if (mins) {
    const total = Number(mins[1]) * 60;
    return total > 0 && total <= MAX_SEC ? total : null;
  }
  const t = raw.replace(/h$/, '').replace('h', ':');
  const m = /^(\d{1,2})(?::(\d{1,2}))?(?::(\d{1,2}))?$/.exec(t);
  if (!m) return null;
  const h = Number(m[1]);
  const min = m[2] === undefined ? 0 : Number(m[2]);
  const s = m[3] === undefined ? 0 : Number(m[3]);
  if (min > 59 || s > 59) return null;
  const total = h * 3600 + min * 60 + s;
  return total > 0 && total <= MAX_SEC ? total : null;
}

/** Duração que vale para o show: a escolhida à mão ou a do próprio show. */
export function durationFor(st: ShowClockState, showKey: string, showTotalSec: number): number {
  return st.custom[showKey] ?? showTotalSec;
}

/** Segundos que faltam (negativo: o show passou do tempo). */
export function remainingSec(run: ShowClockRun, now: number): number {
  return run.durationSec - (now - run.startedAt) / 1000;
}

/** h:mm:ss (ou m:ss abaixo de 1 h); passou do tempo vira "-h:mm:ss", como nos relógios de palco. */
export function clockLabel(sec: number): string {
  const over = sec < 0;
  // faltando, arredonda para cima (no Iniciar mostra a duração inteira); passando, para baixo
  const total = over ? Math.floor(-sec) : Math.ceil(sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const body = h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
  return over && total > 0 ? `-${body}` : body;
}

function valid(raw: unknown): ShowClockState {
  const empty: ShowClockState = { custom: {}, run: null };
  if (!raw || typeof raw !== 'object') return empty;
  const r = raw as Partial<ShowClockState>;
  const custom: Record<string, number> = {};
  if (r.custom && typeof r.custom === 'object') {
    for (const [k, v] of Object.entries(r.custom)) if (typeof v === 'number' && v > 0 && v <= MAX_SEC) custom[k] = v;
  }
  const run = r.run && typeof r.run.startedAt === 'number' && typeof r.run.durationSec === 'number' && r.run.durationSec > 0
    ? { startedAt: r.run.startedAt, durationSec: r.run.durationSec }
    : null;
  return { custom, run };
}

function load(): ShowClockState {
  try {
    return valid(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null'));
  } catch {
    return { custom: {}, run: null };
  }
}

let state: ShowClockState = typeof localStorage === 'undefined' ? { custom: {}, run: null } : load();
const listeners = new Set<() => void>();

function commit(next: ShowClockState) {
  state = next;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* sem armazenamento: vale só nesta sessão */ }
  listeners.forEach((fn) => fn());
}

export function getShowClock(): ShowClockState {
  return state;
}

export function subscribeShowClock(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function startShowClock(durationSec: number, now = Date.now()) {
  if (!(durationSec > 0)) return;
  commit({ ...state, run: { startedAt: now, durationSec } });
}

export function resetShowClock() {
  if (state.run) commit({ ...state, run: null });
}

/**
 * Troca a duração do show (null volta para a duração do próprio show). Com a contagem andando,
 * a nova duração vale a partir do mesmo Iniciar (o show "ganhou" ou "perdeu" tempo).
 */
export function setShowDuration(showKey: string, sec: number | null, showTotalSec: number) {
  const custom = { ...state.custom };
  if (sec === null) delete custom[showKey];
  else custom[showKey] = sec;
  const duration = sec ?? showTotalSec;
  const run = state.run && duration > 0 ? { ...state.run, durationSec: duration } : state.run;
  commit({ custom, run });
}
