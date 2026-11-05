import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '@/store';
import { directorReferenceStatus, directorTakeRepertoireRequest, uploadSongReference } from '@/lib/prompterAudio';
import type { SavedShow } from '@/lib/useLiveBroadcast';
import type { ProjectState, Song } from '@/types';

const IDLE_MS = 6000;
// De quanto em quanto tempo o programa pergunta se o produtor pediu o repertório de novo.
const REQUEST_POLL_MS = 20000;
const sigKey = (showId: string) => `prompter-ref-sigs:${showId}`;
// Músicas que o produtor já terminou (têm letra no show). Só elas ficam de fora do envio de um
// pedido novo, que é o combinado: o pedido manda só o que ainda falta letra.
const LYRICS_DONE_LS = (showId: string) => `prompter-lyrics-done:${showId}`;

export interface ReferenceSync {
  ready: number;
  total: number;
  working: string | null;
  failed: string[];
  offline: boolean;
  /** O produtor salvou as letras: o áudio já cumpriu o papel e não deve ser reenviado. */
  released: boolean;
  /** Quando o produtor pediu o repertório de novo (null = sem pedido). */
  requestedAt: number | null;
  retry: () => void;
  /** Reenvia tudo, inclusive o que já foi liberado (ação manual do diretor). */
  resendAll: () => void;
  /** Reenvia só o que ainda não tem letra (usado no pedido do produtor). */
  resendMissing: (doneSongIds: string[]) => void;
  /** Fecha o aviso do pedido. */
  dismissRequest: () => void;
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

function loadSigs(showId: string): Record<string, string> {
  try {
    const raw = localStorage.getItem(sigKey(showId));
    const obj = raw ? JSON.parse(raw) : null;
    return obj && typeof obj === 'object' ? obj : {};
  } catch { return {}; }
}

function loadDoneLyrics(showId: string): string[] {
  try {
    const raw = localStorage.getItem(LYRICS_DONE_LS(showId));
    const arr = raw ? JSON.parse(raw) : null;
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : [];
  } catch { return []; }
}

function saveDoneLyrics(showId: string, ids: string[]): void {
  try { localStorage.setItem(LYRICS_DONE_LS(showId), JSON.stringify(ids)); } catch { /* cheio */ }
}

/** Mantém no show online uma versão leve de cada música do projeto, para o produtor ouvir na aba Letras. */
export function useReferenceAutoSync(show: SavedShow | null): ReferenceSync {
  const songs = useStore((s) => s.songs);
  const clips = useStore((s) => s.clips);
  const tracks = useStore((s) => s.tracks);
  const playlistOrder = useStore((s) => s.playlistOrder);
  const lrMasterActive = useStore((s) => s.lrMasterActive);
  const isPlaying = useStore((s) => s.transport.isPlaying);

  const [sent, setSent] = useState<Set<string> | null>(null);
  const [sigs, setSigs] = useState<Record<string, string>>({});
  const [working, setWorking] = useState<string | null>(null);
  const [failedSigs, setFailedSigs] = useState<Record<string, string>>({});
  const [offline, setOffline] = useState(false);
  const [released, setReleased] = useState(false);
  const [requestedAt, setRequestedAt] = useState<number | null>(null);
  const [round, setRound] = useState(0);
  const running = useRef(false);
  // Músicas que devem ficar de fora do próximo envio (as que já têm letra, num pedido novo).
  const skipNext = useRef<Set<string> | null>(null);

  const applyStatus = useCallback((st: Awaited<ReturnType<typeof directorReferenceStatus>>) => {
    setSent(new Set(st.files.keys()));
    setReleased(!!st.releasedAt && !st.requestedAt);
    setRequestedAt(st.requestedAt ? Date.parse(st.requestedAt) : null);
    setOffline(false);
  }, []);

  useEffect(() => {
    setSent(null);
    setFailedSigs({});
    setReleased(false);
    setRequestedAt(null);
    if (!show) return;
    setSigs(loadSigs(show.showId));
    let cancelled = false;
    directorReferenceStatus(show.showId, show.directorKey)
      .then((st) => { if (!cancelled) applyStatus(st); })
      .catch(() => { if (!cancelled) setOffline(true); });
    return () => { cancelled = true; };
  }, [show, round, applyStatus]);

  // O produtor pede o repertório de novo: o programa percebe sozinho e envia o que ainda falta
  // letra, sem ninguém precisar clicar. O pedido é consumido uma vez só.
  useEffect(() => {
    if (!show) return;
    let cancelled = false;
    const check = async () => {
      try {
        const at = await directorTakeRepertoireRequest(show.showId, show.directorKey);
        if (cancelled || !at) return;
        const done = loadDoneLyrics(show.showId);
        skipNext.current = new Set(done);
        setReleased(false);
        setRequestedAt(Date.parse(at));
        setSigs({});
        setFailedSigs({});
        setRound((r) => r + 1);
      } catch { /* sem conexão: tenta no próximo ciclo */ }
    };
    const id = window.setInterval(check, REQUEST_POLL_MS);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [show]);

  useEffect(() => {
    if (!show || !sent || isPlaying || running.current) return;
    // Áudio liberado: o produtor já salvou as letras e não precisa mais ouvir. Só um pedido
    // novo (que limpa `released`) volta a enviar. Antes, reabrir o programa subia tudo de novo.
    if (released) return;
    const timer = window.setTimeout(async () => {
      const st = useStore.getState();
      const skip = skipNext.current;
      const pending = orderedSongs(st).filter((s) => {
        const sig = soundSignature(s, st);
        if (skip && skip.has(s.id)) return false;
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
          await uploadSongReference(show.showId, show.directorKey, fresh);
          setSent((prev) => new Set(prev ?? []).add(fresh.id));
          setSigs((prev) => {
            const next = { ...prev, [fresh.id]: sig };
            try { localStorage.setItem(sigKey(show.showId), JSON.stringify(next)); } catch { /* cheio */ }
            return next;
          });
          setFailedSigs((prev) => { const next = { ...prev }; delete next[fresh.id]; return next; });
        } catch {
          setFailedSigs((prev) => ({ ...prev, [fresh.id]: sig }));
        }
      }
      skipNext.current = null;
      setWorking(null);
      running.current = false;
    }, IDLE_MS);
    return () => window.clearTimeout(timer);
  }, [show, sent, sigs, failedSigs, isPlaying, songs, clips, tracks, playlistOrder, lrMasterActive, released]);

  const retry = useCallback(() => {
    setFailedSigs({});
    setRound((r) => r + 1);
  }, []);

  const resendAll = useCallback(() => {
    if (!show) return;
    try { localStorage.removeItem(sigKey(show.showId)); } catch { /* ignore */ }
    skipNext.current = null;
    setReleased(false);
    setSigs({});
    setFailedSigs({});
  }, [show]);

  const resendMissing = useCallback((doneSongIds: string[]) => {
    if (!show) return;
    saveDoneLyrics(show.showId, doneSongIds);
    skipNext.current = new Set(doneSongIds);
    setReleased(false);
    setFailedSigs({});
  }, [show]);

  const dismissRequest = useCallback(() => setRequestedAt(null), []);

  const st = { songs, clips, tracks, playlistOrder, lrMasterActive } as ProjectState;
  const list = orderedSongs(st);
  const ready = sent ? list.filter((s) => sent.has(s.id) && sigs[s.id] === soundSignature(s, st)).length : 0;
  const failed = list.filter((s) => failedSigs[s.id] !== undefined).map((s) => s.name);

  return { ready, total: list.length, working, failed, offline, released, requestedAt, retry, resendAll, resendMissing, dismissRequest };
}
