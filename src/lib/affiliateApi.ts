// Chamadas do programa de afiliados (funções do banco; ver a migração 20261110230000_afiliados.sql).
import { supabase } from '@/lib/supabaseClient';
import type { CommissionStatus, PixKeyType } from '@/lib/affiliateRules';
import { clearAffiliateRef, readAffiliateRef } from '@/lib/affiliateRef';

export type AffiliateMe = {
  affiliate: true;
  code: string;
  status: 'active' | 'paused' | 'ended';
  commission_percent: number;
  discount_percent: number;
  pix_key_type: PixKeyType | null;
  pix_key: string | null;
  payout_name: string | null;
  created_at: string;
  min_payout_cents: number;
  signups: number;
  paying_customers: number;
  active_subscribers: number;
  earned_month_cents: number;
  earned_total_cents: number;
  available_cents: number;
  pending_cents: number;
  reserved_cents: number;
  paid_cents: number;
  releases: Array<{ available_at: string; commission_cents: number }>;
  open_payout: { id: string; amount_cents: number; requested_at: string } | null;
  monthly: Array<{ month: string; cents: number }>;
};

export type AffiliateCustomer = {
  created_at: string;
  source: 'link' | 'coupon';
  name: string | null;
  email: string;
  situation: 'signed_up' | 'paid' | 'active';
  earned_cents: number;
};

export type AffiliateCommission = {
  id: string;
  created_at: string;
  plan: 'monthly' | 'yearly' | null;
  base_cents: number;
  percent: number;
  commission_cents: number;
  status: CommissionStatus;
  available_at: string;
  payout_id: string | null;
  cancel_reason: string | null;
  customer_name?: string | null;
  customer_email?: string | null;
};

export type AffiliatePayout = {
  id: string;
  amount_cents: number;
  status: 'requested' | 'paid' | 'rejected';
  requested_at: string;
  paid_at: string | null;
  reference: string | null;
  reject_reason: string | null;
  pix_key_type: PixKeyType;
  pix_key: string;
  payout_name?: string;
};

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export const affiliateApi = {
  me: () => rpc<AffiliateMe | { affiliate: false }>('affiliate_me'),
  customers: () => rpc<AffiliateCustomer[]>('affiliate_customers'),
  commissions: () => rpc<AffiliateCommission[]>('affiliate_commissions_list'),
  payouts: () => rpc<AffiliatePayout[]>('affiliate_payouts_list'),
  setPix: (type: PixKeyType, key: string, name: string) =>
    rpc<void>('affiliate_set_pix', { p_type: type, p_key: key, p_name: name }),
  requestPayout: async () => {
    const r = await rpc<{ id: string; amount_cents: number }>('affiliate_payout_request');
    // Aviso ao admin no Telegram. Falha aqui não desfaz o pedido: ele já aparece no admin.
    supabase.functions.invoke('telegram-alert', { body: { event: 'affiliate_payout_requested' } }).catch(() => {});
    return r;
  },
};

/**
 * Liga a conta que acabou de entrar ao afiliado do link guardado. Uma vez só: o código é
 * apagado depois da resposta (ligou ou não). Erro de rede mantém o código para a próxima vez.
 */
export async function claimAffiliateRef(): Promise<void> {
  const code = readAffiliateRef();
  if (!code) return;
  const { error } = await supabase.rpc('affiliate_claim', { p_code: code });
  if (!error) clearAffiliateRef();
}

/**
 * Cupom de afiliado para aplicar sozinho na tela de assinatura, ou null.
 * Com conta: o cupom de quem trouxe a conta (se ainda vale) ou o do link guardado, conferido
 * para esta conta. Sem conta: só mostra o do link guardado (o servidor confere no pagamento).
 */
export async function resolveAffiliateCoupon(loggedIn: boolean): Promise<{ code: string; percent: number } | null> {
  try {
    if (loggedIn) {
      const mine = await rpc<{ code: string; percent: number } | null>('affiliate_referral_coupon');
      if (mine?.code && mine.percent > 0) return mine;
    }
    const code = readAffiliateRef();
    if (!code) return null;
    if (loggedIn) {
      const check = await rpc<{ valid: boolean; percent?: number }>('discount_check', { p_code: code });
      return check?.valid && check.percent ? { code, percent: check.percent } : null;
    }
    const info = await rpc<{ valid: boolean; code?: string; discount_percent?: number }>('affiliate_code_info', { p_code: code });
    return info?.valid && info.code && info.discount_percent ? { code: info.code, percent: info.discount_percent } : null;
  } catch {
    return null;
  }
}
