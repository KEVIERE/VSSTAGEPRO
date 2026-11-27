// A janela "Trocar som do click" não pode ficar dentro da pilha de avisos do canto: ela tem
// pointer-events-none e os botões da janela paravam de responder (não trocava o som nem recriava).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('a janela de sons do click fica fora da pilha que ignora o mouse', () => {
  const app = read('src/App.tsx');
  const status = read('src/components/ClickStatus.tsx');
  assert.doesNotMatch(status, /<ClickSoundChooser/);
  const stack = app.match(/<div className="fixed bottom-4 right-4[^"]*pointer-events-none">([\s\S]*?)<\/div>/);
  assert.ok(stack, 'pilha do canto não encontrada');
  assert.doesNotMatch(stack[1], /ClickSoundChooser/);
  assert.match(app, /<ClickSoundChooser \/>/);
  assert.match(read('src/components/ClickSoundChooser.tsx'), /fixed inset-0 z-\[200\] pointer-events-auto/);
});
