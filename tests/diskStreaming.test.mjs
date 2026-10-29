// Leitura do disco em trechos: o WAV lido aos pedaços (inclusive com conversão de taxa) tem de
// ser idêntico ao lido inteiro, e o leitor antecipado tem de lidar com disco lento, falha,
// cancelamento e busca.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { DiskStreamer, PRIORITY_ON_AIR, PRIORITY_NEXT } from '../src/lib/audioStreamer.ts';

// ---------- leitor de WAV (o mesmo código do worker) ----------
const replies = [];
globalThis.self = { postMessage: (m) => replies.push(m) };
await import('../src/workers/wavReader.worker.ts');
const onmessage = globalThis.self.onmessage;

function wavBlob({ rate, channels, bits, frames }) {
  const block = channels * (bits / 8);
  const buf = new ArrayBuffer(44 + frames * block);
  const v = new DataView(buf);
  const w = (o, t) => { for (let i = 0; i < 4; i++) v.setUint8(o + i, t.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + frames * block, true); w(8, 'WAVE');
  w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, channels, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * block, true); v.setUint16(32, block, true); v.setUint16(34, bits, true);
  w(36, 'data'); v.setUint32(40, frames * block, true);
  let p = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      const x = Math.sin((2 * Math.PI * (330 + c * 110) * i) / rate) * 0.6 + Math.sin(i * 0.37) * 0.05;
      if (bits === 16) { v.setInt16(p, Math.round(x * 32767), true); p += 2; }
      else { const s = Math.round(x * 8388607); v.setUint8(p, s & 255); v.setUint8(p + 1, (s >> 8) & 255); v.setUint8(p + 2, (s >> 16) & 255); p += 3; }
    }
  }
  return new Blob([buf]);
}

async function ask(msg) {
  replies.length = 0;
  await onmessage({ data: { id: 1, probeOnly: false, maxFrames: 0, ...msg } });
  return replies[0];
}

for (const fmt of [
  { rate: 48000, channels: 2, bits: 24, label: 'WAV 48 kHz 24 bits' },
  { rate: 44100, channels: 2, bits: 24, label: 'WAV 44,1 kHz 24 bits (convertido para 48 kHz)' },
  { rate: 44100, channels: 1, bits: 16, label: 'WAV 44,1 kHz mono 16 bits' },
  { rate: 96000, channels: 2, bits: 16, label: 'WAV 96 kHz (convertido para 48 kHz)' },
]) {
  test(`${fmt.label}: lido em trechos = lido inteiro, amostra por amostra`, async () => {
    const blob = wavBlob({ ...fmt, frames: Math.round(fmt.rate * 3.3) });
    const full = await ask({ blob, targetRate: 48000 });
    assert.ok(full.ok);
    const total = full.totalFrames;
    const chunk = 30011; // tamanho "torto" de propósito: as bordas caem em qualquer fase do filtro
    for (let start = 0; start < total; start += chunk) {
      const part = await ask({ blob, targetRate: 48000, startFrame: start, maxFrames: chunk });
      assert.ok(part.ok);
      for (let c = 0; c < full.channels.length; c++) {
        const a = full.channels[c];
        const b = part.channels[c];
        assert.equal(b.length, Math.min(chunk, total - start));
        for (let i = 0; i < b.length; i++) {
          if (a[start + i] !== b[i]) assert.fail(`canal ${c}, quadro ${start + i}: ${b[i]} ≠ ${a[start + i]}`);
        }
      }
    }
  });
}

// ---------- leitor antecipado + reprodutor ----------
const SR = 48000;
const soundtouch = readFileSync(new URL('../src/lib/soundtouch.vendor.js', import.meta.url), 'utf8').replace(/export\s*\{[^}]*\}\s*;?/g, '');
const processorSource = readFileSync(new URL('../src/lib/clipPlayerProcessor.js', import.meta.url), 'utf8');
function processorClass() {
  const sb = { currentTime: 0, sampleRate: SR, Float32Array, Int16Array, Math, Number, console };
  sb.AudioWorkletProcessor = class { constructor() { const messages = []; this.port = { onmessage: null, postMessage: (m) => messages.push(m), messages }; } };
  sb.registerProcessor = (_n, cls) => { sb.Proc = cls; };
  vm.createContext(sb);
  vm.runInContext(soundtouch + '\n' + processorSource, sb);
  return sb.Proc;
}
const Proc = processorClass();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fakeReader(total, { delayMs = 0, failAt = -1, log } = {}) {
  const data = new Int16Array(total);
  for (let i = 0; i < total; i++) data[i] = (i % 30000) + 1;
  return {
    data,
    sampleRate: SR,
    length: total,
    channelCount: 1,
    async read(s, n) {
      log?.push(s);
      if (delayMs) await sleep(delayMs);
      if (failAt >= 0 && s <= failAt && failAt < s + n) throw new Error('disco');
      return [data.slice(s, s + n)];
    },
  };
}

test('leitor do disco: a faixa recebe tudo, começando pelo ponto de largada', async () => {
  const total = SR * 20;
  const reader = fakeReader(total);
  const log = [];
  reader.read = ((orig) => (s, n) => { log.push(s); return orig(s, n); })(reader.read.bind(reader));
  const proc = new Proc({ processorOptions: { sampleRate: SR, totalFrames: total } });
  const ds = new DiskStreamer({ concurrency: 1 });
  const from = SR * 12;
  const h = ds.start({ postMessage: (m) => proc.handleMessage(m) }, reader, { from, priority: PRIORITY_ON_AIR });
  assert.equal(await h.first, true);
  await h.done;
  assert.ok(log[0] >= from - (1 << 16) && log[0] <= from, 'primeira leitura no ponto de largada');
  assert.ok(proc.port.messages.some((m) => m.type === 'loaded'));
  for (const i of [0, from, total - 1]) assert.equal(proc.data.left[i], reader.data[i]);
});

test('leitor do disco: trecho já lido antes da troca vai junto e o play não espera o disco', async () => {
  const total = SR * 10;
  const reader = fakeReader(total, { delayMs: 30 });
  const proc = new Proc({ processorOptions: { sampleRate: SR, totalFrames: total } });
  const ds = new DiskStreamer();
  const initial = { start: SR * 2, channels: [reader.data.slice(SR * 2, SR * 2 + 65536)] };
  const h = ds.start({ postMessage: (m) => proc.handleMessage(m) }, reader, { from: SR * 2, priority: PRIORITY_ON_AIR, initial });
  proc.handleMessage({ type: 'seek', offsetSamples: SR * 2, startTime: 0, fadeInFrames: 1 });
  const L = new Float32Array(128); const R = new Float32Array(128);
  proc.process([], [[L, R]]);
  assert.ok(Math.abs(L[5] - reader.data[SR * 2 + 5] / 32767) < 1e-6, 'tocou na hora');
  assert.equal(await h.first, true);
  h.cancel();
});

test('leitor do disco: falha de leitura marca a faixa (o motor cai para o áudio aberto) sem travar as outras', async () => {
  const total = SR * 6;
  const ds = new DiskStreamer({ concurrency: 2 });
  const okProc = new Proc({ processorOptions: { sampleRate: SR, totalFrames: total } });
  const badProc = new Proc({ processorOptions: { sampleRate: SR, totalFrames: total } });
  const good = ds.start({ postMessage: (m) => okProc.handleMessage(m) }, fakeReader(total), { from: 0, priority: PRIORITY_ON_AIR });
  const bad = ds.start({ postMessage: (m) => badProc.handleMessage(m) }, fakeReader(total, { failAt: SR * 3 }), { from: 0, priority: PRIORITY_ON_AIR });
  await Promise.all([good.done, bad.done]);
  assert.equal(good.failed, false);
  assert.equal(bad.failed, true);
  assert.ok(okProc.port.messages.some((m) => m.type === 'loaded'));
});

test('leitor do disco: a música no ar passa na frente da próxima', async () => {
  const total = SR * 8;
  const ds = new DiskStreamer({ concurrency: 1 });
  const order = [];
  const mk = (name, priority) => {
    const r = fakeReader(total, { delayMs: 1 });
    const orig = r.read.bind(r);
    r.read = (s, n) => { order.push(name); return orig(s, n); };
    const proc = new Proc({ processorOptions: { sampleRate: SR, totalFrames: total } });
    return ds.start({ postMessage: (m) => proc.handleMessage(m) }, r, { from: 0, priority });
  };
  const next = mk('next', PRIORITY_NEXT);
  await sleep(5);
  const air = mk('air', PRIORITY_ON_AIR);
  await air.done;
  const firstAir = order.indexOf('air');
  const lastAir = order.lastIndexOf('air');
  assert.equal(order.slice(firstAir, lastAir).filter((n) => n === 'next').length, 0);
  await next.done;
});

test('leitor do disco: busca durante a leitura passa a ler primeiro o novo ponto', async () => {
  const total = SR * 60;
  const log = [];
  const ds = new DiskStreamer({ concurrency: 1 });
  const proc = new Proc({ processorOptions: { sampleRate: SR, totalFrames: total } });
  const h = ds.start({ postMessage: (m) => proc.handleMessage(m) }, fakeReader(total, { delayMs: 2, log }), { from: 0, priority: PRIORITY_ON_AIR });
  await sleep(10);
  const target = SR * 50;
  h.focus(target);
  const at = log.length;
  await sleep(20);
  assert.ok(log.slice(at, at + 2).some((s) => s >= target - (1 << 16) && s <= target), `leituras depois da busca: ${log.slice(at, at + 3)}`);
  h.cancel();
});

test('leitor do disco: show com 12 faixas e disco lento (5 ms por leitura) chega antes do tempo real', async () => {
  const total = SR * 240;
  const ds = new DiskStreamer();
  const t0 = performance.now();
  const handles = Array.from({ length: 12 }, () => {
    const proc = new Proc({ processorOptions: { sampleRate: SR, totalFrames: total } });
    return ds.start({ postMessage: (m) => proc.handleMessage(m) }, fakeReader(total, { delayMs: 5 }), { from: 0, priority: PRIORITY_ON_AIR });
  });
  await Promise.all(handles.map((h) => h.done));
  const ms = performance.now() - t0;
  console.log(`[medida] 12 faixas × 4 min lidas do disco simulado (5 ms/leitura): ${ms.toFixed(0)} ms (tempo real: 240000 ms)`);
  assert.ok(ms < 240000 / 10, 'pelo menos 10× mais rápido que o tempo real');
});
