import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Music2, Play, RefreshCw } from 'lucide-react';
import SongLyricsEditor, { markRefTimesOk, type SaveStatus } from '@/components/prompter/SongLyricsEditor';
import LyricsProjectBar from '@/components/prompter/LyricsProjectBar';
import { LyricStyleButton } from '@/components/prompter/LyricsStyleControls';
import LyricLeadControl from '@/components/prompter/LyricLeadControl';
import RepertoireRequest from '@/components/prompter/RepertoireRequest';
import type { LyricPage, PrompterSnapshot, PrompterState } from '@/lib/prompterTypes';
import { normalizePages } from '@/lib/prompterTypes';
import type { SetlistSong } from '@/lib/musicianTypes';
import { producerRequestLyricsSave, producerSaveLyrics } from '@/lib/prompterApi';
import { producerReferenceList, type ProducerReference } from '@/lib/prompterAudio';
import { buildPages, normalizeWords, refTimeMap, toSongWords, type RawSegment, type TimedWord } from '@/lib/lyricsAutoSync';

// Palavras da letra automática, por música: sobrevivem a recarregar a página neste aparelho.
const WORDS_LS = 'vs_lyrics_words:';

function readWords(songId: string): TimedWord[] {
  try {
    const raw = localStorage.getItem(WORDS_LS + songId);
    const v = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v.filter((w) => w && typeof w.w === 'string' && Number.isFinite(w.s) && Number.isFinite(w.e)) : [];
  } catch {
    return [];
  }
}

const SAVE_DEBOUNCE_MS = 800;
const AUDIO_REFRESH_MS = 30_000;
const HISTORY_COALESCE_MS = 700;
const HISTORY_LIMIT = 200;
// Uma consulta que saiu antes do nosso envio pode chegar depois dele, com a versão anterior
// (a mesma ideia do ECHO_GUARD_MS de usePrompterControl).
const REMOTE_GUARD_MS = 2500;
const KNOWN_LIMIT = 50;
const NO_PAGES: LyricPage[] = [];

const pagesSig = (ps: LyricPage[]) => JSON.stringify(normalizePages(ps));
/** Guarda uma versão que este aparelho usou de base ou enviou (para não confundir eco com mudança de outro aparelho). */
function remember(known: Record<string, Set<string>>, id: string, ps: LyricPage[]) {
  const k = (known[id] ??= new Set());
  k.add(pagesSig(ps));
  while (k.size > KNOWN_LIMIT) k.delete(k.values().next().value as string);
}

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
  const [words, setWords] = useState<Record<string, TimedWord[]>>({});
  const saveWords = (id: string, list: TimedWord[]) => {
    setWords((w) => ({ ...w, [id]: list }));
    try { localStorage.setItem(WORDS_LS + id, JSON.stringify(list)); } catch { /* sem espaço: fica só nesta aba */ }
  };

  const loadAudio = useCallback(async (quiet = false) => {
    if (!quiet) setAudioState('loading');
    try {
      const fresh = await producerReferenceList(code);
      // Link sempre novo: o assinado vence em 3 h e, na Rede Local, a chave muda a cada envio do
      // diretor. O player não reinicia, porque o editor só baixa de novo quando o áudio muda (updatedAt).
      setAudioRefs(fresh);
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

  // Cada consulta (1 s na nuvem, 250 ms na Rede Local) traz páginas novas. Reaproveita a página
  // que não mudou, para a lista do editor não redesenhar tudo a cada consulta.
  const stableLyrics = useRef(new Map<string, LyricPage[]>());
  const serverLyrics = useMemo(() => {
    const next = new Map<string, LyricPage[]>();
    for (const l of snap.lyrics) {
      const prev = stableLyrics.current.get(l.song_id) ?? NO_PAGES;
      const old = new Map(prev.map((p) => [p.id, p]));
      const pages = l.pages.map((p) => {
        const o = old.get(p.id);
        return o && o.time === p.time && o.text === p.text && o.kind === p.kind && o.color === p.color && o.size === p.size ? o : p;
      });
      next.set(l.song_id, pages.length === prev.length && pages.every((p, i) => p === prev[i]) ? prev : pages);
    }
    stableLyrics.current = next;
    return next;
  }, [snap.lyrics]);
  const serverPages = useCallback((id: string) => serverLyrics.get(id) ?? NO_PAGES, [serverLyrics]);
  const serverPagesRef = useRef(serverPages);
  serverPagesRef.current = serverPages;
  const pagesOf = useCallback((id: string) => drafts[id] ?? serverPages(id), [drafts, serverPages]);

  // Versões desta música que este aparelho usou de base ou enviou, e quando terminou o último envio.
  const known = useRef<Record<string, Set<string>>>({});
  const lastSavedAt = useRef<Record<string, number>>({});
  // Uma gravação por música de cada vez: o servidor grava sem versão, então a ordem sai daqui.
  // Cada ida leva a versão mais nova que estiver pendente quando ela sai.
  const saveQueue = useRef<Record<string, Promise<boolean>>>({});
  const save = useCallback((id: string): Promise<boolean> => {
    const send = async (): Promise<boolean> => {
      const pages = unsaved.current[id];
      if (!pages) return true; // a ida anterior já levou a versão mais nova
      remember(known.current, id, pages);
      try {
        await producerSaveLyrics(code, id, pages);
        lastSavedAt.current[id] = Date.now();
        // Só marca Salvo se nada mais novo entrou enquanto ia; senão a próxima ida cuida do selo.
        if (unsaved.current[id] === pages) {
          delete unsaved.current[id];
          setStatus((s) => ({ ...s, [id]: 'saved' }));
        }
        return true;
      } catch {
        if (unsaved.current[id] === pages) setStatus((s) => ({ ...s, [id]: 'error' }));
        return false;
      }
    };
    const next = (saveQueue.current[id] ?? Promise.resolve(true)).then(send, send);
    saveQueue.current[id] = next;
    return next;
  }, [code]);

  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;
  const history = useRef<Record<string, { past: LyricPage[][]; future: LyricPage[][]; lastAt: number }>>({});
  const [, setHistoryTick] = useState(0);

  const commit = useCallback((id: string, next: LyricPage[]) => {
    // primeira edição: a versão do servidor em que o rascunho se baseou
    if (!draftsRef.current[id]) remember(known.current, id, serverPagesRef.current(id));
    draftsRef.current = { ...draftsRef.current, [id]: next };
    setDrafts(draftsRef.current);
    window.clearTimeout(saveTimers.current[id]);
    unsaved.current[id] = next;
    saveTimers.current[id] = window.setTimeout(() => { void save(id); }, SAVE_DEBOUNCE_MS);
    setStatus((s) => ({ ...s, [id]: 'saving' }));
  }, [save]);

  const setPages = useCallback((id: string, fn: (p: LyricPage[]) => LyricPage[]) => {
    const cur = draftsRef.current[id] ?? serverPagesRef.current(id);
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
  }, [commit]);

  // A letra que o Mac do diretor leu entra sozinha nas músicas ainda sem letra, já com as marcações.
  // Música que já tem texto (correção do produtor) não é trocada: lá fica o botão "Letra automática".
  const autoFilled = useRef<Set<string>>(new Set());
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  useEffect(() => {
    const songIds = new Set(songs.map((s) => s.id));
    const hasText = (ps: LyricPage[]) => ps.some((pg) => pg.text.trim().length > 0);
    const todo = [...audioRefs].filter(([id, ref]) => ref.wordsUrl && songIds.has(id) && !autoFilled.current.has(id));
    for (const [id] of todo) autoFilled.current.add(id);
    void (async () => {
      for (const [id, ref] of todo) {
        if (hasText(draftsRef.current[id] ?? serverPages(id))) continue;
        try {
          const res = await fetch(ref.wordsUrl as string);
          if (!res.ok) throw new Error('fetch');
          const body = await res.json() as { segments?: RawSegment[] };
          const heard = normalizeWords(body.segments ?? []);
          // a Guia sai no BPM do show (e, no medley, só com as partes marcadas): as páginas
          // guardam o tempo da música, que é o do diretor e o da TV
          const song = songs.find((x) => x.id === id);
          const built = buildPages(song ? toSongWords(heard, refTimeMap(song)) : heard);
          // enquanto buscava, o produtor pode ter começado a escrever: aí não mexe
          if (!alive.current || built.length === 0 || hasText(draftsRef.current[id] ?? serverPages(id))) continue;
          setPages(id, () => built);
          saveWords(id, heard);
          markRefTimesOk(id);
        } catch {
          autoFilled.current.delete(id); // tenta de novo na próxima atualização da lista
        }
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioRefs, songs, serverPages, setPages]);

  // Outro aparelho do produtor (ou um assistente) mudou uma música que aqui tem rascunho: sem nada
  // por enviar, a tela passa a mostrar a versão do servidor, que é a da TV. Senão a próxima tecla
  // gravava a lista velha inteira por cima da correção do outro. Com envio pendente fica como
  // antes: vale quem gravar por último.
  // Última versão do servidor já conferida por música (as páginas que não mudam mantêm a mesma
  // lista): assim a conferência não refaz a comparação a cada consulta.
  const checkedRow = useRef<Record<string, LyricPage[]>>({});
  useEffect(() => {
    const ids = Object.keys(draftsRef.current);
    if (!ids.length) return;
    const t = Date.now();
    let next: Record<string, LyricPage[]> | null = null;
    for (const id of ids) {
      // envio na fila, indo ou com erro, ou consulta que ainda pode ser de antes do envio
      if (unsaved.current[id] || t - (lastSavedAt.current[id] ?? 0) < REMOTE_GUARD_MS) continue;
      const row = serverLyrics.get(id);
      if (!row || checkedRow.current[id] === row) continue;
      checkedRow.current[id] = row;
      const sig = pagesSig(row);
      // igual ao rascunho, ou uma versão antiga deste próprio aparelho
      if (sig === pagesSig(draftsRef.current[id]) || known.current[id]?.has(sig)) continue;
      next ??= { ...draftsRef.current };
      delete next[id];
      delete history.current[id]; // o Ctrl+Z não regrava a lista velha por cima
      delete known.current[id];
      delete checkedRow.current[id];
    }
    if (next) {
      draftsRef.current = next;
      setDrafts(next);
      setHistoryTick((n) => n + 1);
    }
  }, [serverLyrics]);

  const stepHistory = useCallback((id: string, dir: 'undo' | 'redo') => {
    const h = history.current[id];
    if (!h) return;
    const from = dir === 'undo' ? h.past : h.future;
    const to = dir === 'undo' ? h.future : h.past;
    const target = from.pop();
    if (!target) return;
    to.push(draftsRef.current[id] ?? serverPagesRef.current(id));
    h.lastAt = 0;
    commit(id, target);
    setHistoryTick((t) => t + 1);
  }, [commit]);

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
    const ids = Object.keys(unsaved.current);
    ids.forEach((id) => window.clearTimeout(saveTimers.current[id]));
    const results = await Promise.all(ids.map((id) => save(id)));
    if (results.includes(false)) throw new Error('save_failed');
    await producerRequestLyricsSave(code);
  }, [code, save]);

  const song = songs.find((s) => s.id === songId) ?? null;
  // Estável por música: com as linhas do editor em memo, uma função nova a cada consulta
  // redesenharia todas elas.
  const songKey = song?.id ?? null;
  const setSongPages = useCallback((fn: (p: LyricPage[]) => LyricPage[]) => {
    if (songKey) setPages(songKey, fn);
  }, [songKey, setPages]);
  const songWords = useMemo(() => (songId ? words[songId] ?? readWords(songId) : []), [words, songId]);
  const liveSnap = useMemo(() => ({ ...snap, prompter: state }), [snap, state]);

  const comLetra = songs.filter((s) => pagesOf(s.id).length > 0).length;

  // Tela larga: a aba ocupa a altura da janela, como um editor de vídeo. Cada área rola sozinha.
  return (
    <div className="flex flex-col gap-3 lg:h-full lg:min-h-0">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(220px,1fr)_minmax(0,2.2fr)_minmax(220px,1fr)] shrink-0">
        <RepertoireRequest code={code} semLetra={songs.length - comLetra} total={songs.length} />
        {/* Ajustes gerais (todas as músicas): ficam aqui em cima, fora das músicas e das páginas. */}
        <LyricLeadControl
          lead={state.lyricLead ?? 0}
          onLead={(v) => update((st) => ({ ...st, lyricLead: v }))}
          scale={state.fontScale}
          onScale={(v) => update((st) => ({ ...st, fontScale: v }))}
        >
          <LyricStyleButton state={state} update={update} />
        </LyricLeadControl>
        <LyricsProjectBar snap={snap} onSave={saveToProject} />
      </div>
    <div className="grid gap-3 md:grid-cols-[230px_minmax(0,1fr)] items-start lg:items-stretch lg:flex-1 lg:min-h-0">
      <aside className="console-face border-2 border-black rounded-lg p-2 md:sticky md:top-0 md:max-h-[calc(100vh-104px)] lg:static lg:max-h-none lg:h-full lg:min-h-0 md:overflow-y-auto logic-scroll shadow-lg">
        <div className="console-rail -mx-2 -mt-2 mb-2 px-3 h-8 rounded-t flex items-center gap-2 border-b-2 border-black">
          <p className="console-legend flex-1 text-logic-text">Músicas do show</p>
          <button onClick={() => loadAudio()} className="console-key flex items-center justify-center w-6 h-6" title="Buscar áudios enviados pelo diretor">
            <RefreshCw size={12} className={audioState === 'loading' ? 'animate-spin' : ''} />
          </button>
        </div>
        {audioState === 'error' && <p className="px-2 pb-2 text-[11px] text-logic-lcd-red">Não foi possível buscar os áudios. Toque em atualizar.</p>}
        {audioState === 'ready' && songs.length > 0 && audioRefs.size < songs.length && (
          <p className="px-2 pb-2 text-[11px] text-logic-lcd-amber leading-relaxed">
            {audioRefs.size === 0 ? 'Nenhuma música com áudio ainda.' : `${audioRefs.size} de ${songs.length} músicas com áudio.`} O áudio chega quando o diretor envia o repertório pelo programa. Esta lista se atualiza a cada 30 segundos.
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
              className={`group w-full flex items-center gap-2.5 px-2.5 py-2 rounded text-left cursor-pointer transition-colors border ${
                sel
                  ? 'bg-logic-lcd-amber/[0.10] border-logic-lcd-amber/50 text-logic-text'
                  : 'border-transparent text-logic-text-dim hover:bg-white/[0.04]'
              }`}
            >
              <button
                onClick={(e) => { e.stopPropagation(); setSongId(s.id); setAutoPlayId(s.id); }}
                disabled={!hasAudio}
                className={`console-key flex items-center justify-center w-7 h-7 shrink-0 rounded-full ${
                  hasAudio ? '' : 'opacity-40 cursor-not-allowed'
                }`}
                title={hasAudio ? 'Ouvir esta música' : 'Aguardando áudio do diretor'}
                aria-label={`Ouvir ${s.name}`}
              >
                <Play size={11} className="ml-0.5" />
              </button>
              <span className="font-stage text-[11px] tabular-nums w-5 text-logic-text-muted">{i + 1}</span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm truncate">{s.name}</span>
                <span className="console-legend block truncate !text-[10px]">
                  {hasAudio ? 'Áudio pronto' : 'Sem áudio ainda'} · {pages.length === 0 ? 'sem letra' : `${pages.length} páginas${timed === pages.length ? '' : `, ${pages.length - timed} sem tempo`}`}
                </span>
              </span>
              {live && <span className="console-led is-on-green animate-pulse shrink-0" title="Tocando agora" />}
              {pages.length > 0 && timed === pages.length && !live && <Check size={14} className="text-logic-lcd-green shrink-0" />}
            </div>
          );
        })}
      </aside>

      {song ? (
        <SongLyricsEditor
          key={song.id}
          wordsUrl={audioRefs.get(song.id)?.wordsUrl ?? null}
          song={song}
          words={songWords}
          onWords={(list) => saveWords(song.id, list)}
          cloudUrl={audioRefs.get(song.id)?.url ?? null}
          audioKey={audioRefs.get(song.id)?.updatedAt ?? null}
          autoPlay={autoPlayId === song.id}
          pages={pagesOf(song.id)}
          setPages={setSongPages}
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
        <div className="console-face border-2 border-black rounded-lg shadow-lg p-10 text-center text-logic-text-dim">
          <Music2 size={28} className="mx-auto mb-3 text-logic-text-muted" />
          Escolha uma música para escrever a letra.
        </div>
      )}
    </div>
    </div>
  );
}
