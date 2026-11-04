// Recebe os avisos (webhook) do Asaas. Fica separado do index.ts para os testes rodarem sem o
// Supabase nem o Asaas de verdade: tudo que fala com fora entra por `deps`.
import { asaasPaymentKind, centsFromReais, safeEqual } from './pix.ts';
import type { AsaasPayment } from './asaas.ts';

export type ApplyResult = {
  result: 'activated' | 'already_paid' | 'amount_mismatch' | 'unknown_payment';
  user_id?: string;
  access_until?: string;
  expected_cents?: number;
  paid_cents?: number;
};

export type WebhookDeps = {
  /** ASAAS_WEBHOOK_TOKEN: o mesmo texto cadastrado no webhook do Asaas */
  token: string | undefined;
  getPayment(id: string): Promise<AsaasPayment>;
  /** pix_apply_payment no banco: libera o tempo uma única vez */
  applyPayment(id: string, paidCents: number): Promise<ApplyResult>;
  /** Fecha o PIX só se ainda estiver aguardando. Devolve true se era nosso e estava aberto. */
  closePending(id: string, status: 'expired' | 'canceled'): Promise<boolean>;
  deletePayment(id: string): Promise<void>;
  log(eventType: string, ok: boolean, detail: string): Promise<void>;
  alert(text: string): Promise<void>;
};

const PAID_EVENTS = new Set(['PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED']);
const REFUND_EVENTS = new Set(['PAYMENT_REFUNDED', 'PAYMENT_CHARGEBACK_REQUESTED', 'PAYMENT_RECEIVED_IN_CASH_UNDONE']);

const reply = (body: string, status = 200) =>
  new Response(JSON.stringify({ result: body }), { status, headers: { 'Content-Type': 'application/json' } });

export async function handleAsaasWebhook(req: Request, deps: WebhookDeps): Promise<Response> {
  if (req.method !== 'POST') return reply('method_not_allowed', 405);
  // sem token configurado, nenhum aviso é aceito
  if (!deps.token) return reply('not_configured', 500);
  if (!safeEqual(req.headers.get('asaas-access-token') ?? '', deps.token)) return reply('invalid_token', 401);

  let body: { event?: unknown; payment?: { id?: unknown } } | null = null;
  try { body = await req.json(); } catch { return reply('ignored'); }
  const event = String(body?.event ?? '');
  const id = typeof body?.payment?.id === 'string' ? body.payment.id : '';
  // O Asaas pausa a fila depois de 15 respostas diferentes de 200: aviso que não interessa é aceito e ignorado.
  if (!id) return reply('ignored');

  try {
    if (PAID_EVENTS.has(event)) {
      // Não confia só no corpo do aviso: confere o pagamento direto no Asaas.
      const pay = await deps.getPayment(id);
      if (asaasPaymentKind(pay) !== 'paid') {
        await deps.log(event, true, `${id}: aviso de pago, mas o Asaas diz ${pay.status}`);
        return reply('not_paid');
      }
      const r = await deps.applyPayment(id, centsFromReais(pay.value));
      if (r.result === 'amount_mismatch') {
        const detail = `${id}: valor pago ${r.paid_cents} centavos, esperado ${r.expected_cents}`;
        await deps.log(event, false, detail);
        await deps.alert(`⚠️ PIX com valor diferente do cobrado — assinatura NÃO liberada.\nCobrança \`${id}\`: pago ${fmt(r.paid_cents)}, esperado ${fmt(r.expected_cents)}. Confira no Asaas.`);
      } else if (r.result !== 'unknown_payment') {
        await deps.log(event, true, `${id}: ${r.result} até ${r.access_until ?? '-'}`);
      }
      return reply(r.result);
    }

    if (event === 'PAYMENT_OVERDUE') {
      // O QR Code do Asaas ainda poderia ser pago por 12 meses: apaga a cobrança vencida.
      const closed = await deps.closePending(id, 'expired');
      if (closed) {
        try { await deps.deletePayment(id); } catch (e) { await deps.log(event, false, `${id}: não apagou no Asaas: ${msg(e)}`); }
      }
      return reply(closed ? 'expired' : 'ignored');
    }

    if (event === 'PAYMENT_DELETED') {
      return reply((await deps.closePending(id, 'canceled')) ? 'canceled' : 'ignored');
    }

    if (REFUND_EVENTS.has(event)) {
      await deps.log(event, true, id);
      await deps.alert(`↩️ Pagamento \`${id}\` estornado ou contestado no Asaas (\`${event}\`). Se for do VS Stage, decida no painel do admin se o acesso continua.`);
      return reply('noted');
    }

    return reply('ignored');
  } catch (e) {
    // erro passageiro (rede, banco): responde 500 para o Asaas tentar de novo
    await deps.log(event || 'unknown', false, `${id}: ${msg(e)}`).catch(() => {});
    return reply('handler_failed', 500);
  }
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const fmt = (cents?: number) => (typeof cents === 'number' ? `R$ ${(cents / 100).toFixed(2).replace('.', ',')}` : '?');
