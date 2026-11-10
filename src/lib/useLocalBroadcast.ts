import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '@/store';
import { snapshot } from '@/lib/useLiveBroadcast';
import { buildRemoteState, remoteSignature, startRemoteMeterFeed } from '@/lib/remoteHost';
import { subscribeShowClock } from '@/lib/showClock';
import {
  localBridge, setNetworkMode, useNetworkMode,
  type LocalInfo, type NetworkMode, type PinRole,
} from '@/lib/localNetwork';
import { friendlyError } from '@/lib/friendlyError';

const INFO_POLL_MS = 2000;
const HEARTBEAT_PLAYING_MS = 500;
const HEARTBEAT_IDLE_MS = 3000;
const REMOTE_METERS_MS = 80;

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
  // há celular com o VS Stage Remote conectado (só então os medidores vão para a rede)
  const remotePhones = useRef(false);
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
          await bridge.publish({ name: snap.name, setlist: snap.setlist, live: snap.live, lyrics: useStore.getState().lyricMaps, remote: buildRemoteState() });
        } while (again);
      } catch (e) {
        setError(errMsg(e));
      } finally {
        sending = false;
      }
    };

    publish();
    let prev = useStore.getState();
    let prevRemote = remoteSignature(prev);
    let cursorTimer: number | null = null;
    // cronômetro "Falta no show" mexido (no Mac ou pelo Remote)
    const unsubClock = subscribeShowClock(() => publish());
    const unsub = useStore.subscribe((s) => {
      const a = prev.transport;
      const b = s.transport;
      const cursorMovedWhileStopped = !b.isPlaying && a.currentTime !== b.currentTime;
      const immediate =
        a.isPlaying !== b.isPlaying || a.isPaused !== b.isPaused || a.isStopped !== b.isStopped ||
        a.currentSongId !== b.currentSongId || a.nextSongId !== b.nextSongId || a.playFlow !== b.playFlow ||
        s.songs !== prev.songs || s.blocks !== prev.blocks || s.playlistOrder !== prev.playlistOrder ||
        s.lyricMaps !== prev.lyricMaps || s.activeShowId !== prev.activeShowId || s.shows !== prev.shows ||
        s.playlist !== prev.playlist;
      prev = s;
      const remote = remoteSignature(s);
      const remoteChanged = remote !== prevRemote;
      prevRemote = remote;
      if (immediate || remoteChanged) {
        if (cursorTimer !== null) { window.clearTimeout(cursorTimer); cursorTimer = null; }
        publish();
      } else if (cursorMovedWhileStopped) {
        // Scrub na timeline com o som parado: debounda o envio para a rede local em 120ms
        // para não disparar dezenas de mensagens pesadas com IPC por segundo enquanto o usuário arrasta o cursor.
        if (cursorTimer !== null) window.clearTimeout(cursorTimer);
        cursorTimer = window.setTimeout(() => {
          cursorTimer = null;
          publish();
        }, 120);
      }
    });

    let last = Date.now();
    const beat = window.setInterval(() => {
      const every = useStore.getState().transport.isPlaying ? HEARTBEAT_PLAYING_MS : HEARTBEAT_IDLE_MS;
      if (Date.now() - last >= every - 50) { last = Date.now(); publish(); }
    }, 200);

    return () => {
      unsub();
      unsubClock();
      if (cursorTimer !== null) window.clearTimeout(cursorTimer);
      window.clearInterval(beat);
    };
  }, [bridge, active]);

  useEffect(() => {
    if (!bridge || !active) return;
    let alive = true;
    const tick = async () => {
      try {
        const i = await bridge.getInfo();
        if (!alive) return;
        remotePhones.current = i.clients.some((c) => c.role === 'remote');
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

  // Medidores dos faders para a aba Mixer do VS Stage Remote: ~12 por segundo
  useEffect(() => {
    if (!bridge?.publishMeters || !active) return;
    return startRemoteMeterFeed((m) => bridge.publishMeters?.(m), {
      intervalMs: REMOTE_METERS_MS,
      enabled: () => remotePhones.current,
    });
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
