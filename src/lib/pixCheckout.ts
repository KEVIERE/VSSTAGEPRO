// Chamadas da tela para a função pix-checkout (Supabase), que fala com a InfinitePay.
import { supabase } from '@/lib/supabaseClient';

export type PixPlan = 'monthly' | 'yearly';
export type PixStatus = 'pending' | 'paid' | 'expired' | 'canceled' | 'amount_mismatch';

export type PixCharge = {
  id: string;
  plan: PixPlan;
  amount_cents: number;
  status: PixStatus;
  expires_at: string;
  access_until: string | null;
  /**
   * Link de pagamento da InfinitePay (só enquanto aguarda pagamento).
   * A InfinitePay não devolve QR Code: o cliente paga na página dela.
   */
  checkout_url: string | null;
};

async function call(body: Record<string, unknown>): Promise<PixCharge> {
  const { data, error } = await supabase.functions.invoke('pix-checkout', { body });
  if (error) {
    const res = await (error as { context?: Response }).context?.json?.().catch(() => null);
    throw new Error(res?.error ?? 'pix_failed');
  }
  if (!data?.id) throw new Error('pix_failed');
  return data as PixCharge;
}

export const createPix = (plan: PixPlan, opts: { cpfCnpj?: string; couponCode?: string } = {}) =>
  call({ action: 'create', plan, ...opts });

export const getPixStatus = (id: string) => call({ action: 'status', id });

export const PIX_ERRORS: Record<string, string> = {
  already_active: 'Sua assinatura no cartão já está ativa.',
  blocked: 'Esta conta está suspensa. Fale com o suporte.',
  invalid_cpf: 'CPF ou CNPJ inválido. Confira os números.',
  invalid_coupon: 'Esse cupom não é mais válido.',
  amount_too_low: 'Com esse cupom o valor fica abaixo do mínimo permitido (R$ 5,00).',
  pix_not_configured: 'O PIX ainda não está disponível. Use o cartão ou tente mais tarde.',
  unauthorized: 'Sua sessão expirou. Entre de novo na sua conta.',
  not_found: 'Não encontramos esse PIX. Gere um novo.',
  pix_failed: 'Não foi possível gerar o PIX agora. Tente de novo em instantes.',
};
