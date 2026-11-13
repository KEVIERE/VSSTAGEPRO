// Knob de volume das faixas: 0 dB no topo (ponteiro em pé, alinhado ao LED do meio).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, '..', 'src', 'components', 'AnalogPieces.tsx'), 'utf8');

test('0 dB fica no topo do knob', () => {
  assert.match(src, /const UNITY = 0\.5;/);
  assert.match(src, /const pct = volumeToKnob\(value\);/);
});

test('a escala do knob vai e volta igual (0, 0 dB, máximo)', () => {
  // mesmas contas de volumeToKnob/knobToVolume
  const U = 0.5, V = 0.8, M = 1.5;
  const vk = (v) => (v <= V ? (v / V) * U : U + ((v - V) / (M - V)) * (1 - U));
  const kv = (p) => (p <= U ? (p / U) * V : V + ((p - U) / (1 - U)) * (M - V));
  assert.equal(vk(0.8), 0.5);
  assert.equal(vk(0), 0);
  assert.equal(vk(1.5), 1);
  for (const v of [0, 0.3, 0.8, 1.1, 1.5]) assert.ok(Math.abs(kv(vk(v)) - v) < 1e-9, String(v));
  assert.match(src, /export function volumeToKnob/);
  assert.match(src, /export function knobToVolume/);
});
