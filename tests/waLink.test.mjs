// Link de conversa individual no WhatsApp, o caminho sem custo por mensagem.
// Roda sem rede: só monta a URL. Rodar com: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { personWhatsAppUrl, supportWhatsAppUrl, waDigits } from '../src/lib/support.ts';

test('waLink: telefone em formatos diferentes vira só dígitos', () => {
  assert.equal(waDigits('+55 11 98539-3676'), '5511985393676');
  assert.equal(waDigits('(11) 91234-5678'), '11912345678');
  assert.equal(waDigits('  '), null);
  assert.equal(waDigits(null), null);
});

test('waLink: número curto ou longo demais não vira link', () => {
  // Sem isso, um "123" no cadastro abriria uma conversa com o número errado.
  assert.equal(waDigits('123'), null);
  assert.equal(waDigits('1234567890123456'), null);
  assert.equal(personWhatsAppUrl('123', 'oi'), null);
});

test('waLink: monta a URL da pessoa com o texto escapado', () => {
  const url = personWhatsAppUrl('+5511985393676', 'Oi! Seu teste termina hoje & amanhã?');
  assert.equal(
    url,
    'https://wa.me/5511985393676?text=Oi!%20Seu%20teste%20termina%20hoje%20%26%20amanh%C3%A3%3F',
  );
});

test('waLink: sem texto a URL abre a conversa vazia', () => {
  assert.equal(personWhatsAppUrl('+5511985393676', '   '), 'https://wa.me/5511985393676');
});

test('waLink: sem telefone devolve null e não cai no número do suporte', () => {
  // Cair no suporte mandaria a mensagem do usuário para o dono do projeto.
  assert.equal(personWhatsAppUrl(null, 'oi'), null);
  assert.equal(personWhatsAppUrl(undefined, 'oi'), null);
  assert.equal(personWhatsAppUrl('', 'oi'), null);
});

test('waLink: o link do suporte continua com o número fixo do site', () => {
  assert.equal(supportWhatsAppUrl(), 'https://wa.me/5511985393676');
  assert.match(supportWhatsAppUrl('oi'), /^https:\/\/wa\.me\/5511985393676\?text=oi$/);
});
