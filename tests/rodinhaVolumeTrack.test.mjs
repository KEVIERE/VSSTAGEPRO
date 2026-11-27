// Rolar a timeline com o mouse em cima das tracks não pode mexer no volume da track.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../src/components/AnalogPieces.tsx', import.meta.url), 'utf8');

test('o botão de volume só usa a rodinha com Option (Alt), senão a timeline rola', () => {
  const wheel = src.match(/onWheel=\{\(e\) => \{ if \(!disabled && e\.altKey\) \{ e\.stopPropagation\(\);/);
  assert.ok(wheel, 'a rodinha sem Option não pode mexer no volume nem segurar a rolagem');
  assert.doesNotMatch(src, /onWheel=\{\(e\) => \{ if \(!disabled\) \{ e\.stopPropagation\(\); onChange/);
});
