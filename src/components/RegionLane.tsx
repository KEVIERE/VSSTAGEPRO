import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Trash2, CornerDownRight, Repeat, SkipForward } from 'lucide-react';
import { useStore } from '@/store';
import type { Song, SongRegion } from '@/types';
import {
  REGION_COLORS, sortedRegions, formatRegionTime, neighbourBounds, RESIZE_MIN_LENGTH, suggestRegionStyle,
  resolveRegionMove, REPEAT_OPTIONS, repeatLabel,
} from '@/lib/regions';
import type { RegionLayout } from '@/lib/regions';
import { snapTime, songGrid } from '@/lib/grid';
import { seekToPosition } from '@/lib/transportControl';

export type RegionDrag = { id: string; start: number; end: number; layout?: RegionLayout | null } | null;
type DragMode = 'move' | 'start' | 'end';

const DRAG_THRESHOLD_PX = 3;
const EDGE_PX = 6;

interface RegionLaneProps {
  song: Song;
  zoomH: number;
  drag: RegionDrag;
  onDragChange: (drag: RegionDrag) => void;
  editingId: string | null;
  onEdit: (id: string | null) => void;
}

export function RegionLane({ song, zoomH, drag, onDragChange, editingId, onEdit }: RegionLaneProps) {
  const updateSongRegion = useStore((s) => s.updateSongRegion);
  const placeSongRegions = useStore((s) => s.placeSongRegions);
  const addSongRegion = useStore((s) => s.addSongRegion);
  const queuedId = useStore((s) => (s.queuedRegion?.songId === song.id ? s.queuedRegion.regionId : null));
  const setQueuedRegion = useStore((s) => s.setQueuedRegion);
  const snapStep = useStore((s) => s.snapStep);
  const [draft, setDraft] = useState<{ start: number; end: number } | null>(null);
  const regions = sortedRegions(song.regions);
  const grid = songGrid(song);
  const snap = (t: number, free: boolean) => snapTime(t, grid, free ? 'off' : snapStep);

  const handleRegionPointerDown = (e: React.PointerEvent<HTMLDivElement>, region: SongRegion) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const rect = el.getBoundingClientRect();
    const localX = e.clientX - rect.left;
    const mode: DragMode = localX <= EDGE_PX ? 'start' : localX >= rect.width - EDGE_PX ? 'end' : 'move';
    const startX = e.clientX;
    const { min, max } = neighbourBounds(song, region.id);
    const length = region.end - region.start;
    const minLen = Math.min(RESIZE_MIN_LENGTH, max - min);
    let moved = false;
    let latest = { start: region.start, end: region.end };
    let layout: RegionLayout | null = null;

    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      if (!moved && Math.abs(dx) < DRAG_THRESHOLD_PX) return;
      moved = true;
      const dt = dx / zoomH;
      if (mode === 'move') {
        const s = Math.min(Math.max(0, snap(region.start + dt, ev.altKey)), Math.max(0, song.duration - length));
        latest = { start: s, end: s + length };
        layout = resolveRegionMove(song, region.id, s);
        onDragChange({ id: region.id, ...latest, layout });
        return;
      } else if (mode === 'start') {
        const s = Math.min(Math.max(min, snap(region.start + dt, ev.altKey)), region.end - minLen);
        latest = { start: s, end: region.end };
      } else {
        const en = Math.max(Math.min(max, snap(region.end + dt, ev.altKey)), region.start + minLen);
        latest = { start: region.start, end: en };
      }
      onDragChange({ id: region.id, ...latest });
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      try { el.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      onDragChange(null);
      if (moved) {
        if (mode === 'move') {
          if (layout) placeSongRegions(song.id, layout);
        } else if (latest.start !== region.start || latest.end !== region.end) {
          updateSongRegion(song.id, region.id, latest);
        }
      } else {
        seekToPosition(song.id, region.start);
      }
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  // Arrastar numa área vazia cria uma região que só ocupa o espaço livre.
  const handleLanePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || e.target !== e.currentTarget) return;
    e.preventDefault();
    const el = e.currentTarget;
    const rect = el.getBoundingClientRect();
    const toTime = (clientX: number) => Math.min(song.duration, Math.max(0, (clientX - rect.left) / zoomH));
    const anchor = snap(toTime(e.clientX), e.altKey);
    const prev = regions.filter((r) => r.end <= anchor + 1e-6).pop();
    const next = regions.find((r) => r.start >= anchor - 1e-6);
    const lo = prev ? prev.end : 0;
    const hi = next ? next.start : song.duration;
    const startX = e.clientX;
    let moved = false;
    let latest: { start: number; end: number } | null = null;
    el.setPointerCapture(e.pointerId);

    const move = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - startX) < DRAG_THRESHOLD_PX) return;
      moved = true;
      const t = Math.min(hi, Math.max(lo, snap(toTime(ev.clientX), ev.altKey)));
      latest = { start: Math.min(anchor, t), end: Math.max(anchor, t) };
      setDraft(latest);
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      try { el.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      setDraft(null);
      if (!moved || !latest) return;
      const id = `region-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
      const style = suggestRegionStyle(regions);
      if (addSongRegion(song.id, { id, ...style, start: latest.start, end: latest.end, loop: false })) onEdit(id);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  const editing = editingId ? regions.find((r) => r.id === editingId) : undefined;

  return (
    <div
      className="relative h-6 border-b border-logic-border-dark/60 bg-logic-bg-deep cursor-crosshair"
      onPointerDown={handleLanePointerDown}
      title="Arraste numa área vazia para criar uma região"
    >
      {drag?.layout?.[drag.id] && (
        <div
          className="absolute top-0.5 bottom-0.5 rounded-sm border border-dashed border-white/80 bg-white/10 pointer-events-none z-10"
          style={{ left: `${drag.layout[drag.id].start * zoomH}px`, width: `${Math.max(4, (drag.layout[drag.id].end - drag.layout[drag.id].start) * zoomH)}px` }}
        />
      )}
      {regions.map((r) => {
        const isDragging = drag?.id === r.id;
        const shifted = !isDragging ? drag?.layout?.[r.id] : undefined;
        const start = isDragging ? drag.start : shifted ? shifted.start : r.start;
        const end = isDragging ? drag.end : shifted ? shifted.end : r.end;
        const width = Math.max(4, (end - start) * zoomH);
        const isEditing = editingId === r.id;
        const isQueued = queuedId === r.id;
        const showButtons = width >= 64;
        return (
          <div
            key={r.id}
            data-region-id={r.id}
            className={`absolute top-0.5 bottom-0.5 rounded-sm flex items-center select-none touch-none group overflow-hidden transition-[filter,box-shadow] duration-150 hover:brightness-110 ${
              isDragging ? 'cursor-grabbing z-20 shadow-lg opacity-90 !transition-none' : 'cursor-grab z-10'
            } ${isDragging || isEditing ? 'ring-1 ring-white' : ''} ${isQueued ? 'ring-2 ring-logic-lcd-amber animate-pulse' : ''}`}
            style={{ left: `${start * zoomH}px`, width: `${width}px`, backgroundColor: r.color }}
            onPointerDown={(e) => handleRegionPointerDown(e, r)}
            onDoubleClick={(e) => { e.stopPropagation(); onEdit(r.id); }}
            title={`${r.name} · ${formatRegionTime(r.start)}–${formatRegionTime(r.end)}${r.loop ? ' · Loop' : ''}\nArraste o meio para mover e as bordas para redimensionar (Option desliga o alinhamento ao BPM)\nClique para ir · Clique duplo para editar`}
          >
            <div className="absolute left-0 top-0 bottom-0 w-1.5 cursor-ew-resize bg-black/0 group-hover:bg-black/25 transition-colors" />
            <div className="absolute right-0 top-0 bottom-0 w-1.5 cursor-ew-resize bg-black/0 group-hover:bg-black/25 transition-colors" />
            <div className="flex items-center gap-1 pl-2 pr-1 flex-1 min-w-0 text-2xs font-medium text-black pointer-events-none">
              <span className="truncate">{isDragging ? `${formatRegionTime(start)}–${formatRegionTime(end)}` : r.name}</span>
            </div>
            {showButtons ? (
              <div className="flex items-center gap-0.5 pr-2 flex-shrink-0">
                <RegionToggle
                  active={r.loop}
                  label={r.loop ? 'Loop ligado (clique para desligar)' : 'Ligar loop'}
                  onToggle={() => updateSongRegion(song.id, r.id, { loop: !r.loop })}
                >
                  <Repeat size={10} strokeWidth={2.5} />
                </RegionToggle>
                <RegionToggle
                  active={isQueued}
                  label={isQueued ? 'Próximo: a agulha pula para cá ao fim da região atual (clique para cancelar)' : 'Próximo: pular para esta região ao fim da região atual'}
                  onToggle={() => setQueuedRegion(isQueued ? null : { songId: song.id, regionId: r.id })}
                >
                  <SkipForward size={10} strokeWidth={2.5} />
                </RegionToggle>
              </div>
            ) : (
              r.loop && <Repeat size={10} strokeWidth={2.5} className="mr-1.5 flex-shrink-0 text-black pointer-events-none" />
            )}
          </div>
        );
      })}
      {draft && (
        <div
          className="absolute top-0.5 bottom-0.5 rounded-sm border border-dashed border-logic-text-dim bg-logic-text/10 pointer-events-none"
          style={{ left: `${draft.start * zoomH}px`, width: `${Math.max(2, (draft.end - draft.start) * zoomH)}px` }}
        />
      )}
      {editing && <RegionEditor song={song} region={editing} queued={queuedId === editing.id} onClose={() => onEdit(null)} />}
    </div>
  );
}

function RegionToggle({ active, label, onToggle, children }: { active: boolean; label: string; onToggle: () => void; children: React.ReactNode }) {
  return (
    <button
      className={`w-4 h-4 rounded-[3px] flex items-center justify-center transition-colors duration-100 ${
        active ? 'bg-black/80 text-white' : 'bg-black/0 text-black/60 hover:bg-black/20 hover:text-black'
      }`}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onClick={(e) => { e.stopPropagation(); onToggle(); }}
      title={label}
      aria-label={label}
      aria-pressed={active}
    >
      {children}
    </button>
  );
}

export function RegionGuides({ song, zoomH, drag }: { song: Song; zoomH: number; drag: RegionDrag }) {
  const regions = song.regions ?? [];
  if (regions.length === 0) return null;
  return (
    <>
      {regions.map((r) => {
        const active = drag?.id === r.id;
        const start = active ? drag.start : r.start;
        const end = active ? drag.end : r.end;
        return (
          <div
            key={r.id}
            className="absolute top-0 bottom-0 pointer-events-none z-20 border-l border-r"
            style={{
              left: `${start * zoomH}px`,
              width: `${(end - start) * zoomH}px`,
              borderColor: r.color,
              opacity: active ? 0.9 : 0.4,
              backgroundColor: r.loop ? `${r.color}0d` : undefined,
            }}
          />
        );
      })}
    </>
  );
}

function RegionEditor({ song, region, queued, onClose }: { song: Song; region: SongRegion; queued: boolean; onClose: () => void }) {
  const updateSongRegion = useStore((s) => s.updateSongRegion);
  const removeSongRegion = useStore((s) => s.removeSongRegion);
  const setQueuedRegion = useStore((s) => s.setQueuedRegion);
  const [name, setName] = useState(region.name);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef(name);
  nameRef.current = name;

  const commitName = () => {
    const trimmed = nameRef.current.trim();
    if (trimmed && trimmed !== region.name) updateSongRegion(song.id, region.id, { name: trimmed });
  };
  const close = () => {
    commitName();
    onClose();
  };
  const closeRef = useRef(close);
  closeRef.current = close;

  useLayoutEffect(() => {
    const anchor = document.querySelector(`[data-region-id="${region.id}"]`);
    const panelWidth = 256;
    if (!anchor) {
      setCoords({ top: 120, left: window.innerWidth / 2 - panelWidth / 2 });
      return;
    }
    const r = anchor.getBoundingClientRect();
    const left = Math.min(Math.max(8, r.left - 12), window.innerWidth - panelWidth - 8);
    setCoords({ top: r.bottom + 6, left });
  }, [region.id]);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
    const onPointerDown = (e: PointerEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) closeRef.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeRef.current();
      }
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
      role="dialog"
      aria-label="Editar região"
    >
      <div className="flex items-center justify-between">
        <span className="text-2xs uppercase tracking-wider text-logic-text-muted">Região</span>
        <span className="text-2xs font-mono text-logic-text-dim">
          {formatRegionTime(region.start)} – {formatRegionTime(region.end)}
        </span>
      </div>

      <input
        ref={inputRef}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={commitName}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); close(); } }}
        maxLength={40}
        className="w-full px-2 py-1.5 text-xs rounded bg-logic-bg-deep border border-logic-border-light text-logic-text focus:outline-none focus:border-logic-accent transition-colors"
        placeholder="Nome da seção"
      />

      <div className="grid grid-cols-8 gap-1.5">
        {REGION_COLORS.map((c) => {
          const selected = c.value === region.color;
          return (
            <button
              key={c.value}
              className={`w-6 h-6 rounded-full transition-transform duration-100 hover:scale-110 ${selected ? 'ring-2 ring-white ring-offset-2 ring-offset-logic-bg-panel' : ''}`}
              style={{ backgroundColor: c.value }}
              onClick={() => updateSongRegion(song.id, region.id, { color: c.value })}
              title={c.name}
              aria-label={`Cor ${c.name}`}
              aria-pressed={selected}
            />
          );
        })}
      </div>

      <div className="flex flex-col gap-1.5">
        <EditorSwitch
          on={region.loop}
          icon={<Repeat size={13} />}
          label="Loop"
          onToggle={() => updateSongRegion(song.id, region.id, { loop: !region.loop })}
        />
        {region.loop && (
          <div className="flex items-center justify-between gap-2 px-2.5">
            <span className="text-2xs text-logic-text-muted">Repetir</span>
            <div className="flex gap-1">
              {REPEAT_OPTIONS.map((n) => (
                <button
                  key={n ?? 0}
                  className={`min-w-[32px] h-6 px-1.5 rounded text-2xs font-semibold transition-colors ${
                    region.repeat === n ? 'bg-logic-lcd-green text-black' : 'bg-logic-bg-deep text-logic-text-dim hover:text-logic-text border border-logic-border-light'
                  }`}
                  onClick={() => updateSongRegion(song.id, region.id, { repeat: n })}
                  title={n ? `Toca ${n} vezes e segue` : 'Repete até desligar'}
                  aria-pressed={region.repeat === n}
                >
                  {repeatLabel(n)}
                </button>
              ))}
            </div>
          </div>
        )}
        <EditorSwitch
          on={queued}
          icon={<SkipForward size={13} />}
          label="Próximo"
          hint="Pula para cá ao fim da região atual"
          onToggle={() => setQueuedRegion(queued ? null : { songId: song.id, regionId: region.id })}
        />
      </div>

      <div className="flex items-center justify-between pt-1 border-t border-logic-border-dark">
        <button
          className="flex items-center gap-1 px-2 py-1 text-xs rounded text-logic-text-dim hover:text-logic-text hover:bg-logic-bg-panel-light transition-colors"
          onClick={() => { seekToPosition(song.id, region.start); close(); }}
        >
          <CornerDownRight size={12} />
          Ir para
        </button>
        <button
          className="flex items-center gap-1 px-2 py-1 text-xs rounded text-logic-lcd-red hover:bg-logic-lcd-red/15 transition-colors"
          onClick={() => { removeSongRegion(song.id, region.id); onClose(); }}
        >
          <Trash2 size={12} />
          Apagar
        </button>
      </div>
    </div>
  );
}

function EditorSwitch({ on, icon, label, hint, onToggle }: { on: boolean; icon: React.ReactNode; label: string; hint?: string; onToggle: () => void }) {
  return (
    <button
      className={`flex items-center justify-between gap-2 px-2.5 py-2 rounded border text-xs text-left transition-colors ${
        on
          ? 'border-logic-lcd-green/60 bg-logic-lcd-green/15 text-logic-lcd-green'
          : 'border-logic-border-light bg-logic-bg-deep text-logic-text-dim hover:text-logic-text'
      }`}
      onClick={onToggle}
      aria-pressed={on}
    >
      <span className="flex flex-col min-w-0">
        <span className="flex items-center gap-1.5 font-medium">{icon}{label}</span>
        {hint && <span className="text-2xs text-logic-text-muted truncate">{hint}</span>}
      </span>
      <span className={`relative flex-shrink-0 w-8 h-4 rounded-full transition-colors ${on ? 'bg-logic-lcd-green' : 'bg-logic-border-light'}`}>
        <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-[left] duration-150 ${on ? 'left-[18px]' : 'left-0.5'}`} />
      </span>
    </button>
  );
}
