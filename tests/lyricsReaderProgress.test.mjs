// Barra da letra sendo lida: o Whisper conta o andamento aos saltos (blocos de 30 s); a barra anda
// de forma contínua entre um salto e outro, nunca volta e não promete o fim antes da hora.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { smoothProgress, wavSeconds } = require('../desktop/lyricsReader.js');

const T0 = 1_000_000;

test('antes de carregar o modelo, a barra fica no que o leitor disse', () => {
  assert.equal(smoothProgress({ pct: 0, shown: 0, loadedAt: 0, reportedAt: 0, audioSec: 200 }, T0 + 5000), 0);
});

test('modelo carregado e ainda sem bloco: anda pela duração da música', () => {
  const cur = { pct: 0.05, shown: 0.05, loadedAt: T0, reportedAt: T0, audioSec: 100 };
  const a = smoothProgress(cur, T0 + 10_000);
  const b = smoothProgress(cur, T0 + 30_000);
  assert.ok(a > 0.05 && b > a, `anda: ${a} -> ${b}`);
  assert.ok(b <= 0.35 + 1e-9, 'não passa muito do último salto');
});

test('depois do primeiro bloco: anda na velocidade medida', () => {
  // 26% em 20 s depois de carregar: ~1,05% por segundo
  const cur = { pct: 0.26, shown: 0.26, loadedAt: T0, reportedAt: T0 + 20_000, audioSec: 45 };
  const v = smoothProgress(cur, T0 + 30_000);
  assert.ok(Math.abs(v - 0.365) < 0.01, `dez segundos depois: ${v}`);
});

test('nunca volta e nunca chega a 100% sozinha', () => {
  const cur = { pct: 0.5, shown: 0.8, loadedAt: T0, reportedAt: T0 + 10_000, audioSec: 60 };
  assert.ok(smoothProgress(cur, T0 + 10_000) >= 0.8, 'não volta');
  const long = { pct: 0.9, shown: 0.9, loadedAt: T0, reportedAt: T0 + 10_000, audioSec: 60 };
  assert.ok(smoothProgress(long, T0 + 999_000) <= 0.97, 'fica abaixo de 97% até o leitor terminar');
});

test('duração do WAV pelo cabeçalho', () => {
  const rate = 48000;
  const ch = 2;
  const seconds = 3;
  const buf = Buffer.alloc(44 + rate * ch * 2 * seconds);
  buf.write('RIFF', 0); buf.write('WAVE', 8); buf.write('fmt ', 12);
  buf.writeUInt32LE(rate * ch * 2, 28);
  buf.write('data', 36); buf.writeUInt32LE(rate * ch * 2 * seconds, 40);
  assert.equal(wavSeconds(buf), 3);
  assert.equal(wavSeconds(Buffer.alloc(4)), 0, 'arquivo quebrado não derruba');
});
