import { useState, useEffect, useCallback, useRef } from 'react';
import { useStore } from '@/store';
import { audioEngine } from '@/lib/audioEngine';
import { directorPublish, buildSetlist, buildLive, effectiveBpm } from '@/lib/musicianApi';
import { currentAndNextSlice, paramsAt } from '@/lib/medley';
import { activeShowName } from '@/lib/shows';
import { friendlyError } from '@/lib/friendlyError';

const SHOW_LS = 'vs_stage_show';
const ON_AIR_LS = 'vs_stage_on_air';
const HEARTBEAT_PLAYING_MS = 1000;
const HEARTBEAT_IDLE_MS = 5000;
const SETLIST_DEBOUNCE_MS = 300;

export interface SavedShow {
  showId: string;
  directorKey: string;
}

export interface LiveBroadcast {
  show: SavedShow | null;
  setShow: (s: SavedShow) => void;
  onAir: boolean;
  lastSentAt: number | null;
  error: string | null;
  /** Nome do show ativo (ou Show Padrão), enviado automaticamente. */
  showName: string;
  /** Outra aba deste computador assumiu a transmissão do show. */
  yielded: boolean;
  takeOver: () => void;
  resendSetlist: () => void;
  start: () => void;
  stop: () => Promise<void>;
}

const TAB_ID = Math.random().toString(36).slice(2);
const TAB_CHANNEL = 'vs_stage_broadcast';

function loadShow(): SavedShow | null {
  try {
    const raw = localStorage.getItem(SHOW_LS);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    return obj?.showId && obj?.directorKey ? (obj as SavedShow) : null;
  } catch { return null; }
}

export function snapshot(onAir: boolean, withSetlist: boolean) {
  const st = useStore.getState();
  const t = st.transport;
  const song = t.currentSongId ? st.songs.find((s) => s.id === t.currentSongId) : null;
  // O relógio do áudio é exato; o da tela pode estar até 200ms atrasado e fazer a barra dos músicos voltar.
  const exact = t.isPlaying && audioEngine.isRunning() && !audioEngine.isUserSeeking();
  const currentTime = exact ? audioEngine.getCurrentTime() : t.currentTime;
  const progress = exact && song?.duration ? Math.min(1, currentTime / song.duration) : t.songProgress;
  const countdown = exact && song && t.nextSongId ? Math.max(0, song.duration - currentTime) : t.nextSongCountdown;
  const name = activeShowName(st);
  const slices = t.isPlaying || t.isPaused ? currentAndNextSlice(song ?? undefined, currentTime) : { current: null, next: null };
  const bpmAdjust = song ? paramsAt(song, currentTime).bpmAdjust : 0;
  return {
    name,
    // Um projeto vazio (aba nova ainda carregando) nunca apaga o repertório já enviado.
    setlist: withSetlist && st.songs.length > 0 ? buildSetlist(st.songs, st.blocks, st.playlistOrder) : null,
    live: buildLive(
      t.isPlaying, t.isPaused, currentTime, progress, countdown,
      t.currentSongId, t.nextSongId, song ? effectiveBpm(song.bpm, song.bpmDetected, bpmAdjust) : null,
      t.playFlow, onAir, slices.current?.name ?? null, slices.next?.name ?? null,
    ),
  };
}

export function useLiveBroadcast(): LiveBroadcast {
  const [show, setShowState] = useState<SavedShow | null>(loadShow);
  const [onAir, setOnAir] = useState(() => !!loadShow() && localStorage.getItem(ON_AIR_LS) === '1');
  const [lastSentAt, setLastSentAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const showName = useStore(activeShowName);

  const inFlight = useRef(false);
  const pending = useRef(false);
  const setlistDirty = useRef(true);
  const onAirRef = useRef(onAir);
  const [yielded, setYielded] = useState(false);
  const channelRef = useRef<BroadcastChannel | null>(null);

  const claim = useCallback(() => {
    setYielded(false);
    channelRef.current?.postMessage({ type: 'claim', tab: TAB_ID });
  }, []);

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const ch = new BroadcastChannel(TAB_CHANNEL);
    channelRef.current = ch;
    ch.onmessage = (ev) => {
      const msg = ev.data as { type?: string; tab?: string };
      if (msg?.type === 'claim' && msg.tab !== TAB_ID) setYielded(true);
    };
    return () => { ch.close(); channelRef.current = null; };
  }, []);

  useEffect(() => {
    if (!yielded) return;
    return useStore.subscribe((s, p) => {
      if (s.transport.isPlaying && !p.transport.isPlaying) claim();
    });
  }, [yielded, claim]);

  const setShow = useCallback((s: SavedShow) => {
    localStorage.setItem(SHOW_LS, JSON.stringify(s));
    setShowState(s);
  }, []);

  const send = useCallback(async (target: SavedShow) => {
    if (inFlight.current) { pending.current = true; return; }
    inFlight.current = true;
    try {
      do {
        pending.current = false;
        const withSetlist = setlistDirty.current;
        setlistDirty.current = false;
        const snap = snapshot(onAirRef.current, withSetlist);
        try {
          await directorPublish(target.showId, target.directorKey, snap.name, snap.setlist, snap.live);
          setLastSentAt(Date.now());
          setError(null);
        } catch (e) {
          if (withSetlist) setlistDirty.current = true;
          setError(friendlyError(e, 'Falha ao enviar.'));
        }
      } while (pending.current);
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    if (!show || !onAir || yielded) return;
    if (useStore.getState().songs.length > 0) claim();
    setlistDirty.current = true;
    send(show);

    let prev = useStore.getState();
    let setlistTimer: number | null = null;
    const unsub = useStore.subscribe((state) => {
      const a = prev.transport;
      const b = state.transport;
      const transportChanged =
        a.isPlaying !== b.isPlaying || a.isPaused !== b.isPaused || a.isStopped !== b.isStopped ||
        a.currentSongId !== b.currentSongId || a.nextSongId !== b.nextSongId || a.playFlow !== b.playFlow ||
        (!b.isPlaying && a.currentTime !== b.currentTime);
      const setlistChanged =
        state.songs !== prev.songs || state.blocks !== prev.blocks ||
        state.playlistOrder !== prev.playlistOrder || state.projectName !== prev.projectName ||
        state.activeShowId !== prev.activeShowId || state.shows !== prev.shows;
      prev = state;
      if (b.isPlaying && !a.isPlaying) claim();
      if (transportChanged) send(show);
      if (setlistChanged) {
        setlistDirty.current = true;
        if (setlistTimer !== null) window.clearTimeout(setlistTimer);
        setlistTimer = window.setTimeout(() => send(show), SETLIST_DEBOUNCE_MS);
      }
    });

    let lastBeat = Date.now();
    const beat = window.setInterval(() => {
      const playing = useStore.getState().transport.isPlaying;
      const every = playing ? HEARTBEAT_PLAYING_MS : HEARTBEAT_IDLE_MS;
      if (Date.now() - lastBeat >= every - 50) {
        lastBeat = Date.now();
        send(show);
      }
    }, 250);

    return () => {
      unsub();
      window.clearInterval(beat);
      if (setlistTimer !== null) window.clearTimeout(setlistTimer);
    };
  }, [show, onAir, yielded, send, claim]);

  const resendSetlist = useCallback(() => {
    if (!show) return;
    setlistDirty.current = true;
    send(show);
  }, [show, send]);

  const start = useCallback(() => {
    if (!show) return;
    localStorage.setItem(ON_AIR_LS, '1');
    onAirRef.current = true;
    setOnAir(true);
  }, [show]);

  const stop = useCallback(async () => {
    localStorage.setItem(ON_AIR_LS, '0');
    onAirRef.current = false;
    setOnAir(false);
    if (show) await send(show);
  }, [show, send]);

  return { show, setShow, onAir, lastSentAt, error, showName, yielded, takeOver: claim, resendSetlist, start, stop };
}
