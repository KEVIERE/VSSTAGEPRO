// Aviso de pagamento da InfinitePay. A regra fica em _shared/infinitepayWebhook.ts
// (testada em tests/infinitepay.test.mjs): o aviso não tem assinatura, então só
// serve de gatilho, e quem confirma o pagamento é o POST /payment_check.
//
// Precisa ser publicada com verify_jwt = false: a InfinitePay não manda login do
// Supabase. A segurança é a conferência no /payment_check, não o JWT.
import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import { infinitePayClient } from '../_shared/infinitepay.ts';
import { handleInfinitePayWebhook } from '../_shared/infinitepayWebhook.ts';
import { applyPaymentByOrder } from '../_shared/pixDb.ts';

const infinitepay = infinitePayClient(Deno.env.get('INFINITEPAY_API_KEY') ?? '');

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

/** Uma linha por aviso em webhook_events_log, para o monitoramento saber a hora do último.
 *  Sem dados pessoais: só o resultado. Falha aqui nunca muda a resposta à InfinitePay. */
async function registrar(res: Response): Promise<void> {
  try {
    const body = await res.clone().json().catch(() => ({})) as { result?: string; error?: string };
    await admin.from('webhook_events_log').insert({
      source: 'infinitepay',
      event_type: 'payment',
      status: res.ok ? 'ok' : 'error',
      detail: String(body.result ?? body.error ?? res.status).slice(0, 60),
    });
  } catch (e) {
    console.error('infinitepay-webhook log', e instanceof Error ? e.message : e);
  }
}

Deno.serve(async (req) => {
  const res = await handleInfinitePayWebhook(req, {
    handle: Deno.env.get('INFINITEPAY_HANDLE') ?? '',
    findOrder: async (orderNsu) => {
      const { data, error } = await admin
        .from('pix_payments')
        .select('id, status')
        .eq('order_nsu', orderNsu)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data as { status: string } | null;
    },
    checkPayment: (input) => infinitepay.conferirPagamento(input),
    applyPayment: (orderNsu, paidCents, confirmation) => applyPaymentByOrder(admin, orderNsu, paidCents, confirmation),
    log: (...args) => console.log(...args),
    error: (...args) => console.error(...args),
  });
  await registrar(res);
  return res;
});
