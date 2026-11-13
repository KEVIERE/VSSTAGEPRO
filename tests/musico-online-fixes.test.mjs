// Área do Músico: fila do caderno com o aparelho cheio e o aviso "Não guardado".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  anyNotKept, forgetUnsent, isNotKept, keepUnsent, markSent, newer, newestOf, readQueue, unsentVersions, writeQueue,
} from '../src/components/musician/notebook/notebookQueue.ts';
import { saveOutcome } from '../src/lib/musicianSave.ts';

/** localStorage falso; com `full`, qualquer gravação estoura a cota como no Safari. */
function fakeStorage() {
  const mem = new Map();
  const s = {
    full: false,
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => {
      if (s.full) throw new DOMException('cheio', 'QuotaExceededError');
      mem.set(k, String(v));
    },
    removeItem: (k) => { mem.delete(k); },
  };
  return s;
}

function withStorage(fn) {
  const saved = globalThis.localStorage;
  const ls = fakeStorage();
  globalThis.localStorage = ls;
  try { return fn(ls); } finally { globalThis.localStorage = saved; }
}

const v = (songId, content, at) => ({ songId, sheetId: null, title: songId, content, at });

test('writeQueue diz quando o aparelho não guardou', () => withStorage((ls) => {
  assert.equal(writeQueue('q0', { a: v('a', 'x', 1) }), true);
  ls.full = true;
  assert.equal(writeQueue('q0', { a: v('a', 'y', 2) }), false);
  assert.equal(readQueue('q0').a.content, 'x', 'a versão anterior continua lá');
}));

test('aparelho cheio: a versão fica na memória e o status é "não guardado"', () => withStorage((ls) => {
  ls.full = true;
  const kept = keepUnsent('q1', v('a', 'nova', 10));
  assert.equal(kept, false);
  assert.equal(isNotKept('q1', 'a'), true);
  assert.equal(anyNotKept('q1'), true);
  assert.equal(newestOf('q1', 'a').content, 'nova');
  assert.equal(anyNotKept('outra-fila'), false);
}));

test('com uma versão velha no aparelho, o reenvio manda a nova (e não marca salvo com a velha)', () => withStorage((ls) => {
  // v1 ficou guardada no aparelho; v2 falhou com o aparelho cheio
  assert.equal(keepUnsent('q2', v('a', 'v1', 1)), true);
  ls.full = true;
  assert.equal(keepUnsent('q2', v('a', 'v2', 2)), false);
  const out = unsentVersions('q2');
  assert.equal(out.length, 1, 'uma versão por música');
  assert.equal(out[0].content, 'v2');
  // se a v1 chegar primeiro (envio que já estava a caminho), a v2 ainda falta
  ls.full = false;
  const later = markSent('q2', v('a', 'v1', 1));
  assert.equal(later?.content, 'v2');
  assert.equal(isNotKept('q2', 'a'), true);
  // a v2 chega: tudo limpo
  assert.equal(markSent('q2', later), undefined);
  assert.equal(unsentVersions('q2').length, 0);
  assert.equal(isNotKept('q2', 'a'), false);
  assert.deepEqual(readQueue('q2'), {});
}));

test('mesma versão já guardada: não regrava a fila inteira', () => withStorage((ls) => {
  assert.equal(keepUnsent('q3', v('a', 'x', 5)), true);
  ls.full = true; // qualquer setItem agora estouraria
  assert.equal(keepUnsent('q3', v('a', 'x', 5)), true, 'já estava no aparelho');
  assert.equal(isNotKept('q3', 'a'), false);
}));

test('caderno excluído: some do aparelho e da memória (o reenvio não o recria)', () => withStorage((ls) => {
  keepUnsent('q4', v('a', 'x', 1));
  ls.full = true;
  keepUnsent('q4', v('a', 'y', 2));
  ls.full = false;
  forgetUnsent('q4', 'a');
  assert.equal(newestOf('q4', 'a'), undefined);
  assert.equal(unsentVersions('q4').length, 0);
  assert.equal(isNotKept('q4', 'a'), false);
}));

test('newer fica com a de maior hora (no empate, a primeira)', () => {
  const a = v('a', 'a', 1);
  const b = v('a', 'b', 2);
  assert.equal(newer(a, b), b);
  assert.equal(newer(b, a), b);
  const c = v('a', 'c', 2);
  assert.equal(newer(b, c), b);
  assert.equal(newer(undefined, a), a);
  assert.equal(newer(a, undefined), a);
});

test('Salvar com o aparelho cheio: "Não salvou" e pede para não fechar a página', () => {
  const online = saveOutcome('not_kept', null);
  assert.equal(online.tone, 'fail');
  assert.match(online.text, /sem espaço neste aparelho/);
  assert.match(online.text, /Não feche esta página/);
  assert.match(online.text, /internet/);
  const local = saveOutcome('not_kept', 'error');
  assert.match(local.text, /Mac do diretor/);
  assert.doesNotMatch(local.text, /ficou guardado/);
});
