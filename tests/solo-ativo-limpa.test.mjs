// Aviso SOLO ATIVO no topo (e no Modo Show): clicar tira o solo de todas as faixas e clipes.
//
// Rodar com: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('clearAllSolos tira o solo de faixas e clipes', () => {
  const store = read('src/store.ts');
  const at = store.indexOf('clearAllSolos: () => set(');
  assert.ok(at > 0);
  const body = store.slice(at, at + 400);
  assert.match(body, /tracks: s\.tracks\.map\(\(t\) => \(t\.solo \? \{ \.\.\.t, solo: false \}/);
  assert.match(body, /clips: s\.clips\.map\(\(c\) => \(c\.solo \? \{ \.\.\.c, solo: false \}/);
});

test('o aviso SOLO ATIVO é um botão que chama clearAllSolos', () => {
  for (const f of ['src/components/TransportBar.tsx', 'src/components/ShowModePanel.tsx']) {
    const src = read(f);
    assert.match(src, /onClick=\{clearAllSolos\}/, f);
    assert.match(src, /s\.clips\.some\(\(c\) => c\.solo\)/, `${f}: solo de clipe também acende o aviso`);
  }
});
