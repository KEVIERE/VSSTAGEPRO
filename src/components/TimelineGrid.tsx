import { useState } from 'react';
import { Magnet, RefreshCw, Loader2, CheckCheck } from 'lucide-react';
import { useStore } from '@/store';
import type { Song } from '@/types';
import { barBeatLabel, gridLines, SNAP_LABELS, type SnapStep, type SongGrid } from '@/lib/grid';
import { remeasureSongBpm, setSongBpm } from '@/lib/importManager';
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

export function BarRulerLayer({ song, grid, zoomH, visible, onEditTempo }: {
  song: Song;
  grid: SongGrid;
  zoomH: number;
  visible: VisibleRange;
  /** Duplo clique numa placa de BPM: editar ou excluir a mudança de andamento daquele ponto. */
  onEditTempo?: (point: { time: number; bpm: number; x: number; y: number }) => void;
}) {
  const lines = gridLines(grid, visible.start / zoomH, visible.end / zoomH, zoomH);
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
          : beatPx >= 40;

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
                className={`absolute top-0 left-6 z-30 flex items-center gap-1 px-1.5 py-0.5 rounded bg-logic-bg-panel/90 border border-amber-500/80 text-[9px] font-mono font-bold text-amber-300 shadow-md backdrop-blur-sm whitespace-nowrap select-none ${onEditTempo ? 'pointer-events-auto cursor-pointer hover:border-amber-300 hover:text-amber-200' : 'pointer-events-none'}`}
                title={`Mudança de andamento: ${l.bpmChange} BPM. Duplo clique para editar ou excluir.`}
                // a placa não move o cursor nem abre o menu da régua
                onPointerDown={(e) => e.stopPropagation()}
                onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
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
    </>
  );
}

const METERS: Array<{ value: 3 | 4 | 6; label: string }> = [
  { value: 4, label: '4/4' },
  { value: 3, label: '3/4' },
  { value: 6, label: '6/8' },
];

const selectCls = 'h-[18px] rounded bg-logic-bg-elevated border border-logic-border-light text-2xs text-logic-text-dim px-1 hover:border-logic-accent focus:outline-none focus:border-logic-accent transition-colors';

export function GridToolbar({ song, onSelectAll }: { song: Song | undefined; onSelectAll: () => void }) {
  const snapStep = useStore((s) => s.snapStep);
  const setSnapStep = useStore((s) => s.setSnapStep);
  const updateSong = useStore((s) => s.updateSong);
  const [lastStep, setLastStep] = useState<Exclude<SnapStep, 'off'>>('beat');
  const [measuring, setMeasuring] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [bpmDraft, setBpmDraft] = useState<string | null>(null);

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

  const bpmText = song?.bpmDetected && song.bpm
    ? `${Math.round(song.bpm * 10) / 10} BPM`
    : song?.bpmMissing ? 'BPM não encontrado' : 'BPM ?';

  return (
    <div className="flex items-center gap-1.5 flex-shrink-0">
      <button
        className={`flex items-center justify-center w-[22px] h-[18px] rounded border transition-colors ${snapOn ? 'bg-logic-accent/20 border-logic-accent text-logic-accent' : 'bg-logic-bg-elevated border-logic-border-light text-logic-text-muted hover:text-logic-text'}`}
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
          className={`hidden md:flex items-center gap-1 px-1.5 h-[18px] rounded bg-logic-bg-deep border font-mono transition-colors hover:border-logic-accent disabled:pointer-events-none
            ${song?.bpmMissing && !song.bpmDetected ? 'border-logic-lcd-amber/60 text-logic-lcd-amber' : 'border-logic-border-dark text-logic-text-dim'}`}
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
        className="flex items-center gap-1 px-1.5 h-[18px] rounded bg-logic-bg-elevated border border-logic-border-light text-logic-text-dim hover:text-logic-text hover:border-logic-accent transition-colors disabled:opacity-40 disabled:pointer-events-none"
        onClick={remeasure}
        disabled={!song || measuring}
        title="Ler o BPM de novo pelo click (ou bateria)"
      >
        {measuring ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />}
        <span className="hidden lg:inline">Medir BPM de novo</span>
      </button>
      <button
        className="flex items-center gap-1 px-1.5 h-[18px] rounded bg-logic-bg-elevated border border-logic-border-light text-logic-text-dim hover:text-logic-text hover:border-logic-accent transition-colors disabled:opacity-40 disabled:pointer-events-none"
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
