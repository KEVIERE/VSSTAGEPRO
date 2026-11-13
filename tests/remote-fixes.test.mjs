// VS Stage Remote: relógio do Mac no celular, fila de comandos, estado leve do Show Online e as
// cores que precisam bater com o Mac.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  enqueueCommand, listRevision, liteRemoteState, pushClockSample, readRemoteMessage, remoteListKey,
} from '../src/lib/remoteProtocol.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => readFileSync(join(root, ...p), 'utf8');

test('relógio: vale a maior das últimas diferenças (resposta atrasada só diminui a diferença)', () => {
  const s = [];
  assert.equal(pushClockSample(s, 1000), 1000);
  // resposta que demorou 300 ms no Wi-Fi: a diferença medida cai, mas a estimativa não volta
  assert.equal(pushClockSample(s, 700), 1000);
  assert.equal(pushClockSample(s, 1005), 1005);
  // guarda só as 10 últimas: a medida velha sai
  for (let i = 0; i < 10; i++) pushClockSample(s, 500);
  assert.equal(s.length, 10);
  assert.equal(pushClockSample(s, 600), 600);
});

test('fila: o fader que espera troca de valor e o resto fica na ordem do toque', () => {
  const q = [];
  enqueueCommand(q, { action: 'volume', trackId: 'a', value: 0.1 });
  enqueueCommand(q, { action: 'mute', trackId: 'a', on: true });
  enqueueCommand(q, { action: 'volume', trackId: 'a', value: 0.5 });
  enqueueCommand(q, { action: 'volume', trackId: 'b', value: 0.3 });
  enqueueCommand(q, { action: 'master', value: 0.7 });
  enqueueCommand(q, { action: 'master', value: 0.9 });
  enqueueCommand(q, { action: 'stop', wasActive: true });
  assert.deepEqual(q, [
    { action: 'volume', trackId: 'a', value: 0.5 },
    { action: 'mute', trackId: 'a', on: true },
    { action: 'volume', trackId: 'b', value: 0.3 },
    { action: 'master', value: 0.9 },
    { action: 'stop', wasActive: true },
  ]);
});

const full = {
  v: 1, at: 1000, playing: true, pos: 3, speed: 1, remaining: 10, segStart: 0, segEnd: 20,
  songs: [{ id: 's1', name: 'Abertura' }], blocks: [{ id: 'b1', name: 'Bloco' }], blockColors: ['#ff0000'],
  tracks: [], master: 0.8,
};

test('estado leve: sem a lista, com a revisão; a lista muda e a revisão muda', () => {
  const rev = listRevision(remoteListKey(full));
  assert.equal(rev, listRevision(remoteListKey({ ...full, at: 2000, pos: 9 })));
  assert.notEqual(rev, listRevision(remoteListKey({ ...full, songs: [{ id: 's1', name: 'Abertura 2' }] })));
  const lite = liteRemoteState(full, rev);
  assert.equal(lite.lite, 1);
  assert.equal(lite.rev, rev);
  assert.equal('songs' in lite || 'blocks' in lite || 'blockColors' in lite, false);
  assert.equal(lite.master, 0.8);
});

test('estado leve com a mesma revisão junta a lista guardada', () => {
  const rev = listRevision(remoteListKey(full));
  const first = readRemoteMessage({ ...full, rev }, null);
  assert.equal(first.kind, 'state');
  assert.equal(first.list.rev, rev);
  const next = readRemoteMessage(liteRemoteState({ ...full, at: 2000, pos: 4 }, rev), first.list);
  assert.equal(next.kind, 'state');
  assert.equal(next.state.at, 2000);
  assert.deepEqual(next.state.songs, full.songs);
  assert.deepEqual(next.state.blocks, full.blocks);
  assert.equal('lite' in next.state, false);
});

test('estado leve de outra lista (ou sem lista guardada) não é aplicado: pede o completo', () => {
  const first = readRemoteMessage({ ...full, rev: 'a1' }, null);
  assert.deepEqual(readRemoteMessage(liteRemoteState(full, 'b2'), first.list), { kind: 'needFull' });
  assert.deepEqual(readRemoteMessage(liteRemoteState(full, 'a1'), null), { kind: 'needFull' });
  // Mac antigo (estado completo sem revisão): vale, mas não serve de base para estado leve
  const old = readRemoteMessage({ ...full }, null);
  assert.equal(old.kind, 'state');
  assert.equal(old.list.rev, undefined);
  assert.deepEqual(readRemoteMessage(liteRemoteState(full, 'a1'), old.list), { kind: 'needFull' });
  assert.deepEqual(readRemoteMessage(null, null), { kind: 'bad' });
  assert.deepEqual(readRemoteMessage({ ...full, v: 99 }, null), { kind: 'bad' });
});

test('Remote: fluxo aceso em laranja (igual ao Mac) e selo "Selecionada" fora do verde do "No ar"', () => {
  const show = read('src', 'components', 'remote', 'RemoteShowTab.tsx');
  assert.match(show, /\$\{on \? 'is-lit-amber' : ''\}/, 'fluxo aceso em laranja também no Remote');
  const list = read('src', 'components', 'remote', 'RemoteSetlist.tsx');
  assert.match(list, /font-semibold text-white">Selecionada/);
  const mixer = read('src', 'components', 'remote', 'RemoteMixer.tsx');
  assert.match(mixer, /console-tape console-lcdname/, 'nome do canal no visor preto, como no mixer do Mac');
});
