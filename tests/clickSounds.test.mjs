// Sons do Recriar metrônomo: cada som entra em cima da batida, sem folga antes, sai no volume do
// click padrão e a janela deixa ouvir e escolher antes de recriar. O Agradável tem dois sons:
// agudo no 1 de cada compasso (a virada do compasso) e grave nos outros tempos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CLICK_SOUNDS, CLICK_TARGET_RMS, clickSoundLabel, clickSoundSamples, isClickSound, previewAccents, previewTimes,
  rememberClickSound, rememberedClickSound, resampleHit,
} from '../src/lib/clickSounds.ts';
import { barStartFlags, clickOnsetIndex, placeAccentedClicks } from '../src/lib/clickEdit.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (...p) => fs.readFileSync(path.join(here, '..', 'src', ...p), 'utf8');
const OTHERS = CLICK_SOUNDS.filter((s) => s.id !== 'vs' && !s.custom).map((s) => s.id);

/** Energia dos primeiros 50 ms (o que faltar conta como silêncio), média dos dois lados. */
const rms50 = ([L, R], sr) => {
  const n = Math.round(0.05 * sr);
  let ss = 0;
  for (let i = 0; i < Math.min(n, L.length); i++) ss += (L[i] * L[i] + R[i] * R[i]) / 2;
  return Math.sqrt(ss / n);
};
const level = ([L, R]) => L.map((v, i) => Math.max(Math.abs(v), Math.abs(R[i])));
const peakOf = (d) => d.reduce((p, v) => Math.max(p, Math.abs(v)), 0);
/** Frequência mais forte nos primeiros 20 ms (passo de 25 Hz). */
const mainFreq = (d, sr) => {
  const m = Math.min(d.length, Math.round(0.02 * sr));
  let best = 0;
  let bf = 0;
  for (let f = 200; f < 14000; f += 25) {
    let re = 0;
    let im = 0;
    for (let i = 0; i < m; i++) { re += d[i] * Math.cos(2 * Math.PI * f * i / sr); im += d[i] * Math.sin(2 * Math.PI * f * i / sr); }
    if (re * re + im * im > best) { best = re * re + im * im; bf = f; }
  }
  return bf;
};

test('a lista tem o padrão do VS Stage, mais 4 sons e o seu som; Bip, Cowbell e Chimbal saíram', () => {
  assert.equal(CLICK_SOUNDS[0].id, 'vs', 'o padrão vem primeiro');
  assert.deepEqual(CLICK_SOUNDS.map((s) => s.label), ['VS Stage', 'Madeira', 'Baqueta', 'Agradável', 'Bloco', 'Seu som']);
  assert.deepEqual(CLICK_SOUNDS.filter((s) => s.custom).map((s) => s.id), ['meu'], 'o último botão é o som importado');
  assert.ok(!isClickSound('bip'), 'quem tinha Bip guardado volta ao padrão');
  for (const s of CLICK_SOUNDS) assert.ok(s.tip.length > 10, `${s.id} explica o som`);
  assert.deepEqual(CLICK_SOUNDS.filter((s) => s.twoSounds).map((s) => s.id), ['agradavel']);
  assert.equal(clickSoundLabel('bloco'), 'Bloco');
  assert.ok(isClickSound('agradavel'));
  assert.ok(!isClickSound('cowbell'), 'quem tinha Cowbell guardado volta ao padrão');
  assert.ok(!isClickSound('chimbal'));
});

for (const sr of [44100, 48000]) {
  test(`cada som começa no ataque, sem folga, e sai no volume do padrão (${sr} Hz)`, () => {
    for (const id of OTHERS) {
      const { normal, accent } = clickSoundSamples(id, sr);
      for (const hit of [normal, accent].filter(Boolean)) {
        const [L, R] = hit;
        const lv = level(hit);
        const pk = peakOf(lv);
        assert.ok(L.length > 0.02 * sr && L.length <= 0.3 * sr, `${id}: entre 20 e 300 ms`);
        assert.ok(L.every(Number.isFinite) && R.every(Number.isFinite), `${id}: sem valor quebrado`);
        assert.ok(lv[0] < pk * 0.1 && lv[lv.length - 1] < 1e-3, `${id}: entra e sai sem estalo`);
        assert.ok(pk <= 0.891, `${id}: sem passar do pico`);
        assert.ok(clickOnsetIndex(L) <= 0.0001 * sr + 1, `${id}: o som começa na primeira amostra`);
        // a -20 dB do pico em até 0,2 ms: nada de silêncio ou chiado antes do toque
        assert.ok(lv.findIndex((v) => v >= pk * 0.1) <= 0.0002 * sr, `${id}: o ataque está colado no começo`);
      }
      assert.ok(Math.abs(rms50(normal, sr) - CLICK_TARGET_RMS) < 0.003, `${id}: mesma energia do click padrão`);
    }
  });
}

test('Agradável: agudo no 1 do compasso e grave nos outros, com a diferença da gravação', () => {
  const sr = 48000;
  const { normal, accent } = clickSoundSamples('agradavel', sr);
  assert.ok(accent, 'tem o som do 1');
  assert.ok(Math.abs(mainFreq(accent[0], sr) - 1575) <= 50, 'o do 1 é o agudo (~1575 Hz)');
  assert.ok(Math.abs(mainFreq(normal[0], sr) - 1100) <= 50, 'os outros tempos são o grave (~1100 Hz)');
  const diff = 20 * Math.log10(rms50(accent, sr) / rms50(normal, sr));
  assert.ok(diff > 0 && diff < 2, `o agudo fica um pouco mais forte, como no áudio (${diff.toFixed(1)} dB)`);
  assert.equal(clickSoundSamples('bloco', sr).accent, undefined, 'o Bloco é um som só');
});

test('cada som tem o seu tom', () => {
  const sr = 48000;
  const freqs = OTHERS.map((id) => mainFreq(clickSoundSamples(id, sr).normal[0], sr));
  assert.equal(new Set(freqs).size, OTHERS.length, `frequências: ${freqs.join(', ')}`);
});

test('o Bloco continua em estéreo', () => {
  const [L, R] = clickSoundSamples('bloco', 48000).normal;
  assert.ok(L.some((v, i) => Math.abs(v - R[i]) > 0.01), 'os dois lados são diferentes');
});

test('mudar a taxa não tira o ataque do lugar', () => {
  const src = new Float32Array(240);
  src[0] = 0;
  src[1] = 1;
  for (let i = 2; i < 240; i++) src[i] = Math.sin(i) * Math.exp(-i / 40);
  for (const to of [44100, 48000, 96000]) {
    const out = resampleHit(src, 24000, to);
    assert.equal(out.length, Math.round(240 * to / 24000));
    const at = out.findIndex((v) => Math.abs(v) >= 0.5);
    assert.ok(at / to <= 2 / 24000, `${to} Hz: o pico continua na 2ª amostra do original`);
  }
});

test('o 1 do compasso segue a grade da timeline (1 2 3 4 | 1)', () => {
  const song = { bpm: 120, beatsPerBar: 4 };
  const t = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4];
  assert.deepEqual(barStartFlags(song, t), [true, false, false, false, true, false, false, false, true]);
  // click que começa no meio do compasso: o 1 continua na linha do compasso
  assert.deepEqual(barStartFlags(song, [1, 1.5, 2, 2.5]), [false, false, true, false]);
  // batidas alguns ms fora da linha contam igual
  assert.deepEqual(barStartFlags(song, [0.006, 0.497, 1.004, 1.502, 2.003]), [true, false, false, false, true]);
  // 3 por compasso
  assert.deepEqual(barStartFlags({ bpm: 120, beatsPerBar: 3 }, [0, 0.5, 1, 1.5]), [true, false, false, true]);
});

test('com mudança de andamento o compasso recomeça na mudança, como na grade', () => {
  const song = {
    bpm: 120, beatsPerBar: 4,
    tempoSegments: [{ startTime: 0, endTime: 3, bpm: 120 }, { startTime: 3, endTime: 10, bpm: 60 }],
  };
  // 0 0,5 1 1,5 2 2,5 | 3 4 5 6 7
  const t = [0, 0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 7];
  assert.deepEqual(barStartFlags(song, t), [true, false, false, false, true, false, true, false, false, false, true]);
});

test('batida fora da grade continua a contagem da anterior e recomeça depois de pausa', () => {
  const song = { bpm: 120, beatsPerBar: 4 };
  // grade de 120 (0,5 s), mas o click está em outro andamento (0,7 s): conta pela sequência
  assert.deepEqual(barStartFlags(song, [0, 0.7, 1.4, 2.1, 2.8, 3.4]), [true, false, false, false, true, false]);
  // pausa (troca de música do medley): a próxima batida é o 1
  assert.deepEqual(barStartFlags(song, [0, 0.7, 1.4, 3.8, 4.6]), [true, false, false, true, false]);
});

test('o click de dois sons põe o agudo só no 1 do compasso', () => {
  const sr = 8000;
  const normal = [new Float32Array([0.5, 0.25]), new Float32Array([0.5, 0.25])];
  const accent = [new Float32Array([0.75, 0.375]), new Float32Array([0.75, 0.375])];
  const times = [0, 0.5, 1, 1.5, 2];
  const [L] = placeAccentedClicks(times, [true, false, false, false, true], sr * 3, sr, normal, accent);
  assert.deepEqual(times.map((t) => L[Math.round(t * sr)]), [0.75, 0.5, 0.5, 0.5, 0.75]);
  // som de um toque só: todas as batidas iguais
  const [M] = placeAccentedClicks(times, [true, false, false, false, true], sr * 3, sr, normal);
  assert.deepEqual(times.map((t) => M[Math.round(t * sr)]), [0.5, 0.5, 0.5, 0.5, 0.5]);
});

test('a prévia toca 1 compasso e o 1 do seguinte, no andamento da música', () => {
  assert.deepEqual(previewTimes(120), [0, 0.5, 1, 1.5, 2]);
  assert.deepEqual(previewAccents(), [true, false, false, false, true]);
  assert.deepEqual(previewTimes(0, 3), [0, 0.5, 1, 1.5], 'sem andamento usa 120');
  assert.deepEqual(previewAccents(3), [true, false, false, true]);
  assert.equal(previewTimes(400)[1], 0.25, 'no máximo 240 BPM');
});

test('o programa lembra o último som escolhido', () => {
  const saved = globalThis.localStorage;
  const mem = new Map();
  globalThis.localStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  try {
    assert.equal(rememberedClickSound(), 'vs', 'sem nada guardado é o padrão');
    rememberClickSound('agradavel');
    assert.equal(rememberedClickSound(), 'agradavel');
    mem.set('vsstage.clickSound', 'cowbell');
    assert.equal(rememberedClickSound(), 'vs', 'som que saiu da lista volta ao padrão');
    mem.set('vsstage.clickSound', 'meu');
    assert.equal(rememberedClickSound(), 'vs', 'seu som sem nada importado volta ao padrão');
  } finally {
    globalThis.localStorage = saved;
  }
});

test('Recriar metrônomo abre a janela de sons e usa o som e o 1 do compasso', () => {
  const menu = read('components', 'ClickMenuItems.tsx');
  assert.match(menu, /item\.kind === 'remake'\) openClickChooser\(songId\)/, 'o menu abre a janela');
  assert.match(menu, /Recriar metrônomo\.\.\./);
  const tools = read('lib', 'clickTools.ts');
  assert.match(tools, /const accents = barStartFlags\(song, times\.map\(\(t\) => click\.startTime \+ t\)\);/);
  assert.match(tools, /generateClickAt\(times, playLen \/ sr, sr, sound, accents\)/, 'o som e os acentos vão para o gerador');
  assert.match(tools, /remakeMetronome\(songId, sound\)/);
  const chooser = read('components', 'ClickSoundChooser.tsx');
  assert.match(chooser, /startClickTool\(songId, 'remake', sound\)/);
  assert.match(chooser, /playClickPreview\(id, bpm, beatsPerBar/, 'apertar um som toca a prévia');
  assert.match(chooser, /2 SONS/, 'o Agradável mostra que tem dois sons');
  assert.match(chooser, /Importar seu som/, 'o último botão importa o som do usuário');
  assert.match(chooser, /type="file"/);
  assert.match(chooser, /importClickFile\(file\)/, 'o arquivo passa pelo ajuste automático');
  assert.match(read('components', 'ClickStatus.tsx'), /<ClickSoundChooser \/>/, 'a janela está montada');
});
