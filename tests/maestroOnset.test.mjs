// A fala do Maestro tem de começar na linha da grade, junto com o click: nada de espaço antes e
// nada de rampa longa abafando a primeira sílaba (era o atraso percebido na contagem).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { floatToWav, trimSilence } = require('../desktop/maestroAudio.js');

/** Onde o primeiro som passa de -54 dBFS, em ms. */
function onsetMs(wav) {
  const rate = wav.readUInt32LE(24);
  const total = Math.floor(wav.readUInt32LE(40) / 2);
  for (let i = 0; i < total; i++) if (Math.abs(wav.readInt16LE(44 + i * 2)) > 200) return (i / rate) * 1000;
  return Infinity;
}

test('a contagem começa na própria amostra da voz (sem folga antes)', () => {
  const rate = 24000;
  const s = new Float32Array(Math.round(rate * 0.4));
  const onset = Math.round(rate * 0.1); // a voz começa em 100 ms
  for (let i = onset; i < s.length - 200; i++) s[i] = 0.5 * Math.sin(i / 7);
  const out = trimSilence(floatToWav(s, rate), { tightStart: true });
  // entra no máximo 2 ms antes (o necessário para não cortar a onda), nunca depois
  assert.ok(onsetMs(out) <= 2.5, `começa em ${onsetMs(out).toFixed(2)} ms`);
  assert.ok(onsetMs(out) >= 0, 'começa dentro do clipe, nunca antes da linha da grade');
});

test('a fala começa no início do clipe nos dois modos de corte', () => {
  const rate = 24000;
  const s = new Float32Array(Math.round(rate * 0.4));
  const onset = Math.round(rate * 0.1);
  for (let i = onset; i < s.length - 200; i++) s[i] = 0.5 * Math.sin(i / 7);
  const wav = floatToWav(s, rate);
  for (const opts of [{}, { tightStart: true }]) {
    const out = trimSilence(wav, opts);
    assert.ok(onsetMs(out) <= 2.5, `${JSON.stringify(opts)}: começa em ${onsetMs(out).toFixed(2)} ms`);
  }
});

test('o motor usa rampa curta nas falas do Maestro e a normal no resto', () => {
  const src = fs.readFileSync(path.join(here, '..', 'src', 'lib', 'audioEngine.ts'), 'utf8');
  assert.match(src, /export function isSpeechTrack\(/, 'existe a distinção de fala');
  assert.match(src, /track\.id === MAESTRO_IA_TRACK_ID \|\| track\.parentId === 'track-maestro'/, 'cobre a subfaixa do Maestro');
  assert.match(src, /fadeInFrames: isSpeech \?/, 'a rampa de entrada depende de ser fala');
  // a rampa de 512 frames (10 ms a 48 kHz) só vale para música
  assert.match(src, /: \(fastSeek \? 1024 : 512\)/, 'música continua com a rampa de sempre');
});
