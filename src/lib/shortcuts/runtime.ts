/**
 * Atalhos no programa: guarda os do usuário no computador, liga o tratador único de teclado,
 * registra a ação de cada comando e avisa o menu do Mac/Windows quando um atalho muda.
 */
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { comboLabel, detectPlatform, type Platform } from './combo.ts';
import { createCommandGate, dispatchKey, menuCommandDecision, type CommandHandler, type KeyboardEventLike } from './dispatchCore.ts';
import { COMMAND_BY_ID, computeOverrides, menuAccelerators, resolveBindings, type Bindings, type Overrides } from './registry.ts';

const STORAGE_KEY = 'vsstage.atalhos.v1';

export const platform: Platform = detectPlatform();

function loadOverrides(): Overrides | null {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) as Overrides : null;
  } catch {
    return null;
  }
}

let bindings: Bindings = resolveBindings(loadOverrides());
const listeners = new Set<() => void>();

export function getBindings(): Bindings { return bindings; }

export function subscribeBindings(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

function syncNativeMenu(): void {
  try { window.vsDesktop?.setMenuShortcuts?.(menuAccelerators(bindings)); } catch { /* programa antigo */ }
}

export function setBindings(next: Bindings): void {
  bindings = next;
  try {
    const ov = computeOverrides(next);
    if (Object.keys(ov).length === 0) globalThis.localStorage?.removeItem(STORAGE_KEY);
    else globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(ov));
  } catch { /* sem disco: vale só até fechar */ }
  syncNativeMenu();
  for (const cb of listeners) cb();
}

// ---------- ações registradas ----------

interface Entry { fn: CommandHandler; priority: number; seq: number }
const handlerMap = new Map<string, Entry[]>();
let seq = 0;

/** Registra a ação de um comando enquanto quem sabe fazê-la está na tela. */
export function registerCommand(id: string, fn: CommandHandler, priority = 0): () => void {
  const entry: Entry = { fn, priority, seq: seq++ };
  const list = handlerMap.get(id) ?? [];
  list.push(entry);
  // maior prioridade primeiro; empatou, o registrado por último (o mais de dentro) primeiro
  list.sort((a, b) => b.priority - a.priority || b.seq - a.seq);
  handlerMap.set(id, list);
  return () => {
    const cur = handlerMap.get(id);
    if (!cur) return;
    const i = cur.indexOf(entry);
    if (i >= 0) cur.splice(i, 1);
    if (cur.length === 0) handlerMap.delete(id);
  };
}

const gate = createCommandGate();

/** Marca que o comando acabou de rodar (o mesmo atalho que vem pelo menu não roda de novo). */
export function noteCommandRan(id: string): void { gate.noteRan(id); }
/** O comando rodou agora há pouco (pelo teclado ou pelo menu)? */
export function commandRanRecently(id: string): boolean { return gate.ranRecently(id); }
/** A janela de atalhos gravou uma tecla agora: o menu do sistema não dispara com ela. */
export function noteShortcutCaptured(): void { gate.noteCaptured(); }

function handlersFor(id: string): CommandHandler[] {
  const fns = (handlerMap.get(id) ?? []).map((h) => h.fn);
  const def = COMMAND_BY_ID.get(id);
  if (!def?.menu || def.native) return fns;
  // comando que também está no menu do sistema: pelo teclado e pelo menu, roda uma vez só
  return fns.map((fn) => (e: KeyboardEventLike) => {
    if (gate.ranRecently(id)) return true;
    const r = fn(e);
    if (r !== false) gate.noteRan(id);
    return r;
  });
}

/** Hook: registra a ação; a função pode mudar a cada desenho sem registrar de novo. */
export function useCommand(id: string, fn: CommandHandler, opts: { priority?: number; enabled?: boolean } = {}): void {
  const ref = useRef(fn);
  ref.current = fn;
  const { priority = 0, enabled = true } = opts;
  useEffect(() => {
    if (!enabled) return;
    return registerCommand(id, (e) => ref.current(e), priority);
  }, [id, priority, enabled]);
}

/** Chama o comando sem tecla (menu do sistema, botão). true se alguém fez. */
export function runCommand(id: string): boolean {
  const fake: KeyboardEventLike = { key: '', preventDefault() {}, stopPropagation() {} };
  for (const h of (handlerMap.get(id) ?? []).map((x) => x.fn)) {
    if (h(fake) !== false) { gate.noteRan(id); return true; }
  }
  return false;
}

/** Comando que chegou pelo menu do Mac/Windows. */
function onMenuCommand(id: string): void {
  const d = menuCommandDecision(id, { recording, dialogOpen, gate });
  if (d === 'close-dialog') { gate.noteRan(id); closeKeyCommands(); return; }
  if (d === 'run') runCommand(id);
}

// ---------- gravação na janela de atalhos ----------

let recording = false;
/** Enquanto a janela de atalhos grava uma tecla, nenhum comando dispara. */
export function setRecordingShortcut(on: boolean): void { recording = on; }
/** A janela de atalhos está gravando. */
export function isRecordingShortcut(): boolean { return recording; }
/**
 * A janela de atalhos está aberta, gravando ou acabou de gravar uma tecla: o ⌘M do menu do
 * sistema não pode trocar o Modo Show por trás dela.
 */
export function shortcutsDialogBusy(): boolean { return recording || dialogOpen || gate.capturedRecently(); }

// ---------- tratador único ----------

let installed = 0;
let cleanup: (() => void) | null = null;

/** Liga o tratador de teclado (uma vez só, mesmo chamado de novo). */
export function installShortcuts(): () => void {
  installed++;
  if (installed === 1) {
    const make = (phase: 'capture' | 'bubble') => (e: KeyboardEvent) => {
      // janela de atalhos aberta: as teclas são dela (gravar, buscar), nenhum comando dispara
      if (recording || dialogOpen) return;
      dispatchKey(e as unknown as KeyboardEventLike, { platform, bindings, handlers: handlersFor, phase });
    };
    const cap = make('capture');
    const bub = make('bubble');
    window.addEventListener('keydown', cap, true);
    window.addEventListener('keydown', bub);
    const offMenu = window.vsDesktop?.onMenuCommand?.(onMenuCommand);
    syncNativeMenu();
    cleanup = () => {
      window.removeEventListener('keydown', cap, true);
      window.removeEventListener('keydown', bub);
      offMenu?.();
    };
  }
  return () => {
    installed--;
    if (installed === 0) { cleanup?.(); cleanup = null; }
  };
}

// ---------- textos dos atalhos na tela ----------

/** A combinação que aparece no menu (no Mac, ⌫ antes de ⌦; no Windows, Del antes de Backspace). */
export function primaryCombo(list: string[], p: Platform = platform): string | null {
  if (list.length === 0) return null;
  if (list.includes('Delete') && list.includes('Backspace')) return p === 'mac' ? 'Backspace' : 'Delete';
  return list[0];
}

export function shortcutLabel(id: string): string {
  const c = primaryCombo(bindings[id] ?? []);
  return c ? comboLabel(c, platform) : '';
}

/** Texto do atalho do comando, atualizado quando o usuário troca. '' sem atalho. */
export function useShortcutLabel(id: string): string {
  return useSyncExternalStore(subscribeBindings, () => shortcutLabel(id));
}

/** " (⌘G)" para pôr no fim de uma dica; '' sem atalho. */
export function useShortcutHint(id: string): string {
  const l = useShortcutLabel(id);
  return l ? ` (${l})` : '';
}

// ---------- janela de atalhos aberta ----------

let dialogOpen = false;
const dialogListeners = new Set<() => void>();
function setDialog(v: boolean) {
  if (dialogOpen === v) return;
  dialogOpen = v;
  for (const cb of dialogListeners) cb();
}
export function openKeyCommands(): void { setDialog(true); }
export function closeKeyCommands(): void { setDialog(false); }
export function useKeyCommandsOpen(): boolean {
  return useSyncExternalStore((cb) => { dialogListeners.add(cb); return () => { dialogListeners.delete(cb); }; }, () => dialogOpen);
}
