import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight, KeyRound, Loader2, Music, User, Wifi, WifiOff } from 'lucide-react';
import MusicianWorkspace from '@/components/musician/MusicianWorkspace';
import { serverLagMs } from '@/lib/liveClock';
import { localForget, localMusicianSheets, localMusicianState, localSheetBackend } from '@/lib/localClientApi';
import { localServerVersion } from '@/lib/localNetwork';
import type { MusicianState, SheetInfo } from '@/lib/musicianTypes';

const LOGIN_LS = 'vs_local_musician';
const POLL_MS = 1000;
const SHEETS_POLL_MS = 8000;
const VERSION = localServerVersion();

interface Login { name: string; pin: string }

function savedLogin(): Login | null {
  try {
    const v = JSON.parse(localStorage.getItem(LOGIN_LS) ?? 'null');
    return v && typeof v.name === 'string' && typeof v.pin === 'string' ? v : null;
  } catch { return null; }
}

function errorText(msg: string): string {
  if (msg === 'invalid_code') return 'PIN incorreto. Confira com o diretor musical.';
  if (msg === 'too_many_attempts') return 'Muitas tentativas erradas. Espere alguns minutos e tente de novo.';
  return 'Não encontrei o Mac do diretor. Confira se você está no mesmo Wi-Fi do palco.';
}

export default function LocalMusicianArea() {
  const [login, setLogin] = useState<Login | null>(savedLogin);
  const [state, setState] = useState<MusicianState | null>(null);
  const [sheets, setSheets] = useState<SheetInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [sync, setSync] = useState({ lagMs: 0, receivedAt: 0 });

  const fetchState = useCallback(async (l: Login) => {
    const s = await localMusicianState(l.pin, l.name);
    setState(s);
    setSync({ lagMs: serverLagMs(s.server_now, s.show.live_at), receivedAt: Date.now() });
    setOffline(false);
  }, []);

  const reloadSheets = useCallback(async () => {
    if (!login) return;
    try { setSheets(await localMusicianSheets(login.pin, login.name)); } catch { /* tenta de novo no próximo ciclo */ }
  }, [login]);

  useEffect(() => {
    if (!login) return;
    let alive = true;
    let timer = 0;
    const loop = async () => {
      try {
        await fetchState(login);
      } catch (e) {
        const msg = (e as Error).message;
        if (msg === 'invalid_code') {
          localStorage.removeItem(LOGIN_LS);
          setError(errorText(msg));
          setState(null);
          setLogin(null);
          return;
        }
        setOffline(true);
      }
      if (alive) timer = window.setTimeout(loop, POLL_MS);
    };
    loop();
    return () => { alive = false; window.clearTimeout(timer); };
  }, [login, fetchState]);

  useEffect(() => {
    if (!login) return;
    void reloadSheets();
    const id = window.setInterval(() => { void reloadSheets(); }, SHEETS_POLL_MS);
    return () => window.clearInterval(id);
  }, [login, reloadSheets]);

  const backend = useMemo(() => (login ? localSheetBackend(login.pin, login.name) : null), [login]);

  const enter = async (l: Login): Promise<string | null> => {
    try {
      await fetchState(l);
      localStorage.setItem(LOGIN_LS, JSON.stringify(l));
      setError(null);
      setLogin(l);
      return null;
    } catch (e) {
      return errorText((e as Error).message);
    }
  };

  const leave = () => {
    if (login) localForget('musician', login.pin);
    localStorage.removeItem(LOGIN_LS);
    setLogin(null);
    setState(null);
    setSheets([]);
  };

  if (!login || !backend || (!state && error)) return <LocalLogin onEnter={enter} initialError={error} />;

  if (!state) {
    return (
      <div className="h-full min-h-screen flex items-center justify-center bg-logic-bg-deep">
        {offline
          ? <p className="flex items-center gap-2 text-sm text-logic-text-dim px-6 text-center"><WifiOff size={18} /> Procurando o Mac do diretor...</p>
          : <Loader2 size={28} className="text-logic-lcd-green animate-spin" />}
      </div>
    );
  }

  return (
    <MusicianWorkspace
      state={state} sync={sync} sheets={sheets} backend={backend}
      onSheetsChanged={reloadSheets} onCreateAccount={null}
      status={
        <span className={`flex items-center gap-1.5 text-2xs truncate ${offline ? 'text-logic-lcd-amber' : 'text-logic-text-muted'}`}>
          {offline ? <WifiOff size={12} /> : <Wifi size={12} />}
          {offline ? 'Reconectando...' : `Rede local · ${state.show.name}`}
          {VERSION && <span className="text-logic-text-muted/70">· v{VERSION}</span>}
        </span>
      }
      logoutLabel="Sair" onLogout={leave}
    />
  );
}

function LocalLogin({ onEnter, initialError }: { onEnter: (l: Login) => Promise<string | null>; initialError: string | null }) {
  const [name, setName] = useState(() => savedLogin()?.name ?? '');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(initialError);
  const cleanPin = pin.replace(/\D/g, '').slice(0, 6);
  const ready = name.trim().length > 0 && cleanPin.length === 6;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    const err = await onEnter({ name: name.trim().slice(0, 40), pin: cleanPin });
    setBusy(false);
    setError(err);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-logic-bg-deep px-4">
      <form onSubmit={submit} className="w-full max-w-sm bg-logic-bg-panel border border-logic-border rounded-2xl p-8 shadow-2xl animate-[fadeIn_200ms_ease-out]">
        <div className="w-12 h-12 rounded-xl bg-logic-lcd-green/15 text-logic-lcd-green flex items-center justify-center mb-5">
          <Music size={22} />
        </div>
        <h1 className="text-xl font-semibold text-logic-text">Área do Músico</h1>
        <p className="text-sm text-logic-text-dim mt-2 leading-relaxed">
          Rede local do palco. Funciona sem internet, só precisa estar no mesmo Wi-Fi do Mac do diretor.
        </p>

        <label htmlFor="local-name" className="block text-xs font-medium text-logic-text-dim mt-6 mb-2">Seu nome</label>
        <div className="relative">
          <User size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-logic-text-muted" />
          <input
            id="local-name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: João (baixo)"
            className="w-full pl-9 pr-3 py-3 rounded-lg bg-logic-bg-deep border border-logic-border-light text-logic-text outline-none focus:border-logic-lcd-green transition-colors placeholder:text-logic-text-muted"
          />
        </div>

        <label htmlFor="local-pin" className="block text-xs font-medium text-logic-text-dim mt-4 mb-2">PIN dos músicos</label>
        <div className="relative">
          <KeyRound size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-logic-text-muted" />
          <input
            id="local-pin" inputMode="numeric" autoComplete="off" value={cleanPin} onChange={(e) => setPin(e.target.value)} placeholder="6 números"
            className="w-full pl-9 pr-3 py-3 rounded-lg bg-logic-bg-deep border border-logic-border-light text-logic-text tracking-[0.3em] outline-none focus:border-logic-lcd-green transition-colors placeholder:tracking-normal placeholder:text-logic-text-muted"
          />
        </div>

        {error && <p className="text-sm text-logic-lcd-red mt-3" role="alert">{error}</p>}
        <button
          type="submit" disabled={!ready || busy}
          className="mt-6 w-full flex items-center justify-center gap-2 py-3 rounded-lg bg-logic-lcd-green text-black font-semibold hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed transition"
        >
          {busy ? <Loader2 size={16} className="animate-spin" /> : <>Entrar <ArrowRight size={16} /></>}
        </button>
        <p className="text-xs text-logic-text-muted mt-5 leading-relaxed">
          O PIN aparece no programa do diretor, em Rede Local. Use sempre o mesmo nome para encontrar suas cifras e partituras.
        </p>
        {VERSION && <p className="text-2xs text-logic-text-muted/70 mt-3">VS Stage {VERSION}</p>}
      </form>
    </div>
  );
}
