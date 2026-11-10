// Botão "Salvar" da Área do Músico: o aviso diz claramente se salvou, se falta o diretor ou se falhou.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { saveOutcome } from '../src/lib/musicianSave.ts';

test('rede local: projeto gravado no Mac é "Salvo"', () => {
  const o = saveOutcome('saved', 'saved');
  assert.equal(o.tone, 'ok');
  assert.match(o.text, /gravado no Mac do diretor/);
});

test('com a música tocando, grava quando ela parar (e avisa)', () => {
  const o = saveOutcome('saved', 'later');
  assert.equal(o.tone, 'ok');
  assert.match(o.text, /assim que a música parar/);
});

test('projeto sem arquivo ou que não gravou: o caderno está a salvo, mas avisa o que falta', () => {
  assert.equal(saveOutcome('saved', 'no_file').tone, 'warn');
  assert.match(saveOutcome('saved', 'no_file').text, /salvar o projeto uma vez/);
  assert.equal(saveOutcome('saved', 'error').tone, 'warn');
  assert.equal(saveOutcome('saved', 'unavailable').tone, 'warn');
});

test('conta online: salvo na conta', () => {
  assert.deepEqual(saveOutcome('saved', null), { tone: 'ok', text: 'Salvo na sua conta.' });
});

test('sem conexão ou caderno cheio demais: "Não salvou" com o motivo', () => {
  assert.equal(saveOutcome('offline', 'error').tone, 'fail');
  assert.match(saveOutcome('offline', 'error').text, /Mac do diretor/);
  assert.match(saveOutcome('offline', null).text, /internet/);
  assert.equal(saveOutcome('too_big', null).tone, 'fail');
  assert.match(saveOutcome('too_big', 'saved').text, /cheio demais/);
});
