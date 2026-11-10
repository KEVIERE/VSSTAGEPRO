import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { isLocalClient, takePinFromLink } from '@/lib/localNetwork';
import { localForget, localRemoteCommand, localRemoteState } from '@/lib/localClientApi';
import { remoteChannelName, remoteKeyFromLink } from '@/lib/onlineRemote';
import { isRemoteState, type RemoteCommand, type RemoteState } from '@/lib/remoteProtocol';

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
}

const POLL_MS = 300;
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
    return () => { alive = false; window.clearInterval(id); };
  }, [via, pin, accept]);

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
      .subscribe((st) => {
        if (st !== 'SUBSCRIBED' || !alive) return;
        channel.track({ role: 'remote', at: Date.now() }).catch(() => {});
        channel.send({ type: 'broadcast', event: 'hello', payload: {} }).catch(() => {});
      });
    sendRef.current = (cmd) => {
      channel.send({ type: 'broadcast', event: 'cmd', payload: cmd }).catch(() => {});
    };
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
      window.clearInterval(watch);
      supabase.removeChannel(channel);
    };
  }, [via, accept]);

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

  return { via, status, state, macNow, send, submitPin, pinError };
}
