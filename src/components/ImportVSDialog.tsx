import { useEffect, useRef, useState } from 'react';
import { FolderOpen, FolderTree, MousePointer2, X, ChevronLeft, Music2 } from 'lucide-react';
import { groupAsSingleSong, groupByParentFolder, importSongGroups } from '@/lib/importManager';
import type { SongGroup } from '@/lib/importManager';

type Step = { kind: 'choose' } | { kind: 'drag' } | { kind: 'confirm'; groups: SongGroup[] };

const folderInputProps = { webkitdirectory: '', directory: '', multiple: true } as Record<string, unknown>;

export default function ImportVSDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [step, setStep] = useState<Step>({ kind: 'choose' });
  const singleRef = useRef<HTMLInputElement>(null);
  const parentRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) setStep({ kind: 'choose' });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const takeFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    return files;
  };

  const onSingle = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = takeFiles(e);
    if (files.length === 0) return;
    onClose();
    void importSongGroups(groupAsSingleSong(files));
  };

  const onParent = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = takeFiles(e);
    if (files.length === 0) return;
    setStep({ kind: 'confirm', groups: groupByParentFolder(files) });
  };

  const startConfirmed = (groups: SongGroup[]) => {
    onClose();
    void importSongGroups(groups);
  };

  return (
    <>
      <input ref={singleRef} type="file" className="hidden" onChange={onSingle} {...folderInputProps} />
      <input ref={parentRef} type="file" className="hidden" onChange={onParent} {...folderInputProps} />
      {open && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
          <div className="w-[26rem] max-w-[calc(100vw-2rem)] bg-logic-bg-panel border border-logic-border-light shadow-logic-raised rounded">
            <div className="flex items-center justify-between px-4 h-10 border-b border-logic-border-dark">
              <div className="flex items-center gap-2 text-sm font-medium text-logic-text">
                {step.kind !== 'choose' && (
                  <button className="text-logic-text-muted hover:text-logic-text transition-colors" onClick={() => setStep({ kind: 'choose' })} title="Voltar">
                    <ChevronLeft size={15} />
                  </button>
                )}
                Importar VS
              </div>
              <button className="text-logic-text-muted hover:text-logic-text transition-colors" onClick={onClose} title="Fechar">
                <X size={15} />
              </button>
            </div>

            {step.kind === 'choose' && (
              <div className="p-3 flex flex-col gap-2">
                <Option
                  icon={<FolderOpen size={18} />}
                  title="Uma pasta VS"
                  text="Escolha a pasta de uma música. Todos os áudios dela viram uma música no repertório."
                  onClick={() => singleRef.current?.click()}
                />
                <Option
                  icon={<FolderTree size={18} />}
                  title="Pasta com várias músicas"
                  text="Escolha a pasta mãe do show. Cada pasta dentro dela vira uma música."
                  onClick={() => parentRef.current?.click()}
                />
                <Option
                  icon={<MousePointer2 size={18} />}
                  title="Arrastar várias pastas"
                  text="Selecione as pastas no computador e arraste para o repertório."
                  onClick={() => setStep({ kind: 'drag' })}
                />
              </div>
            )}

            {step.kind === 'drag' && (
              <div className="p-4 text-xs text-logic-text-dim leading-relaxed flex flex-col gap-3">
                <ol className="list-decimal pl-4 flex flex-col gap-1.5">
                  <li>Abra a pasta do show no explorador de arquivos do computador.</li>
                  <li>Selecione as pastas das músicas segurando Ctrl (ou Cmd no Mac) e clicando em cada uma.</li>
                  <li>Arraste todas juntas para a lista do repertório e solte quando ela ficar destacada.</li>
                </ol>
                <p className="text-logic-text-muted">Cada pasta solta vira uma música. Arquivos de áudio soltos viram uma música só.</p>
                <div className="flex justify-end">
                  <button className="px-3 py-1.5 text-xs rounded bg-logic-accent text-white hover:brightness-110 transition-all" onClick={onClose}>
                    Entendi
                  </button>
                </div>
              </div>
            )}

            {step.kind === 'confirm' && (
              <div className="p-4 flex flex-col gap-3">
                {step.groups.length === 0 ? (
                  <p className="text-xs text-logic-text-dim leading-relaxed">
                    Não encontrei nenhum arquivo de áudio nessa pasta. Confira se escolheu a pasta certa.
                  </p>
                ) : (
                  <>
                    <p className="text-xs text-logic-text-dim">
                      Encontrei {step.groups.length === 1 ? '1 música' : `${step.groups.length} músicas`}. Elas entram no fim do repertório nesta ordem:
                    </p>
                    <ul className="max-h-64 overflow-y-auto logic-scroll rounded border border-logic-border-dark bg-logic-bg-deep divide-y divide-logic-border-dark">
                      {step.groups.map((g, i) => (
                        <li key={`${i}-${g.name}`} className="flex items-center gap-2 px-3 py-1.5 text-xs">
                          <span className="w-5 text-right text-logic-text-muted tabular-nums">{i + 1}</span>
                          <Music2 size={12} className="text-logic-text-muted shrink-0" />
                          <span className="flex-1 truncate text-logic-text">{g.name}</span>
                          <span className="text-2xs text-logic-text-muted">{g.files.length} {g.files.length === 1 ? 'áudio' : 'áudios'}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                <div className="flex justify-end gap-2">
                  <button className="px-3 py-1.5 text-xs rounded bg-logic-bg-deep text-logic-text-muted border border-logic-border-dark hover:bg-logic-bg-panel-light hover:text-logic-text transition-colors" onClick={onClose}>
                    Cancelar
                  </button>
                  {step.groups.length > 0 && (
                    <button className="px-3 py-1.5 text-xs rounded bg-logic-accent text-white hover:brightness-110 transition-all" onClick={() => startConfirmed(step.groups)}>
                      Importar {step.groups.length === 1 ? '1 música' : `${step.groups.length} músicas`}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function Option({ icon, title, text, onClick }: { icon: React.ReactNode; title: string; text: string; onClick: () => void }) {
  return (
    <button
      className="group flex items-start gap-3 p-3 text-left rounded border border-logic-border-dark bg-logic-bg-deep hover:border-logic-accent hover:bg-logic-bg-panel-light transition-colors"
      onClick={onClick}
    >
      <span className="mt-0.5 text-logic-text-muted group-hover:text-logic-accent transition-colors">{icon}</span>
      <span className="flex flex-col gap-0.5">
        <span className="text-xs font-medium text-logic-text">{title}</span>
        <span className="text-2xs text-logic-text-dim leading-relaxed">{text}</span>
      </span>
    </button>
  );
}
