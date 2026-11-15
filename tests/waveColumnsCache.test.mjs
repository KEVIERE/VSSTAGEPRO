// Zoom da timeline sem travar: as colunas da onda já calculadas são reaproveitadas (mudar só a
// altura, o ganho ou a cor, ou voltar a um zoom recente, não lê as amostras de novo).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  waveColumns,
  waveColumnsCached,
  waveColumnsCacheSize,
  clearWaveColumnsCache,
  WAVE_COLUMNS_CACHE_MAX,
} from '../src/lib/waveColumns.ts';

const SR = 44100;
const data = new Int16Array(SR * 4);
for (let i = 0; i < data.length; i++) data[i] = Math.round(20000 * Math.sin(i / 37) * ((i % 9000) / 9000));
const audio = { sampleRate: SR, length: data.length, channels: [data] };
const peaks = Array.from({ length: 400 }, (_, i) => (i % 17) / 17);

test('mesmo resultado que waveColumns, com áudio e com resumo', () => {
  clearWaveColumnsCache();
  for (const [p, a, total] of [[peaks, audio, 2000], [peaks, null, 200], [peaks, null, 3000]]) {
    const plain = waveColumns(p, a, 4, total, 0, 512);
    const cached = waveColumnsCached(p, a, 4, total, 0, 512);
    assert.deepEqual(Array.from(cached), Array.from(plain));
  }
});

test('segunda chamada igual devolve o mesmo array (não recalcula)', () => {
  clearWaveColumnsCache();
  const a = waveColumnsCached(peaks, audio, 4, 2000, 0, 512);
  const b = waveColumnsCached(peaks, audio, 4, 2000, 0, 512);
  assert.equal(a, b);
  assert.equal(waveColumnsCacheSize(), 1);
});

test('zoom, bloco, resumo ou áudio diferentes não reaproveitam', () => {
  clearWaveColumnsCache();
  const base = waveColumnsCached(peaks, audio, 4, 2000, 0, 512);
  assert.notEqual(waveColumnsCached(peaks, audio, 4, 2400, 0, 512), base);
  assert.notEqual(waveColumnsCached(peaks, audio, 4, 2000, 512, 512), base);
  assert.notEqual(waveColumnsCached(peaks.slice(), audio, 4, 2000, 0, 512), base);
  assert.notEqual(waveColumnsCached(peaks, { ...audio }, 4, 2000, 0, 512), base);
  // áudio solto da memória (null) cai no resumo: outra chave, outro desenho
  assert.notEqual(waveColumnsCached(peaks, null, 4, 2000, 0, 512), base);
});

test('o cache tem limite e solta o mais antigo', () => {
  clearWaveColumnsCache();
  const first = waveColumnsCached(peaks, null, 4, 200, 0, 64);
  for (let i = 1; i <= WAVE_COLUMNS_CACHE_MAX + 10; i++) waveColumnsCached(peaks, null, 4, 200 + i, 0, 64);
  assert.equal(waveColumnsCacheSize(), WAVE_COLUMNS_CACHE_MAX);
  assert.notEqual(waveColumnsCached(peaks, null, 4, 200, 0, 64), first);
});

test('o mais usado recentemente fica no cache', () => {
  clearWaveColumnsCache();
  const keep = waveColumnsCached(peaks, null, 4, 200, 0, 64);
  for (let i = 1; i <= WAVE_COLUMNS_CACHE_MAX + 10; i++) {
    waveColumnsCached(peaks, null, 4, 200, 0, 64); // usado a cada passo
    waveColumnsCached(peaks, null, 4, 200 + i, 0, 64);
  }
  assert.equal(waveColumnsCached(peaks, null, 4, 200, 0, 64), keep);
});
