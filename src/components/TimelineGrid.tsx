import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Magnet, RefreshCw, Loader2, CheckCheck, Scissors } from 'lucide-react';
import { useStore } from '@/store';
import type { Song } from '@/types';
import { barBeatLabel, gridLines, moveTempoChange, SNAP_LABELS, snapTempoChange, tempoChangeIndex, type SnapStep, type SongGrid } from '@/lib/grid';
import { remeasureSongBpm, setSongBpm } from '@/lib/importManager';
import { trimAllSongEnds, trimSongEnd } from '@/lib/songEndTools';
import type { VisibleRange } from '@/components/ClipWaveform';

const LINE_COLORS = {
  bar: 'rgba(255,255,255,0.22)',
  beat: 'rgba(255,255,255,0.11)',
  sub: 'rgba(255,255,255,0.05)',
};

export function GridLinesOverlay({ grid, zoomH, visible }: { grid: SongGrid; zoomH: number; visible: VisibleRange }) {
  const lines = gridLines(grid, visible.start / zoomH, visible.end / zoomH, zoomH);
  return (
    <div className="absolute inset-0 pointer-events-none z-20">
      {lines.map((l) => (
        <div
          key={l.time}
          className="absolute top-0 bottom-0 w-px pointer-events-none"
          style={{ left: `${l.time * zoomH}px`, backgroundColor: LINE_COLORS[l.kind] }}
        />
      ))}
    </div>
  );
}

export function BarRulerLayer({ song, grid, zoomH, visible, onEditTempo, onTempoDrag }: {
  song: Song;
  grid: SongGrid;
  zoomH: number;
  visible: VisibleRange;
  /** Duplo clique numa placa de BPM (ou "Editar BPM" no menu): editar a mudança de andamento daquele ponto. */
  onEditTempo?: (point: { time: number; bpm: number; x: number; y: number }) => void;
  /** Enquanto a placa é arrastada: de onde saiu e onde está (null ao soltar), para a grade acompanhar. */
  onTempoDrag?: (drag: { from: number; to: number } | null) => void;
}) {
  const moveTempoAt = useStore((s) => s.moveTempoAt);
  const snapStep = useStore((s) => s.snapStep);
  const [menu, setMenu] = useState<{ x: number; y: number; time: number; bpm: number } | null>(null);
  const lines = gridLines(grid, visible.start / zoomH, visible.end / zoomH, zoomH);

  // Arrastar a placa leva a mudança de andamento junto, grudando no início dos compassos do trecho
  // de antes (Alt solta). Só grava ao soltar, então o Desfazer volta tudo de uma vez.
  const startTempoDrag = (e: React.PointerEvent, time: number) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const segs = grid.tempoSegments;
    const index = tempoChangeIndex(segs, time);
    if (!segs || index < 1) return;
    const startX = e.clientX;
    let moved = false;
    let to = time;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      if (!moved && Math.abs(dx) < 3) return;
      moved = true;
      const raw = time + dx / zoomH;
      const snapped = ev.altKey ? raw : snapTempoChange(segs, index, raw, grid.beatsPerBar, 'bar');
      to = moveTempoChange(segs, index, snapped)[index].startTime;
      onTempoDrag?.({ from: time, to });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      document.body.style.cursor = '';
      onTempoDrag?.(null);
      if (moved && Math.abs(to - time) > 1e-4) moveTempoAt(song.id, time, to);
    };
    // na janela: a placa é redesenhada no lugar novo enquanto arrasta
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    document.body.style.cursor = 'grabbing';
  };
  const beatPx = grid.beat * zoomH;
  const barPx = grid.beat * grid.beatsPerBar * zoomH;
  // Com pouco espaço por compasso, mostra o número só a cada N compassos (potência de 2) para
  // nunca sobrepor os algarismos — a linha vertical continua sendo desenhada em todo compasso.
  const barLabelStride = Math.max(1, 2 ** Math.ceil(Math.log2(32 / Math.max(barPx, 1e-3))));

  // Anti-colisão: garante que duas placas de BPM nunca se sobreponham visualmente na régua
  let lastBadgePx = -9999;
  const MIN_BADGE_DIST_PX = 130;

  return (
    <>
      {lines.map((l) => {
        const showLabel = l.kind === 'bar'
          ? (barLabelStride <= 1 || (l.bar - 1) % barLabelStride === 0)
          : l.kind === 'beat' && beatPx >= 40; // meio tempo: só o traço, senão repete o número do tempo

        const linePx = l.time * zoomH;
        let showBpmBadge = false;
        if (l.bpmChange && (linePx - lastBadgePx >= MIN_BADGE_DIST_PX)) {
          showBpmBadge = true;
          lastBadgePx = linePx;
        }

        return (
          <div
            key={l.time}
            className={`absolute top-0 border-l pointer-events-none ${l.kind === 'bar' ? 'h-5 border-logic-text-muted/60' : 'h-2.5 border-logic-border-light/60'}`}
            style={{ left: `${linePx}px` }}
          >
            {showLabel && (
              <span className={`absolute top-0 left-1 text-2xs font-mono whitespace-nowrap leading-none pt-0.5 select-none ${l.kind === 'bar' ? 'text-logic-text-dim font-medium' : 'text-logic-text-muted/70'}`}>
                {barBeatLabel(l.time, grid)}
              </span>
            )}
            {showBpmBadge && (
              <div
                className={`absolute top-0 left-6 z-30 flex items-center gap-1 px-1.5 py-0.5 rounded bg-logic-bg-panel/90 border border-amber-500/80 text-[9px] font-mono font-bold text-amber-300 shadow-md backdrop-blur-sm whitespace-nowrap select-none ${onEditTempo ? 'pointer-events-auto cursor-grab active:cursor-grabbing hover:border-amber-300 hover:text-amber-200' : 'pointer-events-none'}`}
                title={`Mudança de andamento: ${l.bpmChange} BPM. Arraste para mover (Alt: sem imã). Botão direito: editar, ajustar no beat ou excluir.`}
                // a placa não move o cursor nem abre o menu da régua
                onPointerDown={(e) => startTempoDrag(e, l.time)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setMenu({ x: e.clientX, y: e.clientY, time: l.time, bpm: l.bpmChange! });
                }}
                onDoubleClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onEditTempo?.({ time: l.time, bpm: l.bpmChange!, x: e.clientX, y: e.clientY });
                }}
              >
                <span>⚡ {l.bpmChange} BPM</span>
              </div>
            )}
          </div>
        );
      })}
      {menu && (
        <TempoChangeMenu
          song={song}
          grid={grid}
          {...menu}
          onEdit={() => onEditTempo?.({ time: menu.time, bpm: menu.bpm, x: menu.x, y: menu.y })}
          onClose={() => setMenu(null)}
        />
      )}
    </>
  );
}

/** Menu do botão direito na placa amarela de mudança de andamento. */
function TempoChangeMenu({ song, grid, x, y, time, onEdit, onClose }: {
  song: Song;
  grid: SongGrid;
  x: number;
  y: number;
  time: number;
  onEdit: () => void;
  onClose: () => void;
}) {
  const moveTempoAt = useStore((s) => s.moveTempoAt);
  const removeTempoAt = useStore((s) => s.removeTempoAt);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [onClose]);

  const segs = grid.tempoSegments ?? [];
  const index = tempoChangeIndex(segs, time);
  const onBeat = index > 0 ? moveTempoChange(segs, index, snapTempoChange(segs, index, time, grid.beatsPerBar, 'bar'))[index].startTime : time;
  const offMs = Math.round((onBeat - time) * 1000);

  const item = 'w-full flex items-center justify-between gap-3 px-3 py-1.5 text-left hover:bg-logic-accent hover:text-white transition-colors duration-75 disabled:opacity-40 disabled:pointer-events-none';
  return createPortal(
    <div
      ref={ref}
      className="fixed z-[300] min-w-52 py-1 bg-logic-bg-panel border border-logic-border-light shadow-2xl rounded text-xs text-logic-text"
      style={{ left: Math.min(x, window.innerWidth - 230), top: Math.min(y, window.innerHeight - 120) }}
      onContextMenu={(e) => e.preventDefault()}
      // o menu fica fora da régua na tela, mas os eventos do React sobem até ela: sem isto o
      // clique num item viraria "mover o cursor" na régua
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <button className={item} onClick={() => { onClose(); onEdit(); }}>
        <span>Editar BPM…</span>
      </button>
      <button
        className={item}
        disabled={index < 1 || offMs === 0}
        onClick={() => { onClose(); moveTempoAt(song.id, time, onBeat); }}
        title="Leva a mudança de andamento para o início do compasso mais perto, na grade de antes dela"
      >
        <span>Ajustar no compasso da grade</span>
        <span className="text-[10px] opacity-60 font-mono">{offMs === 0 ? 'já está' : `${offMs > 0 ? '+' : ''}${offMs} ms`}</span>
      </button>
      <div className="h-px bg-logic-border-dark my-1" />
      <button className={`${item} text-logic-lcd-red`} onClick={() => { onClose(); removeTempoAt(song.id, time); }}>
        <span>Excluir mudança</span>
      </button>
    </div>,
    document.body,
  );
}

/** "1:12" ou "8 s": quanto saiu do fim. */
function cutText(seconds: number): string {
  const s = Math.round(seconds);
  return s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : `${s} s`;
}

/** Menu do botão "Ajustar fim": esta música ou todas. */
function SongEndMenu({ x, y, hasSong, onPick, onClose }: {
  x: number;
  y: number;
  hasSong: boolean;
  onPick: (scope: 'song' | 'all') => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [onClose]);
  const item = 'w-full flex items-center px-3 py-1.5 text-left hover:bg-logic-accent hover:text-white transition-colors duration-75 disabled:opacity-40 disabled:pointer-events-none';
  return createPortal(
    <div
      ref={ref}
      className="fixed z-[300] min-w-56 py-1 bg-logic-bg-panel border border-logic-border-light shadow-2xl rounded text-xs text-logic-text"
      style={{ left: Math.min(x, window.innerWidth - 240), top: Math.max(8, Math.min(y, window.innerHeight - 80)) }}
      onContextMenu={(e) => e.preventDefault()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <button
        className={item}
        disabled={!hasSong}
        onClick={() => { onClose(); onPick('song'); }}
        title="Corta o silêncio do final desta música: termina 0,5 s depois do último som de harmonia (Cmd+Z desfaz)"
      >
        Ajustar fim desta música
      </button>
      <button
        className={item}
        onClick={() => { onClose(); onPick('all'); }}
        title="Faz o mesmo em todas as músicas do show (Cmd+Z desfaz tudo de uma vez)"
      >
        Ajustar fim de todas as músicas
      </button>
    </div>,
    document.body,
  );
}

const METERS: Array<{ value: 3 | 4 | 6; label: string }> = [
  { value: 4, label: '4/4' },
  { value: 3, label: '3/4' },
  { value: 6, label: '6/8' },
];

// seletores embutidos no painel, como as janelinhas de valor de uma mesa
const selectCls = 'console-well h-[20px] !rounded-[3px] border border-black text-2xs text-logic-text px-1 hover:border-logic-accent focus:outline-none focus:border-logic-accent transition-colors';

export function GridToolbar({ song, onSelectAll }: { song: Song | undefined; onSelectAll: () => void }) {
  const snapStep = useStore((s) => s.snapStep);
  const setSnapStep = useStore((s) => s.setSnapStep);
  const updateSong = useStore((s) => s.updateSong);
  const [lastStep, setLastStep] = useState<Exclude<SnapStep, 'off'>>('beat');
  const [measuring, setMeasuring] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [bpmDraft, setBpmDraft] = useState<string | null>(null);
  const [endMenu, setEndMenu] = useState<{ x: number; y: number } | null>(null);
  const [trimming, setTrimming] = useState(false);

  const commitBpm = () => {
    const value = Number((bpmDraft ?? '').replace(',', '.'));
    if (song && Number.isFinite(value) && value >= 30 && value <= 300) {
      setSongBpm(song.id, Math.round(value * 100) / 100, 'manual');
    }
    setBpmDraft(null);
  };
  const snapOn = snapStep !== 'off';

  const toggleSnap = () => {
    if (snapOn) {
      setLastStep(snapStep as Exclude<SnapStep, 'off'>);
      setSnapStep('off');
    } else {
      setSnapStep(lastStep);
    }
  };

  const remeasure = async () => {
    if (!song || measuring) return;
    setMeasuring(true);
    setNote(null);
    const result = await remeasureSongBpm(song.id);
    setMeasuring(false);
    setNote(result === 'ok' ? null : result === 'no-source' ? 'Esta música não tem áudios' : 'BPM não encontrado — clique no BPM para digitar');
    if (result !== 'ok') window.setTimeout(() => setNote(null), 4000);
  };

  // Ajustar fim: corta o silêncio do final (desta música ou de todas)
  const trimEnd = async (scope: 'song' | 'all') => {
    if (trimming) return;
    setTrimming(true);
    setNote(scope === 'all' ? 'Ajustando o fim das músicas...' : 'Ajustando o fim...');
    try {
      if (scope === 'song') {
        if (!song) return;
        const cut = await trimSongEnd(song.id);
        setNote(cut > 0 ? `Fim ajustado: ${cutText(cut)} de silêncio cortado` : 'O fim já estava certo');
      } else {
        const r = await trimAllSongEnds((done, total) => setNote(`Ajustando o fim das músicas... ${done + 1}/${total}`));
        setNote(r.changed
          ? `${r.changed} ${r.changed === 1 ? 'música ajustada' : 'músicas ajustadas'} (${cutText(r.cut)} cortados)${r.unchanged ? `, ${r.unchanged} já ${r.unchanged === 1 ? 'estava certa' : 'estavam certas'}` : ''}`
          : 'O fim de todas as músicas já estava certo');
      }
    } catch (err) {
      setNote(`Não deu para ajustar o fim: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setTrimming(false);
      window.setTimeout(() => setNote(null), 5000);
    }
  };

  const bpmText = song?.bpmDetected && song.bpm
    ? `${Math.round(song.bpm * 10) / 10} BPM`
    : song?.bpmMissing ? 'BPM não encontrado' : 'BPM ?';

  return (
    <div className="flex items-center gap-1.5 flex-shrink-0">
      <button
        className={`console-key flex items-center justify-center w-[24px] h-[20px] ${snapOn ? 'is-lit-blue' : ''}`}
        onClick={toggleSnap}
        title={snapOn ? 'Imã na grade ligado (segure Alt para mover livre)' : 'Imã na grade desligado'}
        aria-pressed={snapOn}
      >
        <Magnet size={11} />
      </button>
      <select
        className={selectCls}
        value={snapStep}
        onChange={(e) => setSnapStep(e.target.value as SnapStep)}
        title="Passo da grade"
      >
        {(Object.keys(SNAP_LABELS) as SnapStep[]).map((k) => <option key={k} value={k}>{SNAP_LABELS[k]}</option>)}
      </select>
      <select
        className={selectCls}
        value={song?.beatsPerBar ?? 4}
        disabled={!song}
        onChange={(e) => {
          if (song) updateSong(song.id, { beatsPerBar: Number(e.target.value) as 3 | 4 | 6 });
          e.currentTarget.blur();
        }}
        title="Fórmula de compasso desta música"
      >
        {METERS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
      </select>
      {bpmDraft !== null ? (
        <input
          autoFocus
          inputMode="decimal"
          className="w-[72px] px-1.5 h-[18px] rounded bg-logic-bg-deep border border-logic-accent font-mono text-logic-text focus:outline-none"
          value={bpmDraft}
          placeholder="BPM"
          onChange={(e) => setBpmDraft(e.target.value.replace(/[^\d.,]/g, '').slice(0, 6))}
          onBlur={commitBpm}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              commitBpm();
              e.currentTarget.blur();
            }
            if (e.key === 'Escape') {
              setBpmDraft(null);
              e.currentTarget.blur();
            }
            e.stopPropagation();
          }}
        />
      ) : (
        <button
          className={`console-display hidden md:flex items-center gap-1 px-1.5 h-[20px] font-stage font-semibold text-[12px] transition-colors hover:border-logic-accent disabled:pointer-events-none
            ${song?.bpmMissing && !song.bpmDetected ? '!border-logic-lcd-amber/60 text-logic-lcd-amber' : 'text-logic-lcd-amber console-glow'}`}
          onClick={(e) => {
            if (song) setBpmDraft(song.bpmDetected && song.bpm ? String(Math.round(song.bpm * 100) / 100) : '');
            e.currentTarget.blur();
          }}
          disabled={!song}
          title="Clique para digitar o BPM desta música"
        >
          {bpmText}
          {song?.bpmSource === 'click' && <span className="text-logic-lcd-green">click</span>}
          {song?.bpmSource === 'manual' && song.bpmDetected && <span className="text-logic-accent">manual</span>}
        </button>
      )}
      <button
        className="console-key flex items-center gap-1 px-2 h-[20px] text-[12px] disabled:pointer-events-none"
        onClick={remeasure}
        disabled={!song || measuring}
        title="Ler o BPM de novo pelo click (ou bateria)"
      >
        {measuring ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />}
        <span className="hidden lg:inline">Medir BPM de novo</span>
      </button>
      <button
        className="console-key flex items-center gap-1 px-2 h-[20px] text-[12px] disabled:pointer-events-none"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setEndMenu({ x: r.left, y: r.bottom + 4 });
        }}
        disabled={trimming}
        title="Corta o silêncio do final do VS, 0,5 s depois do último som de harmonia"
      >
        {trimming ? <Loader2 size={10} className="animate-spin" /> : <Scissors size={10} />}
        <span className="hidden lg:inline">Ajustar fim</span>
      </button>
      {endMenu && (
        <SongEndMenu x={endMenu.x} y={endMenu.y} hasSong={!!song} onPick={(scope) => void trimEnd(scope)} onClose={() => setEndMenu(null)} />
      )}
      <button
        className="console-key flex items-center gap-1 px-2 h-[20px] text-[12px] disabled:pointer-events-none"
        onClick={onSelectAll}
        disabled={!song}
        title="Selecionar todos os áudios da música (Ctrl/Cmd + A)"
      >
        <CheckCheck size={10} />
        <span className="hidden lg:inline">Selecionar todos</span>
      </button>

      {note && <span className="text-logic-lcd-amber animate-[fadeIn_120ms_ease-out]">{note}</span>}
    </div>
  );
}
