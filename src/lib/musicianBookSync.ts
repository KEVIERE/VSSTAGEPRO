import { useStore, hasUnsavedChanges } from '@/store';
import { localBridge } from '@/lib/localNetwork';
import { saveAndWait } from '@/lib/unsavedChanges';
import type { ProjectSaveStatus } from '@/lib/musicianTypes';

/**
 * Contas e cadernos dos músicos entre o projeto e a rede local (só no app do Mac).
 * - O projeto manda o livro de contas ao abrir e a cada mudança (aprovar, bloquear, zerar senha).
 * - A rede local devolve o que mudou pelo celular (conta nova, caderno salvo, envio para colega),
 *   que entra no projeto e o deixa "alterado, falta salvar".
 * - O botão "Salvar" do músico pede para gravar o projeto (saveProjectForMusician).
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
  const offSave = bridge.onProjectSaveRequest?.(() => saveProjectForMusician());
  return () => {
    unsubscribe();
    off?.();
    offSave?.();
    window.clearTimeout(timer);
  };
}

let waitingStop: (() => void) | null = null;

/** Com o show tocando, grava uma vez só quando a música parar (vários músicos podem pedir). */
function saveWhenStopped() {
  if (waitingStop) return;
  waitingStop = useStore.subscribe((s) => {
    if (s.transport.isPlaying) return;
    waitingStop?.();
    waitingStop = null;
    if (s.saveTarget && hasUnsavedChanges(s)) void saveAndWait();
  });
}

/**
 * "Salvar" da Área do Músico: o caderno já está no projeto (chegou pela rede antes do pedido),
 * falta gravar o arquivo. Nunca abre a janela "Salvar Projeto..." na tela do diretor por conta
 * de um músico, e não grava no meio da música: espera ela parar.
 */
export async function saveProjectForMusician(): Promise<ProjectSaveStatus> {
  const st = useStore.getState();
  if (!st.saveTarget) return 'no_file';
  if (st.transport.isPlaying) {
    saveWhenStopped();
    return 'later';
  }
  if (!hasUnsavedChanges(st) && st.saveStatus?.kind !== 'saving') return 'saved';
  return (await saveAndWait()) ? 'saved' : 'error';
}
