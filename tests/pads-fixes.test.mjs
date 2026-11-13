// Correções dos pads do Modo Show: proteção de pico da soma (sem atraso) e saída de bloco mínimo
// só aberta quando há som em algum pad, parando fora do Modo Show depois que tudo silencia.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  FADE_SECONDS, PAD_CLIP_KNEE, PAD_CLIP_RANGE, delayAmount, delaySeconds, padClipCurve, padSoftClip,
} from '../src/lib/samplePads.ts';

const player = fs.readFileSync(new URL('../src/lib/padPlayer.ts', import.meta.url), 'utf8');

/** O que o WaveShaper faz com a curva: lê de -1 a 1, interpola entre os pontos e trava nas pontas. */
function shape(curve, u) {
  const n = curve.length;
  const v = 0.5 * (u + 1) * (n - 1);
  if (v <= 0) return curve[0];
  if (v >= n - 1) return curve[n - 1];
  const i = Math.floor(v);
  const f = v - i;
  return (1 - f) * curve[i] + f * curve[i + 1];
}

test('proteção de pico: até -1 dBFS o som passa igual; acima, dobra suave e nunca passa de 0 dBFS', () => {
  assert.ok(Math.abs(20 * Math.log10(PAD_CLIP_KNEE) + 1) < 1e-9);
  for (const x of [0, 0.001, -0.25, 0.5, -0.8, PAD_CLIP_KNEE, -PAD_CLIP_KNEE]) assert.equal(padSoftClip(x), x);
  let last = 0;
  for (let x = 0; x <= 20; x += 0.01) {
    const y = padSoftClip(x);
    assert.ok(y <= 1, `nunca passa de 0 dBFS (${x})`);
    assert.ok(y >= last - 1e-12, 'mais forte nunca sai mais baixo');
    assert.equal(padSoftClip(-x), -y, 'igual para cima e para baixo');
    last = y;
  }
  // sem degrau no começo da dobra
  const e = 1e-6;
  assert.ok(Math.abs((padSoftClip(PAD_CLIP_KNEE + e) - padSoftClip(PAD_CLIP_KNEE)) / e - 1) < 1e-3);
  assert.ok(padSoftClip(4.6) > 0.99, 'roll + delay no máximo (+13 dB) fica colado em 0 dBFS, sem estourar');
});

test('curva do WaveShaper: silêncio continua silêncio, o som normal passa igual e o pico fica em 0 dBFS', () => {
  const curve = padClipCurve();
  assert.equal(curve.length % 2, 1, 'zero bem no meio');
  assert.equal(curve[(curve.length - 1) / 2], 0);
  assert.equal(curve[0], -1);
  assert.equal(curve[curve.length - 1], 1);
  assert.equal(padClipCurve(4).length, 5);
  for (let x = -12; x <= 12; x += 0.0137) {
    const y = shape(curve, x / PAD_CLIP_RANGE);
    assert.ok(Math.abs(y) <= 1, `nunca passa de 0 dBFS (${x})`);
    if (Math.abs(x) <= PAD_CLIP_KNEE) assert.ok(Math.abs(y - x) < 1e-6, `abaixo de -1 dBFS passa igual (${x})`);
    else if (Math.abs(x) <= PAD_CLIP_RANGE) assert.ok(Math.abs(y - padSoftClip(x)) < 1e-5, `segue a dobra (${x})`);
  }
});

test('motor dos pads: proteção no fim da soma, sem atraso a mais, e o bloco mínimo continua', () => {
  assert.match(player, /new AudioContext\(\{ latencyHint: 0 \}\)/);
  assert.match(player, /bus\.connect\(low\)\.connect\(high\)\.connect\(clipIn\)\.connect\(clip\)\.connect\(post\);/);
  assert.match(player, /clipIn\.gain\.value = 1 \/ PAD_CLIP_RANGE;/);
  assert.match(player, /clip\.curve = padClipCurve\(\);/);
  assert.match(player, /clip\.oversample = 'none';/, 'sem sobreamostragem: atraso zero');
  assert.doesNotMatch(player, /createDynamicsCompressor|createSafetyLimiter/, 'limitador com antecipação atrasaria os pads');
});

test('sem pad com som, o Modo Show não abre a saída de bloco mínimo; com som, fica pronta como antes', () => {
  assert.match(player, /function armPads\(\): void \{\s*if \(!showReady \|\| getPadsState\(\)\.infos\.size === 0\) return;/);
  assert.match(player, /if \(o\.ctx\.state !== 'running'\) void o\.ctx\.resume\(\);\s*if \(o\.keepAlive\) return;/, 'volta a rodar antes do primeiro toque');
  assert.match(player, /k\.offset\.value = 1e-6;/, 'o sinal inaudível que mantém a placa acordada continua');
  assert.match(player, /export function keepPadsReady\(on: boolean\): void \{\s*showReady = on;/);
  assert.match(player, /armPads\(\);\s*void loadPads\(\)\.then\(\(\) => \{\s*armPads\(\);/);
  assert.match(player, /subscribePads\(\(\) => \{\s*if \(showReady && !out\?\.keepAlive && getPadsState\(\)\.infos\.size > 0\) armPads\(\);/,
    'o primeiro som que entrar (importado, do computador ou do projeto) já deixa a saída pronta');
  // a única fonte que liga o sinal inaudível é armPads (sempre com a conferência de pads com som)
  assert.equal(player.match(/createConstantSource\(\)/g)?.length, 1);
});

test('fora do Modo Show a saída para só com tudo em silêncio e com as músicas paradas', () => {
  assert.match(player, /suspendWhenQuiet\(\);\s*return;/);
  assert.match(player, /const QUIET_SECONDS_TO_SUSPEND = 90;/);
  assert.match(player, /let silent = voices\.size === 0/);
  assert.match(player, /silent = peakOf\(data\) < 1e-5;/);
  assert.match(player, /if \(quiet < QUIET_SECONDS_TO_SUSPEND \|\| useStore\.getState\(\)\.transport\.isPlaying\) return;/);
  assert.match(player, /if \(showReady \|\| !o \|\| o\.ctx\.state !== 'running'\) \{ stopQuietTimer\(\); return; \}/);
  // a cauda mais longa do delay (knob no máximo, 1,5 s por repetição, pad bem alto) já some antes
  const fb = delayAmount(1).feedback;
  const repeats = (90 - FADE_SECONDS) / delaySeconds(30);
  assert.equal(delaySeconds(30), 1.5);
  assert.ok(4 * delayAmount(1).wet * Math.pow(fb, repeats) < 1e-5, 'abaixo de -100 dB: nada fica cortado ou guardado no efeito');
});
