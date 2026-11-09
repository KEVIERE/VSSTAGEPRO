// Testes da entrega do áudio em trechos (audioStreamer) ligada ao reprodutor de verdade.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { AudioStreamer, planChunks, PRIORITY_ON_AIR, PRIORITY_NEXT, CHUNK_FRAMES } from '../src/lib/audioStreamer.ts';

const SR = 48000;
const Q = 128;
const soundtouch = readFileSync(new URL('../src/lib/soundtouch.vendor.js', import.meta.url), 'utf8')
  .replace(/export\s*\{[^}]*\}\s*;?/g, '');
const processorSource = readFileSync(new URL('../src/lib/clipPlayerProcessor.js', import.meta.url), 'utf8');

function sandbox() {
  const sb = { currentTime: 0, sampleRate: SR, Float32Array, Int16Array, Math, Number, console };
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

/** Porta que entrega na hora ao processor, contando bytes como a thread de áudio receberia. */
function bridge(proc, log) {
  return {
    bytes: 0,
    postMessage(m) {
      if (m && m.left) this.bytes += m.left.byteLength;
      log?.push(m.type);
      proc.handleMessage(m);
    },
  };
}

// Um "tick" da thread principal: o teste controla quando o streamer volta a trabalhar.
function manualYield() {
  const waiters = [];
  return {
    yield: () => new Promise((r) => waiters.push(r)),
    async tick(n = 1) {
      for (let i = 0; i < n; i++) {
        const w = waiters.splice(0);
        w.forEach((r) => r());
        await new Promise((r) => setImmediate(r));
      }
    },
    get waiting() { return waiters.length; },
  };
}

test('planChunks começa no ponto pedido e depois volta ao começo, sem repetir trechos', () => {
  const plan = planChunks(1000, [[0, 100]], 600, 128);
  assert.deepEqual(plan[0], [600, 728]);
  const covered = new Array(1000).fill(0);
  for (const [s, e] of plan) for (let i = s; i < e; i++) covered[i]++;
  for (let i = 0; i < 1000; i++) assert.equal(covered[i], i < 100 ? 0 : 1);
  assert.deepEqual(planChunks(1000, [[0, 1000]], 0), []);
});

test('largada no meio do clipe: o trecho do ponto de largada já vai junto com os blocos', () => {
  const sb = sandbox();
  const total = SR * 60;
  const audio = { channels: [ramp(total), ramp(total, 3)], length: total };
  const proc = new sb.Proc({ processorOptions: { sampleRate: SR, totalFrames: total } });
  const y = manualYield();
  const st = new AudioStreamer(y.yield, 4 * 1024 * 1024);
  const from = SR * 45;
  st.start(bridge(proc), audio, { from, priority: PRIORITY_ON_AIR });
  proc.handleMessage({ type: 'seek', offsetSamples: from, startTime: 0, fadeInFrames: 1 });
  const L = new Float32Array(Q); const R = new Float32Array(Q);
  proc.process([], [[L, R]]);
  assert.ok(Math.abs(L[10] - (((from + 10) % 30000) + 1) / 32767) < 1e-6, 'toca na hora, sem esperar o resto');
  assert.ok(!proc.port.messages.some((m) => m.type === 'underrun'));
});

test('o áudio inteiro chega em trechos e o reprodutor avisa quando completou', async () => {
  const sb = sandbox();
  const total = SR * 30;
  const audio = { channels: [ramp(total)], length: total };
  const proc = new sb.Proc({ processorOptions: { sampleRate: SR, totalFrames: total } });
  const y = manualYield();
  const st = new AudioStreamer(y.yield, 2 * 1024 * 1024);
  const port = bridge(proc);
  const h = st.start(port, audio, { from: 0, priority: PRIORITY_ON_AIR });
  let ticks = 0;
  while (!h.finished && ticks < 1000) { await y.tick(); ticks++; }
  assert.ok(h.finished);
  assert.ok(proc.port.messages.some((m) => m.type === 'loaded'));
  // nenhum trecho foi mandado duas vezes: só o total do arquivo atravessou a ponte (+ o bloco inicial)
  assert.ok(port.bytes <= total * 2 * 2 + 1, `bytes enviados ${port.bytes}`);
  for (const i of [0, 12345, total - 1]) assert.equal(proc.data.left[i], audio.channels[0][i]);
});

test('a música no ar termina de chegar antes da próxima começar a ocupar a ponte', async () => {
  const sb = sandbox();
  const total = SR * 20;
  const y = manualYield();
  const st = new AudioStreamer(y.yield, 1024 * 1024);
  const order = [];
  const mk = (name, priority) => {
    const proc = new sb.Proc({ processorOptions: { sampleRate: SR, totalFrames: total } });
    const port = { postMessage(m) { if (m.type === 'append') order.push(name); proc.handleMessage(m); } };
    return st.start(port, { channels: [ramp(total)], length: total }, { from: 0, priority });
  };
  // próxima música (2 faixas) pedida antes; a do ar (3 faixas) chega depois e passa na frente
  const next = [mk('next-a', PRIORITY_NEXT), mk('next-b', PRIORITY_NEXT)];
  await y.tick();
  const air = [mk('air-a', PRIORITY_ON_AIR), mk('air-b', PRIORITY_ON_AIR), mk('air-c', PRIORITY_ON_AIR)];
  let guard = 0;
  while (!air.every((h) => h.finished) && guard++ < 2000) await y.tick();
  const firstAir = order.findIndex((n) => n.startsWith('air'));
  const lastAir = order.lastIndexOf('air-c');
  const nextDuringAir = order.slice(firstAir, lastAir).filter((n) => n.startsWith('next')).length;
  assert.equal(nextDuringAir, 0, 'nenhum trecho da próxima no meio da música no ar');
  // dentro da mesma prioridade, as faixas avançam juntas
  const counts = { 'air-a': 0, 'air-b': 0, 'air-c': 0 };
  for (const n of order.slice(firstAir, firstAir + 30)) if (n in counts) counts[n]++;
  assert.ok(Math.max(...Object.values(counts)) - Math.min(...Object.values(counts)) <= 1);
  while (!next.every((h) => h.finished) && guard++ < 4000) await y.tick();
  assert.ok(next.every((h) => h.finished));
});

test('cancelar (troca rápida de música) para de enviar na hora', async () => {
  const sb = sandbox();
  const total = SR * 30;
  const y = manualYield();
  const st = new AudioStreamer(y.yield, 512 * 1024);
  const proc = new sb.Proc({ processorOptions: { sampleRate: SR, totalFrames: total } });
  const port = bridge(proc);
  const h = st.start(port, { channels: [ramp(total)], length: total }, { from: 0, priority: PRIORITY_ON_AIR });
  await y.tick(2);
  const sent = port.bytes;
  h.cancel();
  await y.tick(5);
  assert.equal(port.bytes, sent);
  assert.equal(st.pending(), 0);
  await h.done;
});

test('busca durante a entrega: o novo ponto passa a ser enviado primeiro', async () => {
  const sb = sandbox();
  const total = SR * 120;
  const y = manualYield();
  const st = new AudioStreamer(y.yield, 256 * 1024);
  const proc = new sb.Proc({ processorOptions: { sampleRate: SR, totalFrames: total } });
  const offsets = [];
  const port = { postMessage(m) { if (m.type === 'append') offsets.push(m.offset); proc.handleMessage(m); } };
  const h = st.start(port, { channels: [ramp(total)], length: total }, { from: 0, priority: PRIORITY_ON_AIR });
  await y.tick(1);
  const target = SR * 100;
  h.focus(target);
  const before = offsets.length;
  await y.tick(1);
  assert.ok(offsets[before] >= target - CHUNK_FRAMES && offsets[before] <= target, `primeiro trecho após a busca: ${offsets[before]}`);
});

test('show grande: 20 músicas × 12 faixas, só a do ar e a próxima ocupam o reprodutor', async () => {
  // Simula o tamanho do show real (≈ 20 músicas, 225 clipes) com faixas de 4 min em 48 kHz.
  // Mede quanto tempo de CPU a entrega leva para deixar a música no ar completa.
  const sb = sandbox();
  const total = SR * 240;
  const y = manualYield();
  const st = new AudioStreamer(y.yield);
  const shared = ramp(total); // mesma fonte para não estourar a memória do teste
  const mkSong = (priority) => Array.from({ length: 12 }, () => {
    const proc = new sb.Proc({ processorOptions: { sampleRate: SR, totalFrames: total } });
    return st.start(bridge(proc), { channels: [shared, shared], length: total }, { from: 0, priority });
  });
  const t0 = performance.now();
  const air = mkSong(PRIORITY_ON_AIR);
  const next = mkSong(PRIORITY_NEXT);
  let ticks = 0;
  while (!air.every((h) => h.finished) && ticks < 100000) { await y.tick(); ticks++; }
  const airMs = performance.now() - t0;
  while (!next.every((h) => h.finished) && ticks < 200000) { await y.tick(); ticks++; }
  const allMs = performance.now() - t0;
  console.log(`[medida] música no ar completa (12 faixas × 4 min): ${airMs.toFixed(0)} ms de CPU em ${ticks} fatias; +próxima: ${allMs.toFixed(0)} ms`);
  assert.ok(air.every((h) => h.finished) && next.every((h) => h.finished));
  // cada fatia de trabalho é curta: a tela e o som não ficam presos esperando
  assert.ok(airMs / ticks < 50, 'fatia média abaixo de 50 ms');
});
