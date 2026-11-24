// Fase da grade, BPM quase igual, compasso de passagem, rall e salto de loop com troca de BPM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import {
  buildTempoSegments, extendToStart, finalizeTempoMap, isFinalRitOnly, leadInFromMap,
  placeAiTempoMap, plainGridBeforeRit, realTempoChanges,
} from '../src/lib/tempoFollow.ts';
import { clickGridTimes } from '../src/lib/clickEdit.ts';

const SR = 22050;
const nearest = (grid, t) => grid.reduce((m, g) => Math.min(m, Math.abs(g - t)), Infinity);

/** Faixa com um ataque em cada batida: `attack` é o tempo de subida da nota (0 = batida seca). */
function track(beats, seconds, { attack = 0.001, hz = 700 } = {}) {
  const x = new Float32Array(Math.ceil(seconds * SR));
  const up = Math.max(1, Math.round(attack * SR)), size = Math.round(0.22 * SR);
  for (const t of beats) {
    const at = Math.round(t * SR);
    for (let i = 0; i < size && at + i < x.length; i++) {
      const env = Math.min(1, i / up) * Math.exp(-i / (0.06 * SR));
      x[at + i] += 0.5 * env * Math.sin((2 * Math.PI * hz * i) / SR);
    }
  }
  return x;
}

/** Ativações de um modelo que marca cada batida. */
function modelOf(beats, seconds, shift = 0) {
  const n = Math.ceil(seconds * 50) + 10;
  const beat = new Float32Array(n), downbeat = new Float32Array(n);
  beats.forEach((t, k) => {
    const i = Math.round((t + shift) * 50);
    if (i < 1 || i >= n - 1) return;
    beat[i] = 1; beat[i - 1] = Math.max(beat[i - 1], 0.4); beat[i + 1] = Math.max(beat[i + 1], 0.4);
    if (k % 4 === 0) downbeat[i] = 1;
  });
  return { beat, downbeat, fps: 50 };
}

const run = (from, bpm, count) => Array.from({ length: count }, (_, k) => from + (k * 60) / bpm);

// ---------- fase quando a batida cai logo antes de um múltiplo do período ----------

for (const bpm of [105, 140, 174]) {
  for (const d of [0.005, 0.015, 0.025]) {
    test(`batida ${d * 1000} ms antes de um múltiplo do período a ${bpm} BPM: a grade não anda`, () => {
      const p = 60 / bpm, first = p - d, dur = 180;
      const segs = extendToStart([{ startTime: first + 4 * p, endTime: dur, bpm, downbeat: first + 4 * p }], 4);
      assert.equal(segs.length, 2, 'há o trecho colado no 0:00');
      const map = finalizeTempoMap(segs, { duration: dur, beatsPerBar: 4, keepSingle: true });
      const grid = clickGridTimes({ bpm: map.bpm, beatsPerBar: 4, tempoSegments: map.tempoSegments }, dur);
      for (let t = first; t < dur - 1; t += p) assert.ok(nearest(grid, t) < 1e-6, `batida ${t}`);

      // VS por IA: a entrada põe o 1 numa cabeça de compasso e a grade simples passa pelas mesmas batidas
      const placed = placeAiTempoMap(map.tempoSegments, null, 4, dur);
      assert.equal(placed.tempoSegments, undefined);
      const simple = clickGridTimes({ bpm, beatsPerBar: 4 }, dur + placed.leadIn);
      for (let t = first; t < dur - 1; t += p * 7) assert.ok(nearest(simple, t + placed.leadIn) < 1e-6, `entrada ${placed.leadIn}`);
    });
  }
}

test('o 1 colado antes do começo do arquivo continua sendo o primeiro compasso', () => {
  const beat = 60 / 127, bar = 4 * beat, d = 0.015;
  const main = { startTime: beat - d, endTime: 200, bpm: 127, downbeat: bar - d, barOffset: 3 };
  assert.ok(Math.abs(leadInFromMap([main], 4) - (bar + d)) < 1e-9);
});

test('ritardando: a batida colada no 0:00 não desloca o corpo da música', () => {
  const beat = 60 / 140, d = 0.02, first = beat - d;
  const stub = { startTime: 0, endTime: first, bpm: 140, downbeat: 0 };
  const body = { startTime: first, endTime: 190, bpm: 140, downbeat: first + 3 * beat, barOffset: 3 };
  const rit = [{ startTime: 190, endTime: 192, bpm: 128, downbeat: 190, rit: true }, { startTime: 192, endTime: 200, bpm: 110, downbeat: 192, rit: true }];
  const placed = placeAiTempoMap([stub, body, ...rit], null, 4, 200);
  const grid = clickGridTimes({ bpm: 140, beatsPerBar: 4, tempoSegments: placed.tempoSegments }, 200 + placed.leadIn);
  for (let k = 0; first + k * beat < 189; k += 5) assert.ok(nearest(grid, first + k * beat + placed.leadIn) < 1e-6, `batida ${k}`);
});

// ---------- BPM quase igual ----------

test('0,25 BPM de diferença em trechos longos é troca de verdade', () => {
  const map = [{ startTime: 0, endTime: 110, bpm: 127 }, { startTime: 110, endTime: 240, bpm: 127.25 }];
  assert.deepEqual(realTempoChanges(map), [1]);
  // a mesma diferença numa ponta curta não desloca a grade além da folga
  assert.deepEqual(realTempoChanges([{ startTime: 0, endTime: 0.47, bpm: 127 }, { startTime: 0.47, endTime: 240, bpm: 127.05 }]), []);
  assert.deepEqual(realTempoChanges([{ startTime: 0, endTime: 120, bpm: 127 }, { startTime: 120, endTime: 240, bpm: 127 }]), []);
});

test('corpo em dois andamentos próximos não vira uma reta só antes do ritardando', () => {
  const map = [
    { startTime: 0, endTime: 100, bpm: 140, downbeat: 0 },
    { startTime: 100, endTime: 190, bpm: 140.27, downbeat: 100 },
    { startTime: 190, endTime: 192, bpm: 127, downbeat: 190, rit: true },
    { startTime: 192, endTime: 200, bpm: 110, downbeat: 192, rit: true },
  ];
  assert.equal(isFinalRitOnly(map), false);
  const placed = placeAiTempoMap(map, null, 4, 200);
  assert.deepEqual(placed.tempoSegments.map((s) => s.bpm), [140, 140.27, 127, 110]);
  assert.ok(Math.abs(placed.tempoSegments[1].startTime - (100 + placed.leadIn)) < 1e-9);
});

test('reta única até o ritardando usa o trecho maior do corpo', () => {
  const lead = (60 / 140) * 4;
  const out = plainGridBeforeRit([
    { startTime: lead, endTime: lead + 0.4, bpm: 140.01, downbeat: lead },
    { startTime: lead + 0.4, endTime: 190, bpm: 140, downbeat: lead + 0.4 },
    { startTime: 190, endTime: 200, bpm: 110, downbeat: 190, rit: true },
  ]);
  assert.equal(out[0].bpm, 140);
  assert.equal(out[0].startTime, 0);
});

test('subida de 0,25 BPM no meio da música: dois trechos, com a troca no lugar certo', () => {
  const a = run(0.5, 127, 124);
  const last = a[a.length - 1] + 60 / 127;
  const b = run(last, 127.25, 140);
  const beats = [...a, ...b];
  const seconds = beats[beats.length - 1] + 1;
  const { segments } = buildTempoSegments(track(beats, seconds), SR, modelOf(beats, seconds), 4);
  const bpms = segments.map((s) => s.bpm);
  assert.ok(bpms.some((v) => Math.abs(v - 127) < 0.02), `BPMs ${bpms}`);
  assert.ok(bpms.some((v) => Math.abs(v - 127.25) < 0.05), `BPMs ${bpms}`);
  const seam = segments.find((s) => Math.abs(s.bpm - 127.25) < 0.05).startTime;
  assert.ok(Math.abs(seam - last) < 5, `troca em ${seam}, real ${last}`);
  const grid = clickGridTimes({ bpm: 127, beatsPerBar: 4, tempoSegments: segments }, seconds);
  const worst = Math.max(...beats.map((t) => nearest(grid, t)));
  assert.ok(worst < 0.012, `pior batida ${worst * 1000} ms`);
});

// ---------- fase sem bateria ----------

test('nota de ataque lento: a grade cai na batida, e não no começo da subida', () => {
  const beats = run(0.8, 105, 170);
  const seconds = beats[beats.length - 1] + 1;
  // a nota começa 18 ms antes da batida e chega ao topo depois dela
  const early = beats.map((t) => t - 0.018);
  const x = track(early, seconds, { attack: 0.045, hz: 500 });
  const { segments } = buildTempoSegments(x, SR, modelOf(beats, seconds), 4);
  const grid = clickGridTimes({ bpm: segments[0].bpm, beatsPerBar: 4, tempoSegments: segments.length > 1 ? segments : [...segments, { ...segments[0], startTime: segments[0].endTime, endTime: seconds + 1 }] }, seconds);
  const errs = beats.slice(4, -4).map((t) => nearest(grid, t)).sort((a, b) => a - b);
  assert.ok(errs[errs.length >> 1] < 0.009, `erro mediano ${errs[errs.length >> 1] * 1000} ms`);
});

// ---------- compasso de passagem ----------

test('um compasso a 147 entre 143 e 148 aparece no mapa', () => {
  const a = run(0.4, 143, 72);
  const t0 = a[a.length - 1] + 60 / 143;
  const bridge = run(t0, 147, 4);
  const t1 = t0 + (4 * 60) / 147;
  const b = run(t1, 148, 140);
  const beats = [...a, ...bridge, ...b];
  const seconds = beats[beats.length - 1] + 1;
  const { segments } = buildTempoSegments(track(beats, seconds), SR, modelOf(beats, seconds), 4);
  const bpms = segments.map((s) => s.bpm);
  const middle = segments.find((s) => Math.abs(s.bpm - 147) < 0.3);
  assert.ok(middle, `BPMs ${bpms}`);
  assert.ok(Math.abs(middle.startTime - t0) < 0.01);
  const grid = clickGridTimes({ bpm: 148, beatsPerBar: 4, tempoSegments: segments }, seconds);
  const worst = Math.max(...beats.map((t) => nearest(grid, t)));
  assert.ok(worst < 0.004, `pior batida ${worst * 1000} ms`);
});

test('troca direta de andamento não inventa compasso de passagem', () => {
  const a = run(0.4, 143, 72);
  const b = run(a[a.length - 1] + 60 / 143, 148, 140);
  const beats = [...a, ...b];
  const seconds = beats[beats.length - 1] + 1;
  const { segments } = buildTempoSegments(track(beats, seconds), SR, modelOf(beats, seconds), 4);
  // o trecho de uma batida colado no 0:00 tem o mesmo BPM do primeiro
  assert.deepEqual([...new Set(segments.map((s) => Math.round(s.bpm)))], [143, 148]);
  assert.equal(realTempoChanges(segments).length, 1);
});

test('corpo de um andamento só continua em um trecho', () => {
  const beats = run(0.4, 127, 260);
  const seconds = beats[beats.length - 1] + 1;
  const map = finalizeTempoMap(buildTempoSegments(track(beats, seconds), SR, modelOf(beats, seconds), 4).segments, { duration: seconds, beatsPerBar: 4, keepSingle: true });
  assert.equal(realTempoChanges(map.tempoSegments ?? []).length, 0);
  assert.equal(map.bpm, 127);
});

// ---------- salto de loop com troca de BPM marcada ----------

const Q = 128, WSR = 48000;
const soundtouch = readFileSync(new URL('../src/lib/soundtouch.vendor.js', import.meta.url), 'utf8').replace(/export\s*\{[^}]*\}\s*;?/g, '');
const processor = readFileSync(new URL('../src/lib/clipPlayerProcessor.js', import.meta.url), 'utf8');

function player() {
  const sb = { currentTime: 0, sampleRate: WSR, Float32Array, Int16Array, Math, Number, console };
  sb.AudioWorkletProcessor = class { constructor() { this.port = { onmessage: null, postMessage: () => {} }; } };
  sb.registerProcessor = (_, cls) => { sb.cls = cls; };
  vm.createContext(sb);
  vm.runInContext(`${soundtouch}\n${processor}`, sb);
  const frames = WSR * 6;
  const left = new Int16Array(frames);
  for (let i = 0; i < frames; i++) left[i] = (i % 30000) + 1;
  const proc = new sb.cls({ processorOptions: { sampleRate: WSR, primeTargetFrames: 1024, left, right: left, offsetSamples: 0, startTime: 0, tempo: 1, pitch: 1 } });
  const out = [];
  proc.port.onmessage({ data: { startTime: 0 } });
  return {
    send: (m) => proc.port.onmessage({ data: m }),
    run: (blocks) => {
      for (let q = 0; q < blocks; q++) {
        const L = new Float32Array(Q), R = new Float32Array(Q);
        proc.process([], [[L, R]]);
        out.push(...L);
        sb.currentTime += Q / WSR;
      }
    },
    at: (t) => Math.round(out[Math.round(t * WSR)] * 32767),
    get time() { return sb.currentTime; },
  };
}

test('salto marcado atrás de uma troca de BPM acontece depois dela', () => {
  const pl = player();
  pl.run(20);
  const now = pl.time, retimeAt = now + 0.02, jumpAt = now + 0.05;
  pl.send({ type: 'retime', tempo: 1, pitch: 1, process: false, at: retimeAt, offsetSamples: Math.round(retimeAt * WSR), crossfadeFrames: 64 });
  pl.send({ type: 'jump', at: jumpAt, resumeAt: jumpAt, offsetSamples: 1000, crossfadeFrames: 64, afterRetime: true });
  pl.run(40);
  const after = jumpAt + 0.01;
  assert.equal(pl.at(after), 1000 + Math.round((after - jumpAt) * WSR) + 1, 'a música voltou para o começo do loop');
});

test('salto comum continua substituindo o que estava marcado', () => {
  const pl = player();
  pl.run(20);
  const now = pl.time;
  pl.send({ type: 'jump', at: now + 0.02, resumeAt: now + 0.02, offsetSamples: 5000, crossfadeFrames: 64 });
  pl.send({ type: 'jump', at: now + 0.03, resumeAt: now + 0.03, offsetSamples: 9000, crossfadeFrames: 64 });
  pl.run(40);
  const t = now + 0.05;
  assert.equal(pl.at(t), 9000 + Math.round((t - (now + 0.03)) * WSR) + 1);
});

test('cancelar tira também o salto que estava na fila', () => {
  const pl = player();
  pl.run(20);
  const now = pl.time, retimeAt = now + 0.02;
  pl.send({ type: 'retime', tempo: 1, pitch: 1, process: false, at: retimeAt, offsetSamples: Math.round(retimeAt * WSR), crossfadeFrames: 64 });
  pl.send({ type: 'jump', at: now + 0.04, resumeAt: now + 0.04, offsetSamples: 1000, crossfadeFrames: 64, afterRetime: true });
  pl.send({ type: 'cancelJump' });
  pl.run(40);
  const t = now + 0.06;
  assert.equal(pl.at(t), Math.round(t * WSR) + 1);
});

test('o motor deixa o salto acontecer antes de uma troca que cairia depois dele', () => {
  const engine = readFileSync(new URL('../src/lib/audioEngine.ts', import.meta.url), 'utf8');
  const retime = engine.slice(engine.indexOf('private retimeLive('), engine.indexOf('private retimeTimer'));
  assert.match(retime, /jumpComesFirst\(song, at\)/);
  assert.match(retime, /armJumpBehindRetime\(song, at\)/);
  assert.ok(retime.indexOf('jumpComesFirst') < retime.indexOf('disarmLoop(false)'), 'o salto marcado não pode ser desarmado antes da conferência');
  assert.match(engine, /afterRetime/);
});

test('rall com o modelo marcando pulsos na cauda do acorde final continua sendo rall', async () => {
  const { followEndingRit } = await import('../src/lib/tempoFollow.ts');
  const p = 0.5, start = 100;
  const body = Array.from({ length: Math.floor(start / p) + 1 }, (_, k) => start - k * p).reverse();
  const bars = [0.54, 0.62];
  const slow = [];
  let t = start;
  for (const len of bars) for (let k = 0; k < 4; k++) { t += len; slow.push(t); }
  const all = [...body, ...slow];
  const seconds = t + 6;
  const mono = track(all, seconds, { hz: 520 });
  // acorde final soando
  const at = Math.round(t * SR);
  for (let i = 0; i < 4 * SR && at + i < mono.length; i++) mono[at + i] += 0.3 * Math.exp(-i / (1.2 * SR)) * Math.sin((2 * Math.PI * 330 * i) / SR);
  const n = Math.ceil(seconds * 50) + 10;
  const beat = new Float32Array(n), downbeat = new Float32Array(n);
  const mark = (v) => { const i = Math.round(v * 50); if (i >= 0 && i < n) beat[i] = 1; };
  body.forEach((v, k) => { if (k % 2 === 0) mark(v); });
  // o modelo segue a desaceleração e ainda marca dois pulsos na cauda do acorde final
  [1, 3, 5, 7].forEach((k) => mark(slow[k]));
  mark(t + 0.5); mark(t + 1);
  const seg = { startTime: 0, endTime: seconds, bpm: 120, downbeat: 0 };
  const out = followEndingRit(mono, SR, { beat, downbeat, fps: 50 }, [seg], 4);
  assert.ok(out.some((s) => s.rit), `trechos ${out.map((s) => s.bpm)}`);
});
