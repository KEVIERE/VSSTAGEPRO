import { useEffect, useState } from 'react';
import { FolderOpen, Package, X, FolderCog, FileCog } from 'lucide-react';
import { useStore } from '@/store';
import { loadOpenedProject } from '@/lib/projectQuickSave';
import { rememberProject } from '@/lib/recentProjects';
import {
  canChooseSaveLocation,
  isFolderSaveSupported,
  openProjectFile,
  openProjectFolder,
  saveProjectAsFolder,
  saveProjectAsPackage,
  vscFileName,
} from '@/lib/projectSaver';
import { friendlyError } from '@/lib/friendlyError';

interface Props {
  mode: 'save' | 'open' | null;
  onClose: () => void;
}

export default function ProjectDialogs({ mode, onClose }: Props) {
  const setExportProgress = useStore((s) => s.setExportProgress);
  const setProjectName = useStore((s) => s.setProjectName);
  const setSaveTarget = useStore((s) => s.setSaveTarget);
  const exportMessage = useStore((s) => s.exportProgress?.message);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');

  useEffect(() => {
    if (!mode) return;
    setError(null);
    setBusy(false);
    setName(useStore.getState().projectName || 'Sem Nome');
  }, [mode]);

  useEffect(() => {
    if (!mode) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [mode, onClose, busy]);

  if (!mode) return null;

  const run = async (fn: () => Promise<string>) => {
    setBusy(true);
    setError(null);
    try {
      const doneMessage = await fn();
      setExportProgress({ active: false, message: doneMessage });
      window.setTimeout(() => {
        if (useStore.getState().exportProgress?.message === doneMessage) setExportProgress(null);
      }, 4000);
      onClose();
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') {
        setExportProgress(null);
        onClose();
        return;
      }
      const msg = friendlyError(err, 'A operação não foi concluída. Tente de novo.');
      setError(msg);
      setExportProgress(null);
    } finally {
      setBusy(false);
    }
  };

  const progress = (message: string) => setExportProgress({ active: true, message });

  const projectName = name.trim() || 'Sem Nome';
  const load = loadOpenedProject;

  const title = mode === 'save' ? 'Salvar Projeto' : 'Abrir Projeto';
  const folderSaveSupported = mode === 'open' || isFolderSaveSupported();
  const chooseLocation = canChooseSaveLocation();

  return (
    <div className="fixed inset-0 z-[220] flex items-center justify-center bg-black/60">
      <div className="w-[560px] max-w-[92vw] bg-logic-bg-panel border border-logic-border-light shadow-logic-raised rounded">
        <div className="flex items-center justify-between px-4 py-3 border-b border-logic-border-dark">
          <h2 className="text-sm font-medium text-logic-text">{title}</h2>
          <button
            className="w-6 h-6 flex items-center justify-center text-logic-text-dim hover:text-logic-text hover:bg-logic-bg-panel-light rounded transition-colors disabled:opacity-40"
            onClick={onClose}
            disabled={busy}
            aria-label="Fechar"
          >
            <X size={14} />
          </button>
        </div>

        {mode === 'save' && (
          <div className="px-4 pt-4">
            <label className="block text-[11px] text-logic-text-dim mb-1.5" htmlFor="vs-project-name">Nome do projeto</label>
            <input
              id="vs-project-name"
              className="w-full px-2.5 py-1.5 text-xs rounded bg-logic-bg-deep border border-logic-border-dark text-logic-text focus:outline-none focus:border-logic-accent transition-colors"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={busy}
              maxLength={120}
              autoFocus
            />
          </div>
        )}

        <div className="p-4 grid grid-cols-2 gap-3">
          <button
            className="group flex flex-col items-start gap-2 p-4 rounded border border-logic-border-light bg-logic-bg-elevated hover:bg-logic-bg-panel-light transition-colors text-left disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={busy || !folderSaveSupported}
            onClick={() => run(async () => {
              if (mode === 'save') {
                const target = await saveProjectAsFolder(useStore.getState(), projectName, progress);
                setProjectName(projectName);
                setSaveTarget(target);
                void rememberProject(projectName, target);
                return `Projeto "${projectName}" salvo em pasta.`;
              }
              return load(await openProjectFolder(progress));
            })}
          >
            <div className="flex items-center gap-2 text-logic-accent">
              {mode === 'save' ? <FolderCog size={18} /> : <FolderOpen size={18} />}
              <span className="text-sm font-medium text-logic-text">
                {mode === 'save' ? 'Salvar em pasta' : 'Abrir pasta'}
              </span>
              <span className="ml-auto text-[10px] uppercase tracking-wider text-logic-accent">Recomendado</span>
            </div>
            <p className="text-[11px] leading-relaxed text-logic-text-dim">
              {mode === 'save'
                ? 'Cria uma pasta com o arquivo do projeto e todos os áudios em WAV sem compressão, organizados por música e nomeados pelas tracks.'
                : 'Aponte para a pasta do projeto. O programa carrega o arquivo e todos os áudios de dentro dela.'}
            </p>
            {!folderSaveSupported && (
              <p className="text-[10px] text-logic-lcd-amber">
                Disponível com o VS Stage aberto em janela própria (Chrome, Edge, Arc ou Brave).
              </p>
            )}
          </button>

          <button
            className="group flex flex-col items-start gap-2 p-4 rounded border border-logic-border-light bg-logic-bg-elevated hover:bg-logic-bg-panel-light transition-colors text-left disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={busy}
            onClick={() => run(async () => {
              if (mode === 'save') {
                const target = await saveProjectAsPackage(useStore.getState(), projectName, progress);
                setProjectName(projectName);
                setSaveTarget(target);
                void rememberProject(projectName, target);
                return target
                  ? `Projeto "${projectName}" salvo.`
                  : `"${vscFileName(projectName)}" salvo na pasta Downloads.`;
              }
              return load(await openProjectFile(progress));
            })}
          >
            <div className="flex items-center gap-2 text-logic-accent">
              {mode === 'save' ? <FileCog size={18} /> : <Package size={18} />}
              <span className="text-sm font-medium text-logic-text">
                {mode === 'save' ? 'Arquivo único .vsc' : 'Abrir arquivo .vsc'}
              </span>
            </div>
            <p className="text-[11px] leading-relaxed text-logic-text-dim">
              {mode === 'save'
                ? `Guarda o projeto e todos os áudios juntos em um só arquivo ${vscFileName(projectName)}. Prático para levar ou enviar.`
                : 'Abra um projeto .vsc com todos os áudios dentro.'}
            </p>
            {mode === 'save' && !chooseLocation && (
              <p className="text-[10px] text-logic-text-muted">
                O arquivo será salvo na sua pasta Downloads.
              </p>
            )}
          </button>
        </div>

        {busy && exportMessage && (
          <div className="mx-4 mb-3 flex items-center gap-2 text-[11px] text-logic-text-dim">
            <div className="w-2 h-2 rounded-full bg-logic-accent animate-pulse flex-shrink-0" />
            <span className="truncate">{exportMessage}</span>
          </div>
        )}

        {error && (
          <div className="mx-4 mb-3 px-3 py-2 bg-logic-lcd-red/15 border border-logic-lcd-red/40 rounded text-[11px] text-logic-lcd-red">
            {error}
          </div>
        )}

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-logic-border-dark">
          <button
            className="px-3 py-1.5 text-xs rounded bg-logic-bg-deep text-logic-text border border-logic-border-dark hover:bg-logic-bg-panel-light transition-colors disabled:opacity-50"
            onClick={onClose}
            disabled={busy}
          >
            {busy ? 'Trabalhando...' : 'Cancelar'}
          </button>
        </div>
      </div>
    </div>
  );
}
