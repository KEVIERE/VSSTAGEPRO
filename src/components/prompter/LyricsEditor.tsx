import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Music2, Play, RefreshCw } from 'lucide-react';
import SongLyricsEditor, { type SaveStatus } from '@/components/prompter/SongLyricsEditor';
import LyricsProjectBar from '@/components/prompter/LyricsProjectBar';
import type { LyricPage, PrompterSnapshot, PrompterState } from '@/lib/prompterTypes';
import type { SetlistSong } from '@/lib/musicianTypes';
import { producerRequestLyricsSave, producerSaveLyrics } from '@/lib/prompterApi';
import { producerReferenceList, type ProducerReference } from '@/lib/prompterAudio';

const SAVE_DEBOUNCE_MS = 800;
const AUDIO_REFRESH_MS = 30_000;
const HISTORY_COALESCE_MS = 700;
const HISTORY_LIMIT = 200;

export default function LyricsEditor({ code, snap, sync, now, state, update }: {
  code: string;
  snap: PrompterSnapshot;
  state: PrompterState;
  update: (fn: (s: PrompterState) => PrompterState) => void;
  sync: { lagMs: number; receivedAt: number };
  now: number;
}) {
  const songs = useMemo(() => {
    const map = new Map(snap.show.setlist.songs.map((s) => [s.id, s]));
    const ordered = snap.show.setlist.order.map((id) => map.get(id)).filter((s): s is SetlistSong => !!s);
    return ordered.length ? ordered : snap.show.setlist.songs;
  }, [snap.show.setlist]);
  const [songId, setSongId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, LyricPage[]>>({});
  const [status, setStatus] = useState<Record<string, SaveStatus>>({});
  const saveTimers = useRef<Record<string, number>>({});
  const unsaved = useRef<Record<string, LyricPage[]>>({});
  const [audioRefs, setAudioRefs] = useState<Map<string, ProducerReference>>(new Map());
  const [audioState, setAudioState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [autoPlayId, setAutoPlayId] = useState<string | null>(null);

  const loadAudio = useCallback(async (quiet = false) => {
    if (!quiet) setAudioState('loading');
    try {
      const fresh = await producerReferenceList(code);
      // Signed links change on every fetch; keep the old one unless the audio itself changed, so playback isn't reset.
      setAudioRefs((prev) => {
        const next = new Map<string, ProducerReference>();
        fresh.forEach((ref, id) => {
          const old = prev.get(id);
          next.set(id, old && old.updatedAt === ref.updatedAt ? old : ref);
        });
        return next;
      });
      setAudioState('ready');
    } catch {
      if (!quiet) setAudioState('error');
    }
  }, [code]);

  useEffect(() => {
    loadAudio();
    const timer = window.setInterval(() => loadAudio(true), AUDIO_REFRESH_MS);
    const onFocus = () => loadAudio(true);
    window.addEventListener('focus', onFocus);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', onFocus); };
  }, [loadAudio]);

  useEffect(() => {
    if (!songId && songs[0]) setSongId(songs[0].id);
  }, [songs, songId]);

  const serverPages = useCallback((id: string) => snap.lyrics.find((l) => l.song_id === id)?.pages ?? [], [snap.lyrics]);
  const pagesOf = useCallback((id: string) => drafts[id] ?? serverPages(id), [drafts, serverPages]);

  const save = useCallback(async (id: string, pages: LyricPage[]): Promise<boolean> => {
    try {
      await producerSaveLyrics(code, id, pages);
      if (unsaved.current[id] === pages) delete unsaved.current[id];
      setStatus((s) => ({ ...s, [id]: 'saved' }));
      return true;
    } catch {
      setStatus((s) => ({ ...s, [id]: 'error' }));
      return false;
    }
  }, [code]);

  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;
  const history = useRef<Record<string, { past: LyricPage[][]; future: LyricPage[][]; lastAt: number }>>({});
  const [, setHistoryTick] = useState(0);

  const commit = useCallback((id: string, next: LyricPage[]) => {
    draftsRef.current = { ...draftsRef.current, [id]: next };
    setDrafts(draftsRef.current);
    window.clearTimeout(saveTimers.current[id]);
    unsaved.current[id] = next;
    saveTimers.current[id] = window.setTimeout(() => save(id, next), SAVE_DEBOUNCE_MS);
    setStatus((s) => ({ ...s, [id]: 'saving' }));
  }, [save]);

  const setPages = useCallback((id: string, fn: (p: LyricPage[]) => LyricPage[]) => {
    const cur = draftsRef.current[id] ?? serverPages(id);
    const next = fn(cur);
    if (next === cur) return;
    const h = (history.current[id] ??= { past: [], future: [], lastAt: 0 });
    const now = Date.now();
    // Typing bursts collapse into one undo step.
    if (now - h.lastAt > HISTORY_COALESCE_MS) {
      h.past.push(cur);
      if (h.past.length > HISTORY_LIMIT) h.past.shift();
    }
    h.lastAt = now;
    h.future = [];
    commit(id, next);
    setHistoryTick((t) => t + 1);
  }, [commit, serverPages]);

  const stepHistory = useCallback((id: string, dir: 'undo' | 'redo') => {
    const h = history.current[id];
    if (!h) return;
    const from = dir === 'undo' ? h.past : h.future;
    const to = dir === 'undo' ? h.future : h.past;
    const target = from.pop();
    if (!target) return;
    to.push(draftsRef.current[id] ?? serverPages(id));
    h.lastAt = 0;
    commit(id, target);
    setHistoryTick((t) => t + 1);
  }, [commit, serverPages]);

  useEffect(() => {
    if (!songId) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); stepHistory(songId, 'undo'); }
      else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); stepHistory(songId, 'redo'); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [songId, stepHistory]);

  useEffect(() => {
    const timers = saveTimers.current;
    return () => Object.values(timers).forEach((t) => window.clearTimeout(t));
  }, []);

  const saveToProject = useCallback(async () => {
    const pending = Object.entries(unsaved.current);
    pending.forEach(([id]) => window.clearTimeout(saveTimers.current[id]));
    const results = await Promise.all(pending.map(([id, pages]) => save(id, pages)));
    if (results.includes(false)) throw new Error('save_failed');
    await producerRequestLyricsSave(code);
  }, [code, save]);

  const song = songs.find((s) => s.id === songId) ?? null;
  const liveSnap = useMemo(() => ({ ...snap, prompter: state }), [snap, state]);

  return (
    <div className="grid gap-4 md:grid-cols-[260px_minmax(0,1fr)] items-start">
      <LyricsProjectBar snap={snap} state={state} update={update} onSave={saveToProject} />
      <aside className="bg-logic-bg-panel border border-logic-border rounded-xl p-2 md:sticky md:top-0 md:max-h-[calc(100vh-104px)] md:overflow-y-auto logic-scroll">
        <div className="flex items-center gap-2 px-2 pt-1 pb-2">
          <p className="flex-1 text-xs font-semibold tracking-wider uppercase text-logic-text-dim">Músicas do show</p>
          <button onClick={() => loadAudio()} className="p-1 rounded text-logic-text-muted hover:text-logic-text transition-colors" title="Buscar áudios enviados pelo diretor">
            <RefreshCw size={13} className={audioState === 'loading' ? 'animate-spin' : ''} />
          </button>
        </div>
        {audioState === 'error' && <p className="px-2 pb-2 text-[11px] text-logic-lcd-red">Não foi possível buscar os áudios. Toque em atualizar.</p>}
        {audioState === 'ready' && songs.length > 0 && audioRefs.size < songs.length && (
          <p className="px-2 pb-2 text-[11px] text-logic-lcd-amber leading-relaxed">
            {audioRefs.size === 0 ? 'Nenhuma música com áudio ainda.' : `${audioRefs.size} de ${songs.length} músicas com áudio.`} O programa do diretor envia sozinho quando está aberto e parado. Esta lista se atualiza a cada 30 segundos.
          </p>
        )}
        {songs.length === 0 && <p className="px-2 pb-2 text-sm text-logic-text-dim">O diretor ainda não publicou a playlist do show.</p>}
        {songs.map((s, i) => {
          const pages = pagesOf(s.id);
          const timed = pages.filter((p) => p.time !== null).length;
          const sel = s.id === songId;
          const live = snap.show.live?.currentSongId === s.id;
          const hasAudio = audioRefs.has(s.id);
          return (
            <div
              key={s.id}
              role="button"
              tabIndex={0}
              onClick={() => { setSongId(s.id); setAutoPlayId(null); }}
              onKeyDown={(e) => { if (e.key === 'Enter') { setSongId(s.id); setAutoPlayId(null); } }}
              className={`group w-full flex items-center gap-2.5 px-2.5 py-2.5 rounded-lg text-left cursor-pointer transition-colors ${sel ? 'bg-logic-accent/15 text-logic-text' : 'text-logic-text-dim hover:bg-logic-bg-elevated'}`}
            >
              <button
                onClick={(e) => { e.stopPropagation(); setSongId(s.id); setAutoPlayId(s.id); }}
                disabled={!hasAudio}
                className="w-7 h-7 shrink-0 grid place-items-center rounded-full bg-logic-bg-elevated text-logic-accent hover:bg-logic-accent hover:text-white disabled:opacity-30 disabled:hover:bg-logic-bg-elevated disabled:hover:text-logic-accent transition-colors"
                title={hasAudio ? 'Ouvir esta música' : 'Aguardando áudio do diretor'}
                aria-label={`Ouvir ${s.name}`}
              >
                <Play size={12} className="ml-0.5" />
              </button>
              <span className="text-xs tabular-nums text-logic-text-muted w-5">{i + 1}</span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm truncate">{s.name}</span>
                <span className="block text-[11px] text-logic-text-muted truncate">
                  {hasAudio ? 'Áudio pronto' : 'Sem áudio ainda'} · {pages.length === 0 ? 'sem letra' : `${pages.length} páginas${timed === pages.length ? '' : `, ${pages.length - timed} sem tempo`}`}
                </span>
              </span>
              {live && <span className="w-2 h-2 rounded-full bg-logic-lcd-green animate-pulse" title="Tocando agora" />}
              {pages.length > 0 && timed === pages.length && !live && <Check size={14} className="text-logic-lcd-green" />}
            </div>
          );
        })}
      </aside>

      {song ? (
        <SongLyricsEditor
          key={song.id}
          song={song}
          cloudUrl={audioRefs.get(song.id)?.url ?? null}
          autoPlay={autoPlayId === song.id}
          pages={pagesOf(song.id)}
          setPages={(fn) => setPages(song.id, fn)}
          history={{
            canUndo: (history.current[song.id]?.past.length ?? 0) > 0,
            canRedo: (history.current[song.id]?.future.length ?? 0) > 0,
            undo: () => stepHistory(song.id, 'undo'),
            redo: () => stepHistory(song.id, 'redo'),
          }}
          status={status[song.id] ?? 'idle'}
          snap={liveSnap}
          sync={sync}
          now={now}
        />
      ) : (
        <div className="bg-logic-bg-panel border border-logic-border rounded-xl p-10 text-center text-logic-text-dim">
          <Music2 size={28} className="mx-auto mb-3 text-logic-text-muted" />
          Escolha uma música para escrever a letra.
        </div>
      )}
    </div>
  );
}
