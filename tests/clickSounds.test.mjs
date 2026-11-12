// Sons do Recriar metrônomo: cada som novo é curto, entra em cima da batida, sai no volume do
// click padrão e a janela deixa ouvir e escolher antes de recriar.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CLICK_SOUNDS, CLICK_TARGET_RMS, clickSoundLabel, isClickSound, previewTimes, rememberClickSound,
  rememberedClickSound, synthClickSound,
} from '../src/lib/clickSounds.ts';
import { clickOnsetIndex, placeClickSamples } from '../src/lib/clickEdit.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (...p) => fs.readFileSync(path.join(here, '..', 'src', ...p), 'utf8');
const SYNTH = CLICK_SOUNDS.filter((s) => s.id !== 'vs').map((s) => s.id);

const rms50 = (d, sr) => {
  const n = Math.round(0.05 * sr);
  let ss = 0;
  for (let i = 0; i < n; i++) ss += d[i] * d[i];
  return Math.sqrt(ss / n);
};
const peakOf = (d) => d.reduce((p, v) => Math.max(p, Math.abs(v)), 0);
/** Frequência mais forte nos primeiros 30 ms (passo de 50 Hz). */
const mainFreq = (d, sr) => {
  const m = Math.round(0.03 * sr);
  let best = 0;
  let bf = 0;
  for (let f = 200; f < 14000; f += 50) {
    let re = 0;
    let im = 0;
    for (let i = 0; i < m; i++) { re += d[i] * Math.cos(2 * Math.PI * f * i / sr); im += d[i] * Math.sin(2 * Math.PI * f * i / sr); }
    if (re * re + im * im > best) { best = re * re + im * im; bf = f; }
  }
  return bf;
};

test('a lista tem o padrão do VS Stage e mais 5 sons, cada um com nome e explicação', () => {
  assert.equal(CLICK_SOUNDS[0].id, 'vs', 'o padrão vem primeiro');
  assert.deepEqual(CLICK_SOUNDS.map((s) => s.label), ['VS Stage', 'Madeira', 'Bip', 'Baqueta', 'Cowbell', 'Chimbal']);
  for (const s of CLICK_SOUNDS) assert.ok(s.tip.length > 10, `${s.id} explica o som`);
  assert.equal(clickSoundLabel('cowbell'), 'Cowbell');
  assert.ok(isClickSound('madeira'));
  assert.ok(!isClickSound('sino'));
});

for (const sr of [44100, 48000]) {
  test(`os sons novos são curtos, sem estalo e no volume do padrão (${sr} Hz)`, () => {
    for (const id of SYNTH) {
      const d = synthClickSound(id, sr);
      assert.ok(d.length > 0.05 * sr && d.length <= 0.3 * sr, `${id}: entre 50 e 300 ms`);
      assert.ok(d.every(Number.isFinite), `${id}: sem valor quebrado`);
      assert.ok(Math.abs(d[0]) < 1e-3 && Math.abs(d[d.length - 1]) < 1e-3, `${id}: começa e termina no zero`);
      assert.ok(peakOf(d) <= 0.891, `${id}: sem passar do pico`);
      assert.ok(Math.abs(rms50(d, sr) - CLICK_TARGET_RMS) < 0.003, `${id}: mesma energia do click padrão`);
      assert.ok(clickOnsetIndex(d) < 0.001 * sr, `${id}: o ataque está no primeiro milissegundo`);
    }
  });
}

test('cada som tem o seu tom (não são o mesmo som com nomes diferentes)', () => {
  const sr = 48000;
  const freqs = SYNTH.map((id) => mainFreq(synthClickSound(id, sr), sr));
  assert.equal(new Set(freqs).size, SYNTH.length, `frequências: ${freqs.join(', ')}`);
});

test('o som sai sempre igual (ruído com semente fixa)', () => {
  const a = Array.from(synthClickSound('chimbal', 22050));
  const b = Array.from(synthClickSound('chimbal', 22050));
  assert.deepEqual(a, b);
});

test('com um som novo o ataque cai em cima de cada batida', () => {
  const sr = 48000;
  const d = synthClickSound('madeira', sr);
  const [L, R] = placeClickSamples([0.5, 1], sr * 2, sr, d, d);
  const limit = peakOf(L) * 0.01;
  const first = L.findIndex((v) => Math.abs(v) >= limit);
  assert.ok(Math.abs(first - 0.5 * sr) <= 0.001 * sr, 'batida em 0,5 s');
  assert.deepEqual(L, R, 'mesmo som nos dois lados');
});

test('a prévia toca 1 compasso no andamento da música', () => {
  assert.deepEqual(previewTimes(120), [0, 0.5, 1, 1.5]);
  assert.deepEqual(previewTimes(0), [0, 0.5, 1, 1.5], 'sem andamento usa 120');
  assert.equal(previewTimes(400)[1], 0.25, 'no máximo 240 BPM');
});

test('o programa lembra o último som escolhido', () => {
  const saved = globalThis.localStorage;
  const mem = new Map();
  globalThis.localStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  try {
    assert.equal(rememberedClickSound(), 'vs', 'sem nada guardado é o padrão');
    rememberClickSound('cowbell');
    assert.equal(rememberedClickSound(), 'cowbell');
    mem.set('vsstage.clickSound', 'sino');
    assert.equal(rememberedClickSound(), 'vs', 'valor estranho volta ao padrão');
  } finally {
    globalThis.localStorage = saved;
  }
});

test('Recriar metrônomo abre a janela de sons e usa o som escolhido', () => {
  const menu = read('components', 'ClickMenuItems.tsx');
  assert.match(menu, /item\.kind === 'remake'\) openClickChooser\(songId\)/, 'o menu abre a janela');
  assert.match(menu, /Recriar metrônomo\.\.\./);
  const tools = read('lib', 'clickTools.ts');
  assert.match(tools, /generateClickAt\(times, playLen \/ sr, sr, sound\)/, 'o som escolhido vai para o gerador');
  assert.match(tools, /remakeMetronome\(songId, sound\)/);
  const chooser = read('components', 'ClickSoundChooser.tsx');
  assert.match(chooser, /startClickTool\(songId, 'remake', sound\)/);
  assert.match(chooser, /playClickPreview\(id, bpm/, 'apertar um som toca a prévia');
  assert.match(read('components', 'ClickStatus.tsx'), /<ClickSoundChooser \/>/, 'a janela está montada');
});
