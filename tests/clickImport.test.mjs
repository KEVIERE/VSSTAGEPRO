// Seu som (Recriar metrônomo): o áudio que o usuário importa é ajustado sozinho. O começo é
// cortado no ataque (sem silêncio, chiado ou pré-eco antes), o fim volta ao silêncio, os dois
// sons de um compasso gravado (1 2 3 4 | 1) são separados e o volume fica igual ao dos outros.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareImportedClick, scaleForStorage } from '../src/lib/clickImport.ts';
import {
  CLICK_TARGET_RMS, clickSoundSamples, decodeRecordedHit, encodeHit, rememberedClickSound, saveCustomClick, savedCustomClick,
} from '../src/lib/clickSounds.ts';

const SR = 48000;

/** Ruído baixo e sempre igual (chiado de fundo de uma gravação). */
function hiss(n, level, seed = 7) {
  let a = seed;
  return Float32Array.from({ length: n }, () => {
    a = (a * 1103515245 + 12345) & 0x7fffffff;
    return ((a / 0x7fffffff) * 2 - 1) * level;
  });
}

/** Toque de `freq` Hz com ataque de 0,2 ms e queda rápida, somado em `at` segundos. */
function addHit(buf, at, freq, gain = 0.9) {
  const s0 = Math.round(at * SR);
  for (let i = 0; i < Math.round(0.06 * SR) && s0 + i < buf.length; i++) {
    const t = i / SR;
    const env = Math.min(1, t / 0.0002) * Math.exp(-t / 0.008);
    buf[s0 + i] += gain * env * Math.sin(2 * Math.PI * freq * t);
  }
}

const level = ([L, R]) => L.map((v, i) => Math.max(Math.abs(v), Math.abs(R[i])));
const peakOf = (d) => d.reduce((p, v) => Math.max(p, Math.abs(v)), 0);
/** Frequência mais forte nos primeiros 15 ms. */
const mainFreq = (d) => {
  const m = Math.min(d.length, Math.round(0.015 * SR));
  let best = 0;
  let bf = 0;
  for (let f = 300; f < 5000; f += 25) {
    let re = 0;
    let im = 0;
    for (let i = 0; i < m; i++) { re += d[i] * Math.cos(2 * Math.PI * f * i / SR); im += d[i] * Math.sin(2 * Math.PI * f * i / SR); }
    if (re * re + im * im > best) { best = re * re + im * im; bf = f; }
  }
  return bf;
};
/** O ataque está colado no começo: -20 dB do pico em até 0,1 ms. */
const tight = (hit) => {
  const lv = level(hit);
  const pk = peakOf(lv);
  return lv.findIndex((v) => v >= pk * 0.1) <= 0.0001 * SR;
};

test('toque único com silêncio e chiado antes: começa no ataque, sem folga', () => {
  const d = hiss(Math.round(0.6 * SR), 0.002);
  addHit(d, 0.12, 1800);
  const p = prepareImportedClick([d], SR);
  assert.equal(p.hits, 1);
  assert.equal(p.accent, undefined, 'um som só');
  assert.ok(tight(p.normal), 'os 120 ms de antes saíram');
  assert.ok(p.normal[0].length < 0.2 * SR, 'o fim volta ao silêncio (não leva o chiado até o fim do arquivo)');
  assert.deepEqual(Array.from(p.normal[0]), Array.from(p.normal[1]), 'arquivo mono vira os dois lados iguais');
  assert.ok(Math.abs(p.normal[0][p.normal[0].length - 1]) < 1e-3, 'sai sem estalo');
});

test('compasso gravado com dois tons: o do 1 é o que aparece menos', () => {
  const spb = 60 / 128;
  const d = hiss(Math.round(8 * spb * SR + SR / 2), 0.001);
  for (let k = 0; k < 8; k++) addHit(d, 0.05 + k * spb, k % 4 === 0 ? 1575 : 1100);
  const p = prepareImportedClick([d, d], SR);
  assert.equal(p.hits, 8);
  assert.ok(p.accent, 'achou os dois sons');
  assert.ok(Math.abs(mainFreq(p.accent[0]) - 1575) <= 50, 'o do 1 é o agudo');
  assert.ok(Math.abs(mainFreq(p.normal[0]) - 1100) <= 50, 'os outros tempos são o grave');
  assert.ok(tight(p.accent) && tight(p.normal), 'os dois começam no ataque');
});

test('mesmo tom com o 1 mais forte: separa pelo volume', () => {
  const d = hiss(Math.round(4.5 * SR), 0.001);
  for (let k = 0; k < 8; k++) addHit(d, 0.05 + k * 0.5, 1500, k % 4 === 0 ? 0.9 : 0.35);
  const p = prepareImportedClick([d], SR);
  assert.ok(p.accent, 'achou o acento');
  assert.ok(peakOf(p.accent[0]) > peakOf(p.normal[0]) * 2, 'o do 1 é o mais forte');
});

test('toques iguais (com pequenas diferenças) são um som só', () => {
  const d = hiss(Math.round(2.5 * SR), 0.001);
  [0.9, 0.82, 0.88, 0.85].forEach((g, k) => addHit(d, 0.05 + k * 0.5, 2000, g));
  const p = prepareImportedClick([d], SR);
  assert.equal(p.hits, 4);
  assert.equal(p.accent, undefined);
});

test('dois toques diferentes (tic, toc): o primeiro é o do 1', () => {
  const d = hiss(Math.round(1.2 * SR), 0.001);
  addHit(d, 0.05, 1100);
  addHit(d, 0.55, 1575);
  const p = prepareImportedClick([d], SR);
  assert.ok(p.accent);
  assert.ok(Math.abs(mainFreq(p.accent[0]) - 1100) <= 50, 'empate: fica o do primeiro toque');
});

test('arquivo em silêncio ou vazio dá erro com mensagem', () => {
  assert.throws(() => prepareImportedClick([new Float32Array(SR)], SR), /silêncio/);
  assert.throws(() => prepareImportedClick([new Float32Array(0)], SR), /vazio/);
});

test('o som importado fica guardado e sai no volume dos outros, na taxa pedida', () => {
  const saved = globalThis.localStorage;
  const mem = new Map();
  globalThis.localStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  try {
    assert.throws(() => clickSoundSamples('meu', SR), /importe/, 'sem nada importado');
    const spb = 0.5;
    const d = hiss(Math.round(4.5 * SR), 0.001);
    for (let k = 0; k < 8; k++) addHit(d, 0.05 + k * spb, k % 4 === 0 ? 1575 : 1100);
    const p = scaleForStorage(prepareImportedClick([d], SR));
    assert.ok(Math.abs(Math.max(peakOf(p.normal[0]), peakOf(p.accent[0])) - 0.95) < 1e-6, 'guardado com o pico em 0,95');
    // 16 bits ida e volta
    const back = decodeRecordedHit(encodeHit(p.normal));
    assert.ok(back[0].every((v, i) => Math.abs(v - p.normal[0][i]) < 1e-4));
    saveCustomClick({ name: 'meu-click.wav', rate: SR, normal: encodeHit(p.normal), accent: encodeHit(p.accent), at: 1 });
    assert.equal(savedCustomClick()?.name, 'meu-click.wav');
    mem.set('vsstage.clickSound', 'meu');
    assert.equal(rememberedClickSound(), 'meu', 'com o som importado, a escolha fica lembrada');
    const out = clickSoundSamples('meu', 44100);
    assert.ok(out.accent, 'os dois sons vêm junto');
    const [L, R] = out.normal;
    const n = Math.round(0.05 * 44100);
    let ss = 0;
    for (let i = 0; i < Math.min(n, L.length); i++) ss += (L[i] * L[i] + R[i] * R[i]) / 2;
    assert.ok(Math.abs(Math.sqrt(ss / n) - CLICK_TARGET_RMS) < 0.003, 'mesma energia do click padrão');
    // importar outro arquivo troca o som (não fica o antigo na memória)
    const d2 = hiss(Math.round(0.5 * SR), 0.001);
    addHit(d2, 0.05, 3000);
    const p2 = scaleForStorage(prepareImportedClick([d2], SR));
    saveCustomClick({ name: 'outro.wav', rate: SR, normal: encodeHit(p2.normal), at: 2 });
    assert.equal(clickSoundSamples('meu', 44100).accent, undefined, 'o som novo é de um toque só');
  } finally {
    globalThis.localStorage = saved;
  }
});
