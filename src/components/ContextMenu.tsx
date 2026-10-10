import { useEffect, useRef, useState, useCallback } from 'react';
import { useStore, ROUTABLE_TRACKS } from '@/store';
import type { RoutingTarget } from '@/types';

interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  clipId: string | null;
}

export default function ContextMenu() {
  const [state, setState] = useState<ContextMenuState>({
    visible: false, x: 0, y: 0, clipId: null,
  });
  const [submenuOpen, setSubmenuOpen] = useState(false);
  const [normalizeOpen, setNormalizeOpen] = useState(false);
  const [normalizeDb, setNormalizeDb] = useState('-2');
  const ref = useRef<HTMLDivElement>(null);
  const routeClip = useStore((s) => s.routeClip);
  const resetClipRouting = useStore((s) => s.resetClipRouting);
  const removeClip = useStore((s) => s.removeClip);
  const normalizeClip = useStore((s) => s.normalizeClip);
  const dawMode = useStore((s) => s.dawMode);
  const clips = useStore((s) => s.clips);
  const tracks = useStore((s) => s.tracks);

  const openMenu = useCallback((e: MouseEvent, clipId: string) => {
    e.preventDefault();
    setState({ visible: true, x: e.clientX, y: e.clientY, clipId });
    setSubmenuOpen(false);
    setNormalizeOpen(false);
  }, []);

  const closeMenu = useCallback(() => {
    setState((s) => ({ ...s, visible: false, clipId: null }));
    setSubmenuOpen(false);
    setNormalizeOpen(false);
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) closeMenu();
    };
    const escHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeMenu();
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', escHandler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', escHandler);
    };
  }, [closeMenu]);

  useEffect(() => {
    (window as unknown as { __openClipContextMenu?: (e: MouseEvent, clipId: string) => void }).__openClipContextMenu = openMenu;
    return () => {
      delete (window as unknown as { __openClipContextMenu?: (e: MouseEvent, clipId: string) => void }).__openClipContextMenu;
    };
  }, [openMenu]);

  if (!state.visible || !state.clipId) return null;

  const clip = clips.find((c) => c.id === state.clipId);

  const allTargets: { id: string; name: string; color: string; isChild: boolean }[] = [];
  for (const routeId of ROUTABLE_TRACKS) {
    const parent = tracks.find((t) => t.id === routeId);
    if (!parent) continue;
    allTargets.push({ id: parent.id, name: parent.name, color: parent.color, isChild: false });
    for (const childId of parent.children) {
      const child = tracks.find((t) => t.id === childId);
      if (child) allTargets.push({ id: child.id, name: child.name, color: child.color, isChild: true });
    }
  }

  return (
    <div
      ref={ref}
      className="fixed z-[100] min-w-52 bg-logic-bg-panel border border-logic-border-light shadow-logic-raised rounded text-xs select-none"
      style={{ left: state.x, top: Math.min(state.y, window.innerHeight - 300) }}
    >
      {/* Enviar Para submenu */}
      <div
        className="relative"
        onMouseEnter={() => setSubmenuOpen(true)}
        onMouseLeave={() => setSubmenuOpen(false)}
      >
        <button className="w-full flex items-center justify-between px-3 py-1.5 text-left hover:bg-logic-accent hover:text-white transition-colors duration-75">
          <span>Enviar Para</span>
          <span className="text-logic-text-muted">&rarr;</span>
        </button>
        {submenuOpen && (
          <div className="absolute left-full top-0 min-w-48 bg-logic-bg-panel border border-logic-border-light shadow-logic-raised rounded max-h-80 overflow-y-auto logic-scroll">
            {allTargets.map((target) => (
              <button
                key={target.id}
                className={`w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-logic-accent hover:text-white transition-colors duration-75
                  ${clip?.trackId === target.id ? 'text-logic-accent' : 'text-logic-text'}
                  ${target.isChild ? 'pl-6' : ''}`}
                onClick={() => {
                  routeClip(state.clipId!, target.id);
                  closeMenu();
                }}
              >
                <div className="w-1.5 h-4 rounded-sm flex-shrink-0" style={{ backgroundColor: target.color }} />
                <span className="truncate">{target.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="h-px bg-logic-border-dark my-1" />

      <button
        className="w-full flex items-center px-3 py-1.5 text-left hover:bg-logic-accent hover:text-white transition-colors duration-75"
        onClick={() => {
          if (state.clipId) resetClipRouting(state.clipId);
          closeMenu();
        }}
      >
        Voltar ao Roteamento Automático
      </button>

      {dawMode && (
        <>
          <div className="h-px bg-logic-border-dark my-1" />
          {normalizeOpen ? (
            <form
              className="px-3 py-2 flex items-center gap-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                const db = parseFloat(normalizeDb.replace(',', '.'));
                if (state.clipId && Number.isFinite(db)) normalizeClip(state.clipId, Math.min(0, db));
                closeMenu();
              }}
            >
              <span className="text-logic-text-dim whitespace-nowrap">Pico em</span>
              <input
                autoFocus
                type="text"
                inputMode="decimal"
                value={normalizeDb}
                onChange={(e) => setNormalizeDb(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                className="w-14 bg-logic-bg-deep border border-logic-border-light rounded px-1.5 py-0.5 text-right outline-none focus:border-logic-accent"
              />
              <span className="text-logic-text-dim">dB</span>
              <button type="submit" className="ml-1 px-2 py-0.5 rounded bg-logic-accent text-white hover:brightness-110 transition">OK</button>
            </form>
          ) : (
            <button
              className="w-full flex items-center px-3 py-1.5 text-left hover:bg-logic-accent hover:text-white transition-colors duration-75"
              onClick={(e) => { e.stopPropagation(); setNormalizeOpen(true); }}
            >
              Normalizar...
            </button>
          )}
        </>
      )}

      <button
        className="w-full flex items-center px-3 py-1.5 text-left hover:bg-logic-accent hover:text-white transition-colors duration-75"
        onClick={() => {
          if (clip) {
            useStore.getState().setImportProgress({
              clipId: clip.id,
              status: 'done',
              message: `${clip.name} | Rota: ${clip.routingMethod} | Conf: ${(clip.routingConfidence * 100).toFixed(0)}% | ${clip.duration.toFixed(1)}s`,
            });
            setTimeout(() => useStore.getState().setImportProgress(null), 3000);
          }
          closeMenu();
        }}
      >
        Ver Info
      </button>

      <div className="h-px bg-logic-border-dark my-1" />

      <button
        className="w-full flex items-center px-3 py-1.5 text-left hover:bg-logic-lcd-red hover:text-white transition-colors duration-75"
        onClick={() => {
          if (state.clipId) removeClip(state.clipId);
          closeMenu();
        }}
      >
        Remover Clip
      </button>
    </div>
  );
}
