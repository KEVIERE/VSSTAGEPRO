// Escolha da voz do Maestro por IA no app do Mac (desktop/maestroVoice.js): sempre português,
// do gênero pedido, preferindo pt-BR e as vozes baixadas (melhor qualidade).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { parseVoiceLine, pickVoice } = require('../desktop/maestroVoice.js');

// Lista como o `say -v '?'` mostra num Mac em português
const SAY = `
Albert              en_US    # Hello! My name is Albert.
Eddy (Português (Brasil)) pt_BR    # Olá, meu nome é Eddy.
Flo (Português (Brasil)) pt_BR    # Olá, meu nome é Flo.
Grandpa (Português (Brasil)) pt_BR    # Olá, meu nome é Grandpa.
Joana               pt_PT    # Olá! Chamo‑me Joana.
Luciana             pt_BR    # Olá, meu nome é Luciana.
Reed (Português (Brasil)) pt_BR    # Olá, meu nome é Reed.
Samantha            en_US    # Hello! My name is Samantha.
`.split('\n').map(parseVoiceLine).filter(Boolean);

test('lê as vozes com o idioma entre parênteses e um espaço só antes do código', () => {
  const eddy = SAY.find((v) => v.name.startsWith('Eddy'));
  assert.ok(eddy, 'Eddy deveria aparecer na lista');
  assert.equal(eddy.name, 'Eddy (Português (Brasil))');
  assert.equal(eddy.locale, 'pt_BR');
  assert.equal(eddy.gender, 'masculina');
  assert.equal(SAY.find((v) => v.name === 'Luciana').gender, 'feminina');
});

test('feminina: Luciana (pt-BR) vence Joana (Portugal)', () => {
  assert.equal(pickVoice(SAY, 'feminina').name, 'Luciana');
});

test('masculina: voz brasileira, nunca uma voz em inglês', () => {
  const v = pickVoice(SAY, 'masculina');
  assert.equal(v.locale, 'pt_BR');
  assert.equal(v.gender, 'masculina');
  assert.equal(v.name, 'Eddy (Português (Brasil))');
});

test('versão baixada (Melhorada/Premium) vence a compacta', () => {
  const list = [...SAY, parseVoiceLine('Luciana (Melhorada) pt_BR    # Olá, meu nome é Luciana.')];
  assert.equal(pickVoice(list, 'feminina').name, 'Luciana (Melhorada)');
});

test('sem voz masculina em português: usa uma em português e avisa como instalar', () => {
  const soFeminina = SAY.filter((v) => v.gender !== 'masculina' || !/^pt/.test(v.locale));
  const v = pickVoice(soFeminina, 'masculina');
  assert.ok(/^pt/.test(v.locale), 'nunca cai numa voz em inglês');
  assert.match(v.note, /não está instalada/);
});

test('sem nenhuma voz em português: não escolhe nada', () => {
  assert.equal(pickVoice(SAY.filter((v) => !/^pt/.test(v.locale)), 'feminina'), null);
});

test('nome exato de uma voz é respeitado', () => {
  assert.equal(pickVoice(SAY, 'Reed (Português (Brasil))').name, 'Reed (Português (Brasil))');
});
