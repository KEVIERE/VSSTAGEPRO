// VS Stage Remote: o programa só executa comandos que reconhece, e o celular calcula o tempo
// entre uma mensagem e outra sem pular.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isRemoteMeters, isRemoteState, liveProgressPct, livePos, liveRemaining, packMeters, parseRemoteCommand, unpackMeters,
} from '../src/lib/remoteProtocol.ts';

test('comandos do Modo Show passam', () => {
  assert.deepEqual(parseRemoteCommand({ action: 'play' }), { action: 'play' });
  assert.deepEqual(parseRemoteCommand({ action: 'flow', flow: 'bloco' }), { action: 'flow', flow: 'bloco' });
  assert.deepEqual(parseRemoteCommand({ action: 'setNext', songId: null }), { action: 'setNext', songId: null });
  assert.deepEqual(
    parseRemoteCommand({ action: 'adjust', songId: 's1', kind: 'tuner', delta: -1, partId: 'p2' }),
    { action: 'adjust', songId: 's1', kind: 'tuner', delta: -1, partId: 'p2' },
  );
  assert.deepEqual(parseRemoteCommand({ action: 'clockDuration', sec: 7200 }), { action: 'clockDuration', sec: 7200 });
  assert.deepEqual(parseRemoteCommand({ action: 'rename', songId: 's1', name: '  Nova  ' }), { action: 'rename', songId: 's1', name: 'Nova' });
});

test('tocar na música da lista só seleciona (comando próprio, sem tocar)', () => {
  assert.deepEqual(parseRemoteCommand({ action: 'select', songId: 's1' }), { action: 'select', songId: 's1' });
  assert.equal(parseRemoteCommand({ action: 'select' }), null);
  assert.equal(parseRemoteCommand({ action: 'select', songId: '' }), null);
  assert.equal(parseRemoteCommand({ action: 'select', songId: 'x'.repeat(500) }), null);
});

test('o fader fica entre 0 e +12 dB', () => {
  assert.deepEqual(parseRemoteCommand({ action: 'volume', trackId: 't', value: 9 }), { action: 'volume', trackId: 't', value: 1.5 });
  assert.deepEqual(parseRemoteCommand({ action: 'master', value: -1 }), { action: 'master', value: 0 });
});

test('comando estranho ou incompleto é recusado', () => {
  assert.equal(parseRemoteCommand(null), null);
  assert.equal(parseRemoteCommand({ action: 'removeSong', songId: 's1' }), null);
  assert.equal(parseRemoteCommand({ action: 'flow', flow: 'aleatorio' }), null);
  assert.equal(parseRemoteCommand({ action: 'adjust', songId: 's1', kind: 'bpm', delta: 5 }), null);
  assert.equal(parseRemoteCommand({ action: 'rename', songId: 's1', name: '   ' }), null);
  assert.equal(parseRemoteCommand({ action: 'volume', trackId: 't', value: Number.NaN }), null);
  assert.equal(parseRemoteCommand({ action: 'clockDuration', sec: -5 }), null);
  assert.equal(parseRemoteCommand({ action: 'blockColor', blockId: 'b', color: 'red' }), null);
  assert.equal(parseRemoteCommand({ action: 'pick', songId: 'x'.repeat(500) }), null);
});

const base = {
  v: 1, at: 10_000, playing: true, pos: 30, speed: 1.25, remaining: 90, segStart: 0, segEnd: 120,
  songs: [], tracks: [],
};

test('tocando: posição e restante andam com o relógio do Mac', () => {
  assert.equal(livePos(base, 12_000), 32.5);
  assert.equal(liveRemaining(base, 12_000), 88);
  assert.equal(liveProgressPct(base, 12_000), (32.5 / 120) * 100);
});

test('parado: nada anda', () => {
  const s = { ...base, playing: false };
  assert.equal(livePos(s, 50_000), 30);
  assert.equal(liveRemaining(s, 50_000), 90);
  assert.equal(liveProgressPct(s, 50_000), 0);
});

test('o restante não fica negativo e o estado precisa da versão certa', () => {
  assert.equal(liveRemaining(base, 500_000), 0);
  assert.equal(liveRemaining({ ...base, remaining: null }, 12_000), null);
  assert.equal(isRemoteState(base), true);
  assert.equal(isRemoteState({ ...base, v: 99 }), false);
});

test('medidores: o nível de cada canal e do master vai e volta igual', () => {
  const levels = { 'track-click': 0.5, 'track-bateria': 0.123456, master: 0.9 };
  const m = packMeters(['track-click', 'track-bateria'], (id) => levels[id] ?? 0, 1234);
  assert.equal(isRemoteMeters(m), true);
  assert.deepEqual(m.levels, [0.5, 0.1235]);
  const back = unpackMeters(m);
  assert.equal(back.get('track-click'), 0.5);
  assert.equal(back.get('track-bateria'), 0.1235);
  assert.equal(back.get('master'), 0.9);
});

test('medidores: valor estranho vira silêncio e pacote quebrado é recusado', () => {
  const m = packMeters(['a', 'b', 'c'], (id) => ({ a: Number.NaN, b: -1, c: 99 })[id], 1);
  assert.deepEqual(m.levels, [0, 0, 4]);
  assert.equal(isRemoteMeters(null), false);
  assert.equal(isRemoteMeters({ ...m, v: 2 }), false);
  assert.equal(isRemoteMeters({ ...m, levels: [0.1] }), false);
  assert.equal(isRemoteMeters({ ...m, master: 'x' }), false);
  assert.equal(packMeters(Array.from({ length: 100 }, (_, i) => `t${i}`), () => 0, 1).ids.length, 64);
});
