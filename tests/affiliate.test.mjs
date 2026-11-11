// Programa de afiliados: guarda do link (?ref=), cálculo da comissão, regra do saque mínimo,
// recusa do cupom e o aviso no Telegram. As regras de banco são conferidas no texto da
// migração (o projeto não tem Postgres nos testes).
//
// Rodar com: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeRefStore, normalizeRefCode, refFromSearch, REF_TTL_MS } from '../src/lib/affiliateRef.ts';
import {
  MIN_PAYOUT_CENTS, affiliateError, affiliateLink, commissionCents, commissionState, last12Months,
  monthLabel, normalizePixKey, payoutBlock,
} from '../src/lib/affiliateRules.ts';
import { brl, couponRefusal, escapeTelegram, payoutAlertText } from '../supabase/functions/_shared/affiliate.ts';

const DAY = 24 * 3600_000;

/** Navegador falso: localStorage e cookie em memória, relógio controlado pelo teste. */
function fakeEnv(start = Date.UTC(2026, 10, 10)) {
  const items = new Map();
  let cookie = '';
  const env = {
    t: start,
    getItem: (k) => (items.has(k) ? items.get(k) : null),
    setItem: (k, v) => items.set(k, v),
    removeItem: (k) => items.delete(k),
    getCookie: () => cookie,
    setCookie: (c) => {
      const [pair] = c.split(';');
      cookie = /Max-Age=0(;|$)/.test(c) ? '' : pair;
    },
    now: () => env.t,
    secure: true,
    items,
    cookieRaw: () => cookie,
    setCookieRaw: (c) => { cookie = c; },
  };
  return env;
}

// ─── Link de indicação ───────────────────────────────────────────────────────

test('código do link: maiúsculas, só letras, números, - e _, de 3 a 32', () => {
  assert.equal(normalizeRefCode(' joao10 '), 'JOAO10');
  assert.equal(normalizeRefCode('ab'), null);
  assert.equal(normalizeRefCode('a'.repeat(33)), null);
  assert.equal(normalizeRefCode('<script>'), null);
  assert.equal(normalizeRefCode(null), null);
  assert.equal(refFromSearch('?ref=joao10&x=1'), 'JOAO10');
  assert.equal(refFromSearch('?pagamento=1'), null);
});

test('guarda o ?ref= por 60 dias no localStorage e no cookie', () => {
  const env = fakeEnv();
  const s = makeRefStore(env);
  assert.equal(s.capture('?ref=joao10'), 'JOAO10');
  assert.equal(s.read(), 'JOAO10');
  assert.match(env.cookieRaw(), /^vs_ref=/);

  env.t += REF_TTL_MS - 1000;
  assert.equal(s.read(), 'JOAO10', 'ainda no prazo');
  env.t += 2000;
  assert.equal(s.read(), null, 'passou de 60 dias');
  assert.equal(env.items.size, 0, 'o vencido é apagado');
});

test('primeiro que chega fica: outro link não troca o código guardado', () => {
  const env = fakeEnv();
  const s = makeRefStore(env);
  s.capture('?ref=PRIMEIRO');
  env.t += 10 * DAY;
  assert.equal(s.capture('?ref=SEGUNDO'), 'PRIMEIRO');
  assert.equal(s.read(), 'PRIMEIRO');
});

test('sem localStorage (modo privado) o cookie segura o código', () => {
  const env = fakeEnv();
  const s = makeRefStore(env);
  s.capture('?ref=COOKIE1');
  env.items.clear();
  assert.equal(s.read(), 'COOKIE1');
});

test('código apagado depois do claim, e lixo no armazenamento é ignorado', () => {
  const env = fakeEnv();
  const s = makeRefStore(env);
  s.capture('?ref=JOAO10');
  s.clear();
  assert.equal(s.read(), null);
  assert.equal(env.cookieRaw(), '');

  env.setItem('vs_ref', '{"code":"<x>","at":1}');
  env.setCookieRaw('vs_ref=nao-e-json');
  assert.equal(s.read(), null);
});

test('link de indicação aponta para o site', () => {
  assert.equal(affiliateLink('JOAO10'), 'https://vsstagepro.com.br/?ref=JOAO10');
  assert.equal(affiliateLink('A_B', 'http://localhost:5173/'), 'http://localhost:5173/?ref=A_B');
});

// ─── Comissão ────────────────────────────────────────────────────────────────

test('comissão: 10% do valor cobrado, arredondado ao centavo', () => {
  assert.equal(commissionCents(5500, 10), 550);
  assert.equal(commissionCents(4950, 10), 495, 'mensal com cupom de 10%');
  assert.equal(commissionCents(31410, 10), 3141, 'anual com cupom de 10%');
  assert.equal(commissionCents(34900, 15), 5235);
  assert.equal(commissionCents(5555, 10), 556, 'meio centavo arredonda para cima');
  assert.equal(commissionCents(5500, 0), 0);
  assert.equal(commissionCents(-100, 10), 0);
});

test('comissão fica a liberar por 7 dias e depois disponível', () => {
  const paidAt = Date.UTC(2026, 10, 1, 12);
  const availableAt = new Date(paidAt + 7 * DAY).toISOString();
  assert.equal(commissionState('pending', availableAt, paidAt + 6 * DAY), 'pending');
  assert.equal(commissionState('pending', availableAt, paidAt + 7 * DAY), 'available');
  // as outras situações não mudam com o tempo
  for (const s of ['reserved', 'paid', 'canceled']) {
    assert.equal(commissionState(s, availableAt, paidAt + 30 * DAY), s);
  }
});

// ─── Saque ───────────────────────────────────────────────────────────────────

test('saque: mínimo de R$ 100,00 e mostra quanto falta', () => {
  assert.equal(MIN_PAYOUT_CENTS, 10000);
  const base = { status: 'active', hasPixKey: true, hasOpenRequest: false };
  assert.deepEqual(payoutBlock({ ...base, availableCents: 9999 }), { block: 'below_minimum', missingCents: 1 });
  assert.deepEqual(payoutBlock({ ...base, availableCents: 7650 }), { block: 'below_minimum', missingCents: 2350 });
  assert.deepEqual(payoutBlock({ ...base, availableCents: 10000 }), { block: null, missingCents: 0 });
  assert.deepEqual(payoutBlock({ ...base, availableCents: 25000 }), { block: null, missingCents: 0 });
});

test('saque: recusa sem chave PIX, com pedido aberto ou afiliado encerrado', () => {
  const ok = { status: 'active', availableCents: 50000, hasPixKey: true, hasOpenRequest: false };
  assert.equal(payoutBlock({ ...ok, hasPixKey: false }).block, 'no_pix_key');
  assert.equal(payoutBlock({ ...ok, hasOpenRequest: true }).block, 'request_open');
  assert.equal(payoutBlock({ ...ok, status: 'ended' }).block, 'ended');
  assert.equal(payoutBlock({ ...ok, status: 'paused' }).block, null, 'pausado ainda saca o que já ganhou');
});

test('chave PIX: limpa e confere como o banco', () => {
  assert.equal(normalizePixKey('cpf', '123.456.789-09'), '12345678909');
  assert.equal(normalizePixKey('cpf', '1234'), null);
  assert.equal(normalizePixKey('cnpj', '12.345.678/0001-95'), '12345678000195');
  assert.equal(normalizePixKey('phone', '(11) 98539-3676'), '11985393676');
  assert.equal(normalizePixKey('email', ' Joao@Gmail.com '), 'joao@gmail.com');
  assert.equal(normalizePixKey('email', 'joao@'), null);
  assert.equal(normalizePixKey('random', '123e4567-e89b-12d3-a456-426614174000'), '123e4567-e89b-12d3-a456-426614174000');
  assert.equal(normalizePixKey('random', 'abc'), null);
});

test('mensagens de erro do afiliado em português', () => {
  assert.match(affiliateError('below_minimum'), /R\$ 100,00/);
  assert.match(affiliateError('ERROR: request_open'), /já tem um saque/);
  assert.match(affiliateError('coisa estranha'), /Tente de novo/);
});

test('gráfico: 12 meses com zero onde não houve ganho', () => {
  const rows = last12Months([{ month: '2026-11', cents: 550 }, { month: '2026-01', cents: 100 }], new Date(2026, 10, 15));
  assert.equal(rows.length, 12);
  assert.deepEqual(rows[11], { month: '2026-11', cents: 550 });
  assert.deepEqual(rows[0], { month: '2025-12', cents: 0 });
  assert.equal(rows[1].cents, 100);
  assert.equal(monthLabel('2026-11'), 'nov/26');
});

// ─── Cupom no pix-checkout ───────────────────────────────────────────────────

test('cupom: primeiro pagamento e o próprio afiliado têm recusa própria', () => {
  assert.equal(couponRefusal({ valid: true, percent: 10, affiliate: true }), null);
  assert.equal(couponRefusal({ valid: false, error: 'coupon_first_payment_only' }), 'coupon_first_payment_only');
  assert.equal(couponRefusal({ valid: false, error: 'coupon_own' }), 'coupon_own');
  assert.equal(couponRefusal({ valid: false, error: 'promo_expired' }), 'invalid_coupon');
  assert.equal(couponRefusal({ valid: true, percent: 0 }), 'invalid_coupon');
  assert.equal(couponRefusal(null), 'invalid_coupon');
});

// ─── Aviso no Telegram ───────────────────────────────────────────────────────

test('aviso de saque: valor, chave e sem quebrar o Markdown', () => {
  assert.equal(brl(123456), 'R$ 1.234,56');
  assert.equal(brl(10000), 'R$ 100,00');
  const text = payoutAlertText({
    amount_cents: 12345, code: 'JOAO_10', email: 'joao_silva@gmail.com',
    payout_name: 'João *Silva*', pix_key_type: 'email', pix_key: 'joao_silva@gmail.com',
  });
  assert.match(text, /R\$ 123,45/);
  assert.match(text, /PIX \(E-mail\)/);
  assert.ok(!text.includes('João *Silva*'), 'asterisco do nome não vira negrito');
  assert.equal(escapeTelegram('a_b*c`d[e]'), 'abcde');
});

// ─── Regras no banco (texto da migração) ─────────────────────────────────────

const sql = readFileSync(new URL('../supabase/migrations/20261110230000_afiliados.sql', import.meta.url), 'utf8');

function fnBody(name) {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION ${name}(`);
  assert.ok(start >= 0, `função ${name} existe`);
  const end = sql.indexOf('END $$;', start);
  return sql.slice(start, end);
}

test('banco: uma comissão por pagamento, nascida no gatilho quando vira pago', () => {
  assert.match(sql, /pix_payment_id uuid NOT NULL UNIQUE/);
  assert.match(sql, /ON CONFLICT \(pix_payment_id\) DO NOTHING/);
  assert.match(sql, /AFTER UPDATE OF status ON pix_payments/);
  assert.match(sql, /WHEN \(NEW\.status = 'paid' AND OLD\.status IS DISTINCT FROM 'paid'\)/);
  // a função que libera o plano não é reescrita
  assert.ok(!/FUNCTION pix_apply_payment_by_order/.test(sql));
  // falha na comissão nunca derruba a liberação do plano
  assert.match(fnBody('_affiliate_on_payment_paid'), /EXCEPTION WHEN OTHERS THEN/);
  // 7 dias de espera e base no valor cobrado
  assert.match(fnBody('_affiliate_on_payment_paid'), /interval '7 days'/);
  assert.match(fnBody('_affiliate_on_payment_paid'), /round\(NEW\.amount_cents \* v_aff\.commission_percent \/ 100\.0\)/);
  assert.match(fnBody('_affiliate_on_payment_paid'), /v_aff\.status <> 'active'/);
});

test('banco: atribuição só para conta nova, sem trocar de afiliado e sem si mesmo', () => {
  const body = fnBody('_affiliate_attach');
  assert.match(body, /v\.user_id = p_user THEN RETURN 'self'/);
  assert.match(body, /already_referred/);
  assert.match(body, /_affiliate_has_paid\(p_user\) THEN RETURN 'already_customer'/);
  assert.match(sql, /user_id uuid PRIMARY KEY REFERENCES auth\.users\(id\) ON DELETE CASCADE,\n  affiliate_id/);
});

test('banco: cupom de afiliado só no primeiro pagamento e nunca do próprio afiliado', () => {
  const body = fnBody('_discount_check');
  assert.match(body, /coupon_own/);
  assert.match(body, /v\.first_payment_only AND p_user IS NOT NULL AND _affiliate_has_paid\(p_user\)/);
  assert.match(fnBody('admin_affiliate_create'), /first_payment_only\)\n  VALUES \(v_code, 'discount'.*true\)/s);
});

test('banco: saque leva todo o disponível, mínimo R$ 100 e um pedido aberto por vez', () => {
  const body = fnBody('affiliate_payout_request');
  assert.match(body, /FOR UPDATE/);
  assert.match(body, /v_total < 10000 THEN RAISE EXCEPTION 'below_minimum'/);
  assert.match(body, /RAISE EXCEPTION 'no_pix_key'/);
  assert.match(body, /RAISE EXCEPTION 'request_open'/);
  assert.match(body, /RAISE EXCEPTION 'affiliate_ended'/);
  assert.match(body, /SET status = 'reserved', payout_id = v_id/);
  assert.match(sql, /amount_cents int NOT NULL CHECK \(amount_cents >= 10000\)/);
  assert.match(sql, /affiliate_payouts \(affiliate_id\) WHERE status = 'requested'/);
  // recusa devolve o saldo; pago vira pago
  assert.match(fnBody('admin_affiliate_payout_reject'), /SET status = 'available', payout_id = NULL/);
  assert.match(fnBody('admin_affiliate_payout_mark_paid'), /SET status = 'paid' WHERE payout_id = p_id AND status = 'reserved'/);
  assert.match(fnBody('admin_affiliate_commission_cancel'), /commission_already_paid/);
});

test('banco: RLS ligado e funções do admin protegidas e registradas', () => {
  for (const t of ['affiliates', 'affiliate_referrals', 'affiliate_commissions', 'affiliate_payouts']) {
    assert.match(sql, new RegExp(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY`), t);
  }
  assert.ok(!/CREATE POLICY/.test(sql), 'sem políticas: tudo passa pelas funções');
  for (const f of [
    'admin_affiliate_create', 'admin_affiliate_update', 'admin_affiliate_payout_mark_paid',
    'admin_affiliate_payout_reject', 'admin_affiliate_commission_cancel',
  ]) {
    const body = fnBody(f);
    assert.match(body, /PERFORM _require_admin\(\)/, f);
    assert.match(body, /PERFORM _audit\(/, f);
  }
  for (const f of ['admin_affiliates', 'admin_affiliate_detail', 'admin_affiliate_payouts_open']) {
    assert.match(fnBody(f), /PERFORM _require_admin\(\)/, f);
  }
  // as do servidor não ficam abertas para a tela
  assert.match(sql, /'discount_check_for_user\(text, uuid\)',\n    'affiliate_attach_by_coupon\(uuid, text\)',\n    'affiliate_payout_alert_claim\(uuid\)'/);
});
