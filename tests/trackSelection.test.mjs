// Seleção de várias faixas, como numa DAW: ⌘ soma ou tira; Shift vai da última clicada até a de
// agora, na ordem da tela. Vale na timeline e no mixer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { nextTrackSelection, trackPickMode } from '../src/lib/trackSelection.ts';

const order = ['guia', 'click', 'maestro', 'bateria', 'baixo', 'guitarras'];

test('clique simples escolhe só a faixa clicada', () => {
  assert.deepEqual(nextTrackSelection(['guia', 'click'], 'guia', 'baixo', 'single', order), { ids: ['baixo'], anchor: 'baixo' });
});

test('⌘ + clique soma a faixa; de novo, tira', () => {
  const a = nextTrackSelection(['guia'], 'guia', 'maestro', 'toggle', order);
  assert.deepEqual(a, { ids: ['guia', 'maestro'], anchor: 'maestro' });
  const b = nextTrackSelection(a.ids, a.anchor, 'maestro', 'toggle', order);
  assert.deepEqual(b.ids, ['guia']);
  assert.equal(b.anchor, 'guia');
});

test('Shift + clique seleciona da âncora até a clicada, para cima ou para baixo', () => {
  assert.deepEqual(nextTrackSelection(['guia'], 'guia', 'bateria', 'range', order).ids, ['guia', 'click', 'maestro', 'bateria']);
  assert.deepEqual(nextTrackSelection(['guitarras'], 'guitarras', 'maestro', 'range', order).ids, ['maestro', 'bateria', 'baixo', 'guitarras']);
  // a âncora não muda: outro Shift + clique refaz o trecho a partir dela
  const r = nextTrackSelection(['guia'], 'guia', 'bateria', 'range', order);
  assert.equal(r.anchor, 'guia');
  assert.deepEqual(nextTrackSelection(r.ids, r.anchor, 'click', 'range', order).ids, ['guia', 'click']);
  // sem âncora (nada clicado antes): vira um clique simples
  assert.deepEqual(nextTrackSelection([], null, 'baixo', 'range', order).ids, ['baixo']);
});

test('as teclas: Shift é trecho, ⌘ (ou Ctrl) soma, sem tecla é simples', () => {
  assert.equal(trackPickMode({ shiftKey: true }), 'range');
  assert.equal(trackPickMode({ metaKey: true }), 'toggle');
  assert.equal(trackPickMode({ ctrlKey: true }), 'toggle');
  assert.equal(trackPickMode({}), 'single');
});

test('a timeline e o mixer usam a seleção de várias faixas, na ordem da tela', () => {
  const tl = fs.readFileSync(new URL('../src/components/TimelinePanel.tsx', import.meta.url), 'utf8');
  assert.match(tl, /pickTrack\(track\.id, trackPickMode\(e\), trackOrderOnScreen\('data-track-row'\)\)/);
  assert.match(tl, /data-track-row=\{track\.id\}/);
  const mx = fs.readFileSync(new URL('../src/components/MixerPanel.tsx', import.meta.url), 'utf8');
  assert.match(mx, /pickTrack\(trackId, trackPickMode\(e\), trackOrderOnScreen\('data-mixer-track'\)\)/);
  assert.equal((mx.match(/data-mixer-track=\{track\.id\}/g) ?? []).length, 4, 'em todas as skins');
  // botão direito no canal abre o menu da faixa (cor, nome...)
  assert.match(mx, /<TrackContextMenu track=\{trackMenu\.track\}/);
  const store = fs.readFileSync(new URL('../src/store.ts', import.meta.url), 'utf8');
  assert.match(store, /selectTrack: \(id\) => set\(\{ selectedTrackId: id, selectedTrackIds: id \? \[id\] : \[\] \}\),/);
});
