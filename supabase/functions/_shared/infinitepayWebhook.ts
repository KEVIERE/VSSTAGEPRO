// Aviso de pagamento da InfinitePay. Fica separado do index.ts para os testes
// rodarem sem o Supabase nem a InfinitePay de verdade: tudo que fala com fora
// entra por `deps` (tests/infinitepay.test.mjs, npm test).
//
// O webhook da InfinitePay NÃO tem assinatura, token nem header secreto: a
// própria documentação diz isso. Então o corpo do POST não prova nada: quem
// descobrisse esta URL poderia mandar { "order_nsu": "..." } e liberar
// assinatura de graça.
//
// Por isso este handler nunca confia no aviso. Ele usa o aviso apenas como
// GATILHO e confirma o pagamento em POST /payment_check, que é a fonte da
// verdade. Se a InfinitePay não confirmar, nada é liberado. Até o valor
// liberado é o que a InfinitePay confirma, não o que o aviso diz.
//
// Resposta: 200 quando tudo certo (a InfinitePay não reenvia), 400 quando algo
// deu errado (ela tenta de novo).
import type { PaymentCheck, PaymentCheckInput, WebhookBody } from './infinitepay.ts';
import type { ApplyResult } from './asaasWebhook.ts';

export type InfinitePayWebhookDeps = {
  /** INFINITEPAY_HANDLE (opcional quando há API Key) */
  handle?: string;
  /** Pedido criado por nós com esse order_nsu, ou null se não existir. */
  findOrder(orderNsu: string): Promise<{ status: string } | null>;
  /** Guarda transaction_nsu e invoice_slug: o /payment_check exige os dois. */
  saveIds(orderNsu: string, transactionNsu: string | null, slug: string | null): Promise<void>;
  /** POST /payment_check da InfinitePay. */
  checkPayment(input: PaymentCheckInput): Promise<PaymentCheck>;
  /** pix_apply_payment_by_order no banco: libera o tempo uma única vez. */
  applyPayment(orderNsu: string, paidCents: number): Promise<ApplyResult>;
  log(message: string, ...extra: unknown[]): void;
  error(message: string, ...extra: unknown[]): void;
};

const ok = (body: unknown) => new Response(JSON.stringify(body), {
  status: 200, headers: { 'Content-Type': 'application/json' },
});
const falhou = (motivo: string) => new Response(JSON.stringify({ error: motivo }), {
  status: 400, headers: { 'Content-Type': 'application/json' },
});

const fmt = (cents?: number | null) =>
  typeof cents === 'number' ? `R$ ${(cents / 100).toFixed(2).replace('.', ',')}` : '?';
const msg = (e: unknown) => (e instanceof Error ? e.message : e);

export async function handleInfinitePayWebhook(req: Request, deps: InfinitePayWebhookDeps): Promise<Response> {
  if (req.method !== 'POST') return falhou('method_not_allowed');

  let corpo: WebhookBody;
  try { corpo = await req.json(); } catch { return falhou('invalid_body'); }

  const orderNsu = typeof corpo?.order_nsu === 'string' ? corpo.order_nsu : '';
  if (!orderNsu) return falhou('missing_order_nsu');

  // O order_nsu precisa ser de um pedido que nós criamos. Sem isso, um aviso
  // inventado só faria a função trabalhar à toa.
  let row: { status: string } | null;
  try {
    row = await deps.findOrder(orderNsu);
  } catch (e) {
    deps.error('infinitepay-webhook row', msg(e));
    return falhou('db_error');
  }
  if (!row) {
    deps.error('infinitepay-webhook pedido desconhecido', orderNsu);
    return falhou('unknown_order');
  }

  // Já liberado antes: responde 200 para a InfinitePay parar de reenviar.
  if (row.status === 'paid') return ok({ result: 'already_paid' });

  const transactionNsu = typeof corpo.transaction_nsu === 'string' ? corpo.transaction_nsu : undefined;
  const slug = typeof corpo.invoice_slug === 'string' ? corpo.invoice_slug : undefined;

  // Guarda os identificadores deles: o /payment_check exige os dois.
  await deps.saveIds(orderNsu, transactionNsu ?? null, slug ?? null)
    .catch((e) => deps.error('infinitepay-webhook ids', msg(e)));

  try {
    const check = await deps.checkPayment({
      handle: deps.handle || undefined,
      order_nsu: orderNsu,
      transaction_nsu: transactionNsu,
      slug,
    });

    // A InfinitePay é quem confirma. Se ela diz que não está pago, o aviso era
    // falso ou cedo demais: nada é liberado.
    if (!check.paid) {
      deps.error('infinitepay-webhook aviso nao confirmado', orderNsu);
      return falhou('not_paid');
    }

    const pago = Math.round(check.paid_amount ?? check.amount ?? 0);
    const r = await deps.applyPayment(orderNsu, pago);

    if (r.result === 'amount_mismatch') {
      deps.error(
        `infinitepay-webhook valor menor, nao liberado. ${orderNsu}: pago ${fmt(pago)}, esperado ${fmt(r.expected_cents)}`,
      );
      return ok({ result: 'amount_mismatch' });
    }

    if (r.result === 'unknown_payment') {
      deps.error('infinitepay-webhook pedido sumiu ao aplicar', orderNsu);
      return falhou('unknown_order');
    }

    deps.log('infinitepay-webhook liberado', orderNsu, r.result, pago);
    return ok({ result: r.result });
  } catch (e) {
    // Erro passageiro (rede, API fora): responde 400 e a InfinitePay tenta de novo.
    deps.error('infinitepay-webhook falhou', orderNsu, msg(e));
    return falhou('confirm_failed');
  }
}
