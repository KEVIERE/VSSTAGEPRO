import { useStore, hasUnsavedChanges, type Store } from '@/store';
import { saveCurrentProject } from '@/lib/projectQuickSave';
import { createPromptChannel } from '@/lib/appPrompt';

// Aviso de alteração não salva: antes de trocar o projeto aberto (abrir outro, novo projeto,
// atualizar o app) ou de fechar o app, pergunta Salvar / Não salvar / Cancelar.

export type SaveChoice = 'save' | 'discard' | 'cancel';
export interface SavePrompt {
  projectName: string;
  answer: (choice: SaveChoice) => void;
}

// Sem a janela na tela, a pergunta espera ela montar (até 3 s) e depois fica em "Cancelar":
// nada de window.confirm, que para o programa inteiro e faz a música no ar engasgar.
const savePrompt = createPromptChannel<SavePrompt, SaveChoice>();
let asking = false;

/** A janela "Salvar as alterações?" (UnsavedChangesDialog) se registra aqui. */
export function onSavePrompt(show: (prompt: SavePrompt | null) => void): () => void {
  return savePrompt.register(show);
}

function ask(): Promise<SaveChoice> {
  return savePrompt.ask((answer) => ({ projectName: useStore.getState().projectName, answer }), 'cancel');
}

function waitFor(done: (s: Store) => boolean): Promise<void> {
  return new Promise((resolve) => {
    if (done(useStore.getState())) {
      resolve();
      return;
    }
    const unsubscribe = useStore.subscribe((s) => {
      if (!done(s)) return;
      unsubscribe();
      resolve();
    });
  });
}

/**
 * Salva e espera terminar. Devolve true quando o projeto ficou salvo.
 * Projeto que nunca foi salvo: abre "Salvar Projeto..." e espera a janela fechar.
 */
export async function saveAndWait(): Promise<boolean> {
  const st = useStore.getState();
  if (st.saveStatus?.kind === 'saving') {
    await waitFor((s) => s.saveStatus?.kind !== 'saving');
    if (!hasUnsavedChanges(useStore.getState())) return true;
    return saveAndWait();
  }
  if (st.saveTarget) return saveCurrentProject();
  const before = st.savedSnapshot;
  st.setSaveDialogOpen(true);
  await waitFor((s) => !s.saveDialogOpen);
  return useStore.getState().savedSnapshot !== before;
}

/** Antes de trocar o projeto aberto. Devolve true quando pode seguir (salvou, ou a pessoa não quis salvar). */
export async function confirmLeaveProject(): Promise<boolean> {
  if (!hasUnsavedChanges(useStore.getState())) return true;
  if (asking) return false;
  asking = true;
  try {
    const choice = await ask();
    if (choice === 'cancel') return false;
    if (choice === 'discard') return true;
    return await saveAndWait();
  } finally {
    asking = false;
  }
}

/**
 * App do Mac: mantém a janela sabendo se há alteração não salva (fechar ou sair pergunta antes)
 * e salva quando a pessoa escolhe "Salvar" ali. Navegador: avisa antes de fechar ou recarregar a aba.
 */
export function watchUnsavedChanges(): () => void {
  const desktop = window.vsDesktop;
  if (!desktop?.setProjectUnsaved) {
    if (desktop) return () => undefined;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!hasUnsavedChanges(useStore.getState())) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }

  let sent = '';
  const push = (s: Store) => {
    const unsaved = hasUnsavedChanges(s);
    const key = `${unsaved}\n${s.projectName}`;
    if (key === sent) return;
    sent = key;
    desktop.setProjectUnsaved?.(unsaved, s.projectName);
  };
  push(useStore.getState());
  const unsubscribe = useStore.subscribe(push);
  const offSave = desktop.onSaveBeforeClose?.(() => saveAndWait());
  return () => {
    unsubscribe();
    offSave?.();
    // sem a tela do diretor ninguém responderia ao "Salvar" do app do Mac
    desktop.setProjectUnsaved?.(false, '');
  };
}
