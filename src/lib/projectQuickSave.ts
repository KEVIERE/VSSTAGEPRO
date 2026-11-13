import { useStore, hasUnsavedChanges, type Store } from '@/store';
import { quickSave, reopenProject, saveTargetLabel, type LoadedProject, type SaveTarget } from '@/lib/projectSaver';
import { stopPlayback } from '@/lib/transportControl';
import { forgetRecentProject, rememberProject, type RecentProject } from '@/lib/recentProjects';
import { saveProjectBackup } from '@/lib/projectBackups';
import { friendlyError } from '@/lib/friendlyError';

let clearTimer: number | null = null;
let saveController: AbortController | null = null;

export const SAVE_CANCELLING = 'Cancelando...';

/** Botão Cancelar do salvar (menu Salvar e ⌘S): para no próximo áudio e descarta o que gravou. */
export function cancelCurrentSave() {
  if (!saveController || saveController.signal.aborted) return;
  saveController.abort();
  const st = useStore.getState();
  st.setSaveStatus({ kind: 'saving', message: SAVE_CANCELLING });
  st.setExportProgress({ active: true, message: 'Cancelando o salvamento...' });
}

export function loadOpenedProject(loaded: LoadedProject): string {
  stopPlayback();
  const name = loaded.manifest.projectName || 'Sem Nome';
  const absent = (loaded.manifest.clips ?? []).filter((c) => {
    const src = loaded.sources.get(c.id);
    return !src || src.size === 0;
  });

  // Se faltar algum áudio, abre a janela interativa para o usuário localizar ou ignorar
  if (absent.length > 0) {
    useStore.getState().setMissingAudioProject(loaded);
    return `Projeto "${name}": ${absent.length} ${absent.length === 1 ? 'áudio ausente' : 'áudios ausentes'}. Localize ou continue sem eles.`;
  }

  useStore.getState().applyLoadedProject(loaded.manifest, loaded.sources, loaded.target);
  void rememberProject(name, loaded.target);
  return `Projeto "${name}" aberto (${loaded.sources.size} áudios).`;
}

export async function openRecentProject(entry: RecentProject): Promise<void> {
  useStore.getState().setExportProgress({ active: true, message: `Abrindo "${entry.name}"...` });
  try {
    const loaded = await reopenProject(entry.target, (message) => useStore.getState().setExportProgress({ active: true, message }));
    const done = loadOpenedProject(loaded);
    useStore.getState().setExportProgress({ active: false, message: done });
    window.setTimeout(() => {
      if (useStore.getState().exportProgress?.message === done) useStore.getState().setExportProgress(null);
    }, 4000);
  } catch (err) {
    useStore.getState().setExportProgress(null);
    if ((err as DOMException)?.name === 'AbortError') return;
    if (/movido|renomeado|apagado/.test((err as Error)?.message ?? '')) void forgetRecentProject(entry.id);
    flash({ kind: 'error', message: friendlyError(err, 'Não foi possível abrir este projeto.') }, 8000);
  }
}

function flash(status: NonNullable<ReturnType<typeof useStore.getState>['saveStatus']>, ms: number) {
  const st = useStore.getState();
  st.setSaveStatus(status);
  if (clearTimer !== null) window.clearTimeout(clearTimer);
  clearTimer = window.setTimeout(() => {
    if (useStore.getState().saveStatus === status) useStore.getState().setSaveStatus(null);
  }, ms);
}

export const SAVE_WHEN_STOPPED = 'Será salvo quando a música parar';

// ⌘S ou menu Salvar com a música tocando: gravar o .vss troca o arquivo de onde o motor ainda lê
// os áudios, e a faixa que ainda não tinha chegado ficava muda até o Stop. Grava uma vez só,
// quando a música parar (pausa ou stop), como o Salvar do músico.
let waitingStop: Promise<boolean> | null = null;
const waitingListeners = new Set<() => void>();

/** A barra de menus mostra "Será salvo quando a música parar" enquanto isto for true. */
export function isSaveWaitingStop(): boolean {
  return waitingStop !== null;
}

export function subscribeSaveWaiting(cb: () => void): () => void {
  waitingListeners.add(cb);
  return () => { waitingListeners.delete(cb); };
}

function notifyWaiting() {
  for (const cb of waitingListeners) cb();
}

function waitUntil(done: (s: Store) => boolean): Promise<void> {
  return new Promise((resolve) => {
    if (done(useStore.getState())) { resolve(); return; }
    const off = useStore.subscribe((s) => {
      if (!done(s)) return;
      off();
      resolve();
    });
  });
}

async function saveAfterStop(target: SaveTarget): Promise<boolean> {
  await waitUntil((s) => !s.transport.isPlaying);
  // deixa terminar o que parou a música: abrir outro projeto para a música e troca o projeto
  // logo em seguida, e aí este salvar não vale mais
  await new Promise<void>((r) => window.setTimeout(r, 0));
  waitingStop = null;
  notifyWaiting();
  const now = useStore.getState();
  // projeto trocado (abrir, novo) ou já gravado em outro lugar: não grava este
  if (now.saveTarget !== target) return !hasUnsavedChanges(now);
  if (now.transport.isPlaying) return saveWhenStopped(target);
  if (now.saveStatus?.kind === 'saving') {
    // outro salvar começou na parada (ex.: o do músico) e já grava o projeto como estava
    await waitUntil((s) => s.saveStatus?.kind !== 'saving');
    return !hasUnsavedChanges(useStore.getState());
  }
  // outro salvar já gravou tudo (ex.: o do músico terminou antes de chegarmos aqui): nada a gravar
  if (!hasUnsavedChanges(now)) return true;
  return saveCurrentProject({ now: true });
}

/** Devolve o resultado do salvar feito depois da parada (vários ⌘S seguidos viram um só). */
function saveWhenStopped(target: SaveTarget): Promise<boolean> {
  if (waitingStop) return waitingStop;
  waitingStop = saveAfterStop(target);
  notifyWaiting();
  return waitingStop;
}

/**
 * Salva por cima do arquivo do projeto atual; se ele nunca foi salvo, abre a janela de salvar.
 * Com a música tocando e o projeto num .vss, espera ela parar para gravar (now: true grava na hora).
 * Devolve true quando gravou o arquivo.
 */
export async function saveCurrentProject(opts: { now?: boolean } = {}): Promise<boolean> {
  const st = useStore.getState();
  if (st.saveStatus?.kind === 'saving') return false;
  if (!st.saveTarget) {
    st.setSaveDialogOpen(true);
    return false;
  }
  const target = st.saveTarget;
  if (!opts.now && st.transport.isPlaying && (target.kind === 'path' || target.kind === 'package')) {
    return saveWhenStopped(target);
  }
  saveController = new AbortController();
  const signal = saveController.signal;
  st.setSaveStatus({ kind: 'saving', message: 'Salvando...' });
  try {
    // Backup leve (só estrutura, sem áudio) antes de sobrescrever: guarda os últimos 10 salvamentos
    // deste projeto com horário, para poder voltar a uma versão anterior quando precisar.
    void saveProjectBackup(st);
    const res = await quickSave(st, target, (message) => useStore.getState().setExportProgress({ active: true, message }), signal);
    const { missingCount, unchanged } = res;
    useStore.getState().setExportProgress(null);
    // salvo do jeito que estava ao começar: o que mudou durante o salvamento continua pendente
    useStore.getState().markProjectSaved(st);
    // projeto antigo aberto pela janela do navegador: daqui em diante salva pelo caminho do disco
    if (res.target) useStore.getState().setSaveTarget(res.target);
    void rememberProject(useStore.getState().projectName, res.target ?? target);
    if (res.slowHint) {
      flash({ kind: 'saved', message: `Salvo em "${saveTargetLabel(target)}". Para os próximos salvamentos gravarem só o que mudou, abra este projeto por Arquivo > Abrir Projeto.` }, 9000);
    } else if (unchanged) {
      flash({ kind: 'saved', message: `Nada mudou desde o último salvamento de "${saveTargetLabel(target)}"` }, 3500);
    } else if (missingCount > 0) {
      flash({ kind: 'saved', message: `Salvo em "${saveTargetLabel(target)}" (Aviso: ${missingCount} áudio(s) ausente(s))` }, 6000);
    } else {
      flash({ kind: 'saved', message: `Salvo em "${saveTargetLabel(target)}"` }, 3500);
    }
    return true;
  } catch (err) {
    useStore.getState().setExportProgress(null);
    if ((err as DOMException)?.name === 'AbortError' && signal.aborted) {
      useStore.getState().setSaveStatus(null);
      // o .vss é gravado num arquivo à parte e só troca no fim: cancelado, o do disco fica intacto
      const done = target.kind !== 'folder'
        ? 'Salvamento cancelado. O arquivo do projeto continua como estava.'
        : 'Salvamento cancelado.';
      useStore.getState().setExportProgress({ active: false, message: done });
      window.setTimeout(() => {
        if (useStore.getState().exportProgress?.message === done) useStore.getState().setExportProgress(null);
      }, 5000);
      return false;
    }
    if ((err as DOMException)?.name === 'AbortError' || (err as DOMException)?.name === 'NotAllowedError') {
      useStore.getState().setSaveStatus(null);
      return false;
    }
    console.error('[salvar] falha', err);
    const message = err instanceof Error && /permiss/i.test(err.message)
      ? friendlyError(err)
      : /quota|no space|enospc/i.test(String((err as Error)?.message ?? err))
        ? friendlyError(err)
        : 'Não foi possível salvar no arquivo do projeto. Tente "Salvar Projeto..." para escolher outro local.';
    flash({ kind: 'error', message }, 8000);
    return false;
  } finally {
    saveController = null;
  }
}
