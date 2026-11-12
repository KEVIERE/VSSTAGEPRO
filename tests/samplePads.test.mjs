// Pads do Modo Show: 9 pads (teclas 1 a 9) em 10 bancos (A a J). A tecla P (ou o botão da
// playlist) abre os pads no lugar do mixer; M volta para o mixer. As teclas 1 a 9 saíram das
// partes da música (o pular da parte foi para o N). O som sai pelo master do programa.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BANK_COUNT, BANK_LABELS, PAD_COUNT, bankCounts, dropTargets, formatPadTime, getPadsState, newPadInfo, padFileProblem,
  padForKey, padNameFromFile, padSlot, setPadsState, slotBank, slotPad, togglePadsPanel, withItem,
} from '../src/lib/samplePads.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (...p) => fs.readFileSync(path.join(here, '..', 'src', ...p), 'utf8');

test('9 pads em 10 bancos, de A a J: 90 lugares', () => {
  assert.equal(PAD_COUNT, 9);
  assert.equal(BANK_COUNT, 10);
  assert.deepEqual(BANK_LABELS, ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']);
  assert.equal(padSlot(0, 0), 0);
  assert.equal(padSlot(9, 8), 89);
  assert.equal(slotBank(40), 4);
  assert.equal(slotPad(40), 4);
});

test('teclas 1 a 9 tocam os pads; as outras não', () => {
  assert.equal(padForKey('1'), 0);
  assert.equal(padForKey('9'), 8);
  assert.equal(padForKey('0'), null);
  assert.equal(padForKey('p'), null);
  assert.equal(padForKey('10'), null);
});

test('o pad aceita WAV e MP3 (e outros áudios); recusa o resto com mensagem', () => {
  assert.equal(padFileProblem({ name: 'Vinheta.wav', type: 'audio/wav', size: 1000 }), null);
  assert.equal(padFileProblem({ name: 'grito.MP3', type: '', size: 1000 }), null, 'vale pela extensão');
  assert.match(padFileProblem({ name: 'letra.txt', type: 'text/plain', size: 10 }), /áudio/);
  assert.match(padFileProblem({ name: 'longo.wav', type: 'audio/wav', size: 61 * 1024 * 1024 }), /60 MB/);
  assert.match(padFileProblem({ name: 'vazio.wav', type: 'audio/wav', size: 0 }), /vazio/);
});

test('nome, cor e volume de um pad novo', () => {
  assert.equal(padNameFromFile('Explosao_final.wav'), 'Explosao final');
  assert.equal(padNameFromFile('a'.repeat(40) + '.mp3').length, 28);
  const info = newPadInfo(padSlot(2, 4), 'Aplausos.mp3', 7.4);
  assert.deepEqual({ ...info, color: undefined }, { slot: 22, name: 'Aplausos', color: undefined, volume: 0.8, loop: false, duration: 7.4 });
  assert.ok(info.color.startsWith('#'), 'a cor vem da posição do pad');
  assert.equal(formatPadTime(7.4), '0:07');
  assert.equal(formatPadTime(92), '1:32');
});

test('soltar vários arquivos: enche o pad e os vazios seguintes do banco', () => {
  const used = new Set([padSlot(1, 3)]);
  // solta 4 arquivos no pad 2 (índice 1) do banco B: vai no 2, pula o 4 (ocupado) e segue
  assert.deepEqual(dropTargets(1, 1, 4, used), [10, 11, 13, 14]);
  assert.deepEqual(dropTargets(0, 7, 5, new Set()), [7, 8], 'não passa para o próximo banco');
});

test('o botão do banco acende quando ele tem som', () => {
  const infos = new Map([[0, {}], [5, {}], [12, {}]]);
  assert.deepEqual(bankCounts(infos), [2, 1, 0, 0, 0, 0, 0, 0, 0, 0]);
});

test('o banco aberto e o volume geral ficam guardados; P abre e fecha', () => {
  const saved = globalThis.localStorage;
  const mem = new Map();
  globalThis.localStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)) };
  try {
    setPadsState({ bank: 3, master: 1.1 });
    assert.equal(mem.get('vsstage.pads.bank'), '3');
    assert.equal(mem.get('vsstage.pads.master'), '1.1');
    const before = getPadsState().visible;
    togglePadsPanel();
    assert.equal(getPadsState().visible, !before);
    togglePadsPanel();
    const set = new Set([1]);
    assert.notEqual(withItem(set, 2, true), set, 'Set novo para a tela redesenhar');
    assert.deepEqual([...withItem(set, 1, false)], []);
  } finally {
    globalThis.localStorage = saved;
  }
});

test('P abre os pads no lugar do mixer; 1 a 9 tocam; M volta para o mixer', () => {
  const panel = read('components', 'SamplePadPanel.tsx');
  assert.match(panel, /if \(e\.key === 'p' \|\| e\.key === 'P'\) \{/);
  assert.match(panel, /if \(!e\.repeat\) triggerPad\(padSlot\(cur\.bank, pad\)\);/);
  assert.match(panel, /return visible \? <SamplePadPanel \/> : <MixerPanel \/>;/, 'os pads entram no lugar do mixer');
  assert.match(panel, /setPadsState\(\{ visible: false \}\);\s*if \(!s\.mixerVisible\) s\.toggleMixer\(\);/, 'M com os pads abertos mostra o mixer');
  assert.match(panel, /type="file"/);
  assert.match(panel, /onContextMenu=/, 'botão direito ajusta o pad');
  assert.match(read('App.tsx'), /<PadsOrMixer \/>/);
  const playlist = read('components', 'PlaylistPanel.tsx');
  assert.match(playlist, /onClick=\{togglePadsPanel\}/, 'botão discreto ao lado do mixer');
  assert.match(playlist, /Abrir os pads no lugar do mixer \(P\)/);
});

test('as teclas 1 a 9 saíram das partes da música; pular a parte agora é N', () => {
  const sections = read('components', 'SectionPads.tsx');
  assert.doesNotMatch(sections, /\[1-9\]/);
  assert.doesNotMatch(sections, /e\.key === 'p'/);
  assert.match(sections, /e\.key === 'n' \|\| e\.key === 'N'/);
  assert.match(sections, /L · N/);
  const sales = read('components', 'sales', 'SalesPage.tsx');
  assert.match(sales, /\['L', 'N'\]/, 'o site anuncia as teclas que valem');
  assert.doesNotMatch(read('components', 'sales', 'PricingPage.tsx'), /teclas 1-9/);
});

test('pads com atraso mínimo: saída própria na mesma placa, seguindo o fader master', () => {
  const player = read('lib', 'padPlayer.ts');
  assert.match(player, /new AudioContext\(\{ latencyHint: 0 \}\)/, 'o menor bloco de áudio que o sistema aceita');
  assert.doesNotMatch(player, /getMasterInput/, 'não passa pelo motor das músicas (blocos grandes do modo estável e limitador)');
  assert.match(player, /const sink = audioEngine\.getOutputSinkId\(\);/, 'mesma placa das músicas');
  assert.match(player, /setSinkId\(sink\)/);
  assert.match(player, /faderToGain\(useStore\.getState\(\)\.masterVolume\) \* faderToGain\(getPadsState\(\)\.master\)/, 'o fader master vale para os pads');
  assert.match(player, /if \(info\.loop\) return; \/\/ loop: apertar de novo para/);
  assert.match(player, /buffer\.duration > MAX_PAD_SECONDS/, 'sons de até 3 minutos');
  assert.match(read('lib', 'audioEngine.ts'), /getOutputSinkId\(\): string \{/);
  const panel = read('components', 'SamplePadPanel.tsx');
  assert.match(panel, /useEffect\(\(\) => \{ if \(visible\) openPadOutput\(\); \}, \[visible\]\);/, 'a saída abre junto com o painel');
  assert.match(panel, /onPointerDown=/, 'o pad toca ao apertar, sem esperar soltar o botão');
  assert.match(read('lib', 'padStorage.ts'), /const DB_NAME = 'vs-stage-pads';/, 'não mexe no banco dos projetos');
});
