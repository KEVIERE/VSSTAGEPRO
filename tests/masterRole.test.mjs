// Tipo de áudio do clipe para a masterização: mixagem inteira, voz ou stem.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { masterRoleFor } from '../src/lib/masterRole.ts';

const tracks = [
  { id: 'track-guia', parentId: null },
  { id: 'track-click', parentId: null },
  { id: 'track-bateria', parentId: null },
  { id: 'track-contrabaixo', parentId: null },
  { id: 'track-outros', parentId: null },
  { id: 'track-123', parentId: 'track-contrabaixo' },
  { id: 'track-voz', parentId: 'track-guia' },
];
const clip = (id, trackId, songId = 's1', startTime = 0, duration = 180) => ({ id, trackId, songId, startTime, duration });

test('guia e voz (filha da guia) são voz', () => {
  const c = [clip('a', 'track-guia'), clip('b', 'track-voz')];
  assert.equal(masterRoleFor(c[0], tracks, c).role, 'voice');
  assert.equal(masterRoleFor(c[1], tracks, c).role, 'voice');
});

test('clipe sozinho na música (com click e guia junto) é a mixagem inteira', () => {
  const c = [clip('mix', 'track-outros'), clip('click', 'track-click'), clip('guia', 'track-guia'), clip('outra', 'track-bateria', 's2')];
  assert.deepEqual(masterRoleFor(c[0], tracks, c), { role: 'mix' });
});

test('clipe tocando junto com outros instrumentos é stem, com o instrumento da faixa-mãe', () => {
  const c = [clip('baixo', 'track-123'), clip('bat', 'track-bateria')];
  assert.deepEqual(masterRoleFor(c[0], tracks, c), { role: 'instrument', instrument: 'baixo' });
  assert.deepEqual(masterRoleFor(c[1], tracks, c), { role: 'instrument', instrument: 'bateria' });
});

test('clipes um depois do outro (sem tocar juntos) são mixagens separadas; mudo não conta', () => {
  const c = [clip('a', 'track-outros', 's1', 0, 100), clip('b', 'track-bateria', 's1', 100, 100), { ...clip('m', 'track-bateria'), mute: true }];
  assert.equal(masterRoleFor(c[0], tracks, c).role, 'mix');
  assert.equal(masterRoleFor(c[1], tracks, c).role, 'mix');
});
