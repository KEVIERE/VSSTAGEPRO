import { Pencil } from 'lucide-react';
import type { ChordMark, NotebookLine } from '@/lib/notebook';

type ChordData = Extract<NotebookLine, { kind: 'chords' }>;

interface Slot { at: number; word: string; chord: string | null }

function slots(line: ChordData, selected: boolean): Slot[] {
  const out: Slot[] = [];
  const re = /\S+\s*/g;
  let m: RegExpExecArray | null;
  const words: { at: number; end: number; word: string }[] = [];
  while ((m = re.exec(line.lyric))) words.push({ at: m.index, end: m.index + m[0].length, word: m[0] });
  const len = line.lyric.length;
  words.forEach((w) => {
    const c = line.chords.find((ch) => ch.at >= w.at && ch.at < w.end);
    out.push({ at: w.at, word: w.word, chord: c?.chord ?? null });
  });
  const tail = line.chords.filter((c) => c.at >= len).sort((a, b) => a.at - b.at);
  const lastTail = tail.length ? tail[tail.length - 1].at : len - 1;
  tail.forEach((c) => out.push({ at: c.at, word: '', chord: c.chord }));
  if (selected || out.length === 0) out.push({ at: Math.max(len, lastTail + 1), word: '', chord: null });
  return out;
}

export function placeChord(chords: ChordMark[], at: number, chord: string): ChordMark[] {
  const rest = chords.filter((c) => c.at !== at);
  const existing = chords.find((c) => c.at === at);
  if (existing?.chord === chord) return rest;
  return [...rest, { at, chord }].sort((a, b) => a.at - b.at);
}

export default function ChordLine({ line, selected, editing, chordColor, activeChord, onPlace, onEditLyric, onStartEdit, onStopEdit }: {
  line: ChordData;
  selected: boolean;
  editing: boolean;
  chordColor: string;
  activeChord: string | null;
  onPlace: (at: number) => void;
  onEditLyric: (lyric: string) => void;
  onStartEdit: () => void;
  onStopEdit: () => void;
}) {
  if (editing) {
    return (
      <div className="flex items-center gap-2 py-1">
        <input
          autoFocus
          value={line.lyric}
          onChange={(e) => onEditLyric(e.target.value)}
          onBlur={onStopEdit}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') onStopEdit(); }}
          placeholder="Digite a letra deste trecho (ou deixe vazio para só acordes)"
          className="flex-1 min-w-0 bg-white/5 rounded px-2 py-1 outline-none ring-1 ring-logic-accent/60"
          style={{ font: 'inherit', color: 'inherit' }}
        />
      </div>
    );
  }

  return (
    <div className="flex items-end gap-y-1 flex-wrap py-0.5">
      {slots(line, selected).map((s) => (
        <button
          key={`${s.at}-${s.word}`}
          type="button"
          onClick={(e) => { if (activeChord) { e.stopPropagation(); onPlace(s.at); } }}
          className={`group/slot inline-flex flex-col items-start text-left rounded-sm transition-colors ${
            activeChord ? 'hover:bg-logic-lcd-amber/10 cursor-copy' : 'cursor-text'
          } ${s.word ? '' : 'min-w-[2.2em] mr-1'}`}
          style={{ font: 'inherit', color: 'inherit' }}
        >
          <span
            className="block font-bold leading-tight whitespace-pre"
            style={{ color: chordColor, fontSize: '0.86em', minHeight: '1.2em' }}
          >
            {s.chord ?? (activeChord && selected ? <span className="opacity-0 group-hover/slot:opacity-40">{activeChord}</span> : '\u00a0')}
          </span>
          <span className="block whitespace-pre leading-snug">{s.word || (s.chord ? '\u00a0' : <span className="opacity-30">·</span>)}</span>
        </button>
      ))}
      {selected && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onStartEdit(); }}
          title="Editar a letra deste trecho"
          className="ml-2 mb-0.5 p-1 rounded text-logic-text-muted hover:text-logic-text hover:bg-logic-bg-elevated transition-colors"
        >
          <Pencil size={13} />
        </button>
      )}
    </div>
  );
}
