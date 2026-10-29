import { useEffect, useState } from 'react';
import { authRedirect } from '@/lib/authRedirect';
import { Apple, Check, CheckCircle2, ChevronRight, Eye, EyeOff, KeyRound, Loader2, Lock, RefreshCw, ShieldCheck } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import VsLogo from '@/components/VsLogo';
import { friendlyError } from '@/lib/friendlyError';

export default function ResetPasswordPage() {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [resendEmail, setResendEmail] = useState('');
  const [resendBusy, setResendBusy] = useState(false);
  const [resendSuccess, setResendSuccess] = useState(false);

  useEffect(() => {
    // 1. Verifica se a URL retornou erro de link expirado do Supabase
    try {
      const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : '';
      const params = new URLSearchParams(hash);
      const searchParams = new URLSearchParams(window.location.search);
      const errDesc = params.get('error_description') || searchParams.get('error_description');
      const errCode = params.get('error_code') || searchParams.get('error_code');
      if (errDesc || errCode) {
        if (/expired|otp_expired|invalid/i.test(errDesc || '') || errCode === 'otp_expired') {
          setError('Este link de recuperação expirou ou já foi utilizado. Digite seu e-mail abaixo para receber um novo link.');
          setExpired(true);
        } else {
          setError((errDesc || 'Erro no link de recuperação').replace(/\+/g, ' '));
        }
      }
    } catch {
      /* ignore */
    }

    // 2. Busca e-mail da sessão atual
    supabase.auth.getSession().then(({ data }) => {
      if (data.session?.user?.email) {
        setUserEmail(data.session.user.email);
        setResendEmail(data.session.user.email);
      }
    });

    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (s?.user?.email) {
        setUserEmail(s.user.email);
        setResendEmail(s.user.email);
      }
    });

    return () => sub?.subscription?.unsubscribe();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.length < 6) {
      setError('A nova senha deve ter no mínimo 6 caracteres.');
      return;
    }

    if (password !== confirmPassword) {
      setError('As senhas digitadas não coincidem.');
      return;
    }

    setBusy(true);
    try {
      const { error: err } = await supabase.auth.updateUser({ password });
      if (err) throw err;
      try { sessionStorage.removeItem('vs_password_recovery'); } catch {}
      setSuccess(true);
      try {
        window.history.replaceState(null, '', `${window.location.pathname}#baixar`);
      } catch {
        /* sem history */
      }
    } catch (err) {
      const msg = (err as Error).message;
      if (/session_id|jwt|expired|token/i.test(msg)) {
        setError('O link de recuperação expirou ou é inválido. Digite seu e-mail abaixo para solicitar um novo link.');
        setExpired(true);
      } else {
        setError(friendlyError(msg));
      }
    } finally {
      setBusy(false);
    }
  };

  const handleResend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resendEmail.trim()) return;
    setResendBusy(true);
    setError(null);
    try {
      const redirectTo = authRedirect('/recuperar');
      const { error: err } = await supabase.auth.resetPasswordForEmail(resendEmail.trim(), { redirectTo });
      if (err) throw err;
      setResendSuccess(true);
    } catch (err) {
      setError(friendlyError((err as Error).message));
    } finally {
      setResendBusy(false);
    }
  };

  return (
    <div
      className="min-h-screen bg-logic-bg-deep text-logic-text flex flex-col items-center justify-center p-4 sm:p-6 relative overflow-hidden"
      style={{ background: 'radial-gradient(ellipse at top, #181920 0%, #08090b 75%)' }}
    >
      {/* Luzes neon de fundo */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden" aria-hidden="true">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-logic-lcd-amber/10 blur-[130px]" />
        <div className="absolute bottom-1/4 right-1/4 w-[420px] h-[420px] rounded-full bg-logic-lcd-green/8 blur-[120px]" />
      </div>

      <div className="relative w-full max-w-md bg-logic-bg-panel/90 backdrop-blur-xl border border-logic-border-light rounded-2xl shadow-2xl overflow-hidden animate-[fadeIn_300ms_ease-out]">
        {/* Barra superior estilo DAW */}
        <div className="flex items-center justify-between px-5 h-11 border-b border-logic-border bg-logic-bg-elevated/70">
          <div className="flex items-center gap-2">
            <VsLogo size={20} />
            <span className="text-2xs font-extrabold tracking-wider text-logic-text">VS STAGE PRO</span>
          </div>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-logic-lcd-amber/15 text-logic-lcd-amber text-2xs font-bold tracking-wide">
            <KeyRound size={11} />
            RECUPERAÇÃO DE SENHA
          </span>
        </div>

        <div className="p-6 sm:p-8">
          {success ? (
            /* Tela de Sucesso */
            <div className="text-center animate-[fadeIn_200ms_ease-out]">
              <div className="mx-auto w-16 h-16 mb-4 rounded-2xl bg-logic-lcd-green/15 border border-logic-lcd-green/30 flex items-center justify-center shadow-lg shadow-logic-lcd-green/10">
                <CheckCircle2 size={34} className="text-logic-lcd-green" />
              </div>

              <h1 className="text-2xl font-extrabold text-white tracking-tight">
                Senha alterada com sucesso!
              </h1>

              <p className="text-sm text-logic-text-dim mt-2.5 leading-relaxed">
                Sua nova senha já está ativa. Você pode acessar sua conta normalmente no VS Stage.
              </p>

              <div className="mt-6 space-y-2.5">
                <a
                  href="/#baixar" onClick={() => { try { sessionStorage.removeItem('vs_password_recovery'); } catch {} }}
                  className="w-full h-11 rounded-xl bg-gradient-to-r from-logic-lcd-green to-emerald-500 hover:from-emerald-400 hover:to-logic-lcd-green text-black font-bold text-sm flex items-center justify-center gap-2 transition shadow-lg shadow-logic-lcd-green/20 group"
                >
                  <Apple size={18} />
                  <span>Ir para Download & Login</span>
                  <ChevronRight size={16} className="opacity-70 group-hover:translate-x-0.5 transition-transform" />
                </a>

                <a
                  href="/"
                  className="w-full h-9 rounded-xl bg-logic-bg-elevated hover:bg-logic-bg-panel-light text-logic-text-dim hover:text-logic-text text-xs font-semibold flex items-center justify-center transition border border-logic-border"
                >
                  Voltar para o site
                </a>
              </div>
            </div>
          ) : expired ? (
            /* Formulário para solicitar novo link caso tenha expirado */
            <div>
              <div className="text-center mb-6">
                <div className="mx-auto w-14 h-14 mb-3.5 rounded-2xl bg-logic-lcd-amber/15 border border-logic-lcd-amber/30 flex items-center justify-center shadow-lg shadow-logic-lcd-amber/10">
                  <RefreshCw size={26} className="text-logic-lcd-amber" />
                </div>
                <h1 className="text-2xl font-extrabold text-white tracking-tight">
                  Link Expirado
                </h1>
                <p className="text-xs text-logic-text-dim mt-2 leading-relaxed">
                  Por segurança, os links de troca de senha duram pouco tempo. Digite seu e-mail para receber um link novo imediatamente:
                </p>
              </div>

              {resendSuccess ? (
                <div className="p-4 rounded-xl bg-logic-lcd-green/15 border border-logic-lcd-green/40 text-center space-y-2 animate-[fadeIn_200ms_ease-out]">
                  <p className="text-xs text-logic-lcd-green font-semibold">
                    ✓ Enviamos um novo link de redefinição para o seu e-mail!
                  </p>
                  <p className="text-2xs text-logic-text-dim">
                    Abra o e-mail mais recente que você receber e clique em "Criar nova senha".
                  </p>
                </div>
              ) : (
                <form onSubmit={handleResend} className="space-y-4">
                  <input
                    type="email"
                    value={resendEmail}
                    onChange={(e) => setResendEmail(e.target.value)}
                    placeholder="Seu e-mail cadastrado"
                    required
                    autoFocus
                    className="w-full bg-logic-bg-deep text-sm text-logic-text px-4 py-2.5 rounded-lg border border-logic-border-light outline-none focus:border-logic-accent transition-colors placeholder:text-logic-text-muted"
                  />
                  <button
                    type="submit"
                    disabled={resendBusy || !resendEmail.trim()}
                    className="w-full h-11 rounded-xl bg-logic-lcd-amber text-black font-bold text-sm flex items-center justify-center gap-2 transition disabled:opacity-50"
                  >
                    {resendBusy && <Loader2 size={16} className="animate-spin" />}
                    <span>Enviar novo link de recuperação</span>
                  </button>
                </form>
              )}

              <div className="mt-5 text-center">
                <a
                  href="/#baixar"
                  className="text-xs text-logic-text-muted hover:text-logic-text transition underline underline-offset-4"
                >
                  Voltar para o login
                </a>
              </div>
            </div>
          ) : (
            /* Formulário Normal de Nova Senha */
            <div>
              <div className="text-center mb-6">
                <div className="mx-auto w-14 h-14 mb-3.5 rounded-2xl bg-logic-lcd-amber/15 border border-logic-lcd-amber/30 flex items-center justify-center shadow-lg shadow-logic-lcd-amber/10">
                  <ShieldCheck size={28} className="text-logic-lcd-amber" />
                </div>
                <h1 className="text-2xl font-extrabold text-white tracking-tight">
                  Criar nova senha
                </h1>
                <p className="text-xs text-logic-text-dim mt-2 leading-relaxed">
                  {userEmail ? (
                    <>Digite a nova senha para a conta <span className="font-semibold text-logic-text">{userEmail}</span>.</>
                  ) : (
                    'Escolha uma nova senha segura para sua conta no VS Stage.'
                  )}
                </p>
              </div>

              {error && (
                <div className="mb-5 px-3.5 py-2.5 rounded-xl border bg-logic-lcd-red/15 border-logic-lcd-red/40 text-logic-lcd-red text-xs text-center leading-relaxed">
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-2xs font-bold uppercase tracking-wider text-logic-text-muted mb-1.5">
                    Nova Senha
                  </label>
                  <div className="relative">
                    <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-logic-text-muted pointer-events-none" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Mínimo de 6 caracteres"
                      required
                      minLength={6}
                      autoFocus
                      className="w-full bg-logic-bg-deep text-sm text-logic-text pl-9 pr-10 py-2.5 rounded-lg border border-logic-border-light outline-none focus:border-logic-accent transition-colors placeholder:text-logic-text-muted"
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
                </div>

                <div>
                  <label className="block text-2xs font-bold uppercase tracking-wider text-logic-text-muted mb-1.5">
                    Confirmar Nova Senha
                  </label>
                  <div className="relative">
                    <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-logic-text-muted pointer-events-none" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Repita a nova senha"
                      required
                      minLength={6}
                      className="w-full bg-logic-bg-deep text-sm text-logic-text pl-9 pr-10 py-2.5 rounded-lg border border-logic-border-light outline-none focus:border-logic-accent transition-colors placeholder:text-logic-text-muted"
                    />
                  </div>
                  {password && confirmPassword && password !== confirmPassword && (
                    <p className="text-2xs text-logic-lcd-amber mt-1.5">As senhas digitadas não coincidem.</p>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={busy || !password || password.length < 6 || password !== confirmPassword}
                  className="w-full h-11 rounded-xl bg-gradient-to-r from-logic-lcd-green to-emerald-500 hover:from-emerald-400 hover:to-logic-lcd-green text-black font-bold text-sm flex items-center justify-center gap-2 transition shadow-lg shadow-logic-lcd-green/20 disabled:opacity-50 disabled:pointer-events-none mt-2"
                >
                  {busy ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                  <span>Salvar nova senha</span>
                </button>
              </form>

              <div className="mt-5 text-center">
                <a
                  href="/#baixar"
                  className="text-xs text-logic-text-muted hover:text-logic-text transition underline underline-offset-4"
                >
                  Voltar para o login
                </a>
              </div>
            </div>
          )}
        </div>

        {/* Rodapé do Card */}
        <div className="px-6 py-3 bg-logic-bg-deep/80 border-t border-logic-border flex items-center justify-between text-2xs text-logic-text-muted">
          <span>© 2026 VS Stage</span>
          <span className="text-logic-text-dim">Segurança da Conta</span>
        </div>
      </div>
    </div>
  );
}
