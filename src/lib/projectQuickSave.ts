import { useStore } from '@/store';
import { quickSave, reopenProject, saveTargetLabel, type LoadedProject } from '@/lib/projectSaver';
import { stopPlayback } from '@/lib/transportControl';
import { forgetRecentProject, rememberProject, type RecentProject } from '@/lib/recentProjects';
import { friendlyError } from '@/lib/friendlyError';

let clearTimer: number | null = null;

export function loadOpenedProject(loaded: LoadedProject): string {
  stopPlayback();
  useStore.getState().applyLoadedProject(loaded.manifest, loaded.sources, loaded.target);
  const name = loaded.manifest.projectName || 'Sem Nome';
  void rememberProject(name, loaded.target);
  const absent = loaded.manifest.clips.filter((c) => c.filePath && !loaded.sources.has(c.id));
  if (absent.length === 0) return `Projeto "${name}" aberto (${loaded.sources.size} áudios).`;
  const list = absent.slice(0, 5).map((c) => c.name).join(', ') + (absent.length > 5 ? ` e mais ${absent.length - 5}` : '');
  return `Projeto "${name}" aberto, mas ${absent.length === 1 ? 'falta 1 arquivo de áudio' : `faltam ${absent.length} arquivos de áudio`}: ${list}. Confira a pasta do projeto antes do show.`;
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

/** Salva por cima do arquivo do projeto atual; se ele nunca foi salvo, abre a janela de salvar. */
export async function saveCurrentProject() {
  const st = useStore.getState();
  if (st.saveStatus?.kind === 'saving') return;
  if (!st.saveTarget) {
    st.setSaveDialogOpen(true);
    return;
  }
  const target = st.saveTarget;
  st.setSaveStatus({ kind: 'saving', message: 'Salvando...' });
  try {
    await quickSave(st, target, (message) => useStore.getState().setExportProgress({ active: true, message }));
    useStore.getState().setExportProgress(null);
    void rememberProject(useStore.getState().projectName, target);
    flash({ kind: 'saved', message: `Salvo em "${saveTargetLabel(target)}"` }, 3500);
  } catch (err) {
    useStore.getState().setExportProgress(null);
    if ((err as DOMException)?.name === 'AbortError' || (err as DOMException)?.name === 'NotAllowedError') {
      useStore.getState().setSaveStatus(null);
      return;
    }
    console.error('[salvar] falha', err);
    const message = err instanceof Error && /permiss/i.test(err.message)
      ? friendlyError(err)
      : /quota|no space|enospc/i.test(String((err as Error)?.message ?? err))
        ? friendlyError(err)
        : 'Não foi possível salvar no arquivo do projeto. Tente "Salvar Projeto..." para escolher outro local.';
    flash({ kind: 'error', message }, 8000);
  }
}
