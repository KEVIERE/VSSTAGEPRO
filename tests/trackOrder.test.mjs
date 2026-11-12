// Arrastar na timeline: ordem das trilhas dentro do multigrupo, áudio para outra trilha e
// duplicar trilha sem copiar os áudios.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dropSlot, laneMoves, laneOffset, reorderChildren } from '../src/lib/trackOrder.ts';
import { mergeCustomChildren } from '../src/lib/customTracks.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const store = fs.readFileSync(path.join(here, '..', 'src', 'store.ts'), 'utf8');

test('arrastar uma trilha para outra posição dentro da pasta', () => {
  const kids = ['kick', 'caixa', 'hihat', 'over'];
  // para o começo
  assert.deepEqual(reorderChildren(kids, 'over', 0), ['over', 'kick', 'caixa', 'hihat']);
  // para o fim
  assert.deepEqual(reorderChildren(kids, 'kick', 4), ['caixa', 'hihat', 'over', 'kick']);
  // descer uma posição: entra antes da que estava duas abaixo
  assert.deepEqual(reorderChildren(kids, 'kick', 2), ['caixa', 'kick', 'hihat', 'over']);
  // subir uma posição
  assert.deepEqual(reorderChildren(kids, 'hihat', 1), ['kick', 'hihat', 'caixa', 'over']);
});

test('soltar no mesmo lugar não muda nada', () => {
  const kids = ['a', 'b', 'c'];
  assert.equal(reorderChildren(kids, 'b', 1), kids);
  assert.equal(reorderChildren(kids, 'b', 2), kids);
  assert.equal(reorderChildren(kids, 'x', 0), kids);
});

test('posição de soltar pelo meio de cada linha', () => {
  const rows = [{ top: 0, height: 40 }, { top: 40, height: 40 }, { top: 80, height: 60 }];
  assert.equal(dropSlot(rows, 5), 0);
  assert.equal(dropSlot(rows, 25), 1);
  assert.equal(dropSlot(rows, 79), 2);
  assert.equal(dropSlot(rows, 115), 3);
  assert.equal(dropSlot(rows, 500), 3);
});

test('a ordem que a pessoa arrastou continua depois de importar outro VS', () => {
  const custom = new Set(['c1']);
  // a pessoa pôs o Violão 2 antes do Violão 1; a reorganização devolve na ordem automática
  assert.deepEqual(mergeCustomChildren(['v2', 'v1'], ['v1', 'v2'], custom), ['v2', 'v1']);
  // faixa automática nova entra logo depois da anterior da sequência, onde ela estiver
  assert.deepEqual(mergeCustomChildren(['v2', 'v1'], ['v1', 'v2', 'v3'], custom), ['v2', 'v3', 'v1']);
  assert.deepEqual(mergeCustomChildren(['v3', 'v1'], ['v1', 'v2', 'v3'], custom), ['v3', 'v1', 'v2']);
  // trilha criada à mão no meio continua onde a pessoa deixou
  assert.deepEqual(mergeCustomChildren(['v2', 'c1', 'v1'], ['v1', 'v2'], custom), ['v2', 'c1', 'v1']);
});

test('áudio arrastado para baixo ou para cima vai para a trilha ao lado', () => {
  const lanes = ['guia', 'click', 'kick', 'caixa', 'piano'];
  // um áudio no Kick, mouse em cima do Piano: desce duas
  assert.equal(laneOffset(2, 4, [2], lanes.length), 2);
  assert.deepEqual(laneMoves(lanes, [{ id: 'a', trackId: 'kick' }], 2), [{ clipId: 'a', trackId: 'piano' }]);
  // sobe para a Guia
  assert.deepEqual(laneMoves(lanes, [{ id: 'a', trackId: 'kick' }], -2), [{ clipId: 'a', trackId: 'guia' }]);
  // sem deslocamento, nada muda
  assert.deepEqual(laneMoves(lanes, [{ id: 'a', trackId: 'kick' }], 0), []);
});

test('vários áudios andam juntos e param na beirada', () => {
  const lanes = ['guia', 'click', 'kick', 'caixa', 'piano'];
  // Kick e Caixa juntos, pegando pelo Kick e levando até o Piano: só cabe descer uma
  assert.equal(laneOffset(2, 4, [2, 3], lanes.length), 1);
  assert.deepEqual(
    laneMoves(lanes, [{ id: 'a', trackId: 'kick' }, { id: 'b', trackId: 'caixa' }], 1),
    [{ clipId: 'a', trackId: 'caixa' }, { clipId: 'b', trackId: 'piano' }],
  );
  // subindo além da primeira: para na Guia
  assert.equal(laneOffset(3, 0, [2, 3], lanes.length), -2);
  // áudio fora da lista (timecode): não muda de trilha
  assert.equal(laneOffset(2, 4, [2, -1], lanes.length), 0);
});

test('duplicar trilha cria só a trilha, sem copiar os áudios', () => {
  const start = store.indexOf('duplicateTrack: (trackId) => {');
  const end = store.indexOf('reorderChildTrack: (trackId, slot) =>', start);
  assert.ok(start > 0 && end > start, 'achou o duplicar');
  const body = store.slice(start, end);
  assert.doesNotMatch(body, /clips:/, 'não mexe nos clipes');
  assert.doesNotMatch(body, /registerClipSource/, 'não registra áudio para a cópia');
});

test('trilha que recebe áudio arrastado fica com ele na próxima reorganização', () => {
  const start = store.indexOf('moveClipsToTracks: (moves) => set((s) => {');
  assert.ok(start > 0, 'achou o mover áudios');
  const body = store.slice(start, store.indexOf('setClipMarkers:', start));
  assert.match(body, /custom: true/, 'a trilha de destino vira trilha da pessoa');
  assert.match(body, /!target\.isSubgroup/, 'pasta nunca recebe áudio');
  assert.match(body, /isTimecodeTrackId/, 'o timecode fica fora');
});
