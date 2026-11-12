// Seleção na timeline como numa DAW: arrastar na grade desenha um retângulo; Cmd+clique soma ou
// tira; Shift+clique vai do clicado antes até o de agora. As falas do Maestro IA entram junto.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  NARRATION_ROW, clipsInBox, marqueeSelection, rangeSelection, rowOf, rowsBetween, selectionRows, splitNarrationClips,
} from '../src/lib/timelineSelection.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (...p) => fs.readFileSync(path.join(here, '..', 'src', ...p), 'utf8');
const IA = 'track-maestro-ia';
const len = (c) => c.duration;
const clip = (id, trackId, startTime, duration) => ({ id, trackId, startTime, duration });

// Guia, Click, Maestro, (falas), Bateria, Baixo
const rows = selectionRows(['track-guia', 'track-click', 'track-maestro', 'bateria', 'baixo']);
const clips = [
  clip('guia', 'track-guia', 0, 60),
  clip('click', 'track-click', 0, 60),
  clip('maestro', 'track-maestro', 10, 2),
  clip('fala1', IA, 4, 2),
  clip('fala2', IA, 30, 2),
  clip('bat1', 'bateria', 0, 20),
  clip('bat2', 'bateria', 20, 20),
  clip('baixo', 'baixo', 5, 10),
];

test('a régua das falas do Maestro IA é uma linha logo abaixo da faixa Maestro', () => {
  assert.deepEqual(rows, ['track-guia', 'track-click', 'track-maestro', NARRATION_ROW, 'bateria', 'baixo']);
  assert.equal(rowOf({ trackId: IA }, IA), NARRATION_ROW);
  assert.equal(rowOf({ trackId: 'bateria' }, IA), 'bateria');
  assert.deepEqual(rowsBetween(rows, 'bateria', 'track-maestro'), ['track-maestro', NARRATION_ROW, 'bateria']);
});

test('retângulo: pega os áudios das linhas cobertas no trecho de tempo dele (falas inclusive)', () => {
  // da faixa Maestro até a bateria, de 3 s a 12 s
  const picked = clipsInBox(clips, ['track-maestro', NARRATION_ROW, 'bateria'], 3, 12, len, IA);
  assert.deepEqual(picked.sort(), ['bat1', 'fala1', 'maestro']);
  // só a régua das falas, de 25 a 40 s
  assert.deepEqual(clipsInBox(clips, [NARRATION_ROW], 40, 25, len, IA), ['fala2'], 'arrastar para trás também vale');
});

test('retângulo em cima de pasta recolhida pega as trilhas de dentro', () => {
  const extraRows = new Map([['pasta-bateria', ['bateria']]]);
  const picked = clipsInBox(clips, ['pasta-bateria'], 0, 25, len, IA, { extraRows });
  assert.deepEqual(picked.sort(), ['bat1', 'bat2']);
});

test('retângulo com Cmd ou Shift soma com a seleção de antes; sem, fica só o novo', () => {
  assert.deepEqual(marqueeSelection(['a', 'b'], ['b', 'c'], true), ['a', 'b', 'c']);
  assert.deepEqual(marqueeSelection(['a', 'b'], ['c'], false), ['c']);
});

test('Shift+clique: da Guia até o baixo, tudo no trecho entre os dois', () => {
  const sel = rangeSelection(clips, rows, clips[0], clips[7], len, IA);
  // a Guia vai de 0 a 60: o trecho é 0 a 60 e todas as linhas entre a Guia e o baixo
  assert.deepEqual(sel.sort(), ['baixo', 'bat1', 'bat2', 'click', 'fala1', 'fala2', 'guia', 'maestro']);
});

test('Shift+clique entre uma fala e a bateria: só o que está entre as duas, no tempo entre elas', () => {
  const sel = rangeSelection(clips, rows, clips[3], clips[5], len, IA);
  // linhas: falas e bateria; tempo: 0 a 20
  assert.deepEqual(sel.sort(), ['bat1', 'fala1']);
});

test('Delete separa as falas (saem pela fala, com a marcação) dos outros áudios', () => {
  assert.deepEqual(splitNarrationClips(['bat1', 'fala1', 'guia'], new Set(['fala1', 'fala2'])), { clips: ['bat1', 'guia'], narrations: ['fala1'] });
});

test('a timeline liga tudo: retângulo, Shift, clique nas falas e o apagar', () => {
  const panel = read('components', 'TimelinePanel.tsx');
  assert.match(panel, /startMarquee\(e, !plain, onClick\);/, 'arrastar na grade vazia');
  assert.match(panel, /if \(active\) lastSelectedClipIdRef\.current = null;\s*else onClick\?\.\(\);/, 'o cursor só anda num clique sem arrastar');
  assert.match(panel, /content\.querySelectorAll<HTMLElement>\('\[data-lane-track-id\], \[data-narration-lane\]'\)/, 'as linhas e a régua das falas');
  assert.match(panel, /\{marquee && \(/, 'desenha o retângulo');
  assert.match(panel, /const range = rangeSelection\(songClips, rows, prevClip, clip, clipPlayLength, MAESTRO_IA_TRACK_ID, collapsedRows\);/);
  assert.match(panel, /onSelectClip=\{handleNarrationSelect\}/);
  assert.match(panel, /removeNarration\(song\.id, narrationOf\.get\(clipId\)!\)/, 'fala selecionada sai inteira');
  assert.match(panel, /targets\.filter\(\(c\) => c\.trackId !== MAESTRO_IA_TRACK_ID\)\.map\(\(c\) => lanes\.indexOf\(c\.trackId\)\)/, 'com fala junto, os clipes ainda trocam de trilha');
  const lane = read('components', 'NarrationLane.tsx');
  assert.match(lane, /onSelectClip\(n\.clipId, \{ additive, shift: e\.shiftKey \}\);/, 'clicar na fala entra na seleção dos clipes');
  assert.match(lane, /if \(additive \|\| e\.shiftKey\) return;/, 'Cmd e Shift só selecionam');
});
