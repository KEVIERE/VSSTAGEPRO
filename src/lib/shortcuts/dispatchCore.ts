/**
 * O tratador único de teclado, sem janela: recebe o aperto, procura o comando pelos atalhos do
 * usuário e chama a ação registrada. Testável no node com eventos de mentira.
 */
import { isTextTarget, type KeyLike, type Platform } from './combo.ts';
import { COMMAND_BY_ID, matchCommands, type Bindings } from './registry.ts';

/** Ação de um comando. Devolve false quando não fez nada (aí a tecla segue livre). */
export type CommandHandler = (e: KeyboardEventLike) => boolean | void;

export interface KeyboardEventLike extends KeyLike {
  repeat?: boolean;
  defaultPrevented?: boolean;
  target?: unknown;
  preventDefault(): void;
  stopPropagation?(): void;
}

export interface DispatchEnv {
  platform: Platform;
  bindings: Bindings;
  /** Ações registradas agora para o comando (a de maior prioridade primeiro). */
  handlers: (id: string) => CommandHandler[];
  /** 'capture' roda antes de todo mundo; 'bubble' é o normal. */
  phase: 'capture' | 'bubble';
}

type TargetLike = { tagName?: string; type?: string; isContentEditable?: boolean; blur?: () => void };

/** Trata o aperto. Devolve o id do comando que ficou com a tecla, ou null. */
export function dispatchKey(e: KeyboardEventLike, env: DispatchEnv): string | null {
  const ids = matchCommands(e, env.bindings, env.platform);
  if (ids.length === 0) return null;
  const target = (e.target ?? null) as TargetLike | null;
  const inText = isTextTarget(target);
  const inSelect = target?.tagName === 'SELECT';
  for (const id of ids) {
    const def = COMMAND_BY_ID.get(id);
    if (!def || def.native || def.locked) continue;
    if ((def.capture ? 'capture' : 'bubble') !== env.phase) continue;
    if (inText && !def.inText) continue;
    if (inSelect && !def.inSelect) continue;
    if (def.yieldIfHandled && e.defaultPrevented) continue;
    const hs = env.handlers(id);
    if (hs.length === 0) continue;
    if (e.repeat && def.noRepeat) {
      e.preventDefault();
      if (def.blur) target?.blur?.();
      return id;
    }
    for (const h of hs) {
      // Espaço: tira o foco do botão antes, para nunca "clicar" o botão focado
      if (def.blur) { e.preventDefault(); target?.blur?.(); }
      if (h(e) === false) continue;
      e.preventDefault();
      if (def.capture) e.stopPropagation?.();
      return id;
    }
  }
  return null;
}

/**
 * Trava do caminho duplo: no Mac e no Windows, um atalho que também está no menu do sistema
 * (⌥K, ⌘M) chega pelo teclado e pelo menu. Quem chegar primeiro faz; o outro, dentro de
 * 300 ms, não faz de novo. Gravando um atalho na janela, o menu também não dispara.
 */
export interface CommandGate {
  noteRan(id: string): void;
  ranRecently(id: string): boolean;
  /** A janela de atalhos acabou de gravar uma tecla (o menu pode mandar o comando logo depois). */
  noteCaptured(): void;
  capturedRecently(): boolean;
}

export function createCommandGate(now: () => number = () => Date.now(), windowMs = 300): CommandGate {
  const last = new Map<string, number>();
  let captured = Number.NEGATIVE_INFINITY;
  return {
    noteRan(id) { last.set(id, now()); },
    ranRecently(id) { const t = last.get(id); return t !== undefined && now() - t < windowMs; },
    noteCaptured() { captured = now(); },
    capturedRecently() { return now() - captured < windowMs; },
  };
}

export type MenuDecision = 'run' | 'close-dialog' | 'ignore';

/**
 * O que fazer com um comando que chegou pelo menu do sistema. Com a janela de atalhos aberta,
 * nenhum comando dispara; só o próprio "Atalhos de teclado" fecha a janela.
 */
export function menuCommandDecision(id: string, s: { recording: boolean; dialogOpen: boolean; gate: CommandGate }): MenuDecision {
  if (s.recording || s.gate.capturedRecently()) return 'ignore';
  if (s.gate.ranRecently(id)) return 'ignore';
  if (s.dialogOpen) return id === 'app.keyCommands' ? 'close-dialog' : 'ignore';
  return 'run';
}
