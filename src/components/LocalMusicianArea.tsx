import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight, AtSign, Guitar, Hourglass, KeyRound, Loader2, Lock, Music, User, Wifi, WifiOff } from 'lucide-react';
import MusicianWorkspace from '@/components/musician/MusicianWorkspace';
import { serverLagMs } from '@/lib/liveClock';
import {
  forgetMusician, localAccountBackend, localAccountSheets, localAccountState, localMusicianLogin,
  localMusicianLogout, localMusicianResume, localMusicianSignup, musicianRemembered,
} from '@/lib/localClientApi';
import { localServerVersion, takePinFromLink } from '@/lib/localNetwork';
import type { MusicianState, SheetInfo } from '@/lib/musicianTypes';

// Entrada antiga (nome + PIN), de antes das contas: só é apagada deste aparelho.
const OLD_LOGIN_LS = 'vs_local_musician';
const POLL_MS = 400;
const PENDING_POLL_MS = 3000;
const SHEETS_POLL_MS = 8000;
const VERSION = localServerVersion();

type Phase = 'checking' | 'form' | 'pending' | 'in';

function errorText(msg: string): string {
  switch (msg) {
    case 'invalid_code': return 'PIN incorreto. Confira com o diretor musical.';
    case 'wrong_login': return 'Usuário ou senha incorretos.';
    case 'blocked': return 'Seu acesso foi bloqueado pelo diretor musical.';
    case 'username_taken': return 'Esse usuário já existe neste show. Escolha outro.';
    case 'bad_username': return 'Usuário com 3 a 30 letras ou números (pode usar ponto, hífen e _).';
    case 'weak_password': return 'A senha precisa ter pelo menos 6 caracteres.';
    case 'logged_out': return 'Entre de novo com seu usuário e senha.';
    case 'disconnected': return 'O diretor musical desconectou este aparelho. Entre de novo com seu usuário e senha.';
    default: return 'Não encontrei o Mac do diretor. Confira se você está no mesmo Wi-Fi do palco.';
  }
}

export default function LocalMusicianArea() {
  // O PIN é sempre digitado pelo músico. Links antigos com #pin= só têm o PIN apagado do endereço.
  useState(takePinFromLink);
  const [phase, setPhase] = useState<Phase>(() => (musicianRemembered() ? 'checking' : 'form'));
  const [pendingName, setPendingName] = useState('');
  const [state, setState] = useState<MusicianState | null>(null);
  const [sheets, setSheets] = useState<SheetInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [sync, setSync] = useState({ lagMs: 0, receivedAt: 0 });
  const [retry, setRetry] = useState(0);

  useEffect(() => { try { localStorage.removeItem(OLD_LOGIN_LS); } catch { /* sem armazenamento */ } }, []);

  const toForm = useCallback((msg: string | null) => {
    setError(msg);
    setState(null);
    setSheets([]);
    setPhase('form');
  }, []);

  // Celular que já entrou volta sozinho (aparelho lembrado).
  useEffect(() => {
    if (phase !== 'checking') return;
    let alive = true;
    localMusicianResume()
      .then((r) => { if (!alive) return; setOffline(false); setPendingName(r.name); setPhase(r.pending ? 'pending' : 'in'); })
      .catch((e) => {
        if (!alive) return;
        const msg = (e as Error).message;
        // sem achar o Mac: continua tentando, sem pedir login de novo
        if (msg === 'offline') { setOffline(true); window.setTimeout(() => { if (alive) setRetry((n) => n + 1); }, 2000); return; }
        toForm(msg === 'blocked' || msg === 'disconnected' ? errorText(msg) : null);
      });
    return () => { alive = false; };
  }, [phase, retry, toForm]);

  // Esperando o diretor aprovar: pergunta de tempos em tempos.
  useEffect(() => {
    if (phase !== 'pending') return;
    const id = window.setInterval(() => {
      localMusicianResume()
        .then((r) => { if (!r.pending) setPhase('in'); })
        .catch((e) => { const msg = (e as Error).message; if (msg !== 'offline') toForm(errorText(msg)); });
    }, PENDING_POLL_MS);
    return () => window.clearInterval(id);
  }, [phase, toForm]);

  // Dentro: o show ao vivo e os cadernos.
  useEffect(() => {
    if (phase !== 'in') return;
    let alive = true;
    let timer = 0;
    const loop = async () => {
      try {
        const t0 = performance.now();
        const s = await localAccountState();
        const transitMs = Math.min(1500, (performance.now() - t0) / 2);
        if (!alive) return;
        setState(s);
        setSync({ lagMs: serverLagMs(s.server_now, s.show.live_at) + transitMs, receivedAt: Date.now() });
        setOffline(false);
      } catch (e) {
        const msg = (e as Error).message;
        if (msg === 'pending') { setPhase('pending'); return; }
        if (msg === 'logged_out' || msg === 'blocked' || msg === 'disconnected') { toForm(errorText(msg)); return; }
        setOffline(true);
      }
      if (alive) timer = window.setTimeout(loop, POLL_MS);
    };
    void loop();
    return () => { alive = false; window.clearTimeout(timer); };
  }, [phase, toForm]);

  const reloadSheets = useCallback(async () => {
    try { setSheets(await localAccountSheets()); } catch { /* tenta de novo no próximo ciclo */ }
  }, []);

  useEffect(() => {
    if (phase !== 'in') return;
    void reloadSheets();
    const id = window.setInterval(() => { void reloadSheets(); }, SHEETS_POLL_MS);
    return () => window.clearInterval(id);
  }, [phase, reloadSheets]);

  const username = (state?.musician as { username?: string } | undefined)?.username ?? '';
  const backend = useMemo(() => localAccountBackend(username || 'conta'), [username]);

  const entered = (r: { pending: boolean; name: string }) => {
    setError(null);
    setPendingName(r.name);
    setPhase(r.pending ? 'pending' : 'in');
  };

  const leave = async () => {
    await localMusicianLogout();
    toForm(null);
  };

  if (phase === 'checking') return <Centered>{offline ? <Offline /> : <Loader2 size={28} className="text-logic-lcd-green animate-spin" />}</Centered>;
  if (phase === 'form') return <LocalAuthForm onDone={entered} initialError={error} />;
  if (phase === 'pending') return <PendingCard name={pendingName} onLeave={() => { forgetMusician(); toForm(null); }} />;
  if (!state) return <Centered>{offline ? <Offline /> : <Loader2 size={28} className="text-logic-lcd-green animate-spin" />}</Centered>;

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
      onLogout={() => { void leave(); }}
    />
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="h-full min-h-screen flex items-center justify-center bg-logic-bg-deep px-6">{children}</div>;
}

function Offline() {
  return <p className="flex items-center gap-2 text-sm text-logic-text-dim text-center"><WifiOff size={18} /> Procurando o Mac do diretor...</p>;
}

function Card({ children, onSubmit }: { children: React.ReactNode; onSubmit?: (e: React.FormEvent) => void }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-logic-bg-deep px-4 py-8">
      <form onSubmit={onSubmit} className="w-full max-w-sm bg-logic-bg-panel border border-logic-border rounded-2xl p-8 shadow-2xl animate-[fadeIn_200ms_ease-out]">
        {children}
      </form>
    </div>
  );
}

const inputCls = 'w-full pl-9 pr-3 py-3 rounded-lg bg-logic-bg-deep border border-logic-border-light text-logic-text outline-none focus:border-logic-lcd-green transition-colors placeholder:text-logic-text-muted';

function Field({ id, label, icon: Icon, ...props }: { id: string; label: string; icon: typeof User } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <>
      <label htmlFor={id} className="block text-xs font-medium text-logic-text-dim mt-4 mb-2">{label}</label>
      <div className="relative">
        <Icon size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-logic-text-muted" />
        <input id={id} className={inputCls} {...props} />
      </div>
    </>
  );
}

function PendingCard({ name, onLeave }: { name: string; onLeave: () => void }) {
  return (
    <Card>
      <div className="w-12 h-12 rounded-xl bg-logic-lcd-amber/15 text-logic-lcd-amber flex items-center justify-center mb-5">
        <Hourglass size={22} />
      </div>
      <h1 className="text-xl font-semibold text-logic-text">Aguardando o diretor</h1>
      <p className="text-sm text-logic-text-dim mt-2 leading-relaxed">
        {name ? `${name}, sua` : 'Sua'} conta foi criada. Assim que o diretor musical aprovar no programa, você entra sozinho por aqui.
      </p>
      <p className="flex items-center gap-2 text-xs text-logic-text-muted mt-5"><Loader2 size={14} className="animate-spin" /> Esperando a aprovação...</p>
      <button type="button" onClick={onLeave} className="mt-6 text-xs text-logic-text-muted hover:text-logic-text transition-colors">
        Entrar com outra conta
      </button>
    </Card>
  );
}

function LocalAuthForm({ onDone, initialError }: { onDone: (r: { pending: boolean; name: string }) => void; initialError: string | null }) {
  const [tab, setTab] = useState<'login' | 'signup'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [instrument, setInstrument] = useState('');
  const [pin, setPin] = useState('');
  // senha zerada pelo diretor: pede o PIN dos músicos e uma senha nova
  const [needsNew, setNeedsNew] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(initialError);
  const cleanPin = pin.replace(/\D/g, '').slice(0, 6);

  const ready = tab === 'login'
    ? username.trim().length >= 3 && password.length >= (needsNew ? 6 : 1) && (!needsNew || cleanPin.length === 6)
    : name.trim().length > 0 && username.trim().length >= 3 && password.length >= 6 && cleanPin.length === 6;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = tab === 'signup'
        ? await localMusicianSignup({ pin: cleanPin, name: name.trim(), instrument: instrument.trim(), username: username.trim(), password })
        : needsNew
          ? await localMusicianLogin({ username: username.trim(), pin: cleanPin, newPassword: password })
          : await localMusicianLogin({ username: username.trim(), password });
      onDone(r);
    } catch (err) {
      const msg = (err as Error).message;
      if (msg === 'needs_password') { setNeedsNew(true); setPassword(''); setError('O diretor zerou sua senha. Digite o PIN dos músicos e crie uma senha nova.'); }
      else setError(errorText(msg));
    } finally {
      setBusy(false);
    }
  };

  const switchTab = (t: 'login' | 'signup') => { setTab(t); setError(null); setNeedsNew(false); };

  return (
    <Card onSubmit={submit}>
      <div className="w-12 h-12 rounded-xl bg-logic-lcd-green/15 text-logic-lcd-green flex items-center justify-center mb-5">
        <Music size={22} />
      </div>
      <h1 className="text-xl font-semibold text-logic-text">Área do Músico</h1>
      <p className="text-sm text-logic-text-dim mt-2 leading-relaxed">
        Rede local do palco. Funciona sem internet, só precisa estar no mesmo Wi-Fi do Mac do diretor.
      </p>

      <div className="grid grid-cols-2 gap-2 mt-6">
        {(['login', 'signup'] as const).map((t) => (
          <button
            key={t} type="button" onClick={() => switchTab(t)}
            className={`console-key h-9 text-[13px] ${tab === t ? 'is-lit-blue' : ''}`}
          >
            {t === 'login' ? 'Entrar' : 'Criar conta'}
          </button>
        ))}
      </div>

      {tab === 'signup' && (
        <>
          <Field id="local-name" label="Seu nome" icon={User} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: João" />
          <Field id="local-instr" label="Instrumento" icon={Guitar} value={instrument} onChange={(e) => setInstrument(e.target.value)} placeholder="Ex.: Baixo" />
        </>
      )}
      <Field
        id="local-user" label="Usuário" icon={AtSign} autoComplete="username" autoCapitalize="none" autoCorrect="off"
        value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Ex.: joao.baixo"
      />
      <Field
        id="local-pass" label={needsNew ? 'Senha nova' : 'Senha'} icon={Lock} type="password"
        autoComplete={tab === 'signup' || needsNew ? 'new-password' : 'current-password'}
        value={password} onChange={(e) => setPassword(e.target.value)} placeholder={tab === 'signup' || needsNew ? 'Mínimo 6 caracteres' : 'Sua senha'}
      />
      {(tab === 'signup' || needsNew) && (
        <Field
          id="local-pin" label="PIN dos músicos" icon={KeyRound} inputMode="numeric" autoComplete="off"
          value={cleanPin} onChange={(e) => setPin(e.target.value)} placeholder="6 números"
        />
      )}

      {error && <p className="text-sm text-logic-lcd-red mt-3" role="alert">{error}</p>}
      <button
        type="submit" disabled={!ready || busy}
        className="mt-6 w-full flex items-center justify-center gap-2 py-3 rounded-lg bg-logic-lcd-green text-black font-semibold hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed transition"
      >
        {busy ? <Loader2 size={16} className="animate-spin" /> : <>{tab === 'signup' ? 'Criar conta' : 'Entrar'} <ArrowRight size={16} /></>}
      </button>
      <p className="text-xs text-logic-text-muted mt-5 leading-relaxed">
        {tab === 'signup'
          ? 'O PIN aparece no programa do diretor, em Rede Local. Depois de criar, o diretor aprova e você entra só com usuário e senha.'
          : 'Suas cifras, partituras e anotações ficam na sua conta, guardadas no projeto do show.'}
      </p>
      {VERSION && <p className="text-2xs text-logic-text-muted/70 mt-3">VS Stage {VERSION}</p>}
    </Card>
  );
}
