import { useEffect, useState } from 'react';
import { X, History, RotateCcw, Music2, ListMusic, AlertTriangle } from 'lucide-react';
import { useStore } from '@/store';
import { listProjectBackups, restoreProjectBackup, type ProjectBackup } from '@/lib/projectBackups';
import { stopPlayback } from '@/lib/transportControl';

export default function ProjectBackupsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const projectName = useStore((s) => s.projectName);
  const [backups, setBackups] = useState<ProjectBackup[]>([]);
  const [loading, setLoading] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [restored, setRestored] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setConfirmId(null);
    setRestored(null);
    listProjectBackups(projectName).then((list) => {
      setBackups(list);
      setLoading(false);
    });
  }, [open, projectName]);

  if (!open) return null;

  const handleRestore = async (backup: ProjectBackup) => {
    stopPlayback();
    await restoreProjectBackup(backup);
    setRestored(backup.id);
    setConfirmId(null);
    window.setTimeout(onClose, 900);
  };

  return (
    <div className="fixed inset-0 z-[220] flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-[520px] max-w-[92vw] max-h-[80vh] flex flex-col bg-logic-bg-panel border border-logic-border-light shadow-logic-raised rounded overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-logic-border-dark shrink-0">
          <div className="flex items-center gap-2 text-logic-accent">
            <History size={16} />
            <h2 className="text-sm font-medium text-logic-text">Histórico de Backups</h2>
          </div>
          <button
            className="w-6 h-6 flex items-center justify-center text-logic-text-dim hover:text-logic-text hover:bg-logic-bg-panel-light rounded transition-colors"
            onClick={onClose}
            aria-label="Fechar"
          >
            <X size={14} />
          </button>
        </div>

        <p className="px-4 pt-3 text-[11px] leading-relaxed text-logic-text-dim shrink-0">
          Toda vez que você clica em Salvar ou usa ⌘S, uma cópia da estrutura do projeto (faixas, posições, músicas, playlist) fica guardada aqui com o horário exato. O áudio continua sendo o que já está aberto no projeto agora. Até 10 versões mais recentes de "{projectName}".
        </p>

        <div className="flex-1 overflow-y-auto logic-scroll px-4 py-3">
          {loading ? (
            <div className="flex items-center justify-center py-10 text-xs text-logic-text-muted">Carregando...</div>
          ) : backups.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-10 text-xs text-logic-text-muted">
              <History size={24} className="opacity-30" />
              <span>Nenhum backup ainda. Salve o projeto para começar a guardar versões.</span>
            </div>
          ) : (
            <div className="space-y-1.5">
              {backups.map((b, i) => (
                <div
                  key={b.id}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-md border border-logic-border-dark bg-logic-bg-deep"
                >
                  <div className="flex-shrink-0 w-7 h-7 rounded-full bg-logic-bg-elevated border border-logic-border-light flex items-center justify-center text-2xs font-mono text-logic-text-dim">
                    {i === 0 ? <span className="text-logic-lcd-green">●</span> : backups.length - i}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-logic-text tabular-nums">{b.label}</span>
                      {i === 0 && <span className="text-[9px] font-medium uppercase tracking-wider text-logic-lcd-green bg-logic-lcd-green/10 px-1.5 py-0.5 rounded">Mais recente</span>}
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 text-2xs text-logic-text-muted">
                      <span className="flex items-center gap-1"><Music2 size={10} /> {b.songCount} música(s)</span>
                      <span className="flex items-center gap-1"><ListMusic size={10} /> {b.trackCount} faixa(s)</span>
                    </div>
                  </div>
                  {restored === b.id ? (
                    <span className="text-2xs font-semibold text-logic-lcd-green px-2">Restaurado!</span>
                  ) : confirmId === b.id ? (
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <button
                        onClick={() => handleRestore(b)}
                        className="px-2.5 py-1 rounded bg-logic-lcd-red text-white text-2xs font-semibold hover:brightness-110 transition"
                      >
                        Confirmar
                      </button>
                      <button
                        onClick={() => setConfirmId(null)}
                        className="px-2.5 py-1 rounded border border-logic-border-light text-logic-text-dim text-2xs hover:text-logic-text transition-colors"
                      >
                        Cancelar
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmId(b.id)}
                      className="flex items-center gap-1.5 flex-shrink-0 px-2.5 py-1 rounded border border-logic-border-light bg-logic-bg-elevated text-2xs font-medium text-logic-text hover:border-logic-accent hover:text-white hover:bg-logic-accent transition-colors"
                      title="Restaurar esta versão"
                    >
                      <RotateCcw size={11} /> Restaurar
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {confirmId && (
          <div className="mx-4 mb-3 flex items-center gap-2 px-3 py-2 rounded-md border border-logic-lcd-amber/50 bg-logic-lcd-amber/10 text-2xs text-logic-lcd-amber shrink-0">
            <AlertTriangle size={13} className="flex-shrink-0" />
            <span>Isso substitui o projeto aberto agora pela versão escolhida. O que não foi salvo se perde.</span>
          </div>
        )}
      </div>
    </div>
  );
}
