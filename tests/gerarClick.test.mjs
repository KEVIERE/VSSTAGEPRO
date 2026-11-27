// Botão direito na faixa Click: "Gerar click a partir da música", para VS que veio sem click.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');
const im = read('lib/importManager.ts');
const tools = read('lib/clickTools.ts');
const menu = read('components/ClickMenuItems.tsx');

test('a opção aparece no menu da faixa Click', () => {
  assert.match(menu, /kind: 'generate', label: 'Gerar click a partir da música\.\.\.'/);
});

test('só vale para música sem click e com áudio', () => {
  assert.match(tools, /if \(kind === 'generate'\) \{\n\s+if \(click\) return 'Esta música já tem click/);
  assert.match(im, /esta música já tem click/);
  assert.match(im, /esta música não tem áudio para analisar/);
});

test('mede a música inteira (com trocas de BPM), põe na grade e cria o click em cima dela', () => {
  const fn = im.slice(im.indexOf('export async function generateSongClick'), im.indexOf('export async function remeasureSongBpm'));
  assert.match(fn, /await bandRulerMono\(songId, start.duration/);
  assert.match(fn, /await addMedleyClick\(songId\)/);
  assert.ok(fn.indexOf('readTempoMap') < fn.lastIndexOf('addMedleyClick'), 'primeiro mede, depois cria o click');
  assert.match(fn, /song\.tempoSegments\?\.length \? song\.tempoSegments\.map/);
});

test('o painel mostra os BPMs encontrados', () => {
  assert.match(tools, /bpmFoundNotice\(name, res\.bpms\)/);
});

test('VS com MIDI lido e sem click: o click sai da grade do MIDI na importação', () => {
  assert.match(im, /if \(sg && midiTempo && sg\.tempoMapSource === 'midi'\) \{\n\s+await addMedleyClick\(songId\);/);
  assert.match(im, /Click criado a partir do MIDI\./);
});

test('VS sem MIDI e sem click: não gera sozinho, só avisa onde gerar', () => {
  assert.match(im, /veio sem click\. Para criar, clique com o botão direito na track Click/);
});

test('Gerar click numa música com mapa do MIDI não ouve a música de novo', () => {
  const fn = im.slice(im.indexOf('export async function generateSongClick'), im.indexOf('export async function remeasureSongBpm'));
  assert.ok(fn.indexOf("start.tempoMapSource === 'midi'") < fn.indexOf('bandRulerMono'), 'o MIDI é conferido antes de ouvir');
});
