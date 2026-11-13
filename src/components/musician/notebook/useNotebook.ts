import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { SheetBackend, SheetInfo } from '@/lib/musicianTypes';
import { MAX_DOC_BYTES, emptyDoc, parseDoc, serializeDoc, type NotebookDoc } from '@/lib/notebook';
import {
  anyNotKept, codeHash, forgetUnsent, isNotKept, keepUnsent, markSent, newer, newestOf, readQueue, unsentVersions,
  writeQueue, type Pending,
} from './notebookQueue';

const SAVE_DELAY = 1200;
const RETRY_MS = 15000;
const COALESCE_MS = 700;
const HISTORY_LIMIT = 120;

// not_kept: sem conexão e sem espaço neste aparelho; a versão só está na memória da página
export type SaveStatus = 'saved' | 'pending' | 'saving' | 'offline' | 'too_big' | 'not_kept';

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
  // gravação em andamento de cada música (o botão Salvar espera ela terminar)
  const inflight = useRef(new Map<string, Promise<boolean>>());
  const again = useRef(new Map<string, Pending>());
  // versão a caminho do servidor, por música (vive o mesmo tempo que `inflight`)
  const sent = useRef(new Map<string, Pending>());
  const onChangedRef = useRef(onSheetsChanged);
  onChangedRef.current = onSheetsChanged;

  const setSheetId = (id: string | null) => { sheetIdRef.current = id; setSheetIdState(id); };

  /** Grava uma versão. Devolve true quando chegou; false fica guardada para ir depois. */
  const persist = useCallback(async (p: Pending): Promise<boolean> => {
    const running = inflight.current.get(p.songId);
    if (running) {
      // vai logo depois da que está a caminho; fica só a versão mais nova
      const prev = again.current.get(p.songId);
      if (!prev || prev.at <= p.at) again.current.set(p.songId, p);
      return running;
    }
    let finish: (ok: boolean) => void = () => {};
    inflight.current.set(p.songId, new Promise<boolean>((resolve) => { finish = resolve; }));
    sent.current.set(p.songId, p);
    const isCurrent = () => songRef.current === p.songId;
    if (isCurrent()) setStatus('saving');
    let savedId: string | null = null;
    let ok = false;
    try {
      savedId = await backend.save(p.sheetId, p.songId, p.title, p.content);
      ok = true;
      // uma versão mais nova desta música que falhou antes (aparelho ou memória) vai em seguida
      const later = markSent(queueKey, p);
      if (later) {
        const queuedNext = again.current.get(p.songId);
        if (!queuedNext || queuedNext.at < later.at) again.current.set(p.songId, later);
      }
      if (isCurrent()) {
        setSheetId(savedId);
        lastSynced.current = p.content;
        if (!later && !timer.current && !again.current.has(p.songId)) setStatus('saved');
      }
      void onChangedRef.current();
    } catch {
      // sem conexão: guarda neste aparelho e, se não couber (cadernos com foto), na memória da página
      const kept = keepUnsent(queueKey, p);
      if (isCurrent()) setStatus(kept ? 'offline' : 'not_kept');
    } finally {
      sent.current.delete(p.songId);
      inflight.current.delete(p.songId);
      finish(ok);
      const next = again.current.get(p.songId);
      if (next) {
        again.current.delete(p.songId);
        void persist({ ...next, sheetId: next.sheetId ?? savedId });
      }
    }
    return ok;
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

  /**
   * Botão "Salvar": grava agora a página aberta (sem esperar a gravação automática) e o que
   * ficou guardado neste aparelho de outras músicas. Devolve como ficou.
   */
  const saveNow = useCallback(async (): Promise<'saved' | 'offline' | 'too_big' | 'empty' | 'not_kept'> => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const id = songRef.current;
    if (!id) return 'empty';
    // uma gravação desta música já em andamento termina antes (a nossa leva a versão mais nova)
    again.current.delete(id);
    for (let running = inflight.current.get(id); running; running = inflight.current.get(id)) {
      await running;
      again.current.delete(id);
    }
    if (songRef.current !== id) return 'empty';
    const p = snapshot();
    if (!p) return 'empty';
    if (p.content.length > MAX_DOC_BYTES) { setStatus('too_big'); return 'too_big'; }
    // uma versão por música (a mais nova entre o aparelho e a memória)
    const others = unsentVersions(queueKey).filter((q) => q.songId !== id && !inflight.current.has(q.songId));
    const results = await Promise.all([persist(p), ...others.map((q) => persist(q))]);
    if (results.every(Boolean)) return 'saved';
    return anyNotKept(queueKey) ? 'not_kept' : 'offline';
  }, [persist, snapshot, queueKey]);

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
    const queued = newestOf(queueKey, songId);
    // a gravação desta música ainda está a caminho (voltou para ela antes de terminar)
    const flying = newer(again.current.get(songId), sent.current.get(songId));
    setSharedFrom(existing?.shared_from ?? null);
    if (flying) {
      // mostra o que foi enviado, não a lista velha. Quando a gravação responder, o persist em
      // andamento acerta sheetId, lastSynced e o selo (esta música volta a ser a atual).
      const shown = newer(flying, queued)!;
      // a versão guardada é mais nova que a que está a caminho: vai logo em seguida
      if (shown !== flying) again.current.set(songId, shown);
      setSheetId(shown.sheetId ?? existing?.id ?? null);
      lastSynced.current = existing?.content ?? '';
      load(parseDoc(shown.content), shown.title);
      setStatus('saving');
    } else if (queued) {
      setSheetId(queued.sheetId ?? existing?.id ?? null);
      lastSynced.current = existing?.content ?? '';
      load(parseDoc(queued.content), queued.title);
      setStatus(isNotKept(queueKey, songId) ? 'not_kept' : 'offline');
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
    // com versão que falta enviar (no aparelho ou só na memória), a do servidor não toma a tela
    if (timer.current || inflight.current.has(sheet.song_id) || newestOf(queueKey, sheet.song_id)) return;
    if (sheet.content === lastSynced.current) return;
    lastSynced.current = sheet.content;
    // a página passa a mostrar ESTE caderno: a próxima edição grava nele. Antes o id antigo
    // ficava, e a edição gravava o conteúdo novo por cima do outro caderno da mesma música.
    setSheetId(sheet.id);
    load(parseDoc(sheet.content), sheet.title || songName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheet?.id, sheet?.updated_at, sheet?.content]);

  useEffect(() => {
    const retry = () => {
      unsentVersions(queueKey).forEach((p) => { if (!inflight.current.has(p.songId)) void persist(p); });
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
      // sem isto o reenvio recriaria o caderno apagado
      forgetUnsent(queueKey, id);
      again.current.delete(id);
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
    saveNow,
    resetAfterDelete,
  };
}
