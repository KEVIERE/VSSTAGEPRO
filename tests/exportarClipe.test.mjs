// Botão direito num clipe: Exportar este áudio (só aquele clipe, num WAV).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');
const exp = read('lib/clipExport.ts');
const menu = read('components/ContextMenu.tsx');

test('o menu do clipe tem Exportar este áudio', () => {
  assert.match(menu, /<span>Exportar este áudio…<\/span>/);
  assert.match(menu, /void exportClipAudio\(clipId\)/);
});

test('exporta do arquivo original em 24 bits, com os cortes, onde a pessoa escolher', () => {
  assert.match(exp, /encodeWavPcm24\(trimmed\(await decodeBlob\(source\), clip\)\)/);
  assert.match(exp, /\(clip\.trimStart \?\? 0\) \* sr/);
  assert.match(exp, /clipPlayLength\(clip\) \* sr/);
  assert.match(exp, /openFileTarget\(`\$\{safeName\(clip\.name\)\}\.wav`\)/);
  assert.match(exp, /if \(!picked\) return null;/);
});

test('sem o arquivo original, usa a cópia da memória', () => {
  assert.match(exp, /encodeWavInt16\(memory!\)/);
});

test('nome do arquivo sem caracteres proibidos', () => {
  const body = exp.match(/const safeName = \(name: string\) => (.+);\n/)[1];
  const safeName = new Function('name', `return ${body}`);
  assert.equal(safeName('Voz: Guia/1.wav'), 'Voz_ Guia_1');
  assert.equal(safeName('baixo.wav'), 'baixo');
});
