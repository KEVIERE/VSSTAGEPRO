// Lote 4 (onda rápida): índice de máximos das amostras na memória e resumo detalhado por faixa.
// A coluna com o índice tem de sair IDÊNTICA à de sampleColumns, coluna a coluna (o ataque do
// click continua no pixel certo da grade); a montagem anda aos pedaços, dentro do prazo do quadro.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { register } from 'node:module';

const {
  WAVE_INDEX_FRAMES, WAVE_INDEX_MIN_FRAMES_PER_PX, WAVE_INDEX_STEP_BINS,
  buildWaveIndexNow, buildWaveIndexStep, clearWaveIndexQueue, indexColumns, readyWaveIndex, wantWaveIndex, waveIndexPending,
} = await import('../src/lib/waveIndex.ts');
const { sampleColumns, waveColumns, waveColumnsCached, clearWaveColumnsCache } = await import('../src/lib/waveColumns.ts');

const read = (...p) => fs.readFileSync(new URL(`../src/${p.join('/')}`, import.meta.url), 'utf8');

// sinal com picos em lugares quebrados (fora dos múltiplos de 64), silêncio, e os extremos -32768 e 32767
function signal(frames, seed) {
  const ch = new Int16Array(frames);
  let x = seed >>> 0;
  for (let i = 0; i < frames; i++) {
    x = (Math.imul(x, 1103515245) + 12345) >>> 0;
    const r = x >>> 16;
    // trechos baixos, médios e um ataque forte de vez em quando
    ch[i] = r % 997 === 0 ? (r & 1 ? 32767 : -32768) : ((r % 2001) - 1000) * ((i >> 12) % 7 === 0 ? 0 : (i >> 15) % 5 + 1);
  }
  return ch;
}

function sameColumns(a, b, msg) {
  assert.equal(a.length, b.length, `${msg}: tamanho`);
  for (let x = 0; x < a.length; x++) {
    if (!Object.is(a[x], b[x])) assert.fail(`${msg}: coluna ${x} difere (${a[x]} != ${b[x]})`);
  }
}

const PER_PX = [128, 129.7, 191.25, 256, 300.001, 480, 511.9, 1000.5, 1200, 4096.3];

test('índice: coluna idêntica à de sampleColumns, coluna a coluna (estéreo, mono, pontas e fim do arquivo)', () => {
  const L = signal(48000 * 6 + 37, 1);
  const R = signal(48000 * 6 + 37, 2);
  for (const channels of [[L, R], [L]]) {
    const audio = { channels, length: L.length, sampleRate: 48000 };
    const index = buildWaveIndexNow(audio);
    assert.equal(index.framesPer, WAVE_INDEX_FRAMES);
    for (const perPx of PER_PX) {
      const total = Math.ceil(L.length / perPx);
      // começo, pixel negativo (bloco que começa antes do arquivo), meio, último bloco e além do fim
      for (const offset of [0, -5, 17, Math.floor(total / 2) - 3, total - 40, total + 3]) {
        for (const width of [0, 1, 63, 2048]) {
          sameColumns(indexColumns(channels, index, audio.length, perPx, offset, width),
            sampleColumns(channels, 0, audio.length, perPx, offset, width), `perPx ${perPx} offset ${offset} width ${width}`);
        }
      }
    }
  }
});

test('índice: canais de tamanhos diferentes e arquivo mais curto que os canais usam o mesmo limite', () => {
  const L = signal(100_000, 3);
  const R = signal(99_937, 4); // termina no meio de um pedaço de 64
  const index = buildWaveIndexNow({ channels: [L, R], length: L.length });
  assert.equal(index.frames, R.length);
  for (const totalFrames of [L.length, R.length, 77_777, 64 * 1000]) {
    for (const perPx of [130, 333.3, 640]) {
      const width = Math.ceil(totalFrames / perPx) + 4;
      sameColumns(indexColumns([L, R], index, totalFrames, perPx, 0, width), sampleColumns([L, R], 0, totalFrames, perPx, 0, width), `total ${totalFrames} perPx ${perPx}`);
    }
  }
});

test('índice: -32768 vira 32768 (16 bits sem sinal) e a coluna cheia dá 1, como das amostras', () => {
  const ch = new Int16Array(64 * 40);
  ch[64 * 10 + 5] = -32768;
  ch[64 * 20 + 63] = 32767;
  const index = buildWaveIndexNow({ channels: [ch], length: ch.length });
  assert.ok(index.data instanceof Uint16Array);
  assert.equal(index.data[10], 32768);
  assert.equal(index.data[20], 32767);
  const cols = indexColumns([ch], index, ch.length, 640, 0, 4);
  assert.equal(cols[1], 1);
  sameColumns(cols, sampleColumns([ch], 0, ch.length, 640, 0, 4), '-32768');
});

test('medley de 10 min: todas as colunas da música iguais em três zooms, e o ataque no mesmo pixel', () => {
  const SR = 44100;
  const frames = SR * 600;
  const L = new Int16Array(frames);
  const R = new Int16Array(frames);
  // click de 5 ms a cada 0,5 s, começando em posições quebradas
  const onsets = [];
  for (let k = 0; k < 1199; k++) {
    const at = Math.round(k * 0.5 * SR + 37 + (k * 13) % 61);
    onsets.push(at);
    for (let i = 0; i < 220; i++) { L[at + i] = 26000; R[at + i] = -26000; }
  }
  const audio = { channels: [L, R], length: frames, sampleRate: SR };
  const index = buildWaveIndexNow(audio);
  for (const pxPerSec of [40, 100, 271]) {
    const total = Math.round(600 * pxPerSec);
    const perPx = (600 / total) * SR;
    assert.ok(perPx >= WAVE_INDEX_MIN_FRAMES_PER_PX);
    const a = indexColumns([L, R], index, frames, perPx, 0, total);
    const b = sampleColumns([L, R], 0, frames, perPx, 0, total);
    sameColumns(a, b, `${pxPerSec} px/s`);
    for (const on of onsets) {
      // pixel que contém a primeira amostra do click (o pixel x cobre [floor(x·perPx), floor((x+1)·perPx)))
      let px = Math.floor(on / perPx);
      if (Math.floor((px + 1) * perPx) <= on) px++;
      // o pixel da primeira amostra do click acende e o de antes fica em silêncio
      assert.ok(a[px] > 0.5 && (px === 0 || a[px - 1] === 0), `ataque em ${on} fora do pixel ${px}`);
    }
  }
});

test('waveColumns usa o índice só quando ele está pronto, com o mesmo resultado', () => {
  clearWaveIndexQueue();
  const L = signal(48000 * 4, 5);
  const R = signal(48000 * 4, 6);
  const audio = { channels: [L, R], length: L.length, sampleRate: 48000 };
  const twin = { channels: [L, R], length: L.length, sampleRate: 48000 }; // outro objeto: nunca tem índice
  const peaks = new Array(400).fill(0.2);
  const total = 4 * 200; // 240 quadros por pixel
  assert.equal(readyWaveIndex(audio), null);
  const before = waveColumns(peaks, audio, 4, total, 0, total);
  const release = wantWaveIndex(audio);
  assert.ok(waveIndexPending());
  // meio montado: ainda não vale
  let clock = 0;
  buildWaveIndexStep(3, () => clock++);
  assert.equal(readyWaveIndex(audio), null);
  while (buildWaveIndexStep(Infinity)) { /* até o fim */ }
  assert.ok(readyWaveIndex(audio));
  assert.equal(waveIndexPending(), false);
  sameColumns(waveColumns(peaks, audio, 4, total, 0, total), before, 'com o índice');
  sameColumns(waveColumns(peaks, audio, 4, total, 0, total), waveColumns(peaks, twin, 4, total, 0, total), 'com e sem índice');
  clearWaveColumnsCache();
  sameColumns(waveColumnsCached(peaks, audio, 4, total, 0, total), before, 'cache');
  // zoom afastado (resumo do projeto) e zoom muito aproximado (menos de 128 quadros por pixel) não mudam
  sameColumns(waveColumns(peaks, audio, 4, 300, 0, 300), waveColumns(peaks, twin, 4, 300, 0, 300), 'afastado');
  sameColumns(waveColumns(peaks, audio, 4, 4 * 1000, 0, 2048), waveColumns(peaks, twin, 4, 4 * 1000, 0, 2048), '48 quadros por pixel');
  release();
});

test('montagem aos pedaços: respeita o prazo, dá o mesmo índice e segue a fila', () => {
  clearWaveIndexQueue();
  const L = signal(64 * WAVE_INDEX_STEP_BINS * 5 + 11, 7);
  const R = signal(L.length, 8);
  const audio = { channels: [L, R], length: L.length };
  const ref = buildWaveIndexNow({ channels: [L, R], length: L.length });
  const release = wantWaveIndex(audio);
  let clock = 0;
  const now = () => clock++;
  let calls = 0;
  // cada olhada no relógio anda 1: prazo de 2 deixa montar no máximo 2 pedaços por quadro
  for (;;) {
    calls++;
    const start = clock;
    const more = buildWaveIndexStep(start + 2, now);
    if (!more) break;
    assert.ok(calls < 100);
  }
  assert.equal(calls, 3, '6 pedaços de 512 em quadros de 2');
  assert.deepEqual(readyWaveIndex(audio).data, ref.data);
  release();
  // prazo já vencido: não monta nada
  const other = { channels: [signal(64 * 600, 9)], length: 64 * 600 };
  const off = wantWaveIndex(other);
  assert.equal(buildWaveIndexStep(0, () => 5), true);
  assert.equal(readyWaveIndex(other), null);
  off();
  assert.equal(waveIndexPending(), false, 'a onda saiu da tela: sai da fila');
});

test('pedidos: a faixa dividida (mesmo áudio) só sai da fila quando os dois blocos soltam', () => {
  clearWaveIndexQueue();
  const audio = { channels: [signal(64 * 2000, 10)], length: 64 * 2000 };
  const a = wantWaveIndex(audio);
  const b = wantWaveIndex(audio);
  a();
  a(); // soltar duas vezes não conta duas
  assert.ok(waveIndexPending());
  b();
  assert.equal(waveIndexPending(), false);
  // pedido de novo: continua de onde parou e fica pronto
  const c = wantWaveIndex(audio);
  while (buildWaveIndexStep(Infinity)) { /* até o fim */ }
  assert.ok(readyWaveIndex(audio));
  c();
  // já pronto: pedir não põe na fila
  const d = wantWaveIndex(audio);
  assert.equal(waveIndexPending(), false);
  d();
});

test('canais trocados no mesmo objeto: o índice antigo deixa de valer e é montado de novo', () => {
  clearWaveIndexQueue();
  const audio = { channels: [signal(64 * 900, 11)], length: 64 * 900 };
  buildWaveIndexNow(audio);
  assert.ok(readyWaveIndex(audio));
  audio.channels = [signal(64 * 900, 12)];
  assert.equal(readyWaveIndex(audio), null);
  const off = wantWaveIndex(audio);
  while (buildWaveIndexStep(Infinity)) { /* até o fim */ }
  sameColumns(indexColumns(audio.channels, readyWaveIndex(audio), audio.length, 300, 0, 200),
    sampleColumns(audio.channels, 0, audio.length, 300, 0, 200), 'canais novos');
  off();
});

test('tela: o índice é pedido com zoom aproximado e montado só no tempo que sobra da fila, com a música parada', () => {
  const comp = read('components', 'ClipWaveform.tsx');
  const flush = comp.slice(comp.indexOf('function flushDrawQueue()'), comp.indexOf('function scheduleDraw('));
  // primeiro os desenhos; o índice só com a fila vazia, fora do gesto e com o prazo do mesmo quadro
  assert.ok(flush.indexOf('draw();') < flush.indexOf('buildWaveIndexStep(deadline)'));
  assert.match(flush, /if \(drawQueue\.size > 0\) \{\n\s*drawFrame = requestAnimationFrame\(flushDrawQueue\);\n\s*return;\n\s*\}/);
  assert.ok(flush.indexOf('if (live) {') < flush.indexOf('buildWaveIndexStep(deadline)'));
  assert.ok(flush.indexOf('if (waveIndexBlocked()) {') < flush.indexOf('buildWaveIndexStep(deadline)'));
  assert.match(comp, /const waveIndexBlocked = \(s = useStore\.getState\(\)\) => s\.transport\.isPlaying \|\| s\.loadingSongIds\.length > 0;/);
  // tirar o último desenho da fila não cancela o quadro que monta o índice
  assert.match(comp, /if \(drawQueue\.size === 0 && drawFrame && !waveIndexPending\(\)\) \{/);
  // pedido só com o áudio na memória e com os blocos lendo amostras (mesma regra de waveColumns)
  assert.match(comp, /target\.w >= peakCount\n\s*&& \(clip\.duration \/ Math\.max\(1, target\.w\)\) \* audio\.sampleRate >= WAVE_INDEX_MIN_FRAMES_PER_PX \? audio : null;/);
  assert.match(comp, /const release = wantWaveIndex\(indexAudio\);\n\s*kickWaveIndex\(\);\n\s*return release;/);
  const cols = read('lib', 'waveColumns.ts');
  assert.match(cols, /const index = perPx >= WAVE_INDEX_MIN_FRAMES_PER_PX \? readyWaveIndex\(audio\) : null;/);
  // o resumo de 8 bits do disco não entra no lugar das amostras (adiantaria o ataque em 1 px)
  assert.doesNotMatch(read('lib', 'waveIndex.ts'), /Uint8Array/);
});

// ---------------------------------------------------------------------------------------------
// Resumo detalhado por faixa (finePeaks.ts), com as dependências do programa trocadas por falsas

const fp = {
  state: { transport: { isPlaying: false }, loadingSongIds: [], clips: [] },
  sources: new Map(),
  files: new Map(),
  exists: new Set(),
  existsCalls: [],
};
globalThis.__fp = fp;
const waveColumnsUrl = new URL('../src/lib/waveColumns.ts', import.meta.url).href;
register('data:text/javascript,' + encodeURIComponent(`
const stubs = {
  '@/lib/audioDecoder': 'export const deviceSampleRate = () => 48000;',
  '@/lib/audioLibrary': 'export const getClipAudio = () => null; export const getClipSource = (id) => globalThis.__fp.sources.get(id) ?? null;',
  '@/lib/readyStore': [
    'const fp = globalThis.__fp;',
    'export const hash = (t) => { let h = 0; for (let i = 0; i < t.length; i++) h = (Math.imul(h, 31) + t.charCodeAt(i)) >>> 0; return h.toString(16); };',
    'export const sourceIdentity = (songId, clipId, src) => songId + "|" + clipId + "|" + src.size;',
    'export const fullCopyName = (songId, clipId) => "f_" + clipId;',
    'export const markUsed = () => {};',
    'export const openEntryRange = async () => null;',
    'export const entryExists = async (dir, name) => { fp.existsCalls.push(name); return fp.exists.has(name); };',
    'const dir = { getFileHandle: async (name) => { const f = fp.files.get(name); if (!f) throw new Error("NotFound"); return { getFile: async () => f }; } };',
    'export const readyDir = async () => dir;',
  ].join('\\n'),
  '@/lib/wavReader': 'export const readWavPeaks = async () => null;',
  '@/store': 'export const useStore = { getState: () => globalThis.__fp.state, subscribe: () => () => {} };',
};
export async function resolve(spec, ctx, next) {
  if (spec === '@/lib/waveColumns') return { shortCircuit: true, url: ${JSON.stringify(waveColumnsUrl)} };
  if (stubs[spec]) return { shortCircuit: true, url: 'data:text/javascript,' + encodeURIComponent(stubs[spec]) };
  return next(spec, ctx);
}
`));
const fine = await import('../src/lib/finePeaks.ts');
const tick = () => new Promise((r) => setTimeout(r, 30));

function clipOf(id, peaksValue) {
  fp.sources.set(id, new Blob([new Uint8Array(1000 + id.length)]));
  return { id, songId: 's1', duration: 4, sampleRate: 48000, waveformPeaks: new Array(400).fill(peaksValue) };
}

function fineFile(frames) {
  const bins = Math.ceil(frames / 64);
  const head = new Int32Array([0x56535750, 48000, 64, frames]);
  return new Blob([head, new Uint8Array(bins).fill(100)]);
}

test('resumo detalhado: chegar o de uma faixa não muda a marca das outras (cada onda re-renderiza só pela sua)', async () => {
  fine.clearFinePeaksMemory();
  const a = clipOf('clip-a', 0.3);
  const b = clipOf('clip-b', 0.4);
  fp.files.set(fine.finePeaksName(a), fineFile(48000 * 4));
  const snapA = fine.finePeaksSnapshot(a);
  const snapB = fine.finePeaksSnapshot(b);
  let heard = 0;
  const off = fine.subscribeFinePeaks(() => { heard++; });
  fine.requestFinePeaks(a, false);
  await tick();
  assert.ok(fine.peekFinePeaks(a), 'resumo de A na memória');
  assert.notEqual(fine.finePeaksSnapshot(a), snapA, 'a onda de A redesenha');
  assert.equal(fine.finePeaksSnapshot(b), snapB, 'a onda de B não re-renderiza');
  assert.ok(heard >= 1);
  fine.requestFinePeaks(b, false);
  await tick();
  assert.equal(fine.peekFinePeaks(b), null, 'B não tem resumo no disco');
  assert.notEqual(fine.finePeaksSnapshot(b), snapB);
  // outra fonte na faixa (outro nome): a marca muda mesmo sem aviso
  const before = fine.finePeaksSnapshot(b);
  fp.sources.set('clip-b', new Blob([new Uint8Array(5)]));
  assert.notEqual(fine.finePeaksSnapshot(b), before);
  off();
});

test('pré-carga: o que já foi conferido no disco não é conferido de novo a cada edição', async () => {
  fine.clearFinePeaksMemory();
  fp.existsCalls.length = 0;
  const clips = Array.from({ length: 6 }, (_, i) => clipOf(`pre-${i}`, 0.1 + i / 100));
  for (const c of clips) fp.exists.add(fine.finePeaksName(c));
  fine.prefetchFinePeaks(clips);
  await tick();
  assert.equal(fp.existsCalls.length, 6);
  // edição seguinte (a timeline chama de novo com todos os clipes)
  fine.prefetchFinePeaks(clips);
  await tick();
  assert.equal(fp.existsCalls.length, 6, 'nenhuma conferência nova');
  // faixa com áudio novo (outro nome): essa é conferida
  const changed = { ...clips[2], waveformPeaks: new Array(400).fill(0.9) };
  fp.exists.add(fine.finePeaksName(changed));
  fine.prefetchFinePeaks([...clips.slice(0, 2), changed, ...clips.slice(3)]);
  await tick();
  assert.equal(fp.existsCalls.length, 7);
  const src = read('lib', 'finePeaks.ts');
  assert.match(src, /if \(onDisk\.has\(name\) \|\| loaded\.has\(name\)/);
  assert.match(read('components', 'ClipWaveform.tsx'), /useSyncExternalStore\(subscribeFinePeaks, fineSnapshot\);/);
  assert.doesNotMatch(read('components', 'ClipWaveform.tsx'), /finePeaksVersion/);
});
