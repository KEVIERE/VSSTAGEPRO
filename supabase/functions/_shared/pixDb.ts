// Acesso ao banco usado pelas duas funções do PIX (sempre com o service role).
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.57.4';
import type { ApplyResult } from './asaasWebhook.ts';

export async function applyPixPayment(admin: SupabaseClient, asaasPaymentId: string, paidCents: number): Promise<ApplyResult> {
  const { data, error } = await admin.rpc('pix_apply_payment', { p_asaas_payment_id: asaasPaymentId, p_paid_cents: paidCents });
  if (error) throw new Error(`pix_apply_payment: ${error.message}`);
  return data as ApplyResult;
}

/** Libera o plano pelo pedido (order_nsu), usado pela InfinitePay. */
export async function applyPaymentByOrder(admin: SupabaseClient, orderNsu: string, paidCents: number | null): Promise<ApplyResult> {
  const { data, error } = await admin.rpc('pix_apply_payment_by_order', { p_order_nsu: orderNsu, p_paid_cents: paidCents });
  if (error) throw new Error(`pix_apply_payment_by_order: ${error.message}`);
  return data as ApplyResult;
}

/** Guarda os identificadores da InfinityPay (transação e fatura) na linha do pedido. */
export async function setInfinitePayIds(admin: SupabaseClient, orderNsu: string, transactionNsu: string | null, slug: string | null): Promise<void> {
  const { error } = await admin.rpc('pix_set_infinitepay_ids', {
    p_order_nsu: orderNsu, p_transaction_nsu: transactionNsu, p_invoice_slug: slug,
  });
  if (error) throw new Error(`pix_set_infinitepay_ids: ${error.message}`);
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
