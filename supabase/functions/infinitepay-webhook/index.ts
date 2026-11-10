// Aviso de pagamento da InfinitePay. A regra fica em _shared/infinitepayWebhook.ts
// (testada em tests/infinitepay.test.mjs): o aviso não tem assinatura, então só
// serve de gatilho, e quem confirma o pagamento é o POST /payment_check.
import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import { infinitePayClient } from '../_shared/infinitepay.ts';
import { handleInfinitePayWebhook } from '../_shared/infinitepayWebhook.ts';
import { applyPaymentByOrder, setInfinitePayIds } from '../_shared/pixDb.ts';

const infinitepay = infinitePayClient(Deno.env.get('INFINITEPAY_API_KEY') ?? '');

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

Deno.serve((req) =>
  handleInfinitePayWebhook(req, {
    handle: Deno.env.get('INFINITEPAY_HANDLE') ?? '',
    findOrder: async (orderNsu) => {
      const { data, error } = await admin
        .from('pix_payments')
        .select('id, status, amount_cents, user_id')
        .eq('order_nsu', orderNsu)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data as { status: string } | null;
    },
    saveIds: (orderNsu, transactionNsu, slug) => setInfinitePayIds(admin, orderNsu, transactionNsu, slug),
    checkPayment: (input) => infinitepay.conferirPagamento(input),
    applyPayment: (orderNsu, paidCents) => applyPaymentByOrder(admin, orderNsu, paidCents),
    log: (...args) => console.log(...args),
    error: (...args) => console.error(...args),
  })
);
