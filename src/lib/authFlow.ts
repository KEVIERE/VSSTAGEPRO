import { supabase } from '@/lib/supabaseClient';

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

export async function phoneSignup(body: Record<string, unknown>): Promise<{ ok: true; phone_hint?: string }> {
  const { data, error } = await supabase.functions.invoke('signup-phone', { body });
  if (error) {
    const res = await (error as { context?: Response }).context?.json?.().catch(() => null);
    throw new Error(res?.error ?? 'request_failed');
  }
  if (data?.error) throw new Error(data.error);
  return data;
}
