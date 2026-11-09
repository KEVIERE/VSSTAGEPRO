// Testes do reprodutor de clipes (AudioWorklet) fora do navegador: o processor roda num
// contexto isolado com um relógio de áudio simulado, bloco a bloco (128 amostras), como na
// thread de áudio de verdade. Rodar com: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SR = 48000;
const Q = 128;

const soundtouch = readFileSync(new URL('../src/lib/soundtouch.vendor.js', import.meta.url), 'utf8')
  .replace(/export\s*\{[^}]*\}\s*;?/g, '');
const processorSource = readFileSync(new URL('../src/lib/clipPlayerProcessor.js', import.meta.url), 'utf8');

function loadProcessorClass() {
  const sandbox = {
    currentTime: 0,
    sampleRate: SR,
    Float32Array, Int16Array, Math, Number, console,
  };
  sandbox.AudioWorkletProcessor = class {
    constructor() {
      const messages = [];
      this.port = { onmessage: null, postMessage: (m) => messages.push(m), messages };
    }
  };
  sandbox.registerProcessor = (name, cls) => { sandbox.registered = cls; };
  vm.createContext(sandbox);
  vm.runInContext(soundtouch + '\n' + processorSource, sandbox);
  return sandbox;
}

/** Um relógio compartilhado por várias faixas, como um AudioContext. */
function makeRig() {
  const sb = loadProcessorClass();
  const players = [];
  return {
    get time() { return sb.currentTime; },
    create(options) {
      const p = new sb.registered({ processorOptions: { sampleRate: SR, primeTargetFrames: 1024, ...options } });
      const out = { proc: p, left: [], right: [], send: (m) => p.port.onmessage && p.port.onmessage({ data: m }), messages: p.port.messages };
      players.push(out);
      return out;
    },
    run(quanta) {
      for (let q = 0; q < quanta; q++) {
        for (const pl of players) {
          const L = new Float32Array(Q);
          const R = new Float32Array(Q);
          const alive = pl.proc.process([], [[L, R]]);
          pl.left.push(...L);
          pl.right.push(...R);
          pl.alive = alive;
        }
        sb.currentTime += Q / SR;
      }
    },
  };
}

// Cada amostra guarda a própria posição (1..30000, cíclico): dá para saber exatamente qual
// pedaço do arquivo saiu em cada instante e medir atraso entre faixas.
function ramp(frames, seed = 0) {
  const a = new Int16Array(frames);
  for (let i = 0; i < frames; i++) a[i] = ((i + seed) % 30000) + 1;
  return a;
}
const val = (i, seed = 0) => (((i + seed) % 30000) + 1) / 32767;

function close(a, b, eps = 1e-6) {
  return Math.abs(a - b) < eps;
}

function types(pl) {
  return pl.messages.map((m) => m.type).filter(Boolean);
}

test('várias faixas largam juntas e ficam alinhadas amostra a amostra', () => {
  const rig = makeRig();
  const total = SR * 2;
  const tracks = [0, 7, 13].map((seed) => {
    const data = ramp(total, seed);
    const pl = rig.create({ left: data, right: data });
    return { pl, seed };
  });
  const start = 0.01;
  // uma faixa começa 0,5 s depois na timeline (offset maior), as outras no zero
  tracks[0].pl.send({ startTime: start });
  tracks[1].pl.send({ type: 'seek', offsetSamples: 0, startTime: start, fadeInFrames: 1 });
  tracks[2].pl.send({ type: 'seek', offsetSamples: SR / 2, startTime: start, fadeInFrames: 1 });
  rig.run(200);
  const startIdx = Math.round(start * SR);
  for (const k of [startIdx + 10, startIdx + 5000, startIdx + 20000]) {
    const pos = k - startIdx;
    assert.ok(close(tracks[0].pl.left[k], val(pos, 0)), 'faixa 1 no lugar');
    assert.ok(close(tracks[1].pl.left[k], val(pos, 7)), 'faixa 2 no lugar');
    assert.ok(close(tracks[2].pl.left[k], val(pos + SR / 2, 13)), 'faixa 3 no lugar');
  }
});

test('dado que chega atrasado não atrasa a faixa nem encerra a música', () => {
  const rig = makeRig();
  const total = SR; // 1 s
  const full = ramp(total);
  const head = full.slice(0, 4800); // só 0,1 s pronto
  const pl = rig.create({ left: head, right: head, totalFrames: total });
  pl.send({ startTime: 0 });
  rig.run(75); // 9600 amostras: passa do fim do trecho pronto
  assert.ok(close(pl.left[100], val(100)));
  assert.equal(pl.left[6000], 0, 'trecho ainda ausente toca como silêncio');
  assert.ok(types(pl).includes('underrun'), 'avisa que faltou dado');
  assert.ok(!types(pl).includes('ended'), 'fim do trecho parcial NÃO é fim do clipe');

  // o resto chega: a faixa continua exatamente na posição do relógio (sem atraso acumulado)
  const big = new Int16Array(total);
  big.set(head);
  pl.send({ type: 'stream', left: big, right: big, total, ranges: [[0, 4800]] });
  pl.send({ type: 'append', offset: 4800, left: full.slice(4800), right: full.slice(4800) });
  assert.ok(types(pl).includes('loaded'));
  rig.run(50);
  const k = 75 * Q + 200;
  assert.ok(close(pl.left[k], val(k)), 'continua alinhada ao relógio depois que o dado chega');
  assert.ok(types(pl).includes('recovered'));
});

test('"ended" sai uma única vez e só no fim real do clipe', () => {
  const rig = makeRig();
  const total = 5000;
  const data = ramp(total);
  const pl = rig.create({ left: data, right: data });
  pl.send({ startTime: 0 });
  rig.run(30);
  assert.equal(types(pl).filter((t) => t === 'ended').length, 0);
  rig.run(20);
  assert.equal(types(pl).filter((t) => t === 'ended').length, 1);
  rig.run(20);
  assert.equal(types(pl).filter((t) => t === 'ended').length, 1);
});

test('busca para o meio usa o trecho que chegou primeiro, fora de ordem', () => {
  const rig = makeRig();
  const total = SR * 4;
  const full = ramp(total);
  const from = SR * 3;
  const big = new Int16Array(total);
  big.set(full.subarray(from, from + SR / 2), from);
  const pl = rig.create({ totalFrames: total });
  pl.send({ type: 'stream', left: big, right: big, total, ranges: [[from, from + SR / 2]] });
  pl.send({ type: 'seek', offsetSamples: from, startTime: 0, fadeInFrames: 1 });
  rig.run(40);
  assert.ok(close(pl.left[1000], val(from + 1000)));
  assert.ok(!types(pl).includes('underrun'));
  // o começo chega depois e não atrapalha o que já toca
  pl.send({ type: 'append', offset: 0, left: full.slice(0, from), right: full.slice(0, from) });
  rig.run(10);
  assert.ok(close(pl.left[40 * Q + 5], val(from + 40 * Q + 5)));
});

test('depois de split e corte do fim, buscar perto do novo fim toca até ele e termina', () => {
  const rig = makeRig();
  const original = ramp(SR * 2);
  const cut = original.subarray(0, SR); // o clipe passou a ter 1 s
  const pl = rig.create({ left: cut, right: cut });
  pl.send({ type: 'seek', offsetSamples: SR - 1000, startTime: 0, fadeInFrames: 1 });
  rig.run(20);
  assert.ok(close(pl.left[500], val(SR - 1000 + 500)));
  assert.equal(pl.left[1500], 0, 'nada toca depois do novo fim');
  assert.ok(types(pl).includes('ended'));
});

test('loop: salto exato para o começo da região sem disparar fim de música', () => {
  const rig = makeRig();
  const total = SR;
  const data = ramp(total);
  const pl = rig.create({ left: data, right: data });
  pl.send({ startTime: 0 });
  const at = 0.5; // salta em 0,5 s de volta para 0,1 s
  pl.send({ type: 'jump', at, resumeAt: at, offsetSamples: SR / 10, crossfadeFrames: 256 });
  rig.run(Math.ceil((SR * 0.9) / Q));
  const atIdx = Math.round(at * SR);
  assert.ok(close(pl.left[atIdx - 10], val(atIdx - 10)), 'antes do salto');
  assert.ok(close(pl.left[atIdx + 1000], val(SR / 10 + 1000)), 'depois do salto, já na região');
  assert.ok(!types(pl).includes('ended'));
});

test('BPM e tom alterados: duas faixas iguais saem idênticas e sem valores inválidos', () => {
  const rig = makeRig();
  const total = SR * 2;
  const tone = new Int16Array(total);
  for (let i = 0; i < total; i++) tone[i] = Math.round(Math.sin((2 * Math.PI * 220 * i) / SR) * 12000);
  const a = rig.create({ left: tone, right: tone, tempo: 1.1, pitch: Math.pow(2, 2 / 12), process: true });
  const b = rig.create({ left: tone, right: tone, tempo: 1.1, pitch: Math.pow(2, 2 / 12), process: true });
  a.send({ startTime: 0.01 });
  b.send({ startTime: 0.01 });
  rig.run(300);
  let energy = 0;
  for (let i = 0; i < a.left.length; i++) {
    assert.ok(Number.isFinite(a.left[i]));
    assert.equal(a.left[i], b.left[i]);
    energy += a.left[i] * a.left[i];
  }
  assert.ok(energy > 100, 'o processamento produz áudio');
  // com tempo 1,1 o clipe de 2 s acaba em ~1,82 s de relógio
  rig.run(Math.ceil((SR * 2) / Q));
  assert.ok(types(a).includes('ended'));
});

test('BPM alterado com dado atrasado: segue em silêncio e volta a soar quando o dado chega', () => {
  const rig = makeRig();
  const total = SR * 2;
  const tone = new Int16Array(total);
  for (let i = 0; i < total; i++) tone[i] = Math.round(Math.sin((2 * Math.PI * 220 * i) / SR) * 12000);
  const head = tone.slice(0, SR / 4);
  const pl = rig.create({ left: head, right: head, totalFrames: total, tempo: 1.05, process: true });
  pl.send({ startTime: 0 });
  rig.run(Math.ceil(SR / Q)); // 1 s: passou bem do trecho pronto
  assert.ok(types(pl).includes('underrun'));
  assert.ok(!types(pl).includes('ended'));
  const big = new Int16Array(total);
  big.set(tone);
  pl.send({ type: 'stream', left: big, right: big, total, ranges: [[0, total]] });
  const before = pl.left.length;
  rig.run(250);
  let energy = 0;
  for (let i = before + 4096; i < pl.left.length; i++) energy += pl.left[i] * pl.left[i];
  assert.ok(energy > 1, 'voltou a soar');
});

test('trecho processado parcial (começo ajustado) não vira fim falso', () => {
  const rig = makeRig();
  const total = SR * 2;
  const data = ramp(total);
  const rendered = ramp(SR / 2);
  const pl = rig.create({ left: data, right: data, tempo: 1.2, process: true,
    renderedLeft: rendered, renderedRight: rendered, renderedTempo: 1.2, renderedPitch: 1, renderedValidFrames: SR / 2 });
  pl.send({ startTime: 0 });
  rig.run(Math.ceil(SR / Q));
  assert.ok(!types(pl).includes('ended'), 'o motor ainda vai trocar para o áudio inteiro');
});

test('stop libera o reprodutor e mensagens atrasadas não quebram nada', () => {
  const rig = makeRig();
  const data = ramp(SR);
  const pl = rig.create({ left: data, right: data });
  pl.send({ startTime: 0 });
  rig.run(5);
  pl.send({ type: 'stop' });
  rig.run(1);
  assert.equal(pl.alive, false);
  assert.doesNotThrow(() => pl.proc.handleMessage({ type: 'append', offset: 0, left: data, right: data }));
});

test('troca de áudio ao vivo (stream) mantém as vozes no mesmo objeto de dados', () => {
  const rig = makeRig();
  const total = SR;
  const a = ramp(total, 0);
  const b = ramp(total, 500);
  const pl = rig.create({ left: a, right: a });
  pl.send({ startTime: 0 });
  rig.run(10);
  pl.send({ type: 'stream', left: b.slice(), right: b.slice(), total, ranges: [[0, total]] });
  pl.send({ type: 'seek', offsetSamples: 10 * Q, startTime: rig.time, fadeInFrames: 1 });
  rig.run(10);
  assert.ok(close(pl.left[10 * Q + 300], val(10 * Q + 300, 500)));
});
