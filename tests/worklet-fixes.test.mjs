// Testes das correções do reprodutor de clipes (AudioWorklet): o fade-out de uma busca parte do
// ganho em que a voz trocada estava soando, então uma segunda busca no meio do fade-in da
// primeira não sobe o volume por um instante.
// Rodar com: node --test tests/worklet-fixes.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SR = 48000;
const Q = 128;

const soundtouch = readFileSync(new URL('../src/lib/soundtouch.vendor.js', import.meta.url), 'utf8')
  .replace(/export\s*\{[^}]*\}\s*;?/g, '');
const processorSource = readFileSync(new URL('../src/lib/clipPlayerProcessor.js', import.meta.url), 'utf8');

function makeRig() {
  const sb = { currentTime: 0, sampleRate: SR, Float32Array, Int16Array, Math, Number, console };
  sb.AudioWorkletProcessor = class {
    constructor() {
      const messages = [];
      this.port = { onmessage: null, postMessage: (m) => messages.push(m), messages };
    }
  };
  sb.registerProcessor = (name, cls) => { sb.registered = cls; };
  vm.createContext(sb);
  vm.runInContext(soundtouch + '\n' + processorSource, sb);
  const players = [];
  return {
    get time() { return sb.currentTime; },
    create(options) {
      const p = new sb.registered({ processorOptions: { sampleRate: SR, primeTargetFrames: 1024, ...options } });
      const out = { proc: p, left: [], send: (m) => p.port.onmessage && p.port.onmessage({ data: m }) };
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

// Sinal constante: qualquer ganho acima de 1 aparece direto como amostra acima do nível.
const LEVEL = 16000;
const C = LEVEL / 32767;
function constant(frames) {
  return new Int16Array(frames).fill(LEVEL);
}

function maxStep(arr, from, to) {
  let m = 0;
  for (let i = from; i < to; i++) m = Math.max(m, Math.abs(arr[i + 1] - arr[i]));
  return m;
}

test('segunda busca no meio do fade-in da primeira: o volume nunca sobe acima do nível de antes', () => {
  const rig = makeRig();
  const pl = rig.create({ left: constant(SR * 3), right: constant(SR * 3) });
  pl.send({ startTime: 0 });
  rig.run(40);
  // como o seekTo do motor: largada 50 ms à frente, fade-in de 1024
  pl.send({ type: 'seek', offsetSamples: 20000, startTime: rig.time + 0.05, fadeInFrames: 1024 });
  // 50 ms até a largada (2400 quadros) e mais uns 300 quadros dentro do fade-in
  rig.run(Math.ceil((2400 + 300) / Q));
  const cut = pl.left.length;
  const before = pl.left[cut - 1];
  assert.ok(before > 0.05 * C && before < 0.6 * C, 'a voz da primeira busca ainda estava entrando');
  pl.send({ type: 'seek', offsetSamples: 40000, startTime: rig.time + 0.05, fadeInFrames: 1024 });
  rig.run(60);
  for (let i = 0; i < pl.left.length; i++) {
    assert.ok(pl.left[i] <= C + 1e-6, `amostra ${i} acima do nível (${pl.left[i]} > ${C})`);
  }
  // continua do ganho em que estava, sem degrau para cima
  // (a primeira amostra do fade-out é a que o fade-in daria a seguir: um passo de 1/1024)
  assert.ok(pl.left[cut] <= before + C / 1024 + 1e-6, 'o fade-out não começa acima do ganho atual');
  assert.ok(maxStep(pl.left, cut - 2, cut + 300) < 0.01, 'sem degrau na troca');
  assert.equal(pl.left[cut + 300], 0, 'depois do fade-out, silêncio até a nova largada');
  const startIdx = cut + Math.round(0.05 * SR);
  assert.ok(Math.abs(pl.left[startIdx + 1100] - C) < 1e-6, 'a nova posição toca no nível cheio');
});

test('busca no meio de um cruzamento de busca imediata: o nível somado segue de onde estava', () => {
  const rig = makeRig();
  const pl = rig.create({ left: constant(SR * 3), right: constant(SR * 3) });
  pl.send({ startTime: 0 });
  rig.run(40);
  // largada imediata: fade-out de 256 da posição antiga junto com o fade-in de 1024 da nova
  pl.send({ type: 'seek', offsetSamples: 20000, startTime: rig.time, fadeInFrames: 1024 });
  rig.run(1);
  const cut = pl.left.length;
  const before = pl.left[cut - 1];
  // 128 quadros depois: antiga em ~0,5 e nova em ~0,125, somando ~0,625 do nível
  assert.ok(before > 0.55 * C && before < 0.7 * C);
  pl.send({ type: 'seek', offsetSamples: 40000, startTime: rig.time + 0.05, fadeInFrames: 1024 });
  rig.run(60);
  for (let i = 0; i < pl.left.length; i++) {
    assert.ok(pl.left[i] <= C + 1e-6, `amostra ${i} acima do nível (${pl.left[i]} > ${C})`);
  }
  assert.ok(Math.abs(pl.left[cut] - before) < 0.01 * C, 'nem sobe nem cai na troca');
  assert.ok(maxStep(pl.left, cut - 2, cut + 300) < 0.01, 'sem degrau na troca');
  assert.equal(pl.left[cut + 300], 0, 'depois do fade-out, silêncio até a nova largada');
});

test('busca no meio do cruzamento de BPM/tom: o nível segue cheio, sem degrau', () => {
  const rig = makeRig();
  const pl = rig.create({ left: constant(SR * 3), right: constant(SR * 3) });
  pl.send({ startTime: 0 });
  rig.run(40);
  const at = rig.time + 0.01;
  pl.send({ type: 'retime', at, offsetSamples: Math.round(at * SR), crossfadeFrames: 512, tempo: 1, pitch: 1, process: false });
  rig.run(Math.ceil((480 + 200) / Q));
  const cut = pl.left.length;
  pl.send({ type: 'seek', offsetSamples: 60000, startTime: rig.time + 0.05, fadeInFrames: 1024 });
  rig.run(10);
  assert.ok(Math.abs(pl.left[cut] - C) < 0.01 * C, 'continua no nível cheio');
  assert.ok(maxStep(pl.left, cut - 2, cut + 300) < 0.01, 'sem degrau na troca');
});

test('busca com a voz em ganho cheio: fade-out igual ao de antes, partindo de 1', () => {
  const rig = makeRig();
  const pl = rig.create({ left: constant(SR * 3), right: constant(SR * 3) });
  pl.send({ startTime: 0 });
  rig.run(40);
  const cut = pl.left.length;
  pl.send({ type: 'seek', offsetSamples: 20000, startTime: rig.time + 0.05, fadeInFrames: 1024 });
  rig.run(10);
  assert.ok(Math.abs(pl.left[cut] - C) < 1e-6, 'começa no nível cheio');
  assert.ok(Math.abs(pl.left[cut + 128] - C * 0.5) < 1e-6, 'meio do fade-out');
  assert.equal(pl.left[cut + 256], 0);
});

test('loop depois de uma busca com ganho parcial: o cruzamento volta a partir do ganho cheio', () => {
  const rig = makeRig();
  const pl = rig.create({ left: constant(SR * 3), right: constant(SR * 3) });
  pl.send({ startTime: 0 });
  rig.run(40);
  pl.send({ type: 'seek', offsetSamples: 20000, startTime: rig.time + 0.05, fadeInFrames: 1024 });
  rig.run(Math.ceil((2400 + 300) / Q));
  // segunda busca com ganho parcial: o fade-out guarda esse ganho
  pl.send({ type: 'seek', offsetSamples: 40000, startTime: rig.time + 0.05, fadeInFrames: 1024 });
  rig.run(60);
  // já no nível cheio, um loop com cruzamento de 512: fade-out (1 - x) + fade-in x = nível constante
  const at = rig.time + 0.01;
  pl.send({ type: 'jump', at, offsetSamples: 1000, crossfadeFrames: 512 });
  const from = pl.left.length;
  rig.run(20);
  for (let i = from; i < pl.left.length; i++) {
    assert.ok(Math.abs(pl.left[i] - C) < 1e-4, `amostra ${i} fora do nível no cruzamento (${pl.left[i]})`);
  }
});
