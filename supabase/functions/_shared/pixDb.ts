// Acesso ao banco usado pelas duas funções do PIX (sempre com o service role).
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.57.4';
import type { ApplyResult } from './asaasWebhook.ts';

export async function applyPixPayment(admin: SupabaseClient, asaasPaymentId: string, paidCents: number): Promise<ApplyResult> {
  const { data, error } = await admin.rpc('pix_apply_payment', { p_asaas_payment_id: asaasPaymentId, p_paid_cents: paidCents });
  if (error) throw new Error(`pix_apply_payment: ${error.message}`);
  return data as ApplyResult;
}

/** Fecha o PIX só se ainda estiver aguardando pagamento. Devolve true se fechou. */
export async function closePendingPix(admin: SupabaseClient, asaasPaymentId: string, status: 'expired' | 'canceled'): Promise<boolean> {
  const { data, error } = await admin
    .from('pix_payments')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('asaas_payment_id', asaasPaymentId)
    .eq('status', 'pending')
    .select('id');
  if (error) throw new Error(`pix_payments: ${error.message}`);
  return (data ?? []).length > 0;
}
