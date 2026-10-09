import { ArrowDown, ArrowUp, ChevronDown, ChevronUp, Delete, Minus, Plus, X } from 'lucide-react';
import {
  CHORD_QUALITIES, CHORD_ROOTS, DUR_LABELS, stepName,
  type Accidental, type Clef, type NoteDur, type TimeSig,
} from '@/lib/notebook';

const chip = (on: boolean) =>
  `px-2.5 h-8 rounded-md text-xs font-semibold transition-all active:scale-95 ${
    on ? 'bg-logic-lcd-amber text-black shadow-[0_0_0_1px_rgba(255,214,10,.5)]' : 'bg-logic-bg-deep text-logic-text-dim hover:text-logic-text hover:bg-logic-bg-elevated border border-logic-border-dark'
  }`;

function DockShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="border-t border-logic-border-dark bg-logic-bg-panel/95 backdrop-blur px-3 pt-2 pb-3 animate-[fadeIn_160ms_ease-out]">
      <div className="flex items-center justify-between mb-2">
        <span className="text-2xs uppercase tracking-wider text-logic-text-muted font-semibold">{title}</span>
        <button onClick={onClose} title="Fechar" className="p-1 rounded text-logic-text-muted hover:text-logic-text hover:bg-logic-bg-elevated transition-colors"><X size={14} /></button>
      </div>
      {children}
    </div>
  );
}

export function ChordDock({ root, quality, recent, onRoot, onQuality, onPick, onTranspose, onClose }: {
  root: string;
  quality: string;
  recent: string[];
  onRoot: (r: string) => void;
  onQuality: (q: string) => void;
  onPick: (chord: string) => void;
  onTranspose: (semis: number) => void;
  onClose: () => void;
}) {
  const chord = root + quality;
  return (
    <DockShell title="Acordes: escolha e toque na palavra" onClose={onClose}>
      <div className="flex items-center gap-3 mb-2">
        <div className="h-11 min-w-[72px] px-3 rounded-lg bg-black/40 border border-logic-lcd-amber/40 flex items-center justify-center text-lg font-bold text-logic-lcd-amber font-mono">
          {chord}
        </div>
        <div className="flex items-center gap-1 ml-auto">
          <span className="text-2xs text-logic-text-muted mr-1">Tom</span>
          <button onClick={() => onTranspose(-1)} title="Baixar meio tom em todas as cifras" className={chip(false)}><Minus size={13} /></button>
          <button onClick={() => onTranspose(1)} title="Subir meio tom em todas as cifras" className={chip(false)}><Plus size={13} /></button>
        </div>
      </div>
      <div className="flex flex-wrap gap-1 mb-1.5">
        {CHORD_ROOTS.map((r) => <button key={r} onClick={() => onRoot(r)} className={chip(r === root)}>{r}</button>)}
      </div>
      <div className="flex flex-wrap gap-1">
        {CHORD_QUALITIES.map((q) => <button key={q || 'maj'} onClick={() => onQuality(q)} className={chip(q === quality)}>{q || 'maior'}</button>)}
      </div>
      {recent.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 mt-2 pt-2 border-t border-logic-border-dark">
          <span className="text-2xs text-logic-text-muted mr-1">Já usados</span>
          {recent.map((c) => <button key={c} onClick={() => onPick(c)} className={chip(c === chord)}>{c}</button>)}
        </div>
      )}
    </DockShell>
  );
}

export interface NoteBrush { dur: NoteDur; rest: boolean; dot: boolean; acc: Accidental }

const DURS: { id: NoteDur; glyph: string }[] = [
  { id: 'w', glyph: '𝅝' }, { id: 'h', glyph: '𝅗𝅥' }, { id: 'q', glyph: '♩' }, { id: 'e', glyph: '♪' }, { id: 's', glyph: '𝅘𝅥𝅯' },
];

export function StaffDock({ brush, clef, time, selected, onBrush, onClef, onTime, onShift, onDeleteNote, onDeleteLast, onClose }: {
  brush: NoteBrush;
  clef: Clef;
  time: TimeSig;
  selected: { step: number; rest?: boolean } | null;
  onBrush: (b: NoteBrush) => void;
  onClef: (c: Clef) => void;
  onTime: (t: TimeSig) => void;
  onShift: (d: number) => void;
  onDeleteNote: () => void;
  onDeleteLast: () => void;
  onClose: () => void;
}) {
  return (
    <DockShell title={selected ? `Nota selecionada${selected.rest ? ' (pausa)' : `: ${stepName(selected.step, clef)}`}` : 'Notas: toque na pauta na altura desejada'} onClose={onClose}>
      <div className="flex flex-wrap items-center gap-1 mb-1.5">
        {DURS.map((d) => (
          <button key={d.id} onClick={() => onBrush({ ...brush, dur: d.id })} title={DUR_LABELS[d.id]} className={`${chip(brush.dur === d.id)} min-w-[38px] text-lg leading-none`} style={{ fontFamily: '"Noto Music", "Segoe UI Symbol", "Apple Symbols", serif' }}>
            {d.glyph}
          </button>
        ))}
        <span className="w-px h-6 bg-logic-border-dark mx-1" />
        <button onClick={() => onBrush({ ...brush, rest: !brush.rest })} className={chip(brush.rest)}>Pausa</button>
        <button onClick={() => onBrush({ ...brush, dot: !brush.dot })} title="Ponto de aumento" className={chip(brush.dot)}>Ponto</button>
        <button onClick={() => onBrush({ ...brush, acc: brush.acc === '#' ? null : '#' })} title="Sustenido" className={chip(brush.acc === '#')}>♯</button>
        <button onClick={() => onBrush({ ...brush, acc: brush.acc === 'b' ? null : 'b' })} title="Bemol" className={chip(brush.acc === 'b')}>♭</button>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <button onClick={() => onClef('treble')} className={chip(clef === 'treble')}>Clave de Sol</button>
        <button onClick={() => onClef('bass')} className={chip(clef === 'bass')}>Clave de Fá</button>
        <span className="w-px h-6 bg-logic-border-dark mx-1" />
        {(['4/4', '3/4', '2/4', '6/8'] as TimeSig[]).map((t) => <button key={t} onClick={() => onTime(t)} className={chip(time === t)}>{t}</button>)}
        <span className="flex-1" />
        {selected ? (
          <>
            {!selected.rest && (
              <>
                <button onClick={() => onShift(1)} title="Subir a nota" className={chip(false)}><ChevronUp size={14} /></button>
                <button onClick={() => onShift(-1)} title="Descer a nota" className={chip(false)}><ChevronDown size={14} /></button>
              </>
            )}
            <button onClick={onDeleteNote} title="Apagar nota selecionada" className={`${chip(false)} hover:!text-logic-lcd-red`}><Delete size={14} /></button>
          </>
        ) : (
          <button onClick={onDeleteLast} title="Apagar a última nota" className={`${chip(false)} flex items-center gap-1`}><Delete size={14} /> Última</button>
        )}
      </div>
    </DockShell>
  );
}

export function LineControls({ canUp, canDown, onUp, onDown, onRemove }: {
  canUp: boolean; canDown: boolean; onUp: () => void; onDown: () => void; onRemove: () => void;
}) {
  const btn = 'p-1 rounded text-logic-text-muted hover:text-logic-text hover:bg-logic-bg-elevated transition-colors disabled:opacity-25 disabled:pointer-events-none';
  return (
    <div className="absolute -top-3 right-1 z-20 flex items-center gap-0.5 px-0.5 rounded-md bg-logic-bg-panel border border-logic-border-dark shadow-lg animate-[fadeIn_120ms_ease-out]">
      <button onClick={(e) => { e.stopPropagation(); onUp(); }} disabled={!canUp} title="Subir linha" className={btn}><ArrowUp size={13} /></button>
      <button onClick={(e) => { e.stopPropagation(); onDown(); }} disabled={!canDown} title="Descer linha" className={btn}><ArrowDown size={13} /></button>
      <button onClick={(e) => { e.stopPropagation(); onRemove(); }} title="Remover linha" className={`${btn} hover:!text-logic-lcd-red`}><X size={13} /></button>
    </div>
  );
}
