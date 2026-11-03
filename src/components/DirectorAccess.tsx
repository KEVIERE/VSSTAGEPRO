import { adminApi } from '@/components/admin/adminApi';
import { authRedirect } from '@/lib/authRedirect';
import { useEffect, useState } from 'react';
import { BadgeCheck, CheckCircle2, CreditCard, Eye, EyeOff, Gift, KeyRound, Laptop, Loader2, LogOut, Lock, Mail, Phone, RefreshCw, Tag, Timer, User, X } from 'lucide-react';
import type { Session } from '@supabase/supabase-js';
import { clearLocalSession, emailLinkType, supabase } from '@/lib/supabaseClient';
import { AccessCard, AccessFoot, AccessNotice, AccessStage, AccessStatus, AccessTitle, FootKey, TrialClock } from '@/components/access/AccessChrome';
import { friendlyError } from '@/lib/friendlyError';
import SubscribeDialog from '@/components/SubscribeDialog';
import { LICENSE_REFRESH_EVENT } from '@/lib/licenseEvents';
import { maskPhone, normalizePhone } from '@/lib/authFlow';
import { forgetVoices } from '@/lib/maestroVoice';

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
  /** Parceiro / Endorse: acesso completo dado pelo admin, sem pagamento */
  partner?: boolean;
};

// Código digitado na tela de entrada: é resgatado assim que a conta entra
// (fica guardado caso o cadastro peça confirmação de e-mail antes).
const PENDING_PROMO_LS = 'vs-pending-promo';
// maior espera que setTimeout aceita (~24,8 dias); acima disso o timer dispara na hora
const MAX_TIMER_MS = 2 ** 31 - 1;

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
      <div className="px-6 pb-4 text-center">
        <button type="button" onClick={() => setOpen(true)} className="access-link inline-flex items-center gap-1.5">
          <Tag size={13} /> Tenho um código promocional
        </button>
      </div>
    );
  }
  return (
    <form onSubmit={submit} className="px-6 pb-4 space-y-2">
      <div className="flex gap-2">
        <div className="flex-1">
          <Field icon={Tag} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="CÓDIGO PROMOCIONAL" maxLength={32} autoFocus />
        </div>
        <button
          type="submit" disabled={busy || !code.trim()}
          className="console-key px-4 text-[0.95rem] flex items-center gap-1.5"
        >
          {busy && <Loader2 size={13} className="animate-spin" />} Aplicar
        </button>
      </div>
      {msg && <AccessNotice tone={msg.ok ? 'green' : 'red'}><p>{msg.text}</p></AccessNotice>}
    </form>
  );
}

// Campo rebaixado no painel, com o ícone à esquerda (acende âmbar ao digitar)
function Field({ icon: Icon, className = '', ...props }: { icon: typeof Mail } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="access-input relative">
      <Icon size={15} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
      <input {...props} className={`access-field ${className}`} />
    </div>
  );
}

export default function DirectorAccess({ children }: { children: (license: License, session: Session) => React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [license, setLicense] = useState<License | null>(null);
  const [view, setView] = useState<'signin' | 'signup' | 'forgot'>('signin');
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
  // supabase.auth.signOut() só atualiza a tela quando o servidor responde ao pedido
  // de invalidar a sessão — se a rede falhar ou demorar, a tela de "Sair"/"Entrar
  // com outra conta" fica parada sem nenhum aviso. Aqui a saída é sempre instantânea:
  // o estado da tela é zerado na hora do clique, sem esperar nenhuma resposta de rede.
  const doSignOut = () => {
    clearLocalSession();
    setSession(null);
    setLicense(null);
    setView('signin');
    setPassword('');
  };
  const [promoNotice, setPromoNotice] = useState<{ ok: boolean; text: string } | null>(null);
  // "Confirmado" é mostrado quando a pessoa volta pelo link de confirmação do e-mail
  // e ainda não passou pela tela de entrada nesta aba.
  const [justConfirmed, setJustConfirmed] = useState(false);
  // O editor completo pelo navegador é só pra testes da administração — nunca pra
  // cliente. No app do Mac (window.vsDesktop) isso não entra em jogo: é sempre liberado.
  const isWebEnvironment = !window.vsDesktop;
  const [isAdmin, setIsAdmin] = useState<boolean | null>(isWebEnvironment ? null : true);

  const loadLicense = async (): Promise<License> => {
    const { data, error: err } = await supabase.rpc('license_status');
    if (err) throw err;
    const lic = { ...(data as License) };
    if (lic.status === 'active') {
      // parceiro (endorse): o acesso já vem liberado pelo servidor; aqui só descobre o selo
      try {
        const { data: p } = await supabase.rpc('my_partner_status');
        if ((p as { partner?: boolean } | null)?.partner) lic.partner = true;
      } catch { /* sem o selo, o acesso continua igual */ }
    }
    setLicense(lic);

    // Registra presença e IP do computador silenciosamente para antifraude e contagem de versões
    const appVersion = window.__VS_VERSION__ || (window.vsDesktop ? 'Desktop App' : 'Navegador Web');
    adminApi.pingPresence(appVersion).catch(() => {});
    return lic;
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
        // entrou ou saiu da conta: as vozes de nuvem do Maestro mudam (precisam do login)
        forgetVoices();
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

  useEffect(() => {
    window.vsDesktop?.notifySessionState?.(Boolean(session));
  }, [session]);

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

  // Bloqueia na hora em que o teste acaba, mesmo com o programa aberto.
  // O navegador dispara na hora qualquer timer acima de ~24,8 dias: um teste estendido para
  // 32 dias aparecia como encerrado. Por isso o timer é dividido em etapas.
  useEffect(() => {
    if (license?.status !== 'trial' || !license.ends_at) return;
    const end = new Date(license.ends_at).getTime();
    const expire = () => setLicense((l) => (l?.status === 'trial' ? { status: 'expired' } : l));
    let timer = 0;
    const check = () => {
      const ms = end - Date.now();
      if (ms <= 0) { expire(); return; }
      timer = window.setTimeout(check, Math.min(ms, MAX_TIMER_MS));
    };
    check();
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
      if (view === 'forgot') {
        const redirectTo = authRedirect('/recuperar');
        const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo });
        if (err) throw err;
        setInfo('Enviamos um e-mail com as instruções para redefinir sua senha.');
        setBusy(false);
        return;
      }
      if (view === 'signup') {
        if (!name.trim()) throw new Error('name_required');
        const normalizedPhone = normalizePhone(phone);
        if (!normalizedPhone) throw new Error('phone_invalid');
        const { data: signUpData, error: err } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
          data: { name: name.trim(), phone: normalizedPhone },
          emailRedirectTo: authRedirect('/'),
        },
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
      className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-[400] max-w-[calc(100vw-2rem)] px-4 py-3 rounded-lg text-sm flex items-center gap-2.5 console-face shadow-2xl ring-1 ring-black ${promoNotice.ok ? 'text-logic-lcd-green' : 'text-[#ff7a70]'}`}
    >
      {promoNotice.ok ? <span className="console-led is-on-green shrink-0" /> : <span className="console-lamp is-on shrink-0" />}
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
      <AccessStage>
        <Loader2 className="animate-spin text-logic-lcd-amber" aria-label="Carregando" />
      </AccessStage>
    );
  }

  if (!session) {
    const signup = view === 'signup';
    const label = subscribeOpen ? 'Entre para assinar' : view === 'forgot' ? 'Recuperar senha' : signup ? 'Criar conta' : 'Entrar';
    return (
      <AccessStage>
        <AccessCard label={label}>
          <form onSubmit={submit} className="px-6 pt-7 pb-6 space-y-3">
            <AccessTitle
              title="VS Stage Pro"
              subtitle={subscribeOpen
                ? 'Entre ou crie sua conta para escolher seu plano'
                : view === 'forgot' ? 'Digite seu e-mail para receber o link de nova senha' : signup ? 'Crie sua conta e use grátis' : 'Entre para abrir seu show'}
            />

            {view === 'forgot' ? (
              <div className="flex justify-between items-center px-1">
                <button
                  type="button"
                  onClick={() => { setView('signin'); setError(null); setInfo(null); }}
                  className="access-link flex items-center gap-1"
                >
                  &larr; Voltar para o login
                </button>
              </div>
            ) : (
              <div className="console-well grid grid-cols-2 gap-1 p-1 rounded-md" role="tablist" aria-label="Entrar ou criar conta">
                {(['signin', 'signup'] as const).map((v) => (
                  <button
                    key={v} type="button" role="tab" aria-selected={view === v}
                    onClick={() => { setView(v); setError(null); setInfo(null); }}
                    className={`console-key h-9 text-[0.98rem] ${view === v ? 'is-lit-amber' : ''}`}
                  >
                    {v === 'signin' ? 'Entrar' : 'Criar conta'}
                  </button>
                ))}
              </div>
            )}

            {error && (
              <AccessNotice tone="red">
                <p>{error}</p>
                {errorIsAlreadyRegistered && (
                  <button
                    type="button"
                    onClick={() => { setView('signin'); setError(null); setErrorIsAlreadyRegistered(false); }}
                    className="font-semibold text-logic-lcd-amber hover:underline"
                  >
                    Ir para "Entrar"
                  </button>
                )}
                {errorHasNoAccount && (
                  <button
                    type="button"
                    onClick={() => { setView('signup'); setError(null); setErrorHasNoAccount(false); }}
                    className="font-semibold text-logic-lcd-amber hover:underline"
                  >
                    Ir para "Criar conta"
                  </button>
                )}
              </AccessNotice>
            )}
            {info && <AccessNotice tone="green"><p>{info}</p></AccessNotice>}

            {view === 'forgot' ? (
              <Field icon={Mail} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="E-mail cadastrado" autoComplete="email" required autoFocus />
            ) : (
              <>
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
                    className="pr-10"
                  />
                  <button
                    type="button" onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded text-logic-text-muted hover:text-logic-text transition"
                  >
                    {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </>
            )}

            <div className="flex items-center justify-between gap-3 flex-wrap">
              {view === 'signin' && (
                <button
                  type="button" onClick={() => setRemember((v) => !v)} aria-pressed={remember}
                  className="console-key h-7 px-2.5 text-[0.85rem] inline-flex items-center gap-2"
                >
                  <span className={`console-led ${remember ? 'is-on-green' : ''}`} />
                  Salvar para a próxima vez
                </button>
              )}
              {view !== 'forgot' && !promoOpen && (
                <button type="button" onClick={() => setPromoOpen(true)} className="access-link inline-flex items-center gap-1.5">
                  <Tag size={12} /> Tem um código promocional?
                </button>
              )}
            </div>

            {view !== 'forgot' && promoOpen && (
              <div className="relative">
                <Field icon={Tag} value={promo} onChange={(e) => setPromo(e.target.value.toUpperCase())} placeholder="CÓDIGO PROMOCIONAL" maxLength={32} autoFocus className="pr-10" />
                <button
                  type="button" aria-label="Remover código" onClick={() => { setPromo(''); setPromoOpen(false); }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded text-logic-text-muted hover:text-logic-text"
                >
                  <X size={13} />
                </button>
              </div>
            )}

            <div className="pt-1">
              <button type="submit" disabled={busy} className="access-key">
                {busy && <Loader2 size={16} className="animate-spin" />}
                {signup
                  ? (subscribeOpen ? 'Criar conta e assinar' : 'Criar conta e começar o teste')
                  : view === 'forgot' ? 'Enviar link de recuperação' : (subscribeOpen ? 'Entrar e assinar' : 'Entrar')}
              </button>
            </div>
            {view === 'signin' && (
              <div className="text-center pt-1">
                <button
                  type="button"
                  onClick={() => { setView('forgot'); setError(null); setInfo(null); }}
                  className="access-link inline-flex items-center gap-1.5"
                >
                  <KeyRound size={12} /> Esqueci minha senha
                </button>
              </div>
            )}
          </form>

          <AccessFoot>
            <FootKey lit={!subscribeOpen && signup} onClick={() => { setSubscribeOpen(false); setView('signup'); setError(null); }}>
              <Gift size={14} /> Teste grátis
            </FootKey>
            <FootKey lit={subscribeOpen} onClick={() => { setSubscribeOpen(true); setError(null); }}>
              <CreditCard size={14} /> Assinar agora
            </FootKey>
          </AccessFoot>
        </AccessCard>
      </AccessStage>
    );
  }

  if (license?.status === 'blocked') {
    return (
      <AccessStage>
        <AccessCard label={<span className="text-logic-lcd-red">Conta suspensa</span>} status={<AccessStatus tone="red">Bloqueada</AccessStatus>}>
          <div className="px-6 pt-7 pb-6 text-center">
            <AccessTitle
              title="Acesso suspenso"
              subtitle={<>Esta conta foi suspensa pela administração do VS Stage Pro.{license.reason ? <> Motivo: <span className="text-logic-text">{license.reason}</span>.</> : null}</>}
            />
            <p className="text-xs text-logic-text-muted -mt-2">
              Se acha que é um engano, escreva para <span className="text-logic-lcd-amber">suporte.vssategepro@gmail.com</span>.
            </p>
          </div>
          <AccessFoot cols={1}>
            <FootKey onClick={doSignOut}><LogOut size={14} /> Sair da conta</FootKey>
          </AccessFoot>
        </AccessCard>
      </AccessStage>
    );
  }

  if (license?.status === 'expired') {
    return (
      <AccessStage>
        <SubscribeDialog
          embedded
          label="Teste grátis encerrado"
          status={<AccessStatus tone="red">0:00</AccessStatus>}
          title="Seu teste grátis terminou"
          subtitle="Faça sua assinatura para continuar usando o VS Stage Pro. Seus shows e projetos continuam salvos — ao assinar, tudo volta exatamente de onde parou."
          footer={(
            <>
              <PromoRedeem onRedeemed={() => { loadLicense().catch(() => {}); }} />
              <AccessFoot>
                <FootKey
                  onClick={async () => {
                    // assinatura paga, bônus ou parceiro adicionado pelo admin: libera na hora
                    const lic = await loadLicense().catch(() => null);
                    if (lic?.status !== 'active') {
                      setPromoNotice({ ok: false, text: 'Ainda não encontramos assinatura ativa nesta conta. Se acabou de assinar, aguarde um instante e tente de novo.' });
                    }
                  }}
                >
                  <RefreshCw size={14} /> Já assinei
                </FootKey>
                <FootKey onClick={doSignOut}><LogOut size={14} /> Sair da conta</FootKey>
              </AccessFoot>
            </>
          )}
        />
        {promoToast}
      </AccessStage>
    );
  }

  // O editor completo pelo navegador é exclusivo da administração, para testes — nunca
  // liberado para clientes. No app do Mac isso nunca acontece (isAdmin já começa true lá).
  if (isWebEnvironment && isAdmin === false) {
    return (
      <AccessStage>
        <AccessCard label="Só no Mac" status={<AccessStatus tone="amber">Mac</AccessStatus>}>
          <div className="px-6 pt-7 pb-6 text-center">
            <AccessTitle
              title="Baixe o VS Stage para Mac"
              subtitle="O editor completo do VS Stage Pro é feito para rodar no app do Mac, não direto no navegador. Baixe o programa para começar seu teste grátis."
            />
            <a href="#baixar" className="access-key">
              <Laptop size={16} /> Baixar para Mac
            </a>
          </div>
          <AccessFoot cols={1}>
            <FootKey onClick={doSignOut}><LogOut size={14} /> Sair da conta</FootKey>
          </AccessFoot>
        </AccessCard>
      </AccessStage>
    );
  }

  if (!gatePassed) {
    const firstName = ((session.user.user_metadata?.name as string | undefined) ?? '').trim().split(/\s+/)[0];
    const loading = !license;
    const isTrial = license?.status === 'trial';
    const isActive = license?.status === 'active';
    const endsAt = isTrial && license.ends_at ? new Date(license.ends_at).getTime() : null;
    const statusText = loading ? 'Conferindo sua conta…'
      : isActive
        ? (license.partner ? 'Você é Parceiro VS Stage Pro (Endorse). Acesso completo liberado.'
          : license.plan === 'promo' ? 'Seu bônus de acesso está ativo.' : 'Sua assinatura está ativa.')
        : isTrial ? 'Você está no teste grátis.' : null;
    return (
      <AccessStage>
        <AccessCard
          label="Bem-vindo"
          status={loading ? <span className="console-led" />
            : isActive ? <AccessStatus tone="green">{license.partner ? 'Parceiro' : 'Assinante'}</AccessStatus>
              : <AccessStatus tone="amber">Teste grátis</AccessStatus>}
        >
          <div className="px-6 pt-7 pb-6 text-center">
            {justConfirmed && (
              <div className="mb-5"><AccessNotice tone="green"><p>Conta criada com sucesso!</p></AccessNotice></div>
            )}
            <AccessTitle title={firstName ? `Olá, ${firstName}` : 'VS Stage Pro'} subtitle={session.user.email} />

            {endsAt !== null ? (
              <TrialClock endsAt={endsAt} />
            ) : (
              <div className="console-display px-4 py-3 flex items-center justify-center gap-2.5 min-h-[3.25rem] text-[0.82rem]">
                {loading
                  ? <Loader2 size={14} className="animate-spin text-logic-lcd-amber" />
                  : <span className={`console-led ${isActive ? 'is-on-green' : 'is-on-amber'}`} />}
                <span className={isActive ? 'text-logic-lcd-green console-glow' : 'text-logic-text-dim'}>{statusText}</span>
              </div>
            )}
            {endsAt !== null && statusText && <p className="text-xs text-logic-text-dim mt-3">{statusText}</p>}

            <button type="button" onClick={passGate} disabled={loading} autoFocus className="access-key mt-5">
              {loading && <Loader2 size={16} className="animate-spin" />}
              {isActive ? 'Abrir o VS Stage Pro' : 'Continuar no teste grátis'}
            </button>
          </div>

          <AccessFoot>
            {isActive ? (
              <span className="console-key h-10 px-3 text-[0.95rem] flex items-center justify-center gap-2 text-logic-lcd-green pointer-events-none">
                <span className="console-led is-on-green" /> <CheckCircle2 size={14} /> {license.partner ? 'Parceiro · Endorse' : 'Assinante'}
              </span>
            ) : (
              <FootKey disabled={loading} onClick={() => { setSubscribeOpen(true); passGate(); }}>
                <CreditCard size={14} /> Assinar agora
              </FootKey>
            )}
            <FootKey onClick={doSignOut}><LogOut size={14} /> Trocar de conta</FootKey>
          </AccessFoot>
        </AccessCard>
        {promoToast}
      </AccessStage>
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

  if (license?.status === 'active' && license.partner) {
    return (
      <span
        title="Parceiro VS Stage Pro (Endorse): acesso completo liberado"
        className="inline-flex items-center gap-1 px-2 h-5 rounded bg-logic-lcd-amber/15 text-logic-lcd-amber text-2xs font-bold"
      >
        <BadgeCheck size={11} /> Parceiro · Endorse
      </span>
    );
  }
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
