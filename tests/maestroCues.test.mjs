// Falas prontas do Maestro: cada fala da lista tem o arquivo gravado nas duas vozes e nas três
// intensidades, a contagem usa as falas prontas, e o texto digitado é reconhecido mesmo com
// pontuação, sem acento ou com o número por extenso.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { READY_CUE_GROUPS, READY_INTENSITIES, READY_VOICES, findReadyCue, readyCueUrl, readyVoice, readyVoiceId, cueKey } from '../src/lib/maestroCues.ts';

const all = READY_CUE_GROUPS.flatMap((g) => g.cues);

test('toda fala pronta tem o arquivo nas duas vozes e nas três intensidades', () => {
  for (const v of READY_VOICES) {
    for (const l of READY_INTENSITIES) {
      const voice = readyVoice(readyVoiceId(v, l.id));
      for (const c of all) {
        const file = path.join('public', readyCueUrl(voice, c));
        assert.ok(fs.existsSync(file), `falta ${file}`);
        assert.ok(fs.statSync(file).size > 1000, `${file} vazio`);
      }
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

test('número por extenso ou em algarismo acha a mesma fala', () => {
  assert.equal(findReadyCue('Verso um')?.id, 'verso-1');
  assert.equal(findReadyCue('refrão dois')?.id, 'refrao-2');
  assert.equal(findReadyCue('3')?.id, 'tres');
  assert.equal(findReadyCue('Mais uma vez')?.id, 'mais-uma-vez');
  assert.equal(findReadyCue('Faltam 4 compassos')?.id, 'faltam-quatro-compassos');
});

test('intensidade vai no id da voz pronta e muda a pasta do arquivo', () => {
  const felipe = READY_VOICES.find((v) => v.dir === 'felipe');
  assert.equal(readyVoiceId(felipe, 'normal'), 'pronta:felipe', 'Normal é a voz de antes (marcações antigas continuam iguais)');
  assert.equal(readyVoice('pronta:felipe').intensity, 'normal');
  assert.equal(readyVoice('pronta:moca:forte').intensity, 'forte');
  assert.equal(readyVoice(readyVoiceId(felipe, 'calma')).intensity, 'calma');
  assert.equal(readyVoice('pronta:felipe:gritando'), null);
  assert.equal(readyVoice('pronta:felipe:forte:x'), null);
  const cue = findReadyCue('Sobe o tom');
  assert.equal(readyCueUrl(readyVoice('pronta:moca:forte'), cue), '/maestro-falas/moca/forte/sobe-o-tom.mp3');
  assert.equal(readyCueUrl(readyVoice('pronta:felipe:calma'), cue, '/staging/'), '/staging/maestro-falas/felipe/calma/sobe-o-tom.mp3');
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
