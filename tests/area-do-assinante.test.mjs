// Área do Assinante (vsstagepro.com.br/area-do-assinante): só assinante em dia usa os bônus.
// As regras de banco e da função são conferidas no texto (o projeto não tem Postgres nos testes).
//
// Rodar com: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  BONUSES, accessOf, bonusDownloadError, canUseBonus, lockedNotice, untilLabel,
} from '../src/lib/bonus.ts';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('só o assinante em dia usa os bônus', () => {
  assert.equal(canUseBonus('subscriber'), true);
  for (const a of ['anonymous', 'none', 'trial', 'expired', 'blocked']) assert.equal(canUseBonus(a), false, a);
});

test('resposta estranha do servidor nunca libera', () => {
  assert.equal(accessOf({ status: 'subscriber' }), 'subscriber');
  assert.equal(accessOf({ status: 'expired' }), 'expired');
  for (const raw of [null, undefined, {}, { status: 'active' }, { status: 1 }, 'subscriber']) {
    assert.equal(canUseBonus(accessOf(raw)), false, JSON.stringify(raw));
  }
});

test('quem não pode usar vê o motivo e o que fazer', () => {
  assert.equal(lockedNotice('subscriber'), null);
  assert.equal(lockedNotice('expired').cta, 'Renovar assinatura');
  assert.equal(lockedNotice('trial').cta, 'Assinar agora');
  assert.equal(lockedNotice('blocked').cta, 'Falar com o suporte');
  assert.equal(lockedNotice('none').cta, 'Assinar agora');
});

test('ids dos bônus valem como pasta do bucket e não se repetem', () => {
  const ids = BONUSES.map((b) => b.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.match(id, /^[a-z0-9-]{1,60}$/);
  for (const b of BONUSES) assert.ok(['download', 'soon'].includes(b.kind), b.id);
});

test('mensagens de erro e data', () => {
  assert.match(bonusDownloadError('not_subscriber'), /assinantes/);
  assert.match(bonusDownloadError('qualquer'), /Tente de novo/);
  assert.equal(untilLabel('2026-12-25T15:00:00Z'), '25/12/2026');
  assert.equal(untilLabel('xx'), null);
  assert.equal(untilLabel(null), null);
});

test('bonus_access só lê a conta: não começa o teste grátis', () => {
  const sql = read('supabase/migrations/20261125120000_area_do_assinante.sql');
  const body = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION bonus_access'), sql.indexOf('END $$;'));
  assert.doesNotMatch(body, /_ensure_license|license_status\(|INSERT|UPDATE/i);
  assert.match(sql, /REVOKE EXECUTE ON FUNCTION bonus_access\(\) FROM anon/);
  assert.match(sql, /VALUES \('bonus', 'bonus', false\)/);
});

test('a função só assina o link depois de conferir a assinatura', () => {
  const fn = read('supabase/functions/bonus-download/index.ts');
  const check = fn.indexOf('status !== "subscriber"');
  assert.ok(check > 0);
  assert.ok(fn.indexOf('createSignedUrl') > check);
  assert.match(read('supabase/config.toml'), /\[functions\.bonus-download\]\nverify_jwt = true/);
});

test('o site abre a área em /area-do-assinante, no computador e no celular', () => {
  const app = read('src/App.tsx');
  const route = app.indexOf("seg === 'area-do-assinante'");
  assert.ok(route > 0);
  // antes do desvio do celular, que manda o resto para a página de vendas
  assert.ok(route < app.indexOf('if (isMobileDevice && !window.vsDesktop)'));
  assert.match(read('src/components/sales/SalesPage.tsx'), /Área do Assinante/);
});
