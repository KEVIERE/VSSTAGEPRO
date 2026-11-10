// VS Stage Remote: o programa só executa comandos que reconhece, e o celular calcula o tempo
// entre uma mensagem e outra sem pular.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isRemoteState, liveProgressPct, livePos, liveRemaining, parseRemoteCommand } from '../src/lib/remoteProtocol.ts';

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
