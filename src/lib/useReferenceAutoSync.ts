import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '@/store';
import {
  directorReferenceStatus, directorStartSend, directorTakeRepertoireRequest, encodeWav16, parseReferenceStatus,
  renderReference, uploadReferenceBlob, uploadSongWords, type ReferenceStatus,
} from '@/lib/prompterAudio';
import { renderLrMasterForSong } from '@/lib/bounceEngine';
import { localBridge, useNetworkMode, type LyricsReaderStatus } from '@/lib/localNetwork';
import type { SavedShow } from '@/lib/useLiveBroadcast';
import type { ProjectState, Song } from '@/types';

/**
 * Repertório para o produtor (aba Letras): o áudio de cada música, e a letra lida pelo Mac.
 *
 * Regras (iguais online e na rede local):
 * - Nada sobe sozinho: o diretor aperta "Enviar repertório".
 * - Enquanto o envio vale, música que muda (corte, BPM, tom) sobe de novo.
 * - O produtor salvou as letras: 10 minutos depois o áudio some (do Supabase ou do Mac).
 * - Para o produtor ouvir de novo, o diretor envia de novo. O pedido do produtor vira um aviso.
 * - O leitor de letra (no Mac, sem custo) lê as músicas que ainda não têm letra, uma por vez, e
 *   nunca enquanto o play está rodando.
 */

const IDLE_MS = 6000;
// De quanto em quanto tempo o programa confere o pedido do produtor e a situação do envio.
const POLL_MS = 20000;
const READER_POLL_MS = 4000;
const sigKey = (scope: string) => `prompter-ref-sigs:${scope}`;
const wordKey = (scope: string) => `prompter-word-sigs:${scope}`;

export type RepertoireMode = 'online' | 'local';

export interface ReferenceSync {
  /** Para onde vai o repertório (null: sem show online e sem rede local). */
  mode: RepertoireMode | null;
  /** Há um envio valendo: o áudio está (ou está indo) para o produtor. */
  active: boolean;
  ready: number;
  total: number;
  working: string | null;
  failed: string[];
  offline: boolean;
  /** O produtor salvou as letras: o áudio sai 10 minutos depois deste horário. */
  releasedAt: number | null;
  /** O áudio já saiu depois do "Salvar" do produtor. */
  cleared: boolean;
  /** Quando o produtor pediu o repertório (null = sem pedido). */
  requestedAt: number | null;
  /** Leitor de letra do Mac (null: programa sem o leitor, ou fora do app do Mac). */
  reader: LyricsReaderStatus | null;
  /** Músicas sem letra que já têm a letra lida, de quantas. */
  lyricsReady: number;
  lyricsTotal: number;
  /** Música que o leitor está lendo agora. */
  reading: string | null;
  lyricsFailed: string[];
  /** "Enviar repertório" (e "Enviar de novo"). */
  send: () => void;
  retry: () => void;
  /** Reenvia tudo, mesmo o que já subiu (ação manual do diretor). */
  resendAll: () => void;
  /** Fecha o aviso do pedido. */
  dismissRequest: () => void;
}

interface Backend {
  mode: RepertoireMode;
  scope: string;
  status: () => Promise<ReferenceStatus>;
  start: () => Promise<void>;
  putAudio: (songId: string, mp3: Blob) => Promise<void>;
  putWords: (songId: string, json: string) => Promise<void>;
  takeRequest: () => Promise<string | null>;
}

function cloudBackend(show: SavedShow): Backend {
  return {
    mode: 'online',
    scope: show.showId,
    status: () => directorReferenceStatus(show.showId, show.directorKey),
    start: () => directorStartSend(show.showId, show.directorKey),
    putAudio: (id, mp3) => uploadReferenceBlob(show.showId, show.directorKey, id, mp3),
    putWords: (id, json) => uploadSongWords(show.showId, show.directorKey, id, json),
    takeRequest: () => directorTakeRepertoireRequest(show.showId, show.directorKey),
  };
}

function localBackend(): Backend | null {
  const b = localBridge();
  if (!b?.refStatus || !b.refStart || !b.refPut || !b.refTakeRequest) return null;
  return {
    mode: 'local',
    scope: 'rede-local',
    status: async () => parseReferenceStatus(await b.refStatus!()),
    start: async () => { await b.refStart!(); },
    putAudio: async (id, mp3) => b.refPut!(id, 'audio', await mp3.arrayBuffer()),
    putWords: (id, json) => b.refPut!(id, 'words', json),
    takeRequest: () => b.refTakeRequest!(),
  };
}

function orderedSongs(st: Pick<ProjectState, 'songs' | 'playlistOrder'>): Song[] {
  const list = st.playlistOrder.map((id) => st.songs.find((s) => s.id === id)).filter((s): s is Song => !!s);
  return list.length ? list : st.songs;
}

// Tudo o que muda o som da mixagem LR: se mudar, a música é enviada de novo.
function soundSignature(song: Song, st: ProjectState): string {
  const clips = st.clips
    .filter((c) => c.songId === song.id)
    .map((c) => [c.id, c.trackId, c.startTime.toFixed(3), (c.trimEnd ?? 0).toFixed(3)].join(':'))
    .sort();
  const tracks = st.tracks.map((t) => [t.id, t.volume.toFixed(2), t.pan.toFixed(2), t.mute ? 1 : 0, t.parentId ?? ''].join(':'));
  return JSON.stringify([song.bpmAdjust || 0, song.tuner || 0, st.lrMasterActive, clips, tracks]);
}

function loadMap(key: string): Record<string, string> {
  try {
    const raw = localStorage.getItem(key);
    const obj = raw ? JSON.parse(raw) : null;
    return obj && typeof obj === 'object' ? obj : {};
  } catch { return {}; }
}

function saveMap(key: string, value: Record<string, string>) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* cheio */ }
}

const hasLyrics = (st: ProjectState, id: string) => (st.lyricMaps?.[id]?.length ?? 0) > 0;

export function useReferenceAutoSync(show: SavedShow | null): ReferenceSync {
  const songs = useStore((s) => s.songs);
  const clips = useStore((s) => s.clips);
  const tracks = useStore((s) => s.tracks);
  const playlistOrder = useStore((s) => s.playlistOrder);
  const lrMasterActive = useStore((s) => s.lrMasterActive);
  const lyricMaps = useStore((s) => s.lyricMaps);
  const isPlaying = useStore((s) => s.transport.isPlaying);
  const netMode = useNetworkMode();

  const backend = useMemo<Backend | null>(() => {
    if (netMode === 'local') return localBackend();
    return show ? cloudBackend(show) : null;
  }, [netMode, show]);

  const [sent, setSent] = useState<Set<string> | null>(null);
  const [words, setWords] = useState<Set<string>>(new Set());
  const [sigs, setSigs] = useState<Record<string, string>>({});
  const [wordSigs, setWordSigs] = useState<Record<string, string>>({});
  const [working, setWorking] = useState<string | null>(null);
  const [reading, setReading] = useState<string | null>(null);
  const [failedSigs, setFailedSigs] = useState<Record<string, string>>({});
  const [failedWords, setFailedWords] = useState<Record<string, string>>({});
  const [offline, setOffline] = useState(false);
  const [releasedAt, setReleasedAt] = useState<number | null>(null);
  const [requestedAt, setRequestedAt] = useState<number | null>(null);
  const [sendRequested, setSendRequested] = useState(false);
  const [reader, setReader] = useState<LyricsReaderStatus | null>(null);
  const [round, setRound] = useState(0);
  const running = useRef(false);
  const readingNow = useRef(false);

  const applyStatus = useCallback((st: ReferenceStatus) => {
    setSent(new Set(st.files.keys()));
    setWords(new Set(st.words.keys()));
    setReleasedAt(st.releasedAt && !st.requestedAt ? Date.parse(st.releasedAt) : null);
    if (st.releasedAt && !st.requestedAt) setSendRequested(false);
    setOffline(false);
  }, []);

  // Situação ao abrir (e a cada 20 s): o que já está com o produtor, se ele salvou, se pediu.
  useEffect(() => {
    setSent(null);
    setWords(new Set());
    setFailedSigs({});
    setFailedWords({});
    setReleasedAt(null);
    setRequestedAt(null);
    setSendRequested(false);
    if (!backend) return;
    setSigs(loadMap(sigKey(backend.scope)));
    setWordSigs(loadMap(wordKey(backend.scope)));
    let cancelled = false;
    const check = async () => {
      try {
        const at = await backend.takeRequest();
        if (!cancelled && at) setRequestedAt(Date.parse(at));
        const st = await backend.status();
        if (!cancelled) applyStatus(st);
      } catch {
        if (!cancelled) setOffline(true);
      }
    };
    void check();
    const id = window.setInterval(check, POLL_MS);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [backend, round, applyStatus]);

  const active = !!backend && releasedAt === null && ((sent?.size ?? 0) > 0 || sendRequested);

  // Leitor de letra: situação (e progresso do download do modelo) enquanto o envio vale.
  useEffect(() => {
    const desk = window.vsDesktop;
    if (!desk?.lyricsReaderStatus) { setReader(null); return; }
    let alive = true;
    const tick = () => desk.lyricsReaderStatus!().then((s) => { if (alive) setReader(s.supported ? s : null); }).catch(() => {});
    tick();
    if (!active) return () => { alive = false; };
    const id = window.setInterval(tick, READER_POLL_MS);
    return () => { alive = false; window.clearInterval(id); };
  }, [active]);

  // Play começou: a leitura em andamento para na hora (volta quando o programa ficar parado).
  useEffect(() => {
    if (isPlaying && readingNow.current) void window.vsDesktop?.lyricsTranscribeCancel?.().catch(() => {});
  }, [isPlaying]);

  // 1. Áudio de cada música (MP3 leve).
  useEffect(() => {
    if (!backend || !sent || !active || isPlaying || running.current || readingNow.current) return;
    const timer = window.setTimeout(async () => {
      const st = useStore.getState();
      const pending = orderedSongs(st).filter((s) => {
        const sig = soundSignature(s, st);
        return (!sent.has(s.id) || sigs[s.id] !== sig) && failedSigs[s.id] !== sig;
      });
      if (pending.length === 0) return;
      running.current = true;
      for (const song of pending) {
        const now = useStore.getState();
        if (now.transport.isPlaying) break;
        const fresh = now.songs.find((s) => s.id === song.id);
        if (!fresh) continue;
        const sig = soundSignature(fresh, now);
        setWorking(fresh.name);
        try {
          await backend.putAudio(fresh.id, await renderReference(fresh));
          setSent((prev) => new Set(prev ?? []).add(fresh.id));
          setSigs((prev) => {
            const next = { ...prev, [fresh.id]: sig };
            saveMap(sigKey(backend.scope), next);
            return next;
          });
          setFailedSigs((prev) => { const next = { ...prev }; delete next[fresh.id]; return next; });
        } catch {
          setFailedSigs((prev) => ({ ...prev, [fresh.id]: sig }));
        }
      }
      setWorking(null);
      running.current = false;
    }, IDLE_MS);
    return () => window.clearTimeout(timer);
  }, [backend, sent, sigs, failedSigs, isPlaying, songs, clips, tracks, playlistOrder, lrMasterActive, active]);

  // 2. Letra lida pelo Mac, só das músicas que ainda não têm letra (uma por vez, com o programa parado).
  useEffect(() => {
    const desk = window.vsDesktop;
    if (!backend || !sent || !active || isPlaying || running.current || readingNow.current || working) return;
    if (!desk?.lyricsTranscribe || !reader?.supported || reader.model.state !== 'ready') return;
    const timer = window.setTimeout(async () => {
      const st = useStore.getState();
      const next = orderedSongs(st).find((s) => {
        const sig = soundSignature(s, st);
        return sent.has(s.id) && sigs[s.id] === sig && !hasLyrics(st, s.id)
          && !(words.has(s.id) && wordSigs[s.id] === sig) && failedWords[s.id] !== sig;
      });
      if (!next) return;
      readingNow.current = true;
      const sig = soundSignature(next, st);
      setReading(next.name);
      try {
        const wav = encodeWav16(await renderLrMasterForSong(next, useStore.getState()));
        if (useStore.getState().transport.isPlaying) return;
        const res = await desk.lyricsTranscribe!(wav);
        if ('why' in res) {
          // Play começou ou o modelo ainda está baixando: tenta de novo depois, sem marcar erro.
          if (res.why !== 'canceled' && res.why !== 'model_missing' && res.why !== 'busy') {
            setFailedWords((prev) => ({ ...prev, [next.id]: sig }));
          }
          return;
        }
        await backend.putWords(next.id, JSON.stringify({ segments: res.segments }));
        setWords((prev) => new Set(prev).add(next.id));
        setWordSigs((prev) => {
          const m = { ...prev, [next.id]: sig };
          saveMap(wordKey(backend.scope), m);
          return m;
        });
      } catch {
        setFailedWords((prev) => ({ ...prev, [next.id]: sig }));
      } finally {
        readingNow.current = false;
        setReading(null);
      }
    }, IDLE_MS);
    return () => window.clearTimeout(timer);
  }, [backend, sent, sigs, words, wordSigs, failedWords, isPlaying, active, reader, working, lyricMaps, songs, clips, tracks]);

  const send = useCallback(() => {
    if (!backend) return;
    setSendRequested(true);
    setReleasedAt(null);
    setRequestedAt(null);
    setFailedSigs({});
    setFailedWords({});
    void window.vsDesktop?.lyricsReaderPrepare?.().then((s) => setReader(s.supported ? s : null)).catch(() => {});
    backend.start()
      .then(() => setRound((r) => r + 1))
      .catch(() => setOffline(true));
  }, [backend]);

  const retry = useCallback(() => {
    setFailedSigs({});
    setFailedWords({});
    setRound((r) => r + 1);
  }, []);

  const resendAll = useCallback(() => {
    if (!backend) return;
    try { localStorage.removeItem(sigKey(backend.scope)); localStorage.removeItem(wordKey(backend.scope)); } catch { /* ignore */ }
    setSigs({});
    setWordSigs({});
    send();
  }, [backend, send]);

  const dismissRequest = useCallback(() => setRequestedAt(null), []);

  const st = { songs, clips, tracks, playlistOrder, lrMasterActive, lyricMaps } as ProjectState;
  const list = orderedSongs(st);
  const ready = sent ? list.filter((s) => sent.has(s.id) && sigs[s.id] === soundSignature(s, st)).length : 0;
  const failed = list.filter((s) => failedSigs[s.id] !== undefined).map((s) => s.name);
  const needLyrics = list.filter((s) => !hasLyrics(st, s.id));
  const lyricsReady = needLyrics.filter((s) => words.has(s.id) && wordSigs[s.id] === soundSignature(s, st)).length;
  const lyricsFailed = needLyrics.filter((s) => failedWords[s.id] !== undefined).map((s) => s.name);

  return {
    mode: backend?.mode ?? null,
    active,
    ready,
    total: list.length,
    working,
    failed,
    offline,
    releasedAt,
    cleared: releasedAt !== null && (sent?.size ?? 0) === 0,
    requestedAt,
    reader,
    lyricsReady,
    lyricsTotal: needLyrics.length,
    reading,
    lyricsFailed,
    send,
    retry,
    resendAll,
    dismissRequest,
  };
}
