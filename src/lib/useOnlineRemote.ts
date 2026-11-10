import { useEffect } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useStore } from '@/store';
import { buildRemoteState, applyRemoteCommand, remoteSignature, startRemoteMeterFeed } from '@/lib/remoteHost';
import { subscribeShowClock } from '@/lib/showClock';
import { remoteChannelName, setOnlineRemotePhones, useOnlineRemoteConfig } from '@/lib/onlineRemote';

const PLAYING_MS = 1000;
const IDLE_MS = 3000;
const MIN_GAP_MS = 120;
const METERS_MS = 160;
const METERS_HOLD_MS = 5000;

/**
 * VS Stage Remote pelo Show Online, lado do Mac: entra no canal da chave, manda o estado do
 * Modo Show enquanto houver celular conectado e executa os comandos que chegam.
 * `enabled` falso (modo Rede Local, ou outra aba transmitindo) desliga tudo.
 */
export function useOnlineRemote(enabled: boolean): void {
  const config = useOnlineRemoteConfig();
  const key = enabled && config?.on ? config.key : null;

  useEffect(() => {
    setOnlineRemotePhones(0);
    if (!key) return;
    let alive = true;
    let listeners = 0;
    let lastSent = 0;
    let timer: number | null = null;
    let metersUntil = 0;
    const channel = supabase.channel(remoteChannelName(key), { config: { broadcast: { self: false } } });

    const send = () => {
      if (!alive) return;
      timer = null;
      lastSent = Date.now();
      channel.send({ type: 'broadcast', event: 'state', payload: buildRemoteState() }).catch(() => {});
    };
    // junta mudanças seguidas (fader arrastado, cursor) num envio a cada 120 ms
    const sendSoon = () => {
      if (!alive || listeners === 0 || timer !== null) return;
      const wait = Math.max(0, MIN_GAP_MS - (Date.now() - lastSent));
      timer = window.setTimeout(send, wait);
    };

    channel
      .on('broadcast', { event: 'cmd' }, ({ payload }) => {
        applyRemoteCommand(payload);
        sendSoon();
      })
      // aba Mixer aberta num celular: pede os medidores e renova o pedido a cada 2 s
      .on('broadcast', { event: 'meters-on' }, () => {
        metersUntil = Date.now() + METERS_HOLD_MS;
      })
      .on('broadcast', { event: 'hello' }, () => {
        listeners = Math.max(listeners, 1);
        sendSoon();
      })
      .on('presence', { event: 'sync' }, () => {
        listeners = Object.keys(channel.presenceState()).length;
        if (alive) setOnlineRemotePhones(listeners);
        sendSoon();
      })
      .subscribe();

    let prev = useStore.getState();
    let prevSig = remoteSignature(prev);
    const unsub = useStore.subscribe((s) => {
      const a = prev.transport;
      const b = s.transport;
      const changed =
        a.isPlaying !== b.isPlaying || a.isPaused !== b.isPaused || a.isStopped !== b.isStopped ||
        a.currentSongId !== b.currentSongId || a.nextSongId !== b.nextSongId || a.playFlow !== b.playFlow ||
        (!b.isPlaying && a.currentTime !== b.currentTime) ||
        s.songs !== prev.songs || s.blocks !== prev.blocks || s.playlist !== prev.playlist ||
        s.activeShowId !== prev.activeShowId || s.shows !== prev.shows || s.songKeys !== prev.songKeys;
      prev = s;
      const sig = remoteSignature(s);
      const sigChanged = sig !== prevSig;
      prevSig = sig;
      if (changed || sigChanged) sendSoon();
    });
    const unsubClock = subscribeShowClock(sendSoon);
    // medidores dos faders: mais devagar que na rede local, para poupar a cota de mensagens
    const stopMeters = startRemoteMeterFeed(
      (m) => { channel.send({ type: 'broadcast', event: 'meters', payload: m }).catch(() => {}); },
      { intervalMs: METERS_MS, enabled: () => alive && Date.now() < metersUntil },
    );

    const beat = window.setInterval(() => {
      if (listeners === 0) return;
      const every = useStore.getState().transport.isPlaying ? PLAYING_MS : IDLE_MS;
      if (Date.now() - lastSent >= every - 50) sendSoon();
    }, 250);

    return () => {
      alive = false;
      unsub();
      unsubClock();
      stopMeters();
      window.clearInterval(beat);
      if (timer !== null) window.clearTimeout(timer);
      supabase.removeChannel(channel);
      setOnlineRemotePhones(0);
    };
  }, [key]);
}
