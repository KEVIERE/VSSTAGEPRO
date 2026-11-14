// Admin com dados da InfinitePay: quem conta como assinante, de onde vem o acesso e a
// saúde dos pagamentos no monitoramento. Contas puras, sem rede.
//
// Rodar com: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { latestPaymentByUser, shortDate, subscriberAccess } from '../supabase/functions/_shared/subscriberInsight.ts';
import { ago, infinitePayHealth } from '../supabase/functions/_shared/infinitepayHealth.ts';

const NOW = new Date('2026-11-13T15:00:00Z'); // 12h em Brasília
const inDays = (n) => new Date(NOW.getTime() + n * 86_400_000).toISOString();

// ─── Assinantes no admin ─────────────────────────────────────────────────────

test('assinante: pagou pela InfinitePay e ainda vale', () => {
  const a = subscriberAccess(
    { subscription: 'trial', plan: 'monthly', pix_paid_until: inDays(10), pix_paid_source: 'infinitepay' },
    { plan: 'monthly', amount_cents: 4950, paid_amount_cents: 4950, capture_method: 'pix', installments: 1, receipt_url: 'https://infinitepay.io/r/1' },
    NOW,
  );
  assert.equal(a.paymentSource, 'infinitepay');
  assert.equal(a.paymentProvider, 'infinitepay');
  assert.equal(a.plan, 'monthly');
  assert.equal(a.priceFormatted, 'R$ 49,50/mês'); // valor pago de fato (com cupom)
  assert.equal(a.currentPeriodEnd, inDays(10));
  assert.equal(a.daysRemaining, 10);
  assert.equal(a.renewalText, `Vence em 10 dias (${shortDate(new Date(inDays(10)))}), não renova sozinho`);
  assert.ok(!a.renewalText.includes('Renova'));
  assert.equal(a.paymentMethod, 'pix');
  assert.equal(a.receiptUrl, 'https://infinitepay.io/r/1');
});

test('assinante: cartão parcelado mostra o método e as parcelas', () => {
  const a = subscriberAccess(
    { plan: 'yearly', pix_paid_until: inDays(300) },
    { plan: 'yearly', amount_cents: 34900, paid_amount_cents: 37000, capture_method: 'credit_card', installments: 6 },
    NOW,
  );
  assert.equal(a.paymentSource, 'infinitepay'); // sem origem gravada, mas com pagamento: InfinitePay
  assert.equal(a.priceFormatted, 'R$ 370,00/ano');
  assert.equal(a.paymentMethod, 'credit_card');
  assert.equal(a.installments, 6);
});

test('assinante: tempo manual do admin não mostra preço nem comprovante', () => {
  const a = subscriberAccess(
    { plan: 'monthly', pix_paid_until: inDays(20), pix_paid_source: 'manual' },
    { capture_method: 'pix', receipt_url: 'https://infinitepay.io/r/velho', amount_cents: 5500 },
    NOW,
  );
  assert.equal(a.paymentSource, 'manual');
  assert.equal(a.priceFormatted, 'Manual');
  assert.equal(a.paymentMethod, null);
  assert.equal(a.receiptUrl, null);
  // sem origem e sem nenhum pagamento: também é manual
  assert.equal(subscriberAccess({ pix_paid_until: inDays(5) }, null, NOW).paymentSource, 'manual');
});

test('assinante: período pago vencido não conta', () => {
  assert.equal(subscriberAccess({ plan: 'monthly', pix_paid_until: inDays(-1) }, { amount_cents: 5500 }, NOW), null);
  assert.equal(subscriberAccess({ subscription: 'trial' }, null, NOW), null);
  assert.equal(subscriberAccess(null, null, NOW), null);
});

test('assinante: conta bloqueada nunca entra', () => {
  assert.equal(subscriberAccess({ blocked: true, pix_paid_until: inDays(10) }, null, NOW), null);
});

test('assinante: parceiro e bônus', () => {
  const p = subscriberAccess({ partner: true, comp_until: inDays(36500) }, null, NOW);
  assert.equal(p.paymentSource, 'partner');
  assert.equal(p.plan, 'partner');
  assert.equal(p.daysRemaining, null);
  const b = subscriberAccess({ comp_until: inDays(3) }, null, NOW);
  assert.equal(b.paymentSource, 'promo');
  assert.equal(b.renewalText, 'Bônus válido por mais 3 dias');
});

test('assinante: assinatura antiga com renovação automática', () => {
  const ativa = subscriberAccess(
    { subscription: 'active', plan: 'monthly', stripe_subscription_id: 'sub_x', current_period_end: inDays(4) }, null, NOW,
  );
  assert.equal(ativa.paymentSource, 'legacy');
  assert.equal(ativa.paymentProvider, 'legacy');
  assert.ok(ativa.renewalText.startsWith('Assinatura antiga: renova em 4 dias'));
  const vencida = subscriberAccess(
    { subscription: 'active', plan: 'monthly', stripe_subscription_id: 'sub_x', current_period_end: inDays(-30) }, null, NOW,
  );
  assert.equal(vencida.daysRemaining, null);
  assert.ok(vencida.renewalText.includes('período venceu'));
  const manual = subscriberAccess({ subscription: 'active', plan: null }, null, NOW);
  assert.equal(manual.paymentSource, 'manual');
  assert.equal(manual.plan, 'manual');
});

test('assinante: nada do Stripe sai para a tela', () => {
  const a = subscriberAccess(
    { subscription: 'active', plan: 'yearly', stripe_subscription_id: 'sub_x', current_period_end: inDays(4) }, null, NOW,
  );
  const texto = JSON.stringify(a);
  assert.ok(!/stripe/i.test(texto));
  assert.ok(!texto.includes('sub_x'));
});

test('último pagamento por conta: fica o primeiro da lista (o mais novo)', () => {
  const m = latestPaymentByUser([
    { user_id: 'a', paid_at: '2026-11-12' }, { user_id: 'b', paid_at: '2026-11-11' }, { user_id: 'a', paid_at: '2026-10-01' },
  ]);
  assert.equal(m.size, 2);
  assert.equal(m.get('a').paid_at, '2026-11-12');
});

// ─── Saúde da InfinitePay no monitoramento ───────────────────────────────────

const envOk = { apiKey: true, handle: true, webhookUrl: true };
const base = { env: envOk, lastPaidAt: null, expiredUnpaid24h: 0, mismatch7d: 0, api: { ok: true, status: 200 }, latencyMs: 120, now: NOW };

test('saúde: tudo certo fica up, com o último pagamento', () => {
  const h = infinitePayHealth({ ...base, lastPaidAt: new Date(NOW.getTime() - 2 * 3600_000).toISOString() });
  assert.equal(h.service, 'infinitepay');
  assert.equal(h.status, 'up');
  assert.ok(h.detail.includes('Link e confirmação de pagamento operando'));
  assert.ok(h.detail.includes('Último pagamento confirmado há 2 h'));
});

test('saúde: segredo faltando fica degraded e diz qual', () => {
  const h = infinitePayHealth({ ...base, env: { apiKey: true, handle: true, webhookUrl: false } });
  assert.equal(h.status, 'degraded');
  assert.ok(h.detail.includes('INFINITEPAY_WEBHOOK_URL'));
  assert.ok(!h.detail.includes('INFINITEPAY_API_KEY'));
});

test('saúde: chave recusada, fora do ar ou sem resposta fica down', () => {
  assert.equal(infinitePayHealth({ ...base, api: { ok: false, status: 401 } }).status, 'down');
  assert.equal(infinitePayHealth({ ...base, api: { ok: false, status: 503 } }).status, 'down');
  assert.equal(infinitePayHealth({ ...base, api: { ok: false, status: null, error: 'timeout' } }).status, 'down');
  assert.equal(infinitePayHealth({ ...base, api: { ok: false, status: 404 } }).status, 'degraded');
});

test('saúde: valor menor que o cobrado vira degraded', () => {
  const h = infinitePayHealth({ ...base, mismatch7d: 1 });
  assert.equal(h.status, 'degraded');
  assert.ok(h.detail.includes('1 pagamento com valor menor'));
});

test('saúde: links vencidos sem pagamento são só informação', () => {
  const h = infinitePayHealth({ ...base, expiredUnpaid24h: 3 });
  assert.equal(h.status, 'up');
  assert.ok(h.detail.includes('3 links vencidos sem pagamento em 24 h'));
});

test('saúde: "há quanto tempo"', () => {
  assert.equal(ago(null, NOW), null);
  assert.equal(ago(new Date(NOW.getTime() - 5 * 60_000).toISOString(), NOW), 'há 5 min');
  assert.equal(ago(new Date(NOW.getTime() - 3 * 86_400_000).toISOString(), NOW), 'há 3 dias');
});
