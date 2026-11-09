// Aviso de pagamento da InfinitePay.
//
// O webhook da InfinitePay NÃO tem assinatura, token nem header secreto — a
// própria documentação diz isso. Então o corpo do POST não prova nada: quem
// descobrisse esta URL poderia mandar { "order_nsu": "..." } e liberar
// assinatura de graça.
//
// Por isso este handler nunca confia no aviso. Ele usa o aviso apenas como
// GATILHO e confirma o pagamento em POST /payment_check, que é a fonte da
// verdade. Se a InfinitePay não confirmar, nada é liberado.
//
// Resposta: 200 quando tudo certo (a InfinitePay não reenvia), 400 quando algo
// deu errado (ela tenta de novo).
import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import { infinitePayClient, type WebhookBody } from '../_shared/infinitepay.ts';
import { applyPaymentByOrder, setInfinitePayIds } from '../_shared/pixDb.ts';

const apiKey = Deno.env.get('INFINITEPAY_API_KEY') ?? '';
const handle = Deno.env.get('INFINITEPAY_HANDLE') ?? '';
const infinitepay = infinitePayClient(apiKey);

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

const ok = (body: unknown) => new Response(JSON.stringify(body), {
  status: 200, headers: { 'Content-Type': 'application/json' },
});
const falhou = (motivo: string) => new Response(JSON.stringify({ error: motivo }), {
  status: 400, headers: { 'Content-Type': 'application/json' },
});

const fmt = (cents?: number | null) =>
  typeof cents === 'number' ? `R$ ${(cents / 100).toFixed(2).replace('.', ',')}` : '?';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return falhou('method_not_allowed');

  let corpo: WebhookBody;
  try { corpo = await req.json(); } catch { return falhou('invalid_body'); }

  const orderNsu = typeof corpo.order_nsu === 'string' ? corpo.order_nsu : '';
  if (!orderNsu) return falhou('missing_order_nsu');

  // O order_nsu precisa ser de um pedido que nós criamos. Sem isso, um aviso
  // inventado só faria a função trabalhar à toa.
  const { data: row, error: rowErr } = await admin
    .from('pix_payments')
    .select('id, status, amount_cents, user_id')
    .eq('order_nsu', orderNsu)
    .maybeSingle();
  if (rowErr) {
    console.error('infinitepay-webhook row', rowErr.message);
    return falhou('db_error');
  }
  if (!row) {
    console.error('infinitepay-webhook pedido desconhecido', orderNsu);
    return falhou('unknown_order');
  }

  // Já liberado antes: responde 200 para a InfinitePay parar de reenviar.
  if (row.status === 'paid') return ok({ result: 'already_paid' });

  // Guarda os identificadores deles: o /payment_check exige os dois.
  await setInfinitePayIds(admin, orderNsu, corpo.transaction_nsu ?? null, corpo.invoice_slug ?? null)
    .catch((e) => console.error('infinitepay-webhook ids', e instanceof Error ? e.message : e));

  try {
    const check = await infinitepay.conferirPagamento({
      handle: handle || undefined,
      order_nsu: orderNsu,
      transaction_nsu: corpo.transaction_nsu,
      slug: corpo.invoice_slug,
    });

    // A InfinitePay é quem confirma. Se ela diz que não está pago, o aviso era
    // falso ou cedo demais — nada é liberado.
    if (!check.paid) {
      console.error('infinitepay-webhook aviso nao confirmado', orderNsu);
      return falhou('not_paid');
    }

    const pago = Math.round(check.paid_amount ?? check.amount ?? 0);
    const r = await applyPaymentByOrder(admin, orderNsu, pago);

    if (r.result === 'amount_mismatch') {
      console.error(
        `infinitepay-webhook valor menor — nao liberado. ${orderNsu}: pago ${fmt(pago)}, esperado ${fmt(r.expected_cents)}`,
      );
      return ok({ result: 'amount_mismatch' });
    }

    if (r.result === 'unknown_payment') {
      console.error('infinitepay-webhook pedido sumiu ao aplicar', orderNsu);
      return falhou('unknown_order');
    }

    console.log('infinitepay-webhook liberado', orderNsu, r.result, pago);
    return ok({ result: r.result });
  } catch (e) {
    // Erro passageiro (rede, API fora): responde 400 e a InfinitePay tenta de novo.
    console.error('infinitepay-webhook falhou', orderNsu, e instanceof Error ? e.message : e);
    return falhou('confirm_failed');
  }
});
