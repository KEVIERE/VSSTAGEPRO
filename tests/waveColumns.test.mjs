// Forma de onda com zoom: cada click tem que aparecer no pixel certo e sempre com o mesmo desenho.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waveColumns } from '../src/lib/waveColumns.ts';

const SR = 44100;
const BPM = 140;
const SECONDS = 480; // medley longo: o resumo tem só ~50 pontos por segundo
const PX_PER_SECOND = 200; // zoom de ~1000% na timeline

const beats = [];
const data = new Int16Array(SR * SECONDS);
for (let t = 0; t < SECONDS - 1; t += 60 / BPM) {
  beats.push(t);
  const s0 = Math.round(t * SR);
  for (let i = 0; i < 0.03 * SR; i++) data[s0 + i] = Math.round(26000 * Math.sin(2 * Math.PI * 1500 * i / SR) * Math.exp(-i / (0.006 * SR)));
}
const audio = { sampleRate: SR, length: data.length, channels: [data] };

// mesmo resumo que a importação grava (audioEngine.generateWaveformPeaks)
const numPeaks = Math.min(24000, Math.max(8000, Math.round(SECONDS * 100)));
const peaks = new Array(numPeaks);
for (let i = 0; i < numPeaks; i++) {
  const a = Math.floor((i / numPeaks) * data.length);
  const b = Math.min(Math.ceil(((i + 1) / numPeaks) * data.length), data.length);
  let m = 0;
  for (let j = a; j < b; j++) m = Math.max(m, Math.abs(data[j]) / 32768);
  peaks[i] = m;
}

const total = SECONDS * PX_PER_SECOND;

// primeiro pixel do ataque de cada click, olhando um trecho em volta dele
function attacks(useAudio) {
  return beats.slice(0, -1).map((t) => {
    const from = Math.floor(t * PX_PER_SECOND) - 20;
    const cols = waveColumns(peaks, useAudio ? audio : null, SECONDS, total, from, 60);
    const x = cols.findIndex((v) => v > 0.3);
    return { t, px: from + x, cols };
  });
}

test('com o áudio na memória: cada click no pixel exato e sempre com o mesmo desenho', () => {
  // desenho: altura do pico e largura (pixels acima de 5%)
  const look = (cols) => ({ peak: Math.max(...cols), width: Array.from(cols).filter((v) => v > 0.05).length });
  const list = attacks(true);
  const ref = look(list[1].cols);
  for (const a of list) {
    // pixel onde está a primeira amostra do click
    assert.equal(a.px, Math.floor(Math.round(a.t * SR) / (SR / PX_PER_SECOND)), `click em ${a.t.toFixed(3)} s desenhado fora do lugar`);
    const l = look(a.cols);
    assert.ok(Math.abs(l.peak - ref.peak) < 0.01 && Math.abs(l.width - ref.width) <= 1, `desenho do click em ${a.t.toFixed(3)} s mudou`);
  }
});

test('sem o áudio (só o resumo): o erro não cresce até o fim da música', () => {
  const binPx = total / numPeaks; // ~4 px por ponto do resumo neste zoom
  const list = attacks(false);
  const errs = list.map((a) => a.px - a.t * PX_PER_SECOND);
  for (const [i, e] of errs.entries()) assert.ok(Math.abs(e) <= binPx + 1, `click ${i} desenhado ${e.toFixed(1)} px fora`);
  const firstMin = errs.slice(0, 200).reduce((a, b) => a + b, 0) / 200;
  const lastMin = errs.slice(-200).reduce((a, b) => a + b, 0) / 200;
  assert.ok(Math.abs(lastMin - firstMin) < 1, `erro médio passou de ${firstMin.toFixed(2)} para ${lastMin.toFixed(2)} px`);
});

test('zoom afastado continua usando o resumo (rápido)', () => {
  const cols = waveColumns(peaks, audio, SECONDS, 1200, 0, 1200);
  assert.ok(cols[0] > 0.5);
  assert.equal(cols.length, 1201);
});
