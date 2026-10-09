import { useState, useEffect, useCallback, useRef } from 'react';
import type { Session } from '@supabase/supabase-js';
import {
  Music, Mail, Lock, User, Guitar, KeyRound, LogOut, Loader2, CheckCircle2,
  Clock, Ban, ChevronLeft, Ticket, ArrowRight, Settings, ClipboardPaste,
} from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { memberMemberships, memberJoin, memberClaimCode, memberUpdateProfile } from '@/lib/musicianApi';
import type { Membership } from '@/lib/musicianTypes';

const MEMBER_LS = 'vs_member_id';
const PENDING_POLL_MS = 5000;

type AuthView = 'signin' | 'signup' | 'forgot' | 'recovery' | 'code';
type AccountView = 'home' | 'profile';

const inputCls = 'w-full bg-logic-bg-panel text-sm text-logic-text pl-9 pr-3 py-2.5 rounded-lg border border-logic-border-light outline-none focus:border-logic-accent transition-colors placeholder:text-logic-text-muted';

function friendlyError(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes('invalid login credentials')) return 'E-mail ou senha incorretos.';
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
  if (m.includes('fetch') || m.includes('network')) return 'Sem conexão. Verifique a internet.';
  return 'Algo deu errado. Tente novamente.';
}

function Field({ icon: Icon, ...props }: { icon: typeof Mail } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="relative">
      <Icon size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-logic-text-muted pointer-events-none" />
      <input {...props} className={inputCls} />
    </div>
  );
}

function Notice({ tone, children }: { tone: 'error' | 'ok'; children: React.ReactNode }) {
  const cls = tone === 'error'
    ? 'bg-logic-lcd-red/15 border-logic-lcd-red/40 text-logic-lcd-red'
    : 'bg-logic-lcd-green/15 border-logic-lcd-green/40 text-logic-lcd-green';
  return <div className={`px-3 py-2 rounded-lg border text-xs text-center leading-relaxed ${cls}`}>{children}</div>;
}

function PrimaryButton({ busy, children, ...props }: { busy?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className="w-full py-2.5 rounded-lg bg-logic-accent text-white text-sm font-medium hover:bg-logic-accent-hover transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
    >
      {busy && <Loader2 size={15} className="animate-spin" />}
      {children}
    </button>
  );
}

export default function MusicianAccess({
  invite, claimCode, autoEnter, initialView, onEnterAccount, onEnterCode,
}: {
  invite: string | null;
  claimCode: string | null;
  autoEnter: boolean;
  initialView: AuthView;
  onEnterAccount: (memberId: string) => void;
  onEnterCode: (code: string) => Promise<string | null>;
}) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [authView, setAuthView] = useState<AuthView>(() => {
    const h = window.location.hash;
    return h === '#musico' || h.startsWith('#m=') ? 'code' : initialView;
  });

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

  return (
    <div className="flex items-center justify-center bg-logic-bg-deep p-4 overflow-y-auto logic-scroll" style={{ height: '100%' }}>
      <div className="w-full max-w-sm py-6">
        <div className="text-center mb-6">
          <div className="mx-auto mb-3 w-14 h-14 rounded-2xl bg-logic-lcd-green/10 border border-logic-lcd-green/30 flex items-center justify-center">
            <Music size={28} className="text-logic-lcd-green" />
          </div>
          <h1 className="text-xl font-semibold text-logic-text">Área do Músico</h1>
        </div>
        {!ready ? (
          <div className="flex justify-center py-8"><Loader2 className="animate-spin text-logic-text-muted" /></div>
        ) : session && authView !== 'recovery' ? (
          <AccountHome
            session={session} invite={invite} claimCode={claimCode} autoEnter={autoEnter}
            onEnter={onEnterAccount}
          />
        ) : (
          <AuthForms view={authView} setView={setAuthView} hasInvite={!!invite} claimCode={claimCode} onEnterCode={onEnterCode} />
        )}
      </div>
    </div>
  );
}

function AuthForms({ view, setView, hasInvite, claimCode, onEnterCode }: {
  view: AuthView; setView: (v: AuthView) => void; hasInvite: boolean; claimCode: string | null;
  onEnterCode: (code: string) => Promise<string | null>;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [instrument, setInstrument] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const go = (v: AuthView) => { setError(null); setInfo(null); setView(v); };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError(null); setInfo(null);
    try { await fn(); } catch (e) { setError(friendlyError((e as Error).message)); }
    finally { setBusy(false); }
  };

  const signIn = () => run(async () => {
    const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (err) throw err;
  });

  const signUp = () => run(async () => {
    if (!name.trim()) throw new Error('name_required');
    const { error: err } = await supabase.auth.signUp({
      email: email.trim(), password,
      options: { data: { name: name.trim(), instrument: instrument.trim() } },
    });
    if (err) throw err;
  });

  const forgot = () => run(async () => {
    const redirectTo = `${window.location.origin}${window.location.pathname}?musico=1`;
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
    signin: hasInvite ? 'Entre para pedir acesso ao show' : 'Entre na sua conta',
    signup: claimCode ? 'Crie sua conta e mantenha suas cifras' : 'Crie sua conta de músico',
    forgot: 'Recuperar senha',
    recovery: 'Escolha uma nova senha',
    code: 'Entrar com código pessoal',
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <p className="text-sm text-logic-text-muted text-center -mt-3 mb-4">{subtitle[view]}</p>

      {(view === 'signin' || view === 'signup') && (
        <div className="grid grid-cols-2 p-1 rounded-lg bg-logic-bg-panel border border-logic-border-dark mb-1">
          {(['signin', 'signup'] as const).map((v) => (
            <button
              key={v} type="button" onClick={() => go(v)}
              className={`py-1.5 rounded-md text-xs font-medium transition-colors ${
                view === v ? 'bg-logic-bg-elevated text-logic-text shadow' : 'text-logic-text-muted hover:text-logic-text'
              }`}
            >
              {v === 'signin' ? 'Entrar' : 'Criar conta'}
            </button>
          ))}
        </div>
      )}

      {error && <Notice tone="error">{error}</Notice>}
      {info && <Notice tone="ok">{info}</Notice>}

      {view === 'signup' && (
        <>
          <Field icon={User} value={name} onChange={(e) => setName(e.target.value)} placeholder="Seu nome" maxLength={60} autoFocus />
          <Field icon={Guitar} value={instrument} onChange={(e) => setInstrument(e.target.value)} placeholder="Instrumento (ex.: Guitarra)" maxLength={40} />
        </>
      )}
      {(view === 'signin' || view === 'signup' || view === 'forgot') && (
        <Field
          icon={Mail} type="email" value={email} onChange={(e) => setEmail(e.target.value)}
          placeholder="E-mail" autoComplete="email" required autoFocus={view !== 'signup'}
        />
      )}
      {(view === 'signin' || view === 'signup' || view === 'recovery') && (
        <Field
          icon={Lock} type="password" value={password} onChange={(e) => setPassword(e.target.value)}
          placeholder={view === 'recovery' ? 'Nova senha (mín. 6 caracteres)' : 'Senha'}
          autoComplete={view === 'signin' ? 'current-password' : 'new-password'} required minLength={6}
          autoFocus={view === 'recovery'}
        />
      )}
      {view === 'code' && (
        <>
          <p className="text-xs text-logic-text-dim text-center leading-relaxed">
            Digite a senha que o diretor mandou junto com o link (ex.: ABCD-1234).
          </p>
          <div className="flex gap-2">
            <input
              autoFocus value={code} onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="ABCD-1234" maxLength={20}
              className="flex-1 min-w-0 text-center text-lg font-mono tracking-widest bg-logic-bg-panel text-logic-lcd-amber px-4 py-3 rounded-lg border border-logic-border-light outline-none focus:border-logic-accent"
            />
            <button
              type="button"
              title="Colar"
              onClick={async () => { try { setCode((await navigator.clipboard.readText()).trim().toUpperCase().slice(0, 20)); } catch { /* sem permissão */ } }}
              className="flex items-center gap-1.5 px-3 rounded-lg border border-logic-border-light text-xs text-logic-text-dim hover:text-logic-text hover:border-logic-accent transition-colors"
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
          <button type="button" onClick={() => go('forgot')} className="text-xs text-logic-text-muted hover:text-logic-text transition-colors">
            Esqueci minha senha
          </button>
        )}
        {(view === 'forgot' || view === 'code') && (
          <button type="button" onClick={() => go('signin')} className="text-xs text-logic-text-muted hover:text-logic-text transition-colors flex items-center gap-1">
            <ChevronLeft size={12} /> Voltar para entrar
          </button>
        )}
        {(view === 'signin' || view === 'signup') && !claimCode && (
          <button type="button" onClick={() => go('code')} className="text-xs text-logic-text-muted hover:text-logic-lcd-amber transition-colors flex items-center gap-1">
            <KeyRound size={12} /> Tenho um código pessoal do diretor
          </button>
        )}
      </div>
    </form>
  );
}

function AccountHome({ session, invite, claimCode, autoEnter, onEnter }: {
  session: Session; invite: string | null; claimCode: string | null; autoEnter: boolean;
  onEnter: (memberId: string) => void;
}) {
  const meta = (session.user.user_metadata ?? {}) as { name?: string; instrument?: string };
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
  const prevRef = useRef<Map<string, string>>(new Map());
  const claimedRef = useRef(false);
  const autoRef = useRef(autoEnter);

  const enter = useCallback((id: string) => {
    localStorage.setItem(MEMBER_LS, id);
    onEnter(id);
  }, [onEnter]);

  const refresh = useCallback(async () => {
    try {
      const list = await memberMemberships();
      const prev = prevRef.current;
      const approvedNow = list.find((m) => m.status === 'approved' && prev.get(m.id) === 'pending');
      prevRef.current = new Map(list.map((m) => [m.id, m.status]));
      setMemberships(list);
      if (approvedNow) setJustApproved(approvedNow.id);
      if (autoRef.current && !invite) {
        autoRef.current = false;
        const saved = localStorage.getItem(MEMBER_LS);
        const approved = list.filter((m) => m.status === 'approved');
        const target = approved.find((m) => m.id === saved) ?? (approved.length === 1 && list.length === 1 ? approved[0] : null);
        if (target) enter(target.id);
      }
    } catch (e) {
      setError(friendlyError((e as Error).message));
    }
  }, [invite, enter]);

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

  const signOut = async () => {
    localStorage.removeItem(MEMBER_LS);
    await supabase.auth.signOut();
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
          <button onClick={signOut} title="Sair da conta" className="p-2 rounded text-logic-text-muted hover:text-logic-lcd-red hover:bg-logic-bg-elevated transition-colors">
            <LogOut size={15} />
          </button>
        </div>
      </div>

      {error && <Notice tone="error">{error}</Notice>}

      {memberships === null ? (
        <div className="flex justify-center py-6"><Loader2 className="animate-spin text-logic-text-muted" /></div>
      ) : (
        <div className="space-y-2">
          {memberships.length > 0 && <p className="text-2xs uppercase tracking-wider text-logic-text-muted px-1">Meus shows</p>}
          {memberships.map((m) => (
            <MembershipCard key={m.id} m={m} highlight={justApproved === m.id} onEnter={() => enter(m.id)} />
          ))}
        </div>
      )}

      {memberships !== null && (
        <form onSubmit={handleJoin} className="space-y-2.5 p-3 rounded-lg bg-logic-bg-panel border border-logic-border-dark">
          <p className="text-xs font-medium text-logic-text flex items-center gap-1.5">
            <Ticket size={14} className="text-logic-accent" />
            {invite ? 'Você foi convidado para um show' : 'Entrar em um show'}
          </p>
          {!invite && (
            <Field icon={Ticket} value={joinCode} onChange={(e) => setJoinCode(e.target.value.toUpperCase())} placeholder="Código do convite" maxLength={20} />
          )}
          <Field icon={User} value={joinName} onChange={(e) => setJoinName(e.target.value)} placeholder="Seu nome" maxLength={60} />
          <Field icon={Guitar} value={joinInstr} onChange={(e) => setJoinInstr(e.target.value)} placeholder="Instrumento" maxLength={40} />
          <PrimaryButton type="submit" busy={busy} disabled={busy || !joinName.trim() || joinCode.replace(/[^A-Za-z0-9]/g, '').length < 6}>
            Pedir para entrar <ArrowRight size={14} />
          </PrimaryButton>
          <p className="text-2xs text-logic-text-muted text-center">O diretor precisa aprovar uma única vez.</p>
        </form>
      )}

      {memberships !== null && (
        showOldCode ? (
          <form onSubmit={handleClaim} className="space-y-2.5 p-3 rounded-lg bg-logic-bg-panel border border-logic-border-dark">
            <p className="text-xs text-logic-text-dim leading-relaxed">
              Digite o código pessoal que o diretor te passou. Ele fica ligado à sua conta, com todas as suas cifras.
            </p>
            <Field icon={KeyRound} value={oldCode} onChange={(e) => setOldCode(e.target.value.toUpperCase())} placeholder="ABCD-1234" maxLength={20} />
            <PrimaryButton type="submit" busy={busy} disabled={busy || oldCode.replace(/[^A-Za-z0-9]/g, '').length < 8}>
              Ligar à minha conta
            </PrimaryButton>
          </form>
        ) : (
          <button onClick={() => setShowOldCode(true)} className="w-full text-xs text-logic-text-muted hover:text-logic-lcd-amber transition-colors flex items-center justify-center gap-1">
            <KeyRound size={12} /> Tenho um código pessoal antigo
          </button>
        )
      )}
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
          <p className="text-2xs text-logic-text-muted truncate">{highlight ? 'Aprovado pelo diretor! Toque para entrar' : `${m.name}${m.instrument ? ` · ${m.instrument}` : ''}`}</p>
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
      <button type="button" onClick={onBack} className="text-xs text-logic-text-muted hover:text-logic-text transition-colors flex items-center gap-1">
        <ChevronLeft size={12} /> Voltar
      </button>
      <p className="text-sm font-medium text-logic-text">Meu perfil</p>
      {error && <Notice tone="error">{error}</Notice>}
      {info && <Notice tone="ok">{info}</Notice>}
      <Field icon={User} value={name} onChange={(e) => setName(e.target.value)} placeholder="Seu nome" maxLength={60} />
      <Field icon={Guitar} value={instrument} onChange={(e) => setInstrument(e.target.value)} placeholder="Instrumento" maxLength={40} />
      <Field icon={Lock} type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Nova senha (deixe vazio para manter)" autoComplete="new-password" />
      <PrimaryButton type="submit" busy={busy} disabled={busy}>Salvar</PrimaryButton>
    </form>
  );
}
