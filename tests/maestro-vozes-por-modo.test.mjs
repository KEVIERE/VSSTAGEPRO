// Três maestros prontos: cada voz só mostra o que tem gravado, e modo que falta cai no Normal da
// mesma voz. Sem pacote, o programa fica igual ao publicado.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import {
  READY_CUE_GROUPS, cueShownFor, findReadyCue, offeredReadyVoices, readyCueSource, readyCueUrl, readyVoice, readyVoiceId, recordedIntensity,
  searchReadyCues, setVoicePacks, voiceHasCue, voiceHasMode, voicePackRevision, voicePacksVersion, voiceSampleTexts, wordsMissingInVoice,
} from '../src/lib/maestroCues.ts';
import { countWords } from '../src/lib/narrations.ts';

const require = createRequire(import.meta.url);
const { createMaestroPacks } = require('../desktop/maestroPacks.js');

const nova = 'levada-de-piseiro';
const antiga = 'vai-pro-refrao';
const pack = (voice, recorded = {}) => ({
  voice, state: 'pronto', progress: 1, recorded: { normal: [antiga, nova], calma: [], forte: [nova], ...recorded },
});
const read = (...p) => fs.readFileSync(path.join(...p), 'utf8');

test('sem pacote: só o Maestro 1, e fala nova não aparece em voz nenhuma', () => {
  setVoicePacks([]);
  assert.deepEqual(offeredReadyVoices().map((v) => v.label), ['Maestro 1']);
  for (const v of ['pronta:felipe', 'pronta:moca', 'pronta:will', 'clone:x']) assert.equal(cueShownFor(v, nova), false, v);
  assert.equal(cueShownFor('pronta:felipe', antiga), true);
  assert.equal(cueShownFor('pronta:will', antiga), false);
  assert.equal(searchReadyCues('piseiro', Infinity, (c) => cueShownFor('pronta:felipe', c)).length, 0);
  assert.equal(READY_CUE_GROUPS.filter((g) => g.cues.some((c) => cueShownFor('pronta:felipe', c))).some((g) => g.id === 'arranjo-e-convencoes'), false);
});

test('projeto antigo com Bianca continua achando o arquivo embutido, nas intensidades antigas', () => {
  setVoicePacks([]);
  assert.equal(readyCueUrl(readyVoice('pronta:moca:calma'), findReadyCue('Vai pro refrão')), '/maestro-falas/moca/calma/vai-pro-refrao.mp3');
  assert.equal(readyCueSource(readyVoice('pronta:moca:calma'), findReadyCue('Vai pro refrão')).pack, false);
});

test('contrato real: a saída de status() passa por setVoicePacks e a fala sai por file()', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'vs-pacote-'));
  const dir = path.join(home, 'will', 'v1');
  fs.mkdirSync(path.join(dir, 'forte'), { recursive: true });
  const audio = Buffer.from('audio-da-fala');
  const sha256 = crypto.createHash('sha256').update(audio).digest('hex');
  const files = ['atencao.mp3', `${nova}.mp3`, `forte/${nova}.mp3`];
  for (const f of files) fs.writeFileSync(path.join(dir, f), audio);
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({
    schema: 1, voice: 'will', version: 'v1', files: files.map((p) => ({ path: p, size: audio.length, sha256 })),
  }));
  fs.writeFileSync(path.join(home, 'will', 'atual.json'), JSON.stringify({ version: 'v1' }));
  const packs = createMaestroPacks({ home, pins: { voices: {} } });

  setVoicePacks(await packs.status());
  assert.deepEqual(offeredReadyVoices().map((v) => v.label), ['Maestro 1', 'Maestro 2']);
  const source = readyCueSource(readyVoice('pronta:will:forte'), { id: nova });
  assert.equal(source.pack, true);
  const got = await packs.file({ voice: source.voice, mode: source.mode, id: source.id });
  assert.equal(Buffer.from(got).toString(), 'audio-da-fala');
  setVoicePacks([]);
  fs.rmSync(home, { recursive: true, force: true });
});

test('pacote instalado: a voz aparece e toca do pacote', () => {
  setVoicePacks([pack('will')]);
  assert.deepEqual(offeredReadyVoices().map((v) => v.label), ['Maestro 1', 'Maestro 2']);
  assert.equal(cueShownFor('pronta:will', nova), true);
  assert.equal(cueShownFor('pronta:felipe', nova), false, 'a fala nova fica só na voz que a tem');
  const s = readyCueSource(readyVoice('pronta:will:forte'), { id: nova });
  assert.deepEqual({ pack: s.pack, voice: s.voice, mode: s.mode, id: s.id }, { pack: true, voice: 'will', mode: 'forte', id: nova });
  assert.match(s.key, new RegExp(`^pack:will:\\d+:forte:${nova}$`));
  setVoicePacks([]);
});

test('modo sem gravação cai no Normal da MESMA voz', () => {
  setVoicePacks([pack('will')]);
  const v = readyVoice('pronta:will:calma');
  assert.equal(recordedIntensity(nova, 'calma', 'will'), 'normal');
  assert.equal(readyCueSource(v, { id: nova }).mode, 'normal');
  assert.equal(voiceHasCue(v, nova, 'calma'), true);
  setVoicePacks([]);
});

test('status inválido ou pacote vazio não cria voz', () => {
  setVoicePacks([{ voice: 'will', recorded: { normal: [], calma: [], forte: [] } }, { voice: 'outra', recorded: { normal: [antiga] } }, null]);
  assert.deepEqual(offeredReadyVoices().map((v) => v.label), ['Maestro 1']);
  setVoicePacks('lixo');
  assert.deepEqual(offeredReadyVoices().map((v) => v.label), ['Maestro 1']);
});

test('a mesma leitura não invalida o cache; pacote atualizado sim', () => {
  setVoicePacks([pack('carla')]);
  const rev = voicePackRevision('carla');
  const ver = voicePacksVersion();
  setVoicePacks([pack('carla')]);
  assert.equal(voicePackRevision('carla'), rev);
  assert.equal(voicePacksVersion(), ver, 'sem mudança a tela não redesenha');
  setVoicePacks([pack('carla')], ['carla']);
  assert.notEqual(voicePackRevision('carla'), rev, 'mesmas falas com áudio novo');
  setVoicePacks([]);
});

test('o exemplo usa só falas que a voz tem', () => {
  setVoicePacks([pack('will', { normal: ['refrao'], forte: [] })]);
  assert.deepEqual(voiceSampleTexts(readyVoice('pronta:will')), [findReadyCue('Refrão').text]);
  setVoicePacks([pack('will', { normal: ['atencao', 'um', 'tres'], forte: [] })]);
  assert.deepEqual(voiceSampleTexts(readyVoice('pronta:will')), ['Atenção', 'Um', 'Três']);
  setVoicePacks([]);
  assert.deepEqual(voiceSampleTexts(readyVoice('pronta:felipe')), ['Atenção', 'Um', 'Dois', 'Três', 'Quatro']);
});

test('contagem: número sem gravação na voz é apontado antes de criar', () => {
  setVoicePacks([]);
  for (const w of ['Onze', 'Treze', 'Catorze', 'Quinze']) assert.ok(findReadyCue(w), `${w} no catálogo`);
  assert.deepEqual(wordsMissingInVoice('pronta:felipe', countWords(12, 4, false)), ['Onze']);
  assert.deepEqual(wordsMissingInVoice('pronta:felipe', countWords(16, 4, false)), ['Onze', 'Treze', 'Catorze', 'Quinze']);
  assert.deepEqual(wordsMissingInVoice('pronta:felipe', countWords(16, 4, true)), [], 'recomeçando a cada compasso');
  assert.deepEqual(wordsMissingInVoice('pronta:felipe', countWords(8, 4, false)), []);
  assert.deepEqual(wordsMissingInVoice('clone:ana', countWords(16, 4, false)), [], 'a voz clonada tem o pacote próprio');
});

test('trocar para voz sem o modo não grava um modo que não toca', () => {
  setVoicePacks([pack('will', { calma: [] })]);
  const will = offeredReadyVoices().find((v) => v.dir === 'will');
  assert.equal(voiceHasMode(will, 'calma'), false);
  assert.equal(readyVoiceId(will, voiceHasMode(will, 'calma') ? 'calma' : 'normal'), 'pronta:will');
  setVoicePacks([]);
  const picker = read('src', 'components', 'MaestroVoicePicker.tsx');
  assert.match(picker, /readyVoiceId\(v, voiceHasMode\(v, intensity\) \? intensity : 'normal'\)/);
});

test('o seletor não monta exemplo sem clique, e arquivo que não abre não vira voz do sistema', () => {
  const picker = read('src', 'components', 'MaestroVoicePicker.tsx');
  assert.doesNotMatch(picker, /setTimeout\(\(\) => \{ void voiceDemo/);
  const voice = read('src', 'lib', 'maestroVoice.ts');
  assert.match(voice, /window\.vsDesktop\?\.maestroPackStatus/);
  assert.doesNotMatch(voice, /maestroFalasPackStatus/);
  assert.match(voice, /if \(missingFile\) throw new Error/);
  assert.match(voice, /readyCachePut\(key, out\)/);
});
