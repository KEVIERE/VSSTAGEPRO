// Abrir o Modo Show sem travar: a playlist não é desmontada na troca, os pads só abrem a saída
// depois da primeira pintura e o mixer do show nasce na última escala medida.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { afterPaint } from '../src/lib/afterPaint.ts';

const read = (p) => fs.readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');

test('afterPaint roda depois (sem requestIdleCallback cai no setTimeout) e não roda se cancelado', async () => {
  let ran = 0;
  afterPaint(() => { ran++; }, 300);
  assert.equal(ran, 0, 'não roda no mesmo quadro');
  const cancel = afterPaint(() => { ran += 10; }, 300);
  cancel();
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(ran, 1);
});

test('afterPaint usa requestIdleCallback com o limite de tempo quando existe', () => {
  const calls = [];
  globalThis.requestIdleCallback = (cb, opts) => { calls.push(opts); return 7; };
  globalThis.cancelIdleCallback = (id) => calls.push({ cancel: id });
  try {
    const cancel = afterPaint(() => {}, 250);
    cancel();
    assert.deepEqual(calls, [{ timeout: 250 }, { cancel: 7 }]);
  } finally {
    delete globalThis.requestIdleCallback;
    delete globalThis.cancelIdleCallback;
  }
});

test('a playlist fica na mesma posição da árvore nos dois modos', () => {
  const app = read('App.tsx');
  assert.match(app, /className=\{playlistMaximized \? 'flex flex-col flex-1 min-w-0 min-h-0' : 'contents'\}/);
  assert.match(app, /\{\(playlistMaximized \|\| playlistVisible\) && <PlaylistPanel /);
  assert.equal(app.match(/<PlaylistPanel /g).length, 1, 'um PlaylistPanel só');
});

test('os pads se preparam depois da pintura, e o toque continua abrindo a saída na hora', () => {
  const pads = read('components/SamplePadPanel.tsx');
  assert.match(pads, /afterPaint\(\(\) => \{ armed = true; keepPadsReady\(true\); \}\)/);
  assert.match(pads, /if \(armed\) keepPadsReady\(false\)/);
  const player = read('lib/padPlayer.ts');
  assert.match(player, /const o = padOut\(\);\s*if \(o\.ctx\.state !== 'running'\) void o\.ctx\.resume\(\);/);
});

test('o mixer do Modo Show nasce na última escala medida', () => {
  const mixer = read('components/MixerPanel.tsx');
  assert.match(mixer, /useState<\{ scale: number; w: number \} \| null>\(\(\) => \(fit && mixerVisible \? lastFitBox : null\)\)/);
  assert.match(mixer, /lastFitBox = next;/);
});
