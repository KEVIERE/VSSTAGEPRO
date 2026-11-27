// Botão direito na placa de BPM da régua: Remover (só ela) e Remover todos os marcadores.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');
const grid = read('components/TimelineGrid.tsx');
const store = read('store.ts');

test('o menu da placa tem Remover e Remover todos os marcadores', () => {
  assert.match(grid, /<span>Remover<\/span>/);
  assert.match(grid, /<span>Remover todos os marcadores<\/span>/);
  assert.match(grid, /removeAllTempoChanges\(song\.id\)/);
});

test('Remover todos fica o andamento do começo, no mesmo lugar, e vira mapa manual', () => {
  const fn = store.slice(store.indexOf('removeAllTempoChanges: (songId) =>'), store.indexOf('moveTempoAt: (songId, fromTime'));
  assert.match(fn, /keepSegmentPhase\(/);
  assert.match(fn, /bpm: first\.bpm/);
  assert.match(fn, /tempoMapSource: 'manual'/);
});
