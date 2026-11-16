// Tabela de pedaços do reprodutor: o áudio de cada faixa fica em pedaços de tamanho fixo, criados
// só quando o trecho chega. Nada do tamanho da música inteira é alocado na troca de música nem no
// Play, e a leitura é a mesma (amostra a amostra) que a do áudio contínuo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import {
  AudioStreamer, DiskStreamer, PRIORITY_ON_AIR, PRIORITY_NEXT, SLOT_FRAMES, CHUNK_FRAMES, WINDOW_FRAMES, planChunks,
} from '../src/lib/audioStreamer.ts';

const SR = 48000;
const Q = 128;
const soundtouch = readFileSync(new URL('../src/lib/soundtouch.vendor.js', import.meta.url), 'utf8')
  .replace(/export\s*\{[^}]*\}\s*;?/g, '');
const processorSource = readFileSync(new URL('../src/lib/clipPlayerProcessor.js', import.meta.url), 'utf8');

// Int16Array que anota o maior bloco criado dentro do reprodutor.
function sandbox() {
  const stats = { maxI16: 0, i16: 0 };
  class CountingI16 extends Int16Array {
    constructor(...a) {
      super(...a);
      stats.i16++;
      if (this.length > stats.maxI16) stats.maxI16 = this.length;
    }
  }
  const sb = { currentTime: 0, sampleRate: SR, Float32Array, Int16Array: CountingI16, Math, Number, console, stats };
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

function tone(frames) {
  const a = new Int16Array(frames);
  for (let i = 0; i < frames; i++) a[i] = Math.round(Math.sin((2 * Math.PI * 220 * i) / SR) * 12000 + Math.sin(i * 0.013) * 3000);
  return a;
}

/** Toca `quanta` blocos e devolve o canal esquerdo e o direito. */
function play(sb, proc, quanta) {
  const L = []; const R = [];
  for (let q = 0; q < quanta; q++) {
    const l = new Float32Array(Q); const r = new Float32Array(Q);
    proc.process([], [[l, r]]);
    L.push(...l); R.push(...r);
    sb.currentTime += Q / SR;
  }
  return { L, R };
}

const pieceOf = (a, s, e) => a.slice(s, e);

test('a grade do envio é a mesma do reprodutor', () => {
  const shift = Number(processorSource.match(/const SLOT_SHIFT = (\d+);/)[1]);
  assert.equal(1 << shift, SLOT_FRAMES);
  assert.equal(CHUNK_FRAMES % SLOT_FRAMES, 0, 'trecho cheio = pedaços inteiros');
});

test('leitura atravessando a borda do pedaço: igual ao áudio contínuo, amostra por amostra', () => {
  const total = SLOT_FRAMES * 3 + 777;
  const l = ramp(total); const r = ramp(total, 9);
  for (const tempo of [1, 1.1]) {
    const process = tempo !== 1;
    const a = sandbox(); const b = sandbox();
    const ref = new a.Proc({ processorOptions: { sampleRate: SR, left: l, right: r, tempo, process, primeTargetFrames: 1024 } });
    const pcs = new b.Proc({ processorOptions: { sampleRate: SR, totalFrames: total, tempo, process, primeTargetFrames: 1024 } });
    pcs.handleMessage({ type: 'stream', total, stereo: true, pieces: [] });
    // trechos tortos de propósito: as pontas caem no meio dos pedaços
    for (let s = 0; s < total; s += 10007) pcs.handleMessage({ type: 'append', offset: s, left: pieceOf(l, s, s + 10007), right: pieceOf(r, s, s + 10007) });
    const from = SLOT_FRAMES - 300; // largada bem antes da borda: o primeiro bloco já atravessa
    for (const p of [ref, pcs]) p.handleMessage({ type: 'seek', offsetSamples: from, startTime: 0, fadeInFrames: 1, tempo, process });
    const qa = Math.ceil((SLOT_FRAMES * 2) / Q);
    const x = play(a, ref, qa); const y = play(b, pcs, qa);
    for (let i = 0; i < x.L.length; i++) {
      if (x.L[i] !== y.L[i] || x.R[i] !== y.R[i]) assert.fail(`tempo ${tempo}, quadro ${i}: ${y.L[i]} ≠ ${x.L[i]}`);
    }
    if (tempo === 1) {
      // na leitura direta, a amostra certa em cada ponto (inclusive dos dois lados da borda)
      for (const i of [299, 300, 301, SLOT_FRAMES + 300]) assert.ok(Math.abs(y.L[i] - ((from + i) % 30000 + 1) / 32767) < 1e-6, `quadro ${i}`);
      for (const i of [299, 300]) assert.ok(Math.abs(y.R[i] - ((from + i + 9) % 30000 + 1) / 32767) < 1e-6);
    }
    assert.ok(!pcs.port.messages.some((m) => m.type === 'underrun'));
  }
});

test('append fora de ordem (alinhado e torto): tabela completa, sem cópia do pedaço inteiro', () => {
  const sb = sandbox();
  const total = SLOT_FRAMES * 5 + 1234;
  const full = ramp(total);
  const proc = new sb.Proc({ processorOptions: { sampleRate: SR, totalFrames: total } });
  proc.handleMessage({ type: 'stream', total, stereo: false, pieces: [] });
  const order = [[SLOT_FRAMES * 3, SLOT_FRAMES * 5], [100, SLOT_FRAMES], [SLOT_FRAMES * 5, total], [SLOT_FRAMES, SLOT_FRAMES * 3], [0, 100]];
  const sent = [];
  for (const [s, e] of order) {
    const left = full.slice(s, e);
    sent.push({ s, left });
    proc.handleMessage({ type: 'append', offset: s, left });
  }
  assert.deepEqual(JSON.parse(JSON.stringify(proc.data.ranges)), [[0, total]]);
  assert.equal(proc.port.messages.filter((m) => m.type === 'loaded').length, 1);
  // o trecho alinhado que cobre pedaços inteiros fica guardado como chegou (mesmo bloco de memória)
  assert.equal(proc.data.left[3].buffer, sent[0].left.buffer);
  assert.equal(proc.data.left[4].buffer, sent[0].left.buffer);
  assert.equal(proc.data.left[5].buffer, sent[2].left.buffer, 'último pedaço (curto) também');
  for (let i = 0; i < total; i += 97) assert.equal(proc.data.left[Math.floor(i / SLOT_FRAMES)][i % SLOT_FRAMES], full[i]);
  assert.equal(proc.data.left[0][0], full[0]);
  assert.equal(proc.data.left[0][99], full[99]);
  assert.equal(proc.data.left[0][100], full[100]);
  // nenhum bloco criado lá dentro passou do tamanho de um pedaço
  assert.ok(sb.stats.maxI16 <= SLOT_FRAMES, `maior bloco: ${sb.stats.maxI16}`);
});

test('pedaço ausente toca em silêncio sem desalinhar o resto', () => {
  const sb = sandbox();
  const total = SLOT_FRAMES * 4;
  const full = ramp(total);
  const proc = new sb.Proc({ processorOptions: { sampleRate: SR, totalFrames: total, primeTargetFrames: 1024 } });
  // pedaços 0 e 2 chegaram; 1 ainda não
  proc.handleMessage({ type: 'stream', total, stereo: false, pieces: [
    { offset: 0, left: full.slice(0, SLOT_FRAMES) },
    { offset: SLOT_FRAMES * 2, left: full.slice(SLOT_FRAMES * 2, SLOT_FRAMES * 3) },
  ] });
  proc.handleMessage({ type: 'seek', offsetSamples: 0, startTime: 0, fadeInFrames: 1 });
  const { L } = play(sb, proc, Math.ceil((SLOT_FRAMES * 3) / Q));
  const v = (i) => ((i % 30000) + 1) / 32767;
  assert.ok(Math.abs(L[SLOT_FRAMES - 1] - v(SLOT_FRAMES - 1)) < 1e-6);
  for (const i of [SLOT_FRAMES, SLOT_FRAMES + 5000, SLOT_FRAMES * 2 - 1]) assert.equal(L[i], 0, `silêncio em ${i}`);
  for (const i of [SLOT_FRAMES * 2, SLOT_FRAMES * 2 + 1, SLOT_FRAMES * 3 - 1]) assert.ok(Math.abs(L[i] - v(i)) < 1e-6, `alinhado em ${i}`);
  const types = proc.port.messages.map((m) => m.type);
  assert.ok(types.includes('underrun') && types.includes('recovered'));
  assert.ok(!types.includes('ended'));
  assert.ok(L.every((x) => Number.isFinite(x)), 'nunca NaN na saída');
});

test('extend e áudio processado viram pedaços por subarray, sem copiar', () => {
  const sb = sandbox();
  const total = SLOT_FRAMES * 2 + 10;
  const full = ramp(total);
  const proc = new sb.Proc({ processorOptions: { sampleRate: SR, totalFrames: total } });
  const before = sb.stats.i16;
  proc.handleMessage({ type: 'extend', left: full, right: full, total });
  assert.equal(proc.data.left.length, 3);
  for (const s of proc.data.left) assert.equal(s.buffer, full.buffer);
  assert.equal(proc.data.right, proc.data.left, 'mono: um lado só');
  proc.handleMessage({ type: 'rendered', left: full, right: full, tempo: 1.2, pitch: 1 });
  assert.equal(sb.stats.i16, before, 'nenhum Int16Array novo');
});

test('troca de música e Play não alocam nada do tamanho da música (8 min, memória e disco)', async () => {
  const total = SR * 60 * 8;
  const limit = WINDOW_FRAMES + 3 * SLOT_FRAMES;
  // ---- em memória
  {
    const sb = sandbox();
    const src = [ramp(total), ramp(total, 5)];
    const proc = new sb.Proc({ processorOptions: { sampleRate: SR, totalFrames: total } });
    let maxMsg = 0;
    const port = {
      postMessage(m) {
        for (const p of m.pieces ?? [m]) if (p.left) maxMsg = Math.max(maxMsg, p.left.length, p.right?.length ?? 0);
        assert.ok(!(m.left && m.left.length >= total), 'nenhuma mensagem do tamanho da música');
        proc.handleMessage(m);
      },
    };
    const st = new AudioStreamer(() => new Promise((r) => setImmediate(r)));
    const from = SR * 200 + 123;
    const h = st.start(port, { channels: src, length: total }, { from, priority: PRIORITY_ON_AIR });
    assert.ok(sb.stats.maxI16 < SLOT_FRAMES + 1, 'na largada, o reprodutor não criou bloco grande');
    proc.handleMessage({ type: 'seek', offsetSamples: from, startTime: 0, fadeInFrames: 1 });
    const { L } = play(sb, proc, 4);
    assert.ok(Math.abs(L[7] - (((from + 7) % 30000) + 1) / 32767) < 1e-6, 'tocou na hora');
    await h.done;
    assert.ok(maxMsg <= limit, `maior trecho enviado: ${maxMsg}`);
    assert.ok(sb.stats.maxI16 <= SLOT_FRAMES, `maior bloco no reprodutor: ${sb.stats.maxI16}`);
    assert.ok(proc.port.messages.some((m) => m.type === 'loaded'));
    for (const i of [0, from, total - 1]) {
      assert.equal(proc.data.left[Math.floor(i / SLOT_FRAMES)][i % SLOT_FRAMES], src[0][i]);
      assert.equal(proc.data.right[Math.floor(i / SLOT_FRAMES)][i % SLOT_FRAMES], src[1][i]);
    }
  }
  // ---- do disco, com trecho da largada torto (já lido antes) e a próxima em pedaços pequenos
  {
    const sb = sandbox();
    const proc = new sb.Proc({ processorOptions: { sampleRate: SR, totalFrames: total } });
    let maxRead = 0;
    const reader = {
      sampleRate: SR, length: total, channelCount: 2,
      async read(s, n) {
        maxRead = Math.max(maxRead, n);
        const l = new Int16Array(n); const r = new Int16Array(n);
        for (let i = 0; i < n; i++) { l[i] = ((s + i) % 30000) + 1; r[i] = -l[i]; }
        return [l, r];
      },
    };
    const from = SR * 100 + 4321;
    const first = await reader.read(from, 33333);
    const extra = await reader.read(from + 33333, 20000);
    const ds = new DiskStreamer({ lowBytesPerSec: 1024 * 1024 * 1024 });
    ds.setPacing(() => true);
    const offsets = [];
    const h = ds.start({ postMessage(m) { if (m.type === 'append') offsets.push(m.offset); proc.handleMessage(m); } }, reader, {
      from, priority: PRIORITY_NEXT, initial: [{ start: from, channels: first }, { start: from + 33333, channels: extra }],
    });
    assert.ok(sb.stats.maxI16 <= SLOT_FRAMES);
    await h.done;
    assert.ok(!h.failed);
    assert.ok(maxRead <= CHUNK_FRAMES);
    assert.ok(sb.stats.maxI16 <= SLOT_FRAMES, `maior bloco no reprodutor: ${sb.stats.maxI16}`);
    // depois da ponta torta, as leituras caem na grade (guardadas sem cópia)
    assert.ok(offsets.filter((o) => o % SLOT_FRAMES !== 0).length <= 2, 'só as pontas tortas fora da grade');
    for (const i of [0, from - 1, from, from + 33333, from + 53333, total - 1]) {
      assert.equal(proc.data.left[Math.floor(i / SLOT_FRAMES)][i % SLOT_FRAMES], (i % 30000) + 1);
      assert.equal(proc.data.right[Math.floor(i / SLOT_FRAMES)][i % SLOT_FRAMES], -((i % 30000) + 1));
    }
  }
});

test('planChunks na grade: parte do começo do pedaço e alinha depois de uma ponta torta', () => {
  const g = 16;
  const plan = planChunks(200, [[0, 37]], 70, 64, g);
  assert.deepEqual(plan[0], [64, 128], 'desce até a linha da grade antes do ponto');
  const tail = plan.filter((r) => r[0] < 64);
  assert.deepEqual(tail[0], [37, 48], 'ponta torta sai sozinha até a grade');
  for (const [s] of plan.slice(1)) if (s !== 37) assert.equal(s % g, 0);
  const covered = new Array(200).fill(0);
  for (const [s, e] of plan) for (let i = s; i < e; i++) covered[i]++;
  for (let i = 0; i < 200; i++) assert.equal(covered[i], i < 37 ? 0 : 1);
});
