// Pads do Modo Show: 9 pads (teclas 1 a 9) em 10 bancos (A a J), com cara de controlador de pads.
// P abre os pads no lugar do mixer; M volta. Cada pad tem volume (knob), pitch, reverb, delay,
// reverso e loop; o fader geral, a saída da placa e tudo mais vão junto no projeto salvo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BANK_COUNT, BANK_LABELS, MASTER_OUTPUT, PAD_COUNT, bankCounts, chokedBy, clampPitch, delaySeconds, dropTargets, formatPadTime,
  getPadsState, holdStopTime, lastPlaying, makeReverbImpulse, newPadInfo, normalizePadInfo, padAssetId, padAssetPath, padFileProblem,
  padForKey, padNameFromFile, padOutputLabel, padOutputOptions, padSlot, pitchLabel, pitchRate, pitchedDuration, savedPadsOf,
  setPadsState, slotBank, slotPad, togglePadsPanel, usablePadOutput, withItem, withPlaying,
} from '../src/lib/samplePads.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (...p) => fs.readFileSync(path.join(here, '..', 'src', ...p), 'utf8');

test('9 pads em 10 bancos, de A a J: 90 lugares', () => {
  assert.equal(PAD_COUNT, 9);
  assert.equal(BANK_COUNT, 10);
  assert.deepEqual(BANK_LABELS, ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']);
  assert.equal(padSlot(9, 8), 89);
  assert.equal(slotBank(40), 4);
  assert.equal(slotPad(40), 4);
});

test('teclas 1 a 9 tocam os pads; as outras não', () => {
  assert.equal(padForKey('1'), 0);
  assert.equal(padForKey('9'), 8);
  assert.equal(padForKey('0'), null);
  assert.equal(padForKey('p'), null);
});

test('o pad aceita WAV e MP3 (e outros áudios); recusa o resto com mensagem', () => {
  assert.equal(padFileProblem({ name: 'Vinheta.wav', type: 'audio/wav', size: 1000 }), null);
  assert.equal(padFileProblem({ name: 'grito.MP3', type: '', size: 1000 }), null);
  assert.match(padFileProblem({ name: 'letra.txt', type: 'text/plain', size: 10 }), /áudio/);
  assert.match(padFileProblem({ name: 'longo.wav', type: 'audio/wav', size: 61 * 1024 * 1024 }), /60 MB/);
});

test('pad novo: nome do arquivo, cor da posição, 0 dB, sem pitch nem efeitos', () => {
  assert.equal(padNameFromFile('Explosao_final.wav'), 'Explosao final');
  const info = newPadInfo(padSlot(2, 4), 'Aplausos.mp3', 7.4);
  assert.equal(info.name, 'Aplausos');
  assert.equal(info.volume, 0.8);
  assert.deepEqual([info.pitch, info.reverb, info.delay, info.reverse, info.loop], [0, false, false, false, false]);
  // pad guardado por uma versão antiga ganha os padrões novos
  const old = normalizePadInfo({ slot: 3, name: 'Velho', color: '#fff', volume: 1, loop: true, duration: 2 });
  assert.deepEqual([old.pitch, old.reverb, old.delay, old.reverse, old.loop], [0, false, false, false, true]);
  assert.equal(formatPadTime(92), '1:32');
});

test('pitch: -12 a +12 semitons, muda a velocidade e o tamanho como num sampler', () => {
  assert.equal(pitchRate(12), 2);
  assert.equal(pitchRate(-12), 0.5);
  assert.equal(pitchRate(0), 1);
  assert.equal(clampPitch(20), 12);
  assert.equal(clampPitch(-3.4), -3);
  assert.equal(pitchedDuration({ duration: 8, pitch: 12 }), 4);
  assert.deepEqual([pitchLabel(3), pitchLabel(-5), pitchLabel(0)], ['+3', '-5', '0']);
});

test('saída dos pads: Master ou uma saída da placa, mono ou par, como no mixer', () => {
  assert.deepEqual(padOutputOptions(6, true).map(padOutputLabel), ['Master', 'Saída 1/2', 'Saída 3/4', 'Saída 5/6']);
  assert.deepEqual(padOutputOptions(4, false).map(padOutputLabel), ['Master', 'Saída 1', 'Saída 2', 'Saída 3', 'Saída 4']);
  assert.deepEqual(usablePadOutput({ channel: 3, stereo: true }, 4), { channel: 3, stereo: true });
  assert.deepEqual(usablePadOutput({ channel: 5, stereo: true }, 4), MASTER_OUTPUT, 'saída que a placa não tem volta para o Master');
});

test('efeitos: delay no tempo da música e reverb com cauda que some', () => {
  assert.equal(delaySeconds(120), 0.5);
  assert.equal(delaySeconds(0), 0.5, 'sem BPM usa 120');
  assert.equal(delaySeconds(20), 1.5, 'no máximo 1,5 s');
  const [l, r] = makeReverbImpulse(48000, 2);
  assert.equal(l.length, 96000);
  assert.ok(l.every(Number.isFinite) && r.every(Number.isFinite));
  const energy = (d, a, b) => d.subarray(a, b).reduce((s, v) => s + v * v, 0);
  assert.ok(energy(l, 600, 10000) > energy(l, 86000, 96000) * 50, 'a cauda some');
  assert.equal(l[100], 0, '12 ms de pré-atraso');
  assert.notDeepEqual(Array.from(l.subarray(1000, 1010)), Array.from(r.subarray(1000, 1010)), 'estéreo');
  assert.deepEqual(Array.from(makeReverbImpulse(8000, 0.1)[0]), Array.from(makeReverbImpulse(8000, 0.1)[0]), 'sempre igual');
});

test('soltar vários arquivos: enche o pad e os vazios seguintes do banco', () => {
  assert.deepEqual(dropTargets(1, 1, 4, new Set([padSlot(1, 3)])), [10, 11, 13, 14]);
  assert.deepEqual(dropTargets(0, 7, 5, new Set()), [7, 8]);
});

test('banco com som acende; o visor mostra o último pad que começou', () => {
  assert.deepEqual(bankCounts(new Map([[0, {}], [5, {}], [12, {}]])), [2, 1, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(lastPlaying(new Map([[2, 1.5], [7, 3.2], [4, 0.1]])), 7);
  assert.equal(lastPlaying(new Map()), null);
  const m = new Map([[1, 0]]);
  assert.notEqual(withPlaying(m, 2, 5), m);
  assert.deepEqual([...withPlaying(m, 1, null).keys()], []);
  assert.deepEqual([...withItem(new Set([1]), 1, false)], []);
});

test('um por vez: tocar um pad para os outros; desligado, todos tocam juntos', () => {
  assert.deepEqual(chokedBy(4, [1, 4, 7], true), [1, 7], 'para os outros, não o próprio (que recomeça)');
  assert.deepEqual(chokedBy(4, [1, 7], false), [], 'desligado: nada para');
  assert.deepEqual(chokedBy(2, [], true), []);
  const player = read('lib', 'padPlayer.ts');
  assert.match(player, /for \(const other of chokedBy\(slot, voices\.keys\(\), getPadsState\(\)\.choke\)\) release\(other, 0\.03\);/, 'para com descida curta, sem estalo');
  assert.match(player, /choke: saved\.choke \?\? getPadsState\(\)\.choke/, 'vem do projeto aberto');
  const panel = read('components', 'SamplePadPanel.tsx');
  assert.match(panel, /onClick=\{\(\) => setPadsChoke\(!st\.choke\)\}/);
  assert.match(panel, /1 POR VEZ/);
});

test('segurar: apertou e soltou rápido toca 1 segundo; segurando toca até soltar (ou o som acabar)', () => {
  assert.equal(holdStopTime(10, 10.3), 11, 'soltou com 0,3 s: completa 1 segundo');
  assert.equal(holdStopTime(10, 12.5), 12.5, 'segurou 2,5 s: para ao soltar');
  assert.equal(newPadInfo(0, 'a.wav', 1).hold, false);
  assert.equal(normalizePadInfo({ slot: 1 }).hold, false, 'pad antigo começa sem segurar');
  const player = read('lib', 'padPlayer.ts');
  assert.match(player, /export function releasePad\(slot: number\): void \{/);
  assert.match(player, /if \(!info\?\.hold \|\| !v\) return;/, 'só vale no modo segurar');
  assert.match(player, /const at = holdStopTime\(v\.startedAt, ctx\.currentTime\);/);
  assert.match(player, /if \(info\.loop && !info\.hold\) return;/, 'no modo segurar, apertar de novo recomeça');
  const panel = read('components', 'SamplePadPanel.tsx');
  assert.match(panel, /label="SEGURAR"/);
  assert.match(panel, /onPointerUp=\{onRelease\}/, 'soltar o mouse');
  assert.match(panel, /e\.currentTarget\.setPointerCapture\(e\.pointerId\);/, 'soltar fora do pad também conta');
  assert.match(panel, /window\.addEventListener\('keyup', onKeyUp\);/, 'soltar a tecla 1 a 9');
});

test('banco, volume geral e saída ficam guardados; P abre e fecha', () => {
  const saved = globalThis.localStorage;
  const mem = new Map();
  globalThis.localStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)) };
  try {
    setPadsState({ bank: 3, master: 1.1, output: { channel: 3, stereo: true }, choke: true });
    assert.equal(mem.get('vsstage.pads.choke'), '1', 'o um por vez fica guardado');
    assert.equal(mem.get('vsstage.pads.bank'), '3');
    assert.equal(mem.get('vsstage.pads.master'), '1.1');
    assert.equal(mem.get('vsstage.pads.output'), '{"channel":3,"stereo":true}');
    const before = getPadsState().visible;
    togglePadsPanel();
    assert.equal(getPadsState().visible, !before);
    togglePadsPanel();
  } finally {
    globalThis.localStorage = saved;
  }
});

test('no projeto: ajustes no manifesto e cada som como áudio do pacote', () => {
  const infos = new Map([[13, { ...newPadInfo(13, 'Aplausos fortes.mp3', 3), type: 'audio/mpeg', pitch: 2, reverb: true }]]);
  const s = savedPadsOf({ bank: 1, master: 0.9, output: { channel: 3, stereo: true }, choke: true, infos });
  assert.equal(s.bank, 1);
  assert.equal(s.choke, true, 'o um por vez vai no projeto');
  assert.deepEqual(s.output, { channel: 3, stereo: true });
  assert.equal(s.pads[0].pitch, 2);
  assert.equal(s.pads[0].reverb, true);
  assert.equal(s.pads[0].path, 'Pads/Banco B/5 - Aplausos fortes.mp3');
  assert.equal(padAssetId(13), 'pad:13');
  assert.equal(padAssetPath({ slot: 0, name: 'a/b:c', type: 'audio/wav' }), 'Pads/Banco A/1 - a b c.wav');
  assert.equal(savedPadsOf({ bank: 0, master: 0.8, output: MASTER_OUTPUT, infos: new Map() }), undefined, 'sem pads, nada no manifesto');
});

test('o salvar e o abrir do projeto levam os pads (pacote, pasta e salvar rápido)', () => {
  const saver = read('lib', 'projectSaver.ts');
  assert.match(saver, /\.\.\.extraManifestFields\(\),/, 'ajustes dos pads no manifesto');
  assert.match(saver, /const all = \[\.\.\.plan\.flatMap\(\(p\) => p\.assets\), \.\.\.extras\.map\(\(x\) => x\.plan\)\];/, 'sons dos pads no pacote');
  assert.match(saver, /for \(const \{ plan, extra \} of extraAssets\(\)\) \{/, 'salvar só o fim também confere os sons dos pads');
  assert.equal((saver.match(/projectExtras\(\)\.forEach\(\(x\) => x\.rebind\(sources\)\);/g) ?? []).length, 2, 'depois de salvar, os sons apontam para o arquivo novo');
  assert.equal((saver.match(/e\.folderAssets\(manifest as unknown as Record<string, unknown>\)/g) ?? []).length, 2, 'pasta de projeto também');
  assert.match(read('store.ts'), /projectExtras\(\)\.forEach\(\(x\) => x\.loaded\(manifest as unknown as Record<string, unknown>, sources\)\);/);
  const player = read('lib', 'padPlayer.ts');
  assert.match(player, /registerProjectExtras\(\{/);
  assert.match(player, /if \(saved\?\.pads\?\.length\) void applyProjectPads\(saved, files\);/, 'projeto sem pads não apaga os pads atuais');
});

test('motor dos pads: atraso mínimo, saída escolhida, efeitos e medidor', () => {
  const player = read('lib', 'padPlayer.ts');
  assert.match(player, /new AudioContext\(\{ latencyHint: 0 \}\)/);
  assert.match(player, /const sink = audioEngine\.getOutputSinkId\(\);/);
  assert.match(player, /const merger = o\.ctx\.createChannelMerger\(n\);/, 'liga a soma na saída escolhida da placa');
  assert.match(player, /return faderToGain\(master\) \* \(viaMaster \? faderToGain\(useStore\.getState\(\)\.masterVolume\) : 1\);/, 'o fader master só vale no Master');
  assert.match(player, /src\.playbackRate\.value = pitchRate\(info\.pitch\);/);
  assert.match(player, /src\.buffer = info\.reverse \? reversedBuffer\(slot, buffer\) : buffer;/);
  assert.match(player, /connectSends\(voice, o, info\.reverb, info\.delay\);/);
  assert.match(player, /publishMeters\(new Map\(\[\['pads', meterLevel\]\]\)\);/);
  assert.match(player, /export function triggerPad\(slot: number\): void \{\s*selectPad\(slot\);/, 'apertar o pad escolhe ele');
});

test('tela: knob do pad, fader geral, visores, pitch, efeitos, saída e pads acesos', () => {
  const panel = read('components', 'SamplePadPanel.tsx');
  assert.match(panel, /<PadKnob[\s\S]{0,120}value=\{selected\?\.volume \?\? 0\}/, 'o knob mostra o volume do pad escolhido');
  assert.match(panel, /<Fader value=\{st\.master\} onChange=\{setPadsMaster\}/, 'fader vertical do volume geral');
  assert.match(panel, /<LedMeter id="pads"/);
  assert.match(panel, /<PlayingDisplay \/>/);
  assert.match(panel, /<DetailsDisplay/);
  assert.match(panel, /<PitchFader/);
  for (const fx of ['REVERB', 'DELAY', 'REVERSO', 'LOOP']) assert.match(panel, new RegExp(`label="${fx}"`));
  assert.match(panel, /<OutputButton output=\{st\.output\} \/>/);
  assert.match(panel, /onClick=\{fadeAllPads\}/);
  assert.match(panel, /return visible \? <SamplePadPanel \/> : <MixerPanel \/>;/);
  assert.match(panel, /if \(e\.key === 'p' \|\| e\.key === 'P'\) \{/);
});

test('as teclas 1 a 9 saíram das partes da música; pular a parte é N; o site anuncia L e N', () => {
  const sections = read('components', 'SectionPads.tsx');
  assert.doesNotMatch(sections, /\[1-9\]/);
  assert.match(sections, /e\.key === 'n' \|\| e\.key === 'N'/);
  assert.match(read('components', 'sales', 'SalesPage.tsx'), /\['L', 'N'\]/);
  assert.match(read('components', 'PlaylistPanel.tsx'), /onClick=\{togglePadsPanel\}/);
  assert.match(read('lib', 'padStorage.ts'), /const DB_NAME = 'vs-stage-pads';/);
});
