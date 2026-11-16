// Resumo detalhado guardado no disco do app: a onda já abre no lugar certo com zoom aproximado,
// sem aparecer de um jeito e "pular" para a grade depois.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const { encodeFineChunk, fineColumns, encodeFineValue, waveColumns, FINE_FRAMES_PER_PEAK } = await import('../src/lib/waveColumns.ts');

const SR = 48000;
const DUR = 10;
const FRAMES = SR * DUR;
const HIT = 5 * SR + 1234;              // batida fora do começo de um bloco de 64
const audio = new Int16Array(FRAMES);
for (let i = HIT; i < HIT + 400; i++) audio[i] = 30000;

function buildFine(chunk) {
  const data = new Uint8Array(Math.ceil(FRAMES / FINE_FRAMES_PER_PEAK));
  for (let s = 0; s < FRAMES; s += chunk) encodeFineChunk([audio.subarray(s, Math.min(FRAMES, s + chunk))], s, FINE_FRAMES_PER_PEAK, data);
  return { sampleRate: SR, framesPer: FINE_FRAMES_PER_PEAK, frames: FRAMES, data };
}

test('montar em pedaços dá o mesmo resumo que de uma vez', () => {
  assert.deepEqual(buildFine(1 << 20).data, buildFine(FRAMES).data);
  assert.deepEqual(buildFine(64 * 1000).data, buildFine(FRAMES).data);
});

test('com zoom aproximado (271 px/s) o ataque cai no pixel da batida, como das amostras', () => {
  const fine = buildFine(1 << 20);
  const total = Math.round(DUR * 271);
  const perPx = (DUR / total) * SR;
  const hitPx = Math.floor(HIT / perPx);
  const offset = hitPx - 30;
  const firstLoud = (cols) => { for (let x = 0; x < cols.length; x++) if (cols[x] > 0.05) return offset + x; return -1; };
  const fromFine = fineColumns(fine, DUR, total, offset, 60);
  const fromSamples = waveColumns(undefined, { sampleRate: SR, length: FRAMES, channels: [audio] }, DUR, total, offset, 60);
  assert.equal(firstLoud(fromFine), firstLoud(fromSamples));
  assert.equal(firstLoud(fromFine), hitPx);
});

test('o resumo detalhado entra no lugar do resumo do projeto só com zoom aproximado', () => {
  const fine = buildFine(1 << 20);
  const peaks = new Array(DUR * 100).fill(0.5);
  const near = waveColumns(peaks, null, DUR, DUR * 271, 0, 10, fine);
  assert.deepEqual(Array.from(near), Array.from(fineColumns(fine, DUR, DUR * 271, 0, 10)));
  const far = waveColumns(peaks, null, DUR, 500, 0, 10, fine);
  assert.ok(far[0] > 0.4, 'afastado continua no resumo do projeto');
});

test('byte do resumo: raiz quadrada (detalhe dos trechos baixos), cheio = 255', () => {
  assert.equal(encodeFineValue(0), 0);
  assert.equal(encodeFineValue(32768), 255);
  assert.equal(encodeFineValue(32768 / 4), 128);
});

test('tela: espera o resumo do disco antes de desenhar, e a montagem só roda com a música parada', () => {
  const comp = fs.readFileSync(new URL('../src/components/ClipWaveform.tsx', import.meta.url), 'utf8');
  assert.match(comp, /if \(holding\) return;/);
  // a música aberta pede o resumo; o projeto inteiro é montado em segundo plano ao abrir
  assert.match(fs.readFileSync(new URL('../src/components/TimelinePanel.tsx', import.meta.url), 'utf8'), /prefetchFinePeaks\(\[\.\.\.st\.clips\]\.sort/);
  assert.match(comp, /const FINE_WAIT_MS = 600;/);
  assert.match(comp, /const holding = hold && !waitOver && !\(exact && exact\.length === width \+ 1\);/);
  assert.match(comp, /if \(wantFine\) requestFinePeaks\(clip, !songLoading\);/);
  assert.match(comp, /const wantFine = !audio && peakCount > 0 && clip\.sampleRate > 0;/);
  const lib = fs.readFileSync(new URL('../src/lib/finePeaks.ts', import.meta.url), 'utf8');
  assert.match(lib, /await whenStopped\(\);/);
  // Play ou música abrindo no meio da fatia do WAV: lê a fatia de novo depois
  assert.match(lib, /if \(busy\(\)\) continue;/);
  assert.match(lib, /s\.transport\.isPlaying \|\| s\.loadingSongIds\.length > 0/);
  // faixa da tela passa na frente da fila do projeto
  assert.match(lib, /if \(at > 0\) queue\.unshift\(\.\.\.queue\.splice\(at, 1\)\);/);
  // Play no meio da leitura: não processa o pedaço, espera parar
  assert.match(lib, /if \(isPlaying\(\)\) \{ start -= BUILD_CHUNK_FRAMES; continue; \}/);
  assert.match(lib, /const BUILD_CHUNK_FRAMES = 1 << 17;/);
  // pedido de montagem durante a conferência do disco não se perde
  assert.match(lib, /if \(!loaded\.has\(name\) && wantBuild\.has\(name\)\) enqueueBuild\(clip, name\);/);
  // WAV: o resumo inteiro sai pronto do worker geral (nunca dos workers da música no ar)
  assert.match(lib, /readWavPeaks\(src, FINE_FRAMES_PER_PEAK, start, WAV_SLICE_FRAMES\)/);
  assert.doesNotMatch(lib, /readWavRange\(/);
  const worker = fs.readFileSync(new URL('../src/workers/wavReader.worker.ts', import.meta.url), 'utf8');
  assert.match(worker, /encodeFineChunk\(convert\(bytes, info, Math\.floor\(bytes\.byteLength \/ blockBytes\)\), 0, peaksPer, peaks\);/);
  // guardado no mesmo lugar das cópias prontas, com uso marcado (a limpeza de 45 dias não apaga o que está em uso)
  assert.match(lib, /markUsed\(name\);/);
});

test('a conta do resumo no worker é igual à da tela', async () => {
  const worker = fs.readFileSync(new URL('../src/workers/wavReader.worker.ts', import.meta.url), 'utf8');
  const lib = fs.readFileSync(new URL('../src/lib/waveColumns.ts', import.meta.url), 'utf8');
  const body = (src) => src.match(/for \(let i = 0; i \* framesPer < len; i\+\+\) \{[\s\S]*?\n  \}\n/)[0].replace(/out\[bin\] = .*;/, '');
  assert.equal(body(worker), body(lib));
  assert.match(worker, /out\[bin\] = Math\.min\(255, Math\.round\(Math\.sqrt\(Math\.min\(1, m \/ 32768\)\) \* 255\)\);/);
  assert.match(lib, /return Math\.min\(255, Math\.round\(Math\.sqrt\(Math\.min\(1, abs \/ 32768\)\) \* 255\)\);/);
});

test('zoom: a camada nova é desenhada escondida e só entra quando todos os blocos visíveis estão prontos', () => {
  const comp = fs.readFileSync(new URL('../src/components/ClipWaveform.tsx', import.meta.url), 'utf8');
  // a camada nova vem antes: desenha primeiro (escondida, não muda o que se vê)
  assert.match(comp, /\{pending && layer\(target, true\)\}\n\s*\{layer\(shown, false\)\}/);
  // a mesma função de pronto nas duas camadas: a troca não redesenha os blocos
  assert.match(comp, /onDrawn=\{onDrawn\}/);
  assert.match(comp, /visibility: hidden \? 'hidden' : undefined/);
  assert.match(comp, /const targetReady = pending && targetTiles\.every\(\(i\) => drawnRef\.current\.has\(tileKeyOf\(target, i\)\)\);/);
  // esperando o resumo detalhado, o bloco não apaga o que já está desenhado
  assert.ok(comp.indexOf('if (holding) return;') < comp.indexOf('ctx.clearRect(0, 0, width, height);'));
});
