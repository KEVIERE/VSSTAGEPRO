// InfinitePay: criação do link de pagamento e confirmação do webhook.
//
// O ponto crítico deste teste é a segurança: o webhook da InfinitePay não tem
// assinatura, então um aviso sozinho não pode liberar nada. Aqui provamos que
// só o POST /payment_check decide, e que um aviso forjado não passa.
//
// Rodar com: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { infinitePayClient, InfinitePayError } from '../supabase/functions/_shared/infinitepay.ts';
import { handleInfinitePayWebhook } from '../supabase/functions/_shared/infinitepayWebhook.ts';

/** fetch falso: registra a chamada e devolve o que o teste mandar. */
function fakeFetch(respostas) {
  const chamadas = [];
  const fn = async (url, init) => {
    chamadas.push({ url, init, corpo: init?.body ? JSON.parse(init.body) : null });
    const r = respostas.shift();
    if (!r) throw new Error('sem resposta preparada');
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      text: async () => (r.body === undefined ? '' : JSON.stringify(r.body)),
    };
  };
  return { fn, chamadas };
}

test('criar link: manda a chave no header e o valor em centavos', async () => {
  const { fn, chamadas } = fakeFetch([{ status: 200, body: { url: 'https://checkout.infinitepay.com.br/abc' } }]);
  const ip = infinitePayClient('inchk_teste', fn);

  const link = await ip.criarLink({
    items: [{ quantity: 1, price: 5500, description: 'VS Stage Pro — Mensal' }],
    order_nsu: 'vs-pedido-1',
    options: { single_payment: true, payment_methods_enabled: ['credit_card', 'pix'] },
  });

  assert.equal(link.url, 'https://checkout.infinitepay.com.br/abc');
  assert.equal(chamadas.length, 1);
  assert.equal(chamadas[0].url, 'https://api.checkout.infinitepay.io/links');
  assert.equal(chamadas[0].init.method, 'POST');
  // a chave nunca vai no corpo nem na URL
  assert.equal(chamadas[0].init.headers['X-Api-Key'], 'inchk_teste');
  assert.ok(!JSON.stringify(chamadas[0].corpo).includes('inchk_teste'));
  // preço em centavos, inteiro
  assert.equal(chamadas[0].corpo.items[0].price, 5500);
  assert.equal(Number.isInteger(chamadas[0].corpo.items[0].price), true);
});

test('criar link: sem chave usa a handle, sem header', async () => {
  const { fn, chamadas } = fakeFetch([{ status: 200, body: { url: 'https://x/y' } }]);
  const ip = infinitePayClient('', fn);
  await ip.criarLink({ handle: 'minhaloja', items: [{ quantity: 1, price: 100, description: 't' }] });
  assert.equal(chamadas[0].init.headers['X-Api-Key'], undefined);
  assert.equal(chamadas[0].corpo.handle, 'minhaloja');
});

test('erro da API vira InfinitePayError com o status', async () => {
  const { fn } = fakeFetch([{ status: 403, body: { error: 'forbidden' } }]);
  const ip = infinitePayClient('inchk_teste', fn);
  await assert.rejects(
    () => ip.criarLink({ items: [{ quantity: 1, price: 100, description: 't' }] }),
    (e) => e instanceof InfinitePayError && e.status === 403,
  );
});

test('conferir pagamento: pede handle, order_nsu, transação e slug', async () => {
  const { fn, chamadas } = fakeFetch([{ status: 200, body: { success: true, paid: true, amount: 5500, paid_amount: 5500 } }]);
  const ip = infinitePayClient('inchk_teste', fn);

  const r = await ip.conferirPagamento({
    handle: 'minhaloja', order_nsu: 'vs-1', transaction_nsu: 'tx-1', slug: 'abc',
  });

  assert.equal(r.paid, true);
  assert.equal(chamadas[0].url, 'https://api.checkout.infinitepay.io/payment_check');
  assert.deepEqual(chamadas[0].corpo, {
    handle: 'minhaloja', order_nsu: 'vs-1', transaction_nsu: 'tx-1', slug: 'abc',
  });
});

test('conferir pagamento: não pago devolve paid=false', async () => {
  const { fn } = fakeFetch([{ status: 200, body: { success: true, paid: false } }]);
  const ip = infinitePayClient('inchk_teste', fn);
  const r = await ip.conferirPagamento({ order_nsu: 'vs-1' });
  assert.equal(r.paid, false);
});

// ─── Webhook com InfinitePay e banco falsos (o handler de verdade) ───────────
/*
 * A regra de ouro: um aviso de webhook, sozinho, NÃO libera pagamento.
 * Ele só é aceito se a InfinitePay confirmar em /payment_check.
 */

function fakeWorld() {
  const db = new Map(); // order_nsu → { status, amount, grants, tx, slug }
  const pagos = new Map(); // order_nsu → resposta do /payment_check
  const checks = [];
  const deps = {
    handle: 'minhaloja',
    findOrder: async (orderNsu) => {
      const row = db.get(orderNsu);
      return row ? { status: row.status } : null;
    },
    saveIds: async (orderNsu, tx, slug) => {
      const row = db.get(orderNsu);
      if (row) { row.tx = tx ?? row.tx; row.slug = slug ?? row.slug; }
    },
    checkPayment: async (input) => {
      checks.push(input);
      const r = pagos.get(input.order_nsu);
      if (r instanceof Error) throw r;
      return r ?? { success: true, paid: false };
    },
    applyPayment: async (orderNsu, cents) => {
      const row = db.get(orderNsu);
      if (!row) return { result: 'unknown_payment' };
      if (row.status === 'paid') return { result: 'already_paid' };
      if (cents < row.amount) { row.status = 'amount_mismatch'; return { result: 'amount_mismatch', expected_cents: row.amount, paid_cents: cents }; }
      row.status = 'paid'; row.grants += 1; row.paid = cents;
      return { result: 'activated', access_until: '2026-12-10T17:00:00Z' };
    },
    log: () => {},
    error: () => {},
  };
  return { db, pagos, checks, deps };
}

const hook = (deps, body) =>
  handleInfinitePayWebhook(new Request('https://x/functions/v1/infinitepay-webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }), deps);

const aviso = { order_nsu: 'vs-1', transaction_nsu: 'tx-1', invoice_slug: 'abc', amount: 5500, paid_amount: 5500, capture_method: 'pix' };

test('webhook: aviso falso (a InfinitePay não confirma) não libera', async () => {
  const w = fakeWorld();
  w.db.set('vs-1', { status: 'pending', amount: 5500, grants: 0 });
  // o aviso JURA que foi pago, mas a InfinitePay diz que não
  const res = await hook(w.deps, aviso);
  assert.equal(res.status, 400); // 400: se for cedo demais, a InfinitePay tenta de novo
  assert.deepEqual(await res.json(), { error: 'not_paid' });
  assert.equal(w.db.get('vs-1').grants, 0);
  assert.equal(w.db.get('vs-1').status, 'pending');
  // a confirmação foi pedida à InfinitePay, com os códigos do aviso
  assert.deepEqual(w.checks, [{ handle: 'minhaloja', order_nsu: 'vs-1', transaction_nsu: 'tx-1', slug: 'abc' }]);
});

test('webhook: aviso verdadeiro libera uma vez só, mesmo repetido', async () => {
  const w = fakeWorld();
  w.db.set('vs-1', { status: 'pending', amount: 5500, grants: 0 });
  w.pagos.set('vs-1', { success: true, paid: true, amount: 5500, paid_amount: 5500 });
  let res = await hook(w.deps, aviso);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { result: 'activated' });
  assert.equal(w.db.get('vs-1').grants, 1);
  // os códigos da InfinitePay ficam guardados para a tela conferir depois
  assert.equal(w.db.get('vs-1').tx, 'tx-1');
  assert.equal(w.db.get('vs-1').slug, 'abc');
  res = await hook(w.deps, aviso);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { result: 'already_paid' });
  assert.equal(w.db.get('vs-1').grants, 1);
});

test('webhook: vale o valor que a InfinitePay confirma, não o do aviso', async () => {
  const w = fakeWorld();
  w.db.set('vs-1', { status: 'pending', amount: 5500, grants: 0 });
  // parcelado com taxas: pagou mais que o combinado
  w.pagos.set('vs-1', { success: true, paid: true, amount: 5500, paid_amount: 5700 });
  const res = await hook(w.deps, { ...aviso, paid_amount: 1 });
  assert.deepEqual(await res.json(), { result: 'activated' });
  assert.equal(w.db.get('vs-1').paid, 5700);
});

test('webhook: valor menor que o cobrado não libera', async () => {
  const w = fakeWorld();
  w.db.set('vs-1', { status: 'pending', amount: 5500, grants: 0 });
  w.pagos.set('vs-1', { success: true, paid: true, amount: 100, paid_amount: 100 });
  const res = await hook(w.deps, { ...aviso, paid_amount: 5500 });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { result: 'amount_mismatch' });
  assert.equal(w.db.get('vs-1').grants, 0);
});

test('webhook: pedido que não é nosso ou sem order_nsu é recusado sem consultar', async () => {
  const w = fakeWorld();
  w.pagos.set('vs-inventado', { success: true, paid: true, amount: 5500 });
  let res = await hook(w.deps, { ...aviso, order_nsu: 'vs-inventado' });
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: 'unknown_order' });
  res = await hook(w.deps, { paid_amount: 5500 });
  assert.deepEqual(await res.json(), { error: 'missing_order_nsu' });
  res = await hook(w.deps, 'isto não é json');
  assert.deepEqual(await res.json(), { error: 'invalid_body' });
  assert.equal(w.checks.length, 0);
});

test('webhook: pago depois do prazo de 30 minutos ainda libera', async () => {
  const w = fakeWorld();
  // a tela já marcou como vencido, mas o dinheiro entrou no último segundo
  w.db.set('vs-1', { status: 'expired', amount: 5500, grants: 0 });
  w.pagos.set('vs-1', { success: true, paid: true, amount: 5500, paid_amount: 5500 });
  const res = await hook(w.deps, aviso);
  assert.deepEqual(await res.json(), { result: 'activated' });
  assert.equal(w.db.get('vs-1').grants, 1);
});

test('webhook: InfinitePay fora do ar responde 400 para ela tentar de novo', async () => {
  const w = fakeWorld();
  w.db.set('vs-1', { status: 'pending', amount: 5500, grants: 0 });
  w.pagos.set('vs-1', new Error('rede'));
  const res = await hook(w.deps, aviso);
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: 'confirm_failed' });
  assert.equal(w.db.get('vs-1').grants, 0);
});
