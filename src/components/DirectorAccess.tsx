import { useEffect, useState } from 'react';
import { Ban, Check, CheckCircle2, CreditCard, Eye, EyeOff, Gift, Laptop, Loader2, LogOut, Lock, Mail, Phone, RefreshCw, Tag, Timer, User, X } from 'lucide-react';
import type { Session } from '@supabase/supabase-js';
import { emailLinkType, supabase } from '@/lib/supabaseClient';
import VsLogo from '@/components/VsLogo';
import { friendlyError } from '@/lib/friendlyError';
import SubscribeDialog from '@/components/SubscribeDialog';
import { LICENSE_REFRESH_EVENT } from '@/lib/licenseEvents';
import { maskPhone, normalizePhone } from '@/lib/authFlow';

export type License = {
  status: 'anonymous' | 'trial' | 'active' | 'expired' | 'blocked';
  reason?: string | null;
  days_left?: number;
  hours_left?: number;
  ends_at?: string;
  trial_started_at?: string;
  subscription?: string;
  plan?: 'monthly' | 'yearly' | 'promo' | null;
  current_period_end?: string | null;
};

// Código digitado na tela de entrada: é resgatado assim que a conta entra
// (fica guardado caso o cadastro peça confirmação de e-mail antes).
const PENDING_PROMO_LS = 'vs-pending-promo';

// A cada abertura do programa a pessoa passa pela janela de entrada e escolhe o que quer
// (entrar, teste grátis ou assinar) antes do editor abrir. Vale até fechar o programa.
const GATE_SS = 'vs-entry-gate-passed';
const gatePassedNow = () => { try { sessionStorage.setItem(GATE_SS, '1'); } catch { /* sem storage */ } };

// E-mail lembrado entre aberturas quando a pessoa marca "Salvar para a próxima vez".
const SAVED_EMAIL_LS = 'vs-login-email';
function savedLogin(): { email: string; remember: boolean } {
  try {
    const email = localStorage.getItem(SAVED_EMAIL_LS) ?? '';
    return { email, remember: Boolean(email) };
  } catch {
    return { email: '', remember: false };
  }
}

type PromoResult = { kind: 'trial_hours' | 'free_days'; value: number };

function promoText({ kind, value }: PromoResult) {
  if (kind === 'free_days') return value === 1 ? '1 dia de acesso completo' : `${value} dias de acesso completo`;
  if (value % 24 === 0) return value === 24 ? '+1 dia de teste grátis' : `+${value / 24} dias de teste grátis`;
  return `+${value}h de teste grátis`;
}

async function redeemPromo(code: string): Promise<PromoResult> {
  const { data, error } = await supabase.rpc('redeem_promo', { p_code: code });
  if (error) throw new Error(error.message);
  return data as PromoResult;
}

// Campo "Tenho um código promocional" para quem já está logado (ex.: na tela de teste encerrado).
function PromoRedeem({ onRedeemed }: { onRedeemed: () => void }) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await redeemPromo(code);
      setMsg({ ok: true, text: `Código aplicado: ${promoText(res)}.` });
      onRedeemed();
    } catch (err) {
      setMsg({ ok: false, text: friendlyError((err as Error).message) });
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button" onClick={() => setOpen(true)}
        className="w-full h-9 border-t border-logic-border text-xs text-logic-text-dim hover:text-logic-text hover:bg-logic-bg-elevated transition flex items-center justify-center gap-1.5"
      >
        <Tag size={13} /> Tenho um código promocional
      </button>
    );
  }
  return (
    <form onSubmit={submit} className="border-t border-logic-border px-4 py-3 space-y-2">
      <div className="flex gap-2">
        <div className="flex-1">
          <Field icon={Tag} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="CÓDIGO PROMOCIONAL" maxLength={32} autoFocus />
        </div>
        <button
          type="submit" disabled={busy || !code.trim()}
          className="px-4 rounded-lg bg-logic-bg-elevated text-xs font-semibold hover:bg-logic-bg-panel-light transition disabled:opacity-50 flex items-center gap-1.5"
        >
          {busy && <Loader2 size={13} className="animate-spin" />} Aplicar
        </button>
      </div>
      {msg && <p className={`text-xs text-center ${msg.ok ? 'text-logic-lcd-green' : 'text-logic-lcd-red'}`}>{msg.text}</p>}
    </form>
  );
}

const inputCls = 'w-full bg-logic-bg-deep text-sm text-logic-text pl-9 pr-3 py-2.5 rounded-lg border border-logic-border-light outline-none focus:border-logic-accent transition-colors placeholder:text-logic-text-muted';

function Field({ icon: Icon, className = '', ...props }: { icon: typeof Mail } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="relative">
      <Icon size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-logic-text-muted pointer-events-none" />
      <input {...props} className={`${inputCls} ${className}`} />
    </div>
  );
}

export default function DirectorAccess({ children }: { children: (license: License, session: Session) => React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [license, setLicense] = useState<License | null>(null);
  const [view, setView] = useState<'signin' | 'signup'>('signin');
  // "Assinar agora" na tela de entrada (ou #programa/assinar no site): depois do login abre os planos.
  const [subscribeOpen, setSubscribeOpen] = useState(() => window.location.hash.includes('assinar'));
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
  const [promo, setPromo] = useState('');
  const [promoOpen, setPromoOpen] = useState(false);
  const [gatePassed, setGatePassed] = useState(() => {
    try { return sessionStorage.getItem(GATE_SS) === '1'; } catch { return false; }
  });
  const passGate = () => { gatePassedNow(); setGatePassed(true); };
  const [promoNotice, setPromoNotice] = useState<{ ok: boolean; text: string } | null>(null);
  // "Confirmado" é mostrado quando a pessoa volta pelo link de confirmação do e-mail
  // e ainda não passou pela tela de entrada nesta aba.
  const [justConfirmed, setJustConfirmed] = useState(false);
  // O editor completo pelo navegador é só pra testes da administração — nunca pra
  // cliente. No app do Mac (window.vsDesktop) isso não entra em jogo: é sempre liberado.
  const isWebEnvironment = !window.vsDesktop;
  const [isAdmin, setIsAdmin] = useState<boolean | null>(isWebEnvironment ? null : true);

  const loadLicense = async () => {
    const { data, error: err } = await supabase.rpc('license_status');
    if (err) throw err;
    setLicense(data as License);
  };

  const checkAdmin = async () => {
    if (!isWebEnvironment) return;
    try {
      const { data, error: err } = await supabase.rpc('is_admin');
      if (err) throw err;
      setIsAdmin(data === true);
    } catch {
      setIsAdmin(false);
    }
  };

  useEffect(() => {
    let alive = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!alive) return;
      setSession(data.session);
      setReady(true);
      if (data.session) {
        if (emailLinkType === 'signup') setJustConfirmed(true);
        (async () => {
          try { await loadLicense(); } catch { /* manter tela de login */ }
        })();
        checkAdmin();
      }
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      (async () => {
        setSession(s);
        if (s) {
          try { await loadLicense(); } catch { /* silencioso */ }
          checkAdmin();
        } else {
          setLicense(null);
          setIsAdmin(isWebEnvironment ? null : true);
        }
      })();
    });
    return () => { alive = false; sub.subscription.unsubscribe(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- checkAdmin/isWebEnvironment são estáveis entre renders

  // Confere a licença quando o pagamento pede (SubscribeDialog) e ao voltar para o programa.
  useEffect(() => {
    if (!session) return;
    const refresh = () => { loadLicense().catch(() => {}); };
    window.addEventListener(LICENSE_REFRESH_EVENT, refresh);
    window.addEventListener('focus', refresh);
    return () => {
      window.removeEventListener(LICENSE_REFRESH_EVENT, refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [session]);

  useEffect(() => {
    if (license?.status === 'active') setSubscribeOpen(false);
  }, [license?.status]);

  // Confere de tempos em tempos: libera assinatura/bônus e derruba contas bloqueadas pelo admin.
  useEffect(() => {
    if (!session) return;
    const t = window.setInterval(() => { loadLicense().catch(() => {}); }, 2 * 60 * 1000);
    return () => window.clearInterval(t);
  }, [session]);

  // Resgata o código promocional digitado na tela de entrada.
  useEffect(() => {
    if (!session) return;
    const code = localStorage.getItem(PENDING_PROMO_LS);
    if (!code) return;
    localStorage.removeItem(PENDING_PROMO_LS);
    redeemPromo(code)
      .then((res) => setPromoNotice({ ok: true, text: `Código ${code} aplicado: ${promoText(res)}.` }))
      .catch((err) => setPromoNotice({ ok: false, text: `Código ${code}: ${friendlyError((err as Error).message)}` }))
      .finally(() => { loadLicense().catch(() => {}); });
  }, [session]);

  useEffect(() => {
    if (!promoNotice) return;
    const t = window.setTimeout(() => setPromoNotice(null), 8000);
    return () => window.clearTimeout(t);
  }, [promoNotice]);

  // Bloqueia na hora em que as 48h acabam, mesmo com o programa aberto.
  useEffect(() => {
    if (license?.status !== 'trial' || !license.ends_at) return;
    const ms = new Date(license.ends_at).getTime() - Date.now();
    const expire = () => setLicense((l) => (l?.status === 'trial' ? { status: 'expired' } : l));
    if (ms <= 0) { expire(); return; }
    const timer = window.setTimeout(expire, ms);
    return () => window.clearTimeout(timer);
  }, [license?.status, license?.ends_at]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setErrorIsAlreadyRegistered(false);
    setErrorHasNoAccount(false);
    setInfo(null);
    try {
      const code = promo.trim().toUpperCase();
      if (code) {
        const { data, error: err } = await supabase.rpc('promo_check', { p_code: code });
        if (err) throw err;
        if (!data?.valid) throw new Error(data?.error ?? 'promo_invalid');
        localStorage.setItem(PENDING_PROMO_LS, code);
      }
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
      passGate();
    } catch (err) {
      localStorage.removeItem(PENDING_PROMO_LS);
      const message = (err as Error).message;
      if (message === 'already_registered') setErrorIsAlreadyRegistered(true);
      if (message === 'no_account_with_email') setErrorHasNoAccount(true);
      setError(friendlyError(message));
    } finally {
      setBusy(false);
    }
  };

  const promoToast = promoNotice && (
    <div
      role="status"
      className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-[400] px-4 py-3 rounded-lg border shadow-2xl text-sm flex items-center gap-2 bg-logic-bg-panel ${promoNotice.ok ? 'border-logic-lcd-green/40 text-logic-lcd-green' : 'border-logic-lcd-red/40 text-logic-lcd-red'}`}
    >
      {promoNotice.ok ? <CheckCircle2 size={15} /> : <Ban size={15} />}
      {promoNotice.text}
    </div>
  );

  const showingEditor = !!session && gatePassed && license?.status !== 'blocked' && license?.status !== 'expired';
  useEffect(() => {
    if (!ready || showingEditor) return;
    const id = requestAnimationFrame(() => window.vsDesktop?.appReady());
    return () => cancelAnimationFrame(id);
  }, [ready, showingEditor]);

  if (!ready) {
    return (
      <div className="h-full flex items-center justify-center bg-logic-bg-deep">
        <Loader2 className="animate-spin text-logic-text-muted" />
      </div>
    );
  }

  if (!session) {
    const signup = view === 'signup';
    return (
      <div className="fixed inset-0 bg-logic-bg-deep text-logic-text flex items-center justify-center p-6 overflow-y-auto">
        <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[560px] h-[560px] rounded-full bg-logic-lcd-green/10 blur-3xl" />
        </div>
        <div className="relative w-[400px] max-w-full bg-logic-bg-panel border border-logic-border-light rounded-lg shadow-2xl overflow-hidden">
          <div className="flex items-center px-4 h-9 border-b border-logic-border bg-logic-bg-elevated">
            <span className="text-2xs font-semibold tracking-widest text-logic-text-muted">
              {subscribeOpen ? 'ENTRE PARA ASSINAR' : signup ? 'CRIAR CONTA' : 'ENTRAR'}
            </span>
          </div>

          <form onSubmit={submit} className="px-6 pt-6 pb-5 space-y-3">
            <div className="text-center mb-5">
              <div className="mx-auto w-20 h-20 mb-3 flex items-center justify-center">
                <VsLogo size={80} />
              </div>
              <h1 className="text-xl font-semibold">VS Stage Pro</h1>
              <p className="text-xs text-logic-text-dim mt-1">
                {subscribeOpen
                  ? 'Entre ou crie sua conta para escolher seu plano'
                  : signup ? 'Crie sua conta e use grátis' : 'Entre para abrir seu show'}
              </p>
            </div>

            <div className="grid grid-cols-2 p-1 rounded-lg bg-logic-bg-deep border border-logic-border-dark">
              {(['signin', 'signup'] as const).map((v) => (
                <button
                  key={v} type="button" onClick={() => { setView(v); setError(null); }}
                  className={`py-1.5 rounded-md text-xs font-medium transition-colors ${view === v ? 'bg-logic-bg-elevated text-logic-text shadow' : 'text-logic-text-muted hover:text-logic-text'}`}
                >
                  {v === 'signin' ? 'Entrar' : 'Criar conta'}
                </button>
              ))}
            </div>

            {error && (
              <div className="px-3 py-2 rounded-lg border bg-logic-lcd-red/15 border-logic-lcd-red/40 text-logic-lcd-red text-xs text-center space-y-1.5">
                <p>{error}</p>
                {errorIsAlreadyRegistered && (
                  <button
                    type="button"
                    onClick={() => { setView('signin'); setError(null); setErrorIsAlreadyRegistered(false); }}
                    className="text-logic-lcd-green font-semibold hover:underline"
                  >
                    Ir para "Entrar"
                  </button>
                )}
                {errorHasNoAccount && (
                  <button
                    type="button"
                    onClick={() => { setView('signup'); setError(null); setErrorHasNoAccount(false); }}
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
            <Field icon={Mail} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="E-mail" autoComplete="email" required autoFocus={!signup} />
            <div className="relative">
              <Field
                icon={Lock} type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)}
                placeholder="Senha" autoComplete={signup ? 'new-password' : 'current-password'} required minLength={6}
                className="pr-9"
              />
              <button
                type="button" onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded text-logic-text-muted hover:text-logic-text transition"
              >
                {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>

            {!signup && (
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

            {promoOpen ? (
              <div className="relative">
                <Field icon={Tag} value={promo} onChange={(e) => setPromo(e.target.value.toUpperCase())} placeholder="CÓDIGO PROMOCIONAL" maxLength={32} autoFocus />
                <button
                  type="button" aria-label="Remover código" onClick={() => { setPromo(''); setPromoOpen(false); }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-logic-text-muted hover:text-logic-text hover:bg-logic-bg-elevated"
                >
                  <X size={13} />
                </button>
              </div>
            ) : (
              <button
                type="button" onClick={() => setPromoOpen(true)}
                className="w-full text-left text-2xs text-logic-text-dim hover:text-logic-lcd-green transition flex items-center gap-1.5"
              >
                <Tag size={12} /> Tem um código promocional?
              </button>
            )}

            <button
              type="submit" disabled={busy}
              className="w-full py-2.5 rounded-lg bg-logic-lcd-green text-black text-sm font-bold hover:brightness-110 transition disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {busy && <Loader2 size={15} className="animate-spin" />}
              {signup
                ? (subscribeOpen ? 'Criar conta e assinar' : 'Criar conta e começar o teste')
                : (subscribeOpen ? 'Entrar e assinar' : 'Entrar')}
            </button>
          </form>

          <div className="grid grid-cols-2 border-t border-logic-border">
            <button
              type="button"
              onClick={() => { setSubscribeOpen(false); setView('signup'); setError(null); }}
              className={`h-12 text-xs font-semibold transition flex items-center justify-center gap-1.5 hover:bg-logic-bg-elevated ${!subscribeOpen && signup ? 'text-logic-lcd-green' : 'text-logic-text-dim hover:text-logic-text'}`}
            >
              <Gift size={14} /> Teste grátis
            </button>
            <button
              type="button"
              onClick={() => { setSubscribeOpen(true); setError(null); }}
              className={`h-12 text-xs font-semibold transition border-l border-logic-border flex items-center justify-center gap-1.5 hover:bg-logic-bg-elevated ${subscribeOpen ? 'text-logic-lcd-green' : 'text-logic-text-dim hover:text-logic-text'}`}
            >
              <CreditCard size={14} /> Assinar agora
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (license?.status === 'blocked') {
    return (
      <div className="fixed inset-0 z-[300] flex items-center justify-center bg-logic-bg-deep text-logic-text p-6">
        <div className="relative w-[400px] max-w-full bg-logic-bg-panel border border-logic-border-light rounded-lg shadow-2xl overflow-hidden">
          <div className="flex items-center px-4 h-9 border-b border-logic-border bg-logic-bg-elevated">
            <span className="text-2xs font-semibold tracking-widest text-logic-lcd-red">CONTA SUSPENSA</span>
          </div>
          <div className="px-6 py-7 text-center">
            <div className="mx-auto w-20 h-20 mb-4 flex items-center justify-center">
              <VsLogo size={80} />
            </div>
            <h1 className="text-lg font-semibold flex items-center justify-center gap-2">
              <Ban size={18} className="text-logic-lcd-red" /> Acesso suspenso
            </h1>
            <p className="text-sm text-logic-text-dim leading-relaxed mt-2">
              Esta conta foi suspensa pela administração do VS Stage Pro.
              {license.reason ? <> Motivo: <span className="text-logic-text">{license.reason}</span>.</> : null}
            </p>
            <p className="text-xs text-logic-text-muted mt-3">
              Se acha que é um engano, escreva para <span className="text-logic-lcd-green">suporte.vssategepro@gmail.com</span>.
            </p>
          </div>
          <button
            onClick={() => supabase.auth.signOut()}
            className="w-full h-10 border-t border-logic-border text-xs font-medium text-logic-text-dim hover:text-logic-text hover:bg-logic-bg-elevated transition flex items-center justify-center gap-1.5"
          >
            <LogOut size={13} /> Sair da conta
          </button>
        </div>
      </div>
    );
  }

  if (license?.status === 'expired') {
    return (
      <div className="fixed inset-0 z-[300] flex items-center justify-center bg-logic-bg-deep p-6 overflow-y-auto">
        <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[560px] h-[560px] rounded-full bg-logic-lcd-green/10 blur-3xl" />
        </div>
        <SubscribeDialog
          embedded
          label={(
            <span className="flex items-center gap-2">
              TESTE GRÁTIS ENCERRADO
              <span className="inline-flex items-center gap-1 px-1.5 h-4 rounded bg-logic-lcd-red/15 text-logic-lcd-red font-bold tracking-normal tabular-nums">
                <Timer size={10} /> 0min
              </span>
            </span>
          )}
          title="Seu teste grátis terminou"
          subtitle="Faça sua assinatura para continuar usando o VS Stage Pro. Seus shows e projetos continuam salvos — ao assinar, tudo volta exatamente de onde parou."
          footer={(
            <>
            <PromoRedeem onRedeemed={() => { loadLicense().catch(() => {}); }} />
            <div className="flex border-t border-logic-border">
              <button
                onClick={() => { loadLicense().catch(() => {}); }}
                className="flex-1 h-10 text-xs font-medium text-logic-text-dim hover:text-logic-text hover:bg-logic-bg-elevated transition flex items-center justify-center gap-1.5"
              >
                <RefreshCw size={13} /> Já assinei
              </button>
              <button
                onClick={() => supabase.auth.signOut()}
                className="flex-1 h-10 text-xs font-medium text-logic-text-dim hover:text-logic-text hover:bg-logic-bg-elevated transition border-l border-logic-border flex items-center justify-center gap-1.5"
              >
                <LogOut size={13} /> Sair da conta
              </button>
            </div>
            </>
          )}
        />
        {promoToast}
      </div>
    );
  }

  // O editor completo pelo navegador é exclusivo da administração, para testes — nunca
  // liberado para clientes. No app do Mac isso nunca acontece (isAdmin já começa true lá).
  if (isWebEnvironment && isAdmin === false) {
    return (
      <div className="fixed inset-0 bg-logic-bg-deep text-logic-text flex items-center justify-center p-6">
        <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[560px] h-[560px] rounded-full bg-logic-lcd-amber/10 blur-3xl" />
        </div>
        <div className="relative w-[400px] max-w-full bg-logic-bg-panel border border-logic-border-light rounded-lg shadow-2xl overflow-hidden">
          <div className="flex items-center px-4 h-9 border-b border-logic-border bg-logic-bg-elevated">
            <span className="text-2xs font-semibold tracking-widest text-logic-text-muted">SÓ NO MAC</span>
          </div>
          <div className="px-6 py-7 text-center">
            <div className="mx-auto w-20 h-20 mb-4 flex items-center justify-center">
              <VsLogo size={80} />
            </div>
            <h1 className="text-lg font-semibold flex items-center justify-center gap-2">
              <Laptop size={18} className="text-logic-lcd-amber" /> Baixe o VS Stage para Mac
            </h1>
            <p className="text-sm text-logic-text-dim leading-relaxed mt-2">
              O editor completo do VS Stage Pro é feito para rodar no app do Mac, não direto no navegador. Baixe o programa para começar seu teste grátis.
            </p>
            <a
              href="#baixar"
              className="mt-5 inline-flex w-full items-center justify-center gap-2 py-2.5 rounded-lg bg-logic-lcd-green text-black text-sm font-bold hover:brightness-110 transition"
            >
              Baixar para Mac
            </a>
          </div>
          <button
            onClick={() => supabase.auth.signOut()}
            className="w-full h-10 border-t border-logic-border text-xs font-medium text-logic-text-dim hover:text-logic-text hover:bg-logic-bg-elevated transition flex items-center justify-center gap-1.5"
          >
            <LogOut size={13} /> Sair da conta
          </button>
        </div>
      </div>
    );
  }

  if (!gatePassed) {
    const firstName = ((session.user.user_metadata?.name as string | undefined) ?? '').trim().split(/\s+/)[0];
    const loading = !license;
    const isTrial = license?.status === 'trial';
    const endsAt = isTrial && license.ends_at ? new Date(license.ends_at).getTime() : null;
    return (
      <div className="fixed inset-0 bg-logic-bg-deep text-logic-text flex items-center justify-center p-6 overflow-y-auto">
        <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[560px] h-[560px] rounded-full bg-logic-lcd-green/10 blur-3xl" />
        </div>
        <div className="relative w-[400px] max-w-full bg-logic-bg-panel border border-logic-border-light rounded-lg shadow-2xl overflow-hidden">
          <div className="flex items-center justify-between px-4 h-9 border-b border-logic-border bg-logic-bg-elevated">
            <span className="text-2xs font-semibold tracking-widest text-logic-text-muted">BEM-VINDO</span>
            {isTrial && endsAt !== null && (
              <span className="inline-flex items-center gap-1 px-2 h-5 rounded bg-logic-lcd-green/15 text-logic-lcd-green text-2xs font-bold tabular-nums">
                <Timer size={11} /> {formatRemaining(endsAt - Date.now())}
              </span>
            )}
          </div>

          <div className="px-6 pt-6 pb-5 text-center">
            {justConfirmed && (
              <div className="mb-4 px-3 py-2 rounded-lg border bg-logic-lcd-green/15 border-logic-lcd-green/40 text-logic-lcd-green text-xs flex items-center justify-center gap-1.5">
                <CheckCircle2 size={14} /> Conta criada com sucesso!
              </div>
            )}
            <div className="mx-auto w-20 h-20 mb-3 flex items-center justify-center">
              <VsLogo size={80} />
            </div>
            <h1 className="text-xl font-semibold">{firstName ? `Olá, ${firstName}` : 'VS Stage Pro'}</h1>
            <p className="text-xs text-logic-text-dim mt-1">{session.user.email}</p>
            <p className="text-xs text-logic-text-dim mt-3 min-h-4">
              {loading ? 'Conferindo sua conta…'
                : license.status === 'active'
                  ? (license.plan === 'promo' ? 'Seu bônus de acesso está ativo.' : 'Sua assinatura está ativa.')
                  : isTrial ? 'Você está no teste grátis.' : null}
            </p>

            <button
              type="button" onClick={passGate} disabled={loading} autoFocus
              className="mt-5 w-full py-2.5 rounded-lg bg-logic-lcd-green text-black text-sm font-bold hover:brightness-110 transition disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loading && <Loader2 size={15} className="animate-spin" />}
              {license?.status === 'active' ? 'Abrir o VS Stage Pro' : 'Continuar no teste grátis'}
            </button>
          </div>

          <div className="grid grid-cols-2 border-t border-logic-border">
            {license?.status === 'active' ? (
              <span className="h-12 text-xs font-semibold text-logic-lcd-green flex items-center justify-center gap-1.5">
                <CheckCircle2 size={14} /> Assinante
              </span>
            ) : (
              <button
                type="button" disabled={loading}
                onClick={() => { setSubscribeOpen(true); passGate(); }}
                className="h-12 text-xs font-semibold text-logic-text-dim hover:text-logic-text hover:bg-logic-bg-elevated transition flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                <CreditCard size={14} /> Assinar agora
              </button>
            )}
            <button
              type="button"
              onClick={() => { setView('signin'); supabase.auth.signOut(); }}
              className="h-12 text-xs font-semibold text-logic-text-dim hover:text-logic-text hover:bg-logic-bg-elevated transition border-l border-logic-border flex items-center justify-center gap-1.5"
            >
              <LogOut size={14} /> Entrar com outra conta
            </button>
          </div>
        </div>
        {promoToast}
      </div>
    );
  }

  return (
    <>
      {children(license ?? { status: 'trial' }, session)}
      {subscribeOpen && license?.status === 'trial' && <SubscribeDialog onClose={() => setSubscribeOpen(false)} />}
      {promoToast}
    </>
  );
}
function formatRemaining(ms: number) {
  const totalMin = Math.max(0, Math.ceil(ms / 60000));
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}min`;
  return `${m}min`;
}

export function TrialBadge({ license }: { license: License | null }) {
  const [now, setNow] = useState(() => Date.now());
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 15 * 1000);
    return () => window.clearInterval(t);
  }, []);

  if (!license || license.status !== 'trial') return null;
  const endsAt = license.ends_at
    ? new Date(license.ends_at).getTime()
    : license.hours_left !== undefined ? now + license.hours_left * 3600000 : null;
  return (
    <span className="inline-flex items-center gap-1.5">
    <span
      title="Tempo restante do teste grátis"
      className="inline-flex items-center gap-1 px-2 h-5 rounded bg-logic-lcd-green/15 text-logic-lcd-green text-2xs font-bold tabular-nums"
    >
      <Timer size={11} />
      {endsAt === null ? 'Teste grátis' : `Teste grátis: ${formatRemaining(endsAt - now)}`}
    </span>
    <button
      type="button" onClick={() => setOpen(true)}
      className="inline-flex items-center gap-1 px-2 h-5 rounded bg-logic-lcd-green text-black text-2xs font-bold hover:brightness-110 transition"
    >
      <CreditCard size={11} /> Assinar agora
    </button>
    {open && <SubscribeDialog onClose={() => setOpen(false)} />}
    </span>
  );
}
