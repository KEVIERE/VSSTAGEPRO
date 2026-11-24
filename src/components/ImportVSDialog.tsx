import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FolderOpen, FolderTree, MousePointer2, Tags, X, ChevronLeft, Sparkles } from 'lucide-react';
import { groupAsSingleSong, groupByParentFolder, groupReaperProject, importSongGroups, pickedPaths } from '@/lib/importManager';
import type { SongGroup } from '@/lib/importManager';
import SongGroupsConfirm from '@/components/SongGroupsConfirm';

type Step = { kind: 'choose' } | { kind: 'drag' } | { kind: 'reading' } | { kind: 'confirm'; groups: SongGroup[]; reaper?: boolean; notice?: string };

const folderInputProps = { webkitdirectory: '', directory: '', multiple: true } as Record<string, unknown>;

export default function ImportVSDialog({ open, onClose, onOpenAiSeparator }: { open: boolean; onClose: () => void; onOpenAiSeparator?: () => void }) {
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

  // Pasta com projeto do REAPER (.rpp): o show vira uma música por região, em qualquer opção.
  const reaperStep = async (files: File[]): Promise<boolean> => {
    if (!files.some((f) => /\.rpp$/i.test(f.name))) return false;
    setStep({ kind: 'reading' });
    const show = await groupReaperProject(pickedPaths(files));
    if (!show) return false;
    setStep({ kind: 'confirm', groups: show.groups, reaper: true, notice: show.notice });
    return true;
  };

  const onSingle = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = takeFiles(e);
    if (files.length === 0) return;
    if (await reaperStep(files)) return;
    onClose();
    void importSongGroups(groupAsSingleSong(files));
  };

  const onParent = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = takeFiles(e);
    if (files.length === 0) return;
    if (await reaperStep(files)) return;
    setStep({ kind: 'confirm', groups: groupByParentFolder(files) });
  };

  const startConfirmed = (groups: SongGroup[]) => {
    onClose();
    void importSongGroups(groups);
  };

  return (
    <>
      <input ref={singleRef} type="file" className="hidden" onChange={(e) => void onSingle(e)} {...folderInputProps} />
      <input ref={parentRef} type="file" className="hidden" onChange={(e) => void onParent(e)} {...folderInputProps} />
      {/* direto no body: dentro da playlist a janela herdava a opacidade dela e ficava apagada */}
      {open && createPortal(
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
          <div className="console-face w-[26rem] max-w-[calc(100vw-2rem)] max-h-[calc(100vh-2rem)] overflow-y-auto rounded-lg border border-black shadow-2xl font-stage text-white">
            <div className="flex items-center justify-between px-3 h-11 border-b border-black">
              <div className="console-legend flex items-center gap-2 uppercase text-logic-lcd-amber">
                {step.kind !== 'choose' && (
                  <button className="console-key h-6 w-6 flex items-center justify-center" onClick={() => setStep({ kind: 'choose' })} title="Voltar" aria-label="Voltar">
                    <ChevronLeft size={13} />
                  </button>
                )}
                Importar VS
              </div>
              <button className="console-key h-6 w-6 flex items-center justify-center" onClick={onClose} title="Fechar" aria-label="Fechar">
                <X size={13} />
              </button>
            </div>

            {step.kind === 'choose' && (
              <div className="p-3 flex flex-col gap-2">
                {onOpenAiSeparator && (
                  <Option
                    icon={<Sparkles size={18} className="text-logic-lcd-green" />}
                    title="Criar VS a partir de Música (IA)"
                    text="Escolha uma música completa (MP3, WAV, M4A). A IA separa as faixas (bateria, baixo, voz, harmonia) e cria o VS pronto com click."
                    onClick={() => {
                      onClose();
                      onOpenAiSeparator();
                    }}
                  />
                )}
                <NamingTip />
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
              <div className="p-4 text-xs text-white/85 leading-relaxed flex flex-col gap-3">
                <ol className="list-decimal pl-4 flex flex-col gap-1.5">
                  <li>Abra a pasta do show no explorador de arquivos do computador.</li>
                  <li>Selecione as pastas das músicas segurando Ctrl (ou Cmd no Mac) e clicando em cada uma.</li>
                  <li>Arraste todas juntas para a lista do repertório e solte quando ela ficar destacada.</li>
                </ol>
                <p className="text-white/65">Cada pasta solta vira uma música. Arquivos de áudio soltos viram uma música só.</p>
                <div className="flex justify-end">
                  <button className="console-key px-3 h-7 text-xs text-logic-lcd-amber" onClick={onClose}>
                    Entendi
                  </button>
                </div>
              </div>
            )}

            {step.kind === 'reading' && (
              <div className="p-4 text-xs text-white/85">Lendo o projeto .RPP...</div>
            )}

            {step.kind === 'confirm' && (
              <div className="p-4">
                <SongGroupsConfirm
                  groups={step.groups}
                  notice={step.notice}
                  intro={(count) => `${step.reaper ? 'Projeto .RPP: encontrei ' : 'Encontrei '}${count}. Elas entram no fim do repertório nesta ordem:`}
                  confirmLabel={(count) => `Importar ${count}`}
                  onCancel={onClose}
                  onConfirm={() => startConfirmed(step.groups)}
                />
              </div>
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

function NamingTip() {
  return (
    <div className="console-well px-3 py-2.5 flex flex-col gap-1" role="note">
      <span className="console-legend flex items-center gap-1.5 uppercase text-logic-lcd-amber">
        <Tags size={12} aria-hidden />
        Roteamento por IA
      </span>
      <span className="text-2xs text-white/80 leading-relaxed">
        Renomeie cada arquivo com o nome do instrumento para máxima precisão no roteamento.
      </span>
    </div>
  );
}

function Option({ icon, title, text, onClick }: { icon: React.ReactNode; title: string; text: string; onClick: () => void }) {
  return (
    <button
      className="group flex items-start gap-3 p-3 text-left rounded border border-black bg-black/35 hover:border-logic-lcd-amber hover:bg-black/50 transition-colors"
      onClick={onClick}
    >
      <span className="mt-0.5 text-white/70 group-hover:text-logic-lcd-amber transition-colors">{icon}</span>
      <span className="flex flex-col gap-1">
        <span className="text-xs font-semibold text-white">{title}</span>
        <span className="text-2xs text-white/75 leading-relaxed">{text}</span>
      </span>
    </button>
  );
}
