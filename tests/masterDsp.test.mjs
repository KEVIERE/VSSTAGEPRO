// Blocos de processamento da masterização: filtros, divisor de bandas, limitador e medidas em blocos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FilterChain, applyBlockGains, biquadDb, designBiquad, limiterGains, loudnessLean, multibandCompress,
  truePeakBlocks, truePeakPrecise,
} from '../src/lib/masterDsp.ts';
import { fft } from '../src/lib/masterAnalysis.ts';
import { integratedLoudness, truePeak, dbToGain, gainToDb } from '../src/lib/loudness.ts';

const SR = 48000;
function rng(seed) { let s = seed; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32 * 2 - 1; }; }

test('biquad: a resposta calculada bate com a medida num seno', () => {
  const f = designBiquad('peaking', 1000, SR, 1, 6);
  assert.ok(Math.abs(biquadDb(f, 1000, SR) - 6) < 0.01);
  const x = Float32Array.from({ length: SR }, (_, i) => Math.sin((2 * Math.PI * 1000 * i) / SR));
  new FilterChain([f]).run(x);
  let peak = 0;
  for (let i = SR / 2; i < SR; i++) peak = Math.max(peak, Math.abs(x[i]));
  assert.ok(Math.abs(gainToDb(peak) - 6) < 0.05, `${gainToDb(peak).toFixed(3)} dB`);
  // prateleiras chegam ao ganho pedido longe do corte
  assert.ok(Math.abs(biquadDb(designBiquad('highshelf', 2000, SR, 0.7, 3), 15000, SR) - 3) < 0.1);
  assert.ok(Math.abs(biquadDb(designBiquad('lowshelf', 200, SR, 0.7, -4), 30, SR) - -4) < 0.1);
});

test('divisor de 3 bandas sem compressão: a soma fica plana (±0,05 dB de 20 Hz a 20 kHz)', () => {
  const n = 1 << 15;
  const imp = new Float32Array(n);
  imp[0] = 1;
  const flat = { thresholdDb: 0, ratio: 1, kneeDb: 1, attackMs: 10, releaseMs: 100, maxGrDb: 0 };
  multibandCompress([imp], SR, [140, 4500], [flat, flat, flat]);
  const re = Float64Array.from(imp), im = new Float64Array(n);
  fft(re, im);
  for (let k = Math.round((20 * n) / SR); k < Math.round((20000 * n) / SR); k++) {
    const db = 20 * Math.log10(Math.hypot(re[k], im[k]));
    assert.ok(Math.abs(db) < 0.05, `${((k * SR) / n).toFixed(0)} Hz: ${db.toFixed(3)} dB`);
  }
});

test('limitador: nenhuma amostra passa do teto, nem com a música começando forte', () => {
  const rand = rng(3);
  const n = SR * 3;
  const base = Float32Array.from({ length: n }, (_, i) => 0.3 * Math.sin((2 * Math.PI * 80 * i) / SR) + 0.1 * rand() + (i % 9000 < 40 ? 0.6 * rand() : 0));
  for (const gainDb of [0, 6, 12, 18]) {
    const x = Float32Array.from(base);
    const ceil = dbToGain(-1.15);
    const g = limiterGains(truePeakBlocks([x]), SR, dbToGain(gainDb), ceil);
    for (const v of g) assert.ok(v <= 1 && v > 0);
    applyBlockGains([x], g, dbToGain(gainDb));
    let sp = 0;
    for (const v of x) sp = Math.max(sp, Math.abs(v));
    assert.ok(sp <= ceil * 1.0001, `ganho ${gainDb} dB: pico ${gainToDb(sp).toFixed(2)} dBFS`);
  }
});

test('limitador: pico isolado não abaixa o resto da música', () => {
  const n = SR * 2;
  const x = Float32Array.from({ length: n }, (_, i) => 0.2 * Math.sin((2 * Math.PI * 440 * i) / SR));
  x[SR] = 1.5;
  const g = limiterGains(truePeakBlocks([x]), SR, 1, dbToGain(-1));
  // 100 ms depois do pico o ganho já voltou a menos de 0,2 dB
  const after = Math.round((SR + 0.1 * SR) / 16);
  assert.ok(gainToDb(g[after]) > -0.2, `${gainToDb(g[after]).toFixed(2)} dB`);
  assert.equal(g[10], 1);
});

test('loudness por blocos (sem cópia do áudio) = loudness integrado do BS.1770', () => {
  const rand = rng(9);
  for (const sr of [48000, 44100]) {
    const L = Float32Array.from({ length: sr * 8 }, (_, i) => 0.2 * Math.sin((2 * Math.PI * 300 * i) / sr) * (i > sr * 4 ? 1 : 0.3) + 0.05 * rand());
    const R = Float32Array.from(L, (v, i) => v * 0.8 + 0.02 * Math.sin(i / 7));
    assert.ok(Math.abs(loudnessLean([L, R], sr) - integratedLoudness([L, R], sr)) < 0.05);
  }
});

test('pico real fino (8×) acha o pico entre amostras e nunca fica abaixo do de 4×', () => {
  // rampa de 10 ms nas pontas: um seno que começa "do nada" tem sobressinal de verdade
  const fade = (x) => { for (let i = 0; i < 480; i++) { const g = 0.5 - 0.5 * Math.cos((Math.PI * i) / 480); x[i] *= g; x[x.length - 1 - i] *= g; } return x; };
  for (const f of [SR / 4, 15000, 20000]) {
    const x = fade(Float32Array.from({ length: SR }, (_, i) => 0.9 * Math.sin((2 * Math.PI * f * i) / SR + Math.PI / 4)));
    assert.ok(Math.abs(gainToDb(truePeakPrecise([x]) / 0.9)) < 0.05, `${f} Hz: ${truePeakPrecise([x]).toFixed(4)}`);
  }
  const rand = rng(5);
  const y = Float32Array.from({ length: SR }, () => 0.5 * rand());
  assert.ok(truePeakPrecise([y]) >= truePeak([y]) - 1e-3);
});
