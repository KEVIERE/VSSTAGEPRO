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
// verdade. Se a InfinitePay não confirmar, nada é liberado. O valor liberado,
// a forma de pagamento (PIX ou cartão) e as parcelas são os que a InfinitePay
// confirma, não os que o aviso diz. Os códigos do aviso só são gravados depois
// da confirmação, e o banco recusa um código de transação que já pagou outro
// pedido (pix_confirm_payment, resultado 'transaction_reused').
//
// Resposta: 200 quando tudo certo (a InfinitePay não reenvia), 400 quando algo
// deu errado (ela tenta de novo).
import {
  type Confirmation, type PaymentCheck, type PaymentCheckInput, type WebhookBody,
  normalizeCaptureMethod, normalizeInstallments, safeReceiptUrl,
} from './infinitepay.ts';
import type { ApplyResult } from './asaasWebhook.ts';

export type InfinitePayWebhookDeps = {
  /** INFINITEPAY_HANDLE (opcional quando há API Key) */
  handle?: string;
  /** Pedido criado por nós com esse order_nsu, ou null se não existir. */
  findOrder(orderNsu: string): Promise<{ status: string } | null>;
  /** POST /payment_check da InfinitePay. */
  checkPayment(input: PaymentCheckInput): Promise<PaymentCheck>;
  /**
   * pix_confirm_payment no banco: grava os códigos e a forma de pagamento já
   * conferidos e libera o tempo uma única vez.
   */
  applyPayment(orderNsu: string, paidCents: number, confirmation: Confirmation): Promise<ApplyResult>;
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
// Códigos que vêm no aviso (qualquer um pode mandar): só texto simples e curto.
const SAFE_ID_RE = /^[A-Za-z0-9_.:-]{1,120}$/;
const safeId = (v: unknown) => (typeof v === 'string' && SAFE_ID_RE.test(v) ? v : undefined);

export async function handleInfinitePayWebhook(req: Request, deps: InfinitePayWebhookDeps): Promise<Response> {
  if (req.method !== 'POST') return falhou('method_not_allowed');

  let corpo: WebhookBody;
  try { corpo = await req.json(); } catch { return falhou('invalid_body'); }

  const orderNsu = safeId(corpo?.order_nsu) ?? '';
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
  // Estorno registrado pelo admin: um aviso atrasado não devolve o tempo.
  if (row.status === 'refunded') return ok({ result: 'refunded' });

  const transactionNsu = safeId(corpo.transaction_nsu);
  const slug = safeId(corpo.invoice_slug);

  try {
    const check = await deps.checkPayment({
      handle: deps.handle || undefined,
      order_nsu: orderNsu,
      transaction_nsu: transactionNsu,
      slug,
    });

    // A InfinitePay é quem confirma. Se ela diz que não está pago, o aviso era
    // falso ou cedo demais: nada é liberado e nada do aviso é gravado.
    if (!check.paid) {
      deps.error('infinitepay-webhook aviso nao confirmado', orderNsu);
      return falhou('not_paid');
    }

    const pago = Math.round(check.paid_amount ?? check.amount ?? 0);
    const r = await deps.applyPayment(orderNsu, pago, {
      transactionNsu: transactionNsu ?? null,
      slug: slug ?? null,
      // Forma de pagamento e parcelas: sempre as da conferência, nunca as do aviso.
      captureMethod: normalizeCaptureMethod(check.capture_method),
      installments: normalizeInstallments(check.installments),
      // O comprovante só vem no aviso; vale apenas um endereço da própria InfinitePay.
      receiptUrl: safeReceiptUrl(corpo.receipt_url),
    });

    if (r.result === 'amount_mismatch') {
      deps.error(
        `infinitepay-webhook valor menor, nao liberado. ${orderNsu}: pago ${fmt(pago)}, esperado ${fmt(r.expected_cents)}`,
      );
      return ok({ result: 'amount_mismatch' });
    }

    if (r.result === 'transaction_reused') {
      // Código de uma transação que já liberou outro pedido: pode ser tentativa de
      // fraude. Não libera e responde 200 para a InfinitePay não insistir.
      deps.error('infinitepay-webhook transacao ja usada em outro pedido, nao liberado', orderNsu);
      return ok({ result: 'transaction_reused' });
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
