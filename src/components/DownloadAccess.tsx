import { useEffect, useState } from 'react';
import { Check, ChevronLeft, Eye, EyeOff, KeyRound, Loader2, Lock, Mail, Phone, User } from 'lucide-react';
import { maskPhone, normalizePhone } from '@/lib/authFlow';

const SAVED_EMAIL_LS = 'vs-download-login-email';

function savedLogin(): { email: string; remember: boolean } {
  try {
    const email = localStorage.getItem(SAVED_EMAIL_LS) ?? '';
    return { email, remember: Boolean(email) };
  } catch {
    return { email: '', remember: false };
  }
}
import type { Session } from '@supabase/supabase-js';
import { emailLinkType, supabase } from '@/lib/supabaseClient';
import { friendlyError } from '@/lib/friendlyError';
import VsLogo from '@/components/VsLogo';
import Field from '@/components/auth/Field';
import { CheckCircle2 } from 'lucide-react';

type View = 'signin' | 'signup' | 'forgot' | 'recovery';

const TITLES: Record<View, string> = {
  signin: 'ENTRAR',
  signup: 'CRIAR CONTA',
  forgot: 'RECUPERAR SENHA',
  recovery: 'NOVA SENHA',
};

// Gate da página de downloads: só libera os botões de baixar depois de
// entrar ou criar conta — a mesma conta usada para abrir o VS Stage.
export default function DownloadAccess({ children }: { children: (session: Session) => React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [view, setView] = useState<View>('signin');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState(() => savedLogin().email);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(() => savedLogin().remember);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorIsAlreadyRegistered, setErrorIsAlreadyRegistered] = useState(false);
  const [errorHasNoAccount, setErrorHasNoAccount] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  // "Confirmado" é mostrado quando a pessoa volta pelo link de confirmação do e-mail
  // e ainda não passou pela tela de entrada nesta aba.
  const [justConfirmed, setJustConfirmed] = useState(false);

  useEffect(() => {
    let alive = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!alive) return;
      setSession(data.session);
      setReady(true);
      if (data.session && emailLinkType === 'signup') setJustConfirmed(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === 'PASSWORD_RECOVERY') setView('recovery');
    });
    return () => { alive = false; sub.subscription.unsubscribe(); };
  }, []);

  const go = (v: View) => { setError(null); setErrorIsAlreadyRegistered(false); setErrorHasNoAccount(false); setInfo(null); setView(v); };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setErrorIsAlreadyRegistered(false);
    setErrorHasNoAccount(false);
    setInfo(null);
    try {
      if (view === 'signup') {
        if (!name.trim()) throw new Error('name_required');
        const normalizedPhone = normalizePhone(phone);
        if (!normalizedPhone) throw new Error('phone_invalid');
        const { data: signUpData, error: err } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { name: name.trim(), phone: normalizedPhone } },
        });
        if (err) throw err;
        // Por segurança, o Supabase não avisa quando o e-mail já existe: devolve um
        // usuário sem nenhuma "identity" em vez de erro. É assim que detectamos.
        if (signUpData.user && signUpData.user.identities?.length === 0) {
          throw new Error('already_registered');
        }
        if (!signUpData.session) {
          setInfo('Enviamos um e-mail de confirmação. Clique no link para ativar sua conta.');
          setBusy(false);
          return;
        }
      } else if (view === 'forgot') {
        const redirectTo = `${window.location.origin}${window.location.pathname}${window.location.search}#baixar`;
        const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo });
        if (err) throw err;
        setInfo('Enviamos um e-mail com o link para criar uma nova senha.');
      } else if (view === 'recovery') {
        if (password.length < 6) throw new Error('password should be at least 6');
        const { error: err } = await supabase.auth.updateUser({ password });
        if (err) throw err;
        window.history.replaceState(null, '', `${window.location.pathname}#baixar`);
        setView('signin');
      } else {
        const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (err) {
          // "E-mail ou senha incorretos" é ambíguo de propósito, mas se o e-mail nem
          // tem conta, é melhor apontar direto para "Criar conta" em vez de confundir.
          if (/invalid login credentials/i.test(err.message)) {
            const { data: exists } = await supabase.rpc('email_exists', { p_email: email.trim() });
            if (!exists) throw new Error('no_account_with_email');
          }
          throw err;
        }
        try {
          if (remember) localStorage.setItem(SAVED_EMAIL_LS, email.trim());
          else localStorage.removeItem(SAVED_EMAIL_LS);
        } catch { /* sem storage */ }
      }
    } catch (err) {
      const message = (err as Error).message;
      if (message === 'already_registered') setErrorIsAlreadyRegistered(true);
      if (message === 'no_account_with_email') setErrorHasNoAccount(true);
      setError(friendlyError(message));
    } finally {
      setBusy(false);
    }
  };

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-logic-bg-deep">
        <Loader2 className="animate-spin text-logic-text-muted" />
      </div>
    );
  }

  if (session) return <>{children(session)}</>;

  const signup = view === 'signup';

  return (
    <div className="min-h-screen bg-logic-bg-deep text-logic-text flex items-center justify-center p-6"
      style={{ background: 'radial-gradient(ellipse at top, #1b1c20 0%, #0a0b0d 70%)' }}>
      <div className="absolute inset-0 pointer-events-none overflow-hidden" aria-hidden="true">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[560px] h-[560px] rounded-full bg-logic-lcd-green/10 blur-3xl" />
      </div>
      <div className="relative w-[400px] max-w-full bg-logic-bg-panel border border-logic-border-light rounded-lg shadow-2xl overflow-hidden animate-[fadeIn_250ms_ease-out]">
        <div className="flex items-center px-4 h-9 border-b border-logic-border bg-logic-bg-elevated">
          <span className="text-2xs font-semibold tracking-widest text-logic-text-muted">{TITLES[view]}</span>
        </div>

        <form onSubmit={submit} className="px-6 pt-6 pb-5 space-y-3">
          <div className="text-center mb-5">
            {justConfirmed && (
              <div className="mb-4 px-3 py-2 rounded-lg border bg-logic-lcd-green/15 border-logic-lcd-green/40 text-logic-lcd-green text-xs flex items-center justify-center gap-1.5">
                <CheckCircle2 size={14} /> Conta criada com sucesso!
              </div>
            )}
            <div className="mx-auto w-20 h-20 mb-3 flex items-center justify-center">
              <VsLogo size={80} />
            </div>
            <h1 className="text-xl font-semibold">VS Stage Pro</h1>
            <p className="text-xs text-logic-text-dim mt-1">
              {view === 'signin' && 'Entre para liberar o download e seu teste grátis'}
              {view === 'signup' && 'Crie sua conta para liberar o download'}
              {view === 'forgot' && 'Enviamos um link para redefinir sua senha'}
              {view === 'recovery' && 'Escolha uma nova senha para continuar'}
            </p>
          </div>

          {(view === 'signin' || view === 'signup') && (
            <div className="grid grid-cols-2 p-1 rounded-lg bg-logic-bg-deep border border-logic-border-dark">
              {(['signin', 'signup'] as const).map((v) => (
                <button
                  key={v} type="button" onClick={() => go(v)}
                  className={`py-1.5 rounded-md text-xs font-medium transition-colors ${view === v ? 'bg-logic-bg-elevated text-logic-text shadow' : 'text-logic-text-muted hover:text-logic-text'}`}
                >
                  {v === 'signin' ? 'Entrar' : 'Criar conta'}
                </button>
              ))}
            </div>
          )}

          {error && (
            <div className="px-3 py-2 rounded-lg border bg-logic-lcd-red/15 border-logic-lcd-red/40 text-logic-lcd-red text-xs text-center space-y-1.5">
              <p>{error}</p>
              {errorIsAlreadyRegistered && (
                <button
                  type="button"
                  onClick={() => go('signin')}
                  className="text-logic-lcd-green font-semibold hover:underline"
                >
                  Ir para "Entrar"
                </button>
              )}
              {errorHasNoAccount && (
                <button
                  type="button"
                  onClick={() => go('signup')}
                  className="text-logic-lcd-green font-semibold hover:underline"
                >
                  Ir para "Criar conta"
                </button>
              )}
            </div>
          )}
          {info && (
            <div className="px-3 py-2 rounded-lg border bg-logic-lcd-green/15 border-logic-lcd-green/40 text-logic-lcd-green text-xs text-center">
              {info}
            </div>
          )}

          {signup && (
            <>
              <Field icon={User} value={name} onChange={(e) => setName(e.target.value)} placeholder="Seu nome" maxLength={60} autoFocus />
              <Field icon={Phone} type="tel" value={phone} onChange={(e) => setPhone(maskPhone(e.target.value))} placeholder="Seu telefone" autoComplete="tel" maxLength={20} required />
            </>
          )}
          {(view === 'signin' || view === 'signup' || view === 'forgot') && (
            <Field
              icon={Mail} type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="E-mail" autoComplete="email" required autoFocus={!signup && view !== 'forgot' ? true : view === 'forgot'}
            />
          )}
          {(view === 'signin' || view === 'signup' || view === 'recovery') && (
            <div className="relative">
              <Field
                icon={Lock} type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)}
                placeholder={view === 'recovery' ? 'Nova senha (mín. 6 caracteres)' : 'Senha'}
                autoComplete={view === 'signin' ? 'current-password' : 'new-password'} required minLength={6}
                autoFocus={view === 'recovery'}
                className="pr-9"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded text-logic-text-muted hover:text-logic-text transition"
              >
                {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          )}

          {view === 'signin' && (
            <button
              type="button" onClick={() => setRemember((v) => !v)}
              className="w-full flex items-center gap-2 text-xs text-logic-text-dim hover:text-logic-text transition"
            >
              <span className={`w-4 h-4 shrink-0 rounded flex items-center justify-center border transition-colors ${remember ? 'bg-logic-lcd-green border-logic-lcd-green' : 'border-logic-border-light'}`}>
                {remember && <Check size={11} className="text-black" strokeWidth={3} />}
              </span>
              Salvar para a próxima vez
            </button>
          )}

          <button
            type="submit" disabled={busy}
            className="w-full py-2.5 rounded-lg bg-logic-lcd-green text-black text-sm font-bold hover:brightness-110 transition disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {busy && <Loader2 size={15} className="animate-spin" />}
            {view === 'signin' && 'Entrar'}
            {view === 'signup' && 'Criar conta e baixar'}
            {view === 'forgot' && 'Enviar link'}
            {view === 'recovery' && 'Salvar nova senha'}
          </button>

          {view === 'signin' && (
            <button type="button" onClick={() => go('forgot')} className="w-full text-center text-2xs text-logic-text-dim hover:text-logic-text transition flex items-center justify-center gap-1.5">
              <KeyRound size={12} /> Esqueci minha senha
            </button>
          )}
          {view === 'forgot' && (
            <button type="button" onClick={() => go('signin')} className="w-full text-center text-2xs text-logic-text-dim hover:text-logic-text transition flex items-center justify-center gap-1.5">
              <ChevronLeft size={12} /> Voltar para entrar
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
