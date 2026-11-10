// Um Mac por vez em cada conta (resposta do servidor e frases da pergunta) e para onde vai
// quem confirma o cadastro pelo e-mail. Rodar com: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REFUSED_TEXT, REPLACED_TEXT, lastSeenText, otherDeviceLabel, readDeviceVerdict } from '../src/lib/deviceLock.ts';
import { confirmLanding } from '../src/lib/confirmLanding.ts';

test('servidor: este Mac liberado', () => {
  assert.deepEqual(readDeviceVerdict({ status: 'ok' }), { status: 'ok' });
});

test('servidor: conta aberta em outro Mac traz o nome e quando foi usado', () => {
  assert.deepEqual(
    readDeviceVerdict({ status: 'conflict', other_name: ' Mac do Palco ', other_seen: '2026-11-10T12:00:00Z' }),
    { status: 'conflict', otherName: 'Mac do Palco', otherSeen: '2026-11-10T12:00:00Z' },
  );
  assert.deepEqual(readDeviceVerdict({ status: 'conflict' }), { status: 'conflict', otherName: null, otherSeen: null });
});

test('servidor: este Mac foi desconectado por outro', () => {
  assert.deepEqual(readDeviceVerdict({ status: 'replaced', other_name: 'Casa' }), { status: 'replaced', otherName: 'Casa' });
});

test('resposta estranha, erro do banco ou nada: não bloqueia', () => {
  for (const data of [null, undefined, 'x', 42, {}, { error: 'not_authenticated' }, { status: 'outra' }]) {
    assert.deepEqual(readDeviceVerdict(data), { status: 'ok' });
  }
});

test('nome do outro Mac na pergunta', () => {
  assert.equal(otherDeviceLabel('MacBook do João'), 'o computador "MacBook do João"');
  assert.equal(otherDeviceLabel(''), 'outro computador');
  assert.equal(otherDeviceLabel(null), 'outro computador');
  assert.equal(otherDeviceLabel('x'.repeat(200)).length, 'o computador ""'.length + 80);
});

test('quando o outro Mac foi usado', () => {
  const now = new Date(2026, 10, 10, 20, 0).getTime();
  assert.equal(lastSeenText(new Date(now - 60 * 1000).toISOString(), now), 'em uso agora');
  assert.equal(lastSeenText(new Date(now - 25 * 60 * 1000).toISOString(), now), 'usado há 25 min');
  assert.equal(lastSeenText(new Date(2026, 10, 8, 9, 5).toISOString(), now), 'usado pela última vez em 08/11 às 09:05');
  assert.equal(lastSeenText(null, now), null);
  assert.equal(lastSeenText('não é data', now), null);
  // relógio do Mac atrasado em relação ao servidor: não mostra tempo negativo
  assert.equal(lastSeenText(new Date(now + 3 * 60 * 1000).toISOString(), now), 'em uso agora');
});

test('frases sem travessão', () => {
  for (const t of [REPLACED_TEXT, REFUSED_TEXT]) assert.ok(!t.includes('—'));
});

test('confirmou o cadastro: vai para a página de downloads', () => {
  assert.equal(confirmLanding('signup', ''), 'download');
  assert.equal(confirmLanding('signup', '?foo=1'), 'download');
});

test('confirmou o cadastro da Área do Músico: card do músico', () => {
  assert.equal(confirmLanding('signup', '?musico=1'), 'musician');
});

test('não é link de confirmação: segue a rota normal', () => {
  assert.equal(confirmLanding(null, ''), null);
  assert.equal(confirmLanding('recovery', ''), null);
});
