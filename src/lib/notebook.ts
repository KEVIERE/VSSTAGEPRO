export type FontId = 'sans' | 'condensed' | 'serif' | 'mono' | 'rounded' | 'hand';
export type NoteDur = 'w' | 'h' | 'q' | 'e' | 's';
export type Accidental = '#' | 'b' | null;
export type Clef = 'treble' | 'bass';
export type TimeSig = '4/4' | '3/4' | '2/4' | '6/8';

export interface StaffNote {
  id: string;
  /** Diatonic steps above the bottom staff line (0 = bottom line, 8 = top line). */
  step: number;
  dur: NoteDur;
  rest?: boolean;
  dot?: boolean;
  acc?: Accidental;
}

export interface ChordMark { at: number; chord: string }

export type NotebookLine =
  | { id: string; kind: 'text'; text: string }
  | { id: string; kind: 'section'; label: string }
  | { id: string; kind: 'chords'; lyric: string; chords: ChordMark[] }
  | { id: string; kind: 'staff'; mode: 'notes' | 'blank'; clef: Clef; time: TimeSig; notes: StaffNote[] };

export type LineKind = NotebookLine['kind'];

export interface Stroke {
  id: string;
  tool: 'pen' | 'marker';
  color: string;
  width: number;
  /** Flat x,y pairs: x in 0..10000 of the page width, y in CSS pixels from the page top. */
  points: number[];
}

export interface NotebookDoc {
  v: 2;
  font: FontId;
  size: number;
  bold: boolean;
  color: string;
  lines: NotebookLine[];
  strokes: Stroke[];
}

export const FONTS: { id: FontId; label: string; css: string }[] = [
  { id: 'sans', label: 'Clássica', css: 'Inter, "Open Sans", system-ui, sans-serif' },
  { id: 'condensed', label: 'Estreita', css: '"Roboto Condensed", "Barlow Semi Condensed", "Arial Narrow", sans-serif' },
  { id: 'serif', label: 'Livro', css: 'Merriweather, Georgia, serif' },
  { id: 'mono', label: 'Máquina', css: '"JetBrains Mono", ui-monospace, Menlo, monospace' },
  { id: 'rounded', label: 'Redonda', css: 'Nunito, Quicksand, "Trebuchet MS", sans-serif' },
  { id: 'hand', label: 'À mão', css: 'Caveat, "Permanent Marker", "Segoe Print", cursive' },
];

export const TEXT_COLORS = ['#f2f2f2', '#ffd60a', '#30d158', '#64d2ff', '#ff9f0a', '#ff6b6b'];
export const INK_COLORS = ['#ff453a', '#0a84ff', '#30d158', '#ffd60a', '#f2f2f2', '#bf9b6f'];
export const MARKER_COLORS = ['#ffd60a', '#30d158', '#ff9f0a', '#64d2ff', '#ff6bd5'];
export const SECTION_LABELS = ['Intro', 'Verso', 'Pré-refrão', 'Refrão', 'Ponte', 'Solo', 'Interlúdio', 'Final'];
export const SIZE_MIN = 12;
export const SIZE_MAX = 32;
export const MAX_DOC_BYTES = 1_400_000;

export const fontCss = (id: FontId) => (FONTS.find((f) => f.id === id) ?? FONTS[0]).css;

export const newId = () => Math.random().toString(36).slice(2, 10);

export function emptyDoc(): NotebookDoc {
  return { v: 2, font: 'sans', size: 17, bold: false, color: TEXT_COLORS[0], lines: [], strokes: [] };
}

export function newLine(kind: LineKind, extra?: { label?: string; mode?: 'notes' | 'blank' }): NotebookLine {
  const id = newId();
  if (kind === 'text') return { id, kind, text: '' };
  if (kind === 'section') return { id, kind, label: extra?.label ?? 'Verso' };
  if (kind === 'chords') return { id, kind, lyric: '', chords: [] };
  return { id, kind, mode: extra?.mode ?? 'notes', clef: 'treble', time: '4/4', notes: [] };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

function cleanLine(raw: unknown): NotebookLine | null {
  if (!isObj(raw) || typeof raw.id !== 'string') return null;
  const id = raw.id;
  switch (raw.kind) {
    case 'text':
      return { id, kind: 'text', text: String(raw.text ?? '') };
    case 'section':
      return { id, kind: 'section', label: String(raw.label ?? '') };
    case 'chords':
      return {
        id, kind: 'chords', lyric: String(raw.lyric ?? ''),
        chords: Array.isArray(raw.chords)
          ? raw.chords.filter((c): c is ChordMark => isObj(c) && typeof c.at === 'number' && typeof c.chord === 'string')
          : [],
      };
    case 'staff':
      return {
        id, kind: 'staff',
        mode: raw.mode === 'blank' ? 'blank' : 'notes',
        clef: raw.clef === 'bass' ? 'bass' : 'treble',
        time: (['4/4', '3/4', '2/4', '6/8'] as const).find((t) => t === raw.time) ?? '4/4',
        notes: Array.isArray(raw.notes)
          ? raw.notes.filter((n): n is StaffNote => isObj(n) && typeof n.id === 'string' && typeof n.step === 'number' && typeof n.dur === 'string')
          : [],
      };
    default:
      return null;
  }
}

/** Reads a saved sheet. Sheets written before the notebook existed are plain text and become one text line. */
export function parseDoc(content: string | undefined | null): NotebookDoc {
  const doc = emptyDoc();
  if (!content) return doc;
  try {
    const raw: unknown = JSON.parse(content);
    if (isObj(raw) && raw.v === 2) {
      const font = FONTS.find((f) => f.id === raw.font)?.id ?? doc.font;
      return {
        v: 2,
        font,
        size: typeof raw.size === 'number' ? Math.min(SIZE_MAX, Math.max(SIZE_MIN, raw.size)) : doc.size,
        bold: raw.bold === true,
        color: typeof raw.color === 'string' ? raw.color : doc.color,
        lines: Array.isArray(raw.lines) ? raw.lines.map(cleanLine).filter((l): l is NotebookLine => !!l) : [],
        strokes: Array.isArray(raw.strokes)
          ? raw.strokes.filter((s): s is Stroke => isObj(s) && Array.isArray(s.points) && typeof s.color === 'string')
          : [],
      };
    }
  } catch { /* plain text */ }
  return { ...doc, lines: [{ id: newId(), kind: 'text', text: content }] };
}

export const serializeDoc = (doc: NotebookDoc) => JSON.stringify(doc);

export function docIsEmpty(doc: NotebookDoc): boolean {
  return doc.strokes.length === 0 && doc.lines.every((l) =>
    (l.kind === 'text' && !l.text.trim()) || (l.kind === 'chords' && !l.lyric.trim() && l.chords.length === 0));
}

const SHARPS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLATS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const NOTE_INDEX: Record<string, number> = Object.fromEntries([
  ...SHARPS.map((n, i) => [n, i]), ...FLATS.map((n, i) => [n, i]), ['Cb', 11], ['Fb', 4], ['E#', 5], ['B#', 0],
]);

function shiftNote(note: string, semis: number, preferFlat: boolean): string {
  const i = NOTE_INDEX[note];
  if (i === undefined) return note;
  const j = (((i + semis) % 12) + 12) % 12;
  return (preferFlat ? FLATS : SHARPS)[j];
}

export function transposeChord(chord: string, semis: number): string {
  const m = /^([A-G][#b]?)([^/]*)(?:\/([A-G][#b]?))?$/.exec(chord.trim());
  if (!m) return chord;
  const flat = m[1].includes('b') || (!!m[3] && m[3].includes('b'));
  return shiftNote(m[1], semis, flat) + m[2] + (m[3] ? `/${shiftNote(m[3], semis, flat)}` : '');
}

export function transposeDoc(doc: NotebookDoc, semis: number): NotebookDoc {
  return {
    ...doc,
    lines: doc.lines.map((l) => (l.kind === 'chords' ? { ...l, chords: l.chords.map((c) => ({ ...c, chord: transposeChord(c.chord, semis) })) } : l)),
  };
}

export const CHORD_ROOTS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
export const CHORD_QUALITIES = ['', 'm', '7', 'm7', '7M', 'sus4', '9', 'add9', 'dim', 'm7(b5)', '6', '4'];

export const DUR_BEATS: Record<NoteDur, number> = { w: 4, h: 2, q: 1, e: 0.5, s: 0.25 };
export const DUR_LABELS: Record<NoteDur, string> = { w: 'Semibreve', h: 'Mínima', q: 'Semínima', e: 'Colcheia', s: 'Semicolcheia' };
export const barBeats = (t: TimeSig) => (t === '4/4' ? 4 : t === '3/4' ? 3 : t === '2/4' ? 2 : 3);
export const noteBeats = (n: StaffNote) => DUR_BEATS[n.dur] * (n.dot ? 1.5 : 1);

const TREBLE_BOTTOM = { letter: 2, octave: 4 };
const BASS_BOTTOM = { letter: 4, octave: 2 };
const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];

export function stepName(step: number, clef: Clef): string {
  const base = clef === 'treble' ? TREBLE_BOTTOM : BASS_BOTTOM;
  const abs = base.letter + base.octave * 7 + step;
  return `${LETTERS[((abs % 7) + 7) % 7]}${Math.floor(abs / 7)}`;
}

/** Lyrics pulled from the teleprompter become one chord line per sung line, ready for chords. */
export function linesFromLyrics(texts: string[]): NotebookLine[] {
  const out: NotebookLine[] = [];
  texts.forEach((page, i) => {
    if (i > 0) out.push({ id: newId(), kind: 'text', text: '' });
    page.split('\n').map((l) => l.trim()).filter(Boolean)
      .forEach((lyric) => out.push({ id: newId(), kind: 'chords', lyric, chords: [] }));
  });
  return out;
}
