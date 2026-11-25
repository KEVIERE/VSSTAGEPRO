// Stage Download como página do site (/stagedownload): qualidades só até o máximo do link,
// a maior já marcada, e o motor no servidor sempre conferindo a assinatura.
//
// Rodar com: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { downloadError, fileUrl, firstLink, orderedQualities, qualityLabel, topQuality } from '../src/lib/stageDownload.ts';
import { BONUSES } from '../src/lib/bonus.ts';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('qualidades do maior para o menor, com a maior marcada', () => {
  const audio = { mp3: { label: 'MP3', qualities: { 64: '64 kbps', 128: '128 kbps (máximo do link)' } }, wav: { label: 'WAV', qualities: { '16-44': 'CD', '24-48': '24/48' } } };
  assert.deepEqual(orderedQualities(audio, 'mp3').map(([k]) => k), ['128', '64']);
  assert.equal(topQuality(audio, 'mp3'), '128');
  assert.equal(topQuality(audio, 'wav'), '16-44');
  assert.deepEqual(orderedQualities({ v: { label: '', qualities: { 360: '360p', 1080: '1080p', best: 'Melhor' } } }, 'v').map(([k]) => k), ['best', '1080', '360']);
});

test('link colado duas vezes vira um link só', () => {
  assert.equal(firstLink('https://www.youtube.com/watch?v=xoli_OBDUcohttps://www.youtube.com/watch?v=abc'), 'https://www.youtube.com/watch?v=xoli_OBDUco');
  assert.equal(firstLink('  olha esse: https://youtu.be/abc?si=1 valeu'), 'https://youtu.be/abc?si=1');
  assert.equal(firstLink('https://www.deezer.com/track/3135556'), 'https://www.deezer.com/track/3135556');
});

test('textos da página', () => {
  assert.equal(qualityLabel({ label: '', mode: 'video', format: 'mp3', quality: '720' }), 'MP4 720p');
  assert.equal(fileUrl('abc', -1), '/stagedownload/api/file/abc/-1');
  assert.match(downloadError('not_subscriber'), /assinantes/);
  assert.equal(downloadError('Texto pronto do servidor.'), 'Texto pronto do servidor.');
});

test('o bônus abre a página, não um arquivo', () => {
  const b = BONUSES.find((x) => x.id === 'stage-download');
  assert.equal(b.kind, 'page');
  assert.equal(b.page, 'stagedownload');
  assert.match(read('src/App.tsx'), /seg === 'stagedownload'/);
});

test('o motor confere a assinatura em todo pedido e limita o servidor', () => {
  const py = read('stage-download/server.py');
  for (const rota of ['/info', '/download', '/jobs', '/jobs/clear']) {
    const at = py.indexOf(`"${rota}")`);
    assert.ok(at > 0, rota);
    assert.match(py.slice(at, at + 200), /require_subscriber\(\)/, `${rota} pede assinatura`);
  }
  assert.match(py, /rpc\/bonus_access/);
  assert.match(py, /threading\.Semaphore\(1\)/, 'um download por vez');
  assert.match(py, /KEEP_SECONDS = 60 \* 60/, 'arquivo some em 1 hora');
  assert.match(py, /k != "path"/, 'caminho do servidor não vai para a página');
});
