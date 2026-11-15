// Ritmo da leitura de baixa prioridade (próxima/selecionada) enquanto há música no ar: uma leitura
// por vez e teto de bytes por segundo, para não despejar 'append' em rajada na thread de áudio.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DiskStreamer, PRIORITY_ON_AIR, PRIORITY_NEXT } from '../src/lib/audioStreamer.ts';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function reader(total, stats, delayMs = 1) {
  return {
    sampleRate: 48000, length: total, channelCount: 2,
    async read(s, n) {
      stats.inFlight++;
      stats.max = Math.max(stats.max, stats.inFlight);
      stats.reads++;
      await sleep(delayMs);
      stats.inFlight--;
      return [new Int16Array(n), new Int16Array(n)];
    },
  };
}
const port = () => ({ messages: 0, postMessage() { this.messages++; } });

test('ritmo: com música tocando, a próxima lê uma de cada vez e respeita o teto de bytes', async () => {
  const chunk = 1024; // 1024 quadros × 2 canais × 2 bytes = 4 KB por leitura
  const ds = new DiskStreamer({ chunkFrames: chunk, lowBytesPerSec: 200 * 1024 }); // ~50 leituras/s
  ds.setPacing(() => true);
  const stats = { inFlight: 0, max: 0, reads: 0 };
  const t0 = performance.now();
  const handles = [0, 1, 2].map(() => ds.start(port(), reader(chunk * 5, stats), { from: 0, priority: PRIORITY_NEXT }));
  await Promise.all(handles.map((h) => h.done));
  const ms = performance.now() - t0;
  assert.equal(stats.reads, 15);
  assert.equal(stats.max, 1, 'uma leitura de baixa prioridade por vez');
  // 15 leituras a ~20 ms cada: a primeira sai na hora, as outras 14 esperam a vez
  assert.ok(ms >= 14 * 20 * 0.8, `respeitou o teto (${ms.toFixed(0)} ms)`);
});

test('ritmo: parado (nada tocando), a próxima lê na velocidade do disco', async () => {
  const chunk = 1024;
  const ds = new DiskStreamer({ chunkFrames: chunk, lowBytesPerSec: 200 * 1024 });
  ds.setPacing(() => false);
  const stats = { inFlight: 0, max: 0, reads: 0 };
  const t0 = performance.now();
  const handles = [0, 1, 2].map(() => ds.start(port(), reader(chunk * 5, stats), { from: 0, priority: PRIORITY_NEXT }));
  await Promise.all(handles.map((h) => h.done));
  assert.ok(stats.max > 1, 'leituras em paralelo');
  assert.ok(performance.now() - t0 < 14 * 20 * 0.8, 'sem a espera do teto');
});

test('ritmo: a música no ar nunca é contida e passa na frente da próxima', async () => {
  const chunk = 1024;
  const ds = new DiskStreamer({ chunkFrames: chunk, lowBytesPerSec: 50 * 1024 });
  ds.setPacing(() => true);
  const low = { inFlight: 0, max: 0, reads: 0 };
  const air = { inFlight: 0, max: 0, reads: 0 };
  const next = ds.start(port(), reader(chunk * 40, low), { from: 0, priority: PRIORITY_NEXT });
  await sleep(5);
  const t0 = performance.now();
  const onAir = ds.start(port(), reader(chunk * 30, air), { from: 0, priority: PRIORITY_ON_AIR });
  await onAir.done;
  const ms = performance.now() - t0;
  assert.ok(air.max > 1, 'no ar lê em paralelo');
  assert.ok(ms < 30 * 80 * 0.5, `no ar sem o teto da próxima (${ms.toFixed(0)} ms)`);
  next.cancel();
});

test('ritmo: ao virar música no ar (focus), a leitura que estava contida acelera', async () => {
  const chunk = 1024;
  const ds = new DiskStreamer({ chunkFrames: chunk, lowBytesPerSec: 20 * 1024 }); // ~5 leituras/s
  ds.setPacing(() => true);
  const stats = { inFlight: 0, max: 0, reads: 0 };
  const h = ds.start(port(), reader(chunk * 30, stats), { from: 0, priority: PRIORITY_NEXT });
  await sleep(30);
  const before = stats.reads;
  h.focus(0, PRIORITY_ON_AIR);
  await h.done;
  assert.ok(before <= 2, `contida antes (${before})`);
  assert.equal(stats.reads, 30);
});
