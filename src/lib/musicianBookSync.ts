import { useStore } from '@/store';
import { localBridge } from '@/lib/localNetwork';

/**
 * Contas e cadernos dos músicos entre o projeto e a rede local (só no app do Mac).
 * - O projeto manda o livro de contas ao abrir e a cada mudança (aprovar, bloquear, zerar senha).
 * - A rede local devolve o que mudou pelo celular (conta nova, caderno salvo, envio para colega),
 *   que entra no projeto e o deixa "alterado, falta salvar".
 * O servidor junta com a cópia de segurança dele, então nada se perde se o programa fechar
 * antes de salvar: ao reabrir o projeto, o que estava só na cópia volta.
 */
export function startMusicianBookSync(): () => void {
  const bridge = localBridge();
  if (!bridge?.setMusicianBook) return () => {};
  let timer = 0;
  let sent: unknown;
  const push = () => {
    const book = useStore.getState().musicianBook;
    if (book === sent) return;
    sent = book;
    void bridge.setMusicianBook?.(book).catch(() => { sent = undefined; });
  };
  push();
  const unsubscribe = useStore.subscribe((state, prev) => {
    if (state.musicianBook === prev.musicianBook) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(push, 250);
  });
  const off = bridge.onMusicianAccounts?.((change) => useStore.getState().applyMusicianChange(change));
  return () => {
    unsubscribe();
    off?.();
    window.clearTimeout(timer);
  };
}
