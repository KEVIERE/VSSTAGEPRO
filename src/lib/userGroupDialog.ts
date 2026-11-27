// Abre a janela de criar ou editar um multigrupo (menu Editar, botão direito na coluna das faixas
// e na faixa mãe do grupo). Só avisa a janela; quem cria, muda e apaga é o store.
import type { UserGroupId } from '@/types';

export type UserGroupDialogRequest = { mode: 'create' } | { mode: 'edit'; id: UserGroupId };

const listeners = new Set<(r: UserGroupDialogRequest | null) => void>();

export function openUserGroupDialog(req: UserGroupDialogRequest): void {
  listeners.forEach((f) => f(req));
}

export function closeUserGroupDialog(): void {
  listeners.forEach((f) => f(null));
}

export function onUserGroupDialog(fn: (r: UserGroupDialogRequest | null) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
