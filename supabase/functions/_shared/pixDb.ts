// Acesso ao banco usado pelas duas funções do PIX (sempre com o service role).
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.57.4';
import type { ApplyResult } from './asaasWebhook.ts';
import type { Confirmation } from './infinitepay.ts';
import { type MetaTracking, type PurchaseInput, metaConfigFromEnv, reportPurchaseToMeta } from './metaCapi.ts';

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

/**
 * Pedido pago com o que a API de Conversões da Meta precisa (metaCapi.ts): valor,
 * plano, e-mail e telefone da conta e os cookies gravados ao abrir o pagamento.
 * Se a migração da meta_tracking ainda não estiver no banco, segue sem ela.
 */
export async function loadPurchaseForMeta(admin: SupabaseClient, orderNsu: string): Promise<Omit<PurchaseInput, 'eventTime'> | null> {
  const cols = 'id, user_id, plan, amount_cents, order_nsu';
  type Res = { data: unknown; error: { message: string } | null };
  let res: Res = await admin.from('pix_payments').select(`${cols}, meta_tracking`).eq('order_nsu', orderNsu).maybeSingle();
  if (res.error) res = await admin.from('pix_payments').select(cols).eq('order_nsu', orderNsu).maybeSingle();
  if (res.error) throw new Error(`pix_payments: ${res.error.message}`);
  const row = res.data as { id: string; user_id: string; plan: string; amount_cents: number; order_nsu: string; meta_tracking?: MetaTracking | null } | null;
  if (!row) return null;
  const { data: u } = await admin.auth.admin.getUserById(row.user_id);
  const meta = (u?.user?.user_metadata ?? {}) as { phone?: string };
  return {
    paymentId: row.id,
    orderNsu: row.order_nsu,
    plan: row.plan,
    amountCents: row.amount_cents,
    userId: row.user_id,
    email: u?.user?.email ?? null,
    phone: u?.user?.phone || meta.phone || null,
    tracking: row.meta_tracking ?? null,
  };
}

/** Purchase da Meta pelo servidor, para quem acabou de liberar um pedido ('activated'). */
export function metaPurchaseReporter(admin: SupabaseClient, siteUrl: string) {
  const configs = metaConfigFromEnv((k) => Deno.env.get(k), siteUrl);
  return (orderNsu: string) => reportPurchaseToMeta({
    configs,
    loadPurchase: (nsu) => loadPurchaseForMeta(admin, nsu),
    fetch: (url, init) => fetch(url, init),
    now: () => Date.now(),
    log: (...a) => console.log(...a),
    error: (...a) => console.error(...a),
  }, orderNsu);
}
