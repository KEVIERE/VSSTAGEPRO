import { useState } from 'react';
import { Check, Pencil, Plus, Send, Trash2, X } from 'lucide-react';

const MAX_PRESETS = 30;
const MAX_LEN = 140;

export default function PresetNotices({ presets, onSend, onChange }: {
  presets: string[];
  onSend: (text: string) => void;
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<number | null>(null);
  const [editText, setEditText] = useState('');

  const add = () => {
    const t = draft.trim();
    if (!t || presets.includes(t) || presets.length >= MAX_PRESETS) return;
    onChange([...presets, t]);
    setDraft('');
  };

  const saveEdit = (i: number) => {
    const t = editText.trim();
    if (t && !presets.some((p, j) => j !== i && p === t)) onChange(presets.map((p, j) => (j === i ? t : p)));
    setEditing(null);
  };

  return (
    <div>
      <div className="flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value.slice(0, MAX_LEN))}
          onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
          placeholder="Criar aviso pronto. Ex.: Agradecer a produção"
          className="flex-1 min-w-0 px-3 py-2.5 rounded-lg bg-logic-bg-deep border border-logic-border text-sm text-logic-text outline-none focus:border-logic-accent transition-colors"
        />
        <button
          onClick={add}
          disabled={!draft.trim() || presets.length >= MAX_PRESETS}
          className="flex items-center gap-1.5 px-4 rounded-lg bg-logic-accent hover:bg-logic-accent-hover text-white text-sm font-semibold disabled:opacity-40 transition-all active:scale-[0.97]"
        >
          <Plus size={15} /> Salvar
        </button>
      </div>

      {presets.length === 0 && <p className="text-sm text-logic-text-dim mt-3">Nenhum aviso pronto ainda. Crie o primeiro acima.</p>}
      <ul className="mt-3 space-y-1.5">
        {presets.map((pr, i) => (
          <li key={pr} className="flex items-center gap-1 rounded-lg bg-logic-bg-deep border border-logic-border pl-1 pr-1 animate-[fadeIn_160ms_ease-out]">
            {editing === i ? (
              <>
                <input
                  autoFocus
                  value={editText}
                  onChange={(e) => setEditText(e.target.value.slice(0, MAX_LEN))}
                  onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(i); if (e.key === 'Escape') setEditing(null); }}
                  className="flex-1 min-w-0 px-2 py-2 my-1 rounded bg-logic-bg-panel border border-logic-accent text-sm text-logic-text outline-none"
                />
                <button onClick={() => saveEdit(i)} className="p-2 text-logic-lcd-green hover:bg-logic-bg-elevated rounded transition-colors" title="Salvar">
                  <Check size={15} />
                </button>
                <button onClick={() => setEditing(null)} className="p-2 text-logic-text-muted hover:text-logic-text rounded transition-colors" title="Cancelar">
                  <X size={15} />
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => onSend(pr)}
                  className="flex-1 min-w-0 flex items-center gap-2 px-2 py-2.5 rounded text-left text-sm text-logic-text hover:bg-logic-bg-elevated transition-colors group"
                  title="Mandar para a tela agora"
                >
                  <Send size={13} className="flex-shrink-0 text-logic-accent opacity-60 group-hover:opacity-100 transition-opacity" />
                  <span className="truncate">{pr}</span>
                </button>
                <button onClick={() => { setEditing(i); setEditText(pr); }} className="p-2 text-logic-text-muted hover:text-logic-text rounded transition-colors" title="Editar">
                  <Pencil size={14} />
                </button>
                <button onClick={() => onChange(presets.filter((_, j) => j !== i))} className="p-2 text-logic-text-muted hover:text-logic-lcd-red rounded transition-colors" title="Apagar">
                  <Trash2 size={14} />
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
      <p className="text-xs text-logic-text-muted mt-3">Tocar num aviso pronto manda na hora, com o tipo e a posição escolhidos acima. Os avisos ficam salvos neste show.</p>
    </div>
  );
}
