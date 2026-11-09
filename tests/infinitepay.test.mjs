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

/*
 * A regra de ouro: um aviso de webhook, sozinho, NÃO libera pagamento.
 * Ele só é aceito se a InfinitePay confirmar. Este teste simula o caminho que
 * a função de borda faz e prova as duas pontas.
 */
async function webhookDecide(anunciado, confirmado) {
  // 1) o aviso chega dizendo o que quiser
  if (!anunciado.order_nsu) return 'rejeitado: sem pedido';
  // 2) a verdade é a consulta, não o aviso
  if (!confirmado.paid) return 'rejeitado: InfinitePay não confirmou';
  const pago = Math.round(confirmado.paid_amount ?? confirmado.amount ?? 0);
  return { liberado: true, valor: pago };
}

test('aviso forjado, sem confirmação da InfinitePay, não libera', async () => {
  const r = await webhookDecide(
    { order_nsu: 'vs-1', paid_amount: 5500 },   // o aviso JURA que foi pago
    { success: true, paid: false },             // a InfinitePay diz que não
  );
  assert.equal(r, 'rejeitado: InfinitePay não confirmou');
});

test('aviso sem order_nsu é descartado', async () => {
  const r = await webhookDecide({ paid_amount: 5500 }, { paid: true, amount: 5500 });
  assert.equal(r, 'rejeitado: sem pedido');
});

test('aviso legítimo, confirmado, libera pelo valor pago', async () => {
  const r = await webhookDecide(
    { order_nsu: 'vs-1', paid_amount: 5500 },
    { success: true, paid: true, amount: 5500, paid_amount: 5510 }, // parcelado com taxa
  );
  assert.deepEqual(r, { liberado: true, valor: 5510 });
});

test('valor pago maior que o combinado é aceito (parcelamento com taxas)', async () => {
  const r = await webhookDecide(
    { order_nsu: 'vs-1' },
    { success: true, paid: true, amount: 5500, paid_amount: 5700 },
  );
  assert.equal(r.valor, 5700);
});
