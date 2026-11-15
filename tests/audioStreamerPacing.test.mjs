// Música em memória fora do ar: pedaços pequenos e teto de bytes/s só com música tocando
// (setPacing), como o DiskStreamer; parado, trechos grandes no orçamento da fatia.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AudioStreamer, PRIORITY_ON_AIR, PRIORITY_NEXT, CHUNK_FRAMES, LOW_PIECE_FRAMES } from '../src/lib/audioStreamer.ts';

const fastYield = () => new Promise((r) => setImmediate(r));

function mono(frames) {
  const a = new Int16Array(frames);
  for (let i = 0; i < frames; i++) a[i] = (i % 30000) + 1;
  return { channels: [a], length: frames };
}

function collect() {
  const log = [];
  return { log, port: { postMessage(m) { if (m.type === 'append') log.push({ ...m, at: performance.now() }); } } };
}

test('parado (setPacing false): próxima vai em trechos grandes, várias por fatia', async () => {
  const st = new AudioStreamer(fastYield, 8 * 1024 * 1024, { lowBytesPerSec: 1024 });
  st.setPacing(() => false);
  const { log, port } = collect();
  const h = st.start(port, mono(CHUNK_FRAMES * 8), { from: 0, priority: PRIORITY_NEXT, window: 0 });
  const t0 = performance.now();
  await h.done;
  assert.ok(log.some((m) => m.left.length === CHUNK_FRAMES), 'trecho cheio');
  // teto de 1 KB/s seria eterno: parado ele não vale
  assert.ok(performance.now() - t0 < 1000);
});

test('tocando: próxima respeita o teto de bytes/s em pedaços pequenos', async () => {
  // 32 KB por pedaço (mono 16k quadros) a 3,2 MB/s = 10 ms por pedaço
  const st = new AudioStreamer(fastYield, 8 * 1024 * 1024, { lowBytesPerSec: 3.2 * 1024 * 1024 });
  st.setPacing(() => true);
  const { log, port } = collect();
  const h = st.start(port, mono(LOW_PIECE_FRAMES * 10), { from: 0, priority: PRIORITY_NEXT, window: 0 });
  await h.done;
  assert.ok(log.every((m) => m.left.length <= LOW_PIECE_FRAMES));
  const span = log[log.length - 1].at - log[0].at;
  assert.ok(span >= 70, `10 pedaços espaçados pelo teto: ${span.toFixed(0)} ms`);
});

test('tocando: a música no ar não espera o teto da próxima', async () => {
  const st = new AudioStreamer(fastYield, 8 * 1024 * 1024, { lowBytesPerSec: 64 * 1024 }); // ~0,5 s por pedaço
  st.setPacing(() => true);
  const next = collect();
  const hn = st.start(next.port, mono(LOW_PIECE_FRAMES * 4), { from: 0, priority: PRIORITY_NEXT, window: 0 });
  while (next.log.length === 0) await fastYield();
  // agora o laço está dormindo no teto; a do ar chega e acorda na hora
  const air = collect();
  const t0 = performance.now();
  const ha = st.start(air.port, mono(CHUNK_FRAMES * 4), { from: 0, priority: PRIORITY_ON_AIR, window: 0 });
  await ha.done;
  assert.ok(performance.now() - t0 < 200, 'do ar entregue sem esperar a pausa da próxima');
  assert.ok(air.log.some((m) => m.left.length === CHUNK_FRAMES));
  hn.cancel();
  await hn.done;
  assert.equal(st.pending(), 0);
});

test('setPacing: começa tocando e para no meio: o resto sai em trechos grandes', async () => {
  let playing = true;
  const st = new AudioStreamer(fastYield, 8 * 1024 * 1024, { lowBytesPerSec: 64 * 1024 });
  st.setPacing(() => playing);
  const { log, port } = collect();
  const h = st.start(port, mono(CHUNK_FRAMES * 6), { from: 0, priority: PRIORITY_NEXT, window: 0 });
  while (log.length === 0) await fastYield();
  assert.ok(log[0].left.length <= LOW_PIECE_FRAMES);
  playing = false;
  const t0 = performance.now();
  await h.done;
  assert.ok(performance.now() - t0 < 1500, 'parado não segue o teto');
  assert.ok(log.some((m) => m.left.length === CHUNK_FRAMES));
});
