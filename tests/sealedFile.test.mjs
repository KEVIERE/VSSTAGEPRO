// Conferência da conta guardada no Mac sem o Chaves do macOS (que pedia senha a cada versão):
// lacrada com a chave do app e da placa do Mac.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { sealKey, seal, unseal } = require('../desktop/sealedFile.js');

const mac = sealKey('placa-do-mac-1');
const texto = JSON.stringify({ userId: 'u1', license: { status: 'active' }, v: 1 });

test('lacra e abre de novo no mesmo Mac', () => {
  assert.equal(unseal(seal(texto, mac), mac), texto);
});

test('o arquivo não mostra o conteúdo', () => {
  assert.equal(seal(texto, mac).includes(Buffer.from('active')), false);
});

test('arquivo mexido à mão não abre', () => {
  const lacrado = seal(texto, mac);
  lacrado[lacrado.length - 1] ^= 1;
  assert.equal(unseal(lacrado, mac), null);
});

test('arquivo copiado para outro Mac não abre', () => {
  assert.equal(unseal(seal(texto, mac), sealKey('placa-do-mac-2')), null);
});

test('arquivo antigo, vazio ou de outro formato não abre e não quebra', () => {
  assert.equal(unseal(Buffer.from('v10qualquercoisa-do-chaves-do-mac-aqui'), mac), null);
  assert.equal(unseal(Buffer.alloc(0), mac), null);
  assert.equal(unseal(null, mac), null);
});
