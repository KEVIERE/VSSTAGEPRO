// Com o BPM alterado o som tem de cair na grade: o click exatamente nela e a banda com o adiantamento
// do SoundTouch descontado. Medido no reprodutor de verdade (AudioWorklet) e no SoundTouch real.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { findClickBeats, placeRemountOnGrid, remountClick } from '../src/lib/clickRemount.ts';
import {
  MEASURE_RATE, measureHitLagMs, measureStep, nominalStretchLeadMs, reduceForMeasure, stretchLeadMs,
} from '../src/lib/stretchLatency.ts';
import { SoundTouch, SimpleFilter } from '../src/lib/soundtouch.vendor.js';

const SR = 48000;
const Q = 128;
const TEMPOS = [0.75, 0.9, 1.1, 1.25];
const soundtouch = readFileSync(new URL('../src/lib/soundtouch.vendor.js', import.meta.url), 'utf8')
  .replace(/export\s*\{[^}]*\}\s*;?/g, '');
const processorSource = readFileSync(new URL('../src/lib/clipPlayerProcessor.js', import.meta.url), 'utf8');

function loadProcessor() {
  const sb = { currentTime: 0, sampleRate: SR, Float32Array, Int16Array, Math, Number, console };
  sb.AudioWorkletProcessor = class {
    constructor() { this.port = { onmessage: null, postMessage() {} }; }
  };
  sb.registerProcessor = (_n, cls) => { sb.cls = cls; };
  vm.createContext(sb);
  vm.runInContext(`${soundtouch}\n${processorSource}`, sb);
  return sb;
}

function clickTrack(seconds, beatSec, first = 0.2) {
  const n = Math.round(seconds * SR);
  const data = new Int16Array(n);
  const hits = [];
  for (let k = 0; ; k++) {
    const h = Math.round((first + k * beatSec) * SR);
    if (h + 3000 >= n) break;
    hits.push(h);
    for (let i = 0; i < 2400; i++) data[h + i] = Math.round(26000 * Math.sin(2 * Math.PI * 1800 * i / SR) * Math.exp(-i / SR * 240));
  }
  return { data, hits };
}

/** Batidas com timbre e intervalo variados, como uma percussão. */
function drums(seconds) {
  const n = Math.round(seconds * SR);
  const x = new Int16Array(n);
  const times = [];
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let t = 0.3 + rnd() * 0.05; t < seconds - 0.5; t += 0.21 + rnd() * 0.17) {
    const a = Math.round(t * SR);
    times.push(a);
    const f = 300 + rnd() * 1800;
    const d = 90 + rnd() * 120;
    for (let i = 0; i < 3600 && a + i < n; i++) {
      const v = (rnd() - 0.5) * 0.5 + Math.sin((2 * Math.PI * f * i) / SR);
      x[a + i] = Math.max(-32000, Math.min(32000, x[a + i] + 16000 * v * Math.exp((-i / SR) * d)));
    }
  }
  return { x, times };
}

function stretch(x, tempo) {
  const st = new SoundTouch();
  st.stretch.setParameters(SR, 82, 28, 12);
  st.stretch.quickSeek = true;
  st.tempo = tempo;
  st.pitch = 1;
  const source = {
    extract(target, n, position) {
      const available = Math.min(n, Math.max(0, x.length + 32768 - position));
      for (let i = 0; i < available; i++) {
        const v = position + i < x.length ? x[position + i] / 32767 : 0;
        target[i * 2] = v; target[i * 2 + 1] = v;
      }
      return available;
    },
  };
  const filter = new SimpleFilter(source, st);
  const want = Math.ceil(x.length / tempo);
  const out = new Int16Array(want);
  const buf = new Float32Array(8192);
  let total = 0;
  while (total < want) {
    const got = Math.min(filter.extract(buf, 4096), want - total);
    if (got <= 0) break;
    for (let i = 0; i < got; i++) out[total + i] = Math.max(-32768, Math.min(32767, Math.round(buf[i * 2] * 32767)));
    total += got;
  }
  return out;
}

function reduced(x) {
  const step = measureStep(SR);
  const out = new Int16Array(Math.floor(x.length / step));
  reduceForMeasure(x, x, step, out, 0, x.length);
  return { out, rate: SR / step };
}

function play(data, { tempo, seconds, prepare, offsetSamples = 0, startTime = 0.01 }) {
  const sb = loadProcessor();
  const p = new sb.cls({ processorOptions: { sampleRate: SR, primeTargetFrames: 2048, left: data, right: data, tempo, pitch: 1, process: true } });
  prepare?.(p);
  p.port.onmessage({ data: { type: 'seek', offsetSamples, startTime, fadeInFrames: 1 } });
  const quanta = Math.ceil(seconds * SR / Q);
  const out = new Float32Array(quanta * Q);
  for (let q = 0; q < quanta; q++) {
    const L = new Float32Array(Q);
    const R = new Float32Array(Q);
    p.process([], [[L, R]]);
    out.set(L, q * Q);
    sb.currentTime += Q / SR;
  }
  return { out, player: p };
}

function onsets(x, gap) {
  let peak = 0;
  for (const v of x) peak = Math.max(peak, Math.abs(v));
  const found = [];
  let free = 0;
  for (let i = 0; i < x.length; i++) {
    if (i < free) continue;
    if (Math.abs(x[i]) >= peak * 0.25) { found.push(i); free = i + gap; }
  }
  return found;
}

const median = (v) => [...v].sort((a, b) => a - b)[v.length >> 1];

test('click na grade: cada batida na amostra exata, em todo andamento', () => {
  const { data, hits } = clickTrack(20, 0.5);
  for (const tempo of [...TEMPOS, 1.5]) {
    const made = { ...remountClick(data, data, hits, SR, tempo), hits };
    placeRemountOnGrid(data, data, made, SR, tempo);
    const found = onsets(made.left, Math.round(SR * 0.15 / tempo));
    assert.equal(found.length, hits.length, `tempo ${tempo}`);
    // o detector marca o ataque um pouco depois do começo do som: desconta o mesmo no original
    const attack = onsets(data, Math.round(SR * 0.15)).map((v, i) => v - hits[i]);
    found.forEach((v, i) => {
      const want = Math.round(hits[i] / tempo) + attack[i];
      assert.ok(Math.abs(v - want) <= 1, `tempo ${tempo}, batida ${i}: ${v - want} amostras`);
    });
  }
});

test('click na grade: batida colada no começo fica no começo, com o ataque inteiro', () => {
  const { data, hits } = clickTrack(6, 0.5, 0);
  assert.equal(hits[0], 0);
  const made = { ...remountClick(data, data, hits, SR, 0.75), hits };
  placeRemountOnGrid(data, data, made, SR, 0.75);
  assert.equal(onsets(made.left, Math.round(SR * 0.15))[0], onsets(data, Math.round(SR * 0.15))[0]);
  let peak = 0;
  for (let i = 0; i < 480; i++) peak = Math.max(peak, Math.abs(made.left[i]));
  assert.ok(peak > 15000, `ataque perdido: pico ${peak}`);
});

test('click na grade: a faixa continua reconhecida como click e do mesmo tamanho', () => {
  const { data, hits } = clickTrack(10, 0.5);
  const made = { ...remountClick(data, data, hits, SR, 0.9), hits };
  const length = made.left.length;
  placeRemountOnGrid(data, data, made, SR, 0.9);
  assert.equal(made.left.length, length);
  assert.equal(findClickBeats(made.left, made.left, SR)?.length, hits.length);
});

test('a cópia reduzida em pedaços é igual à feita de uma vez', () => {
  const { x } = drums(6);
  const step = measureStep(SR);
  assert.equal(SR / step, MEASURE_RATE);
  const whole = new Int16Array(Math.floor(x.length / step));
  reduceForMeasure(x, x, step, whole, 0, x.length);
  const parts = new Int16Array(whole.length);
  for (let at = 0; at < parts.length;) at += reduceForMeasure(x, x, step, parts, at, step * 777);
  assert.deepEqual(parts, whole);
});

test('a medida acha o deslocamento conhecido de uma faixa', () => {
  const { x } = drums(40);
  for (const shiftMs of [-30, -12, 0, 8, 25]) {
    const shift = Math.round((shiftMs * SR) / 1000);
    const moved = new Int16Array(x.length);
    if (shift >= 0) moved.set(x.subarray(0, x.length - shift), shift);
    else moved.set(x.subarray(-shift), 0);
    const a = reduced(x);
    const b = reduced(moved);
    const lag = measureHitLagMs(a.out, b.out, a.rate, 1);
    assert.ok(lag !== null, 'precisa medir');
    assert.ok(Math.abs(lag - shiftMs) <= 0.5, `esperado ${shiftMs} ms, medido ${lag} ms`);
  }
});

test('sem batidas a medida se recusa e vale a conta nominal', () => {
  const silent = new Int16Array(MEASURE_RATE * 20);
  assert.equal(measureHitLagMs(silent, silent, MEASURE_RATE, 0.9), null);
  assert.equal(stretchLeadMs(silent, silent, MEASURE_RATE, 0.9, 1), nominalStretchLeadMs(0.9, 1));
});

test('banda pelo SoundTouch: descontada a medida, a mediana das batidas cai na grade', () => {
  const { x, times } = drums(45);
  const a = reduced(x);
  for (const tempo of TEMPOS) {
    const out = stretch(x, tempo);
    const b = reduced(out);
    const leadMs = stretchLeadMs(a.out, b.out, a.rate, tempo, 1);
    const lead = Math.round((leadMs * SR) / 1000);
    const { out: played } = play(x, {
      tempo,
      seconds: 42 / tempo,
      prepare: (p) => p.port.onmessage({ data: { type: 'rendered', left: out, right: out, tempo, pitch: 1, leadFrames: lead } }),
    });
    const start = Math.round(0.01 * SR);
    let peak = 0;
    for (const v of played) peak = Math.max(peak, Math.abs(v));
    const dev = [];
    for (const t of times) {
      const want = start + Math.round(t / tempo);
      if (want + SR * 0.06 >= played.length) break;
      let best = 0;
      let at = -1;
      for (let i = want - Math.round(0.07 * SR); i < want + Math.round(0.07 * SR); i++) {
        const v = Math.abs(played[i]);
        if (v > best) { best = v; at = i; }
      }
      if (best > peak * 0.2) dev.push(((at - want) / SR) * 1000);
    }
    assert.ok(dev.length > 60, `tempo ${tempo}: ${dev.length} batidas`);
    assert.ok(Math.abs(median(dev)) <= 4, `tempo ${tempo}: mediana ${median(dev).toFixed(2)} ms da grade (adiantamento medido ${leadMs.toFixed(2)} ms)`);
  }
});

test('áudio preparado: a voz lê o quanto ele adianta, sem perder a posição', () => {
  const { data, hits } = clickTrack(12, 0.5);
  const tempo = 0.9;
  const lead = 1000;
  const r = remountClick(data, data, hits, SR, tempo);
  // o áudio preparado sai `lead` quadros antes do lugar: a voz precisa devolvê-los
  const early = new Int16Array(r.left.length);
  early.set(r.left.subarray(0));
  const base = onsets(play(data, { tempo, seconds: 6, prepare: (p) => p.port.onmessage({ data: { type: 'rendered', left: early, right: early, tempo, pitch: 1 } }) }).out, 3000);
  const held = onsets(play(data, { tempo, seconds: 6, prepare: (p) => p.port.onmessage({ data: { type: 'rendered', left: early, right: early, tempo, pitch: 1, leadFrames: lead } }) }).out, 3000);
  assert.equal(held.length > 3, true);
  for (let i = 0; i < Math.min(base.length, held.length) - 1; i++) assert.ok(Math.abs(held[i] - base[i] - lead) <= 1, `batida ${i}: ${held[i] - base[i]} quadros`);
});

test('áudio preparado: no começo do clipe entra silêncio antes, nunca uma leitura fora do clipe', () => {
  const { data, hits } = clickTrack(6, 0.5, 0);
  const tempo = 1.1;
  const r = remountClick(data, data, hits, SR, tempo);
  const lead = 480;
  const { out } = play(data, { tempo, seconds: 1, prepare: (p) => p.port.onmessage({ data: { type: 'rendered', left: r.left, right: r.right, tempo, pitch: 1, leadFrames: lead } }) });
  const start = Math.round(0.01 * SR);
  for (let i = 0; i < lead - 2; i++) assert.equal(out[start + i], 0, `amostra ${i}`);
  let peak = 0;
  for (let i = start + lead; i < start + lead + 480; i++) peak = Math.max(peak, Math.abs(out[i]));
  assert.ok(peak > 0.4, `ataque perdido: pico ${peak}`);
});

test('áudio preparado: mudar o tom mantém a posição descontada', () => {
  const { data, hits } = clickTrack(10, 0.5);
  const tempo = 0.9;
  const r = remountClick(data, data, hits, SR, tempo);
  const { player: p } = play(data, {
    tempo, seconds: 1, offsetSamples: SR * 2,
    prepare: (q) => q.port.onmessage({ data: { type: 'rendered', left: r.left, right: r.right, tempo, pitch: 1, leadFrames: 700 } }),
  });
  const before = p.voice.pos + p.voice.renderedLead - p.voice.hold;
  p.port.onmessage({ data: { tempo, pitch: 1 } });
  const after = p.voice.pos + p.voice.renderedLead - p.voice.hold;
  assert.ok(Math.abs(after - before) <= 2, `posição mudou ${after - before} quadros`);
});

test('voz ao vivo com BPM alterado: a mediana das batidas se aproxima da grade', () => {
  const { x, times } = drums(30);
  for (const tempo of [0.75, 0.9]) {
    const { out } = play(x, { tempo, seconds: 27 / tempo });
    const start = Math.round(0.01 * SR);
    const dev = [];
    for (const t of times) {
      const want = start + Math.round(t / tempo);
      if (want + SR * 0.06 >= out.length) break;
      let best = 0;
      let at = -1;
      for (let i = Math.max(0, want - Math.round(0.07 * SR)); i < want + Math.round(0.07 * SR); i++) {
        const v = Math.abs(out[i]);
        if (v > best) { best = v; at = i; }
      }
      dev.push(((at - want) / SR) * 1000);
    }
    const nominal = nominalStretchLeadMs(tempo, 1);
    assert.ok(Math.abs(median(dev)) < nominal, `tempo ${tempo}: mediana ${median(dev).toFixed(2)} ms; sem a correção ficaria perto de -${nominal.toFixed(2)} ms`);
  }
});

test('1x: nada muda, a leitura continua na amostra exata', () => {
  const { data, hits } = clickTrack(8, 0.5);
  const sb = loadProcessor();
  const p = new sb.cls({ processorOptions: { sampleRate: SR, primeTargetFrames: 2048, left: data, right: data, tempo: 1, pitch: 1, process: false } });
  p.port.onmessage({ data: { type: 'seek', offsetSamples: 0, startTime: 0.01, fadeInFrames: 1 } });
  assert.equal(p.voice.filter, null);
  assert.equal(p.voice.hold, 0);
  const quanta = Math.ceil(5 * SR / Q);
  const out = new Float32Array(quanta * Q);
  for (let q = 0; q < quanta; q++) {
    const L = new Float32Array(Q);
    const R = new Float32Array(Q);
    p.process([], [[L, R]]);
    out.set(L, q * Q);
    sb.currentTime += Q / SR;
  }
  const start = Math.round(0.01 * SR);
  const found = onsets(out, 7000);
  hits.filter((h) => h + start < out.length - 3000).forEach((h, i) => assert.ok(Math.abs(found[i] - (h + start)) <= 2, `batida ${i}: ${found[i] - (h + start)} amostras`));
});
