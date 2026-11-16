// Entrega em pedaços pequenos para a música fora do ar, janela da largada maior e reprodutor sem
// alocar memória a cada bloco de som (coleta de lixo na thread de áudio dava engasgo).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import {
  AudioStreamer, DiskStreamer, PRIORITY_ON_AIR, PRIORITY_NEXT, CHUNK_FRAMES, LOW_PIECE_FRAMES, WINDOW_FRAMES,
} from '../src/lib/audioStreamer.ts';

const SR = 48000;
const Q = 128;
const soundtouch = readFileSync(new URL('../src/lib/soundtouch.vendor.js', import.meta.url), 'utf8')
  .replace(/export\s*\{[^}]*\}\s*;?/g, '');
const processorSource = readFileSync(new URL('../src/lib/clipPlayerProcessor.js', import.meta.url), 'utf8');

// Uma amostra da tabela de pedaços do reprodutor (canal 0 esquerdo, 1 direito).
const sampleOf = (data, i, ch = 0) => { const slots = ch ? data.right : data.left; const s = slots[Math.floor(i / data.slotFrames)]; return s ? s[i % data.slotFrames] : 0; };

// Float32Array que conta quantos foram criados dentro do reprodutor.
function sandbox() {
  const counter = { n: 0 };
  class CountingF32 extends Float32Array {
    constructor(...a) { super(...a); counter.n++; }
  }
  const sb = { currentTime: 0, sampleRate: SR, Float32Array: CountingF32, Int16Array, Math, Number, console, counter };
  sb.AudioWorkletProcessor = class {
    constructor() {
      const messages = [];
      this.port = { onmessage: null, postMessage: (m) => messages.push(m), messages };
    }
  };
  sb.registerProcessor = (_n, cls) => { sb.Proc = cls; };
  vm.createContext(sb);
  vm.runInContext(soundtouch + '\n' + processorSource, sb);
  return sb;
}

function ramp(frames, seed = 0) {
  const a = new Int16Array(frames);
  for (let i = 0; i < frames; i++) a[i] = ((i + seed) % 30000) + 1;
  return a;
}

function manualYield() {
  const waiters = [];
  return {
    yield: () => new Promise((r) => waiters.push(r)),
    async tick(n = 1) {
      for (let i = 0; i < n; i++) {
        waiters.splice(0).forEach((r) => r());
        await new Promise((r) => setImmediate(r));
      }
    },
  };
}

test('janela da largada cobre ~5 s a 48 kHz', () => {
  assert.ok(WINDOW_FRAMES / SR >= 5, `${(WINDOW_FRAMES / SR).toFixed(2)} s`);
});

test('memória: música fora do ar vai em pedaços pequenos, um por vez; a do ar em trechos cheios', async () => {
  const sb = sandbox();
  const total = SR * 20;
  const y = manualYield();
  const st = new AudioStreamer(y.yield);
  const mk = (priority, log) => {
    const proc = new sb.Proc({ processorOptions: { sampleRate: SR, totalFrames: total } });
    const port = { postMessage(m) { if (m.type === 'append') log.push(m); proc.handleMessage(m); } };
    return { proc, h: st.start(port, { channels: [ramp(total), ramp(total, 5)], length: total }, { from: 0, priority }) };
  };
  const nextLog = [];
  const next = mk(PRIORITY_NEXT, nextLog);
  // um pedaço por fatia de trabalho
  const perTick = [];
  let guard = 0;
  while (!next.h.finished && guard++ < 5000) {
    const before = nextLog.length;
    await y.tick();
    perTick.push(nextLog.length - before);
  }
  assert.ok(next.h.finished);
  assert.ok(nextLog.every((m) => m.left.length <= LOW_PIECE_FRAMES), 'nenhum append maior que o pedaço');
  assert.ok(Math.max(...perTick) <= 1, 'no máximo um append por fatia');
  assert.ok(next.proc.port.messages.some((m) => m.type === 'loaded'));
  for (const i of [0, WINDOW_FRAMES + 3, total - 1]) {
    assert.equal(sampleOf(next.proc.data, i), ((i % 30000) + 1));
    assert.equal(sampleOf(next.proc.data, i, 1), (((i + 5) % 30000) + 1));
  }

  const airLog = [];
  const air = mk(PRIORITY_ON_AIR, airLog);
  guard = 0;
  while (!air.h.finished && guard++ < 5000) await y.tick();
  assert.ok(airLog.some((m) => m.left.length === CHUNK_FRAMES), 'no ar continua em trechos cheios');
});

test('música fora do ar vira a do ar (focus): volta aos trechos cheios', async () => {
  const sb = sandbox();
  const total = SR * 30;
  const y = manualYield();
  const st = new AudioStreamer(y.yield);
  const proc = new sb.Proc({ processorOptions: { sampleRate: SR, totalFrames: total } });
  const log = [];
  const port = { postMessage(m) { if (m.type === 'append') log.push(m); proc.handleMessage(m); } };
  const h = st.start(port, { channels: [ramp(total)], length: total }, { from: 0, priority: PRIORITY_NEXT });
  await y.tick(3);
  assert.ok(log.every((m) => m.left.length <= LOW_PIECE_FRAMES));
  h.focus(SR * 10, PRIORITY_ON_AIR);
  const before = log.length;
  await y.tick(1);
  assert.ok(log.slice(before).some((m) => m.left.length === CHUNK_FRAMES));
  let guard = 0;
  while (!h.finished && guard++ < 5000) await y.tick();
  assert.ok(proc.port.messages.some((m) => m.type === 'loaded'));
});

function diskReader(total) {
  return {
    sampleRate: SR, length: total, channelCount: 2,
    async read(s, n) {
      await new Promise((r) => setTimeout(r, 1));
      const l = new Int16Array(n); const r = new Int16Array(n);
      for (let i = 0; i < n; i++) { l[i] = ((s + i) % 30000) + 1; r[i] = -l[i]; }
      return [l, r];
    },
  };
}

test('disco: com música tocando, a próxima entrega cada leitura em pedaços contíguos', async () => {
  const sb = sandbox();
  const total = 1 << 18;
  const ds = new DiskStreamer();
  // teto de bytes alto só para o teste não esperar; o ritmo (e os pedaços) ficam ligados
  const ds2 = new DiskStreamer({ lowBytesPerSec: 1024 * 1024 * 1024 });
  ds2.setPacing(() => true);
  for (const [streamer, priority, maxLen] of [[ds2, PRIORITY_NEXT, LOW_PIECE_FRAMES], [ds, PRIORITY_ON_AIR, 1 << 16]]) {
    const proc = new sb.Proc({ processorOptions: { sampleRate: SR, totalFrames: total } });
    const log = [];
    const h = streamer.start({ postMessage(m) { if (m.type === 'append') log.push(m); proc.handleMessage(m); } }, diskReader(total), { from: 0, priority });
    await h.done;
    assert.ok(!h.failed);
    assert.ok(log.every((m) => m.left.length <= maxLen));
    assert.ok(log.some((m) => m.left.length === maxLen));
    assert.ok(proc.port.messages.some((m) => m.type === 'loaded'));
    for (const i of [0, LOW_PIECE_FRAMES - 1, LOW_PIECE_FRAMES, total - 1]) {
      assert.equal(sampleOf(proc.data, i), ((i % 30000) + 1));
      assert.equal(sampleOf(proc.data, i, 1), -((i % 30000) + 1));
    }
  }
});

test('disco: cancelar no meio dos pedaços para de enviar', async () => {
  const total = 1 << 16;
  let release;
  const gate = new Promise((r) => { release = r; });
  const ds = new DiskStreamer({ lowBytesPerSec: 1024 * 1024 * 1024, yieldBetween: () => gate });
  ds.setPacing(() => true);
  const log = [];
  const h = ds.start({ postMessage(m) { if (m.type === 'append') log.push(m); } }, diskReader(total), { from: 0, priority: PRIORITY_NEXT });
  while (log.length === 0) await new Promise((r) => setTimeout(r, 1));
  h.cancel();
  release();
  await h.done;
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(log.length, 1);
});

test('reprodutor: saída mono e áudio chegando em trechos não criam Float32Array a cada bloco', () => {
  const sb = sandbox();
  const total = SR * 4;
  const full = ramp(total);
  const proc = new sb.Proc({ processorOptions: { sampleRate: SR, totalFrames: total } });
  const blocks = new Int16Array(total);
  proc.handleMessage({ type: 'stream', left: blocks, right: blocks, total, ranges: [] });
  // trechos fora de ordem e com buracos: a lista de trechos tem vários itens
  for (let s = 0; s < total; s += 4800 * 2) proc.handleMessage({ type: 'append', offset: s, left: full.slice(s, s + 4800), right: full.slice(s, s + 4800) });
  proc.handleMessage({ type: 'seek', offsetSamples: 0, startTime: 0, fadeInFrames: 1 });
  const out = new Float32Array(Q);
  // aquece
  for (let q = 0; q < 10; q++) { proc.process([], [[out]]); sb.currentTime += Q / SR; }
  const before = sb.counter.n;
  for (let q = 0; q < 500; q++) { proc.process([], [[out]]); sb.currentTime += Q / SR; }
  assert.equal(sb.counter.n - before, 0, 'nenhum Float32Array novo no caminho do som');
  // e o som está certo onde há dado
  proc.handleMessage({ type: 'seek', offsetSamples: 100, startTime: sb.currentTime, fadeInFrames: 1 });
  proc.process([], [[out]]);
  assert.ok(Math.abs(out[10] - ((110 % 30000) + 1) / 32767) < 1e-6);
});

test('reprodutor: trechos fora de ordem se juntam e o aviso de completo sai uma vez', () => {
  const sb = sandbox();
  const total = 1000;
  const full = ramp(total);
  const proc = new sb.Proc({ processorOptions: { sampleRate: SR, totalFrames: total } });
  proc.handleMessage({ type: 'stream', left: new Int16Array(total), right: null, total, ranges: [[400, 500]] });
  const add = (s, e) => proc.handleMessage({ type: 'append', offset: s, left: full.slice(s, e) });
  add(800, 900); add(100, 200); add(600, 700);
  assert.equal(JSON.stringify(proc.data.ranges), JSON.stringify([[100, 200], [400, 500], [600, 700], [800, 900]]));
  add(150, 650); // engole dois e encosta no terceiro
  assert.equal(JSON.stringify(proc.data.ranges), JSON.stringify([[100, 700], [800, 900]]));
  add(700, 800); // encosta nos dois lados
  assert.equal(JSON.stringify(proc.data.ranges), JSON.stringify([[100, 900]]));
  add(900, 1000);
  assert.ok(!proc.port.messages.some((m) => m.type === 'loaded'));
  add(0, 100);
  assert.equal(JSON.stringify(proc.data.ranges), JSON.stringify([[0, 1000]]));
  assert.equal(proc.port.messages.filter((m) => m.type === 'loaded').length, 1);
  for (let i = 0; i < total; i++) assert.equal(sampleOf(proc.data, i), full[i]);
});

test('reprodutor: aviso de falta de dado traz posição, folga e buraco (e mantém frame)', () => {
  const sb = sandbox();
  const total = SR;
  const full = ramp(total);
  const blocks = new Int16Array(total);
  const proc = new sb.Proc({ processorOptions: { sampleRate: SR, totalFrames: total } });
  proc.handleMessage({ type: 'stream', left: blocks, right: blocks, total, ranges: [] });
  proc.handleMessage({ type: 'append', offset: 0, left: full.slice(0, 1000), right: full.slice(0, 1000) });
  proc.handleMessage({ type: 'append', offset: 3000, left: full.slice(3000), right: full.slice(3000) });
  proc.handleMessage({ type: 'seek', offsetSamples: 0, startTime: 0, fadeInFrames: 1 });
  const L = new Float32Array(Q); const R = new Float32Array(Q);
  for (let q = 0; q < 10; q++) { proc.process([], [[L, R]]); sb.currentTime += Q / SR; }
  const u = proc.port.messages.find((m) => m.type === 'underrun');
  assert.ok(u, 'avisou');
  // o bloco começou em 896 (7 × 128): havia 104 quadros à frente antes do buraco em 1000
  assert.equal(u.ahead, 1000 - 896);
  assert.equal(u.position, 1024);
  assert.equal(u.frame, 1024);
  assert.equal(u.gap, 3000 - 1024);
  assert.equal(typeof u.time, 'number');
});
