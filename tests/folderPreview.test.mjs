// Pasta recolhida mostra a onda de todos os áudios de dentro; áudio indo para outra trilha só
// sobe ou desce, sem andar no tempo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeFolderPeaks } from '../src/lib/folderPreview.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const panel = fs.readFileSync(path.join(here, '..', 'src', 'components', 'TimelinePanel.tsx'), 'utf8');

const clip = (startTime, duration, peaks, extra = {}) => ({ startTime, duration, waveformPeaks: peaks, ...extra });

test('a prévia vai do começo do primeiro áudio ao fim do último', () => {
  const p = mergeFolderPeaks([clip(10, 4, [0.2, 0.2, 0.2, 0.2]), clip(12, 4, [0.5, 0.5, 0.5, 0.5])]);
  assert.equal(p.start, 10);
  assert.equal(p.duration, 6);
  assert.equal(p.peaks.length, 6);
});

test('onde dois áudios tocam juntos vale o pico mais alto', () => {
  const p = mergeFolderPeaks([clip(0, 4, [0.2, 0.2, 0.2, 0.2]), clip(2, 4, [0.6, 0.6, 0.6, 0.6])]);
  assert.deepEqual(p.peaks, [0.2, 0.2, 0.6, 0.6, 0.6, 0.6]);
});

test('respeita o corte do começo e o ganho; áudio mudo fica de fora', () => {
  // arquivo de 4 s com o 1º segundo cortado: começa a tocar em 5 s com o 2º pico
  const p = mergeFolderPeaks([clip(5, 4, [0.9, 0.1, 0.2, 0.3], { trimStart: 1, gain: 2 })]);
  assert.equal(p.start, 5);
  assert.equal(p.duration, 3);
  assert.deepEqual(p.peaks.map((v) => Math.round(v * 10) / 10), [0.2, 0.4, 0.6]);
  assert.equal(mergeFolderPeaks([clip(0, 4, [1, 1], { mute: true })]), null);
  assert.equal(mergeFolderPeaks([]), null);
});

test('pasta recolhida desenha a prévia na trilha dela', () => {
  assert.match(panel, /const folderPreviews = useMemo/, 'calcula a prévia das pastas recolhidas');
  assert.match(panel, /for \(const folderId of collapsedFolders\)/, 'só das pastas recolhidas');
  assert.match(panel, /<FolderPreviewBlock/, 'desenha o bloco da prévia');
});

test('áudio indo para outra trilha não anda no tempo', () => {
  assert.match(panel, /if \(laneMovesNow\.length > 0\) delta = 0;/);
});
