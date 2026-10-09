import { useEffect, useState } from 'react';
import { PenLine, Radio, Sparkles } from 'lucide-react';
import type { SheetBackend, SheetInfo } from '@/lib/musicianTypes';
import {
  INK_COLORS, MARKER_COLORS, linesFromLyrics, newLine, transposeDoc,
  type LineKind, type NotebookDoc, type NotebookLine,
} from '@/lib/notebook';
import { useNotebook } from './notebook/useNotebook';
import NotebookToolbar, { type Tool } from './notebook/NotebookToolbar';
import NotebookPage from './notebook/NotebookPage';
import { ChordDock, StaffDock, type NoteBrush } from './notebook/NotebookDocks';
import { clampStep } from './notebook/StaffLine';
import SharePane from './notebook/SharePane';

const TOOLS_LS = 'vs_nb_tools';

interface ToolPrefs { ink: string; marker: string; width: number }

function readPrefs(): ToolPrefs {
  try {
    const p = JSON.parse(localStorage.getItem(TOOLS_LS) ?? '{}') as Partial<ToolPrefs>;
    return { ink: p.ink ?? INK_COLORS[0], marker: p.marker ?? MARKER_COLORS[0], width: p.width ?? 4 };
  } catch {
    return { ink: INK_COLORS[0], marker: MARKER_COLORS[0], width: 4 };
  }
}

const mapLine = (d: NotebookDoc, id: string, fn: (l: NotebookLine) => NotebookLine): NotebookDoc =>
  ({ ...d, lines: d.lines.map((l) => (l.id === id ? fn(l) : l)) });

export default function SheetPanel({
  backend, songId, songName, sheet, follow, onToggleFollow, onSheetsChanged, liveSongId, liveSongName,
}: {
  backend: SheetBackend;
  songId: string | null;
  songName: string;
  sheet: SheetInfo | undefined;
  follow: boolean;
  onToggleFollow: () => void;
  onSheetsChanged: () => Promise<void>;
  liveSongId: string | null;
  liveSongName: string | null;
}) {
  const nb = useNotebook({ backend, songId, songName, sheet, onSheetsChanged });
  const { doc, update } = nb;
  const [mode, setMode] = useState<'edit' | 'share'>('edit');
  const [tool, setTool] = useState<Tool>('type');
  const [prefs, setPrefs] = useState(readPrefs);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedNote, setSelectedNote] = useState<string | null>(null);
  const [root, setRoot] = useState('C');
  const [quality, setQuality] = useState('');
  const [brush, setBrush] = useState<NoteBrush>({ dur: 'q', rest: false, dot: false, acc: null });
  const [confirm, setConfirm] = useState<'clear' | 'delete' | null>(null);
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    setMode('edit');
    setSelectedId(null);
    setEditingId(null);
    setSelectedNote(null);
    setConfirm(null);
    setToast(null);
  }, [songId]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(t);
  }, [toast]);

  const { undo, redo } = nb;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (mode !== 'edit') return;
      if (e.key === 'Escape') { setSelectedId(null); setEditingId(null); setSelectedNote(null); return; }
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); redo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, undo, redo]);

  const savePrefs = (patch: Partial<ToolPrefs>) => setPrefs((p) => {
    const next = { ...p, ...patch };
    localStorage.setItem(TOOLS_LS, JSON.stringify(next));
    return next;
  });

  if (!songId) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center p-6 bg-logic-bg-deep">
        <PenLine size={32} className="text-logic-text-muted mb-3" />
        <p className="text-sm text-logic-text-dim">Escolha uma música no repertório</p>
        <p className="text-xs text-logic-text-muted mt-1">Quando o diretor der o play, o caderno da música aparece aqui sozinho.</p>
      </div>
    );
  }

  if (mode === 'share') return <SharePane backend={backend} sheetId={nb.sheetId} onBack={() => setMode('edit')} />;

  const selected = doc.lines.find((l) => l.id === selectedId) ?? null;
  const activeChord = tool === 'type' && selected?.kind === 'chords' ? root + quality : null;
  const staff = tool === 'type' && selected?.kind === 'staff' && selected.mode === 'notes' ? selected : null;
  const staffNote = staff?.notes.find((n) => n.id === selectedNote) ?? null;
  const usedChords = [...new Set(doc.lines.flatMap((l) => (l.kind === 'chords' ? l.chords.map((c) => c.chord) : [])))].slice(0, 16);
  const isEmpty = doc.lines.length === 0 && doc.strokes.length === 0;

  const addLine = (kind: LineKind, staffMode?: 'notes' | 'blank') => {
    const line = newLine(kind, { mode: staffMode });
    update((d) => {
      const idx = d.lines.findIndex((l) => l.id === selectedId);
      const lines = [...d.lines];
      lines.splice(idx >= 0 ? idx + 1 : lines.length, 0, line);
      return { ...d, lines };
    });
    setTool('type');
    setSelectedId(line.id);
    setSelectedNote(null);
    setEditingId(kind === 'chords' ? line.id : null);
  };

  const importLyrics = async () => {
    setImporting(true);
    try {
      const texts = await backend.songLyrics(songId);
      const lines = linesFromLyrics(texts);
      if (!lines.length) {
        setToast({ ok: false, text: 'A letra desta música ainda não foi escrita no Teleprompter.' });
        return;
      }
      update((d) => ({ ...d, lines: [...d.lines, ...lines] }));
      setToast({ ok: true, text: `Letra trazida. Toque numa linha e escolha os acordes.` });
    } catch {
      setToast({ ok: false, text: 'Não foi possível buscar a letra agora. Tente de novo.' });
    } finally {
      setImporting(false);
    }
  };

  const runConfirm = async () => {
    const what = confirm;
    setConfirm(null);
    if (what === 'clear') {
      update((d) => ({ ...d, strokes: [] }));
      return;
    }
    if (what === 'delete' && nb.sheetId) {
      try {
        await backend.remove(nb.sheetId);
        nb.resetAfterDelete();
        await onSheetsChanged();
      } catch {
        setToast({ ok: false, text: 'Não foi possível excluir agora. Tente de novo.' });
      }
    }
  };

  const updateStaff = (fn: (s: Extract<NotebookLine, { kind: 'staff' }>) => NotebookLine) => {
    if (!staff) return;
    update((d) => mapLine(d, staff.id, (l) => (l.kind === 'staff' ? fn(l) : l)));
  };

  const pickChord = (c: string) => {
    const m = /^([A-G][#b]?)(.*)$/.exec(c);
    if (!m) return;
    setRoot(m[1]);
    setQuality(m[2]);
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden relative">
      <NotebookToolbar
        follow={follow}
        onToggleFollow={onToggleFollow}
        title={nb.title}
        onTitle={nb.setTitle}
        placeholder={songName}
        sharedFrom={nb.sharedFrom}
        status={nb.status}
        canUndo={nb.canUndo}
        canRedo={nb.canRedo}
        onUndo={undo}
        onRedo={redo}
        canShare={!!nb.sheetId}
        onShare={async () => { await nb.flush(); setMode('share'); }}
        onImport={importLyrics}
        importing={importing}
        onClearDrawings={() => setConfirm('clear')}
        onDelete={() => setConfirm('delete')}
        hasDrawings={doc.strokes.length > 0}
        hasSheet={!!nb.sheetId}
        tool={tool}
        onTool={(t) => { setTool(t); if (t !== 'type') { setSelectedId(null); setEditingId(null); } }}
        doc={doc}
        onDoc={(patch) => update((d) => ({ ...d, ...patch }), `style:${Object.keys(patch).join()}`)}
        inkColor={prefs.ink}
        onInkColor={(c) => savePrefs({ ink: c })}
        markerColor={prefs.marker}
        onMarkerColor={(c) => savePrefs({ marker: c })}
        inkWidth={prefs.width}
        onInkWidth={(w) => savePrefs({ width: w })}
      />

      {!follow && liveSongId && liveSongId !== songId && (
        <button
          onClick={onToggleFollow}
          className="flex items-center gap-2 px-3 py-1.5 text-2xs text-logic-text-dim bg-logic-lcd-green/[0.06] border-b border-logic-border-dark hover:bg-logic-lcd-green/10 transition-colors text-left"
          title="Voltar a seguir o diretor"
        >
          <Radio size={12} className="text-logic-lcd-green animate-pulse flex-shrink-0" />
          <span className="truncate">Agora no show: <span className="text-logic-text font-semibold">{liveSongName ?? 'outra música'}</span></span>
          <span className="ml-auto text-logic-lcd-green font-semibold flex-shrink-0">Seguir</span>
        </button>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto logic-scroll bg-logic-bg-deep" style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(255,255,255,0.035) 1px, transparent 0)', backgroundSize: '24px 24px' }}>
        {isEmpty && (
          <div className="mx-3 sm:mx-5 mt-5 p-4 rounded-xl border border-logic-border-dark bg-logic-bg-panel/70 animate-[fadeIn_200ms_ease-out]">
            <p className="text-sm font-semibold text-logic-text">Caderno de {songName || 'música'}</p>
            <p className="text-xs text-logic-text-muted mt-1 leading-relaxed">
              Monte sua cifra, escreva a partitura ou rabisque por cima. Tudo fica salvo {backend.storedIn}, separado por música.
            </p>
            <button
              onClick={importLyrics}
              disabled={importing}
              className="mt-3 flex items-center gap-2 h-9 px-3 rounded-lg bg-logic-accent text-white text-xs font-semibold hover:brightness-110 active:scale-95 transition-all disabled:opacity-50"
            >
              <Sparkles size={14} /> Trazer letra do Teleprompter
            </button>
          </div>
        )}
        <NotebookPage
          doc={doc}
          update={update}
          tool={tool === 'type' ? null : tool}
          inkColor={prefs.ink}
          inkWidth={prefs.width}
          markerColor={prefs.marker}
          selectedId={selectedId}
          onSelect={(id) => { setSelectedId(id); if (id !== editingId) setEditingId(null); }}
          editingId={editingId}
          onEditing={setEditingId}
          activeChord={activeChord}
          selectedNote={selectedNote}
          onSelectNote={setSelectedNote}
          brush={brush}
          onAdd={addLine}
        />
      </div>

      {activeChord && (
        <ChordDock
          root={root}
          quality={quality}
          recent={usedChords}
          onRoot={setRoot}
          onQuality={setQuality}
          onPick={pickChord}
          onTranspose={(s) => update((d) => transposeDoc(d, s), 'transpose')}
          onClose={() => setSelectedId(null)}
        />
      )}
      {staff && (
        <StaffDock
          brush={brush}
          clef={staff.clef}
          time={staff.time}
          selected={staffNote}
          onBrush={setBrush}
          onClef={(clef) => updateStaff((s) => ({ ...s, clef }))}
          onTime={(time) => updateStaff((s) => ({ ...s, time }))}
          onShift={(d) => updateStaff((s) => ({ ...s, notes: s.notes.map((n) => (n.id === selectedNote ? { ...n, step: clampStep(n.step + d) } : n)) }))}
          onDeleteNote={() => { updateStaff((s) => ({ ...s, notes: s.notes.filter((n) => n.id !== selectedNote) })); setSelectedNote(null); }}
          onDeleteLast={() => updateStaff((s) => ({ ...s, notes: s.notes.slice(0, -1) }))}
          onClose={() => { setSelectedId(null); setSelectedNote(null); }}
        />
      )}

      {toast && (
        <div className={`absolute left-1/2 -translate-x-1/2 bottom-4 z-50 max-w-[90%] px-4 py-2.5 rounded-lg border text-xs shadow-2xl animate-[fadeIn_160ms_ease-out] ${
          toast.ok ? 'bg-logic-bg-elevated border-logic-lcd-green/40 text-logic-lcd-green' : 'bg-logic-bg-elevated border-logic-lcd-red/40 text-logic-lcd-red'
        }`}>
          {toast.text}
        </div>
      )}

      {confirm && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-6 animate-[fadeIn_140ms_ease-out]" onClick={() => setConfirm(null)}>
          <div className="w-full max-w-xs rounded-xl bg-logic-bg-panel border border-logic-border-light p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm font-semibold text-logic-text">
              {confirm === 'clear' ? 'Limpar todos os desenhos?' : 'Excluir o caderno desta música?'}
            </p>
            <p className="text-xs text-logic-text-muted mt-1.5 leading-relaxed">
              {confirm === 'clear'
                ? 'O texto, as cifras e as partituras continuam. Dá para desfazer logo em seguida.'
                : `Tudo o que está nesta página será apagado ${backend.storedIn}. Não dá para desfazer.`}
            </p>
            <div className="flex gap-2 mt-4">
              <button onClick={() => setConfirm(null)} className="flex-1 h-9 rounded-lg bg-logic-bg-deep border border-logic-border-dark text-xs font-semibold text-logic-text-dim hover:text-logic-text transition-colors">Cancelar</button>
              <button onClick={runConfirm} className="flex-1 h-9 rounded-lg bg-logic-lcd-red/90 text-white text-xs font-semibold hover:bg-logic-lcd-red transition-colors">
                {confirm === 'clear' ? 'Limpar' : 'Excluir'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
