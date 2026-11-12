// Fala do Maestro IA: um clique seleciona, Delete (ou Backspace) apaga a fala e o áudio dela.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const lane = fs.readFileSync(path.join(here, '..', 'src', 'components', 'NarrationLane.tsx'), 'utf8');

test('clicar numa fala do Maestro seleciona ela', () => {
  assert.match(lane, /setSelectedId\(n\.id\)/, 'apertar na fala seleciona');
  assert.match(lane, /selectedId === n\.id \? 'ring-2/, 'a fala selecionada ganha o contorno');
});

test('Delete apaga a fala selecionada antes dos outros atalhos', () => {
  assert.match(lane, /e\.key !== 'Delete' && e\.key !== 'Backspace'/);
  assert.match(lane, /removeNarration\(song\.id, n\.id\)/, 'apaga a fala (o áudio sai junto)');
  assert.match(lane, /window\.addEventListener\('keydown', onKey, true\)/, 'escuta antes dos atalhos de áudio');
  assert.match(lane, /e\.stopPropagation\(\);/, 'não apaga também os áudios selecionados');
  assert.match(lane, /st\.timelineLocked/, 'cadeado da timeline impede apagar');
});
