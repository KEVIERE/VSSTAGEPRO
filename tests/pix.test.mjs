// Assinatura por PIX (Asaas): regras do valor/CPF/vencimento e o aviso automático (webhook).
// O webhook roda aqui com Asaas e banco falsos: confere o token, só libera o que o Asaas diz que
// foi pago, trata valor errado, aviso repetido e PIX vencido. Rodar com: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PIX_LATE_CHECK_MS, PIX_LINK_TTL_MS, PIX_PLANS, asaasBaseUrl, asaasPaymentKind, centsFromReais, discountedCents,
  isValidCpfCnpj, onlyDigits, pixLinkExpiresAt, reusableLink, safeEqual, statusCheckPlan,
} from '../supabase/functions/_shared/pix.ts';
import { handleAsaasWebhook } from '../supabase/functions/_shared/asaasWebhook.ts';
import { asaasClient } from '../supabase/functions/_shared/asaas.ts';
import { formatBRL, formatBrasiliaDate, formatBrasiliaDateTime, formatCountdown, maskCpfCnpj } from '../src/lib/pixFormat.ts';
import { isPixReturnSearch, readPixReturn } from '../src/lib/pixReturn.ts';

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

// ─── Validade de 30 minutos do link de pagamento ─────────────────────────────

const MIN = 60_000;

test('link de pagamento vale 30 minutos', () => {
  assert.equal(PIX_LINK_TTL_MS, 30 * MIN);
  // 10/11 às 14:00 em Brasília (17:00 UTC) → vence 14:30 de Brasília
  const at = pixLinkExpiresAt(new Date('2026-11-10T17:00:00Z'));
  assert.equal(at.toISOString(), '2026-11-10T17:30:00.000Z');
  assert.equal(formatBrasiliaDateTime(at.toISOString()), '10/11, 14:30');
});

test('link de 30 minutos perto da virada do dia, no horário de Brasília', () => {
  // 10/11 às 23:50 em Brasília (11/11 02:50 UTC) → vence 00:20 de 11/11 em Brasília
  const at = pixLinkExpiresAt(new Date('2026-11-11T02:50:00Z'));
  assert.equal(at.toISOString(), '2026-11-11T03:20:00.000Z');
  assert.equal(formatBrasiliaDateTime(at.toISOString()), '11/11, 00:20');
  // 20:40 em Brasília já é outro dia em UTC (23:40 → 00:10 UTC), mas em Brasília continua 10/11
  const b = pixLinkExpiresAt(new Date('2026-11-10T23:40:00Z'));
  assert.equal(b.toISOString(), '2026-11-11T00:10:00.000Z');
  assert.equal(formatBrasiliaDateTime(b.toISOString()), '10/11, 21:10');
  // virada do ano: 31/12 às 23:45 em Brasília → 00:15 de 01/01
  const c = pixLinkExpiresAt(new Date('2027-01-01T02:45:00Z'));
  assert.equal(formatBrasiliaDateTime(c.toISOString()), '01/01, 00:15');
  assert.equal(formatBrasiliaDate(c.toISOString()), '01/01/2027');
});

test('contagem regressiva da tela', () => {
  assert.equal(formatCountdown(30 * MIN), '30:00');
  assert.equal(formatCountdown(29 * MIN + 41_000), '29:41');
  assert.equal(formatCountdown(65_000), '01:05');
  assert.equal(formatCountdown(400), '00:01'); // meio segundo ainda conta como 1 s
  assert.equal(formatCountdown(0), '00:00');
  assert.equal(formatCountdown(-5000), '00:00'); // vencido nunca fica negativo
  assert.equal(formatCountdown(3600_000 + 5 * MIN), '1:05:00');
});

test('reaproveita o link aberto só com pelo menos 10 minutos pela frente', () => {
  const now = Date.parse('2026-11-10T17:00:00Z');
  const link = (minutesLeft, extra = {}) => ({
    plan: 'monthly', amount_cents: 5500, checkout_url: 'https://checkout/x',
    expires_at: new Date(now + minutesLeft * MIN).toISOString(), ...extra,
  });
  assert.ok(reusableLink([link(25)], 'monthly', 5500, now));
  assert.ok(reusableLink([link(11)], 'monthly', 5500, now));
  assert.equal(reusableLink([link(9)], 'monthly', 5500, now), undefined);
  assert.equal(reusableLink([link(-1)], 'monthly', 5500, now), undefined);
  // outro plano, outro valor (cupom) ou sem link: gera outro
  assert.equal(reusableLink([link(25)], 'yearly', 5500, now), undefined);
  assert.equal(reusableLink([link(25)], 'monthly', 4675, now), undefined);
  assert.equal(reusableLink([link(25, { checkout_url: null })], 'monthly', 5500, now), undefined);
  // link do prazo antigo (até o fim do dia seguinte) não é mostrado: todo link vale no máximo 30 min
  assert.equal(reusableLink([link(20 * 60)], 'monthly', 5500, now), undefined);
  // escolhe o que serve entre vários
  const ok = link(20, { id: 'b' });
  assert.equal(reusableLink([link(5, { id: 'a' }), ok], 'monthly', 5500, now), ok);
});

test('reaproveita o link aberto só com o mesmo cupom', () => {
  const now = Date.parse('2026-11-10T17:00:00Z');
  const link = (extra = {}) => ({
    plan: 'monthly', amount_cents: 4950, checkout_url: 'https://checkout/x',
    expires_at: new Date(now + 25 * MIN).toISOString(), ...extra,
  });
  const comA = link({ coupon_code: 'CUPOMA' });
  // mesmo valor (os dois cupons dão 10%), cupom diferente: gera outro
  assert.equal(reusableLink([comA], 'monthly', 4950, now, 'CUPOMB'), undefined);
  assert.equal(reusableLink([comA], 'monthly', 4950, now, null), undefined);
  assert.equal(reusableLink([comA], 'monthly', 4950, now), undefined);
  assert.equal(reusableLink([comA], 'monthly', 4950, now, 'CUPOMA'), comA);
  // sem cupom: null e campo ausente contam como iguais
  const semCupom = link({ coupon_code: null });
  assert.equal(reusableLink([semCupom], 'monthly', 4950, now, null), semCupom);
  const semCampo = link();
  assert.equal(reusableLink([semCampo], 'monthly', 4950, now), semCampo);
  assert.equal(reusableLink([semCampo], 'monthly', 4950, now, null), semCampo);
  assert.equal(reusableLink([semCupom], 'monthly', 4950, now, 'CUPOMA'), undefined);
  // escolhe o do cupom certo entre vários
  const comB = link({ coupon_code: 'CUPOMB', id: 'b' });
  assert.equal(reusableLink([comA, comB], 'monthly', 4950, now, 'CUPOMB'), comB);
});

test('consulta de status: vencido sem pagamento vira vencido', () => {
  const now = Date.parse('2026-11-10T17:00:00Z');
  const row = (status, expiresInMin, checkedAgoS = null) => ({
    status, order_nsu: 'vs-1', expires_at: new Date(now + expiresInMin * MIN).toISOString(),
    checked_at: checkedAgoS === null ? null : new Date(now - checkedAgoS * 1000).toISOString(),
  });
  // aberto: pergunta à InfinitePay no máximo a cada 15 s
  assert.deepEqual(statusCheckPlan(row('pending', 20), now, 15_000), { check: true, expire: false });
  assert.deepEqual(statusCheckPlan(row('pending', 20, 5), now, 15_000), { check: false, expire: false });
  assert.deepEqual(statusCheckPlan(row('pending', 20, 20), now, 15_000), { check: true, expire: false });
  // passou dos 30 min: pergunta uma última vez e, sem pagamento, marca vencido
  assert.deepEqual(statusCheckPlan(row('pending', 0), now, 15_000), { check: true, expire: true });
  assert.deepEqual(statusCheckPlan(row('pending', -1, 2), now, 15_000), { check: true, expire: true });
  // já vencido ou trocado: ainda confere por 2 h (pagamento no último segundo), sem mudar a situação
  assert.deepEqual(statusCheckPlan(row('expired', -10), now, 15_000), { check: true, expire: false });
  assert.deepEqual(statusCheckPlan(row('canceled', -10, 5), now, 15_000), { check: false, expire: false });
  assert.deepEqual(statusCheckPlan(row('expired', -(PIX_LATE_CHECK_MS / MIN) - 1), now, 15_000), { check: false, expire: false });
  // pago ou com valor errado: não pergunta mais
  assert.deepEqual(statusCheckPlan(row('paid', 20), now, 15_000), { check: false, expire: false });
  assert.deepEqual(statusCheckPlan(row('amount_mismatch', 20), now, 15_000), { check: false, expire: false });
  // pedido do Asaas antigo (sem order_nsu): nada a perguntar
  assert.deepEqual(statusCheckPlan({ ...row('pending', 0), order_nsu: null }, now, 15_000), { check: false, expire: false });
});

// ─── Página de volta da InfinitePay ──────────────────────────────────────────

const ID = '0f8b7c1e-2a3d-4e5f-9a8b-7c6d5e4f3a2b';
const TX = 'a1b2c3d4-0000-4000-8000-123456789abc';

test('página de volta: códigos na query, antes do #', () => {
  const r = readPixReturn(
    `?pagamento=${ID}&receipt_url=https%3A%2F%2Frecibo%2F1&order_nsu=vs-abc-1&slug=Xy12&capture_method=pix&transaction_nsu=${TX}`,
    '#assinatura',
  );
  assert.equal(r.id, ID);
  assert.deepEqual(r.codes, { order_nsu: 'vs-abc-1', transaction_nsu: TX, slug: 'Xy12' });
  assert.equal(r.method, 'pix');
});

test('página de volta: códigos depois do #, com ? ou &', () => {
  const a = readPixReturn(`?pagamento=${ID}`, `#assinatura?order_nsu=vs-abc-1&slug=Xy12&transaction_nsu=${TX}`);
  assert.equal(a.id, ID);
  assert.deepEqual(a.codes, { order_nsu: 'vs-abc-1', transaction_nsu: TX, slug: 'Xy12' });
  const b = readPixReturn(`?pagamento=${ID}`, `#assinatura&slug=Xy12&capture_method=credit_card`);
  assert.deepEqual(b.codes, { slug: 'Xy12' });
  assert.equal(b.method, 'credit_card');
  // "?" a mais colado no nosso código
  const c = readPixReturn(`?pagamento=${ID}?order_nsu=vs-abc-1&slug=Xy12`, '#assinatura');
  assert.equal(c.id, ID);
  assert.deepEqual(c.codes, { order_nsu: 'vs-abc-1', slug: 'Xy12' });
});

test('página de volta: link antigo, sem nosso código, e valores estranhos', () => {
  const old = readPixReturn('', '#assinatura');
  assert.equal(old.id, null);
  assert.deepEqual(old.codes, {});
  const bad = readPixReturn('?pagamento=nao-e-uuid&slug=<script>&order_nsu=' + 'x'.repeat(200), '#assinatura');
  assert.equal(bad.id, null);
  assert.deepEqual(bad.codes, {});
  // a rota da página de volta vale mesmo se o #assinatura se perder no caminho
  assert.equal(isPixReturnSearch(`?pagamento=${ID}&slug=Xy12`), true);
  assert.equal(isPixReturnSearch(`?order_nsu=vs-1&pagamento=${ID}`), true);
  assert.equal(isPixReturnSearch('?musico=1'), false);
  assert.equal(isPixReturnSearch(''), false);
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
