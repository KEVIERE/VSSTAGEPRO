// Modo leve: liga sozinho na versão Intel do app (x64, num Mac Intel ou no Rosetta) e tira do
// desenho o que mais pesa; o som não muda.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('modo leve liga sozinho na versão Intel e pode ser forçado', async () => {
  const { perfLite } = await import('../src/lib/perfMode.ts');
  assert.equal(perfLite('auto', true), true, 'versão Intel: leve');
  assert.equal(perfLite('auto', false), false, 'Apple Silicon: normal');
  assert.equal(perfLite('leve', false), true);
  assert.equal(perfLite('normal', true), false);
});

test('o app do Mac avisa a arquitetura e a tela aplica o modo leve antes de desenhar', () => {
  const preload = fs.readFileSync(new URL('../desktop/preload.js', import.meta.url), 'utf8');
  const main = fs.readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
  const css = fs.readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
  assert.match(preload, /arch: process\.arch,/);
  assert.match(main, /applyPerfMode\(\);/);
  assert.match(css, /\[data-perf='leve'\][^{]*\.console-face[^{]*\{\s*background-image: none !important;/);
});

test('show: janela sem freio em segundo plano e Mac sem dormir com música tocando', () => {
  const main = fs.readFileSync(new URL('../desktop/main.js', import.meta.url), 'utf8');
  assert.match(main, /backgroundThrottling: false,\n\s+\},\n\s+\}\);/);
  assert.match(main, /powerSaveBlocker\.start\('prevent-display-sleep'\)/);
  assert.match(main, /powerSaveBlocker\.stop\(showSleepBlock\)/);
});
