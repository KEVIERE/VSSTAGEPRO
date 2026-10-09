import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '@/store';
import { directorReferenceStatus, uploadSongReference } from '@/lib/prompterAudio';
import type { SavedShow } from '@/lib/useLiveBroadcast';
import type { ProjectState, Song } from '@/types';

const IDLE_MS = 6000;
const sigKey = (showId: string) => `prompter-ref-sigs:${showId}`;

export interface ReferenceSync {
  ready: number;
  total: number;
  working: string | null;
  failed: string[];
  offline: boolean;
  retry: () => void;
  resendAll: () => void;
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
  const [round, setRound] = useState(0);
  const running = useRef(false);

  useEffect(() => {
    setSent(null);
    setFailedSigs({});
    if (!show) return;
    setSigs(loadSigs(show.showId));
    let cancelled = false;
    directorReferenceStatus(show.showId, show.directorKey)
      .then((m) => { if (!cancelled) { setSent(new Set(m.keys())); setOffline(false); } })
      .catch(() => { if (!cancelled) setOffline(true); });
    return () => { cancelled = true; };
  }, [show, round]);

  useEffect(() => {
    if (!show || !sent || isPlaying || running.current) return;
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
      setWorking(null);
      running.current = false;
    }, IDLE_MS);
    return () => window.clearTimeout(timer);
  }, [show, sent, sigs, failedSigs, isPlaying, songs, clips, tracks, playlistOrder, lrMasterActive]);

  const retry = useCallback(() => {
    setFailedSigs({});
    setRound((r) => r + 1);
  }, []);

  const resendAll = useCallback(() => {
    if (!show) return;
    try { localStorage.removeItem(sigKey(show.showId)); } catch { /* ignore */ }
    setSigs({});
    setFailedSigs({});
  }, [show]);

  const st = { songs, clips, tracks, playlistOrder, lrMasterActive } as ProjectState;
  const list = orderedSongs(st);
  const ready = sent ? list.filter((s) => sent.has(s.id) && sigs[s.id] === soundSignature(s, st)).length : 0;
  const failed = list.filter((s) => failedSigs[s.id] !== undefined).map((s) => s.name);

  return { ready, total: list.length, working, failed, offline, retry, resendAll };
}
