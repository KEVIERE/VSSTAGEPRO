import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight, AtSign, Guitar, KeyRound, Loader2, Lock, User, Wifi, WifiOff } from 'lucide-react';
import MusicianWorkspace from '@/components/musician/MusicianWorkspace';
import { AccessCard, AccessNotice, AccessStage, AccessTitle } from '@/components/access/AccessChrome';
import { serverLagMs } from '@/lib/liveClock';
import {
  LOCAL_NOTICE, forgetMusician, localAccountBackend, localAccountSheets, localAccountState, localMusicianLogin,
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
    case 'not_ready': return LOCAL_NOTICE.notReady;
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
  // o Mac respondeu, mas o projeto aberto não tem músicas (não é falta de conexão)
  const [notReady, setNotReady] = useState(false);
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
      .then((r) => { if (!alive) return; setOffline(false); setNotReady(false); setPendingName(r.name); setPhase(r.pending ? 'pending' : 'in'); })
      .catch((e) => {
        if (!alive) return;
        const msg = (e as Error).message;
        // Sem achar o Mac, ou o programa reaberto ainda abrindo o projeto: continua tentando, sem
        // pedir login de novo (o aparelho continua lembrado).
        if (msg === 'offline' || msg === 'not_ready') {
          setOffline(msg === 'offline');
          setNotReady(msg === 'not_ready');
          window.setTimeout(() => { if (alive) setRetry((n) => n + 1); }, 2000);
          return;
        }
        toForm(msg === 'blocked' || msg === 'disconnected' ? errorText(msg) : null);
      });
    return () => { alive = false; };
  }, [phase, retry, toForm]);

  // Esperando o diretor aprovar: pergunta de tempos em tempos.
  useEffect(() => {
    if (phase !== 'pending') return;
    let alive = true;
    const id = window.setInterval(() => {
      localMusicianResume()
        .then((r) => { if (alive && !r.pending) setPhase('in'); })
        .catch((e) => {
          const msg = (e as Error).message;
          // Mac fora do ar ou ainda abrindo o projeto: a espera continua
          if (alive && msg !== 'offline' && msg !== 'not_ready') toForm(errorText(msg));
        });
    }, PENDING_POLL_MS);
    return () => { alive = false; window.clearInterval(id); };
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
        setNotReady(false);
      } catch (e) {
        const msg = (e as Error).message;
        if (msg === 'pending') { setPhase('pending'); return; }
        if (msg === 'logged_out' || msg === 'blocked' || msg === 'disconnected') { toForm(errorText(msg)); return; }
        if (msg === 'not_ready') { setOffline(false); setNotReady(true); }
        else setOffline(true);
      }
      if (alive) timer = window.setTimeout(loop, POLL_MS);
    };
    void loop();
    return () => { alive = false; window.clearTimeout(timer); };
  }, [phase, toForm]);

  const reloadSheets = useCallback(async () => {
    try { setSheets(await localAccountSheets()); } catch { /* tenta de novo no próximo ciclo */ }
  }, []);

  // Laço encadeado: a próxima busca só sai quando a anterior terminou. Com setInterval, listas
  // presas (prazo de até 60 s) se empilhavam e ocupavam as conexões do navegador com o Mac,
  // travando a consulta do show.
  useEffect(() => {
    if (phase !== 'in') return;
    let alive = true;
    let timer = 0;
    const loop = async () => {
      await reloadSheets();
      if (alive) timer = window.setTimeout(loop, SHEETS_POLL_MS);
    };
    void loop();
    return () => { alive = false; window.clearTimeout(timer); };
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

  // Esperando o projeto abrir: dá para sair (projeto novo sem contas nunca manda o livro, e o
  // músico precisa chegar em "Criar conta").
  if (phase === 'checking') {
    return (
      <Centered>
        {notReady ? <NotReady onLeave={() => { forgetMusician(); toForm(null); }} />
          : offline ? <Offline /> : <Loader2 size={28} className="text-logic-lcd-green animate-spin" />}
      </Centered>
    );
  }
  if (phase === 'form') return <LocalAuthForm onDone={entered} initialError={error} />;
  if (phase === 'pending') return <PendingCard name={pendingName} onLeave={() => { forgetMusician(); toForm(null); }} />;
  if (!state) {
    return (
      <Centered>
        {notReady ? <NotReady onLeave={() => { void leave(); }} />
          : offline ? <Offline /> : <Loader2 size={28} className="text-logic-lcd-green animate-spin" />}
      </Centered>
    );
  }

  return (
    <MusicianWorkspace
      state={state} sync={sync} sheets={sheets} backend={backend}
      onSheetsChanged={reloadSheets} onCreateAccount={null}
      status={
        <span className={`flex items-center gap-1.5 text-2xs truncate ${offline || notReady ? 'text-logic-lcd-amber' : 'text-logic-text-muted'}`}>
          {offline ? <WifiOff size={12} /> : <Wifi size={12} />}
          {offline ? 'Reconectando...' : notReady ? 'Esperando o diretor abrir o repertório...' : `Rede local · ${state.show.name}`}
          {VERSION && <span className="text-logic-text-muted/70">· v{VERSION}</span>}
        </span>
      }
      onLogout={() => { void leave(); }}
      // o Mac respondeu, mas fechou o repertório: o "Sem sinal do diretor" diz o motivo certo
      signalHint={!offline && notReady ? LOCAL_NOTICE.notReady : undefined}
    />
  );
}

// Fundo da entrada (palco escuro), para o carregamento não aparecer em cinza liso antes do cartão.
function Centered({ children }: { children: React.ReactNode }) {
  return <AccessStage>{children}</AccessStage>;
}

function Offline() {
  return <p className="flex items-center gap-2 text-sm text-logic-text-dim text-center"><WifiOff size={18} /> Procurando o Mac do diretor...</p>;
}

function NotReady({ onLeave }: { onLeave?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-6">
      <p className="flex items-center gap-2 text-sm text-logic-text-dim text-center"><Loader2 size={18} className="animate-spin shrink-0" /> {LOCAL_NOTICE.notReady}</p>
      {onLeave && <button type="button" onClick={onLeave} className="access-link">Entrar com outra conta</button>}
    </div>
  );
}

/** Cartão da entrada no padrão do programa: palco, logo e título, módulo com trilho prateado. */
function Card({ label, status, children, onSubmit }: { label: React.ReactNode; status?: React.ReactNode; children: React.ReactNode; onSubmit?: (e: React.FormEvent) => void }) {
  return (
    <AccessStage>
      <div className="w-full max-w-[380px] flex flex-col items-stretch">
        <AccessTitle title="Área do Músico" subtitle="Rede local do palco. Funciona sem internet, só precisa estar no mesmo Wi-Fi do Mac do diretor." />
        <AccessCard label={label} status={status} width={380}>
          <form onSubmit={onSubmit} className="p-5 space-y-3">{children}</form>
        </AccessCard>
      </div>
    </AccessStage>
  );
}

// Campo rebaixado no painel (acende âmbar ao digitar). O rótulo fica visível: os textos dentro
// do campo são só exemplos.
function Field({ id, label, icon: Icon, ...props }: { id: string; label: string; icon: typeof User } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div>
      <label htmlFor={id} className="console-legend block mb-1.5">{label}</label>
      <div className="access-input relative">
        <Icon size={15} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input id={id} className="access-field" {...props} />
      </div>
    </div>
  );
}

function PendingCard({ name, onLeave }: { name: string; onLeave: () => void }) {
  return (
    <Card label="Aguardando o diretor" status={<span className="console-led is-on-amber animate-pulse" />}>
      <p className="text-sm text-logic-text-dim leading-relaxed">
        {name ? `${name}, sua` : 'Sua'} conta foi criada. Assim que o diretor musical aprovar no programa, você entra sozinho por aqui.
      </p>
      <p className="flex items-center gap-2 text-xs text-logic-text-muted"><Loader2 size={14} className="animate-spin" /> Esperando a aprovação...</p>
      <button type="button" onClick={onLeave} className="access-link">
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
    <Card label={<><Wifi size={12} /> Rede local</>} onSubmit={submit}>
      <div className="console-well grid grid-cols-2 gap-1 p-1 rounded-md" role="tablist" aria-label="Entrar ou criar conta">
        {(['login', 'signup'] as const).map((t) => (
          <button
            key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => switchTab(t)}
            className={`console-key h-9 text-[0.98rem] ${tab === t ? 'is-lit-amber' : ''}`}
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

      {/* o aviso fica logo acima da tecla: no cadastro com o teclado aberto, um aviso no topo sai da tela */}
      {error && <AccessNotice tone="red"><p>{error}</p></AccessNotice>}
      <button type="submit" disabled={!ready || busy} className="access-key">
        {busy ? <Loader2 size={16} className="animate-spin" /> : <>{tab === 'signup' ? 'Criar conta' : 'Entrar'} <ArrowRight size={16} /></>}
      </button>
      <p className="text-xs text-logic-text-muted leading-relaxed">
        {tab === 'signup'
          ? 'O PIN aparece no programa do diretor, em Rede Local. Depois de criar, o diretor aprova e você entra só com usuário e senha.'
          : 'Suas cifras, partituras e anotações ficam na sua conta, guardadas no projeto do show.'}
      </p>
      {VERSION && <p className="text-2xs text-logic-text-muted/70 text-center"><span className="vs-brand">VS Stage</span> {VERSION}</p>}
    </Card>
  );
}
