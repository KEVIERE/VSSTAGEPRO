import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Maximize2, Minimize2, Music, PenLine, Radio, X } from 'lucide-react';
import LivePanel from '@/components/musician/LivePanel';
import SheetPanel from '@/components/musician/SheetPanel';
import { computeLiveView, holdForward } from '@/lib/liveClock';
import type { MusicianState, SetlistSong, SheetBackend, SheetInfo } from '@/lib/musicianTypes';

const SPLIT_LS = 'vs_musician_split';
const HINT_LS = 'vs_musician_notebook_hint';
const TICK_MS = 250;
const WIDE_QUERY = '(min-width: 768px)';

type Panel = 'live' | 'sheet';

const PANEL_LABELS: Record<Panel, string> = { live: 'Playlist do show', sheet: 'Partitura / Cifra' };

function useIsWide(): boolean {
  const [wide, setWide] = useState(() => window.matchMedia(WIDE_QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia(WIDE_QUERY);
    const onChange = () => setWide(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return wide;
}

function usePanelFocus() {
  const [focus, setFocus] = useState<Panel | null>(null);

  const exit = useCallback(() => {
    setFocus(null);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }, []);

  const enter = useCallback((panel: Panel) => {
    setFocus(panel);
    const el = document.documentElement;
    if (!document.fullscreenElement && el.requestFullscreen) el.requestFullscreen().catch(() => {});
  }, []);

  useEffect(() => {
    if (!focus) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') exit(); };
    const onFs = () => { if (!document.fullscreenElement) setFocus(null); };
    window.addEventListener('keydown', onKey);
    document.addEventListener('fullscreenchange', onFs);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('fullscreenchange', onFs);
    };
  }, [focus, exit]);

  return { focus, enter, exit };
}

export default function MusicianWorkspace({
  state, sync, sheets, backend, onSheetsChanged, onCreateAccount, status, logoutLabel, onLogout,
}: {
  state: MusicianState;
  sync: { lagMs: number; receivedAt: number };
  sheets: SheetInfo[];
  backend: SheetBackend;
  onSheetsChanged: () => Promise<void>;
  onCreateAccount: (() => void) | null;
  /** Shown in the middle of the top bar, e.g. the show name or the connection state. */
  status: ReactNode;
  logoutLabel: string;
  onLogout: () => void;
}) {
  const [now, setNow] = useState(Date.now());
  const shownTimeRef = useRef<{ songId: string | null; t: number }>({ songId: null, t: 0 });
  const [follow, setFollow] = useState(true);
  const [pinnedSongId, setPinnedSongId] = useState<string | null>(null);
  const [mobileTab, setMobileTab] = useState<Panel>('live');
  const [showHint, setShowHint] = useState(() => localStorage.getItem(HINT_LS) !== '1');
  const [split, setSplit] = useState(() => {
    const v = Number(localStorage.getItem(SPLIT_LS));
    return v >= 0.25 && v <= 0.7 ? v : 0.38;
  });
  const splitRef = useRef<HTMLDivElement>(null);
  const wide = useIsWide();
  const { focus, enter: enterFocus, exit: exitFocus } = usePanelFocus();

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, []);

  const startDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    const box = splitRef.current?.getBoundingClientRect();
    if (!box) return;
    let last = split;
    const move = (ev: PointerEvent) => {
      last = Math.max(0.25, Math.min(0.7, (ev.clientX - box.left) / box.width));
      setSplit(last);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      localStorage.setItem(SPLIT_LS, String(last));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const live = state.show?.live ?? null;
  const setlist = state.show?.setlist ?? null;
  const songMap = new Map((setlist?.songs ?? []).map((s) => [s.id, s]));
  const currentSong = live?.currentSongId ? songMap.get(live.currentSongId) : null;
  const nextSong = live?.nextSongId ? songMap.get(live.nextSongId) : null;
  const orderedSongs = (setlist?.order ?? []).map((id) => songMap.get(id)).filter((s): s is SetlistSong => !!s);
  const lv = holdForward(
    computeLiveView(live, currentSong?.duration, sync.lagMs, sync.receivedAt, now),
    live?.currentSongId ?? null, shownTimeRef.current, currentSong?.duration,
  );

  const sheetSongId = (follow ? (live?.currentSongId ?? pinnedSongId) : pinnedSongId) ?? orderedSongs[0]?.id ?? null;
  const sheetSong = sheetSongId ? songMap.get(sheetSongId) : undefined;

  const dismissHint = () => {
    setShowHint(false);
    localStorage.setItem(HINT_LS, '1');
  };

  const openTab = (p: Panel) => {
    setMobileTab(p);
    if (p === 'sheet') dismissHint();
  };

  const selectSong = (id: string) => {
    setPinnedSongId(id);
    setFollow(id === live?.currentSongId);
    openTab('sheet');
    if (focus === 'live') enterFocus('sheet');
  };

  const toggleFollow = () => {
    if (follow) setPinnedSongId(sheetSongId);
    setFollow(!follow);
  };

  const livePanel = (
    <LivePanel
      lv={lv} live={live} currentSong={currentSong} nextSong={nextSong}
      orderedSongs={orderedSongs} sheets={sheets} selectedSongId={sheetSongId}
      onSelectSong={selectSong} onCreateAccount={onCreateAccount}
    />
  );
  const sheetPanel = (
    <SheetPanel
      backend={backend} songId={sheetSongId ?? null} songName={sheetSong?.name ?? ''}
      sheet={sheets.find((s) => s.song_id === sheetSongId)}
      follow={follow} onToggleFollow={toggleFollow} onSheetsChanged={onSheetsChanged}
      liveSongId={live?.currentSongId ?? null} liveSongName={currentSong?.name ?? null}
    />
  );

  return (
    <div className="flex flex-col bg-logic-bg-deep" style={{ height: '100%' }}>
      <div className="flex items-center justify-between gap-3 px-4 py-2 bg-logic-bg-panel border-b border-logic-border-dark">
        <div className="flex items-center gap-2 min-w-0">
          <Music size={16} className="text-logic-lcd-green flex-shrink-0" />
          <div className="min-w-0">
            <span className="text-sm font-semibold text-logic-text truncate block">{state.musician.name}</span>
            {state.musician.instrument && <span className="text-2xs text-logic-text-muted">{state.musician.instrument}</span>}
          </div>
        </div>
        <div className="min-w-0 hidden lg:block">{status}</div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {focus ? (
            <button
              onClick={exitFocus}
              className="flex items-center gap-1.5 h-8 px-3 rounded-md bg-logic-accent/15 border border-logic-accent/50 text-xs font-medium text-logic-accent hover:bg-logic-accent/25 transition-colors"
              title="Voltar ao normal (Esc)"
            >
              <Minimize2 size={14} /> <span className="hidden sm:inline">Recolher</span>
            </button>
          ) : (
            (wide ? (['live', 'sheet'] as const) : [mobileTab]).map((p) => (
              <button
                key={p}
                onClick={() => enterFocus(p)}
                className="flex items-center gap-1.5 h-8 px-2.5 rounded-md border border-logic-border-light text-xs text-logic-text-dim hover:text-logic-text hover:bg-logic-bg-panel-light transition-colors"
                title={`Expandir ${PANEL_LABELS[p]} para tela inteira`}
              >
                <Maximize2 size={13} /> <span className="hidden sm:inline">{wide ? (p === 'live' ? 'Playlist' : 'Partitura') : 'Tela inteira'}</span>
              </button>
            ))
          )}
          <button className="ml-1.5 text-2xs text-logic-text-muted hover:text-logic-lcd-red transition-colors" onClick={onLogout}>
            {logoutLabel}
          </button>
        </div>
      </div>

      {focus ? (
        <div key={focus} className="flex-1 min-h-0 flex flex-col overflow-hidden animate-[fadeIn_200ms_ease-out]">
          {focus === 'live' ? livePanel : sheetPanel}
        </div>
      ) : wide ? (
        <div ref={splitRef} className="flex-1 min-h-0 flex">
          <div className="min-h-0 flex flex-col overflow-hidden" style={{ width: `${split * 100}%` }}>{livePanel}</div>
          <div
            onPointerDown={startDrag}
            title="Arraste para ajustar"
            className="w-1.5 flex-shrink-0 cursor-col-resize bg-logic-border-dark hover:bg-logic-accent/60 active:bg-logic-accent transition-colors"
          />
          <div className="flex-1 min-w-0 min-h-0 flex flex-col">{sheetPanel}</div>
        </div>
      ) : (
        <>
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden">{mobileTab === 'live' ? livePanel : sheetPanel}</div>
          <div className="relative flex items-center justify-around px-2 py-1.5 bg-logic-bg-panel border-t border-logic-border-dark">
            {showHint && mobileTab === 'live' && (
              <div className="absolute bottom-full right-3 mb-2 max-w-[240px] flex items-start gap-2 pl-3 pr-1.5 py-2 rounded-lg bg-logic-accent text-white shadow-2xl animate-[fadeIn_200ms_ease-out]">
                <p className="text-xs leading-snug">
                  <span className="font-semibold block">Seu caderno está aqui</span>
                  Cifras, partituras, pincel, marca-texto e borracha.
                </p>
                <button onClick={dismissHint} className="p-1 rounded hover:bg-white/15 transition-colors" aria-label="Fechar aviso"><X size={14} /></button>
                <span className="absolute -bottom-1 right-[22%] w-2.5 h-2.5 rotate-45 bg-logic-accent" />
              </div>
            )}
            {([['live', 'Ao vivo', Radio], ['sheet', 'Partitura', PenLine]] as const).map(([id, label, Icon]) => (
              <button
                key={id}
                onClick={() => openTab(id)}
                className={`relative flex flex-col items-center gap-0.5 px-6 py-1 rounded transition-colors ${mobileTab === id ? 'text-logic-accent' : 'text-logic-text-muted hover:text-logic-text'}`}
              >
                <Icon size={20} />
                <span className="text-2xs">{label}</span>
                {id === 'sheet' && showHint && mobileTab !== 'sheet' && (
                  <span className="absolute top-0.5 right-5 w-2 h-2 rounded-full bg-logic-accent animate-pulse" />
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
