// Arrastar um áudio do Finder (ou de qualquer pasta) para uma trilha da timeline.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');
const drop = read('lib/dropAudio.ts');
const panel = read('components/TimelinePanel.tsx');

test('reconhece os formatos de áudio pela extensão', () => {
  const rx = new RegExp(drop.match(/const AUDIO_EXT = \/(.+)\/i;/)[1], 'i');
  for (const n of ['voz.wav', 'Guia.MP3', 'click.aiff', 'pad.aif', 'baixo.flac', 'teclado.m4a', 'x.ogg', 'y.caf']) assert.ok(rx.test(n), n);
  for (const n of ['projeto.vss', 'capa.png', 'letra.txt', 'wav']) assert.ok(!rx.test(n), n);
});

test('só aceita arraste com arquivos de fora, sem atrapalhar o arraste de clipes', () => {
  assert.match(drop, /types \?\? \[\]\)\.includes\('Files'\)/);
  assert.match(panel, /onDragOver=\{canDropFiles/);
  assert.match(panel, /if \(!dragHasFiles\(e\.dataTransfer\)\) return;/);
});

test('não aceita em pasta, na trilha de timecode nem com a timeline travada', () => {
  assert.match(panel, /const canDropFiles = !isFolder && !isTc && !timelineLocked;/);
});

test('o áudio cai no ponto solto e vira clipe manual na trilha', () => {
  assert.match(panel, /\(e\.clientX - e\.currentTarget\.getBoundingClientRect\(\)\.left\) \/ zoomH/);
  assert.match(drop, /trackId,\n\s+name: baseName\(file\.name\)/);
  assert.match(drop, /routingMethod: 'manual'/);
  assert.match(drop, /registerClipSource\(clipId, songId, file\)/);
  assert.match(drop, /useStore\.getState\(\)\.addClip\(clip\)/);
});

test('vários arquivos ficam um depois do outro, e o que não abre é avisado', () => {
  assert.match(drop, /at \+= buffer\.duration/);
  assert.match(drop, /setPlaybackError\(/);
});
