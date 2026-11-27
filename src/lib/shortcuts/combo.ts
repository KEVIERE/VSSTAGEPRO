/**
 * Atalhos de teclado: como uma combinação de teclas vira texto, volta a ser tecla e aparece
 * na tela. Sem React e sem janela, para dar para testar no node.
 *
 * Formato guardado (igual no Mac e no Windows, para o arquivo exportado servir nos dois):
 *   "Mod+Shift+G", "Alt+K", "Space", "Escape", "Delete", "S", "1", "F5", "="
 * - Mod é o modificador principal: ⌘ no Mac, Ctrl no Windows.
 * - Ctrl é a tecla Control do Mac (⌃). No Windows ela já é o Mod.
 * - Meta é a tecla Windows (só no Windows; o sistema usa quase todas, então não entra).
 */

export type Platform = 'mac' | 'win';

/** Modificadores na ordem em que ficam guardados. */
const MOD_ORDER = ['Mod', 'Ctrl', 'Alt', 'Shift', 'Meta'] as const;
type ModName = typeof MOD_ORDER[number];

const NAMED_KEYS = new Set([
  'Space', 'Escape', 'Enter', 'Tab', 'Backspace', 'Delete', 'Insert', 'Home', 'End', 'PageUp', 'PageDown',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Plus',
]);

/** Teclas de pontuação pela posição (código físico), para o Option do Mac não trocar o caractere. */
const CODE_PUNCT: Record<string, string> = {
  Equal: '=', Minus: '-', Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'",
  BracketLeft: '[', BracketRight: ']', Backslash: '\\', Backquote: '`',
  NumpadAdd: 'Plus', NumpadSubtract: '-', NumpadMultiply: '*', NumpadDivide: '/', NumpadDecimal: '.',
};
const PUNCT = new Set(['=', '-', ',', '.', '/', ';', "'", '[', ']', '\\', '`', '*']);

export function detectPlatform(): Platform {
  const nav = (globalThis as { navigator?: { platform?: string; userAgent?: string } }).navigator;
  const s = `${nav?.platform ?? ''} ${nav?.userAgent ?? ''}`;
  return /Mac|iPhone|iPad/i.test(s) ? 'mac' : 'win';
}

function isKeyToken(k: string): boolean {
  return /^[A-Z]$/.test(k) || /^[0-9]$/.test(k) || /^F([1-9]|1[0-9]|2[0-4])$/.test(k) || NAMED_KEYS.has(k) || PUNCT.has(k);
}

/** Parte uma combinação guardada. Devolve null se não for uma combinação válida. */
export function parseCombo(combo: string): { mods: Set<ModName>; key: string } | null {
  if (typeof combo !== 'string' || combo.length === 0 || combo.length > 40) return null;
  // "Mod++" não existe: o "+" é guardado como Plus
  const parts = combo.split('+');
  const key = parts.pop() ?? '';
  const mods = new Set<ModName>();
  for (const p of parts) {
    if (!(MOD_ORDER as readonly string[]).includes(p)) return null;
    if (mods.has(p as ModName)) return null;
    mods.add(p as ModName);
  }
  if (!isKeyToken(key)) return null;
  return { mods, key };
}

export function buildCombo(mods: Iterable<string>, key: string): string {
  const set = new Set(mods);
  const ordered = MOD_ORDER.filter((m) => set.has(m));
  return [...ordered, key].join('+');
}

/** Deixa a combinação na forma guardada (ordem fixa dos modificadores). null se inválida. */
export function normalizeCombo(combo: string): string | null {
  const p = parseCombo(combo);
  return p ? buildCombo(p.mods, p.key) : null;
}

/** O que importa de um KeyboardEvent (para os testes passarem objetos simples). */
export interface KeyLike {
  key: string;
  code?: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

/** Qual tecla foi apertada, no formato guardado. null para tecla só de modificador. */
export function keyToken(e: KeyLike): string | null {
  const k = e.key ?? '';
  const code = e.code ?? '';
  if (code === 'Space' || k === ' ' || k === 'Spacebar') return 'Space';
  if (k === 'Esc') return 'Escape';
  if (k === 'Del') return 'Delete';
  if (NAMED_KEYS.has(k)) return k;
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(k)) return k;
  // letras e números pelo caractere (como era antes); com Option/Shift o caractere muda,
  // então vale a posição da tecla
  if (/^[a-zA-Z]$/.test(k)) return k.toUpperCase();
  if (/^[0-9]$/.test(k)) return k;
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^Numpad[0-9]$/.test(code)) return code.slice(6);
  if (CODE_PUNCT[code]) return CODE_PUNCT[code];
  if (k === '+') return 'Plus';
  if (PUNCT.has(k)) return k;
  return null;
}

/**
 * A combinação de um aperto de tecla, já no formato guardado.
 * No Mac: ⌘ é Mod e Control é Ctrl. No Windows: Ctrl é Mod e a tecla Windows é Meta.
 */
export function eventToCombo(e: KeyLike, platform: Platform): string | null {
  const key = keyToken(e);
  if (!key) return null;
  const mods: ModName[] = [];
  if (platform === 'mac') {
    if (e.metaKey) mods.push('Mod');
    if (e.ctrlKey) mods.push('Ctrl');
  } else {
    if (e.ctrlKey) mods.push('Mod');
    if (e.metaKey) mods.push('Meta');
  }
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  return buildCombo(mods, key);
}

/** Tira um modificador da combinação (devolve a mesma se ele não estiver lá). */
export function withoutMod(combo: string, mod: ModName): string {
  const p = parseCombo(combo);
  if (!p || !p.mods.has(mod)) return combo;
  p.mods.delete(mod);
  return buildCombo(p.mods, p.key);
}

/** Troca um modificador por outro (Ctrl do Mac contando como ⌘, como sempre foi). */
export function swapMod(combo: string, from: ModName, to: ModName): string {
  const p = parseCombo(combo);
  if (!p || !p.mods.has(from) || p.mods.has(to)) return combo;
  p.mods.delete(from);
  p.mods.add(to);
  return buildCombo(p.mods, p.key);
}

export function comboKey(combo: string): string | null {
  return parseCombo(combo)?.key ?? null;
}

export function comboHasMods(combo: string): boolean {
  const p = parseCombo(combo);
  return !!p && p.mods.size > 0;
}

const MAC_KEY_LABEL: Record<string, string> = {
  Space: 'Espaço', Escape: 'Esc', Enter: '↩', Tab: '⇥', Backspace: '⌫', Delete: '⌦', Insert: 'Ins',
  Home: 'Home', End: 'End', PageUp: 'PgUp', PageDown: 'PgDn',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Plus: '+',
};
const WIN_KEY_LABEL: Record<string, string> = {
  Space: 'Espaço', Escape: 'Esc', Enter: 'Enter', Tab: 'Tab', Backspace: 'Backspace', Delete: 'Del', Insert: 'Ins',
  Home: 'Home', End: 'End', PageUp: 'PgUp', PageDown: 'PgDn',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Plus: '+',
};

/**
 * Texto da combinação na tela. Mac no padrão da Apple (⌃⌥⇧⌘ e a tecla, sem separador);
 * Windows por extenso com "+" (Ctrl+Shift+G).
 */
export function comboLabel(combo: string, platform: Platform): string {
  const p = parseCombo(combo);
  if (!p) return '';
  if (platform === 'mac') {
    const sym = (p.mods.has('Ctrl') ? '⌃' : '') + (p.mods.has('Alt') ? '⌥' : '') + (p.mods.has('Shift') ? '⇧' : '') + (p.mods.has('Mod') ? '⌘' : '');
    return sym + (MAC_KEY_LABEL[p.key] ?? p.key);
  }
  const words: string[] = [];
  if (p.mods.has('Mod')) words.push('Ctrl');
  if (p.mods.has('Meta')) words.push('Win');
  if (p.mods.has('Alt')) words.push('Alt');
  if (p.mods.has('Shift')) words.push('Shift');
  words.push(WIN_KEY_LABEL[p.key] ?? p.key);
  return words.join('+');
}

/**
 * Accelerator do menu do Electron para esta combinação, ou '' quando ela não deve ir para
 * o menu nativo: tecla solta (sem ⌘/Ctrl/Option) ali roubaria a digitação dos campos de texto.
 */
export function comboToAccelerator(combo: string): string {
  const p = parseCombo(combo);
  if (!p) return '';
  const fKey = /^F\d+$/.test(p.key);
  if (!fKey && !p.mods.has('Mod') && !p.mods.has('Alt') && !p.mods.has('Ctrl')) return '';
  if (p.mods.has('Meta')) return '';
  const keyMap: Record<string, string> = {
    Escape: 'Esc', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Enter: 'Return',
  };
  const parts: string[] = [];
  if (p.mods.has('Mod')) parts.push('CmdOrCtrl');
  if (p.mods.has('Ctrl')) parts.push('Ctrl');
  if (p.mods.has('Alt')) parts.push('Alt');
  if (p.mods.has('Shift')) parts.push('Shift');
  parts.push(keyMap[p.key] ?? p.key);
  return parts.join('+');
}

/** Combinações que o sistema usa: não podem virar atalho do programa. Motivo em português. */
export function reservedReason(combo: string, platform: Platform): string | null {
  const c = normalizeCombo(combo);
  if (!c) return 'Combinação inválida';
  const p = parseCombo(c)!;
  const common: Record<string, string> = {
    'Mod+Q': 'Encerrar o programa',
    'Mod+W': 'Fechar a janela',
    'Mod+Tab': 'Trocar de programa',
    'Mod+Shift+Tab': 'Trocar de programa',
  };
  const mac: Record<string, string> = {
    'Mod+H': 'Ocultar o programa (sistema)',
    'Mod+Alt+H': 'Ocultar os outros programas (sistema)',
    'Mod+Space': 'Spotlight (sistema)',
    'Ctrl+Space': 'Trocar o idioma do teclado (sistema)',
    'Mod+Alt+Escape': 'Forçar encerrar (sistema)',
    'Mod+Ctrl+Q': 'Bloquear a tela (sistema)',
    'Mod+Shift+3': 'Captura de tela (sistema)',
    'Mod+Shift+4': 'Captura de tela (sistema)',
    'Mod+Shift+5': 'Captura de tela (sistema)',
    'Mod+`': 'Trocar de janela (sistema)',
    'Mod+Alt+M': 'Minimizar a janela',
    'Mod+Ctrl+F': 'Tela cheia',
  };
  const win: Record<string, string> = {
    'Alt+F4': 'Fechar o programa (sistema)',
    'Alt+Tab': 'Trocar de programa (sistema)',
    'Alt+Shift+Tab': 'Trocar de programa (sistema)',
    'Mod+Escape': 'Menu Iniciar (sistema)',
    'Mod+Shift+Escape': 'Gerenciador de Tarefas (sistema)',
    'Mod+Alt+Delete': 'Segurança do Windows (sistema)',
    'Mod+Alt+M': 'Minimizar a janela',
    F11: 'Tela cheia',
  };
  if (common[c]) return common[c];
  if (platform === 'mac' && mac[c]) return mac[c];
  if (platform === 'win' && win[c]) return win[c];
  if (platform === 'win' && p.mods.has('Meta')) return 'A tecla Windows é do sistema';
  // zoom da janela inteira (menu Visualizar do programa): a mesma tecla faria as duas coisas
  if (p.mods.size === 1 && p.mods.has('Mod') && (p.key === '0' || p.key === '=' || p.key === '-' || p.key === 'Plus')) {
    return 'Tamanho da interface (menu Visualizar)';
  }
  return null;
}

/**
 * O alvo do aperto é um lugar de digitar? (aí só o Salvar vale, como antes)
 * Mesma lista de antes: só botão, caixa de marcar, opção, controle deslizante e enviar ficam de
 * fora. Campo de arquivo, cor, imagem e limpar continuam contando como campo (não tocam no Espaço).
 */
export function isTextTarget(el: { tagName?: string; type?: string; isContentEditable?: boolean } | null | undefined): boolean {
  if (!el) return false;
  if (el.isContentEditable) return true;
  if (el.tagName === 'TEXTAREA') return true;
  if (el.tagName === 'INPUT') {
    const t = (el.type ?? 'text').toLowerCase();
    return !['button', 'checkbox', 'radio', 'range', 'submit'].includes(t);
  }
  return false;
}
