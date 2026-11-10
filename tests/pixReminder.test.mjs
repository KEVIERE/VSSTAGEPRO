// Aviso por e-mail 3, 2 e 1 dia antes do PIX vencer: quem recebe, quando, e o texto.
// Rodar com: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RENEW_URL, daysUntil, dueReminders, formatDueDate, isSendingHour, reminderEmail, reminderKey,
} from '../supabase/functions/_shared/pixReminder.ts';

// 10/11/2026 10:00 em Brasília (UTC-3)
const NOW = new Date('2026-11-10T13:00:00Z');
const at = (iso) => new Date(iso).toISOString();
const row = (over = {}) => ({
  user_id: 'u1', email: 'cliente@exemplo.com', name: 'Ana Souza', plan: 'monthly',
  pix_paid_until: at('2026-11-13T15:00:00Z'), subscription: 'trial', partner: false, blocked: false,
  ...over,
});

test('dias contados pelo calendário de Brasília', () => {
  assert.equal(daysUntil(new Date('2026-11-13T15:00:00Z'), NOW), 3);
  assert.equal(daysUntil(new Date('2026-11-11T02:00:00Z'), NOW), 0); // 23h do dia 10 em Brasília
  assert.equal(daysUntil(new Date('2026-11-11T03:30:00Z'), NOW), 1); // 0h30 do dia 11 em Brasília
});

test('avisa com 3, 2 e 1 dia de antecedência', () => {
  const days = (iso) => dueReminders([row({ pix_paid_until: at(iso) })], NOW).map((d) => d.days);
  assert.deepEqual(days('2026-11-13T15:00:00Z'), [3]);
  assert.deepEqual(days('2026-11-12T15:00:00Z'), [2]);
  assert.deepEqual(days('2026-11-11T15:00:00Z'), [1]);
  assert.deepEqual(days('2026-11-14T15:00:00Z'), []); // 4 dias: ainda não
  assert.deepEqual(days('2026-11-10T22:00:00Z'), []); // vence hoje: fora da regra
  assert.deepEqual(days('2026-11-09T15:00:00Z'), []); // já venceu
});

test('assinatura recorrente não recebe', () => {
  assert.deepEqual(dueReminders([row({ subscription: 'active' })], NOW), []);
});

test('parceiro, conta bloqueada e sem e-mail não recebem', () => {
  assert.deepEqual(dueReminders([row({ partner: true })], NOW), []);
  assert.deepEqual(dueReminders([row({ blocked: true })], NOW), []);
  assert.deepEqual(dueReminders([row({ email: null })], NOW), []);
  assert.deepEqual(dueReminders([row({ pix_paid_until: null })], NOW), []);
});

test('PIX de quem cancelou o cartão ou nunca teve cartão recebe', () => {
  assert.equal(dueReminders([row({ subscription: 'canceled' })], NOW).length, 1);
  assert.equal(dueReminders([row({ subscription: 'trial' })], NOW).length, 1);
});

test('só envia das 9h às 20h de Brasília', () => {
  assert.equal(isSendingHour(new Date('2026-11-10T12:00:00Z')), true); // 9h
  assert.equal(isSendingHour(new Date('2026-11-10T23:59:00Z')), true); // 20h59
  assert.equal(isSendingHour(new Date('2026-11-11T00:00:00Z')), false); // 21h
  assert.equal(isSendingHour(new Date('2026-11-10T11:59:00Z')), false); // 8h59
});

test('e-mail: assunto, data em Brasília e link de renovar', () => {
  const [d1] = dueReminders([row({ pix_paid_until: at('2026-11-11T15:00:00Z') })], NOW);
  const m1 = reminderEmail(d1);
  assert.equal(m1.subject, 'Sua assinatura do VS Stage Pro vence amanhã');
  assert.equal(formatDueDate(d1.paidUntil), '11/11/2026 às 12:00');
  assert.ok(m1.html.includes('11/11/2026 às 12:00'));
  assert.ok(m1.html.includes(RENEW_URL));
  assert.ok(m1.text.includes(RENEW_URL));
  assert.ok(m1.html.includes('Olá, Ana.'));
  const [d3] = dueReminders([row()], NOW);
  assert.equal(reminderEmail(d3).subject, 'Sua assinatura do VS Stage Pro vence em 3 dias');
});

test('nome com HTML não quebra o e-mail', () => {
  const [d] = dueReminders([row({ name: '<b>Zé</b>' })], NOW);
  const m = reminderEmail(d);
  assert.ok(!m.html.includes('<b>Zé'));
  assert.ok(m.html.includes('&lt;b&gt;Zé'));
});

test('cada aviso tem chave própria (mesmo vencimento, dias diferentes)', () => {
  const a = dueReminders([row({ pix_paid_until: at('2026-11-13T15:00:00Z') })], NOW)[0];
  const b = { ...a, days: 2 };
  assert.notEqual(reminderKey(a), reminderKey(b));
});
