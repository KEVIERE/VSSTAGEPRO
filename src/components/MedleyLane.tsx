import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Trash2, Scissors } from 'lucide-react';
import { useStore } from '@/store';
import type { MedleyPart, Song } from '@/types';
import { cutBounds, medleySlices, partsWithCut, sortedParts, type MedleySlice } from '@/lib/medley';
import { formatRegionTime } from '@/lib/regions';
import { snapTime, songGrid } from '@/lib/grid';
import { seekToPosition } from '@/lib/transportControl';

const DRAG_THRESHOLD_PX = 3;

/** Corta o medley no ponto indicado; devolve false se não couber um corte ali. */
export function cutMedleyAt(song: Song, at: number): boolean {
  const st = useStore.getState();
  const parts = partsWithCut(song, snapTime(at, songGrid(song), st.snapStep));
  if (!parts) return false;
  st.updateSong(song.id, { medley: parts });
  return true;
}

export function MedleyLane({ song, zoomH }: { song: Song; zoomH: number }) {
  const updateSong = useStore((s) => s.updateSong);
  const snapStep = useStore((s) => s.snapStep);
  const [drag, setDrag] = useState<{ id: string; start: number } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const slices = medleySlices(song).map((s, i, all) => {
    if (!drag) return s;
    if (s.id === drag.id) return { ...s, start: drag.start };
    if (all[i + 1]?.id === drag.id) return { ...s, end: drag.start };
    return s;
  });
  const grid = songGrid(song);

  const handleCutPointerDown = (e: React.PointerEvent<HTMLDivElement>, part: MedleyPart) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const { min, max } = cutBounds(song, part.id);
    let moved = false;
    let latest = part.start;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      if (!moved && Math.abs(dx) < DRAG_THRESHOLD_PX) return;
      moved = true;
      latest = Math.min(max, Math.max(min, snapTime(part.start + dx / zoomH, grid, ev.altKey ? 'off' : snapStep)));
      setDrag({ id: part.id, start: latest });
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      try { el.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      setDrag(null);
      if (moved && latest !== part.start) {
        updateSong(song.id, { medley: sortedParts((song.medley ?? []).map((p) => (p.id === part.id ? { ...p, start: latest } : p))) });
      }
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  const handleLaneDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    cutMedleyAt(song, (e.clientX - rect.left) / zoomH);
  };

  const editing = editingId ? slices.find((s) => s.id === editingId) : undefined;

  return (
    <div
      className="relative h-6 border-b border-logic-border-dark/60 bg-logic-bg-deep"
      onDoubleClick={handleLaneDoubleClick}
      title="Clique duplo para cortar o medley neste ponto"
    >
      {slices.map((s, i) => (
        <div
          key={s.id}
          data-medley-id={s.id}
          className={`absolute top-0.5 bottom-0.5 flex items-center select-none cursor-pointer overflow-hidden border-y border-r border-logic-border-light/70 hover:bg-white/[0.09] transition-colors ${
            i % 2 === 0 ? 'bg-white/[0.06]' : 'bg-white/[0.03]'
          } ${editingId === s.id ? 'ring-1 ring-white' : ''}`}
          style={{ left: `${s.start * zoomH}px`, width: `${Math.max(2, (s.end - s.start) * zoomH)}px` }}
          onClick={() => seekToPosition(song.id, s.start)}
          onDoubleClick={(e) => { e.stopPropagation(); setEditingId(s.id); }}
          title={`${s.name} · ${formatRegionTime(s.start)}–${formatRegionTime(s.end)}\nClique para ir · Clique duplo para renomear ou apagar o corte`}
        >
          <span className="pl-2.5 pr-1 text-2xs font-semibold text-logic-text truncate pointer-events-none">
            <span className="text-logic-text-muted mr-1">{i + 1}</span>{s.name}
          </span>
        </div>
      ))}
      {slices.slice(1).map((s) => (
        <div
          key={`cut-${s.id}`}
          className="absolute top-0 bottom-0 w-2.5 -ml-[5px] z-10 cursor-ew-resize group touch-none"
          style={{ left: `${s.start * zoomH}px` }}
          onPointerDown={(e) => handleCutPointerDown(e, s)}
          onDoubleClick={(e) => e.stopPropagation()}
          title="Arraste para mover o corte (Option desliga o alinhamento ao BPM)"
        >
          <span className={`absolute left-1/2 -translate-x-1/2 top-0 bottom-0 w-0.5 transition-colors ${drag?.id === s.id ? 'bg-white' : 'bg-logic-lcd-yellow group-hover:bg-white'}`} />
          <Scissors size={9} className="absolute left-1/2 -translate-x-1/2 -top-px text-logic-lcd-yellow rotate-90 pointer-events-none" />
        </div>
      ))}
      {editing && <MedleyEditor song={song} slice={editing} first={editing.id === slices[0]?.id} onClose={() => setEditingId(null)} />}
    </div>
  );
}

function MedleyEditor({ song, slice, first, onClose }: { song: Song; slice: MedleySlice; first: boolean; onClose: () => void }) {
  const updateSong = useStore((s) => s.updateSong);
  const [name, setName] = useState(slice.name);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef(name);
  nameRef.current = name;

  const commitName = () => {
    const trimmed = nameRef.current.trim();
    if (!trimmed || trimmed === slice.name) return;
    const current = useStore.getState().songs.find((s) => s.id === song.id);
    updateSong(song.id, { medley: (current?.medley ?? []).map((p) => (p.id === slice.id ? { ...p, name: trimmed } : p)) });
  };
  const close = () => { commitName(); onClose(); };
  const closeRef = useRef(close);
  closeRef.current = close;

  const remove = () => {
    const parts = sortedParts(song.medley).filter((p) => p.id !== slice.id);
    updateSong(song.id, { medley: first || parts.length < 2 ? undefined : parts });
    onClose();
  };

  useLayoutEffect(() => {
    const anchor = document.querySelector(`[data-medley-id="${slice.id}"]`);
    const panelWidth = 256;
    if (!anchor) {
      setCoords({ top: 120, left: window.innerWidth / 2 - panelWidth / 2 });
      return;
    }
    const r = anchor.getBoundingClientRect();
    setCoords({ top: r.bottom + 6, left: Math.min(Math.max(8, r.left - 12), window.innerWidth - panelWidth - 8) });
  }, [slice.id]);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
    const onPointerDown = (e: PointerEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) closeRef.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      closeRef.current();
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, []);

  if (!coords) return null;

  return (
    <div
      ref={panelRef}
      className="fixed z-[100] w-64 rounded-md border border-logic-border-light bg-logic-bg-panel shadow-2xl p-3 flex flex-col gap-3 animate-[fadeIn_120ms_ease-out] cursor-default"
      style={{ top: coords.top, left: coords.left }}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      role="dialog"
      aria-label="Editar música do medley"
    >
      <div className="flex items-center justify-between">
        <span className="text-2xs uppercase tracking-wider text-logic-text-muted">Música do medley</span>
        <span className="text-2xs font-mono text-logic-text-dim">{formatRegionTime(slice.start)} – {formatRegionTime(slice.end)}</span>
      </div>
      <input
        ref={inputRef}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={commitName}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); close(); } }}
        maxLength={60}
        className="w-full px-2 py-1.5 text-xs rounded bg-logic-bg-deep border border-logic-border-light text-logic-text focus:outline-none focus:border-logic-accent transition-colors"
        placeholder="Nome da música"
      />
      <div className="flex justify-end pt-1 border-t border-logic-border-dark">
        <button
          className="flex items-center gap-1 px-2 py-1 text-xs rounded text-logic-lcd-red hover:bg-logic-lcd-red/15 transition-colors"
          onClick={remove}
          title={first ? 'Remove todos os cortes desta música' : 'Junta esta parte com a anterior'}
        >
          <Trash2 size={12} />
          {first ? 'Desfazer medley' : 'Apagar corte'}
        </button>
      </div>
    </div>
  );
}
