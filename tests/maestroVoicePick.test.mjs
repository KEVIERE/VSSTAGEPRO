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

test('as vozes compactas/Eloquence são marcadas como qualidade baixa (são a pior da Apple)', () => {
  const eloquence = ['Eddy (Português (Brasil))', 'Flo (Português (Brasil))', 'Grandma (Português (Brasil))', 'Rocko (Português (Brasil))'];
  for (const name of eloquence) {
    const v = parseVoiceLine(`${name} pt_BR    # Olá, meu nome é X.`);
    assert.equal(v.quality, 0, `${name} deveria ser qualidade 0 (compacta)`);
  }
  // a compacta que vem de fábrica também é 0
  assert.equal(parseVoiceLine('Luciana             pt_BR    # Olá, meu nome é Luciana.').quality, 0);
});

test('versões baixadas são marcadas como melhores', () => {
  assert.equal(parseVoiceLine('Luciana (Melhorada) pt_BR    # Olá.').quality, 1);
  assert.equal(parseVoiceLine('Luciana (Aprimorada) pt_BR    # Olá.').quality, 1);
  assert.equal(parseVoiceLine('Luciana (Premium) pt_BR    # Olá.').quality, 2);
});

test('com voz premium e compacta do mesmo nome, a premium vem primeiro', () => {
  const list = [
    parseVoiceLine('Luciana             pt_BR    # compacta'),
    parseVoiceLine('Luciana (Premium)   pt_BR    # premium'),
  ].filter(Boolean);
  const ranked = pickVoice(list, 'feminina');
  assert.match(ranked.name, /Premium/);
});

test('nenhuma voz do Mac aparece na lista: ficam só as duas de IA (Feminina e Masculina)', () => {
  const { offerable } = require('../desktop/maestroVoice.js');
  const list = [
    'Eddy (Português (Brasil)) pt_BR    # oi',
    'Flo (Português (Brasil)) pt_BR    # oi',
    'Grandma (Português (Brasil)) pt_BR    # oi',
    'Grandpa (Português (Brasil)) pt_BR    # oi',
    'Reed (Português (Brasil)) pt_BR    # oi',
    'Rocko (Português (Brasil)) pt_BR    # oi',
    'Sandy (Português (Brasil)) pt_BR    # oi',
    'Shelley (Português (Brasil)) pt_BR    # oi',
    'Joana               pt_PT    # oi',
    'Luciana             pt_BR    # oi',
  ].map(parseVoiceLine).filter(Boolean);

  assert.deepEqual(list.filter(offerable).map((v) => v.name), [], 'nenhuma voz do Mac na lista');

  // só uma versão Melhorada/Premium baixada pelo sistema aparece
  const comPremium = [...list, parseVoiceLine('Luciana (Premium) pt_BR    # oi')].filter(offerable).map((v) => v.name);
  assert.deepEqual(comPremium, ['Luciana (Premium)']);
});

test('voz compacta escolhida não mostra mais pedido para baixar outra voz', () => {
  const v = pickVoice([parseVoiceLine('Luciana             pt_BR    # oi')].filter(Boolean), 'feminina');
  assert.equal(v.name, 'Luciana');
  assert.equal(v.note, null, 'sem mensagem pedindo para baixar a Luciana');
});
