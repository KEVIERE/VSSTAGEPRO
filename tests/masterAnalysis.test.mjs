// Medidas de engenharia usadas pela masterização: espectro em terços de oitava, LRA, PLR, estéreo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { measureAudio, longTermSpectrum, THIRD_OCTAVES, fft } from '../src/lib/masterAnalysis.ts';
import { dbToGain } from '../src/lib/loudness.ts';

const SR = 48000;
const sine = (freq, dbfs, seconds, sr = SR) => {
  const a = dbToGain(dbfs);
  return Float32Array.from({ length: Math.round(seconds * sr) }, (_, i) => a * Math.sin((2 * Math.PI * freq * i) / sr));
};
const band = (hz) => Math.round(17 + 3 * Math.log2(hz / 1000));

test('FFT: seno cai no próprio bin, com a energia de Parseval', () => {
  const n = 1024;
  const re = Float64Array.from({ length: n }, (_, i) => Math.cos((2 * Math.PI * 64 * i) / n));
  const im = new Float64Array(n);
  fft(re, im);
  const mag = (k) => Math.hypot(re[k], im[k]);
  assert.ok(Math.abs(mag(64) - n / 2) < 1e-6);
  assert.ok(mag(63) < 1e-6 && mag(65) < 1e-6);
});

test('espectro: um seno de 1 kHz aparece no terço de 1 kHz, 30 dB acima de 2 oitavas longe', () => {
  const x = sine(1000, -20, 4);
  const s = longTermSpectrum([x, x], SR);
  const k = band(1000);
  assert.equal(THIRD_OCTAVES[k], 1000);
  assert.ok(s.midDb[k] - s.midDb[k + 6] > 30 && s.midDb[k] - s.midDb[k - 6] > 30);
  // L = R: nada no lado
  assert.ok(s.midDb[k] - s.sideDb[k] > 100);
});

test('LRA (EBU Tech 3342 caso 1): 20 s a -20 dBFS + 20 s a -30 dBFS = 10 LU', () => {
  const x = new Float32Array(SR * 40);
  x.set(sine(1000, -20, 20), 0);
  x.set(sine(1000, -30, 20), SR * 20);
  const m = measureAudio([x, x], SR);
  assert.ok(Math.abs(m.lra - 10) <= 1, `LRA ${m.lra.toFixed(2)}`);
});

test('PLR, correlação e grave fora do centro de casos conhecidos', () => {
  const x = sine(1000, -23, 10);
  const m = measureAudio([x, x], SR);
  assert.ok(Math.abs(m.lufs - -23) < 0.1);
  assert.ok(Math.abs(m.plr - 0) < 0.2, `PLR ${m.plr.toFixed(2)}`);
  assert.ok(m.correlation > 0.999);
  const y = sine(60, -20, 4);
  const inv = Float32Array.from(y, (v) => -v);
  const w = measureAudio([y, inv], SR);
  assert.ok(w.correlation < -0.999);
  assert.ok(w.lowSideToMidDb > 50, 'grave todo fora de fase: tudo no lado');
  assert.equal(measureAudio([y, y], SR).overs, 0);
});
