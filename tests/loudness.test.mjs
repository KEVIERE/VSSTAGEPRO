// Medição de loudness (BS.1770 / EBU R128), true peak e limitador com look-ahead.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { integratedLoudness, truePeak, lookaheadLimit, matchGain, dbToGain, gainToDb } from '../src/lib/loudness.ts';

const SR = 48000;
const sine = (freq, dbfs, seconds, phase = 0, sr = SR) => {
  const a = dbToGain(dbfs);
  const x = new Float32Array(Math.round(seconds * sr));
  for (let i = 0; i < x.length; i++) x[i] = a * Math.sin(2 * Math.PI * freq * i / sr + phase);
  return x;
};

test('EBU Tech 3341 caso 1: seno estéreo 1 kHz a -23 dBFS = -23,0 LUFS', () => {
  const x = sine(1000, -23, 20);
  const l = integratedLoudness([x, x], SR);
  assert.ok(Math.abs(l - -23) <= 0.1, `${l.toFixed(2)} LUFS`);
});

test('EBU Tech 3341 caso 2: -33 dBFS = -33,0 LUFS (também em 44,1 kHz)', () => {
  const x = sine(1000, -33, 20);
  assert.ok(Math.abs(integratedLoudness([x, x], SR) - -33) <= 0.1);
  const y = sine(1000, -33, 20, 0, 44100);
  assert.ok(Math.abs(integratedLoudness([y, y], 44100) - -33) <= 0.1);
});

test('gate: silêncio no meio não abaixa a medida (EBU caso 3 simplificado)', () => {
  const loud = sine(1000, -20, 10);
  const x = new Float32Array(loud.length * 2);
  x.set(loud, 0); // 10 s de som + 10 s de silêncio
  const l = integratedLoudness([x, x], SR);
  assert.ok(Math.abs(l - -20) <= 0.2, `${l.toFixed(2)}`);
  assert.equal(integratedLoudness([new Float32Array(SR * 2)], SR), -Infinity);
});

test('Int16 (formato do app) mede igual ao float', () => {
  const x = sine(1000, -23, 10);
  const i16 = Int16Array.from(x, (v) => Math.round(v * 32767));
  assert.ok(Math.abs(integratedLoudness([i16, i16], SR) - integratedLoudness([x, x], SR)) < 0.01);
});

test('true peak acha o pico entre amostras (seno em fs/4 defasado 45°)', () => {
  const x = sine(SR / 4, 0, 1, Math.PI / 4).map((v) => v * 0.9);
  let sample = 0; for (const v of x) sample = Math.max(sample, Math.abs(v));
  const tp = truePeak([x]);
  assert.ok(sample < 0.65, `pico de amostra ${sample}`);
  assert.ok(Math.abs(tp - 0.9) < 0.05, `true peak ${tp}`);
});

test('limitador: nada passa do teto, o que está abaixo não é tocado, sem saltos', () => {
  const x = sine(220, -20, 2);
  // um estouro de 50 ms a +6 dBFS no meio
  for (let i = SR; i < SR + 2400; i++) x[i] *= dbToGain(26);
  const before = x.slice(0, SR / 2);
  const ceiling = dbToGain(-1);
  const worst = lookaheadLimit([x], SR, ceiling);
  let peak = 0; for (const v of x) peak = Math.max(peak, Math.abs(v));
  assert.ok(peak <= ceiling + 1e-6, `pico ${gainToDb(peak).toFixed(2)} dBFS`);
  assert.ok(worst < -6, `redução ${worst.toFixed(1)} dB`);
  for (let i = 0; i < before.length; i++) assert.equal(x[i], before[i]);
  // sem degraus: a variação de ganho por amostra é pequena (nada de clique)
  let maxStep = 0;
  for (let i = SR - 600; i < SR + 3000; i++) {
    maxStep = Math.max(maxStep, Math.abs(x[i + 1] - x[i]));
  }
  assert.ok(maxStep < 0.1, `maior salto entre amostras ${maxStep}`);
});

test('matchGain: leva ao alvo, mas nunca deixa o true peak passar do teto', () => {
  assert.ok(Math.abs(gainToDb(matchGain(-20, 0.2, -14, -1)) - 6) < 1e-9);
  // pico já alto: o ganho para no teto
  const g = matchGain(-20, 0.8, -14, -1);
  assert.ok(Math.abs(0.8 * g - dbToGain(-1)) < 1e-9);
  assert.equal(matchGain(-Infinity, 0, -14, -1), 1);
});
