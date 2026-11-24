// Click com BPM ou tom alterados: medido no reprodutor de verdade (AudioWorklet) e nas contas do
// click gerado, do click importado e do início da amostra.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { bandLeadSeconds, findClickBeats, quietSwapFrame, remountClick } from '../src/lib/clickRemount.ts';
import { alignHitsToGrid, clickOnsetIndex, nearestGridBeat, placeClickSamples, remakeClickTimes } from '../src/lib/clickEdit.ts';
import {
  clickBeatsKey, generatedClickTimes, isImportedClick, staleGeneratedClicks, tempoMapChanged,
} from '../src/lib/clickFollow.ts';

const SR = 48000;
const Q = 128;
const soundtouch = readFileSync(new URL('../src/lib/soundtouch.vendor.js', import.meta.url), 'utf8')
  .replace(/export\s*\{[^}]*\}\s*;?/g, '');
const processorSource = readFileSync(new URL('../src/lib/clipPlayerProcessor.js', import.meta.url), 'utf8');

function loadProcessor() {
  const sb = { currentTime: 0, sampleRate: SR, Float32Array, Int16Array, Math, Number, console };
  sb.AudioWorkletProcessor = class {
    constructor() {
      const messages = [];
      this.port = { onmessage: null, postMessage: (m) => messages.push(m), messages };
    }
  };
  sb.registerProcessor = (_n, cls) => { sb.cls = cls; };
  vm.createContext(sb);
  vm.runInContext(`${soundtouch}\n${processorSource}`, sb);
  return sb;
}

/** Click de 1,8 kHz com queda rápida, numa grade regular. */
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

function onsets(x, gap) {
  let peak = 0;
  for (const v of x) peak = Math.max(peak, Math.abs(v));
  const out = [];
  let free = 0;
  for (let i = 0; i < x.length; i++) {
    if (i < free) continue;
    if (Math.abs(x[i]) >= peak * 0.25) { out.push(i); free = i + gap; }
  }
  return out;
}

/** Toca no reprodutor real. `prepare` entrega o áudio remontado antes da largada. */
function play(data, { tempo, pitch = 1, seconds, prepare, offsetSamples = 0 }) {
  const sb = loadProcessor();
  const p = new sb.cls({ processorOptions: { sampleRate: SR, primeTargetFrames: 2048, left: data, right: data, tempo, pitch, process: true } });
  prepare?.(p);
  p.port.onmessage({ data: { type: 'seek', offsetSamples, startTime: 0.01, fadeInFrames: 1 } });
  const quanta = Math.ceil(seconds * SR / Q);
  const out = new Float32Array(quanta * Q);
  for (let q = 0; q < quanta; q++) {
    const L = new Float32Array(Q);
    const R = new Float32Array(Q);
    p.process([], [[L, R]]);
    out.set(L, q * Q);
    sb.currentTime += Q / SR;
  }
  return { out, voice: p.voice };
}

/** Desvio (ms) de cada batida em relação ao lugar certo: batida / tempo, junto da banda. */
function deviations(out, hits, tempo) {
  const start = Math.round(0.01 * SR);
  const lead = Math.round(bandLeadSeconds(tempo) * SR);
  const found = onsets(out, Math.round(SR * 0.15 / tempo));
  return hits.map((h) => {
    const want = start + Math.round(h / tempo) - lead;
    let best = Infinity;
    for (const v of found) if (Math.abs(v - want) < Math.abs(best)) best = v - want;
    return best / SR * 1000;
  });
}

const TEMPOS = [0.75, 0.9, 0.95, 1, 1.05, 1.1, 1.25, 1.5];

test('click remontado: toda batida no lugar, em cada velocidade, no reprodutor real', () => {
  const { data, hits } = clickTrack(30, 0.5);
  for (const tempo of TEMPOS) {
    const r = remountClick(data, data, hits, SR, tempo);
    const { out, voice } = play(data, {
      tempo,
      seconds: 30 / tempo - 0.5,
      prepare: (p) => p.port.onmessage({ data: { type: 'rendered', left: r.left, right: r.right, tempo, pitch: 1 } }),
    });
    assert.equal(voice.filter, null, `tempo ${tempo}: a voz não pode usar o SoundTouch`);
    const inside = hits.filter((h) => h / SR / tempo < 30 / tempo - 0.6);
    assert.ok(inside.length >= 40, `tempo ${tempo}: batidas medidas`);
    const worst = Math.max(...deviations(out, inside, tempo).map(Math.abs));
    assert.ok(worst <= 0.05, `tempo ${tempo}: desvio de ${worst.toFixed(3)} ms`);
  }
});

test('o SoundTouch desloca a batida, e o click remontado não (mesma medição)', () => {
  const { data, hits } = clickTrack(30, 0.5);
  const tempo = 1.05;
  const live = play(data, { tempo, seconds: 28 });
  const inside = hits.filter((h) => h / SR / tempo < 27);
  assert.ok(inside.length >= 40);
  const d = deviations(live.out, inside, tempo);
  assert.ok(Math.max(...d) - Math.min(...d) > 1, 'pelo SoundTouch as batidas variam entre si');
});

test('só tom alterado: o click não passa pelo processador', () => {
  const { data, hits } = clickTrack(10, 0.5);
  const r = remountClick(data, data, hits, SR, 1);
  const { voice } = play(data, {
    tempo: 1,
    seconds: 1,
    prepare: (p) => p.port.onmessage({ data: { type: 'rendered', left: r.left, right: r.right, tempo: 1, pitch: 1 } }),
  });
  assert.equal(voice.filter, null);
  assert.equal(voice.rendered, true);
});

test('busca no meio da música continua na batida', () => {
  const { data, hits } = clickTrack(20, 0.5);
  const tempo = 1.1;
  const r = remountClick(data, data, hits, SR, tempo);
  const offsetSamples = Math.round(7.3 * SR);
  const { out } = play(data, {
    tempo,
    seconds: 5,
    offsetSamples,
    prepare: (p) => p.port.onmessage({ data: { type: 'rendered', left: r.left, right: r.right, tempo, pitch: 1 } }),
  });
  const start = Math.round(0.01 * SR);
  const base = Math.floor(offsetSamples / tempo);
  const lead = Math.round(bandLeadSeconds(tempo) * SR);
  const found = onsets(out, Math.round(SR * 0.15));
  const want = hits.filter((h) => h > offsetSamples + SR * 0.1 && h < offsetSamples + SR * 4)
    .map((h) => start + Math.round(h / tempo) - lead - base);
  for (const w of want) {
    const best = found.reduce((b, v) => (Math.abs(v - w) < Math.abs(b - w) ? v : b), Infinity);
    assert.ok(Math.abs(best - w) <= 2, `batida fora por ${best - w} amostras`);
  }
});

test('remontar não cria estalo: sem salto maior que o do próprio click', () => {
  const { data, hits } = clickTrack(12, 0.4);
  let maxStepIn = 0;
  for (let i = 1; i < data.length; i++) maxStepIn = Math.max(maxStepIn, Math.abs(data[i] - data[i - 1]));
  for (const tempo of [0.8, 1.3, 1.6]) {
    const r = remountClick(data, data, hits, SR, tempo);
    let maxStep = 0;
    for (let i = 1; i < r.left.length; i++) maxStep = Math.max(maxStep, Math.abs(r.left[i] - r.left[i - 1]));
    assert.ok(maxStep <= maxStepIn * 1.01, `tempo ${tempo}: salto ${maxStep} contra ${maxStepIn}`);
  }
});

test('batida colada no começo entra com o ataque inteiro', () => {
  const { data, hits } = clickTrack(6, 0.5, 0);
  const r = remountClick(data, data, hits, SR, 1.1);
  let peak = 0;
  for (let i = 0; i < 480; i++) peak = Math.max(peak, Math.abs(r.left[i]));
  assert.ok(peak > 15000, `ataque perdido: pico ${peak}`);
});

test('faixa com voz ou som contínuo não é remontada', () => {
  const n = SR * 8;
  const voice = new Int16Array(n);
  for (let i = 0; i < n; i++) voice[i] = Math.round(9000 * Math.sin(2 * Math.PI * 220 * i / SR) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 3 * i / SR)));
  for (let k = 0; k < 16; k++) for (let i = 0; i < 400; i++) voice[Math.round(k * 0.5 * SR) + i] += Math.round(20000 * Math.exp(-i / 60));
  assert.equal(findClickBeats(voice, voice, SR), null);
  const { data, hits } = clickTrack(8, 0.5);
  const found = findClickBeats(data, data, SR);
  assert.equal(found?.length, hits.length);
  found.forEach((h, i) => assert.ok(Math.abs(h - hits[i]) <= 2));
});

test('a troca para o click remontado cai entre duas batidas', () => {
  const hits = [1000, 25000, 49000];
  assert.equal(quietSwapFrame(hits, 2000), 13000);
  assert.equal(quietSwapFrame(hits, 13001), 37000);
  assert.equal(quietSwapFrame(hits, 60000), 60000);
});

test('o adiantamento da banda segue as janelas do SoundTouch, e não existe no BPM original', () => {
  assert.equal(bandLeadSeconds(1), 0);
  assert.ok(Math.abs(bandLeadSeconds(0.75) - 0.02767) < 1e-4);
  assert.ok(bandLeadSeconds(0.75) > bandLeadSeconds(1.1));
  assert.ok(bandLeadSeconds(1.25) < bandLeadSeconds(0.9));
});

test('click remontado cai na grade: a 1x, cada batida fica na mesma amostra', () => {
  const { data, hits } = clickTrack(8, 0.5);
  const r = remountClick(data, data, hits, SR, 1);
  const found = onsets(r.left, Math.round(SR * 0.15));
  const original = onsets(data, Math.round(SR * 0.15));
  assert.equal(found.length, hits.length);
  found.forEach((v, i) => assert.equal(v, original[i], `batida ${i} saiu do lugar`));
});

test('amostra no início: o ataque cai no instante pedido', () => {
  const len = 400;
  const s = new Float32Array(len);
  for (let i = 66; i < len; i++) s[i] = 0.8 * Math.exp(-(i - 66) / 80);
  const onset = clickOnsetIndex(s);
  assert.equal(onset, 66);
  const [atZero] = placeClickSamples([0], SR, SR, s, s);
  assert.equal(clickOnsetIndex(atZero), 0, 'batida no 0');
  const [early] = placeClickSamples([20 / SR], SR, SR, s, s);
  assert.equal(clickOnsetIndex(early), 20, 'batida antes de caber o começo da amostra');
  const [later] = placeClickSamples([100 / SR], SR, SR, s, s);
  assert.equal(clickOnsetIndex(later), 100, 'batida normal');
});

test('alinhar: mapa levemente errado não mexe em nenhuma batida', () => {
  // click real em 120 BPM, grade em 120,02: a diferença cresce devagar ao longo da música
  const song = { bpm: 120.02 };
  const real = Array.from({ length: 400 }, (_, k) => k * 0.5);
  assert.deepEqual(alignHitsToGrid(real, (t) => nearestGridBeat(song, t)), real);
});

test('alinhar: click inteiro deslocado por igual vai para a grade de uma vez', () => {
  const song = { bpm: 100 };
  const early = Array.from({ length: 60 }, (_, k) => (k + 1) * 0.6 - 0.006);
  alignHitsToGrid(early, (t) => nearestGridBeat(song, t)).forEach((t, i) => assert.ok(Math.abs(t - (i + 1) * 0.6) < 1e-9));
});

test('click importado: Recriar mantém cada batida onde está', () => {
  const beat = 0.5;
  const n = SR * 12;
  const L = new Float32Array(n);
  const real = [];
  // click real, 3 ms deslocado da grade de 120 BPM
  for (let k = 1; k < 22; k++) {
    const h = Math.round((k * beat + 0.003) * SR);
    real.push(h);
    for (let i = 0; i < 1200; i++) L[h + i] = 0.8 * Math.sin(2 * Math.PI * 1800 * i / SR) * Math.exp(-i / SR * 240);
  }
  const song = { bpm: 120, beatsPerBar: 4 };
  const kept = remakeClickTimes([L], 0, n, SR, 0, song, true);
  assert.equal(kept.length, real.length);
  kept.forEach((t, i) => assert.ok(Math.abs(t * SR - real[i]) <= 2, `batida ${i}`));
  const moved = remakeClickTimes([L], 0, n, SR, 0, song);
  moved.forEach((t, i) => assert.ok(Math.abs(t - (i + 1) * beat) < 1e-9), 'sem preservar, vai para a grade');
});

test('click gerado: fica velho quando o mapa muda, importado nunca', () => {
  const song = { bpm: 120, beatsPerBar: 4 };
  const span = { startTime: 0, duration: 30, trimStart: 0, trimEnd: 0 };
  const gerado = { ...span, id: 'g', routingMethod: 'ai', generatedClick: { sound: 'vs', beats: clickBeatsKey(song, span) } };
  const importado = { ...span, id: 'i', routingMethod: 'name' };
  assert.deepEqual(staleGeneratedClicks(song, [gerado, importado]), []);
  const editado = { ...song, tempoSegments: [{ startTime: 0, endTime: 10, bpm: 120 }, { startTime: 10, endTime: 30, bpm: 90 }] };
  assert.ok(tempoMapChanged(song, editado));
  assert.deepEqual(staleGeneratedClicks(editado, [gerado, importado]).map((c) => c.id), ['g']);
  assert.equal(isImportedClick(importado), true);
  assert.equal(isImportedClick(gerado), false);
  assert.equal(isImportedClick({ ...span, routingMethod: 'ai' }), false, 'VS por IA antigo');
  assert.equal(tempoMapChanged(song, { ...song, bpmAdjust: 5 }), false, 'BPM de ajuste não é mapa');
});

test('click gerado: batidas relativas ao clipe e chave igual depois de empurrar tudo', () => {
  const song = { bpm: 120, beatsPerBar: 4 };
  const a = { startTime: 2, duration: 8, trimStart: 0, trimEnd: 0 };
  const times = generatedClickTimes(song, a);
  assert.equal(times[0], 0);
  assert.equal(times.length, 16);
  assert.equal(clickBeatsKey(song, a), clickBeatsKey(song, { ...a, duration: a.duration + 1 / SR }));
});
