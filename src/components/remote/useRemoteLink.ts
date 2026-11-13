import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { isLocalClient, takePinFromLink } from '@/lib/localNetwork';
import { LOCAL_NOTICE, localForget, localRemoteCommand, localRemoteMeters, localRemoteState } from '@/lib/localClientApi';
import { remoteChannelName, remoteKeyFromLink } from '@/lib/onlineRemote';
import {
  enqueueCommand, isRemoteMeters, pushClockSample, readRemoteMessage,
  type RemoteCommand, type RemoteList, type RemoteMeters, type RemoteState,
} from '@/lib/remoteProtocol';

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
  /** aviso sobre um comando que o Mac não confirmou (ou mandado sem sinal) */
  notice: string | null;
  dismissNotice: () => void;
}

const POLL_MS = 300;
/** Rede Local: consulta sem resposta nesse tempo conta como falha (o IP do Mac pode ter sumido) */
const POLL_TIMEOUT_MS = 5000;
/** Rede Local: comando sem resposta nesse tempo: a fila não fica presa e o celular avisa */
const COMMAND_TIMEOUT_MS = 2000;
/** Show Online: espera da confirmação do servidor para um comando */
const SEND_ACK_MS = 3000;
/** Tocar e Parar: o estado do Mac precisa mostrar o comando nesse tempo */
const CONFIRM_MS = 3000;
/** Quanto tempo o aviso de comando fica na tela. */
const NOTICE_MS = 6000;
/** Show Online: o estado completo (lista velha aqui) é pedido no máximo uma vez por segundo */
const FULL_ASK_GAP_MS = 1000;
/** Rede Local sem sinal: de quanto em quanto tempo procura o Mac pelo nome fixo (IP trocado) */
const MOVE_PROBE_MS = 5000;
/** Rede Local: medidores buscados ~11 vezes por segundo, só com a aba Mixer aberta */
const METERS_POLL_MS = 90;
/** Show Online: o pedido de medidores é renovado a cada 2 s (o Mac para sozinho depois de 5 s) */
const METERS_ASK_MS = 2000;
const LOST_MS = 6000;
const PIN_SS = 'vs_remote_pin';

const RELOAD_SS = 'vs_remote_reload';

// Os avisos não afirmam o que não se sabe: o comando pode ter chegado.
const NO_CONFIRM = 'O Mac não confirmou o comando. Confira no Mac antes de repetir.';
const LOST_NOTICE = 'Sem sinal do Mac: não dá para saber se o comando chegou. Confira no Mac antes de repetir.';
const NO_CONFIRM_PLAY = 'O Mac não confirmou o Tocar. Confira no Mac.';
const NO_CONFIRM_STOP = 'O Mac não confirmou o Parar. Confira no Mac.';

/**
 * Rede Local: a página vem do programa do Mac. Se o programa foi atualizado com a página já
 * aberta no celular, ela continuava com o código velho (por exemplo, sem a seleção pela Lista).
 * Recarrega uma vez quando a versão do Mac é outra.
 */
function reloadIfOtherVersion(app: unknown) {
  if (typeof app !== 'string' || !app || app === __APP_VERSION__) return;
  try {
    if (sessionStorage.getItem(RELOAD_SS) === app) return;
    sessionStorage.setItem(RELOAD_SS, app);
  } catch { return; }
  window.location.reload();
}

function haptic() {
  try { navigator.vibrate?.(20); } catch { /* sem vibração */ }
}

/** Falha com 'offline' se o pedido não terminar em `ms` (um pedido pendurado não segura o resto). */
function within<T>(ms: number, p: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = window.setTimeout(() => reject(new Error('offline')), ms);
    p.then(
      (v) => { window.clearTimeout(t); resolve(v); },
      (e) => { window.clearTimeout(t); reject(e); },
    );
  });
}

export function useRemoteLink(): RemoteLink {
  const via: 'local' | 'online' = isLocalClient() ? 'local' : 'online';
  const [status, setStatus] = useState<LinkStatus>('connecting');
  const [state, setState] = useState<RemoteState | null>(null);
  const [pinError, setPinError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pin, setPin] = useState<string | null>(() => {
    if (via !== 'local') return null;
    const fromLink = takePinFromLink();
    if (fromLink) { try { sessionStorage.setItem(PIN_SS, fromLink); } catch { /* sem sessão */ } return fromLink; }
    try { return sessionStorage.getItem(PIN_SS); } catch { return null; }
  });
  const offset = useRef(0);
  const clockSamples = useRef<number[]>([]);
  const lastAt = useRef(0);
  // Show Online: a última lista completa, para juntar com o estado leve
  const list = useRef<RemoteList | null>(null);
  const askFull = useRef<() => void>(() => {});
  const askedFullAt = useRef(0);
  const sendRef = useRef<(cmd: RemoteCommand) => void>(() => {});
  const meterWatchers = useRef(new Set<(m: RemoteMeters) => void>());
  const askMeters = useRef<() => void>(() => {});
  const lastMetersAt = useRef(0);
  const statusRef = useRef(status);
  statusRef.current = status;
  const noticeTimer = useRef<number | null>(null);
  // Tocar ou Parar esperando o estado do Mac mostrar o comando
  const [expecting, setExpecting] = useState<{ kind: 'play' | 'stop'; at: number } | null>(null);

  const warn = useCallback((text: string) => {
    setNotice(text);
    if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => { noticeTimer.current = null; setNotice(null); }, NOTICE_MS);
  }, []);
  const dismissNotice = useCallback(() => {
    if (noticeTimer.current !== null) { window.clearTimeout(noticeTimer.current); noticeTimer.current = null; }
    setNotice(null);
  }, []);
  useEffect(() => () => { if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current); }, []);

  const dispatchMeters = useCallback((raw: unknown) => {
    if (!isRemoteMeters(raw) || raw.at < lastMetersAt.current) return;
    lastMetersAt.current = raw.at;
    meterWatchers.current.forEach((cb) => cb(raw));
  }, []);

  /**
   * Estado que chegou do Mac. `macClock` é a hora do Mac na resposta (Rede Local): o servidor
   * devolve o último estado guardado, que pode ter até 3 s, então a hora vem à parte.
   */
  const accept = useCallback((raw: unknown, macClock?: number) => {
    const msg = readRemoteMessage(raw, list.current);
    if (msg.kind === 'needFull') {
      // Show Online: chegou o estado leve de outra lista (ou nenhuma guardada): pede o completo
      if (Date.now() - askedFullAt.current > FULL_ASK_GAP_MS) { askedFullAt.current = Date.now(); askFull.current(); }
      return;
    }
    if (msg.kind === 'bad') return;
    const s = msg.state;
    // mensagens podem chegar fora de ordem: uma mais velha não volta o estado
    if (s.at < lastAt.current) return;
    const fresh = s.at !== lastAt.current;
    // Rede Local: a hora do Mac vem na resposta. Show Online: o estado é montado na hora do envio,
    // e só o estado novo acerta o relógio (um envio repetido voltaria o relógio para trás).
    if (macClock !== undefined) offset.current = pushClockSample(clockSamples.current, macClock - Date.now());
    else if (fresh) offset.current = s.at - Date.now();
    // antes do return: com o Mac parado, o PIN digitado de novo devolve o mesmo estado
    setStatus('live');
    // mesmo estado de novo: não redesenha a lista nem o mixer
    if (!fresh) return;
    lastAt.current = s.at;
    list.current = msg.list;
    if (isLocalClient()) reloadIfOtherVersion(s.app);
    setState(s);
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
        const { remote, serverNow } = await within(POLL_TIMEOUT_MS, localRemoteState(pin));
        if (!alive) return;
        lastOk = Date.now();
        setPinError(null);
        accept(remote, serverNow);
      } catch (e) {
        if (!alive) return;
        const msg = (e as Error).message;
        // "PIN errado" só com PIN errado. Desconectado pelo diretor volta para o PIN com o aviso.
        if (msg === 'invalid_code' || msg === 'disconnected') {
          localForget('remote', pin);
          try { sessionStorage.removeItem(PIN_SS); } catch { /* sem sessão */ }
          setPinError(msg === 'disconnected'
            ? LOCAL_NOTICE.disconnected
            : 'PIN errado. Confira o PIN do VS Stage Remote na tela Rede Local do Mac.');
          setPin(null);
          return;
        }
        if (Date.now() - lastOk > LOST_MS) setStatus((s) => (s === 'connecting' ? s : 'lost'));
      } finally {
        busy = false;
      }
    };
    // Um comando por vez, na ordem do toque: dois envios soltos podiam chegar trocados (o último
    // valor do fader trocado pelo penúltimo). O fader que espera na fila guarda só o último valor.
    const queue: RemoteCommand[] = [];
    let sending = false;
    const pump = async () => {
      if (sending) return;
      sending = true;
      let failed: string | null = null;
      try {
        while (alive && queue.length > 0) {
          const cmd = queue.shift()!;
          try {
            await within(COMMAND_TIMEOUT_MS, localRemoteCommand(pin, cmd));
          } catch (e) {
            failed = (e as Error).message;
            // depois de uma falha nada sai atrasado (um Pular segundos depois do toque surpreende a banda)
            queue.length = 0;
          }
        }
      } finally {
        sending = false;
      }
      if (!alive) return;
      // PIN errado e desconexão o poll já trata; sem sinal, o aviso de sem sinal já está na tela
      if (failed && failed !== 'invalid_code' && failed !== 'disconnected' && statusRef.current !== 'lost') warn(NO_CONFIRM);
      void poll();
    };
    sendRef.current = (cmd) => {
      enqueueCommand(queue, cmd);
      void pump();
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
    return () => {
      alive = false;
      queue.length = 0;
      window.clearInterval(id);
      window.clearInterval(metersId);
    };
  }, [via, pin, accept, dispatchMeters, warn]);

  // Rede Local: o Mac trocou de IP no meio do show (roteador reiniciou, cabo para Wi-Fi). Com o IP
  // da página sem resposta, passa para o nome fixo do Mac, mas só se ele confirmar que é ESTE Mac
  // (o nome é o mesmo em todo Mac com VS Stage na rede). Enquanto o IP responde, nada muda.
  useEffect(() => {
    const w = window as Window & { __VS_ID__?: string };
    const host = w.__VS_HOST__;
    const macId = w.__VS_ID__;
    if (via !== 'local' || status !== 'lost' || !pin || !host || !macId || window.location.host === host) return;
    let alive = true;
    /** null: ninguém respondeu; senão o id que veio (ou undefined, se não veio) */
    const probe = async (url: string): Promise<{ id: unknown } | null> => {
      const ctrl = new AbortController();
      const t = window.setTimeout(() => ctrl.abort(), 2500);
      try {
        const r = await fetch(url, { cache: 'no-store', signal: ctrl.signal });
        const data = r.ok ? await r.json().catch(() => null) : null;
        return { id: data && typeof data === 'object' ? (data as { id?: unknown }).id : undefined };
      } catch {
        return null;
      } finally {
        window.clearTimeout(t);
      }
    };
    const tryMove = async () => {
      const [here, there] = await Promise.all([probe('/api/local/ping'), probe(`http://${host}/api/local/ping`)]);
      if (alive && !here && there?.id === macId) window.location.replace(`http://${host}/show#pin=${pin}`);
    };
    void tryMove();
    const timer = window.setInterval(() => { void tryMove(); }, MOVE_PROBE_MS);
    return () => { alive = false; window.clearInterval(timer); };
  }, [via, status, pin]);

  // ---------- Show Online ----------
  useEffect(() => {
    if (via !== 'online') return;
    const key = remoteKeyFromLink();
    if (!key) { setStatus('nolink'); return; }
    let alive = true;
    const channel = supabase.channel(remoteChannelName(key), {
      // ack: o servidor confirma cada envio (sem isso o envio diz "ok" na hora, mesmo sem ter ido)
      config: { broadcast: { self: false, ack: true }, presence: { key: crypto.randomUUID?.() ?? String(Math.random()) } },
    });
    const hello = () => { channel.send({ type: 'broadcast', event: 'hello', payload: {} }).catch(() => {}); };
    channel
      .on('broadcast', { event: 'state' }, ({ payload }) => { if (alive) accept(payload); })
      .on('broadcast', { event: 'meters' }, ({ payload }) => { if (alive) dispatchMeters(payload); })
      .subscribe((st) => {
        if (st !== 'SUBSCRIBED' || !alive) return;
        // lite: esta página sabe juntar o estado leve com a lista guardada
        channel.track({ role: 'remote', at: Date.now(), lite: 1 }).catch(() => {});
        hello();
      });
    sendRef.current = (cmd) => {
      channel.send({ type: 'broadcast', event: 'cmd', payload: cmd }, { timeout: SEND_ACK_MS })
        .then((r) => { if (alive && r !== 'ok' && statusRef.current !== 'lost') warn(NO_CONFIRM); })
        .catch(() => { if (alive && statusRef.current !== 'lost') warn(NO_CONFIRM); });
    };
    askFull.current = () => { if (alive) hello(); };
    askMeters.current = () => {
      if (alive && meterWatchers.current.size > 0) channel.send({ type: 'broadcast', event: 'meters-on', payload: {} }).catch(() => {});
    };
    const askEvery = window.setInterval(() => askMeters.current(), METERS_ASK_MS);
    // sem estado novo há 6 s: o Mac sumiu (o programa manda pelo menos a cada 3 s)
    const watch = window.setInterval(() => {
      if (!alive) return;
      if (lastAt.current && Date.now() + offset.current - lastAt.current > LOST_MS) setStatus('lost');
      // pede o estado de novo enquanto não chega nada
      if (!lastAt.current || Date.now() + offset.current - lastAt.current > LOST_MS) hello();
    }, 2000);
    return () => {
      alive = false;
      askMeters.current = () => {};
      askFull.current = () => {};
      list.current = null;
      window.clearInterval(watch);
      window.clearInterval(askEvery);
      supabase.removeChannel(channel);
    };
  }, [via, accept, dispatchMeters, warn]);

  // Tocar e Parar: confirmados pelo estado que volta do Mac (vale também com Mac antigo)
  useEffect(() => {
    if (!expecting) return;
    if (state && (expecting.kind === 'play' ? state.playing : !state.active)) { setExpecting(null); return; }
    const t = window.setTimeout(() => {
      setExpecting(null);
      warn(expecting.kind === 'play' ? NO_CONFIRM_PLAY : NO_CONFIRM_STOP);
    }, Math.max(0, expecting.at + CONFIRM_MS - Date.now()));
    return () => window.clearTimeout(t);
  }, [expecting, state, warn]);

  const send = useCallback((cmd: RemoteCommand) => {
    const fader = cmd.action === 'volume' || cmd.action === 'master';
    if (statusRef.current === 'lost') {
      // sem sinal o comando vai mesmo assim (pode chegar), mas não vibra como se tivesse ido
      if (!fader) warn(LOST_NOTICE);
    } else if (!fader) {
      // fader arrastado não vibra a cada passo
      haptic();
      if (cmd.action === 'play' || cmd.action === 'stop') setExpecting({ kind: cmd.action, at: Date.now() });
    }
    sendRef.current(cmd);
  }, [warn]);

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

  return { via, status, state, macNow, send, submitPin, pinError, watchMeters, notice, dismissNotice };
}
