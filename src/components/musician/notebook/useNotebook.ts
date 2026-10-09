import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { SheetBackend, SheetInfo } from '@/lib/musicianTypes';
import { MAX_DOC_BYTES, emptyDoc, parseDoc, serializeDoc, type NotebookDoc } from '@/lib/notebook';

const SAVE_DELAY = 1200;
const RETRY_MS = 15000;
const COALESCE_MS = 700;
const HISTORY_LIMIT = 120;

export type SaveStatus = 'saved' | 'pending' | 'saving' | 'offline' | 'too_big';

interface Pending { songId: string; sheetId: string | null; title: string; content: string; at: number }
type Queue = Record<string, Pending>;

function codeHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function readQueue(key: string): Queue {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(key) ?? '{}');
    return raw && typeof raw === 'object' ? (raw as Queue) : {};
  } catch { return {}; }
}

function writeQueue(key: string, q: Queue) {
  try {
    if (Object.keys(q).length) localStorage.setItem(key, JSON.stringify(q));
    else localStorage.removeItem(key);
  } catch { /* storage full: the server save still runs */ }
}

interface Hist { doc: NotebookDoc; past: NotebookDoc[]; future: NotebookDoc[]; key: string; at: number }

export function useNotebook({ backend, songId, songName, sheet, onSheetsChanged }: {
  backend: SheetBackend;
  songId: string | null;
  songName: string;
  sheet: SheetInfo | undefined;
  onSheetsChanged: () => Promise<void>;
}) {
  const queueKey = `vs_nb_queue:${codeHash(backend.key)}`;
  const hist = useRef<Hist>({ doc: emptyDoc(), past: [], future: [], key: '', at: 0 });
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  const [title, setTitleState] = useState('');
  const [status, setStatus] = useState<SaveStatus>('saved');
  const [sharedFrom, setSharedFrom] = useState<string | null>(null);
  const [sheetId, setSheetIdState] = useState<string | null>(null);

  const songRef = useRef(songId);
  const sheetRef = useRef(sheet);
  sheetRef.current = sheet;
  const sheetIdRef = useRef<string | null>(null);
  const titleRef = useRef('');
  const lastSynced = useRef('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflight = useRef(new Set<string>());
  const again = useRef(new Map<string, Pending>());
  const onChangedRef = useRef(onSheetsChanged);
  onChangedRef.current = onSheetsChanged;

  const setSheetId = (id: string | null) => { sheetIdRef.current = id; setSheetIdState(id); };

  const persist = useCallback(async (p: Pending): Promise<void> => {
    if (inflight.current.has(p.songId)) { again.current.set(p.songId, p); return; }
    inflight.current.add(p.songId);
    const isCurrent = () => songRef.current === p.songId;
    if (isCurrent()) setStatus('saving');
    let savedId: string | null = null;
    try {
      savedId = await backend.save(p.sheetId, p.songId, p.title, p.content);
      const q = readQueue(queueKey);
      if (q[p.songId] && q[p.songId].at <= p.at) { delete q[p.songId]; writeQueue(queueKey, q); }
      if (isCurrent()) {
        setSheetId(savedId);
        lastSynced.current = p.content;
        if (!timer.current && !again.current.has(p.songId)) setStatus('saved');
      }
      void onChangedRef.current();
    } catch {
      const q = readQueue(queueKey);
      if (!q[p.songId] || q[p.songId].at <= p.at) { q[p.songId] = p; writeQueue(queueKey, q); }
      if (isCurrent()) setStatus('offline');
    } finally {
      inflight.current.delete(p.songId);
      const next = again.current.get(p.songId);
      if (next) {
        again.current.delete(p.songId);
        void persist({ ...next, sheetId: next.sheetId ?? savedId });
      }
    }
  }, [backend, queueKey]);

  const snapshot = useCallback((): Pending | null => {
    const id = songRef.current;
    if (!id) return null;
    return { songId: id, sheetId: sheetIdRef.current, title: titleRef.current, content: serializeDoc(hist.current.doc), at: Date.now() };
  }, []);

  const flush = useCallback(async () => {
    if (!timer.current) return;
    clearTimeout(timer.current);
    timer.current = null;
    const p = snapshot();
    if (!p) return;
    if (p.content.length > MAX_DOC_BYTES) { setStatus('too_big'); return; }
    await persist(p);
  }, [persist, snapshot]);

  const schedule = useCallback(() => {
    if (!songRef.current) return;
    setStatus('pending');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      const p = snapshot();
      if (!p) return;
      if (p.content.length > MAX_DOC_BYTES) { setStatus('too_big'); return; }
      void persist(p);
    }, SAVE_DELAY);
  }, [persist, snapshot]);

  const load = (doc: NotebookDoc, nextTitle: string) => {
    hist.current = { doc, past: [], future: [], key: '', at: 0 };
    titleRef.current = nextTitle;
    setTitleState(nextTitle);
    rerender();
  };

  useEffect(() => {
    songRef.current = songId;
    if (!songId) return;
    const existing = sheetRef.current;
    const queued = readQueue(queueKey)[songId];
    setSharedFrom(existing?.shared_from ?? null);
    if (queued) {
      setSheetId(queued.sheetId ?? existing?.id ?? null);
      lastSynced.current = existing?.content ?? '';
      load(parseDoc(queued.content), queued.title);
      setStatus('offline');
      void persist({ ...queued, sheetId: queued.sheetId ?? existing?.id ?? null });
    } else {
      setSheetId(existing?.id ?? null);
      lastSynced.current = existing?.content ?? '';
      load(parseDoc(existing?.content), existing?.title || songName);
      setStatus('saved');
    }
    return () => {
      if (!timer.current) return;
      clearTimeout(timer.current);
      timer.current = null;
      const p = { songId, sheetId: sheetIdRef.current, title: titleRef.current, content: serializeDoc(hist.current.doc), at: Date.now() };
      if (p.content.length <= MAX_DOC_BYTES) void persist(p);
    };
    // songName follows songId; the saved sheet is read when the song changes or arrives below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [songId, queueKey]);

  // A sheet that arrives later (first load, or a colleague's share) replaces an untouched page.
  useEffect(() => {
    if (!sheet || sheet.song_id !== songRef.current) return;
    if (!sheetIdRef.current) setSheetId(sheet.id);
    setSharedFrom(sheet.shared_from ?? null);
    if (timer.current || inflight.current.has(sheet.song_id) || readQueue(queueKey)[sheet.song_id]) return;
    if (sheet.content === lastSynced.current) return;
    lastSynced.current = sheet.content;
    load(parseDoc(sheet.content), sheet.title || songName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheet?.id, sheet?.updated_at, sheet?.content]);

  useEffect(() => {
    const retry = () => {
      const q = readQueue(queueKey);
      Object.values(q).forEach((p) => { if (!inflight.current.has(p.songId)) void persist(p); });
    };
    const keep = () => {
      if (!timer.current) return;
      const p = snapshot();
      if (!p || p.content.length > MAX_DOC_BYTES) return;
      const q = readQueue(queueKey);
      q[p.songId] = p;
      writeQueue(queueKey, q);
    };
    retry();
    const iv = setInterval(retry, RETRY_MS);
    window.addEventListener('online', retry);
    window.addEventListener('pagehide', keep);
    return () => {
      clearInterval(iv);
      window.removeEventListener('online', retry);
      window.removeEventListener('pagehide', keep);
    };
  }, [persist, queueKey, snapshot]);

  /** Applies a change. Edits sharing a `coalesce` key within a short burst become one undo step. */
  const update = useCallback((fn: (d: NotebookDoc) => NotebookDoc, coalesce = '') => {
    const h = hist.current;
    const next = fn(h.doc);
    if (next === h.doc) return;
    const now = Date.now();
    const merge = !!coalesce && coalesce === h.key && now - h.at < COALESCE_MS;
    hist.current = {
      doc: next,
      past: merge ? h.past : [...h.past, h.doc].slice(-HISTORY_LIMIT),
      future: [],
      key: coalesce,
      at: now,
    };
    rerender();
    schedule();
  }, [schedule]);

  const step = useCallback((dir: 'undo' | 'redo') => {
    const h = hist.current;
    const from = dir === 'undo' ? h.past : h.future;
    if (!from.length) return;
    const target = from[from.length - 1];
    hist.current = dir === 'undo'
      ? { doc: target, past: h.past.slice(0, -1), future: [...h.future, h.doc], key: '', at: 0 }
      : { doc: target, past: [...h.past, h.doc], future: h.future.slice(0, -1), key: '', at: 0 };
    rerender();
    schedule();
  }, [schedule]);

  const setTitle = useCallback((t: string) => {
    titleRef.current = t;
    setTitleState(t);
    schedule();
  }, [schedule]);

  const resetAfterDelete = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const id = songRef.current;
    if (id) {
      const q = readQueue(queueKey);
      delete q[id];
      writeQueue(queueKey, q);
    }
    setSheetId(null);
    lastSynced.current = '';
    load(emptyDoc(), songName);
    setStatus('saved');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queueKey, songName]);

  return {
    doc: hist.current.doc,
    canUndo: hist.current.past.length > 0,
    canRedo: hist.current.future.length > 0,
    undo: () => step('undo'),
    redo: () => step('redo'),
    update,
    title,
    setTitle,
    status,
    sheetId,
    sharedFrom,
    flush,
    resetAfterDelete,
  };
}
