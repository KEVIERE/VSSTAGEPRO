// Masterização de clipe: mantém o loudness, limita o pico real em -1 dBTP, comprime só o forte.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { masterChannels } from '../src/lib/mastering.ts';
import { integratedLoudness, truePeak, gainToDb } from '../src/lib/loudness.ts';

const SR = 48000;
// "música" sintética: tom com ataques fortes a cada 0,5 s (picos acima de 0 dBFS de propósito)
function song(seconds, peakDb) {
  const n = SR * seconds;
  const L = new Float32Array(n), R = new Float32Array(n);
  const a = Math.pow(10, peakDb / 20);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const hit = Math.exp(-((t % 0.5) * 30));
    const v = (0.25 + 0.75 * hit) * Math.sin(2 * Math.PI * 180 * t) + 0.1 * Math.sin(2 * Math.PI * 2500 * t);
    L[i] = a * v * 0.8; R[i] = a * v * 0.75;
  }
  return [L, R];
}

test('instrumento estourando: sai com o mesmo loudness, pico real ≤ -1 dBTP e sem NaN', () => {
  const ch = song(8, 2);
  const { channels, report } = masterChannels(ch, SR, { vocal: false });
  assert.ok(report.peakBeforeDbtp > 0, `entrada estourada ${report.peakBeforeDbtp.toFixed(2)}`);
  assert.ok(gainToDb(truePeak(channels)) <= -1 + 0.05, `pico final ${report.peakAfterDbtp.toFixed(2)} dBTP`);
  // só perde o que o estouro obriga (pico de +2 dBTP descendo para -1 dBTP)
  const allowed = Math.max(1, report.peakBeforeDbtp - -1);
  assert.ok(report.lufsBefore - report.lufsAfter <= allowed, `loudness ${report.lufsBefore.toFixed(1)} → ${report.lufsAfter.toFixed(1)}`);
  assert.ok(report.compressionDb < -0.5, `comprimiu ${report.compressionDb.toFixed(1)} dB`);
  for (const c of channels) for (const v of c) assert.ok(Number.isFinite(v));
});

test('voz baixa: não é empurrada nem esmagada, só polida', () => {
  const ch = song(6, -18);
  const { report } = masterChannels(ch, SR, { vocal: true });
  assert.ok(Math.abs(report.lufsAfter - report.lufsBefore) <= 1.0);
  assert.ok(report.peakAfterDbtp <= -1 + 0.05);
});

test('masterizar de novo não acumula: segunda passada quase não muda nada', () => {
  const once = masterChannels(song(6, 0), SR, { vocal: false });
  const twice = masterChannels(once.channels, SR, { vocal: false });
  assert.ok(Math.abs(twice.report.lufsAfter - once.report.lufsAfter) < 0.5);
  assert.ok(twice.report.peakAfterDbtp <= -1 + 0.05);
});

test('silêncio fica silêncio', () => {
  const z = [new Float32Array(SR), new Float32Array(SR)];
  const { channels } = masterChannels(z, SR, { vocal: false });
  assert.equal(Math.max(...channels[0]), 0);
  assert.equal(integratedLoudness(channels, SR), -Infinity);
});
