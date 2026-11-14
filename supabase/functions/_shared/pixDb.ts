// Acesso ao banco usado pelas duas funções do PIX (sempre com o service role).
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.57.4';
import type { ApplyResult } from './asaasWebhook.ts';
import type { Confirmation } from './infinitepay.ts';

export async function applyPixPayment(admin: SupabaseClient, asaasPaymentId: string, paidCents: number): Promise<ApplyResult> {
  const { data, error } = await admin.rpc('pix_apply_payment', { p_asaas_payment_id: asaasPaymentId, p_paid_cents: paidCents });
  if (error) throw new Error(`pix_apply_payment: ${error.message}`);
  return data as ApplyResult;
}

/**
 * Libera o plano pelo pedido (order_nsu), usado pela InfinitePay. Chama
 * pix_confirm_payment, que grava os códigos e a forma de pagamento já conferidos
 * no /payment_check, recusa uma transação que já pagou outro pedido
 * ('transaction_reused') e só então libera o tempo (pix_apply_payment_by_order).
 */
export async function applyPaymentByOrder(
  admin: SupabaseClient, orderNsu: string, paidCents: number | null, confirmation?: Partial<Confirmation>,
): Promise<ApplyResult> {
  const { data, error } = await admin.rpc('pix_confirm_payment', {
    p_order_nsu: orderNsu,
    p_paid_cents: paidCents,
    p_transaction_nsu: confirmation?.transactionNsu ?? null,
    p_slug: confirmation?.slug ?? null,
    p_capture_method: confirmation?.captureMethod ?? null,
    p_installments: confirmation?.installments ?? null,
    p_receipt_url: confirmation?.receiptUrl ?? null,
  });
  if (error) throw new Error(`pix_confirm_payment: ${error.message}`);
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
