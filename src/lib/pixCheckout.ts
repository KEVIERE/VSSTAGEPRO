// Chamadas da tela para a função pix-checkout (Supabase), que fala com a InfinitePay.
import { supabase } from '@/lib/supabaseClient';

export type PixPlan = 'monthly' | 'yearly';
export type PixStatus = 'pending' | 'paid' | 'expired' | 'canceled' | 'amount_mismatch' | 'refunded';

export type PixCharge = {
  id: string;
  plan: PixPlan;
  amount_cents: number;
  status: PixStatus;
  expires_at: string;
  access_until: string | null;
  /**
   * Link de pagamento da InfinitePay (só enquanto aguarda pagamento).
   * O cliente escolhe PIX ou cartão na página dela.
   */
  checkout_url: string | null;
  /** Preço cheio do plano, antes do cupom. Servidor antigo pode não mandar. */
  full_cents?: number;
  /** Desconto do cupom em %, 0 sem cupom. */
  discount_percent?: number;
  coupon_code?: string | null;
  /** Forma que a InfinitePay confirmou, quando já pago. */
  capture_method?: 'pix' | 'credit_card' | null;
  installments?: number | null;
  /** Hora do servidor na resposta: a contagem regressiva usa ela, não o relógio do computador. */
  now?: string;
};

/** Códigos que a InfinitePay põe no endereço da página de volta (ver pixReturn.ts). */
export type PixReturnCodes = { order_nsu?: string; transaction_nsu?: string; slug?: string };

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

export const getPixStatus = (id: string, codes: PixReturnCodes = {}) => call({ action: 'status', id, ...codes });

/** Página de volta de um link sem o nosso código no endereço: o pedido informado ou o último da conta. */
export const getLatestPix = (codes: PixReturnCodes = {}) => call({ action: 'latest', ...codes });

export const PIX_ERRORS: Record<string, string> = {
  already_active: 'Sua assinatura já está ativa.',
  blocked: 'Esta conta está suspensa. Fale com o suporte.',
  invalid_cpf: 'CPF ou CNPJ inválido. Confira os números.',
  invalid_coupon: 'Esse cupom não é mais válido.',
  promo_expired: 'Esse cupom venceu.',
  promo_used_up: 'Esse cupom já atingiu o limite de usos.',
  invalid_plan: 'Plano inválido. Escolha Mensal ou Anual.',
  coupon_first_payment_only: 'Esse cupom vale só no primeiro pagamento.',
  coupon_own: 'Você não pode usar o seu próprio cupom.',
  amount_too_low: 'Com esse cupom o valor fica abaixo do mínimo permitido (R$ 5,00).',
  pix_not_configured: 'O pagamento ainda não está disponível. Tente mais tarde ou fale com o suporte.',
  unauthorized: 'Sua sessão expirou. Entre de novo na sua conta.',
  not_found: 'Não encontramos esse pagamento. Gere um novo link.',
  pix_failed: 'Não foi possível abrir o pagamento agora. Tente de novo em instantes.',
};
