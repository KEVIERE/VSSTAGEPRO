import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '@/store';
import { snapshot } from '@/lib/useLiveBroadcast';
import {
  localBridge, setNetworkMode, useNetworkMode,
  type LocalInfo, type NetworkMode, type PinRole,
} from '@/lib/localNetwork';
import { friendlyError } from '@/lib/friendlyError';

const INFO_POLL_MS = 2000;
const HEARTBEAT_PLAYING_MS = 500;
const HEARTBEAT_IDLE_MS = 3000;

export interface LocalBroadcast {
  /** O app de Mac está rodando e pode criar a rede local. */
  available: boolean;
  mode: NetworkMode;
  info: LocalInfo | null;
  error: string | null;
  /** Letras que o produtor mandou salvar no projeto pela rede local. */
  lyricsReceived: number | null;
  dismissLyrics: () => void;
  setMode: (mode: NetworkMode) => void;
  regeneratePin: (role: PinRole) => Promise<void>;
  kick: (clientId: string) => Promise<void>;
}

function errMsg(e: unknown): string {
  return friendlyError(e, 'A rede local não respondeu.');
}

export function useLocalBroadcast(): LocalBroadcast {
  const bridge = localBridge();
  const mode = useNetworkMode();
  const [info, setInfo] = useState<LocalInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lyricsReceived, setLyricsReceived] = useState<number | null>(null);
  const appliedSaveAt = useRef<string | null>(null);
  const active = mode === 'local' && !!bridge;

  useEffect(() => {
    if (!bridge) return;
    if (!active) {
      bridge.stop().catch(() => {});
      setInfo(null);
      return;
    }
    let alive = true;
    bridge.start()
      .then((i) => { if (alive) { setInfo(i); setError(i.error); } })
      .catch((e) => { if (alive) setError(errMsg(e)); });
    return () => { alive = false; };
  }, [bridge, active]);

  useEffect(() => {
    if (!bridge || !active) return;
    let sending = false;
    let again = false;
    const publish = async () => {
      if (sending) { again = true; return; }
      sending = true;
      try {
        do {
          again = false;
          const snap = snapshot(true, true);
          await bridge.publish({ name: snap.name, setlist: snap.setlist, live: snap.live, lyrics: useStore.getState().lyricMaps });
        } while (again);
      } catch (e) {
        setError(errMsg(e));
      } finally {
        sending = false;
      }
    };

    publish();
    let prev = useStore.getState();
    const unsub = useStore.subscribe((s) => {
      const a = prev.transport;
      const b = s.transport;
      const changed =
        a.isPlaying !== b.isPlaying || a.isPaused !== b.isPaused || a.isStopped !== b.isStopped ||
        a.currentSongId !== b.currentSongId || a.nextSongId !== b.nextSongId || a.playFlow !== b.playFlow ||
        (!b.isPlaying && a.currentTime !== b.currentTime) ||
        s.songs !== prev.songs || s.blocks !== prev.blocks || s.playlistOrder !== prev.playlistOrder ||
        s.lyricMaps !== prev.lyricMaps || s.activeShowId !== prev.activeShowId || s.shows !== prev.shows;
      prev = s;
      if (changed) publish();
    });

    let last = Date.now();
    const beat = window.setInterval(() => {
      const every = useStore.getState().transport.isPlaying ? HEARTBEAT_PLAYING_MS : HEARTBEAT_IDLE_MS;
      if (Date.now() - last >= every - 50) { last = Date.now(); publish(); }
    }, 200);

    return () => { unsub(); window.clearInterval(beat); };
  }, [bridge, active]);

  useEffect(() => {
    if (!bridge || !active) return;
    let alive = true;
    const tick = async () => {
      try {
        const i = await bridge.getInfo();
        if (!alive) return;
        setInfo(i);
        setError(i.error);
        const req = i.lyricsSaveRequestedAt;
        if (req && req !== appliedSaveAt.current) {
          appliedSaveAt.current = req;
          const st = useStore.getState();
          const songIds = new Set(st.songs.map((s) => s.id));
          const next = { ...st.lyricMaps };
          for (const [id, pages] of Object.entries(i.lyrics)) {
            if (!songIds.has(id)) continue;
            if (pages.length > 0) next[id] = pages; else delete next[id];
          }
          st.setLyricMaps(next);
          await bridge.ackLyricsSave();
          setLyricsReceived(Object.keys(next).length);
        }
      } catch (e) {
        if (alive) setError(errMsg(e));
      }
    };
    tick();
    const id = window.setInterval(tick, INFO_POLL_MS);
    return () => { alive = false; window.clearInterval(id); };
  }, [bridge, active]);

  const setMode = useCallback((m: NetworkMode) => {
    if (m === 'local' && !localBridge()) return;
    setNetworkMode(m);
  }, []);

  const regeneratePin = useCallback(async (role: PinRole) => {
    if (!bridge) return;
    try { setInfo(await bridge.regeneratePin(role)); } catch (e) { setError(errMsg(e)); }
  }, [bridge]);

  const kick = useCallback(async (clientId: string) => {
    if (!bridge) return;
    try { await bridge.kick(clientId); setInfo(await bridge.getInfo()); } catch (e) { setError(errMsg(e)); }
  }, [bridge]);

  const dismissLyrics = useCallback(() => setLyricsReceived(null), []);

  return { available: !!bridge, mode, info, error, lyricsReceived, dismissLyrics, setMode, regeneratePin, kick };
}
