import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { isLocalClient, takePinFromLink } from '@/lib/localNetwork';
import { localForget, localRemoteCommand, localRemoteMeters, localRemoteState } from '@/lib/localClientApi';
import { remoteChannelName, remoteKeyFromLink } from '@/lib/onlineRemote';
import { isRemoteMeters, isRemoteState, type RemoteCommand, type RemoteMeters, type RemoteState } from '@/lib/remoteProtocol';

/** Como o celular está ligado ao Mac agora. */
export type LinkStatus =
  | 'connecting'
  /** Rede Local: falta (ou errou) o PIN do Remote */
  | 'pin'
  | 'live'
  /** parou de chegar estado do Mac (programa fechado, Wi-Fi caiu) */
  | 'lost'
  /** abriu /show sem o link do Mac */
  | 'nolink';

export interface RemoteLink {
  via: 'local' | 'online';
  status: LinkStatus;
  state: RemoteState | null;
  /** relógio do Mac estimado neste celular */
  macNow: () => number;
  send: (cmd: RemoteCommand) => void;
  submitPin: (pin: string) => void;
  pinError: string | null;
  /** Medidores dos faders: chama `cb` a cada pacote enquanto estiver ligado (aba Mixer aberta). */
  watchMeters: (cb: (m: RemoteMeters) => void) => () => void;
}

const POLL_MS = 300;
/** Rede Local: medidores buscados ~11 vezes por segundo, só com a aba Mixer aberta */
const METERS_POLL_MS = 90;
/** Show Online: o pedido de medidores é renovado a cada 2 s (o Mac para sozinho depois de 5 s) */
const METERS_ASK_MS = 2000;
const LOST_MS = 6000;
const PIN_SS = 'vs_remote_pin';

function haptic() {
  try { navigator.vibrate?.(20); } catch { /* sem vibração */ }
}

export function useRemoteLink(): RemoteLink {
  const via: 'local' | 'online' = isLocalClient() ? 'local' : 'online';
  const [status, setStatus] = useState<LinkStatus>('connecting');
  const [state, setState] = useState<RemoteState | null>(null);
  const [pinError, setPinError] = useState<string | null>(null);
  const [pin, setPin] = useState<string | null>(() => {
    if (via !== 'local') return null;
    const fromLink = takePinFromLink();
    if (fromLink) { try { sessionStorage.setItem(PIN_SS, fromLink); } catch { /* sem sessão */ } return fromLink; }
    try { return sessionStorage.getItem(PIN_SS); } catch { return null; }
  });
  const offset = useRef(0);
  const lastAt = useRef(0);
  const sendRef = useRef<(cmd: RemoteCommand) => void>(() => {});
  const meterWatchers = useRef(new Set<(m: RemoteMeters) => void>());
  const askMeters = useRef<() => void>(() => {});
  const lastMetersAt = useRef(0);
  const dispatchMeters = useCallback((raw: unknown) => {
    if (!isRemoteMeters(raw) || raw.at < lastMetersAt.current) return;
    lastMetersAt.current = raw.at;
    meterWatchers.current.forEach((cb) => cb(raw));
  }, []);

  const accept = useCallback((raw: unknown) => {
    if (!isRemoteState(raw)) return;
    // mensagens podem chegar fora de ordem: uma mais velha não volta o estado
    if (raw.at < lastAt.current) return;
    lastAt.current = raw.at;
    offset.current = raw.at - Date.now();
    setState(raw);
    setStatus('live');
  }, []);

  // ---------- Rede Local ----------
  useEffect(() => {
    if (via !== 'local') return;
    if (!pin) { setStatus('pin'); return; }
    let alive = true;
    let busy = false;
    let lastOk = Date.now();
    const poll = async () => {
      if (busy || !alive) return;
      busy = true;
      try {
        const { remote } = await localRemoteState(pin);
        if (!alive) return;
        lastOk = Date.now();
        setPinError(null);
        accept(remote);
      } catch (e) {
        if (!alive) return;
        if ((e as Error).message === 'invalid_code') {
          localForget('remote', pin);
          try { sessionStorage.removeItem(PIN_SS); } catch { /* sem sessão */ }
          setPinError('PIN errado. Confira o PIN do VS Stage Remote na tela Rede Local do Mac.');
          setPin(null);
          return;
        }
        if (Date.now() - lastOk > LOST_MS) setStatus((s) => (s === 'connecting' ? s : 'lost'));
      } finally {
        busy = false;
      }
    };
    sendRef.current = (cmd) => {
      localRemoteCommand(pin, cmd).then(() => poll()).catch(() => {});
    };
    poll();
    const id = window.setInterval(poll, POLL_MS);
    let metersBusy = false;
    const pollMeters = async () => {
      if (metersBusy || !alive || meterWatchers.current.size === 0) return;
      metersBusy = true;
      try { dispatchMeters(await localRemoteMeters(pin)); } catch { /* a próxima busca tenta de novo */ } finally { metersBusy = false; }
    };
    const metersId = window.setInterval(pollMeters, METERS_POLL_MS);
    return () => { alive = false; window.clearInterval(id); window.clearInterval(metersId); };
  }, [via, pin, accept, dispatchMeters]);

  // ---------- Show Online ----------
  useEffect(() => {
    if (via !== 'online') return;
    const key = remoteKeyFromLink();
    if (!key) { setStatus('nolink'); return; }
    let alive = true;
    const channel = supabase.channel(remoteChannelName(key), {
      config: { broadcast: { self: false }, presence: { key: crypto.randomUUID?.() ?? String(Math.random()) } },
    });
    channel
      .on('broadcast', { event: 'state' }, ({ payload }) => { if (alive) accept(payload); })
      .on('broadcast', { event: 'meters' }, ({ payload }) => { if (alive) dispatchMeters(payload); })
      .subscribe((st) => {
        if (st !== 'SUBSCRIBED' || !alive) return;
        channel.track({ role: 'remote', at: Date.now() }).catch(() => {});
        channel.send({ type: 'broadcast', event: 'hello', payload: {} }).catch(() => {});
      });
    sendRef.current = (cmd) => {
      channel.send({ type: 'broadcast', event: 'cmd', payload: cmd }).catch(() => {});
    };
    askMeters.current = () => {
      if (alive && meterWatchers.current.size > 0) channel.send({ type: 'broadcast', event: 'meters-on', payload: {} }).catch(() => {});
    };
    const askEvery = window.setInterval(() => askMeters.current(), METERS_ASK_MS);
    // sem estado novo há 6 s: o Mac sumiu (o programa manda pelo menos a cada 3 s)
    const watch = window.setInterval(() => {
      if (!alive) return;
      if (lastAt.current && Date.now() + offset.current - lastAt.current > LOST_MS) setStatus('lost');
      // pede o estado de novo enquanto não chega nada
      if (!lastAt.current || Date.now() + offset.current - lastAt.current > LOST_MS) {
        channel.send({ type: 'broadcast', event: 'hello', payload: {} }).catch(() => {});
      }
    }, 2000);
    return () => {
      alive = false;
      askMeters.current = () => {};
      window.clearInterval(watch);
      window.clearInterval(askEvery);
      supabase.removeChannel(channel);
    };
  }, [via, accept, dispatchMeters]);

  const send = useCallback((cmd: RemoteCommand) => {
    // fader arrastado não vibra a cada passo
    if (cmd.action !== 'volume' && cmd.action !== 'master') haptic();
    sendRef.current(cmd);
  }, []);

  const submitPin = useCallback((p: string) => {
    const clean = p.replace(/\D/g, '');
    if (clean.length !== 6) { setPinError('O PIN tem 6 números.'); return; }
    try { sessionStorage.setItem(PIN_SS, clean); } catch { /* sem sessão */ }
    setPinError(null);
    setStatus('connecting');
    setPin(clean);
  }, []);

  // QR lido de novo com a página já aberta: o navegador só troca o "#pin=" sem recarregar
  useEffect(() => {
    if (via !== 'local') return;
    const onHash = () => { const p = takePinFromLink(); if (p) submitPin(p); };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [via, submitPin]);

  const macNow = useCallback(() => Date.now() + offset.current, []);

  const watchMeters = useCallback((cb: (m: RemoteMeters) => void) => {
    meterWatchers.current.add(cb);
    askMeters.current();
    return () => { meterWatchers.current.delete(cb); };
  }, []);

  return { via, status, state, macNow, send, submitPin, pinError, watchMeters };
}
