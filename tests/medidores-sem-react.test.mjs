// Medidores que não redesenham pelo React durante o play: medidor da borda da faixa (skin padrão),
// número de dBFS do mixer e os VUs de ponteiro / loudness do master, que dormem com o motor parado.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');

// Pega do arquivo o trecho entre dois marcadores e devolve as funções pedidas (sem os import '@/...').
function load(file, from, to, names, prelude = '') {
  const src = read(file);
  const start = src.indexOf(from);
  const end = src.indexOf(to, start);
  assert.ok(start >= 0 && end > start, `trecho de ${file}`);
  const js = stripTypeScriptTypes(src.slice(start, end).replace(/^export /gm, ''));
  return new Function(`${prelude}\n${js}\nreturn { ${names.join(', ')} };`)();
}

test('mixer: retenção do pico de 1,5 s e texto do mostrador de dBFS', () => {
  const { readoutHold, readoutView } = load(
    '../src/components/MixerPanel.tsx',
    'const READOUT_HOLD_MS',
    '// O nível chega ~30 vezes',
    ['readoutHold', 'readoutView'],
  );
  let h = { db: -Infinity, at: 0 };
  h = readoutHold(h, 10 ** (-6 / 20), 1000);
  assert.ok(Math.abs(h.db - -6) < 1e-9);
  const peak = h;
  h = readoutHold(h, 10 ** (-20 / 20), 2000);
  assert.equal(h, peak, 'o pico fica segurado dentro de 1,5 s');
  h = readoutHold(h, 10 ** (-20 / 20), 2501);
  assert.ok(Math.abs(h.db - -20) < 1e-9, 'passou de 1,5 s: mostra o nível atual');
  h = readoutHold(h, 1, 2600);
  assert.equal(h.db, 0, 'pico novo entra na hora');
  assert.equal(readoutHold({ db: -3, at: 0 }, 0, 5000).db, -Infinity, 'silêncio');

  assert.deepEqual(readoutView(-Infinity), { text: ' ', className: 'console-readout console-glow ' });
  assert.deepEqual(readoutView(-61), { text: ' ', className: 'console-readout console-glow ' });
  assert.deepEqual(readoutView(-12.34), { text: '-12.3', className: 'console-readout console-glow text-logic-lcd-green' });
  assert.deepEqual(readoutView(-3), { text: '-3.0', className: 'console-readout console-glow text-logic-lcd-amber' });
  assert.deepEqual(readoutView(0), { text: '0.0', className: 'console-readout console-glow text-logic-lcd-red' });
  assert.deepEqual(readoutView(1.25), { text: '+1.3', className: 'console-readout console-glow text-logic-lcd-red' });
});

test('mixer: o mostrador de dBFS escreve direto no elemento, sem redesenhar pelo React', () => {
  const mixer = read('../src/components/MixerPanel.tsx');
  const fn = mixer.slice(mixer.indexOf('function LevelReadout'), mixer.indexOf('// Marcas impressas ao lado do fader'));
  assert.match(fn, /subscribeMeters\(apply\)/);
  assert.match(fn, /el\.textContent = view\.text/);
  assert.doesNotMatch(fn, /useMeterLevel|useState/);
  assert.doesNotMatch(mixer, /useMeterLevel/);
});

test('borda da faixa (skin padrão): máscara do MeterMask, sem clipPath nem useMeterLevel', () => {
  const pieces = read('../src/components/AnalogPieces.tsx');
  const fn = pieces.slice(pieces.indexOf('function EdgeBar'), pieces.indexOf('export function AnEdgeMeter'));
  assert.match(fn, /<MeterMask id=\{id\} className="\[background:inherit\]" \/>/, 'parte apagada na cor do fundo do medidor');
  assert.match(fn, /\{!off && \(/, 'faixa muda ou sem saída fica apagada inteira, como antes');
  assert.doesNotMatch(pieces, /useMeterLevel|clipPath: `inset/);
});

test('VU e loudness do master dormem com o motor parado', () => {
  const { vuIdle } = load('../src/components/VuMeter.tsx', 'function vuIdle', '/** Pico real', ['vuIdle'], 'const SWEEP = 50;');
  const { loudnessIdle } = load('../src/components/VuMeter.tsx', '/** LUFS para o visor', '/** Visor do loudness', ['loudnessIdle']);
  assert.equal(vuIdle(true, 0, 0, false), false, 'tocando nunca dorme');
  assert.equal(vuIdle(false, 0.3, 0, false), false, 'ponteiro ainda caindo');
  assert.equal(vuIdle(false, 0.0001, 0, false), true, 'ponteiro em repouso');
  assert.equal(vuIdle(false, 0, 0, true), false, 'LED de pico ainda aceso');
  assert.equal(loudnessIdle(true, { momentary: -Infinity, shortTerm: -Infinity }), false);
  assert.equal(loudnessIdle(false, { momentary: -Infinity, shortTerm: -14 }), false, 'o curto ainda caindo');
  assert.equal(loudnessIdle(false, { momentary: -80, shortTerm: -Infinity }), true);
  const vu = read('../src/components/VuMeter.tsx');
  assert.match(vu, /audioEngine\.isRunning\(\)/);
  assert.equal((vu.match(/subscribeMeters\(wake\)/g) ?? []).length, 2, 'os dois acordam na publicação dos níveis');
});
