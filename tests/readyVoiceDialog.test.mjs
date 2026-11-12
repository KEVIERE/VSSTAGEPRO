// Vozes prontas do Maestro: a voz feminina se chama Bianca na tela (o id continua "moca") e a
// janela da fala com voz pronta tem só OK, sem o botão de gerar.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { READY_VOICES, readyVoice } from '../src/lib/maestroCues.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const dialog = fs.readFileSync(path.join(here, '..', 'src', 'components', 'NarrationDialog.tsx'), 'utf8');

test('a voz pronta feminina se chama Bianca, sem mudar o id', () => {
  const v = READY_VOICES.find((x) => x.id === 'pronta:moca');
  assert.equal(v?.label, 'Bianca');
  assert.equal(v?.dir, 'moca', 'a pasta dos áudios gravados continua a mesma');
  assert.equal(readyVoice('pronta:moca:forte')?.label, 'Bianca', 'falas salvas com o id antigo mostram o nome novo');
});

test('com voz pronta a janela da fala tem OK no lugar de gerar', () => {
  assert.match(dialog, /\{readyVoice\(voice\) \? \(/);
  assert.match(dialog, /onClick=\{close\}[\s\S]{0,200}OK/);
  assert.match(dialog, /if \(readyVoice\(voice\)\) close\(\); else void generate\(\);/, '⌘↩ também fecha');
});
