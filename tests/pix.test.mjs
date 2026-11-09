// Assinatura por PIX (Asaas): regras do valor/CPF/vencimento e o aviso automático (webhook).
// O webhook roda aqui com Asaas e banco falsos: confere o token, só libera o que o Asaas diz que
// foi pago, trata valor errado, aviso repetido e PIX vencido. Rodar com: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PIX_PLANS, asaasBaseUrl, asaasPaymentKind, centsFromReais, discountedCents, isValidCpfCnpj, onlyDigits, pixDueDate,
  safeEqual,
} from '../supabase/functions/_shared/pix.ts';
import { handleAsaasWebhook } from '../supabase/functions/_shared/asaasWebhook.ts';
import { asaasClient } from '../supabase/functions/_shared/asaas.ts';
import { formatBRL, maskCpfCnpj } from '../src/lib/pixFormat.ts';

test('preços do PIX iguais aos do cartão', () => {
  assert.equal(PIX_PLANS.monthly.cents, 5500);
  assert.equal(PIX_PLANS.yearly.cents, 34900);
});

test('CPF e CNPJ: dígitos verificadores', () => {
  assert.equal(isValidCpfCnpj('529.982.247-25'), true);
  assert.equal(isValidCpfCnpj('52998224725'), true);
  assert.equal(isValidCpfCnpj('529.982.247-24'), false);
  assert.equal(isValidCpfCnpj('111.111.111-11'), false);
  assert.equal(isValidCpfCnpj('11.222.333/0001-81'), true);
  assert.equal(isValidCpfCnpj('11.222.333/0001-80'), false);
  assert.equal(isValidCpfCnpj('1234'), false);
  assert.equal(isValidCpfCnpj(undefined), false);
  assert.equal(onlyDigits(' 529.982.247-25 '), '52998224725');
});

test('cupom de desconto no valor do PIX', () => {
  assert.equal(discountedCents(34900, 0), 34900);
  assert.equal(discountedCents(34900, 10), 31410);
  assert.equal(discountedCents(5500, 15), 4675);
  assert.equal(discountedCents(5500, 100), 0);
  assert.equal(discountedCents(5500, null), 5500);
});

test('valor do Asaas em reais vira centavos sem erro de arredondamento', () => {
  assert.equal(centsFromReais(55), 5500);
  assert.equal(centsFromReais(349), 34900);
  assert.equal(centsFromReais(46.75), 4675);
  assert.equal(centsFromReais(0.1 + 0.2), 30);
  assert.equal(centsFromReais('abc'), -1);
});

test('PIX vence no fim do dia seguinte, horário de Brasília', () => {
  // 03/11 às 23:30 em Brasília (04/11 02:30 UTC) → vence 04/11 23:59:59 de Brasília
  const a = pixDueDate(new Date('2026-11-04T02:30:00Z'));
  assert.equal(a.dueDate, '2026-11-04');
  assert.equal(a.expiresAt.toISOString(), '2026-11-05T02:59:59.000Z');
  // 04/11 às 10:00 em Brasília → vence 05/11
  const b = pixDueDate(new Date('2026-11-04T13:00:00Z'));
  assert.equal(b.dueDate, '2026-11-05');
  // virada de mês e de ano
  assert.equal(pixDueDate(new Date('2026-12-31T15:00:00Z')).dueDate, '2027-01-01');
});

test('situação da cobrança no Asaas', () => {
  assert.equal(asaasPaymentKind({ status: 'RECEIVED' }), 'paid');
  assert.equal(asaasPaymentKind({ status: 'CONFIRMED' }), 'paid');
  assert.equal(asaasPaymentKind({ status: 'RECEIVED_IN_CASH' }), 'paid');
  assert.equal(asaasPaymentKind({ status: 'PENDING' }), 'pending');
  assert.equal(asaasPaymentKind({ status: 'OVERDUE' }), 'overdue');
  assert.equal(asaasPaymentKind({ status: 'REFUNDED' }), 'refunded');
  assert.equal(asaasPaymentKind({ status: 'PENDING', deleted: true }), 'deleted');
  assert.equal(asaasPaymentKind({ status: 'QUALQUER_COISA_NOVA' }), 'other');
});

test('ambiente do Asaas pela chave', () => {
  assert.equal(asaasBaseUrl('$aact_prod_abc'), 'https://api.asaas.com/v3');
  assert.equal(asaasBaseUrl('$aact_hmlg_abc', 'production'), 'https://api-sandbox.asaas.com/v3');
  assert.equal(asaasBaseUrl('$aact_YTU5antiga'), 'https://api-sandbox.asaas.com/v3');
  assert.equal(asaasBaseUrl('$aact_YTU5antiga', 'production'), 'https://api.asaas.com/v3');
});

test('comparação do token', () => {
  assert.equal(safeEqual('abc', 'abc'), true);
  assert.equal(safeEqual('abc', 'abd'), false);
  assert.equal(safeEqual('abc', 'abcd'), false);
  assert.equal(safeEqual('', 'x'), false);
});

test('cliente do Asaas manda a chave, o User-Agent e lê o erro', async () => {
  const calls = [];
  const fakeFetch = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/payments/pay_bad')) {
      return new Response(JSON.stringify({ errors: [{ code: 'invalid_action', description: 'Não pode' }] }), { status: 400 });
    }
    return new Response(JSON.stringify({ id: 'pay_1', status: 'PENDING', value: 55 }), { status: 200 });
  };
  const c = asaasClient('$aact_hmlg_k', null, fakeFetch);
  const p = await c.createPixPayment({ customer: 'cus_1', value: 55, dueDate: '2026-11-05', description: 'x', externalReference: 'r' });
  assert.equal(p.id, 'pay_1');
  assert.equal(calls[0].url, 'https://api-sandbox.asaas.com/v3/payments');
  assert.equal(calls[0].init.headers.access_token, '$aact_hmlg_k');
  assert.ok(calls[0].init.headers['User-Agent']);
  assert.equal(JSON.parse(calls[0].init.body).billingType, 'PIX');
  await assert.rejects(() => c.getPayment('pay_bad'), (e) => e.code === 'invalid_action' && e.status === 400);
});

// ─── Webhook com Asaas e banco falsos ─────────────────────────────────────────

const TOKEN = 'token-de-teste-com-mais-de-32-caracteres-123';

function fakeWorld() {
  const asaas = new Map(); // id → pagamento no Asaas
  const db = new Map(); // id → { status, amount, grants }
  const logs = [];
  const alerts = [];
  const deleted = [];
  const deps = {
    token: TOKEN,
    getPayment: async (id) => {
      if (!asaas.has(id)) throw new Error('not found');
      return asaas.get(id);
    },
    applyPayment: async (id, cents) => {
      const row = db.get(id);
      if (!row) return { result: 'unknown_payment' };
      if (row.status === 'paid') return { result: 'already_paid' };
      if (row.status === 'amount_mismatch') return { result: 'amount_mismatch', expected_cents: row.amount, paid_cents: row.paid };
      if (cents !== row.amount) { row.status = 'amount_mismatch'; row.paid = cents; return { result: 'amount_mismatch', expected_cents: row.amount, paid_cents: cents }; }
      row.status = 'paid'; row.grants += 1;
      return { result: 'activated', access_until: '2026-12-04T00:00:00Z' };
    },
    closePending: async (id, status) => {
      const row = db.get(id);
      if (!row || row.status !== 'pending') return false;
      row.status = status;
      return true;
    },
    deletePayment: async (id) => { deleted.push(id); },
    log: async (type, ok, detail) => { logs.push({ type, ok, detail }); },
    alert: async (text) => { alerts.push(text); },
  };
  return { asaas, db, logs, alerts, deleted, deps };
}

const hook = (deps, body, token = TOKEN) =>
  handleAsaasWebhook(new Request('https://x/functions/v1/asaas-webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token === null ? {} : { 'asaas-access-token': token }) },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }), deps);

const result = async (res) => (await res.json()).result;

test('webhook: recusa aviso sem token ou com token errado', async () => {
  const w = fakeWorld();
  w.asaas.set('pay_1', { id: 'pay_1', status: 'RECEIVED', value: 55 });
  w.db.set('pay_1', { status: 'pending', amount: 5500, grants: 0 });
  const ev = { event: 'PAYMENT_RECEIVED', payment: { id: 'pay_1' } };
  assert.equal((await hook(w.deps, ev, null)).status, 401);
  assert.equal((await hook(w.deps, ev, 'errado')).status, 401);
  assert.equal(w.db.get('pay_1').grants, 0);
  assert.equal((await hook({ ...w.deps, token: '' }, ev)).status, 500);
  assert.equal(w.db.get('pay_1').grants, 0);
});

test('webhook: PIX pago libera uma vez só, mesmo com aviso repetido', async () => {
  const w = fakeWorld();
  w.asaas.set('pay_1', { id: 'pay_1', status: 'RECEIVED', value: 55 });
  w.db.set('pay_1', { status: 'pending', amount: 5500, grants: 0 });
  const ev = { id: 'evt_1', event: 'PAYMENT_RECEIVED', payment: { id: 'pay_1', status: 'RECEIVED', value: 55 } };
  let res = await hook(w.deps, ev);
  assert.equal(res.status, 200);
  assert.equal(await result(res), 'activated');
  res = await hook(w.deps, ev);
  assert.equal(await result(res), 'already_paid');
  res = await hook(w.deps, { ...ev, event: 'PAYMENT_CONFIRMED' });
  assert.equal(await result(res), 'already_paid');
  assert.equal(w.db.get('pay_1').grants, 1);
});

test('webhook: aviso falso de pago não libera (confere no Asaas)', async () => {
  const w = fakeWorld();
  w.asaas.set('pay_1', { id: 'pay_1', status: 'PENDING', value: 55 });
  w.db.set('pay_1', { status: 'pending', amount: 5500, grants: 0 });
  const res = await hook(w.deps, { event: 'PAYMENT_RECEIVED', payment: { id: 'pay_1', status: 'RECEIVED', value: 55 } });
  assert.equal(res.status, 200);
  assert.equal(await result(res), 'not_paid');
  assert.equal(w.db.get('pay_1').grants, 0);
});

test('webhook: valor diferente não libera e avisa no Telegram', async () => {
  const w = fakeWorld();
  w.asaas.set('pay_1', { id: 'pay_1', status: 'RECEIVED', value: 1 });
  w.db.set('pay_1', { status: 'pending', amount: 5500, grants: 0 });
  const res = await hook(w.deps, { event: 'PAYMENT_RECEIVED', payment: { id: 'pay_1' } });
  assert.equal(res.status, 200);
  assert.equal(await result(res), 'amount_mismatch');
  assert.equal(w.db.get('pay_1').grants, 0);
  assert.equal(w.alerts.length, 1);
  assert.match(w.alerts[0], /R\$ 1,00.*R\$ 55,00/);
  assert.ok(w.logs.some((l) => !l.ok));
});

test('webhook: PIX vencido é fechado e apagado no Asaas', async () => {
  const w = fakeWorld();
  w.db.set('pay_1', { status: 'pending', amount: 5500, grants: 0 });
  w.db.set('pay_2', { status: 'paid', amount: 5500, grants: 1 });
  assert.equal(await result(await hook(w.deps, { event: 'PAYMENT_OVERDUE', payment: { id: 'pay_1' } })), 'expired');
  assert.equal(w.db.get('pay_1').status, 'expired');
  assert.deepEqual(w.deleted, ['pay_1']);
  // já pago: aviso de vencido atrasado não mexe em nada
  assert.equal(await result(await hook(w.deps, { event: 'PAYMENT_OVERDUE', payment: { id: 'pay_2' } })), 'ignored');
  assert.equal(w.db.get('pay_2').status, 'paid');
  assert.deepEqual(w.deleted, ['pay_1']);
});

test('webhook: cobrança removida, estorno, evento desconhecido e corpo inválido respondem 200', async () => {
  const w = fakeWorld();
  w.db.set('pay_1', { status: 'pending', amount: 5500, grants: 0 });
  assert.equal(await result(await hook(w.deps, { event: 'PAYMENT_DELETED', payment: { id: 'pay_1' } })), 'canceled');
  assert.equal(w.db.get('pay_1').status, 'canceled');
  assert.equal(await result(await hook(w.deps, { event: 'PAYMENT_REFUNDED', payment: { id: 'pay_9' } })), 'noted');
  assert.equal(w.alerts.length, 1);
  assert.equal(await result(await hook(w.deps, { event: 'PAYMENT_CREATED', payment: { id: 'pay_1' } })), 'ignored');
  assert.equal(await result(await hook(w.deps, { event: 'PAYMENT_RECEIVED' })), 'ignored');
  assert.equal((await hook(w.deps, 'isto não é json')).status, 200);
});

test('webhook: pagamento de outra coisa da conta Asaas é ignorado', async () => {
  const w = fakeWorld();
  w.asaas.set('pay_outro', { id: 'pay_outro', status: 'RECEIVED', value: 10 });
  const res = await hook(w.deps, { event: 'PAYMENT_RECEIVED', payment: { id: 'pay_outro' } });
  assert.equal(res.status, 200);
  assert.equal(await result(res), 'unknown_payment');
});

test('webhook: erro passageiro responde 500 para o Asaas tentar de novo', async () => {
  const w = fakeWorld();
  w.db.set('pay_1', { status: 'pending', amount: 5500, grants: 0 });
  const res = await hook(w.deps, { event: 'PAYMENT_RECEIVED', payment: { id: 'pay_1' } }); // Asaas não acha
  assert.equal(res.status, 500);
  assert.equal(w.db.get('pay_1').grants, 0);
});

test('tela: máscara de CPF/CNPJ e valor em reais', () => {
  assert.equal(maskCpfCnpj('52998224725'), '529.982.247-25');
  assert.equal(maskCpfCnpj('5299'), '529.9');
  assert.equal(maskCpfCnpj('11222333000181'), '11.222.333/0001-81');
  assert.equal(maskCpfCnpj('112223330001819999'), '11.222.333/0001-81');
  assert.equal(formatBRL(34900).replace(/\s/g, ' '), 'R$ 349,00');
  assert.equal(formatBRL(4675).replace(/\s/g, ' '), 'R$ 46,75');
});
