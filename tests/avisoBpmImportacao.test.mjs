// O aviso de BPM sai só na importação (e no Medir BPM de novo); ao abrir o projeto, a correção do
// tempo 1 é silenciosa.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../src/lib/importManager.ts', import.meta.url), 'utf8');
const body = src.match(/export function bpmFoundNotice\(songName: string, bpms: number\[\]\): string \{([\s\S]*?)\n\}/)[1];
const bpmFoundNotice = new Function('songName', 'bpms', body.replace(/: string\[\]/g, '').replace(/\(b: number\)/g, '(b)'));

test('um andamento só', () => {
  assert.equal(bpmFoundNotice('DAMA', [105]), '"DAMA": 105 BPM.');
  assert.equal(bpmFoundNotice('X', [128.574]), '"X": 128,57 BPM.');
});

test('medley com vários andamentos', () => {
  assert.equal(bpmFoundNotice('MEDLEY', [140, 143, 147, 148, 150, 154]), '"MEDLEY": 6 andamentos encontrados (140, 143, 147, 148, 150 e 154 BPM).');
  assert.equal(bpmFoundNotice('D', [140, 128.57, 109.58]), '"D": 3 andamentos encontrados (140, 128,57 e 109,58 BPM).');
});

test('trechos seguidos no mesmo BPM contam uma vez', () => {
  assert.equal(bpmFoundNotice('S', [174, 174]), '"S": 174 BPM.');
});

test('a correção do tempo 1 ao abrir o projeto não avisa mais', () => {
  assert.doesNotMatch(src, /Tempo 1 de "\$\{latest\.name\}" ajustado/);
});
