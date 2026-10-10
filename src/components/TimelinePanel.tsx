import { useStore, ROUTABLE_TRACKS } from '@/store';
import type { Track, AudioClip, ImportProgress } from '@/types';
import { ChevronRight, ChevronDown, ZoomIn, ZoomOut, Folder, FolderOpen, Plus, Loader2, FoldVertical, UnfoldVertical, Scissors } from 'lucide-react';
import { useState, useRef, useCallback, useEffect, useLayoutEffect, useMemo } from 'react';
import { audioEngine } from '@/lib/audioEngine';
import Playhead from '@/components/Playhead';
import { formatRegionTime, freeSlotAt, suggestRegionStyle } from '@/lib/regions';
import { RegionLane, RegionGuides, type RegionDrag } from '@/components/RegionLane';
import { MedleyLane, cutMedleyAt } from '@/components/MedleyLane';
import { ClipWaveform, routingColorOf, type VisibleRange } from '@/components/ClipWaveform';
import { BarRulerLayer, GridLinesOverlay, GridToolbar } from '@/components/TimelineGrid';
import { barBeatLabel, snapTime, songGrid } from '@/lib/grid';
import { clipPlayLength } from '@/lib/audioLibrary';
import { TIMECODE_TRACK_ID } from '@/lib/timecode';
import TimecodeTrackRow from '@/components/TimecodeTrackRow';

type TrimDrag = { ids: Set<string>; delta: number; anchorId: string; end: number; label: string } | null;

function ChildTrackRow({ childId, depth, expanded, onToggle }: { childId: string; depth: number; expanded: boolean; onToggle: () => void }) {
  const track = useStore((s) => s.tracks.find((t) => t.id === childId));
  if (!track) return null;
  return <TrackRow track={track} depth={depth} expanded={expanded} onToggle={onToggle} />;
}

// Alça fina no topo/fim de uma faixa: por padrão arrasta a altura de TODAS as faixas de
// uma vez (igual à alça da borda direita); segurando ⌘ (Cmd), muda só a altura desta faixa.
// Duplo clique: tamanho padrão — de todas, ou só desta se segurar ⌘.
function TrackHeightHandle({ trackId, edge }: { trackId: string; edge: 'top' | 'bottom' }) {
  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    const startY = e.clientY;
    const sign = edge === 'top' ? -1 : 1;
    const individual = e.metaKey || e.ctrlKey;

    if (individual) {
      const track = useStore.getState().tracks.find((t) => t.id === trackId);
      const startHeight = track?.height ?? 40;
      const move = (ev: PointerEvent) => {
        const deltaPx = (ev.clientY - startY) * sign;
        useStore.getState().setTrackHeight(trackId, startHeight + deltaPx);
      };
      const up = () => {
        target.removeEventListener('pointermove', move);
        target.removeEventListener('pointerup', up);
        target.removeEventListener('pointercancel', up);
        try { target.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      };
      target.addEventListener('pointermove', move);
      target.addEventListener('pointerup', up);
      target.addEventListener('pointercancel', up);
      return;
    }

    const startZoom = useStore.getState().zoomV;
    const move = (ev: PointerEvent) => {
      const deltaPx = (ev.clientY - startY) * sign;
      // ~120px de arraste dobra ou reduz à metade a altura das faixas.
      const next = startZoom * Math.pow(2, deltaPx / 120);
      useStore.getState().setZoomV(next);
    };
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
      try { target.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  }, [trackId, edge]);

  const onDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (e.metaKey || e.ctrlKey) useStore.getState().setTrackHeight(trackId, 40);
    else useStore.getState().setZoomV(1);
  }, [trackId]);

  return (
    <div
      className={`absolute left-0 right-0 h-1.5 ${edge === 'top' ? '-top-0.5' : '-bottom-0.5'} z-30 cursor-row-resize group/trackHeightHandle`}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      onClick={(e) => e.stopPropagation()}
      title="Arraste para ajustar a altura de todas as faixas. ⌘+arraste: só esta faixa. Duplo clique: tamanho padrão (⌘ para só esta)."
    >
      <div className={`absolute left-0 right-0 h-px ${edge === 'top' ? 'top-0.5' : 'bottom-0.5'} bg-logic-border-dark opacity-0 group-hover/trackHeightHandle:opacity-100 group-hover/trackHeightHandle:bg-logic-accent transition-opacity`} />
    </div>
  );
}

function TrackRow({ track, depth = 0, expanded = true, onToggle }: { track: Track; depth?: number; expanded?: boolean; onToggle?: () => void }) {
  const selectedTrackId = useStore((s) => s.selectedTrackId);
  const selectTrack = useStore((s) => s.selectTrack);
  const toggleMute = useStore((s) => s.toggleMute);
  const toggleSolo = useStore((s) => s.toggleSolo);
  const zoomV = useStore((s) => s.zoomV);
  const childClipCount = useStore((s) => {
    if (!track.isSubgroup) return 0;
    const childIds = new Set(track.children);
    return s.clips.filter((c) => childIds.has(c.trackId)).length;
  });

  const isSelected = selectedTrackId === track.id;
  const trackHeight = Math.round((track.height ?? 40) * zoomV);
  const isFolder = track.isSubgroup;

  return (
    <div
      data-selectable="track"
      className={`group relative flex items-center border-b border-logic-border-dark cursor-pointer transition-colors duration-75
        ${isSelected ? 'bg-logic-accent-dim' : isFolder ? 'bg-logic-bg-deep/60 hover:bg-logic-bg-panel-light' : 'hover:bg-logic-bg-panel-light'}`}
      style={{ paddingLeft: `${8 + depth * 16}px`, height: `${trackHeight}px` }}
      onClick={() => selectTrack(track.id)}
      onDoubleClick={(e) => { if (isFolder) { e.stopPropagation(); onToggle?.(); } }}
      title={isFolder ? 'Pasta: só agrupa as faixas abaixo. Áudio fica nas faixas filhas.' : undefined}
    >
      {!isFolder && <TrackHeightHandle trackId={track.id} edge="top" />}
      {!isFolder && <TrackHeightHandle trackId={track.id} edge="bottom" />}
      {isFolder ? (
        <button
          className="mr-1 text-logic-text-muted hover:text-logic-text flex items-center"
          onClick={(e) => { e.stopPropagation(); onToggle?.(); }}
          aria-label={expanded ? 'Recolher pasta' : 'Expandir pasta'}
        >
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
      ) : (
        <span className="w-4" />
      )}

      {isFolder ? (
        <span className="mr-1.5 flex items-center" style={{ color: track.color }}>
          {expanded ? <FolderOpen size={13} /> : <Folder size={13} />}
        </span>
      ) : (
        <div
          className="w-1 h-6 rounded-sm mr-2 flex-shrink-0"
          style={{ backgroundColor: track.color }}
        />
      )}

      <span className={`text-xs flex-1 truncate ${isSelected ? 'text-white' : isFolder ? 'text-logic-text font-medium uppercase tracking-wide' : 'text-logic-text'}`}>
        {track.name}
        {isFolder && (
          <span className="ml-1.5 text-2xs text-logic-text-muted font-normal normal-case tracking-normal">
            ({childClipCount})
          </span>
        )}
      </span>

      <div className="flex items-center gap-1 mr-1">
        <button
          className={`w-6 h-5 text-2xs font-bold rounded transition-colors duration-75 ${track.mute ? 'bg-logic-lcd-amber text-black' : 'bg-logic-bg-deep text-logic-text-muted hover:text-logic-text'}`}
          onClick={(e) => { e.stopPropagation(); toggleMute(track.id); }}
        >M</button>
        <button
          className={`w-6 h-5 text-2xs font-bold rounded transition-colors duration-75 ${track.solo ? 'bg-logic-lcd-amber text-black' : 'bg-logic-bg-deep text-logic-text-muted hover:text-logic-text'}`}
          onClick={(e) => { e.stopPropagation(); toggleSolo(track.id); }}
        >S</button>
      </div>
    </div>
  );
}

function FolderGroup({ track }: { track: Track }) {
  const [expanded, setExpanded] = useState(true);
  const toggle = useCallback(() => setExpanded((v) => !v), []);
  return (
    <>
      <TrackRow track={track} depth={0} expanded={expanded} onToggle={toggle} />
      {expanded && track.children.map((childId) => (
        <ChildTrackRow key={childId} childId={childId} depth={1} expanded={true} onToggle={() => {}} />
      ))}
    </>
  );
}

// Knob minúsculo de ganho do clipe (modo DAW): arrastar na vertical sobe/desce o ganho,
// duplo clique volta a 0dB (1x). Mesma lógica visual do pan knob do mixer, só que linear.
function ClipGainKnob({ clipId, gain }: { clipId: string; gain: number }) {
  const setClipGain = useStore((s) => s.setClipGain);
  const angle = Math.max(-135, Math.min(135, (Math.log2(Math.max(0.01, gain)) / 2) * 135));
  const db = gain <= 0.001 ? -Infinity : 20 * Math.log10(gain);
  const dbLabel = db === -Infinity ? '-inf' : `${db > 0.05 ? '+' : ''}${db.toFixed(1)}dB`;
  return (
    <div
      className="w-4 h-4 relative cursor-ns-resize select-none shrink-0"
      onDoubleClick={(e) => { e.stopPropagation(); setClipGain(clipId, 1); }}
      onPointerDown={(e) => {
        e.stopPropagation();
        e.preventDefault();
        const target = e.currentTarget;
        target.setPointerCapture(e.pointerId);
        const startY = e.clientY;
        const startGain = gain;
        const move = (ev: PointerEvent) => {
          const delta = (startY - ev.clientY) / 80;
          setClipGain(clipId, Math.max(0, Math.min(2, startGain * Math.pow(2, delta))));
        };
        const up = () => {
          target.removeEventListener('pointermove', move);
          target.removeEventListener('pointerup', up);
          target.removeEventListener('pointercancel', up);
          try { target.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
        };
        target.addEventListener('pointermove', move);
        target.addEventListener('pointerup', up);
        target.addEventListener('pointercancel', up);
      }}
      onClick={(e) => e.stopPropagation()}
      title={`Ganho do clipe: ${dbLabel} (arraste = ajustar, duplo clique = 0dB)`}
    >
      <svg viewBox="0 0 28 28" className="absolute inset-0 w-full h-full pointer-events-none">
        <circle cx="14" cy="14" r="12.5" fill="#1a1a1c" stroke="#3a3a3e" strokeWidth="1" />
        <circle cx="14" cy="14" r="9" fill="#26262a" stroke="#111" strokeWidth="0.5" />
        <g style={{ transform: `rotate(${angle}deg)`, transformOrigin: '14px 14px' }}>
          <line x1="14" y1="14" x2="14" y2="6" stroke="#30d158" strokeWidth="2" strokeLinecap="round" />
        </g>
      </svg>
    </div>
  );
}

// Botões minúsculos de mudo/solo do clipe (modo DAW). Solo isola o clipe só dentro da
// própria música (não afeta outras músicas abertas).
function ClipMuteSolo({ clip }: { clip: AudioClip }) {
  const toggleClipMute = useStore((s) => s.toggleClipMute);
  const toggleClipSolo = useStore((s) => s.toggleClipSolo);
  return (
    <div className="flex gap-0.5 shrink-0">
      <button
        className={`w-4 h-3.5 text-[8px] font-bold rounded-sm leading-none flex items-center justify-center transition-colors ${clip.mute ? 'bg-logic-lcd-amber text-black' : 'bg-black/40 text-white/70 hover:text-white'}`}
        onClick={(e) => { e.stopPropagation(); toggleClipMute(clip.id); }}
        title="Mudo deste clipe"
      >M</button>
      <button
        className={`w-4 h-3.5 text-[8px] font-bold rounded-sm leading-none flex items-center justify-center transition-colors ${clip.solo ? 'bg-logic-lcd-amber text-black' : 'bg-black/40 text-white/70 hover:text-white'}`}
        onClick={(e) => { e.stopPropagation(); toggleClipSolo(clip.id); }}
        title="Solo deste clipe (dentro da música)"
      >S</button>
    </div>
  );
}

// Alça do fade in/out: arrastar o triângulo no canto superior do clipe estende/encolhe
// o fade. O sombreado diagonal mostra visualmente até onde o fade alcança, sempre que
// existe (DAW ligado ou não); o triângulo arrastável só aparece com o DAW ligado.
function FadeHandle({ clipId, side, seconds, playLength, zoomH, editable }: {
  clipId: string; side: 'in' | 'out'; seconds: number; playLength: number; zoomH: number; editable: boolean;
}) {
  const setClipFade = useStore((s) => s.setClipFade);
  const widthPx = Math.max(0, Math.min(playLength, seconds)) * zoomH;
  return (
    <>
      {widthPx > 1 && (
        <div
          className="absolute top-0 bottom-0 pointer-events-none"
          style={{
            [side === 'in' ? 'left' : 'right']: 0,
            width: `${widthPx}px`,
            background: side === 'in'
              ? 'linear-gradient(to right, rgba(0,0,0,0.75), transparent)'
              : 'linear-gradient(to left, rgba(0,0,0,0.75), transparent)',
          }}
        />
      )}
      {editable && (
        <div
          className={`absolute top-0 w-3 h-3 cursor-pointer z-10 ${side === 'in' ? 'left-0' : 'right-0'}`}
          onPointerDown={(e) => {
            e.stopPropagation();
            e.preventDefault();
            const target = e.currentTarget;
            target.setPointerCapture(e.pointerId);
            const startX = e.clientX;
            const startSeconds = seconds;
            const move = (ev: PointerEvent) => {
              const deltaPx = side === 'in' ? ev.clientX - startX : startX - ev.clientX;
              const next = Math.max(0, Math.min(playLength, startSeconds + deltaPx / zoomH));
              setClipFade(clipId, side === 'in' ? { fadeIn: next } : { fadeOut: next });
            };
            const up = () => {
              target.removeEventListener('pointermove', move);
              target.removeEventListener('pointerup', up);
              target.removeEventListener('pointercancel', up);
              try { target.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
            };
            target.addEventListener('pointermove', move);
            target.addEventListener('pointerup', up);
            target.addEventListener('pointercancel', up);
          }}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => { e.stopPropagation(); setClipFade(clipId, side === 'in' ? { fadeIn: 0 } : { fadeOut: 0 }); }}
          title={`Fade de ${side === 'in' ? 'entrada' : 'saída'}: ${seconds.toFixed(2)}s (arraste = ajustar, duplo clique = remover)`}
        >
          <div
            className="w-0 h-0 absolute top-0"
            style={side === 'in'
              ? { left: 0, borderTop: '10px solid rgba(255,255,255,0.85)', borderRight: '10px solid transparent' }
              : { right: 0, borderTop: '10px solid rgba(255,255,255,0.85)', borderLeft: '10px solid transparent' }}
          />
        </div>
      )}
    </>
  );
}

function ClipBlock({ clip, isSelected, onSelect, onTrimStart, trim, trackHeight, zoomH, visible }: {
  clip: AudioClip; isSelected: boolean; onSelect: (additive: boolean) => void;
  onTrimStart: (e: React.PointerEvent<HTMLDivElement>, clip: AudioClip) => void;
  trim: TrimDrag; trackHeight: number; zoomH: number; visible: VisibleRange;
}) {
  const dawMode = useStore((s) => s.dawMode);
  const trimming = !!trim && trim.ids.has(clip.id);
  const trimEnd = trimming
    ? Math.max(0, Math.min(clip.duration - 0.05, (clip.trimEnd ?? 0) - trim.delta))
    : clip.trimEnd ?? 0;
  const playLength = clipPlayLength({ duration: clip.duration, trimEnd });
  const left = clip.startTime * zoomH;
  const fullWidth = Math.max(30, clip.duration * zoomH);
  const width = Math.max(8, playLength * zoomH);
  if (left > visible.end || left + fullWidth < visible.start) return null;
  const routingColor = routingColorOf(clip);
  const innerHeight = trackHeight - 4;
  const labelLeft = Math.max(0, visible.start - left);
  const labelWidth = Math.min(width, visible.end - left) - labelLeft;
  const isTrimmed = trimEnd > 0.001;
  const hasAdjustments = clip.mute || clip.solo || (clip.gain !== undefined && clip.gain !== 1) || !!clip.fadeIn || !!clip.fadeOut;
  // Controles (knob, M/S) só cabem com a faixa alta o bastante; o sombreado de fade e o
  // indicador de ajuste aparecem sempre, DAW ligado ou não, para nunca esconder um
  // ajuste que já foi feito.
  const showControls = dawMode && innerHeight >= 20;

  return (
    <>
      {isTrimmed && (
        <div
          className="absolute rounded-sm border border-dashed pointer-events-none"
          style={{ left: `${left + width}px`, top: '2px', width: `${Math.max(0, fullWidth - width)}px`, height: `${innerHeight}px`, borderColor: routingColor, opacity: trimming ? 0.35 : 0.15 }}
        />
      )}
      <div
        data-selectable="clip"
        className="group/clip absolute rounded-sm border cursor-pointer transition-shadow duration-75 overflow-hidden bg-black/30"
        style={{ left: `${left}px`, top: '2px', width: `${width}px`, height: `${innerHeight}px`, borderColor: routingColor, lineHeight: 0 }}
        onClick={(e) => { e.stopPropagation(); onSelect(e.ctrlKey || e.metaKey); }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          const openMenu = (window as unknown as { __openClipContextMenu?: (e: MouseEvent, clipId: string) => void }).__openClipContextMenu;
          openMenu?.(e.nativeEvent, clip.id);
        }}
      >
        <ClipWaveform clip={clip} left={left} width={fullWidth} height={innerHeight} visible={visible} />
        <FadeHandle
          clipId={clip.id} side="in" seconds={clip.fadeIn ?? 0} playLength={playLength} zoomH={zoomH}
          editable={showControls}
        />
        <FadeHandle
          clipId={clip.id} side="out" seconds={clip.fadeOut ?? 0} playLength={playLength} zoomH={zoomH}
          editable={showControls}
        />
        <div
          className="absolute top-0 bottom-0 flex items-start justify-start px-1.5 pt-0.5 text-xs font-medium pointer-events-none"
          style={{ left: `${labelLeft}px`, width: `${Math.max(0, labelWidth)}px`, color: routingColor, textShadow: '0 1px 2px rgba(0,0,0,0.9)' }}
        >
          <span className="truncate">{clip.name}</span>
        </div>
        {showControls && (
          <div className="absolute bottom-0.5 left-1 flex items-center gap-1 z-10">
            <ClipGainKnob clipId={clip.id} gain={clip.gain ?? 1} />
            <ClipMuteSolo clip={clip} />
          </div>
        )}
        {!showControls && hasAdjustments && (
          <div
            className="absolute bottom-0.5 left-1 w-1.5 h-1.5 rounded-full bg-logic-lcd-amber z-10"
            title="Este clipe tem ajustes do modo DAW (ganho, mudo, solo ou fade)"
          />
        )}
        {isSelected && <div className="absolute inset-0 ring-1 ring-white rounded-sm pointer-events-none" />}
        <div
          className={`absolute top-0 right-0 bottom-0 w-2 cursor-ew-resize flex items-center justify-end transition-opacity ${isSelected || trimming ? 'opacity-100' : 'opacity-0 group-hover/clip:opacity-100'}`}
          onPointerDown={(e) => onTrimStart(e, clip)}
          onClick={(e) => e.stopPropagation()}
          title="Arraste para encurtar o fim do áudio"
        >
          <div className="w-[3px] h-1/2 rounded-full bg-white/80" />
        </div>
      </div>
    </>
  );
}

function FooterProgress({ importProgress, exportProgress }: {
  importProgress: ImportProgress | null;
  exportProgress: { active: boolean; message: string } | null;
}) {
  const item = importProgress
    ? {
        message: importProgress.message,
        count: importProgress.total ? `${importProgress.current ?? 0}/${importProgress.total}` : null,
        status: importProgress.status,
        pct: importProgress.total
          ? Math.round(((importProgress.current ?? 0) / importProgress.total) * 100)
          : importProgress.status === 'done' ? 100 : null,
      }
    : exportProgress
      ? { message: exportProgress.message, count: null, status: exportProgress.active ? 'working' : 'done', pct: exportProgress.active ? null : 100 }
      : null;
  if (!item) return <div className="flex-1" />;
  const done = item.status === 'done';
  const failed = item.status === 'error';
  const tone = done ? 'bg-logic-lcd-green' : failed ? 'bg-logic-lcd-red' : 'bg-logic-accent';
  return (
    <div className="flex-1 min-w-0 flex items-center justify-center gap-2 px-4 animate-[fadeIn_120ms_ease-out]" role="status">
      <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${tone} ${!done && !failed ? 'animate-pulse' : ''}`} />
      <span className={`truncate max-w-[50%] ${failed ? 'text-logic-lcd-red' : 'text-logic-text-dim'}`}>{item.message}</span>
      {item.count && <span className="font-mono flex-shrink-0">{item.count}</span>}
      <div className="w-32 h-1 bg-logic-border-dark rounded-full overflow-hidden flex-shrink-0">
        {item.pct === null ? (
          <div className={`h-full w-1/3 rounded-full ${tone} animate-pulse`} />
        ) : (
          <div className={`h-full rounded-full transition-all duration-300 ${tone}`} style={{ width: `${item.pct}%` }} />
        )}
      </div>
    </div>
  );
}

const VIEW_MARGIN_PX = 600;

export default function TimelinePanel() {
  const tracks = useStore((s) => s.tracks);
  const songs = useStore((s) => s.songs);
  const playlist = useStore((s) => s.playlist);
  const clips = useStore((s) => s.clips);
  const selectedSongId = useStore((s) => s.selectedSongId);
  const selectedClipIds = useStore((s) => s.selectedClipIds);
  const selectClip = useStore((s) => s.selectClip);
  const selectClips = useStore((s) => s.selectClips);
  const trimClips = useStore((s) => s.trimClips);
  const snapStep = useStore((s) => s.snapStep);
  const isPlaying = useStore((s) => s.transport.isPlaying);
  const importProgress = useStore((s) => s.importProgress);
  const exportProgress = useStore((s) => s.exportProgress);
  const loadingSongIds = useStore((s) => s.loadingSongIds);
  const zoomH = useStore((s) => s.zoomH);
  const zoomV = useStore((s) => s.zoomV);
  const setZoomH = useStore((s) => s.setZoomH);
  const setZoomV = useStore((s) => s.setZoomV);
  const HEADER_W = useStore((s) => s.trackHeaderWidth);
  const setTrackHeaderWidth = useStore((s) => s.setTrackHeaderWidth);
  const setCurrentTime = useStore((s) => s.setCurrentTime);
  const addSongRegion = useStore((s) => s.addSongRegion);
  const scrollRef = useRef<HTMLDivElement>(null);
  const headerScrollRef = useRef<HTMLDivElement>(null);
  const [regionDrag, setRegionDrag] = useState<RegionDrag>(null);
  const [editingRegionId, setEditingRegionId] = useState<string | null>(null);
  const [visible, setVisible] = useState<VisibleRange>({ start: 0, end: 4000 });
  const [noSpaceHint, setNoSpaceHint] = useState(false);
  const [trimDrag, setTrimDrag] = useState<TrimDrag>(null);
  const zoomAnchorRef = useRef<{ time: number; mouseX: number } | null>(null);

  const activeSongId = selectedSongId ?? playlist[0]?.songId ?? null;
  const song = songs.find((sg) => sg.id === activeSongId);
  const grid = useMemo(() => songGrid(song), [song]);
  const isSongLoading = !!song && loadingSongIds.includes(song.id);
  const songClips = useMemo(() =>
    song ? clips.filter((c) => c.songId === song.id) : [],
    [clips, song]
  );
  const selectedSet = useMemo(() => new Set(selectedClipIds), [selectedClipIds]);

  const selectAllSongClips = useCallback(() => {
    selectClips(songClips.map((c) => c.id));
  }, [selectClips, songClips]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'a') return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
      e.preventDefault();
      selectAllSongClips();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectAllSongClips]);

  const handleTrimStart = (e: React.PointerEvent<HTMLDivElement>, clip: AudioClip) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const additive = e.ctrlKey || e.metaKey;
    let ids = selectedClipIds.filter((id) => songClips.some((c) => c.id === id));
    if (!ids.includes(clip.id)) {
      ids = additive ? [...ids, clip.id] : [clip.id];
      selectClips(ids);
    }
    const idSet = new Set(ids);
    const targets = songClips.filter((c) => idSet.has(c.id));
    // limites do arraste: nenhum áudio passa do tamanho original nem some
    const maxGrow = Math.min(...targets.map((c) => c.trimEnd ?? 0));
    const maxShrink = Math.min(...targets.map((c) => clipPlayLength(c) - 0.05));
    const origEnd = clip.startTime + clipPlayLength(clip);
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    let delta = 0;

    const describe = (end: number) => (grid ? `${formatRegionTime(end)} | ${barBeatLabel(end, grid)}` : formatRegionTime(end));
    const move = (ev: PointerEvent) => {
      const raw = origEnd + (ev.clientX - startX) / zoomH;
      const snapped = snapTime(raw, grid, ev.altKey ? 'off' : snapStep);
      delta = Math.max(-maxShrink, Math.min(maxGrow, snapped - origEnd));
      const end = origEnd + delta;
      setTrimDrag({ ids: idSet, delta, anchorId: clip.id, end, label: describe(end) });
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      try { el.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      setTrimDrag(null);
      if (Math.abs(delta) < 1e-4) return;
      trimClips(targets.map((c) => ({ id: c.id, trimEnd: (c.trimEnd ?? 0) - delta })));
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  useEffect(() => {
    setEditingRegionId(null);
    setRegionDrag(null);
  }, [activeSongId]);

  useEffect(() => {
    if (!noSpaceHint) return;
    const t = window.setTimeout(() => setNoSpaceHint(false), 2200);
    return () => window.clearTimeout(t);
  }, [noSpaceHint]);

  const handleCutMedleyAtCursor = () => {
    if (!song) return;
    const st = useStore.getState();
    const cursor = st.transport.isPlaying && st.transport.currentSongId === song.id
      ? audioEngine.getCurrentTime()
      : st.transport.currentTime;
    if (!cutMedleyAt(song, cursor)) setNoSpaceHint(true);
  };

  const handleAddRegionAtCursor = () => {
    if (!song) return;
    const st = useStore.getState();
    const cursor = st.transport.isPlaying && st.transport.currentSongId === song.id
      ? audioEngine.getCurrentTime()
      : st.transport.currentTime;
    const slot = freeSlotAt(song, snapTime(cursor, grid, snapStep));
    const id = `region-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
    const style = suggestRegionStyle(song.regions ?? []);
    if (slot && addSongRegion(song.id, { id, ...style, start: slot.start, end: slot.end, loop: false })) {
      setEditingRegionId(id);
    } else {
      setNoSpaceHint(true);
    }
  };

  const allVisibleTracks = useMemo(() => {
    const result: Track[] = [];
    const tc = tracks.find((t) => t.id === TIMECODE_TRACK_ID);
    if (tc) result.push(tc);
    for (const id of ROUTABLE_TRACKS) {
      const track = tracks.find((t) => t.id === id);
      if (!track) continue;
      result.push(track);
      if (track.isSubgroup) {
        for (const childId of track.children) {
          const child = tracks.find((t) => t.id === childId);
          if (child) result.push(child);
        }
      }
    }
    return result;
  }, [tracks]);

  const trackHeight = Math.round(40 * zoomV);
  const contentEnd = useMemo(() => {
    let end = song?.duration ?? 0;
    for (const c of songClips) end = Math.max(end, c.startTime + c.duration);
    for (const r of song?.regions ?? []) end = Math.max(end, r.end);
    return end;
  }, [song, songClips]);
  const timelineWidth = Math.max(800, Math.ceil((contentEnd + 10) * zoomH));

  const rulerStep = useMemo(() => {
    const candidates = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
    return candidates.find((step) => step * zoomH >= 60) ?? 600;
  }, [zoomH]);
  const stepPx = rulerStep * zoomH;

  const visibleTicks = useMemo(() => {
    const first = Math.max(0, Math.floor(visible.start / stepPx));
    const last = Math.min(Math.ceil(timelineWidth / stepPx), Math.ceil(visible.end / stepPx));
    const out: number[] = [];
    for (let i = first; i <= last; i++) out.push(i * rulerStep);
    return out;
  }, [visible, stepPx, rulerStep, timelineWidth]);

  const formatTick = (sec: number): string => {
    if (rulerStep < 1) {
      const whole = Math.floor(sec);
      const frac = Math.round((sec - whole) * 10);
      return `${Math.floor(whole / 60)}:${(whole % 60).toString().padStart(2, '0')}.${frac}`;
    }
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  // Quantizado para só re-renderizar quando a janela visível muda de bloco.
  const updateVisible = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const quantum = 256;
    const start = Math.max(0, Math.floor((el.scrollLeft - VIEW_MARGIN_PX) / quantum) * quantum);
    const end = Math.ceil((el.scrollLeft + el.clientWidth - HEADER_W + VIEW_MARGIN_PX) / quantum) * quantum;
    setVisible((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
  }, []);

  const handleScroll = useCallback(() => {
    if (scrollRef.current && headerScrollRef.current) {
      headerScrollRef.current.scrollLeft = scrollRef.current.scrollLeft;
    }
    updateVisible();
  }, [updateVisible]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(updateVisible);
    ro.observe(el);
    return () => ro.disconnect();
  }, [updateVisible]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    const anchor = zoomAnchorRef.current;
    if (el && anchor) {
      el.scrollLeft = Math.max(0, anchor.time * zoomH - anchor.mouseX);
      zoomAnchorRef.current = null;
    }
    if (el && headerScrollRef.current) headerScrollRef.current.scrollLeft = el.scrollLeft;
    updateVisible();
  }, [zoomH, timelineWidth, updateVisible]);

  const zoomAround = useCallback((factor: number, mouseX: number) => {
    const el = scrollRef.current;
    const current = useStore.getState().zoomH;
    if (el) zoomAnchorRef.current = { time: (el.scrollLeft + mouseX) / current, mouseX };
    setZoomH(Math.round(current * factor * 100) / 100);
  }, [setZoomH]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const mouseX = Math.max(0, e.clientX - rect.left - HEADER_W);
      const factor = Math.exp(-Math.max(-60, Math.min(60, e.deltaY)) * 0.01);
      zoomAround(factor, mouseX);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAround]);

  const zoomButton = (factor: number) => {
    const el = scrollRef.current;
    const st = useStore.getState();
    const playheadX = st.transport.currentTime * st.zoomH - (el?.scrollLeft ?? 0);
    const viewW = el ? el.clientWidth - HEADER_W : 0;
    zoomAround(factor, playheadX >= 0 && playheadX <= viewW ? playheadX : viewW / 2);
  };

  // Alça na borda direita do painel de faixas: arrastar para os lados ajusta a largura
  // dessa coluna (nomes + botões M/S) de todas as faixas de uma vez. Duplo clique volta
  // ao tamanho padrão.
  const handleHeaderWidthPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startWidth = useStore.getState().trackHeaderWidth;
    const move = (ev: PointerEvent) => {
      useStore.getState().setTrackHeaderWidth(startWidth + (ev.clientX - startX));
    };
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
      try { target.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  }, []);
  const resetHeaderWidth = useCallback(() => setTrackHeaderWidth(192), [setTrackHeaderWidth]);

  const handleRulerPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    const rect = target.getBoundingClientRect();
    const computeTime = (clientX: number, free = false) =>
      snapTime(Math.max(0, (clientX - rect.left) / zoomH), grid, free ? 'off' : snapStep);
    const startTime = computeTime(e.clientX, e.altKey);
    audioEngine.beginUserSeek(startTime);
    setCurrentTime(startTime);

    const move = (ev: PointerEvent) => {
      const t = computeTime(ev.clientX, ev.altKey);
      audioEngine.beginUserSeek(t);
      setCurrentTime(t);
    };
    const up = (ev: PointerEvent) => {
      target.releasePointerCapture(e.pointerId);
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
      const finalT = computeTime(ev.clientX, ev.altKey);
      setCurrentTime(finalT);
      if (isPlaying && song) {
        audioEngine.seekTo(finalT);
      } else {
        audioEngine.endUserSeek();
      }
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  }, [zoomH, setCurrentTime, isPlaying, song, grid, snapStep]);

  const gridStyle = grid ? {} : {
    backgroundImage: `repeating-linear-gradient(to right, transparent 0, transparent ${stepPx - 1}px, rgba(255,255,255,0.045) ${stepPx - 1}px, rgba(255,255,255,0.045) ${stepPx}px)`,
  };

  return (
    <div className="flex flex-col h-full bg-logic-bg flex-1 min-w-0 relative">
      <div className="flex bg-logic-bg-deep border-b border-logic-border-dark">
        <div className="flex flex-col border-r border-logic-border-dark shrink-0" style={{ width: `${HEADER_W}px` }}>
          <div className="h-6 flex items-center justify-between px-3 border-b border-logic-border-dark/60">
            <span className="text-2xs uppercase tracking-wider text-logic-text-muted truncate">Medley</span>
            <button
              className="flex items-center justify-center gap-1 w-16 h-[18px] rounded text-2xs font-medium text-logic-text-dim bg-logic-bg-elevated border border-logic-border-light hover:text-logic-text hover:border-logic-accent transition-colors disabled:opacity-40 disabled:pointer-events-none"
              onClick={handleCutMedleyAtCursor}
              disabled={!song}
              title="Fatiar o medley no cursor: separa uma música da outra"
            >
              <Scissors size={10} />
              Fatiar
            </button>
          </div>
          <div className="h-6 flex items-center justify-between px-3 border-b border-logic-border-dark/60">
            <span className="text-2xs uppercase tracking-wider text-logic-text-muted truncate">
              {noSpaceHint ? <span className="text-logic-lcd-amber normal-case tracking-normal">Sem espaço livre aqui</span> : 'Regiões'}
            </span>
            <button
              className="flex items-center justify-center gap-1 w-16 h-[18px] rounded text-2xs font-medium text-logic-text-dim bg-logic-bg-elevated border border-logic-border-light hover:text-logic-text hover:border-logic-accent transition-colors disabled:opacity-40 disabled:pointer-events-none"
              onClick={handleAddRegionAtCursor}
              disabled={!song}
              title="Nova região de 4 compassos a partir do cursor"
            >
              <Plus size={10} />
              Nova
            </button>
          </div>
          <div className="h-10 flex items-center justify-between px-3">
            <div className="flex items-center gap-1">
              <button className="text-logic-text-muted hover:text-logic-text disabled:opacity-30" disabled={zoomV <= 0.5} onClick={() => setZoomV(Math.max(0.5, Math.round(zoomV * 0.8 * 100) / 100))} title="Diminuir altura das tracks"><FoldVertical size={13} /></button>
              <button className="text-logic-text-muted hover:text-logic-text disabled:opacity-30" disabled={zoomV >= 3} onClick={() => setZoomV(Math.min(3, Math.round(zoomV * 1.25 * 100) / 100))} title="Aumentar altura das tracks"><UnfoldVertical size={13} /></button>
            </div>
            <div className="flex items-center gap-1">
              <button className="text-logic-text-muted hover:text-logic-text" onClick={() => zoomButton(1.25)} title="Aproximar (Cmd + roda do mouse)"><ZoomIn size={13} /></button>
              <button className="text-logic-text-muted hover:text-logic-text" onClick={() => zoomButton(0.8)} title="Afastar (Cmd + roda do mouse)"><ZoomOut size={13} /></button>
            </div>
          </div>
        </div>
        <div ref={headerScrollRef} className="flex-1 overflow-hidden">
          <div style={{ width: `${timelineWidth + 24}px` }}>
            {song ? (
              <MedleyLane song={song} zoomH={zoomH} />
            ) : (
              <div className="h-6 border-b border-logic-border-dark/60" />
            )}
            {song ? (
              <RegionLane
                song={song}
                zoomH={zoomH}
                drag={regionDrag}
                onDragChange={setRegionDrag}
                editingId={editingRegionId}
                onEdit={setEditingRegionId}
              />
            ) : (
              <div className="h-6 border-b border-logic-border-dark/60" />
            )}
            <div
              className="relative h-10 cursor-pointer select-none"
              style={{ width: `${timelineWidth}px` }}
              onPointerDown={handleRulerPointerDown}
            >
              {grid && song && <BarRulerLayer song={song} grid={grid} zoomH={zoomH} visible={visible} />}
              {visibleTicks.map((tick) => (
                <div
                  key={tick}
                  className={`absolute bottom-0 border-l border-logic-border-dark/60 flex items-end pb-0.5 pointer-events-none ${grid ? 'top-5' : 'top-0'}`}
                  style={{ left: `${tick * zoomH}px` }}
                >
                  <span className="text-2xs text-logic-text-muted font-mono pl-1 whitespace-nowrap">{formatTick(tick)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="flex-1 overflow-auto logic-scroll relative"
        onScroll={handleScroll}
      >
        {!song ? (
          <div className="flex items-center justify-center h-full text-logic-text-muted text-xs">
            Importe um VS ou selecione uma música para ver a timeline
          </div>
        ) : (
          <div className="flex" style={{ minHeight: '100%', width: `${timelineWidth + HEADER_W}px` }}>
            <div className="relative bg-logic-bg-panel border-r border-logic-border-dark sticky left-0 z-40 shrink-0" style={{ width: `${HEADER_W}px` }}>
              <TimecodeTrackRow songId={song.id} />
              {ROUTABLE_TRACKS.map((id) => {
                const track = tracks.find((t) => t.id === id);
                if (!track) return null;
                if (track.isSubgroup) return <FolderGroup key={track.id} track={track} />;
                return <TrackRow key={track.id} track={track} depth={0} />;
              })}
              <div
                className="absolute top-0 right-0 bottom-0 w-1.5 -mr-0.5 z-50 cursor-col-resize group/widthHandle"
                onPointerDown={handleHeaderWidthPointerDown}
                onDoubleClick={resetHeaderWidth}
                title="Arraste para os lados para ajustar a largura do painel de faixas. Duplo clique: tamanho padrão."
              >
                <div className="absolute top-0 right-0 bottom-0 w-px bg-logic-border-dark opacity-0 group-hover/widthHandle:opacity-100 group-hover/widthHandle:bg-logic-accent transition-opacity" />
              </div>
            </div>

            <div className="relative flex-shrink-0" style={{ width: `${timelineWidth}px`, ...gridStyle }}>
              {grid && <GridLinesOverlay grid={grid} zoomH={zoomH} visible={visible} />}
              {allVisibleTracks.map((track) => {
                const isFolder = track.isSubgroup;
                const isTc = track.id === TIMECODE_TRACK_ID;
                const trackClips = isFolder ? [] : songClips.filter((c) => c.trackId === track.id);
                const rowHeight = isTc ? trackHeight : Math.round((track.height ?? 40) * zoomV);
                return (
                  <div
                    key={track.id}
                    className={`relative overflow-hidden ${isTc ? 'border-b-2 border-logic-lcd-amber/40 bg-logic-lcd-amber/[0.04]' : 'border-b border-logic-border-dark'} ${isFolder ? 'bg-logic-bg-deep/40 pointer-events-none' : ''}`}
                    style={{ height: `${rowHeight}px` }}
                  >
                    {trackClips.map((clip) => (
                      <ClipBlock
                        key={clip.id}
                        clip={clip}
                        isSelected={selectedSet.has(clip.id)}
                        onSelect={(additive) => selectClip(clip.id, additive)}
                        onTrimStart={handleTrimStart}
                        trim={trimDrag}
                        trackHeight={rowHeight}
                        zoomH={zoomH}
                        visible={visible}
                      />
                    ))}
                  </div>
                );
              })}

              <RegionGuides song={song} zoomH={zoomH} drag={regionDrag} />

              {trimDrag && (
                <div className="absolute top-0 bottom-0 z-30 pointer-events-none" style={{ left: `${trimDrag.end * zoomH}px` }}>
                  <div className="absolute top-0 bottom-0 w-px bg-logic-lcd-amber/80" />
                  <span className="absolute top-1 left-1.5 px-1.5 py-0.5 rounded bg-logic-bg-elevated border border-logic-lcd-amber/60 text-2xs font-mono text-logic-text whitespace-nowrap shadow-lg">
                    Fim {trimDrag.label}{trimDrag.ids.size > 1 ? ` (${trimDrag.ids.size} áudios)` : ''}
                  </span>
                </div>
              )}

              <Playhead zoomH={zoomH} songId={song.id} />
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 px-3 h-7 bg-logic-bg-deep border-t border-logic-border-dark text-2xs text-logic-text-muted">
        <GridToolbar song={song} onSelectAll={selectAllSongClips} />
        <FooterProgress importProgress={importProgress} exportProgress={exportProgress} />
        <span className="flex-shrink-0 hidden sm:inline">
          {selectedClipIds.length > 0 ? `${selectedClipIds.length} selecionado${selectedClipIds.length > 1 ? 's' : ''} | ` : ''}
          {songClips.length} clips | Zoom {Math.round(zoomH)}px/s
        </span>
      </div>

      {isSongLoading && (
        <div className="absolute bottom-10 left-1/2 -translate-x-1/2 z-50 pointer-events-none">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-logic-bg-panel/95 backdrop-blur-sm border border-logic-border-light shadow-lg text-2xs text-logic-text-dim animate-[fadeIn_120ms_ease-out]">
            <Loader2 size={12} className="animate-spin text-logic-accent" />
            Carregando música...
          </div>
        </div>
      )}

    </div>
  );
}
