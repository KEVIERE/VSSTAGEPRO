// Skins do programa (Visualizar > Skins). A Analógica é a padrão: a mesa de aço, creme e âmbar
// de sempre. As outras trocam as cores (variáveis --lg-* do index.css) e o desenho das peças de
// mesa (console-*), no fim do index.css. A escolha é de quem usa o computador, não do projeto.

export type SkinId = 'analogica' | 'grafite';

export const SKINS: { id: SkinId; label: string; hint: string }[] = [
  { id: 'analogica', label: 'Analógica (padrão)', hint: 'Mesa de aço, fita crepe e teclas âmbar' },
  { id: 'grafite', label: 'Grafite', hint: 'Painel grafite escovado, visores azuis e faders cromados' },
];

export const DEFAULT_SKIN: SkinId = 'analogica';
const KEY = 'vsstage.skin';

export function isSkin(v: unknown): v is SkinId {
  return typeof v === 'string' && SKINS.some((s) => s.id === v);
}

export function savedSkin(): SkinId {
  try {
    const v = globalThis.localStorage?.getItem(KEY);
    return isSkin(v) ? v : DEFAULT_SKIN;
  } catch {
    return DEFAULT_SKIN;
  }
}

const listeners = new Set<() => void>();
let current: SkinId = DEFAULT_SKIN;

export function currentSkin(): SkinId {
  return current;
}

export function subscribeSkin(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Veste a skin: a padrão não marca nada na página (fica exatamente como sempre foi). */
export function applySkin(id: SkinId): void {
  current = id;
  const root = globalThis.document?.documentElement;
  if (root) {
    if (id === DEFAULT_SKIN) delete root.dataset.skin;
    else root.dataset.skin = id;
  }
  listeners.forEach((l) => l());
}

/** Escolha do menu: veste e guarda para a próxima vez que o programa abrir. */
export function chooseSkin(id: SkinId): void {
  applySkin(id);
  try { globalThis.localStorage?.setItem(KEY, id); } catch { /* só não lembra */ }
}
