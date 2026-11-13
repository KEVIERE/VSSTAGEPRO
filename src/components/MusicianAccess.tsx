import { useState, useEffect, useCallback, useId, useRef } from 'react';
import type { Session } from '@supabase/supabase-js';
import {
  Mail, Lock, User, Guitar, KeyRound, LogOut, Loader2, CheckCircle2,
  Clock, Ban, ChevronLeft, Ticket, ArrowRight, Settings, ClipboardPaste, WifiOff, Globe,
} from 'lucide-react';
import { AccessCard, AccessNotice, AccessStage, AccessTitle } from '@/components/access/AccessChrome';
import { clearLocalSession, supabase } from '@/lib/supabaseClient';
import { authRedirect } from '@/lib/authRedirect';
import { memberMemberships, memberJoin, memberClaimCode, memberUpdateProfile } from '@/lib/musicianApi';
import type { Membership } from '@/lib/musicianTypes';

const MEMBER_LS = 'vs_member_id';
const PENDING_POLL_MS = 5000;
// lista de shows da conta que não carregou (sem internet): tenta de novo sozinha
const RETRY_MIN_MS = 3000;
const RETRY_MAX_MS = 15000;

type AuthView = 'signin' | 'signup' | 'forgot' | 'recovery' | 'code';
type AccountView = 'home' | 'profile';

function friendlyError(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes('invalid login credentials')) return 'E-mail ou senha incorretos.';
  if (m.includes('email not confirmed')) return 'Falta confirmar seu e-mail: abra o link que enviamos para você. Não chegou? Toque em "Reenviar e-mail de confirmação".';
  if (m.includes('already registered') || m.includes('already been registered')) return 'Este e-mail já tem conta. Use "Entrar".';
  if (m.includes('password should be at least') || m.includes('weak')) return 'A senha precisa ter pelo menos 6 caracteres.';
  if (m.includes('invalid email') || m.includes('unable to validate email')) return 'E-mail inválido.';
  if (m.includes('rate limit') || m.includes('too many') || m.includes('too_many_attempts')) return 'Muitas tentativas. Aguarde alguns minutos.';
  if (m.includes('invalid_invite')) return 'Convite inválido. Peça um novo link ao diretor.';
  if (m.includes('invalid_code')) return 'Código inválido, ou a entrada por código foi desativada pelo diretor.';
  if (m.includes('already_claimed')) return 'Este código já está ligado a outra conta.';
  if (m.includes('already_member')) return 'Sua conta já faz parte deste show.';
  if (m.includes('name_required')) return 'Informe seu nome.';
  if (m.includes('limit')) return 'Este show atingiu o limite de músicos.';
  // Safari do iPhone: "TypeError: Load failed"; Chrome: "Failed to fetch"
  if (m.includes('fetch') || m.includes('network') || m.includes('load failed')) return 'Sem conexão. Verifique a internet.';
  return 'Algo deu errado. Tente novamente.';
}

// Campo rebaixado no painel (acende âmbar ao digitar), igual à entrada da Rede Local. O rótulo
// fica visível: o texto dentro do campo é só exemplo.
function Field({ label, icon: Icon, ...props }: { label: string; icon: typeof Mail } & React.InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="console-legend block mb-1.5">{label}</label>
      <div className="access-input relative">
        <Icon size={15} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input id={id} {...props} className="access-field" />
      </div>
    </div>
  );
}

/** Aviso num visor escuro com LED: vermelho para erro, verde para tudo certo. */
function Notice({ tone, children }: { tone: 'error' | 'ok'; children: React.ReactNode }) {
  return <AccessNotice tone={tone === 'error' ? 'red' : 'green'}><p>{children}</p></AccessNotice>;
}

/** Tecla principal acesa em âmbar, a mesma da entrada do programa. */
function PrimaryButton({ busy, children, ...props }: { busy?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button {...props} className="access-key">
      {busy && <Loader2 size={16} className="animate-spin" />}
      {children}
    </button>
  );
}

export default function MusicianAccess({
  invite, claimCode, autoEnter, initialView, initialCode = null, initialError = null, onEnterAccount, onEnterCode,
}: {
  invite: string | null;
  claimCode: string | null;
  autoEnter: boolean;
  initialView: AuthView;
  /** Código pessoal guardado neste aparelho, quando a entrada automática não deu: já vem preenchido */
  initialCode?: string | null;
  /** Por que a entrada automática não deu */
  initialError?: string | null;
  onEnterAccount: (memberId: string) => void;
  onEnterCode: (code: string) => Promise<string | null>;
}) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [authView, setAuthView] = useState<AuthView>(() => {
    const h = window.location.hash;
    return initialCode || h === '#musico' || h.startsWith('#m=') ? 'code' : initialView;
  });

  // supabase.auth.signOut() só atualiza a tela quando o servidor responde ao
  // pedido de invalidar a sessão — se a rede falhar ou demorar, quem clica em
  // "Sair" fica parado na mesma tela sem nenhum aviso. Aqui a saída é sempre
  // instantânea: o estado é zerado na hora do clique, sem esperar rede.
  const doSignOut = () => {
    localStorage.removeItem(MEMBER_LS);
    clearLocalSession();
    setSession(null);
  };

  useEffect(() => {
    let alive = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!alive) return;
      setSession(data.session);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === 'PASSWORD_RECOVERY') setAuthView('recovery');
    });
    return () => { alive = false; sub.subscription.unsubscribe(); };
  }, []);

  // Mesmo palco, logo e módulo da entrada do programa e da Área do Músico na Rede Local.
  return (
    <AccessStage>
      <div className="w-full max-w-[380px] flex flex-col items-stretch">
        <AccessTitle title="Área do Músico" subtitle="Suas cifras, partituras e anotações, ao vivo com o diretor musical." />
        <AccessCard label={<><Globe size={12} /> Show Online</>} width={380}>
          <div className="p-5">
            {!ready ? (
              <div className="flex justify-center py-8"><Loader2 className="animate-spin text-logic-text-muted" /></div>
            ) : session && authView !== 'recovery' ? (
              <AccountHome
                session={session} invite={invite} claimCode={claimCode} autoEnter={autoEnter}
                onEnter={onEnterAccount} onSignOut={doSignOut}
              />
            ) : (
              <AuthForms
                view={authView} setView={setAuthView} invite={invite} claimCode={claimCode} onEnterCode={onEnterCode}
                initialCode={initialCode} initialError={initialError}
              />
            )}
          </div>
        </AccessCard>
      </div>
    </AccessStage>
  );
}

function AuthForms({ view, setView, invite, claimCode, onEnterCode, initialCode, initialError }: {
  view: AuthView; setView: (v: AuthView) => void; invite: string | null; claimCode: string | null;
  onEnterCode: (code: string) => Promise<string | null>;
  initialCode: string | null; initialError: string | null;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [instrument, setInstrument] = useState('');
  const [code, setCode] = useState(initialCode ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(initialError);
  const [info, setInfo] = useState<string | null>(null);
  // e-mail da conta criada que ainda falta confirmar (mostra o botão de reenviar)
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);

  const go = (v: AuthView) => { setError(null); setInfo(null); setView(v); };
  // o link do e-mail de confirmação volta direto para a Área do Músico
  // (no app do Mac ou na Rede Local ele vai para o site, que abre em qualquer aparelho)
  const confirmRedirect = authRedirect(`${window.location.pathname}?musico=1`);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError(null); setInfo(null);
    try { await fn(); } catch (e) { setError(friendlyError((e as Error).message)); }
    finally { setBusy(false); }
  };

  const signIn = () => run(async () => {
    const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (err) {
      if (err.message.toLowerCase().includes('not confirmed')) setPendingEmail(email.trim());
      throw err;
    }
  });

  // Conta criada: se o servidor pede confirmação por e-mail, não há sessão ainda. Antes a tela
  // ficava parada e o músico achava que não tinha funcionado; agora avisa e leva para "Entrar".
  const signUp = () => run(async () => {
    if (!name.trim()) throw new Error('name_required');
    const addr = email.trim();
    const { data, error: err } = await supabase.auth.signUp({
      email: addr, password,
      options: {
        // musico: o e-mail de confirmação fala com o músico; convite: no primeiro login o pedido
        // para entrar no show sai sozinho (vale mesmo abrindo o e-mail em outro aparelho)
        data: { name: name.trim(), instrument: instrument.trim(), musico: true, ...(invite ? { convite: invite } : {}) },
        emailRedirectTo: confirmRedirect,
      },
    });
    if (err) throw err;
    // e-mail que já tem conta: o servidor responde sem erro, mas sem identidade nova
    if (data.user && (data.user.identities?.length ?? 0) === 0) throw new Error('already registered');
    if (!data.session) {
      setPendingEmail(addr);
      setPassword('');
      setView('signin');
      setInfo(`Conta criada! Enviamos um e-mail para ${addr}. Abra o link do e-mail para confirmar e depois entre aqui com sua senha.`);
    }
  });

  const resendConfirmation = () => run(async () => {
    if (!pendingEmail) return;
    const { error: err } = await supabase.auth.resend({ type: 'signup', email: pendingEmail, options: { emailRedirectTo: confirmRedirect } });
    if (err) throw err;
    setInfo(`Enviamos de novo para ${pendingEmail}. Veja também a caixa de spam.`);
  });

  const forgot = () => run(async () => {
    const redirectTo = authRedirect(`${window.location.pathname}?musico=1`);
    const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo });
    if (err) throw err;
    setInfo('Enviamos um e-mail com o link para criar uma nova senha.');
  });

  const recover = () => run(async () => {
    if (password.length < 6) throw new Error('password should be at least 6');
    const { error: err } = await supabase.auth.updateUser({ password });
    if (err) throw err;
    window.history.replaceState(null, '', `${window.location.pathname}#musico`);
    setView('signin');
  });

  const enterCode = () => run(async () => {
    const msg = await onEnterCode(code);
    if (msg) setError(msg);
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (view === 'signin') signIn();
    else if (view === 'signup') signUp();
    else if (view === 'forgot') forgot();
    else if (view === 'recovery') recover();
    else enterCode();
  };

  const subtitle: Record<AuthView, string> = {
    signin: invite ? 'Entre para pedir acesso ao show' : 'Entre na sua conta',
    signup: claimCode ? 'Crie sua conta e mantenha suas cifras' : 'Crie sua conta de músico',
    forgot: 'Recuperar senha',
    recovery: 'Escolha uma nova senha',
    code: 'Entrar com código pessoal',
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      {(view === 'signin' || view === 'signup') && (
        <div className="console-well grid grid-cols-2 gap-1 p-1 rounded-md" role="tablist" aria-label="Entrar ou criar conta">
          {(['signin', 'signup'] as const).map((v) => (
            <button
              key={v} type="button" role="tab" aria-selected={view === v} onClick={() => go(v)}
              className={`console-key h-9 text-[0.98rem] ${view === v ? 'is-lit-amber' : ''}`}
            >
              {v === 'signin' ? 'Entrar' : 'Criar conta'}
            </button>
          ))}
        </div>
      )}
      <p className="text-sm text-logic-text-dim text-center">{subtitle[view]}</p>

      {error && <Notice tone="error">{error}</Notice>}
      {info && <Notice tone="ok">{info}</Notice>}
      {pendingEmail && view === 'signin' && (
        <button
          type="button"
          onClick={resendConfirmation}
          disabled={busy}
          className="access-link w-full disabled:opacity-50"
        >
          Reenviar e-mail de confirmação
        </button>
      )}

      {view === 'signup' && (
        <>
          <Field label="Seu nome" icon={User} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: João" autoComplete="name" maxLength={60} autoFocus />
          <Field label="Instrumento" icon={Guitar} value={instrument} onChange={(e) => setInstrument(e.target.value)} placeholder="Ex.: Guitarra" maxLength={40} />
        </>
      )}
      {(view === 'signin' || view === 'signup' || view === 'forgot') && (
        <Field
          label="E-mail" icon={Mail} type="email" value={email} onChange={(e) => setEmail(e.target.value)}
          placeholder="seu@email.com" autoComplete="email" autoCapitalize="none" required autoFocus={view !== 'signup'}
        />
      )}
      {(view === 'signin' || view === 'signup' || view === 'recovery') && (
        <Field
          label={view === 'recovery' ? 'Senha nova' : 'Senha'} icon={Lock} type="password" value={password} onChange={(e) => setPassword(e.target.value)}
          placeholder={view === 'signin' ? 'Sua senha' : 'Mínimo 6 caracteres'}
          autoComplete={view === 'signin' ? 'current-password' : 'new-password'} required minLength={6}
          autoFocus={view === 'recovery'}
        />
      )}
      {view === 'code' && (
        <>
          <p className="text-xs text-logic-text-dim text-center leading-relaxed">
            Digite a senha que o diretor mandou junto com o link (ex.: ABCD-1234).
          </p>
          {/* o código aceso em âmbar no visor do campo, como no display da mesa */}
          <div className="flex gap-2">
            <input
              autoFocus value={code} onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="ABCD-1234" maxLength={20} aria-label="Código pessoal"
              autoCapitalize="characters" autoComplete="off" autoCorrect="off" spellCheck={false}
              className="access-field is-plain flex-1 min-w-0 !h-12 text-center !text-lg font-mono tracking-widest !text-logic-lcd-amber"
            />
            <button
              type="button"
              title="Colar"
              onClick={async () => { try { setCode((await navigator.clipboard.readText()).trim().toUpperCase().slice(0, 20)); } catch { /* sem permissão */ } }}
              className="console-key h-12 px-3 text-xs flex items-center gap-1.5 shrink-0"
            >
              <ClipboardPaste size={14} /> Colar
            </button>
          </div>
        </>
      )}

      <PrimaryButton type="submit" busy={busy} disabled={busy || (view === 'code' && code.replace(/[^A-Za-z0-9]/g, '').length < 8)}>
        {view === 'signin' && 'Entrar'}
        {view === 'signup' && 'Criar conta'}
        {view === 'forgot' && 'Enviar link'}
        {view === 'recovery' && 'Salvar nova senha'}
        {view === 'code' && 'Entrar com código'}
      </PrimaryButton>

      <div className="flex flex-col items-center gap-2 pt-2">
        {view === 'signin' && (
          <button type="button" onClick={() => go('forgot')} className="access-link">
            Esqueci minha senha
          </button>
        )}
        {(view === 'forgot' || view === 'code') && (
          <button type="button" onClick={() => go('signin')} className="access-link flex items-center gap-1">
            <ChevronLeft size={12} /> Voltar para entrar
          </button>
        )}
        {(view === 'signin' || view === 'signup') && !claimCode && (
          <button type="button" onClick={() => go('code')} className="access-link flex items-center gap-1">
            <KeyRound size={12} /> Tenho um código pessoal do diretor
          </button>
        )}
      </div>
    </form>
  );
}

function AccountHome({ session, invite, claimCode, autoEnter, onEnter, onSignOut }: {
  session: Session; invite: string | null; claimCode: string | null; autoEnter: boolean;
  onEnter: (memberId: string) => void; onSignOut: () => void;
}) {
  const meta = (session.user.user_metadata ?? {}) as { name?: string; instrument?: string; convite?: string | null };
  const [view, setView] = useState<AccountView>('home');
  const [memberships, setMemberships] = useState<Membership[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [joinCode, setJoinCode] = useState(invite ?? '');
  const [joinName, setJoinName] = useState(meta.name ?? '');
  const [joinInstr, setJoinInstr] = useState(meta.instrument ?? '');
  const [oldCode, setOldCode] = useState('');
  const [showOldCode, setShowOldCode] = useState(false);
  const [justApproved, setJustApproved] = useState<string | null>(null);
  // pedido recusado pelo diretor (o pedido some da lista ou fica bloqueado): nome do show
  const [refused, setRefused] = useState<string | null>(null);
  const prevRef = useRef<Map<string, Membership>>(new Map());
  const enterTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (enterTimer.current) clearTimeout(enterTimer.current); }, []);
  const claimedRef = useRef(false);
  const autoJoinRef = useRef(false);
  const [autoJoining, setAutoJoining] = useState(false);
  const autoRef = useRef(autoEnter);
  // A lista de shows ainda não carregou nenhuma vez (sem internet ao abrir): tenta de novo
  // sozinha. Refs porque o refresh nasce uma vez só e veria sempre o estado do começo.
  const loadedRef = useRef(false);
  const aliveRef = useRef(true);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryDelay = useRef(RETRY_MIN_MS);
  const refreshRef = useRef<() => Promise<void>>(async () => {});
  // separado de `error`: o aviso some quando a lista chega, sem apagar outro erro da tela
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      if (retryRef.current) { clearTimeout(retryRef.current); retryRef.current = null; }
    };
  }, []);

  const enter = useCallback((id: string) => {
    localStorage.setItem(MEMBER_LS, id);
    onEnter(id);
  }, [onEnter]);

  const refresh = useCallback(async () => {
    try {
      const list = await memberMemberships();
      loadedRef.current = true;
      retryDelay.current = RETRY_MIN_MS;
      setOffline(false);
      const prev = prevRef.current;
      const wasPending = (id: string) => prev.get(id)?.status === 'pending';
      const approvedNow = list.find((m) => m.status === 'approved' && wasPending(m.id));
      const refusedNow = [...prev.values()].find((p) => p.status === 'pending'
        && !list.some((m) => m.id === p.id && m.status !== 'blocked'));
      prevRef.current = new Map(list.map((m) => [m.id, m]));
      setMemberships(list);
      if (refusedNow) setRefused(refusedNow.show_name);
      if (approvedNow) {
        // liberado: mostra o aviso verde e entra sozinho no show
        setJustApproved(approvedNow.id);
        if (enterTimer.current) clearTimeout(enterTimer.current);
        enterTimer.current = setTimeout(() => enter(approvedNow.id), 1800);
      }
      if (autoRef.current && !invite) {
        autoRef.current = false;
        const saved = localStorage.getItem(MEMBER_LS);
        const approved = list.filter((m) => m.status === 'approved');
        const target = approved.find((m) => m.id === saved) ?? (approved.length === 1 && list.length === 1 ? approved[0] : null);
        if (target) enter(target.id);
      }
    } catch (e) {
      if (!loadedRef.current) {
        if (!aliveRef.current) return;
        setOffline(true);
        if (retryRef.current) clearTimeout(retryRef.current);
        retryRef.current = setTimeout(() => { retryRef.current = null; void refreshRef.current(); }, retryDelay.current);
        retryDelay.current = Math.min(retryDelay.current * 2, RETRY_MAX_MS);
        return;
      }
      setError(friendlyError((e as Error).message));
    }
  }, [invite, enter]);
  refreshRef.current = refresh;

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    if (!claimCode || claimedRef.current) return;
    claimedRef.current = true;
    (async () => {
      setBusy(true);
      try {
        const id = await memberClaimCode(claimCode);
        enter(id);
      } catch (e) { setError(friendlyError((e as Error).message)); }
      finally { setBusy(false); }
    })();
  }, [claimCode, enter]);

  // Primeiro login de quem criou a conta pelo convite: pede para entrar sem precisar preencher nada.
  // O convite guardado no cadastro é apagado depois, para não pedir de novo se o diretor recusar.
  const autoInvite = invite ?? (typeof meta.convite === 'string' ? meta.convite : null);
  useEffect(() => {
    if (memberships === null || autoJoinRef.current || claimCode) return;
    if (!autoInvite || !(meta.name ?? '').trim()) return;
    autoJoinRef.current = true;
    (async () => {
      setBusy(true);
      setAutoJoining(true);
      try {
        const res = await memberJoin(autoInvite, meta.name ?? '', meta.instrument ?? '');
        if (invite) window.history.replaceState(null, '', `${window.location.pathname}#musico`);
        if (res.status === 'approved') enter(res.id);
        else await refresh();
      } catch (e) {
        setError(friendlyError((e as Error).message));
      } finally {
        setBusy(false);
        setAutoJoining(false);
        if (meta.convite) void supabase.auth.updateUser({ data: { convite: null } }).catch(() => {});
      }
    })();
  }, [memberships, autoInvite, invite, claimCode, meta.name, meta.instrument, meta.convite, enter, refresh]);

  const hasPending = memberships?.some((m) => m.status === 'pending') ?? false;
  useEffect(() => {
    if (!hasPending) return;
    const id = setInterval(refresh, PENDING_POLL_MS);
    return () => clearInterval(id);
  }, [hasPending, refresh]);

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const res = await memberJoin(joinCode, joinName, joinInstr);
      if (invite) window.history.replaceState(null, '', `${window.location.pathname}#musico`);
      setJoinCode('');
      setRefused(null);
      if (res.status === 'approved') enter(res.id);
      else await refresh();
    } catch (err) { setError(friendlyError((err as Error).message)); }
    finally { setBusy(false); }
  };

  const handleClaim = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try { enter(await memberClaimCode(oldCode)); }
    catch (err) { setError(friendlyError((err as Error).message)); }
    finally { setBusy(false); }
  };

  if (view === 'profile') {
    return <ProfileEditor session={session} onBack={() => { setView('home'); refresh(); }} />;
  }

  const displayName = meta.name || session.user.email;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg bg-logic-bg-panel border border-logic-border-dark">
        <div className="min-w-0">
          <p className="text-sm font-medium text-logic-text truncate">{displayName}</p>
          <p className="text-2xs text-logic-text-muted truncate">{session.user.email}</p>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button onClick={() => setView('profile')} title="Editar perfil" className="p-2 rounded text-logic-text-muted hover:text-logic-text hover:bg-logic-bg-elevated transition-colors">
            <Settings size={15} />
          </button>
          <button onClick={onSignOut} title="Sair da conta" className="p-2 rounded text-logic-text-muted hover:text-logic-lcd-red hover:bg-logic-bg-elevated transition-colors">
            <LogOut size={15} />
          </button>
        </div>
      </div>

      {error && <Notice tone="error">{error}</Notice>}
      {refused && (
        <Notice tone="error">
          O diretor musical não liberou sua entrada no show "{refused}". Fale com ele e, se for o caso, peça o convite de novo.
        </Notice>
      )}

      {memberships === null ? (
        <div className="flex flex-col items-center gap-2 py-6">
          <Loader2 className="animate-spin text-logic-text-muted" />
          {offline && (
            <p className="flex items-center justify-center gap-2 text-xs text-logic-text-dim">
              <WifiOff size={14} className="flex-shrink-0" /> Sem internet. Tentando de novo...
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {(autoJoining || memberships.some((m) => m.status === 'pending')) && <WaitingCard />}
          {memberships.some((m) => m.status !== 'pending') && (
            <p className="text-2xs uppercase tracking-wider text-logic-text-muted px-1">Meus shows</p>
          )}
          {memberships.filter((m) => m.status !== 'pending').map((m) => (
            <MembershipCard key={m.id} m={m} highlight={justApproved === m.id} onEnter={() => enter(m.id)} />
          ))}
        </div>
      )}

      {memberships !== null && !hasPending && !justApproved && !autoJoining && (
        <form onSubmit={handleJoin} className="space-y-2.5 p-3 rounded-lg bg-logic-bg-panel border border-logic-border-dark">
          <p className="text-xs font-medium text-logic-text flex items-center gap-1.5">
            <Ticket size={14} className="text-logic-accent" />
            {invite ? 'Você foi convidado para um show' : 'Entrar em um show'}
          </p>
          {!invite && (
            <Field label="Código do convite" icon={Ticket} value={joinCode} onChange={(e) => setJoinCode(e.target.value.toUpperCase())} placeholder="O código que o diretor mandou" autoCapitalize="characters" autoComplete="off" maxLength={20} />
          )}
          <Field label="Seu nome" icon={User} value={joinName} onChange={(e) => setJoinName(e.target.value)} placeholder="Ex.: João" autoComplete="name" maxLength={60} />
          <Field label="Instrumento" icon={Guitar} value={joinInstr} onChange={(e) => setJoinInstr(e.target.value)} placeholder="Ex.: Baixo" maxLength={40} />
          <PrimaryButton type="submit" busy={busy} disabled={busy || !joinName.trim() || joinCode.replace(/[^A-Za-z0-9]/g, '').length < 6}>
            Pedir para entrar <ArrowRight size={14} />
          </PrimaryButton>
          <p className="text-2xs text-logic-text-muted text-center">O diretor musical libera sua entrada só na primeira vez. Depois você entra direto.</p>
        </form>
      )}

      {memberships !== null && !hasPending && !justApproved && !autoJoining && (
        showOldCode ? (
          <form onSubmit={handleClaim} className="space-y-2.5 p-3 rounded-lg bg-logic-bg-panel border border-logic-border-dark">
            <p className="text-xs text-logic-text-dim leading-relaxed">
              Digite o código pessoal que o diretor te passou. Ele fica ligado à sua conta, com todas as suas cifras.
            </p>
            <Field label="Código pessoal" icon={KeyRound} value={oldCode} onChange={(e) => setOldCode(e.target.value.toUpperCase())} placeholder="ABCD-1234" autoCapitalize="characters" autoComplete="off" maxLength={20} />
            <PrimaryButton type="submit" busy={busy} disabled={busy || oldCode.replace(/[^A-Za-z0-9]/g, '').length < 8}>
              Ligar à minha conta
            </PrimaryButton>
          </form>
        ) : (
          <button type="button" onClick={() => setShowOldCode(true)} className="access-link w-full flex items-center justify-center gap-1">
            <KeyRound size={12} /> Tenho um código pessoal antigo
          </button>
        )
      )}
    </div>
  );
}

/** Pedido enviado: só a frase, até o diretor musical liberar (acontece só no primeiro login). */
function WaitingCard() {
  return (
    <div className="console-display rounded-lg px-4 py-6 flex items-center justify-center gap-2.5 text-center" role="status" aria-live="polite">
      <span className="console-led is-on-amber is-lg animate-pulse shrink-0" aria-hidden />
      <p className="console-glow font-stage font-semibold text-[19px] leading-tight text-logic-lcd-amber">
        Aguardando liberação do diretor musical
      </p>
    </div>
  );
}

function MembershipCard({ m, highlight, onEnter }: { m: Membership; highlight: boolean; onEnter: () => void }) {
  if (m.status === 'approved') {
    return (
      <button
        onClick={onEnter}
        className={`group w-full flex items-center gap-3 px-3 py-3 rounded-lg border text-left transition-all ${
          highlight ? 'bg-logic-lcd-green/15 border-logic-lcd-green/60 animate-pulse' : 'bg-logic-bg-panel border-logic-border-light hover:border-logic-accent'
        }`}
      >
        <CheckCircle2 size={18} className="text-logic-lcd-green flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-logic-text truncate">{m.show_name}</p>
          <p className={`text-2xs truncate ${highlight ? 'text-logic-lcd-green font-medium' : 'text-logic-text-muted'}`}>{highlight ? 'Liberado pelo diretor! Entrando no show…' : `${m.name}${m.instrument ? ` · ${m.instrument}` : ''}`}</p>
        </div>
        <ArrowRight size={16} className="text-logic-text-muted group-hover:text-logic-accent group-hover:translate-x-0.5 transition-all" />
      </button>
    );
  }
  const pending = m.status === 'pending';
  return (
    <div className={`flex items-center gap-3 px-3 py-3 rounded-lg border ${pending ? 'bg-logic-lcd-amber/10 border-logic-lcd-amber/40' : 'bg-logic-lcd-red/10 border-logic-lcd-red/40'}`}>
      {pending ? <Clock size={18} className="text-logic-lcd-amber flex-shrink-0 animate-pulse" /> : <Ban size={18} className="text-logic-lcd-red flex-shrink-0" />}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-logic-text truncate">{m.show_name}</p>
        <p className={`text-2xs ${pending ? 'text-logic-lcd-amber' : 'text-logic-lcd-red'}`}>
          {pending ? 'Aguardando aprovação do diretor...' : 'Acesso bloqueado pelo diretor'}
        </p>
      </div>
    </div>
  );
}

function ProfileEditor({ session, onBack }: { session: Session; onBack: () => void }) {
  const meta = (session.user.user_metadata ?? {}) as { name?: string; instrument?: string };
  const [name, setName] = useState(meta.name ?? '');
  const [instrument, setInstrument] = useState(meta.instrument ?? '');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null); setInfo(null);
    try {
      if (!name.trim()) throw new Error('name_required');
      if (password && password.length < 6) throw new Error('password should be at least 6');
      await memberUpdateProfile(name, instrument);
      const { error: err } = await supabase.auth.updateUser({
        data: { name: name.trim(), instrument: instrument.trim() },
        ...(password ? { password } : {}),
      });
      if (err) throw err;
      setPassword('');
      setInfo('Perfil salvo.');
    } catch (err) { setError(friendlyError((err as Error).message)); }
    finally { setBusy(false); }
  };

  return (
    <form onSubmit={save} className="space-y-3">
      <button type="button" onClick={onBack} className="access-link flex items-center gap-1">
        <ChevronLeft size={12} /> Voltar
      </button>
      <p className="text-sm font-medium text-logic-text">Meu perfil</p>
      {error && <Notice tone="error">{error}</Notice>}
      {info && <Notice tone="ok">{info}</Notice>}
      <Field label="Seu nome" icon={User} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: João" autoComplete="name" maxLength={60} />
      <Field label="Instrumento" icon={Guitar} value={instrument} onChange={(e) => setInstrument(e.target.value)} placeholder="Ex.: Baixo" maxLength={40} />
      <Field label="Senha nova" icon={Lock} type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Deixe vazio para manter a atual" autoComplete="new-password" />
      <PrimaryButton type="submit" busy={busy} disabled={busy}>Salvar</PrimaryButton>
    </form>
  );
}
