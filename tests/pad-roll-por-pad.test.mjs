// Roll por pad: cada pad tem a tecla ROLL dele. O knob ROLL só dá o tamanho do pedaço (no tempo
// da música); só os pads com ROLL ligado repetem, e ligar ou desligar vale na hora só naquele pad.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  DEFAULT_PAD_FX, DEFAULT_ROLL_KNOB, ROLL_KNOB_MIN, newPadInfo, normalizePadInfo, padForKey, padForRollKey, padRollSeconds,
  rollBeats, rollKnob, rollLabel, rollingSlots, savedPadsOf,
} from '../src/lib/samplePads.ts';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const player = read('../src/lib/padPlayer.ts');
const panel = read('../src/components/SamplePadPanel.tsx');

test('pad novo e pad guardado antes (sem o campo) ficam com o roll desligado', () => {
  assert.equal(newPadInfo(0, 'a.wav', 1).roll, false);
  assert.equal(normalizePadInfo({ slot: 4, name: 'Velho', loop: true, duration: 2 }).roll, false);
  assert.equal(normalizePadInfo({ slot: 4, roll: true }).roll, true);
  assert.equal(normalizePadInfo({ slot: 4, roll: 'sim' }).roll, false, 'valor estranho no arquivo: desligado');
});

test('o roll de cada pad vai no projeto e volta igual', () => {
  const infos = new Map([
    [2, { ...newPadInfo(2, 'Caixa.wav', 1), roll: true }],
    [5, newPadInfo(5, 'Prato.wav', 3)],
  ]);
  const saved = JSON.parse(JSON.stringify(savedPadsOf({ bank: 0, master: 0.8, output: { channel: 0, stereo: true }, infos })));
  const back = new Map(saved.pads.map((p) => {
    const info = { ...p };
    delete info.path;
    return [p.slot, normalizePadInfo(info)];
  }));
  assert.equal(back.get(2).roll, true);
  assert.equal(back.get(5).roll, false);
  // projeto salvo antes do roll por pad: sem o campo, abre desligado
  const old = { ...saved.pads[0] };
  delete old.roll;
  assert.equal(normalizePadInfo(old).roll, false);
  assert.match(player, /reverse: old\.reverse, roll: !!old\.roll \}/, 'trocar o som do pad mantém o roll dele');
});

test('só os pads com ROLL ligado repetem; o knob dá o tamanho', () => {
  const infos = new Map([[0, { roll: true }], [1, { roll: false }], [2, {}], [3, { roll: true }]]);
  assert.deepEqual(rollingSlots([0, 1, 2, 3, 7], infos), [0, 3], 'tocando os 4: só o 0 e o 3 repetem');
  assert.equal(padRollSeconds(1, 120, false), null, 'pad sem roll: toca normal, com o knob em qualquer lugar');
  assert.equal(padRollSeconds(1, 120, undefined), null);
  assert.equal(padRollSeconds(1, 120, true), 0.5 / 64, 'knob no fim: 1/64');
  assert.equal(padRollSeconds(ROLL_KNOB_MIN, 120, true), 0.5, 'knob todo para a esquerda: 1 tempo');
});

test('knob em 0 (o "desligado" de antes) vale 1/8: apertar a tecla ROLL sempre repete', () => {
  assert.equal(rollBeats(DEFAULT_ROLL_KNOB), 1 / 8);
  assert.equal(DEFAULT_PAD_FX.roll, DEFAULT_ROLL_KNOB);
  assert.equal(rollKnob(0), DEFAULT_ROLL_KNOB);
  assert.equal(rollLabel(rollKnob(0)), '1/8');
  assert.equal(padRollSeconds(0, 120, true), 0.5 / 8, '1/8 a 120 BPM');
  assert.equal(rollKnob(1), 1);
  assert.equal(rollBeats(ROLL_KNOB_MIN), 1);
  assert.match(read('../src/lib/samplePads.ts'), /roll: rollKnob\(num\(v\.roll, 0, 1, DEFAULT_PAD_FX\.roll\)\)/, 'knob guardado em OFF abre em 1/8');
});

test('tocar e ligar ou desligar o roll: vale só na voz daquele pad', () => {
  assert.match(player, /const sec = padRollSeconds\(fx\.roll, songBpm\(\), infos\.get\(slot\)\?\.roll\);/);
  assert.match(player, /if \(info\.roll\) applyRoll\(slot, voice, onsetOf\(src\.buffer\)\);/, 'ROLL ligado antes do toque: começa no primeiro som');
  assert.doesNotMatch(player, /fx\.roll > 0/, 'o knob sozinho não liga o roll de ninguém');
  assert.match(player, /for \(const slot of rollingSlots\(voices\.keys\(\), getPadsState\(\)\.infos\)\) applyRoll\(slot, voices\.get\(slot\)!\);/,
    'mexer no knob muda só os pads com ROLL');
  assert.match(player, /if \(patch\.roll !== undefined\) applyRoll\(slot, v\);/, 'liga ou desliga na hora, só nesta voz');
  assert.match(player, /v\.src\.loop = !!getPadsState\(\)\.infos\.get\(slot\)\?\.loop;/, 'desligou: volta ao loop do pad ou ao normal');
  assert.match(player, /export async function togglePadRoll\(slot: number\)/);
});

test('teclas: Shift + 1 a 9 (pela tecla física) e R no pad escolhido; 1 a 9 continuam tocando', () => {
  assert.equal(padForRollKey('Digit1'), 0);
  assert.equal(padForRollKey('Digit9'), 8);
  assert.equal(padForRollKey('Numpad3'), 2);
  assert.equal(padForRollKey('Digit0'), null);
  assert.equal(padForRollKey('KeyR'), null);
  assert.equal(padForKey('1'), 0, 'o atalho de tocar não mudou');
  assert.equal(padForKey('!'), null, 'Shift + 1 não toca o pad');
  assert.match(panel, /const rollPad = e\.shiftKey \? padForRollKey\(e\.code\) : null;/);
  assert.match(panel, /togglePadRoll\(rollPad !== null \? padSlot\(cur\.bank, rollPad\) : cur\.selected\)/);
});

test('tecla ROLL no painel: ao lado do CORTAR, nos ajustes do pad e aceso no próprio pad', () => {
  const toolbar = panel.slice(panel.indexOf('role="group" aria-label="Efeitos do pad escolhido"') - 40, panel.indexOf('<FxKnobs />'));
  assert.match(toolbar, /grid grid-cols-6 gap-1/);
  assert.ok(toolbar.indexOf('label="ROLL"') > toolbar.indexOf('label="CORTAR"'), 'ROLL vem depois do CORTAR');
  assert.match(toolbar, /label="ROLL"\s+on=\{!!selected\?\.roll\}\s+lit="is-lit-amber"/);
  assert.match(toolbar, /togglePadRoll\(selected\.slot\)/);
  const editor = panel.slice(panel.indexOf('function PadEditor'));
  assert.match(editor, /console-key h-7 px-2\.5 flex items-center justify-center gap-1\.5 \$\{info\.roll \? 'is-lit-amber' : ''\}/);
  assert.match(editor, /onClick=\{\(\) => void togglePadRoll\(info\.slot\)\}/);
  const pad = panel.slice(panel.indexOf('function Pad({'), panel.indexOf('function PadEditor'));
  assert.match(pad, /\{info\.roll && \(/);
  assert.match(pad, /console-led is-on-amber/);
  assert.match(panel, /info\.roll && 'ROLL'/, 'o visor do pad escolhido mostra o ROLL');
  const knob = panel.slice(panel.indexOf('label="ROLL"\n        value='));
  assert.match(knob, /min=\{ROLL_KNOB_MIN\}/);
  assert.match(knob, /Tamanho do roll nos pads com ROLL ligado/);
  assert.match(knob, /onReset=\{\(\) => setPadsFx\(\{ roll: DEFAULT_PAD_FX\.roll \}\)\}/);
});
