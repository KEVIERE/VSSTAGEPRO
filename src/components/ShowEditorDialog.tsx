import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Check, Music2, Plus, X } from 'lucide-react';
import { useStore } from '@/store';
import { projectPlaylist, syncedShows } from '@/lib/shows';
import { formatClock } from '@/lib/prompterView';

interface Props {
  showId: string | null;
  onClose: () => void;
}

export default function ShowEditorDialog({ showId, onClose }: Props) {
  const songs = useStore((s) => s.songs);
  const createShow = useStore((s) => s.createShow);
  const updateShow = useStore((s) => s.updateShow);
  const activateShow = useStore((s) => s.activateShow);
  const [sequence, setSequence] = useState<string[]>([]);
  const [name, setName] = useState('');

  const editing = showId !== null;

  useEffect(() => {
    const st = useStore.getState();
    const show = showId ? syncedShows(st).find((sh) => sh.id === showId) : null;
    setSequence(show ? show.playlist.map((p) => p.songId) : []);
    setName(show ? show.name : `Show ${st.shows.length + 1}`);
  }, [showId]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const library = useMemo(() => {
    const order = projectPlaylist(useStore.getState()).map((p) => p.songId);
    const rank = new Map(order.map((id, i) => [id, i]));
    return [...songs].sort((a, b) => (rank.get(a.id) ?? 1e9) - (rank.get(b.id) ?? 1e9));
  }, [songs]);

  const byId = useMemo(() => new Map(songs.map((s) => [s.id, s])), [songs]);
  const total = sequence.reduce((sum, id) => sum + (byId.get(id)?.duration ?? 0), 0);

  const toggle = (id: string) =>
    setSequence((seq) => seq.includes(id) ? seq.filter((x) => x !== id) : [...seq, id]);

  const move = (index: number, delta: number) => setSequence((seq) => {
    const to = index + delta;
    if (to < 0 || to >= seq.length) return seq;
    const next = [...seq];
    [next[index], next[to]] = [next[to], next[index]];
    return next;
  });

  const canSave = sequence.length > 0 && name.trim().length > 0;

  const save = () => {
    if (!canSave) return;
    if (editing) {
      updateShow(showId, { name, songIds: sequence });
    } else {
      activateShow(createShow(name, sequence));
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[220] flex items-center justify-center bg-black/60 animate-[fadeIn_150ms_ease-out]">
      <div className="w-[760px] max-w-[94vw] h-[600px] max-h-[90vh] flex flex-col bg-logic-bg-panel border border-logic-border-light shadow-logic-raised rounded">
        <div className="flex items-center justify-between px-4 py-3 border-b border-logic-border-dark">
          <div>
            <h2 className="text-sm font-medium text-logic-text">{editing ? 'Editar Show' : 'Criar Show'}</h2>
            <p className="text-[11px] text-logic-text-muted">Clique nas músicas na ordem em que vão tocar.</p>
          </div>
          <button
            className="w-6 h-6 flex items-center justify-center text-logic-text-dim hover:text-logic-text hover:bg-logic-bg-panel-light rounded transition-colors"
            onClick={onClose}
            aria-label="Fechar"
          >
            <X size={14} />
          </button>
        </div>

        <div className="flex-1 min-h-0 grid grid-cols-2 divide-x divide-logic-border-dark">
          <div className="flex flex-col min-h-0">
            <div className="px-4 py-2 text-[10px] uppercase tracking-wider text-logic-text-muted">
              Músicas do projeto · {library.length}
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-2">
              {library.length === 0 && (
                <p className="px-2 py-6 text-center text-xs text-logic-text-muted">Importe músicas para montar um show.</p>
              )}
              {library.map((song) => {
                const pos = sequence.indexOf(song.id);
                const picked = pos >= 0;
                return (
                  <button
                    key={song.id}
                    onClick={() => toggle(song.id)}
                    className={`w-full flex items-center gap-2.5 px-2 py-1.5 rounded text-left text-xs transition-colors duration-100
                      ${picked ? 'bg-logic-accent/15 text-logic-text' : 'text-logic-text-dim hover:bg-logic-bg-panel-light hover:text-logic-text'}`}
                  >
                    <span className={`w-5 h-5 shrink-0 flex items-center justify-center rounded-full text-[10px] font-semibold tabular-nums transition-all duration-150
                      ${picked ? 'bg-logic-accent text-white scale-100' : 'border border-logic-border-light text-transparent scale-90'}`}>
                      {picked ? pos + 1 : <Plus size={10} />}
                    </span>
                    <span className="flex-1 min-w-0 truncate">{song.name}</span>
                    <span className="shrink-0 text-[10px] tabular-nums text-logic-text-muted">{formatClock(song.duration)}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-col min-h-0">
            <div className="px-4 py-2 flex items-center justify-between text-[10px] uppercase tracking-wider text-logic-text-muted">
              <span>Sequência · {sequence.length}</span>
              <span className="tabular-nums normal-case tracking-normal">{formatClock(total)}</span>
            </div>
            <ol className="flex-1 min-h-0 overflow-y-auto px-2 pb-2">
              {sequence.length === 0 && (
                <li className="h-full flex flex-col items-center justify-center gap-2 text-xs text-logic-text-muted">
                  <Music2 size={20} className="opacity-50" />
                  Nenhuma música escolhida ainda.
                </li>
              )}
              {sequence.map((id, i) => (
                <li key={id} className="group flex items-center gap-2.5 px-2 py-1.5 rounded text-xs hover:bg-logic-bg-panel-light animate-[fadeIn_150ms_ease-out]">
                  <span className="w-5 shrink-0 text-right text-[11px] font-semibold tabular-nums text-logic-accent">{i + 1}</span>
                  <span className="flex-1 min-w-0 truncate text-logic-text">{byId.get(id)?.name ?? 'Música removida'}</span>
                  <span className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <IconBtn label="Subir" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp size={11} /></IconBtn>
                    <IconBtn label="Descer" disabled={i === sequence.length - 1} onClick={() => move(i, 1)}><ArrowDown size={11} /></IconBtn>
                    <IconBtn label="Tirar do show" onClick={() => toggle(id)}><X size={11} /></IconBtn>
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </div>

        <div className="flex items-center gap-3 px-4 py-3 border-t border-logic-border-dark">
          <label className="text-[11px] text-logic-text-dim shrink-0" htmlFor="vs-show-name">Nome do show</label>
          <input
            id="vs-show-name"
            className="flex-1 min-w-0 px-2.5 py-1.5 text-xs rounded bg-logic-bg-deep border border-logic-border-dark text-logic-text focus:outline-none focus:border-logic-accent transition-colors"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
            maxLength={80}
          />
          <button
            className="px-3 py-1.5 text-xs rounded bg-logic-bg-deep text-logic-text border border-logic-border-dark hover:bg-logic-bg-panel-light transition-colors"
            onClick={onClose}
          >
            Cancelar
          </button>
          <button
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-logic-accent text-white hover:brightness-110 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            onClick={save}
            disabled={!canSave}
          >
            <Check size={12} />
            {editing ? 'Salvar' : 'Criar'}
          </button>
        </div>
      </div>
    </div>
  );
}

function IconBtn({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      className="w-5 h-5 flex items-center justify-center rounded text-logic-text-dim hover:text-logic-text hover:bg-logic-bg-deep transition-colors disabled:opacity-30 disabled:pointer-events-none"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
    >
      {children}
    </button>
  );
}
