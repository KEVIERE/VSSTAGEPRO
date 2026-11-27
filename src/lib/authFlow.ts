import { googlePkceClient, supabase } from '@/lib/supabaseClient';

// Código promocional digitado na tela de entrada: é resgatado assim que a conta entra
// (fica guardado caso o cadastro ainda precise ser confirmado).
export const PENDING_PROMO_LS = 'vs-pending-promo';

// Telefone para E.164. Sem "+", assume Brasil (+55) quando vem DDD + número.
export function normalizePhone(raw: string): string | null {
  const t = raw.trim();
  const digits = t.replace(/\D/g, '');
  if (t.startsWith('+')) return /^[1-9]\d{9,14}$/.test(digits) ? `+${digits}` : null;
  if (digits.length === 10 || digits.length === 11) return `+55${digits}`;
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) return `+${digits}`;
  return null;
}

// Máscara enquanto digita: (11) 91234-5678.
export function maskPhone(raw: string): string {
  if (raw.trim().startsWith('+')) return raw.replace(/[^\d+\s()-]/g, '').slice(0, 20);
  const d = raw.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 2) return d ? `(${d}` : '';
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

export function maskEmail(email: string) {
  const [user, domain] = email.split('@');
  if (!domain) return email;
  return `${user.slice(0, 2)}${'•'.repeat(Math.max(1, user.length - 2))}@${domain}`;
}

// Entrar ou criar conta com a conta do Google. Não pede confirmação de e-mail:
// o OAuth do Supabase cria a conta (ou a acha se já existe) e já estabelece a sessão.
export async function signInWithGoogle(): Promise<void> {
  // No programa de computador o Google abre no navegador padrão e volta ao programa.
  if (hasDesktopGoogle()) return signInWithGoogleDesktop();
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      // O login Google termina diretamente na área protegida de downloads.
      redirectTo: `${window.location.origin}/#baixar`,
    },
  });
  if (error) throw error;
}

/** O programa de computador sabe receber o retorno do Google. */
export function hasDesktopGoogle(): boolean {
  return typeof window !== 'undefined' && Boolean(window.vsDesktop?.googleAuthWait);
}

// Cada entrada nova ou Cancelar troca o número: quem estava esperando sabe que foi cancelado.
let googleAttempt = 0;

/** A pessoa desistiu no programa: o botão volta ao normal. */
export function cancelGoogleSignIn(): void {
  googleAttempt += 1;
  window.vsDesktop?.googleAuthCancel?.().catch(() => {});
}

/** Retorno do navegador para o código de erro que a tela mostra (ver friendlyError). */
export function googleReturnError(res: { status: string; error?: string; description?: string }): string {
  if (res.status === 'cancelled') return 'google_cancelled';
  if (res.status === 'timeout') return 'google_timeout';
  const all = `${res.error ?? ''} ${res.description ?? ''}`;
  if (/access_denied|cancel/i.test(all)) return 'google_denied';
  if (/multiple accounts|same email|identity.*(exists|already)|already linked|email.*(exists|registered)/i.test(all)) return 'google_email_conflict';
  if (/email.*external provider|unverified|email not confirmed/i.test(all)) return 'google_no_email';
  if (res.error === 'google_port_busy') return 'google_port_busy';
  return 'google_failed';
}

// Fluxo PKCE: o endereço do Google é pedido sem abrir aqui, o programa abre no navegador e espera
// o retorno em 127.0.0.1; o código vira sessão aqui (o verificador nunca sai do programa) e a
// sessão passa ao cliente principal. Dali segue o mesmo caminho de quem entra com e-mail e senha:
// o aviso SIGNED_IN confere licença, aparelho, parceiro e assinatura.
async function signInWithGoogleDesktop(): Promise<void> {
  const desk = window.vsDesktop!;
  const mine = ++googleAttempt;
  const cancelled = () => mine !== googleAttempt;
  const prep = await desk.googleAuthPrepare!();
  if (cancelled()) throw new Error('google_cancelled');
  if (!prep?.redirectTo) throw new Error(prep?.error === 'google_port_busy' ? 'google_port_busy' : 'google_failed');
  const pkce = googlePkceClient();
  const { data, error } = await pkce.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: prep.redirectTo, skipBrowserRedirect: true, queryParams: { prompt: 'select_account' } },
  });
  // Cancelar enquanto o endereço do Google era pedido: volta calado, sem mostrar erro.
  if (cancelled()) throw new Error('google_cancelled');
  if (error || !data?.url) {
    cancelGoogleSignIn();
    throw error ?? new Error('google_failed');
  }
  const res = await desk.googleAuthWait!(data.url);
  if (cancelled()) throw new Error('google_cancelled');
  if (res.status !== 'ok' || !res.code) throw new Error(googleReturnError(res));
  const { data: ex, error: exErr } = await pkce.auth.exchangeCodeForSession(res.code);
  if (exErr || !ex?.session) throw new Error(exErr ? googleReturnError({ status: 'error', description: exErr.message }) : 'google_failed');
  const { error: setErr } = await supabase.auth.setSession({
    access_token: ex.session.access_token,
    refresh_token: ex.session.refresh_token,
  });
  if (setErr) throw setErr;
}

export async function phoneSignup(body: Record<string, unknown>): Promise<{ ok: true; phone_hint?: string }> {
  const { data, error } = await supabase.functions.invoke('signup-phone', { body });
  if (error) {
    const res = await (error as { context?: Response }).context?.json?.().catch(() => null);
    throw new Error(res?.error ?? 'request_failed');
  }
  if (data?.error) throw new Error(data.error);
  return data;
}
