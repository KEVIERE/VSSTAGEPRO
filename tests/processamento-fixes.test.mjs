// Testes das correções do processamento ao vivo: SoundTouch em pedaços pequenos (sem rajadas
// de 16k quadros num único bloco da thread de áudio) e busca com a música tocando sem corte seco.
// Rodar com: node --test tests/processamento-fixes.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

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
  sb.registerProcessor = (name, cls) => { sb.registered = cls; };
  vm.createContext(sb);
  vm.runInContext(soundtouch + '\n' + processorSource + '\nthis.SoundTouch = SoundTouch; this.SimpleFilter = SimpleFilter;', sb);
  return sb;
}

function tone(frames, sr = SR) {
  const a = new Int16Array(frames);
  for (let i = 0; i < frames; i++) {
    a[i] = Math.round((Math.sin((2 * Math.PI * 220 * i) / sr) * 0.5 + Math.sin((2 * Math.PI * 331.7 * i) / sr) * 0.2) * 20000);
  }
  return a;
}

function arraySource(data) {
  return {
    extract(target, n, p) {
      const av = Math.min(n, Math.max(0, data.length + 32768 - p));
      for (let i = 0; i < av; i++) {
        const q = p + i;
        const v = q < data.length ? data[q] / 32767 : 0;
        target[i * 2] = v;
        target[i * 2 + 1] = v;
      }
      return av;
    },
  };
}

function makeFilter(sb, data, sr, tempo, pitch) {
  const st = new sb.SoundTouch();
  st.stretch.setParameters(sr, 82, 28, 12);
  st.tempo = tempo;
  st.pitch = pitch;
  return { st, filter: new sb.SimpleFilter(arraySource(data), st) };
}

function drain(filter, block) {
  const out = [];
  const buf = new Float32Array(block * 2);
  for (;;) {
    const got = filter.extract(buf, block);
    if (got <= 0) break;
    for (let i = 0; i < got; i++) out.push(buf[i * 2]);
  }
  return out;
}

// ---------- SoundTouch ----------

test('SoundTouch: a saída não depende do tamanho dos pedaços lidos', () => {
  const sb = sandbox();
  const data = tone(SR * 2);
  for (const [tempo, pitch] of [[1.1, 1], [1, Math.pow(2, 2 / 12)], [0.9, Math.pow(2, -3 / 12)]]) {
    const a = drain(makeFilter(sb, data, SR, tempo, pitch).filter, 128);
    const b = drain(makeFilter(sb, data, SR, tempo, pitch).filter, 4096);
    assert.equal(a.length, b.length);
    for (let i = 0; i < a.length; i++) assert.equal(a[i], b[i]);
  }
});

test('SoundTouch: cada leitura de 128 quadros faz no máximo 2 sequências do WSOLA (antes eram 4 a 5 de uma vez)', () => {
  const sb = sandbox();
  const data = tone(SR * 4);
  for (const [tempo, pitch] of [[1.08, 1], [1, Math.pow(2, 2 / 12)], [1, Math.pow(2, -2 / 12)]]) {
    const { st, filter } = makeFilter(sb, data, SR, tempo, pitch);
    let seqs = 0;
    const orig = st.stretch.seekBestOverlapPosition.bind(st.stretch);
    st.stretch.seekBestOverlapPosition = () => { seqs++; return orig(); };
    const buf = new Float32Array(Q * 2);
    let worst = 0;
    // a primeira leitura enche a fila do zero; o que importa é o regime de show
    filter.extract(buf, Q);
    for (let k = 0; k < (SR * 3) / Q; k++) {
      seqs = 0;
      filter.extract(buf, Q);
      worst = Math.max(worst, seqs);
    }
    assert.ok(worst >= 1 && worst <= 2, `tempo ${tempo} tom ${pitch}: ${worst} sequências num bloco`);
  }
});

test('SoundTouch: o bloco de leitura é reaproveitado (sem criar memória nova a cada leitura)', () => {
  const sb = sandbox();
  const { filter } = makeFilter(sb, tone(SR * 2), SR, 1.1, 1);
  const buf = new Float32Array(Q * 2);
  filter.extract(buf, Q);
  const first = filter._fillBuffer;
  assert.ok(first);
  for (let k = 0; k < 300; k++) filter.extract(buf, Q);
  assert.equal(filter._fillBuffer, first);
});

test('SoundTouch: o final da música sai inteiro, até nos extremos de BPM, tom e 96 kHz', () => {
  const sb = sandbox();
  for (const sr of [44100, 48000, 96000]) {
    const data = tone(sr * 2, sr);
    for (const [tempo, pitch] of [[1.5, 0.5], [1.5, 2], [0.75, 0.5], [0.75, 2], [1, 1]]) {
      const out = drain(makeFilter(sb, data, sr, tempo, pitch).filter, 4096);
      const expected = Math.ceil(data.length / tempo);
      assert.ok(out.length >= expected, `${sr} Hz tempo ${tempo} tom ${pitch}: ${out.length} < ${expected}`);
      for (let i = 0; i < out.length; i += 97) assert.ok(Number.isFinite(out[i]));
    }
  }
});

test('SoundTouch: trocar o andamento no meio não quebra a leitura', () => {
  const sb = sandbox();
  const { st, filter } = makeFilter(sb, tone(SR * 3), SR, 1.5, 1.06);
  const buf = new Float32Array(Q * 2);
  for (let k = 0; k < 200; k++) filter.extract(buf, Q);
  st.tempo = 0.75;
  let n = 0;
  assert.doesNotThrow(() => {
    for (let k = 0; k < 200; k++) n += filter.extract(buf, Q);
  });
  assert.equal(n, 200 * Q);
});

// ---------- busca com a música tocando ----------

function makeRig() {
  const sb = sandbox();
  const players = [];
  return {
    get time() { return sb.currentTime; },
    create(options) {
      const p = new sb.registered({ processorOptions: { sampleRate: SR, primeTargetFrames: 1024, ...options } });
      const out = { proc: p, left: [], send: (m) => p.port.onmessage && p.port.onmessage({ data: m }), messages: p.port.messages };
      players.push(out);
      return out;
    },
    run(quanta) {
      for (let q = 0; q < quanta; q++) {
        for (const pl of players) {
          const L = new Float32Array(Q);
          const R = new Float32Array(Q);
          pl.proc.process([], [[L, R]]);
          pl.left.push(...L);
        }
        sb.currentTime += Q / SR;
      }
    },
  };
}

function ramp(frames) {
  const a = new Int16Array(frames);
  for (let i = 0; i < frames; i++) a[i] = (i % 30000) + 1;
  return a;
}
const val = (i) => ((i % 30000) + 1) / 32767;
const close = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

function maxStep(arr, from, to) {
  let m = 0;
  for (let i = from; i < to; i++) m = Math.max(m, Math.abs(arr[i + 1] - arr[i]));
  return m;
}

test('busca no cursor com a música tocando: a posição antiga sai em fade curto, sem corte seco', () => {
  const rig = makeRig();
  const pl = rig.create({ left: ramp(SR), right: ramp(SR) });
  pl.send({ startTime: 0 });
  rig.run(40);
  const cut = pl.left.length;
  // como o seekTo do motor: nova posição, largada 30 ms à frente, fade-in de 1024
  pl.send({ type: 'seek', offsetSamples: 20000, startTime: rig.time + 0.03, fadeInFrames: 1024 });
  rig.run(30);
  assert.ok(maxStep(pl.left, cut - 2, cut + 300) < 0.005, 'sem degrau na troca');
  assert.ok(close(pl.left[cut + 128], val(cut + 128) * 0.5), 'meio do fade-out da posição antiga');
  assert.equal(pl.left[cut + 300], 0, 'depois do fade-out, silêncio até a largada');
  const startIdx = cut + Math.round(0.03 * SR);
  assert.ok(close(pl.left[startIdx + 1100], val(20000 + 1100)), 'a nova posição toca no tempo certo');
});

test('arrastar o clipe tocando (largada imediata): cruzamento curto que não soma acima do pico', () => {
  const rig = makeRig();
  const pl = rig.create({ left: ramp(SR), right: ramp(SR) });
  pl.send({ startTime: 0 });
  rig.run(40);
  const cut = pl.left.length;
  pl.send({ type: 'seek', offsetSamples: 20000, startTime: rig.time, fadeInFrames: 64 });
  rig.run(10);
  const peak = Math.max(val(cut + 64), val(20000 + 64));
  for (let i = cut; i < cut + 64; i++) assert.ok(pl.left[i] <= peak + 1e-6, 'a soma nunca passa do pico');
  assert.ok(maxStep(pl.left, cut - 2, cut + 200) < 0.02, 'sem degrau na troca');
  assert.ok(close(pl.left[cut + 100], val(20000 + 100)), 'depois do cruzamento só a nova posição');
});

test('duas buscas seguidas antes do próximo bloco: o fade-out continua sendo da voz que soava', () => {
  const rig = makeRig();
  const pl = rig.create({ left: ramp(SR), right: ramp(SR) });
  pl.send({ startTime: 0 });
  rig.run(40);
  const cut = pl.left.length;
  pl.send({ type: 'seek', offsetSamples: 15000, startTime: rig.time, fadeInFrames: 64 });
  pl.send({ type: 'seek', offsetSamples: 20000, startTime: rig.time, fadeInFrames: 64 });
  rig.run(10);
  assert.ok(Math.abs(pl.left[cut] - pl.left[cut - 1]) < 0.01, 'continua de onde estava');
  assert.ok(close(pl.left[cut + 100], val(20000 + 100)), 'termina na última posição pedida');
});

test('busca silenciosa com a música tocando: fade curto e depois silêncio', () => {
  const rig = makeRig();
  const pl = rig.create({ left: ramp(SR), right: ramp(SR) });
  pl.send({ startTime: 0 });
  rig.run(40);
  const cut = pl.left.length;
  pl.send({ type: 'seek', offsetSamples: 0, silent: true });
  rig.run(10);
  assert.ok(maxStep(pl.left, cut - 2, cut + 300) < 0.005);
  for (let i = cut + 256; i < pl.left.length; i++) assert.equal(pl.left[i], 0);
});

test('busca com BPM/tom ao vivo (SoundTouch) também sai em fade, sem degrau', () => {
  const rig = makeRig();
  const t = tone(SR * 2);
  const pl = rig.create({ left: t, right: t, tempo: 1.1, pitch: Math.pow(2, 2 / 12), process: true });
  pl.send({ startTime: 0 });
  rig.run(150);
  const cut = pl.left.length;
  assert.ok(Math.abs(pl.left[cut - 1]) > 0 || Math.abs(pl.left[cut - 2]) > 0, 'estava soando');
  pl.send({ type: 'seek', offsetSamples: SR, startTime: rig.time + 0.03, fadeInFrames: 1024, tempo: 1.1, pitch: Math.pow(2, 2 / 12), process: true });
  rig.run(30);
  // o tom tem passo máximo de ~0,02 por amostra; o corte seco daria até ~0,5
  assert.ok(maxStep(pl.left, cut - 2, cut + 300) < 0.05, 'sem degrau na troca');
  assert.equal(pl.left[cut + 300], 0);
  for (const v of pl.left) assert.ok(Number.isFinite(v));
});

test('busca antes da largada não toca nada da voz anterior', () => {
  const rig = makeRig();
  const pl = rig.create({ left: ramp(SR), right: ramp(SR) });
  pl.send({ type: 'seek', offsetSamples: 1000, startTime: 0.05, fadeInFrames: 1 });
  rig.run(5);
  pl.send({ type: 'seek', offsetSamples: 2000, startTime: 0.05, fadeInFrames: 1 });
  rig.run(30);
  const startIdx = Math.round(0.05 * SR);
  for (let i = 0; i < startIdx; i++) assert.equal(pl.left[i], 0);
  assert.ok(close(pl.left[startIdx + 10], val(2000 + 10)));
});
