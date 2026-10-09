import { AlignLeft, Bookmark, Music2, Music4, Type } from 'lucide-react';
import {
  SECTION_LABELS, fontCss, newId,
  type LineKind, type NotebookDoc, type NotebookLine, type Stroke,
} from '@/lib/notebook';
import ChordLine, { placeChord } from './ChordLine';
import StaffLine from './StaffLine';
import DrawingLayer, { type DrawTool } from './DrawingLayer';
import { LineControls, type NoteBrush } from './NotebookDocks';

type Update = (fn: (d: NotebookDoc) => NotebookDoc, coalesce?: string) => void;

const DRAW_ROOM = 220;

export const ADD_OPTIONS: { kind: LineKind; mode?: 'notes' | 'blank'; label: string; icon: typeof Type }[] = [
  { kind: 'text', label: 'Texto', icon: AlignLeft },
  { kind: 'chords', label: 'Cifra', icon: Type },
  { kind: 'section', label: 'Parte', icon: Bookmark },
  { kind: 'staff', mode: 'notes', label: 'Partitura', icon: Music2 },
  { kind: 'staff', mode: 'blank', label: 'Pauta livre', icon: Music4 },
];

function mapLine(doc: NotebookDoc, id: string, fn: (l: NotebookLine) => NotebookLine): NotebookDoc {
  return { ...doc, lines: doc.lines.map((l) => (l.id === id ? fn(l) : l)) };
}

function AutoText({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="grid">
      <span aria-hidden className="invisible whitespace-pre-wrap break-words col-start-1 row-start-1 leading-relaxed">{value + ' '}</span>
      <textarea
        value={value}
        rows={1}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="col-start-1 row-start-1 w-full resize-none overflow-hidden bg-transparent outline-none leading-relaxed placeholder:text-logic-text-muted/50"
        style={{ font: 'inherit', color: 'inherit', userSelect: 'text' }}
      />
    </div>
  );
}

function SectionLine({ label, selected, onChange }: { label: string; selected: boolean; onChange: (v: string) => void }) {
  return (
    <div className="py-1">
      <div className="flex items-center gap-2">
        <span className="px-2.5 py-0.5 rounded-md bg-logic-accent/20 text-logic-accent text-[0.72em] font-bold uppercase tracking-[0.12em] whitespace-nowrap">
          {label || 'Parte'}
        </span>
        <span className="flex-1 h-px bg-gradient-to-r from-logic-accent/40 to-transparent" />
      </div>
      {selected && (
        <div className="flex flex-wrap items-center gap-1 mt-2 animate-[fadeIn_140ms_ease-out]" style={{ fontSize: 12 }}>
          {SECTION_LABELS.map((s) => (
            <button
              key={s}
              onClick={(e) => { e.stopPropagation(); onChange(s); }}
              className={`px-2 h-7 rounded-md font-semibold transition-colors ${s === label ? 'bg-logic-accent text-white' : 'bg-logic-bg-deep text-logic-text-dim hover:text-logic-text border border-logic-border-dark'}`}
            >
              {s}
            </button>
          ))}
          <input
            value={SECTION_LABELS.includes(label) ? '' : label}
            onChange={(e) => onChange(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            placeholder="Outro nome..."
            className="h-7 w-28 px-2 rounded-md bg-logic-bg-deep border border-logic-border-dark text-logic-text outline-none focus:border-logic-accent"
          />
        </div>
      )}
    </div>
  );
}

export default function NotebookPage({
  doc, update, tool, inkColor, inkWidth, markerColor,
  selectedId, onSelect, editingId, onEditing,
  activeChord, selectedNote, onSelectNote, brush, onAdd,
}: {
  doc: NotebookDoc;
  update: Update;
  tool: DrawTool | null;
  inkColor: string;
  inkWidth: number;
  markerColor: string;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  editingId: string | null;
  onEditing: (id: string | null) => void;
  activeChord: string | null;
  selectedNote: string | null;
  onSelectNote: (id: string | null) => void;
  brush: NoteBrush;
  onAdd: (kind: LineKind, mode?: 'notes' | 'blank') => void;
}) {
  const maxY = doc.strokes.reduce((m, s) => {
    for (let i = 1; i < s.points.length; i += 2) if (s.points[i] > m) m = s.points[i];
    return m;
  }, 0);

  const move = (idx: number, dir: -1 | 1) => update((d) => {
    const lines = [...d.lines];
    const j = idx + dir;
    if (j < 0 || j >= lines.length) return d;
    [lines[idx], lines[j]] = [lines[j], lines[idx]];
    return { ...d, lines };
  });

  const remove = (id: string) => {
    update((d) => ({ ...d, lines: d.lines.filter((l) => l.id !== id) }));
    onSelect(null);
  };

  const tapStaff = (line: Extract<NotebookLine, { kind: 'staff' }>, step: number) => {
    const note = { id: newId(), step: brush.rest ? 4 : step, dur: brush.dur, rest: brush.rest || undefined, dot: brush.dot || undefined, acc: brush.rest ? null : brush.acc };
    const idx = line.notes.findIndex((n) => n.id === selectedNote);
    update((d) => mapLine(d, line.id, (l) => {
      if (l.kind !== 'staff') return l;
      const notes = [...l.notes];
      notes.splice(idx >= 0 ? idx + 1 : notes.length, 0, note);
      return { ...l, notes };
    }));
    if (idx >= 0) onSelectNote(note.id);
  };

  const addStroke = (s: Stroke) => update((d) => ({ ...d, strokes: [...d.strokes, s] }));
  const eraseStrokes = (ids: string[]) => update((d) => ({ ...d, strokes: d.strokes.filter((s) => !ids.includes(s.id)) }));

  return (
    <div
      className="relative min-h-full"
      style={{ minHeight: `max(100%, ${maxY + DRAW_ROOM}px)` }}
      onClick={() => { onSelect(null); onEditing(null); }}
    >
      <div
        className="relative px-3 sm:px-5 pt-5 pb-10 space-y-1"
        style={{ fontFamily: fontCss(doc.font), fontSize: doc.size, fontWeight: doc.bold ? 700 : 400, color: doc.color }}
      >
        {doc.lines.map((line, idx) => {
          const selected = line.id === selectedId;
          return (
            <div
              key={line.id}
              onClick={(e) => { e.stopPropagation(); if (!selected) { onSelect(line.id); onSelectNote(null); } }}
              className={`relative rounded-lg px-2 -mx-2 transition-[background-color,box-shadow] duration-150 ${
                selected ? 'bg-white/[0.04] ring-1 ring-logic-accent/50' : 'hover:bg-white/[0.02]'
              }`}
            >
              {selected && (
                <LineControls
                  canUp={idx > 0}
                  canDown={idx < doc.lines.length - 1}
                  onUp={() => move(idx, -1)}
                  onDown={() => move(idx, 1)}
                  onRemove={() => remove(line.id)}
                />
              )}
              {line.kind === 'text' && (
                <AutoText
                  value={line.text}
                  placeholder="Escreva aqui..."
                  onChange={(v) => update((d) => mapLine(d, line.id, (l) => ({ ...l, text: v })), `text:${line.id}`)}
                />
              )}
              {line.kind === 'section' && (
                <SectionLine
                  label={line.label}
                  selected={selected}
                  onChange={(v) => update((d) => mapLine(d, line.id, (l) => ({ ...l, label: v })), `section:${line.id}`)}
                />
              )}
              {line.kind === 'chords' && (
                <ChordLine
                  line={line}
                  selected={selected}
                  editing={editingId === line.id}
                  chordColor="#ffd60a"
                  activeChord={activeChord}
                  onPlace={(at) => {
                    if (!selected) onSelect(line.id);
                    if (activeChord) update((d) => mapLine(d, line.id, (l) => (l.kind === 'chords' ? { ...l, chords: placeChord(l.chords, at, activeChord) } : l)));
                  }}
                  onEditLyric={(v) => update((d) => mapLine(d, line.id, (l) => ({ ...l, lyric: v })), `lyric:${line.id}`)}
                  onStartEdit={() => onEditing(line.id)}
                  onStopEdit={() => onEditing(null)}
                />
              )}
              {line.kind === 'staff' && (
                <StaffLine
                  staff={line}
                  ink={doc.color}
                  selectedNote={selected ? selectedNote : null}
                  interactive={selected && line.mode === 'notes'}
                  onTap={(step) => tapStaff(line, step)}
                  onSelectNote={(id) => onSelectNote(id === selectedNote ? null : id)}
                />
              )}
            </div>
          );
        })}

        <div className="pt-4 flex flex-wrap items-center gap-1.5" style={{ fontSize: 12, fontFamily: 'Inter, system-ui, sans-serif', fontWeight: 600 }}>
          <span className="text-logic-text-muted mr-1">{selectedId ? 'Adicionar abaixo da linha marcada' : 'Adicionar'}</span>
          {ADD_OPTIONS.map((o) => (
            <button
              key={o.label}
              onClick={(e) => { e.stopPropagation(); onAdd(o.kind, o.mode); }}
              className="flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-dashed border-logic-border-light/60 text-logic-text-dim hover:text-logic-text hover:border-logic-accent hover:bg-logic-accent/10 transition-all active:scale-95"
            >
              <o.icon size={13} /> {o.label}
            </button>
          ))}
        </div>
      </div>

      <DrawingLayer
        strokes={doc.strokes}
        tool={tool}
        color={tool === 'marker' ? markerColor : inkColor}
        width={inkWidth}
        onAdd={addStroke}
        onErase={eraseStrokes}
      />
    </div>
  );
}
