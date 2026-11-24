// Liberação dos endereços de áudio gerado: só sai o que ninguém mais usa.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClipUrlReleaser, isBlobUrl } from '../src/lib/clipBlobUrls.ts';

test('endereço em uso nunca é liberado', () => {
  const revoked = [];
  const sync = createClipUrlReleaser((u) => revoked.push(u));
  sync(new Set(['blob:a', 'blob:b']));
  sync(new Set(['blob:a', 'blob:b']));
  assert.deepEqual(revoked, []);
});

test('endereço que saiu do projeto e do Desfazer é liberado uma vez só', () => {
  const revoked = [];
  const sync = createClipUrlReleaser((u) => revoked.push(u));
  sync(new Set(['blob:a', 'blob:b']));
  assert.equal(sync(new Set(['blob:b'])), 1);
  assert.equal(sync(new Set(['blob:b'])), 0);
  assert.deepEqual(revoked, ['blob:a']);
});

test('só reconhece endereço blob, não caminho de arquivo', () => {
  assert.equal(isBlobUrl('blob:vsstage://app/1'), true);
  assert.equal(isBlobUrl('audio/bateria.wav'), false);
  assert.equal(isBlobUrl(undefined), false);
});
