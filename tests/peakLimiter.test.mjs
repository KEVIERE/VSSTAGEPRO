// Anti-clip de cada canal do mixer: limitador de pico (brickwall) em -0,1 dBFS.
// Cobre o núcleo (src/lib/peakLimiter.js), o processor que roda na thread de áudio durante o show
// (carregado num contexto isolado, bloco a bloco de 128 amostras, como no navegador) e a
// separação por canal usada na exportação. Rodar com: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { ANTI_CLIP_CEILING, ANTI_CLIP_CEILING_DB, PeakLimiter, limitInPlace } from '../src/lib/peakLimiter.js';
import { splitByAntiClip } from '../src/lib/antiClipMix.ts';

const SR = 48000;
const Q = 128;
const db = (g) => 20 * Math.log10(g);
const gain = (d) => Math.pow(10, d / 20);

function peakOf(...chs) {
  let p = 0;
  for (const ch of chs) for (let i = 0; i < ch.length; i++) p = Math.max(p, Math.abs(ch[i]));
  return p;
}

// seno + transientes (bumbo/caixa) bem acima do 0 dBFS, em L e R diferentes
function loudStereo(seconds, overDb) {
  const n = Math.round(seconds * SR);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  const a = gain(overDb);
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296) * 2 - 1;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const hit = (i % 12000) < 400 ? Math.exp(-(i % 12000) / 80) * 1.8 : 0;
    L[i] = a * (0.6 * Math.sin(2 * Math.PI * 55 * t) + 0.3 * rnd()) + hit;
    R[i] = a * (0.6 * Math.sin(2 * Math.PI * 82.4 * t + 1) + 0.3 * rnd()) - hit * 0.7;
  }
  return [L, R];
}

function quietStereo(seconds, peakDb) {
  const n = Math.round(seconds * SR);
  const a = gain(peakDb);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    L[i] = a * Math.sin(2 * Math.PI * 440 * i / SR);
    R[i] = a * Math.sin(2 * Math.PI * 660 * i / SR + 0.5);
  }
  return [L, R];
}

/** Carrega o processor como o navegador faz (mesma junção de peakLimiterWorklet.ts). */
function loadProcessor() {
  const limiterSource = readFileSync(new URL('../src/lib/peakLimiter.js', import.meta.url), 'utf8')
    .replace(/export\s*\{[^}]*\}\s*;?/g, '');
  const processorSource = readFileSync(new URL('../src/lib/peakLimiterProcessor.js', import.meta.url), 'utf8');
  const sandbox = { sampleRate: SR, Float32Array, Float64Array, Int32Array, Math, Object, console };
  sandbox.AudioWorkletProcessor = class {
    constructor() { this.port = { onmessage: null, postMessage() {} }; }
  };
  sandbox.registerProcessor = (name, cls) => { sandbox.registered = { name, cls }; };
  vm.createContext(sandbox);
  vm.runInContext(limiterSource + '\n' + processorSource, sandbox);
  return sandbox.registered;
}

/** Passa um áudio estéreo pelo processor, bloco a bloco, como na thread de áudio. */
function runProcessor(proc, L, R) {
  const outL = new Float32Array(L.length);
  const outR = new Float32Array(R.length);
  for (let start = 0; start < L.length; start += Q) {
    const inp = [L.subarray(start, start + Q), R.subarray(start, start + Q)];
    const out = [new Float32Array(Q), new Float32Array(Q)];
    if (inp[0].length < Q) { const a = new Float32Array(Q); a.set(inp[0]); inp[0] = a; const b = new Float32Array(Q); b.set(inp[1]); inp[1] = b; }
    assert.equal(proc.process([inp], [out]), true);
    const n = Math.min(Q, L.length - start);
    outL.set(out[0].subarray(0, n), start);
    outR.set(out[1].subarray(0, n), start);
  }
  return [outL, outR];
}

test('o teto é -0,1 dBFS', () => {
  assert.equal(ANTI_CLIP_CEILING_DB, -0.1);
  assert.ok(Math.abs(db(ANTI_CLIP_CEILING) - -0.1) < 1e-9);
});

test('ligado (reprodução): nenhum pico do canal passa de -0,1 dBFS, mesmo com +12 dB de sobra', () => {
  const { name, cls } = loadProcessor();
  assert.equal(name, 'peak-limiter');
  const proc = new cls({ processorOptions: { ceiling: ANTI_CLIP_CEILING } });
  const [L, R] = loudStereo(3, 12);
  assert.ok(peakOf(L, R) > gain(10), 'o sinal de teste precisa estourar bem o 0 dBFS');
  const [outL, outR] = runProcessor(proc, L, R);
  const p = peakOf(outL, outR);
  assert.ok(p <= ANTI_CLIP_CEILING, `pico ${db(p).toFixed(4)} dBFS`);
  // limita, mas não esmaga: o pico de saída fica encostado no teto
  assert.ok(db(p) > -0.5, `pico ${db(p).toFixed(2)} dBFS (baixou demais)`);
});

test('ligado: picos isolados e sinal aleatório em blocos de tamanhos variados nunca passam do teto', () => {
  let seed = 7;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const lim = new PeakLimiter(SR, { ceiling: ANTI_CLIP_CEILING });
  let worst = 0;
  for (let block = 0; block < 4000; block++) {
    const frames = 1 + Math.floor(rnd() * 512);
    const amp = gain(-20 + rnd() * 40); // de -20 a +20 dBFS
    const L = new Float32Array(frames);
    const R = new Float32Array(frames);
    for (let i = 0; i < frames; i++) {
      L[i] = (rnd() * 2 - 1) * amp;
      R[i] = rnd() < 0.002 ? 8 * (rnd() < 0.5 ? -1 : 1) : (rnd() * 2 - 1) * amp; // estalos de +18 dB
    }
    const oL = new Float32Array(frames);
    const oR = new Float32Array(frames);
    lim.process([L, R], [oL, oR], frames);
    worst = Math.max(worst, peakOf(oL, oR));
  }
  assert.ok(worst <= ANTI_CLIP_CEILING, `pico ${db(worst).toFixed(5)} dBFS`);
});

test('abaixo do teto o limitador não mexe em nada (só atrasa 1,5 ms), amostra por amostra', () => {
  const { cls } = loadProcessor();
  const proc = new cls({ processorOptions: { ceiling: ANTI_CLIP_CEILING } });
  const [L, R] = quietStereo(1, -0.2);
  const [outL, outR] = runProcessor(proc, L, R);
  const d = proc.limiter.delay;
  assert.equal(d, Math.round(0.0015 * SR));
  for (let i = 0; i < L.length; i++) {
    const want = i >= d ? L[i - d] : 0;
    if (outL[i] !== want) assert.fail(`L[${i}] = ${outL[i]}, esperado ${want}`);
    const wantR = i >= d ? R[i - d] : 0;
    if (outR[i] !== wantR) assert.fail(`R[${i}] = ${outR[i]}, esperado ${wantR}`);
  }
  assert.equal(proc.limiter.minGain, 1);
});

test('só mexe nos picos: depois do estouro o volume do resto volta ao original', () => {
  const lim = new PeakLimiter(SR);
  const [bL, bR] = loudStereo(0.5, 9);
  const [qL, qR] = quietStereo(2, -6);
  const L = new Float32Array(bL.length + qL.length); L.set(bL); L.set(qL, bL.length);
  const R = new Float32Array(bR.length + qR.length); R.set(bR); R.set(qR, bR.length);
  const oL = new Float32Array(L.length);
  const oR = new Float32Array(R.length);
  lim.process([L, R], [oL, oR], L.length);
  assert.ok(lim.minGain < gain(-6), 'o estouro precisava ser segurado');
  // 1 s depois do estouro, a parte baixa sai exatamente como entrou
  const d = lim.delay;
  for (let i = bL.length + SR; i < L.length; i++) {
    if (oL[i] !== L[i - d] || oR[i] !== R[i - d]) assert.fail(`amostra ${i} mudou: ${oL[i]} x ${L[i - d]}`);
  }
});

test('o ganho desce antes do pico (antecipação) e nunca de uma vez na hora dele', () => {
  const lim = new PeakLimiter(SR);
  const n = 2000;
  const x = new Float32Array(n).fill(0.5);
  x[1000] = 2; // pico isolado de +6 dBFS
  const y = new Float32Array(n);
  lim.process([x], [y], n);
  const d = lim.delay;
  const at = 1000 + d; // onde o pico sai
  assert.ok(Math.abs(y[at]) <= ANTI_CLIP_CEILING);
  assert.ok(Math.abs(y[at]) > ANTI_CLIP_CEILING * 0.999, 'o pico sai no teto, não abaixo dele');
  // a rampa começa antes: a amostra anterior ao pico já está com ganho < 1, e a de bem antes não
  assert.ok(y[at - 1] < 0.5 && y[at - 1] > 0.25);
  assert.equal(y[at - d - 2], 0.5);
});

test('entrada desconectada sai em silêncio; "dispose" desliga o processor', () => {
  const { cls } = loadProcessor();
  const proc = new cls({ processorOptions: {} });
  const out = [new Float32Array(Q).fill(9), new Float32Array(Q).fill(9)];
  assert.equal(proc.process([[]], [out]), true);
  assert.ok(out[0].every((v) => v === 0) && out[1].every((v) => v === 0));
  proc.port.onmessage({ data: { type: 'dispose' } });
  assert.equal(proc.process([[]], [[new Float32Array(Q), new Float32Array(Q)]]), false);
});

test('exportação: limita sem atraso, alinhado com o resto do mix, e nunca passa do teto', () => {
  const [L, R] = loudStereo(2, 6);
  const origL = L.slice();
  limitInPlace([L, R], SR);
  assert.ok(peakOf(L, R) <= ANTI_CLIP_CEILING, `pico ${db(peakOf(L, R)).toFixed(4)} dBFS`);
  // sem atraso: a forma de onda continua no mesmo lugar (correlação máxima com deslocamento 0)
  const corr = (shift) => { let s = 0; for (let i = 2000; i < 40000; i++) s += L[i] * origL[i - shift]; return s; };
  assert.ok(corr(0) > corr(72) && corr(0) > corr(-72));

  // abaixo do teto: exatamente igual (o "desligado" da exportação nem passa pelo limitador)
  const [qL, qR] = quietStereo(1, -0.15);
  const keepL = qL.slice();
  const keepR = qR.slice();
  assert.equal(limitInPlace([qL, qR], SR), 1);
  assert.deepEqual(qL, keepL);
  assert.deepEqual(qR, keepR);
});

test('exportação: o limite vale na soma do canal (dois clipes que somados estouram)', () => {
  const n = SR;
  const a = new Float32Array(n);
  const b = new Float32Array(n);
  for (let i = 0; i < n; i++) { a[i] = 0.7 * Math.sin(2 * Math.PI * 100 * i / SR); b[i] = 0.7 * Math.sin(2 * Math.PI * 100 * i / SR + 0.3); }
  assert.ok(peakOf(a) < ANTI_CLIP_CEILING && peakOf(b) < ANTI_CLIP_CEILING);
  const sum = new Float32Array(n);
  for (let i = 0; i < n; i++) sum[i] = a[i] + b[i];
  assert.ok(peakOf(sum) > 1, 'a soma precisa estourar');
  limitInPlace([sum, sum.slice()], SR);
  assert.ok(peakOf(sum) <= ANTI_CLIP_CEILING);
});

test('exportação com "volume igual": teto dividido pelo nível dá o mesmo som da reprodução', () => {
  const level = gain(4); // a música sobe 4 dB no volume igual
  const [L, R] = loudStereo(1, 0);
  // reprodução: nível antes do limitador
  const pL = L.map((v) => v * level);
  const pR = R.map((v) => v * level);
  limitInPlace([pL, pR], SR);
  // exportação: limitador com teto / nível, nível aplicado depois (no master)
  const eL = L.slice();
  const eR = R.slice();
  limitInPlace([eL, eR], SR, { ceiling: ANTI_CLIP_CEILING / level });
  let maxDiff = 0;
  for (let i = 0; i < L.length; i++) maxDiff = Math.max(maxDiff, Math.abs(eL[i] * level - pL[i]), Math.abs(eR[i] * level - pR[i]));
  assert.ok(maxDiff < 1e-5, `diferença ${maxDiff}`);
  assert.ok(peakOf(eL, eR) * level <= ANTI_CLIP_CEILING * (1 + 1e-6));
});

test('exportação: separa por canal só quem tem anti-clip; sem nenhum, a ordem é a de sempre', () => {
  const items = [
    { id: 1, ch: 'bateria' }, { id: 2, ch: 'baixo' }, { id: 3, ch: 'bateria' },
    { id: 4, ch: 'guia' }, { id: 5, ch: 'baixo' }, { id: 6, ch: 'click' },
  ];
  const none = splitByAntiClip(items, () => null);
  assert.deepEqual(none.plain.map((x) => x.id), [1, 2, 3, 4, 5, 6]);
  assert.equal(none.groups.length, 0);

  const on = new Set(['bateria', 'baixo']);
  const split = splitByAntiClip(items, (x) => (on.has(x.ch) ? x.ch : null));
  assert.deepEqual(split.plain.map((x) => x.id), [4, 6]);
  assert.deepEqual(split.groups.map((g) => g.map((x) => x.id)), [[1, 3], [2, 5]]);
});
