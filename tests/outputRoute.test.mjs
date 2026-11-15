// Saída de cada faixa: placa desconectada devolve as saídas diretas para o LR (Master).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { resolveRoute, interfaceMissing } = await import('../src/lib/outputRoute.ts');

const base = { out: 0, off: false, stereo: false, timecode: false, magic: false, outputCount: 2, interfaceMissing: false };

test('Master continua no Master', () => {
  assert.deepEqual(resolveRoute(base), { physical: 0, key: 'master' });
});

test('Guia na Saída 1 com a placa ligada vai para a saída 1', () => {
  assert.deepEqual(resolveRoute({ ...base, out: 1, outputCount: 8 }), { physical: 1, key: 'out-1' });
});

test('placa desconectada: a Guia na Saída 1 volta para o Master (centro), não fica no L do Mac', () => {
  assert.deepEqual(resolveRoute({ ...base, out: 1, outputCount: 2, interfaceMissing: true }), { physical: 0, key: 'master' });
});

test('placa desconectada: par estéreo também volta para o Master', () => {
  assert.deepEqual(resolveRoute({ ...base, out: 3, stereo: true, outputCount: 8, interfaceMissing: true }), { physical: 0, key: 'master' });
});

test('placa desconectada: o timecode fica mudo, não vai para o alto-falante', () => {
  assert.deepEqual(resolveRoute({ ...base, out: 1, timecode: true, interfaceMissing: true }), { physical: 0, key: 'none' });
});

test('saída que a placa não tem volta para o Master', () => {
  assert.deepEqual(resolveRoute({ ...base, out: 5, outputCount: 2 }), { physical: 0, key: 'master' });
});

test('LR mágico manda para o Master, mas o timecode segue na saída dele', () => {
  assert.equal(resolveRoute({ ...base, out: 1, magic: true, outputCount: 8 }).key, 'master');
  assert.equal(resolveRoute({ ...base, out: 3, timecode: true, magic: true, outputCount: 8 }).key, 'out-3');
});

test('"Desligado" não toca em lugar nenhum', () => {
  assert.equal(resolveRoute({ ...base, out: -1, off: true }).key, 'none');
});

test('saída padrão do Mac escolhida de propósito não conta como placa desconectada', () => {
  assert.equal(interfaceMissing('default', false), false);
  assert.equal(interfaceMissing('UA Apollo', false), true);
  assert.equal(interfaceMissing('UA Apollo', true), false);
  assert.equal(resolveRoute({ ...base, out: 1, interfaceMissing: interfaceMissing('default', false) }).key, 'out-1');
});
