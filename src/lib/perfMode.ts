// Modo leve: menos efeitos de desenho (texturas geradas, brilhos com filtro, sombras de vidro) para
// o programa rodar liso nos Macs Intel, que têm vídeo mais fraco. Liga sozinho na versão Intel do
// app (num Mac Intel ou traduzida pelo Rosetta num Mac com chip Apple); dá para forçar ligado ou
// desligado em Visualizar. O som não muda: só o desenho fica mais simples.
export type PerfChoice = 'auto' | 'leve' | 'normal';

const KEY = 'vsstage.perf';

export function savedPerfChoice(): PerfChoice {
  try {
    const v = globalThis.localStorage?.getItem(KEY);
    return v === 'leve' || v === 'normal' ? v : 'auto';
  } catch {
    return 'auto';
  }
}

/** Versão Intel do app (x64). No navegador não há como saber: fica no normal. */
export function isIntelBuild(): boolean {
  return (globalThis as { vsDesktop?: { arch?: string } }).vsDesktop?.arch === 'x64';
}

/** O modo leve vale agora? */
export function perfLite(choice: PerfChoice = savedPerfChoice(), intel: boolean = isIntelBuild()): boolean {
  return choice === 'leve' || (choice === 'auto' && intel);
}

const listeners = new Set<() => void>();
let lite = false;

export function isPerfLite(): boolean {
  return lite;
}

export function subscribePerf(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Marca a página (html[data-perf="leve"]) para o CSS tirar os efeitos pesados. */
export function applyPerfMode(choice: PerfChoice = savedPerfChoice()): void {
  lite = perfLite(choice);
  const root = globalThis.document?.documentElement;
  if (root) {
    if (lite) root.dataset.perf = 'leve';
    else delete root.dataset.perf;
  }
  listeners.forEach((l) => l());
}

export function setPerfChoice(choice: PerfChoice): void {
  try { globalThis.localStorage?.setItem(KEY, choice); } catch { /* só não lembra */ }
  applyPerfMode(choice);
}
