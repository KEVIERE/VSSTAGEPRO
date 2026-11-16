// Projeto reaberto: com zoom aproximado a onda vem das amostras lidas do disco, não do resumo
// de 10 ms, e o ataque fica no lugar certo (antes aparecia um "resto" à esquerda da grade).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const { waveColumns, sampleColumns, tileFrames } = await import('../src/lib/waveColumns.ts');

const SR = 1000;          // 1000 quadros/s para conta fácil
const DUR = 10;           // 10 s
const FRAMES = SR * DUR;
const HIT = 5000;         // batida em 5,000 s
const audio = new Int16Array(FRAMES);
for (let i = HIT; i < HIT + 20; i++) audio[i] = 30000;
// resumo de 100 pontos por segundo, como na importação (máximo de cada trecho)
const peaks = [];
for (let i = 0; i < DUR * 100; i++) {
  let m = 0;
  for (let j = i * 10; j < (i + 1) * 10; j++) m = Math.max(m, Math.abs(audio[j]) / 32768);
  peaks.push(m);
}
const TOTAL = FRAMES;     // 1 px por quadro (zoom bem aproximado)
const hitPx = HIT;        // pixel da batida

const firstLoud = (cols, offset) => {
  for (let x = 0; x < cols.length; x++) if (cols[x] > 0.01) return offset + x;
  return -1;
};

test('o resumo com zoom aproximado espalha o ataque para antes da batida (o defeito)', () => {
  const offset = hitPx - 50;
  const cols = waveColumns(peaks, null, DUR, TOTAL, offset, 100);
  assert.ok(firstLoud(cols, offset) < hitPx - 3, 'o resumo começa a subir antes da batida');
});

test('das amostras (memória ou disco) o ataque cai exatamente no pixel da batida', () => {
  const offset = hitPx - 50;
  const fromMemory = waveColumns(peaks, { sampleRate: SR, length: FRAMES, channels: [audio] }, DUR, TOTAL, offset, 100);
  assert.equal(firstLoud(fromMemory, offset), hitPx);
  // o trecho lido do disco dá o mesmo desenho que o áudio inteiro na memória
  const { start, frames, perPx } = tileFrames(DUR, SR, TOTAL, offset, 100);
  const slice = audio.subarray(start, start + frames);
  const fromDisk = sampleColumns([slice], start, FRAMES, perPx, offset, 100);
  assert.deepEqual(Array.from(fromDisk), Array.from(fromMemory));
});

test('trecho do bloco: começa no primeiro pixel e cobre a largura, sem passar do arquivo', () => {
  assert.deepEqual(tileFrames(10, 1000, 10000, 0, 2048), { start: 0, frames: 2049, perPx: 1 });
  assert.deepEqual(tileFrames(10, 1000, 5000, 4000, 2048), { start: 8000, frames: 2000, perPx: 2 });
});

test('a tela usa a leitura do disco só com zoom aproximado e sem o áudio na memória', () => {
  const src = fs.readFileSync(new URL('../src/components/ClipWaveform.tsx', import.meta.url), 'utf8');
  assert.match(src, /const precise = !audio && !songLoading && wantsPrecise\(clip\.duration, clip\.sampleRate, base\.w, peakCount\)\s*&& \(fine === null \|\| \(!!fine && framesPerPx < FINE_FRAMES_PER_PEAK \/ 2\)\);/);
  assert.match(src, /return requestPreciseColumns\(req, setExact\);/);
  const lib = fs.readFileSync(new URL('../src/lib/wavePrecise.ts', import.meta.url), 'utf8');
  // com música tocando, uma leitura por vez; e nunca nos workers da música no ar
  assert.match(lib, /transport\.isPlaying \? 1 : 3/);
  assert.match(lib, /readWavRangeBackground\(src/);
  assert.doesNotMatch(lib, /readWavRange\(/);
  // MP3/M4A: a cópia pronta do app vem primeiro
  assert.match(lib, /openEntryRange\(dir, fullCopyName\(r\.songId, r\.clipId, src, rate\)\)/);
  const reader = fs.readFileSync(new URL('../src/lib/wavReader.ts', import.meta.url), 'utf8');
  assert.match(reader, /if \(typeof startFrame === 'number' && !background\) worker = rangeWorker\(\);/);
});

test('lê do disco assim que o resumo fica mais grosso que os pixels (até 512 quadros por pixel)', async () => {
  const src = fs.readFileSync(new URL('../src/lib/wavePrecise.ts', import.meta.url), 'utf8');
  assert.match(src, /export const PRECISE_MAX_FRAMES_PER_PX = 512;/);
  assert.match(src, /return fullWidth >= peakCount && \(duration \/ fullWidth\) \* sampleRate <= PRECISE_MAX_FRAMES_PER_PX;/);
});

test('caso do show: música de 8:21 (resumo no teto de 24.000 pontos) a 271 px/s usa a leitura exata', async () => {
  const src = fs.readFileSync(new URL('../src/lib/wavePrecise.ts', import.meta.url), 'utf8');
  const max = Number(src.match(/PRECISE_MAX_FRAMES_PER_PX = (\d+)/)[1]);
  const duration = 501, rate = 48000, peaks = 24000, fullWidth = Math.round(duration * 271);
  assert.ok(fullWidth >= peaks, 'resumo mais grosso que os pixels');
  assert.ok((duration / fullWidth) * rate <= max, 'dentro do limite de leitura');
});
