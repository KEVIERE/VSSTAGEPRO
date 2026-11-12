// Falas prontas do Maestro: cada fala da lista tem o arquivo gravado nas duas vozes, a contagem
// usa as falas prontas, e o texto digitado é reconhecido mesmo com pontuação ou sem acento.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { READY_CUE_GROUPS, READY_VOICES, findReadyCue, readyCueUrl, readyVoice, cueKey } from '../src/lib/maestroCues.ts';

const all = READY_CUE_GROUPS.flatMap((g) => g.cues);

test('toda fala pronta tem o arquivo nas duas vozes', () => {
  for (const v of READY_VOICES) {
    for (const c of all) {
      const file = path.join('public', 'maestro-falas', v.dir, `${c.id}.mp3`);
      assert.ok(fs.existsSync(file), `falta ${file}`);
      assert.ok(fs.statSync(file).size > 1000, `${file} vazio`);
    }
  }
});

test('nenhuma fala repetida e todo assunto tem falas', () => {
  assert.equal(new Set(all.map((c) => c.id)).size, all.length);
  assert.equal(new Set(all.map((c) => cueKey(c.text))).size, all.length);
  for (const g of READY_CUE_GROUPS) assert.ok(g.cues.length > 0, g.label);
  assert.ok(all.length >= 200);
});

test('os números da contagem (até oito) são falas prontas', () => {
  for (const n of ['Um', 'Dois', 'Três', 'Quatro', 'Cinco', 'Seis', 'Sete', 'Oito']) assert.ok(findReadyCue(n), n);
});

test('texto digitado com pontuação, maiúscula ou sem acento acha a fala pronta', () => {
  assert.equal(findReadyCue('vai pro refrão!')?.id, 'vai-pro-refrao');
  assert.equal(findReadyCue('SOBE O TOM.')?.id, 'sobe-o-tom');
  assert.equal(findReadyCue('Refrao')?.id, 'refrao');
  assert.equal(findReadyCue('  solo de cavaco  ')?.id, 'solo-de-cavaco');
  assert.equal(findReadyCue('Entra a banda, todo mundo'), null, 'frase livre não é fala pronta');
});

test('voz pronta e endereço do arquivo (site, staging e app do Mac)', () => {
  const felipe = readyVoice('pronta:felipe');
  assert.equal(felipe?.fallback, 'masculina');
  assert.equal(readyVoice('pronta:moca')?.fallback, 'feminina');
  assert.equal(readyVoice('feminina'), null);
  const cue = findReadyCue('Refrão');
  assert.equal(readyCueUrl(felipe, cue), '/maestro-falas/felipe/refrao.mp3');
  assert.equal(readyCueUrl(felipe, cue, '/staging/'), '/staging/maestro-falas/felipe/refrao.mp3');
});
