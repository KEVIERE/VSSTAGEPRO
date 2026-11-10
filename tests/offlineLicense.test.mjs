// Programa sem internet: o que vale pela última conferência da conta guardada no Mac.
// Rodar com: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CLOCK_BACK_TOLERANCE_MS, NEED_INTERNET_TEXT, OFFLINE_MAX_MS, PAID_GRACE_MS, decideOffline,
} from '../src/lib/offlineLicense.ts';

const H = 3600 * 1000;
const D = 24 * H;
const T0 = Date.UTC(2026, 10, 10, 12); // última conferência
const iso = (ms) => new Date(ms).toISOString();
const cache = (license, extra = {}) => ({ userId: 'u1', license, checkedAt: T0, maxSeen: T0, ...extra });
const trial = (daysLeft) => cache({ status: 'trial', ends_at: iso(T0 + daysLeft * D) });

test('nunca conferiu neste Mac: precisa de internet', () => {
  assert.deepEqual(decideOffline(null, 'u1', T0), { kind: 'need_internet', reason: 'never_checked' });
  assert.deepEqual(decideOffline(undefined, 'u1', T0), { kind: 'need_internet', reason: 'never_checked' });
});

test('conferência de outra conta não vale', () => {
  assert.deepEqual(decideOffline(trial(5), 'outra', T0), { kind: 'need_internet', reason: 'other_account' });
});

test('teste grátis dentro do prazo abre sem internet e o tempo continua contando', () => {
  const d = decideOffline(trial(5), 'u1', T0 + 2 * D);
  assert.equal(d.kind, 'use');
  assert.equal(d.license.status, 'trial');
  assert.equal(d.until, T0 + 5 * D); // na hora em que o teste acaba, decide de novo
});

test('teste grátis fora do prazo sem internet: encerrado, como hoje', () => {
  assert.equal(decideOffline(trial(5), 'u1', T0 + 5 * D).kind, 'expired');
  assert.equal(decideOffline(trial(5), 'u1', T0 + 9 * D).kind, 'expired');
});

test('teste guardado só com horas restantes conta a partir da conferência', () => {
  const c = cache({ status: 'trial', hours_left: 10 });
  assert.equal(decideOffline(c, 'u1', T0 + 9 * H).kind, 'use');
  assert.equal(decideOffline(c, 'u1', T0 + 10 * H).kind, 'expired');
});

test('relógio voltado não estica o teste', () => {
  // o Mac já viu o dia 4 do teste; voltar o relógio para o dia 1 não devolve os dias
  const c = { ...trial(5), maxSeen: T0 + 4 * D };
  assert.deepEqual(decideOffline(c, 'u1', T0 + 1 * D), { kind: 'need_internet', reason: 'clock_back' });
  // teste já acabou na maior hora vista: voltar o relógio não reabre
  const acabou = { ...trial(5), maxSeen: T0 + 6 * D };
  assert.equal(decideOffline(acabou, 'u1', T0 + 1 * D).kind, 'need_internet');
});

test('relógio para trás dentro da tolerância usa a maior hora vista', () => {
  const c = { ...trial(5), maxSeen: T0 + 5 * D - 10 * 60 * 1000 };
  // 30 min antes da maior hora vista: tolerado, mas conta pela maior hora (o teste não ganha tempo)
  assert.equal(decideOffline(c, 'u1', c.maxSeen - 30 * 60 * 1000).kind, 'use');
  const quase = { ...trial(5), maxSeen: T0 + 5 * D };
  assert.equal(decideOffline(quase, 'u1', quase.maxSeen - CLOCK_BACK_TOLERANCE_MS + 1).kind, 'expired');
});

test('relógio do Mac fora da hora do servidor na conferência: precisa de internet', () => {
  const c = { ...trial(5), clockWrong: true };
  assert.deepEqual(decideOffline(c, 'u1', T0 + D), { kind: 'need_internet', reason: 'clock_back' });
});

test('assinante sem internet dentro da tolerância de 30 dias', () => {
  const c = cache({ status: 'active', subscription: 'card' });
  const d = decideOffline(c, 'u1', T0 + 29 * D);
  assert.equal(d.kind, 'use');
  assert.equal(d.until, T0 + OFFLINE_MAX_MS);
});

test('assinante sem internet há mais de 30 dias: precisa de internet', () => {
  const c = cache({ status: 'active', subscription: 'card' });
  assert.deepEqual(decideOffline(c, 'u1', T0 + 30 * D), { kind: 'need_internet', reason: 'too_long' });
});

test('assinatura com fim do período: vale até 3 dias depois, sem internet', () => {
  const c = cache({ status: 'active', subscription: 'pix', current_period_end: iso(T0 + 10 * D) });
  const d = decideOffline(c, 'u1', T0 + 12 * D);
  assert.equal(d.kind, 'use');
  assert.equal(d.until, T0 + 10 * D + PAID_GRACE_MS);
  assert.deepEqual(decideOffline(c, 'u1', T0 + 13 * D), { kind: 'need_internet', reason: 'paid_period_over' });
});

test('período pago longe: o limite é o de 30 dias', () => {
  const c = cache({ status: 'active', plan: 'yearly', current_period_end: iso(T0 + 200 * D) });
  assert.deepEqual(decideOffline(c, 'u1', T0 + 31 * D), { kind: 'need_internet', reason: 'too_long' });
});

test('bônus (promo) com fim em ends_at também tem limite', () => {
  const c = cache({ status: 'active', plan: 'promo', ends_at: iso(T0 + 2 * D) });
  assert.equal(decideOffline(c, 'u1', T0 + D).kind, 'use');
  assert.equal(decideOffline(c, 'u1', T0 + 6 * D).kind, 'need_internet');
});

test('relógio voltado não estica a assinatura', () => {
  const c = cache({ status: 'active' }, { maxSeen: T0 + 29 * D });
  assert.deepEqual(decideOffline(c, 'u1', T0 + D), { kind: 'need_internet', reason: 'clock_back' });
});

test('bloqueio e teste encerrado continuam valendo sem internet', () => {
  const b = decideOffline(cache({ status: 'blocked', reason: 'fraude' }), 'u1', T0 + D);
  assert.equal(b.kind, 'blocked');
  assert.equal(b.license.reason, 'fraude');
  assert.equal(decideOffline(cache({ status: 'expired' }), 'u1', T0 + D).kind, 'expired');
});

test('resposta desconhecida não libera', () => {
  assert.equal(decideOffline(cache({ status: 'anonymous' }), 'u1', T0).kind, 'need_internet');
  assert.equal(decideOffline(cache({ status: 'trial' }), 'u1', T0).kind, 'need_internet');
});

test('todo motivo tem texto para a tela', () => {
  for (const reason of ['never_checked', 'other_account', 'clock_back', 'too_long', 'paid_period_over', 'unknown']) {
    assert.ok(NEED_INTERNET_TEXT[reason]?.length > 20, reason);
  }
});
