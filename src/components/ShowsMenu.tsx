import { useEffect, useState } from 'react';
import { Check, ChevronDown, Copy, ListMusic, Pencil, Plus, Trash2 } from 'lucide-react';
import { useStore } from '@/store';
import { DEFAULT_SHOW_NAME } from '@/lib/shows';
import ShowEditorDialog from '@/components/ShowEditorDialog';

export default function ShowsMenu({ open, onToggle, onClose }: { open: boolean; onToggle: () => void; onClose: () => void }) {
  const shows = useStore((s) => s.shows);
  const activeShowId = useStore((s) => s.activeShowId);
  const activateShow = useStore((s) => s.activateShow);
  const duplicateShow = useStore((s) => s.duplicateShow);
  const deleteShow = useStore((s) => s.deleteShow);
  const liveCount = useStore((s) => s.playlist.length);
  const defaultCount = useStore((s) => s.defaultPlaylist?.length ?? 0);
  const [editor, setEditor] = useState<{ showId: string | null } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  useEffect(() => { if (!open) setConfirmDelete(null); }, [open]);

  const countOf = (id: string | null, stored: number) => (id === activeShowId ? liveCount : stored);

  const pick = (id: string | null) => {
    activateShow(id === activeShowId ? null : id);
    onClose();
  };

  return (
    <div className="relative">
      <button
        className={`px-3 h-7 flex items-center gap-1.5 hover:bg-logic-bg-panel-light transition-colors duration-100 font-medium
          ${open ? 'bg-logic-bg-panel-light' : ''}`}
        style={{ color: '#e8e8e8' }}
        onClick={onToggle}
      >
        <ListMusic size={12} className={activeShowId ? 'text-logic-accent' : 'text-logic-text-dim'} />
        Shows
        <ChevronDown size={11} className={`text-logic-text-muted transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute left-0 top-7 z-50 w-72 py-1 bg-logic-bg-panel border border-logic-border-light shadow-logic-raised rounded-b animate-[fadeIn_120ms_ease-out]">
          <ShowRow
            name={DEFAULT_SHOW_NAME}
            hint="Sequência original do projeto"
            count={countOf(null, defaultCount)}
            active={!activeShowId}
            onPick={() => { activateShow(null); onClose(); }}
          />
          {shows.length > 0 && <div className="h-px bg-logic-border-dark my-1" />}
          {shows.map((sh) => (
            <ShowRow
              key={sh.id}
              name={sh.name}
              count={countOf(sh.id, sh.playlist.length)}
              active={sh.id === activeShowId}
              onPick={() => pick(sh.id)}
              actions={confirmDelete === sh.id ? (
                <button
                  className="px-1.5 h-5 rounded text-2xs font-medium bg-logic-lcd-red text-white hover:brightness-110"
                  onClick={(e) => { e.stopPropagation(); deleteShow(sh.id); setConfirmDelete(null); }}
                >
                  Excluir?
                </button>
              ) : (
                <>
                  <RowAction label="Editar e renomear" onClick={() => { setEditor({ showId: sh.id }); onClose(); }}><Pencil size={11} /></RowAction>
                  <RowAction label="Duplicar" onClick={() => duplicateShow(sh.id)}><Copy size={11} /></RowAction>
                  <RowAction label="Excluir" onClick={() => setConfirmDelete(sh.id)}><Trash2 size={11} /></RowAction>
                </>
              )}
            />
          ))}
          <div className="h-px bg-logic-border-dark my-1" />
          <button
            className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-logic-accent hover:text-white transition-colors duration-75"
            onClick={() => { setEditor({ showId: null }); onClose(); }}
          >
            <Plus size={12} />
            Criar Show...
          </button>
        </div>
      )}

      {editor && <ShowEditorDialog showId={editor.showId} onClose={() => setEditor(null)} />}
    </div>
  );
}

function ShowRow({ name, hint, count, active, onPick, actions }: {
  name: string; hint?: string; count: number; active: boolean; onPick: () => void; actions?: React.ReactNode;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onPick}
      onKeyDown={(e) => { if (e.key === 'Enter') onPick(); }}
      title={active ? 'Show ativo' : 'Ativar este show'}
      className={`group flex items-center gap-2 px-3 py-1.5 cursor-pointer transition-colors duration-75
        ${active ? 'bg-logic-accent/15' : 'hover:bg-logic-bg-panel-light'}`}
    >
      <span className={`w-3.5 shrink-0 ${active ? 'text-logic-accent' : 'text-transparent'}`}><Check size={12} /></span>
      <span className="flex-1 min-w-0">
        <span className={`block truncate ${active ? 'text-logic-text font-medium' : 'text-logic-text'}`}>{name}</span>
        {hint && <span className="block truncate text-2xs text-logic-text-muted">{hint}</span>}
      </span>
      {actions && <span className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>{actions}</span>}
      <span className="shrink-0 text-2xs tabular-nums text-logic-text-muted">{count} {count === 1 ? 'música' : 'músicas'}</span>
    </div>
  );
}

function RowAction({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      className="w-5 h-5 flex items-center justify-center rounded text-logic-text-dim hover:text-logic-text hover:bg-logic-bg-deep transition-colors"
      onClick={onClick}
      title={label}
      aria-label={label}
    >
      {children}
    </button>
  );
}
