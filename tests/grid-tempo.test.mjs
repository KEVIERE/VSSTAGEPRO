// Medley com mudança de BPM na régua: o encaixe do cursor e dos áudios segue o andamento de cada
// trecho, como a grade desenhada.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { songGrid, snapTime, barBeatLabel } = await import('../src/lib/grid.ts');

// 120 BPM (0,5 s por tempo) até 8 s, depois 90 BPM (0,6667 s por tempo)
const grid = songGrid({ bpm: 120, beatsPerBar: 4, tempoSegments: [
  { startTime: 0, endTime: 8, bpm: 120, downbeat: 0 },
  { startTime: 8, endTime: 40, bpm: 90, downbeat: 8 },
] });

test('antes da mudança encaixa no BPM antigo', () => {
  assert.ok(Math.abs(snapTime(1.26, grid, 'beat') - 1.5) < 1e-9);
});

test('depois da mudança encaixa no BPM novo (não no antigo)', () => {
  const beat = 60 / 90;
  assert.ok(Math.abs(snapTime(8 + beat * 3 + 0.1, grid, 'beat') - (8 + beat * 3)) < 1e-9);
  assert.ok(Math.abs(snapTime(8 + beat * 4 * 2 + 0.2, grid, 'bar') - (8 + beat * 4 * 2)) < 1e-9);
});

test('perto do fim do trecho antigo, o ponto é o começo do trecho novo', () => {
  assert.equal(snapTime(7.9, grid, 'bar'), 8);
});

test('contagem de compassos segue a régua', () => {
  assert.equal(barBeatLabel(8, grid), '5');
  assert.equal(barBeatLabel(8 + (60 / 90) * 4, grid), '6');
});
