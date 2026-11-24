import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTempoSegments, leadInFromMap, singleGridShare } from '../src/lib/tempoFollow.ts';

const SR = 22050;

/** Faixa sintética: um ataque curto em cada batida e o modelo marcando as mesmas batidas. */
function track(parts, shiftModel = 0) {
  const beats = [];
  let at = 0;
  for (const { bpm, seconds } of parts) {
    const period = 60 / bpm, count = Math.round(seconds / period);
    for (let k = 0; k < count; k++) beats.push(at + k * period);
    at += count * period;
  }
  const duration = at + 1;
  const mono = new Float32Array(Math.ceil(duration * SR));
  for (const t of beats) {
    const start = Math.round(t * SR);
    for (let i = 0; i < 220 && start + i < mono.length; i++) mono[start + i] += 0.8 * Math.exp(-i / 40) * (i % 2 ? -1 : 1);
  }
  const frames = Math.ceil(duration * 50), beat = new Float32Array(frames), downbeat = new Float32Array(frames);
  beats.forEach((t, k) => {
    const f = Math.round((t + shiftModel) * 50);
    if (f < 0 || f >= frames) return;
    beat[f] = 0.95;
    if (k % 4 === 0) downbeat[f] = 0.9;
  });
  return { mono, model: { beat, downbeat, fps: 50 }, beats, duration };
}

test('sem click: dois andamentos saem com BPM exato e a troca na batida certa', () => {
  const { mono, model } = track([{ bpm: 140, seconds: 40 }, { bpm: 150, seconds: 40 }]);
  const { segments } = buildTempoSegments(mono, SR, model, 4);
  const bpms = [...new Set(segments.map((s) => s.bpm))];
  assert.deepEqual(bpms, [140, 150]);
  const seam = segments.find((s) => s.bpm === 150).startTime;
  assert.ok(Math.abs(seam - Math.round(40 / (60 / 140)) * (60 / 140)) <= 60 / 140 + 0.01, `troca em ${seam}`);
});

test('sem click: o modelo atrasado alguns ms não muda o BPM nem tira a grade do ataque', () => {
  const { mono, model, beats } = track([{ bpm: 127, seconds: 90 }], 0.03);
  const { segments } = buildTempoSegments(mono, SR, model, 4);
  assert.ok(segments.every((s) => s.bpm === 127), `BPMs ${segments.map((s) => s.bpm)}`);
  const main = segments[segments.length - 1], p = 60 / 127;
  const off = Math.abs(((beats[40] - main.startTime + p / 2) % p + p) % p - p / 2);
  assert.ok(off < 0.008, `grade a ${(off * 1000).toFixed(1)} ms do ataque`);
});

test('entrada do medley: o primeiro 1 cai na cabeça de um compasso inteiro do primeiro andamento', () => {
  const bar = (60 / 140) * 4;
  const lead = leadInFromMap([{ startTime: 0.3, endTime: 40, bpm: 140, downbeat: 0.3 }], 4);
  assert.ok(Math.abs(lead - (bar - 0.3)) < 1e-9);
  assert.ok(Math.abs(leadInFromMap([{ startTime: 0, endTime: 40, bpm: 140, downbeat: 0 }], 4) - bar) < 1e-9);
});

test('BPM único: vale na música reta e não vale no medley', () => {
  const reta = track([{ bpm: 120, seconds: 60 }]);
  const medley = track([{ bpm: 120, seconds: 30 }, { bpm: 131, seconds: 40 }, { bpm: 97, seconds: 40 }]);
  assert.ok(singleGridShare(reta.mono, SR, 120) > 0.9);
  assert.ok(singleGridShare(medley.mono, SR, 120) < 0.62);
});
