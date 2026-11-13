// Maestro por IA: Felipe e Bianca são as vozes padrão, o banco de falas prontas cresceu (as novas
// ainda sem gravação saem na voz do Mac, sem erro) e a escolha da fala pronta tem busca por palavras.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_READY_VOICE, READY_CUE_GROUPS, RECORDED_CUE_IDS, cueKey, findReadyCue, hasRecording, highlightParts,
  readyCueUrl, recordedIntensity,
  readyVoice, searchReadyCues, searchWords, voiceFromOldChoice,
} from '../src/lib/maestroCues.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (...p) => fs.readFileSync(path.join(here, '..', ...p), 'utf8');
const all = READY_CUE_GROUPS.flatMap((g) => g.cues.map((c) => ({ ...c, group: g.id })));
const texts = (q, n = Infinity) => searchReadyCues(q, n).map((h) => h.cue.text);

test('Felipe é a voz padrão; a escolha antiga passa para Felipe (Masculina) ou Bianca (Feminina)', () => {
  assert.equal(DEFAULT_READY_VOICE, 'pronta:felipe');
  assert.equal(readyVoice(DEFAULT_READY_VOICE)?.label, 'Felipe');
  assert.equal(voiceFromOldChoice(null), 'pronta:felipe', 'nada guardado: Felipe');
  assert.equal(voiceFromOldChoice('masculina'), 'pronta:felipe');
  assert.equal(voiceFromOldChoice('qwen:masculina'), 'pronta:felipe');
  assert.equal(voiceFromOldChoice('henrique'), 'pronta:felipe');
  assert.equal(voiceFromOldChoice('feminina'), 'pronta:moca', 'Feminina vira Bianca (id continua moca)');
  assert.equal(voiceFromOldChoice('qwen:feminina'), 'pronta:moca');
  assert.equal(voiceFromOldChoice('pronta:moca:forte'), 'pronta:moca:forte', 'voz pronta escolhida continua');
  assert.equal(voiceFromOldChoice('online:x:Ana', (v) => v.startsWith('online:')), 'online:x:Ana', 'voz online continua');
  assert.equal(voiceFromOldChoice('Luciana (Melhorada)'), 'pronta:felipe', 'voz do Mac pelo nome volta para a padrão');
});

test('a última voz usa a chave nova e só migra a escolha antiga', () => {
  const src = read('src', 'lib', 'maestroVoice.ts');
  assert.match(src, /LAST_VOICE_KEY = 'vs-maestro-ia-voz-2'/);
  assert.match(src, /return voiceFromOldChoice\(old, /);
  assert.ok(!/return 'feminina';\s*\n\}/.test(src), 'a Feminina não é mais a padrão');
});

test('o seletor mostra Felipe e Bianca primeiro, como as vozes principais', () => {
  const picker = read('src', 'components', 'MaestroVoicePicker.tsx');
  const ready = picker.indexOf('{READY_VOICES.map(');
  const mac = picker.indexOf('{VOICE_PRESETS.map(');
  assert.ok(ready > 0 && mac > 0 && ready < mac, 'Felipe e Bianca vêm antes de Feminina e Masculina');
  assert.match(picker.slice(ready - 400, ready), />Voz<\/span>/, 'a linha das prontas é a linha "Voz"');
});

test('o banco tem cerca de cinco vezes mais falas, sem id ou texto repetido', () => {
  assert.ok(all.length >= 1000 && all.length <= 1100, `${all.length} falas`);
  assert.equal(new Set(all.map((c) => c.id)).size, all.length, 'id repetido');
  assert.equal(new Set(all.map((c) => cueKey(c.text))).size, all.length, 'texto repetido');
  for (const c of all) {
    assert.match(c.id, /^[a-z0-9]+(-[a-z0-9]+)*$/, `id fora do padrão: ${c.id}`);
    assert.ok(!c.text.includes('\u2014') && !c.text.includes('"'), `caractere proibido em ${c.text}`);
    assert.equal(findReadyCue(c.text)?.id, c.id, `o texto digitado não acha ${c.id}`);
  }
  for (const g of ['culto', 'tecnico', 'com-a-banda', 'cada-musico', 'harmonia', 'levada']) {
    assert.ok(READY_CUE_GROUPS.some((x) => x.id === g), `falta o assunto ${g}`);
  }
});

test('toda fala da lista tem a voz gravada, e os ids antigos não mudaram', () => {
  const ids = new Set(all.map((c) => c.id));
  assert.equal(RECORDED_CUE_IDS.size, all.length);
  for (const id of RECORDED_CUE_IDS) assert.ok(ids.has(id), id);
  assert.equal(findReadyCue('Vai pro refrão')?.id, 'vai-pro-refrao');
  for (const c of all) assert.ok(hasRecording(c), c.id);
  for (const w of ['Um', 'Dois', 'Três', 'Quatro']) assert.ok(hasRecording(findReadyCue(w)), w);
});

test('intensidade que a fala ainda não tem sai na Normal (nunca dá arquivo faltando)', () => {
  const felipe = readyVoice('pronta:felipe:calma');
  const nova = findReadyCue('Sobe');
  assert.ok(nova && hasRecording(nova));
  assert.equal(recordedIntensity(nova, 'calma'), 'normal');
  assert.equal(readyCueUrl(felipe, nova), `/maestro-falas/felipe/${nova.id}.mp3`);
  const antiga = findReadyCue('Vai pro refrão');
  assert.equal(recordedIntensity(antiga, 'calma'), 'calma');
  assert.equal(readyCueUrl(felipe, antiga), '/maestro-falas/felipe/calma/vai-pro-refrao.mp3');
  assert.equal(recordedIntensity(antiga, 'normal'), 'normal');
});

test('fala pronta sem gravação cai na voz do Mac com aviso, sem erro', () => {
  const src = read('src', 'lib', 'maestroVoice.ts');
  assert.match(src, /if \(cue && hasRecording\(cue\)\) \{\s*try \{\s*buffer = await readyCueBuffer\(ready, cue\);/);
  assert.match(src, /ainda não foi gravada na voz \$\{ready\.label\}: saiu na voz \$\{mac\} do Mac\./);
  assert.match(src, /Essa fala não está nas falas prontas: saiu na voz \$\{mac\} do Mac\./, 'o aviso de antes continua');
  assert.match(src, /voice = ready\.fallback;/);
});

test('busca: sem acento, sem diferença de maiúscula, palavras em qualquer ordem', () => {
  assert.deepEqual(searchWords('  Só VOZ! '), ['so', 'voz']);
  assert.equal(texts('refrao', 1)[0], 'Refrão');
  assert.equal(texts('REFRÃO', 1)[0], 'Refrão');
  assert.equal(texts('tom sobe meio', 1)[0], 'Sobe meio tom');
  assert.equal(texts('sobe meio tom', 1)[0], 'Sobe meio tom');
  assert.ok(texts('so voz').includes('Só voz e teclado'));
  assert.equal(texts('ministracao', 1)[0], 'Ministração');
  assert.deepEqual(searchReadyCues(''), []);
  assert.deepEqual(searchReadyCues('   '), []);
});

test('busca: todas as palavras precisam bater', () => {
  const hits = searchReadyCues('retorno voz');
  assert.ok(hits.length > 0);
  for (const h of hits) assert.match(h.cue.text.toLowerCase(), /retorno/);
  assert.ok(hits.every((h) => /voz/i.test(h.cue.text)));
  assert.deepEqual(searchReadyCues('refrão xilofone'), []);
});

test('busca: começo da palavra, número por extenso e nome do assunto', () => {
  assert.ok(texts('refr').includes('Pré-refrão'));
  assert.equal(texts('verso dois', 1)[0], 'Verso 2');
  assert.equal(texts('verso 2', 1)[0], 'Verso 2');
  assert.ok(texts('2').includes('Duas vezes'), 'algarismo acha o número por extenso');
  const culto = searchReadyCues('culto');
  assert.ok(culto.length >= 50 && culto.every((h) => h.group.id === 'culto'), 'o nome do assunto mostra o assunto');
  assert.equal(searchReadyCues('vai pro refrao')[0].group.label, 'Para onde ir', 'cada resultado traz o assunto');
});

test('busca: destaca os trechos que bateram, nas posições do texto original', () => {
  const [hit] = searchReadyCues('refrao pre');
  assert.equal(hit.cue.text, 'Pré-refrão');
  const parts = highlightParts(hit.cue.text, hit.ranges);
  assert.equal(parts.map((p) => p.text).join(''), 'Pré-refrão');
  assert.deepEqual(parts.filter((p) => p.match).map((p) => p.text), ['Pré', 'refrão']);
  const [sobe] = searchReadyCues('tom sob');
  assert.deepEqual(highlightParts(sobe.cue.text, sobe.ranges).filter((p) => p.match).map((p) => p.text), ['Sob', 'tom']);
  assert.deepEqual(highlightParts('Abc', []), [{ text: 'Abc', match: false }]);
});

test('a janela da fala usa a busca: foco ao abrir, Enter escolhe, Esc limpa', () => {
  const dialog = read('src', 'components', 'NarrationDialog.tsx');
  const picker = read('src', 'components', 'maestro', 'ReadyCuePicker.tsx');
  assert.match(dialog, /<ReadyCuePicker text=\{text\} busy=\{busy\} onPick=\{pickCue\}/);
  assert.match(dialog, /hasAttribute\?\.\(ESC_CLEARS_ATTR\) && t\.value\) return;/, 'Esc com busca escrita não fecha a janela');
  assert.match(picker, /useEffect\(\(\) => \{ if \(autoFocus\) inputRef\.current\?\.focus\(\); \}, \[autoFocus\]\);/);
  assert.match(picker, /e\.key === 'Enter'[\s\S]{0,200}const hit = shown\[active\] \?\? shown\[0\];/);
  assert.match(picker, /e\.key === 'Escape'[\s\S]{0,160}setQuery\(''\)/);
  assert.match(picker, /role="combobox"/);
  assert.match(picker, /console-well/);
  assert.match(picker, /console-key/);
  assert.match(picker, /sem gravação ainda/);
});
