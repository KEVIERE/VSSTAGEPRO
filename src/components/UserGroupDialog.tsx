import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, FolderPlus, Trash2 } from 'lucide-react';
import { useStore } from '@/store';
import { parseWords, suggestWords, plainText, USER_GROUP_COLORS } from '@/lib/userGroups';
import { closeUserGroupDialog, onUserGroupDialog, type UserGroupDialogRequest } from '@/lib/userGroupDialog';

/**
 * Criar e editar um multigrupo do projeto (Orquestra, Metais, Backs...): nome, cor e as palavras
 * do nome do arquivo que mandam o áudio para ele. Fica só neste projeto.
 */
export default function UserGroupDialog() {
  const [req, setReq] = useState<UserGroupDialogRequest | null>(null);
  useEffect(() => onUserGroupDialog(setReq), []);
  if (!req) return null;
  return <GroupForm key={req.mode === 'edit' ? req.id : 'novo'} req={req} />;
}

function GroupForm({ req }: { req: UserGroupDialogRequest }) {
  const group = useStore((s) => (req.mode === 'edit' ? (s.userGroups ?? []).find((g) => g.id === req.id) ?? null : null));
  const others = useStore((s) => s.userGroups ?? []);
  const createUserGroup = useStore((s) => s.createUserGroup);
  const updateUserGroup = useStore((s) => s.updateUserGroup);
  const deleteUserGroup = useStore((s) => s.deleteUserGroup);
  const timelineLocked = useStore((s) => s.timelineLocked);

  const [name, setName] = useState(group?.name ?? '');
  // a cor da faixa mãe pode ter sido trocada pelo menu de cor da faixa: vale a da tela
  const trackColor = useStore((s) => (req.mode === 'edit' ? s.tracks.find((t) => t.id === req.id)?.color : undefined));
  const [color, setColor] = useState(trackColor ?? group?.color ?? USER_GROUP_COLORS[1]);
  const [wordsText, setWordsText] = useState(group ? group.words.join(', ') : '');
  // criando: as palavras acompanham o nome até a pessoa mexer na lista
  const [wordsTouched, setWordsTouched] = useState(req.mode === 'edit');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => { nameRef.current?.focus(); nameRef.current?.select(); }, []);
  // o grupo sumiu (Desfazer, outro projeto aberto): a janela fecha
  useEffect(() => { if (req.mode === 'edit' && !group) closeUserGroupDialog(); }, [req.mode, group]);

  const clean = name.trim();
  const duplicate = !!clean && others.some((g) => g.id !== group?.id && plainText(g.name) === plainText(clean));
  const words = parseWords(wordsText);
  const canSave = !!clean && !duplicate && !timelineLocked;

  const onName = (v: string) => {
    setName(v);
    if (!wordsTouched) setWordsText(suggestWords(v).join(', '));
  };

  const save = () => {
    if (!canSave) return;
    if (req.mode === 'create') createUserGroup({ name: clean, color, words });
    else updateUserGroup(req.id, { name: clean, color, words });
    closeUserGroupDialog();
  };

  const remove = () => {
    if (req.mode !== 'edit' || timelineLocked) return;
    deleteUserGroup(req.id);
    closeUserGroupDialog();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    // com a janela aberta os atalhos do programa (espaço toca, Delete apaga...) não valem
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); closeUserGroupDialog(); }
    if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') { e.preventDefault(); save(); }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[250] flex items-center justify-center bg-black/60"
      role="dialog"
      aria-modal="true"
      aria-labelledby="vs-user-group-title"
      onKeyDown={onKeyDown}
      onMouseDown={(e) => { if (e.target === e.currentTarget) closeUserGroupDialog(); }}
    >
      <div className="console-face w-[30rem] max-w-[calc(100vw-2rem)] max-h-[calc(100vh-2rem)] flex flex-col rounded-lg border border-black shadow-2xl font-stage text-white">
        <div className="flex items-center gap-2 px-3 h-11 border-b border-black shrink-0">
          <FolderPlus size={14} className="text-logic-lcd-amber" aria-hidden />
          <span id="vs-user-group-title" className="console-legend uppercase text-logic-lcd-amber">
            {req.mode === 'create' ? 'Novo multigrupo' : 'Editar multigrupo'}
          </span>
        </div>

        <div className="p-4 flex flex-col gap-3 overflow-y-auto logic-scroll min-h-0">
          <p className="text-xs text-white/80 leading-relaxed">
            Uma pasta como as do programa, com canal no mixer, saída e medidor. Fica só neste projeto.
            Áudio importado com uma das palavras no nome vai direto para ela.
          </p>

          <label className="flex flex-col gap-1">
            <span className="console-legend text-white/60">Nome</span>
            <input
              ref={nameRef}
              className="console-well h-8 px-2 text-sm bg-black/40 text-white outline-none focus:ring-1 focus:ring-logic-lcd-amber/60 rounded"
              value={name}
              maxLength={40}
              placeholder="Ex.: Metais, Orquestra, Backs"
              onChange={(e) => onName(e.target.value)}
            />
            {duplicate && <span className="text-2xs text-logic-lcd-amber">Já existe um multigrupo com esse nome neste projeto.</span>}
          </label>

          <div className="flex flex-col gap-1">
            <span className="console-legend text-white/60">Cor</span>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Cor do multigrupo">
              {USER_GROUP_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={c === color}
                  aria-label={c}
                  className={`console-key w-7 h-7 flex items-center justify-center ${c === color ? 'ring-1 ring-logic-lcd-amber' : ''}`}
                  onClick={() => setColor(c)}
                >
                  <span className="w-4 h-4 rounded-sm flex items-center justify-center" style={{ background: c }}>
                    {c === color && <Check size={11} className="text-black/80" aria-hidden />}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <label className="flex flex-col gap-1">
            <span className="console-legend text-white/60">Palavras no nome do arquivo</span>
            <textarea
              className="console-well min-h-[4.5rem] px-2 py-1.5 text-xs bg-black/40 text-white outline-none focus:ring-1 focus:ring-logic-lcd-amber/60 rounded resize-y logic-scroll"
              value={wordsText}
              placeholder="trompete, trombone, sax"
              onChange={(e) => { setWordsTouched(true); setWordsText(e.target.value); }}
            />
            <span className="text-2xs text-white/55 leading-relaxed">
              Separe por vírgula. Acento e maiúscula não contam. Guia, Click e Maestro ditos no nome continuam com eles.
              {words.length === 0 && ' Sem palavras, o grupo só recebe o que você arrastar e o que a IA ouvir dele.'}
            </span>
          </label>

          {req.mode === 'edit' && (
            <div className="console-well px-2.5 py-2 flex flex-col gap-1.5">
              {!confirmDelete ? (
                <button
                  type="button"
                  className="console-key self-start h-7 px-2 text-xs text-white/80 inline-flex items-center gap-1.5 disabled:opacity-40"
                  disabled={timelineLocked}
                  onClick={() => setConfirmDelete(true)}
                >
                  <Trash2 size={12} aria-hidden /> Apagar multigrupo
                </button>
              ) : (
                <>
                  <span className="text-xs text-white/85 leading-relaxed">
                    As trilhas de dentro voltam para as pastas do programa, com os áudios. Dá para voltar com Desfazer.
                  </span>
                  <div className="flex gap-2">
                    <button type="button" className="console-key h-7 px-2 text-xs text-white/75" onClick={() => setConfirmDelete(false)}>Manter</button>
                    <button type="button" className="console-key h-7 px-2 text-xs text-logic-lcd-amber inline-flex items-center gap-1.5" onClick={remove}>
                      <Trash2 size={12} aria-hidden /> Apagar
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
          {timelineLocked && <span className="text-2xs text-logic-lcd-amber">A timeline está travada: destrave para mexer nos multigrupos.</span>}
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-black shrink-0">
          <button type="button" className="console-key px-3 h-7 text-xs text-white/80" onClick={() => closeUserGroupDialog()}>Cancelar</button>
          <button type="button" className="console-key px-3 h-7 text-xs text-logic-lcd-amber disabled:opacity-40" disabled={!canSave} onClick={save}>
            {req.mode === 'create' ? 'Criar' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
