// Correções do cache do timecode (LTC) e do relógio do LUFS: a selecionada e a próxima não se
// expulsam do cache, o Stop solta a vaga do LTC tocado, o preparo de música que o operador só
// passou para no meio, o projeto novo solta o LTC do anterior e o LUFS volta a medir depois de
// recriar o contexto. Rodar com: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (...p) => fs.readFileSync(path.join(here, '..', ...p), 'utf8');
const engine = read('src', 'lib', 'audioEngine.ts');

let buffersBuilt = 0;
class FakeAudioBuffer {
  constructor({ length, numberOfChannels, sampleRate }) {
    buffersBuilt++;
    this.length = length;
    this.sampleRate = sampleRate;
    this.numberOfChannels = numberOfChannels;
    this.duration = length / sampleRate;
    this.data = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }
  getChannelData(c) { return this.data[c]; }
}
globalThis.AudioBuffer = FakeAudioBuffer;

function fakeCtx() {
  return {
    currentTime: 0,
    createBufferSource() {
      return {
        buffer: null,
        playbackRate: { value: 1, setValueAtTime() {} },
        connect() {},
        disconnect() {},
        start() {},
        stop() {},
      };
    },
  };
}

const { TimecodePlayer } = await import('../src/lib/timecodePlayer.ts');

function ltc(seconds, rate = 48000) {
  const length = Math.round(seconds * rate);
  return { channels: [new Int16Array(length)], sampleRate: rate, length };
}

// Play sem conversão na hora: true se o LTC já estava montado.
function playsWithoutBuild(p, id, audio, at = 1) {
  const n = buffersBuilt;
  p.start(id, audio, 0, at);
  return buffersBuilt === n;
}

test('selecionada e próxima retidas: o preparo da próxima não expulsa o LTC da selecionada', async () => {
  const p = new TimecodePlayer(fakeCtx(), {});
  const z = ltc(0.2);
  const x = ltc(0.3);
  const y = ltc(0.4);
  p.start('z', z, 0, 0.05);
  p.stop();
  p.retain(['x', 'y']);
  await p.preload('x', x);
  await p.preload('y', y);
  assert.ok(playsWithoutBuild(p, 'x', x), 'a selecionada continua montada');
  assert.ok(playsWithoutBuild(p, 'y', y, 2), 'a próxima também');
});

test('Stop solta a vaga do LTC tocado (sem lista de retidas)', async () => {
  const p = new TimecodePlayer(fakeCtx(), {});
  const c = ltc(0.2);
  const a = ltc(0.3);
  const b = ltc(0.4);
  p.start('c', c, 0, 0.05);
  p.stop();
  await p.preload('a', a);
  await p.preload('b', b);
  assert.ok(playsWithoutBuild(p, 'a', a), 'o LTC da última tocada saiu, não o da selecionada');
});

test('retain apaga na hora o que saiu da lista, menos o do ar', async () => {
  const p = new TimecodePlayer(fakeCtx(), {});
  const air = ltc(0.2);
  const old = ltc(0.3);
  p.start('air', air, 0, 0.05);
  await p.preload('old', old);
  p.retain([]);
  assert.ok(playsWithoutBuild(p, 'air', air), 'o do ar fica');
  p.stop();
  assert.ok(!playsWithoutBuild(p, 'old', old, 2), 'o que saiu da lista foi apagado');
});

test('preparo de música que saiu da lista para no meio e não fica no cache', async () => {
  const p = new TimecodePlayer(fakeCtx(), {});
  const long = ltc(12); // várias fatias de conversão
  p.retain(['long']);
  const task = p.preload('long', long);
  p.retain([]); // o operador passou para outra música
  await task;
  assert.ok(!playsWithoutBuild(p, 'long', long), 'nada ficou montado');
});

test('acerto de cache renova a ordem: o pedido por último não é o primeiro a sair', async () => {
  const p = new TimecodePlayer(fakeCtx(), {});
  const a = ltc(0.2);
  const b = ltc(0.3);
  const c = ltc(0.4);
  await p.preload('a', a);
  await p.preload('b', b);
  await p.preload('a', a); // pedido de novo
  await p.preload('c', c);
  assert.ok(playsWithoutBuild(p, 'a', a), 'o pedido por último continua montado');
  p.stop();
  assert.ok(!playsWithoutBuild(p, 'b', b, 2), 'saiu o mais antigo');
});

test('motor: LTC retido pela lista, preparo conferido depois de abrir, projeto novo solta o LTC', () => {
  assert.match(engine, /this\.wanted = keep;[\s\S]{0,200}this\.retainTimecodes\(\);\n\s+\}/, 'releaseUnretained retém os LTCs');
  assert.match(engine, /this\.timecode = new TimecodePlayer\(ctx, channel\.gain\);\n\s+this\.retainTimecodes\(\);/, 'player novo recebe a lista');
  assert.match(engine, /if \(!audio \|\| !this\.isWanted\(songId\) \|\| this\.timecodeClip\(songId\)\?\.id !== clip\.id/, 'confere de novo depois de abrir o arquivo');
  const cleared = engine.slice(engine.indexOf('onAudioLibraryCleared(() => {'), engine.indexOf('useStore.subscribe((s, prev) => {'));
  assert.match(cleared, /this\.timecode\?\.dispose\(\);\n\s+this\.timecode = null;/, 'projeto novo solta o LTC montado');
});

test('LUFS: o relógio da última leitura volta junto com a janela quando o contexto é recriado', () => {
  const ctx = engine.slice(engine.indexOf('getContext(): AudioContext {'), engine.indexOf('isStableMode(): boolean {'));
  assert.match(ctx, /this\.loudness\.clear\(\);\n\s+this\.loudLastAt = -Infinity;/);
  const conn = engine.slice(engine.indexOf('private connectLoudness('), engine.indexOf('getMasterLoudness():'));
  assert.match(conn, /this\.loudness\.clear\(\);\n\s+this\.loudLastAt = -Infinity;/);
  assert.match(engine, /if \(now < this\.loudLastAt\) this\.loudLastAt = -Infinity;\n\s+if \(now - this\.loudLastAt >= 0\.04\)/);
});
