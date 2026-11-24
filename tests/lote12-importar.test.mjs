// Lote 12 (importar): WAV pelo leitor em segundo plano, conversão e picos fora da tela, e a
// selecionada e a próxima mantidas durante a importação quando cabem na memória.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const decoder = await import('../src/lib/audioDecoder.ts');
const { waveformPeaks } = await import('../src/lib/waveformPeaks.ts');
const read = (p) => fs.readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');
const importManager = read('lib/importManager.ts');

// ---------- o código do worker da importação, rodando aqui ----------
function runWorkerSource() {
  const replies = [];
  const self = { postMessage: (m, transfer) => replies.push({ m, transfer }) };
  new Function('self', decoder.IMPORT_WORKER_SOURCE)(self);
  return (data) => {
    replies.length = 0;
    self.onmessage({ data });
    return replies[0];
  };
}
const worker = runWorkerSource();

const fakeBuffer = (chs) => ({ numberOfChannels: chs.length, length: chs[0].length, getChannelData: (c) => chs[c] });

// a mesma conta de convertRange em audioLibrary.ts (toClipAudio)
function refInt16(src) {
  const out = new Int16Array(src.length);
  for (let i = 0; i < src.length; i++) {
    const v = src[i];
    out[i] = v >= 1 ? 32767 : v <= -1 ? -32768 : Math.round(v * 32767);
  }
  return out;
}

function noise(len, seed, amp = 1.2) {
  const out = new Float32Array(len);
  let s = seed;
  for (let i = 0; i < len; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    out[i] = ((s / 0x7fffffff) * 2 - 1) * amp;
  }
  // bordas: fundo de escala exato, acima dele, zero negativo
  out[0] = 1; out[1] = -1; out[2] = -0; out[3] = 1.5; out[4] = -1.5; out[5] = 0.99999;
  return out;
}

test('worker, áudio do navegador (MP3/M4A): 16 bits e picos idênticos aos de antes, número por número', () => {
  for (const [len, numPeaks, stereo] of [[100_003, 8000, true], [48_000 * 3, 8000, false], [1000, 8000, true], [480_000, 24000, true]]) {
    const chs = stereo ? [noise(len, 7), noise(len, 11)] : [noise(len, 5)];
    const expectedPeaks = waveformPeaks(fakeBuffer(chs), numPeaks);
    const expected16 = chs.map(refInt16);
    const { m, transfer } = worker({ id: 1, kind: 'float', numPeaks, channels: chs });
    assert.equal(m.ok, true);
    assert.deepEqual(Array.from(m.peaks), expectedPeaks, `picos ${len}/${numPeaks}`);
    assert.equal(m.channels.length, chs.length);
    m.channels.forEach((c, i) => assert.deepEqual(c, expected16[i], `canal ${i}`));
    // volta sem cópia: os picos e os canais vão na lista de transferência
    assert.ok(transfer.includes(m.peaks.buffer));
    m.channels.forEach((c) => assert.ok(transfer.includes(c.buffer)));
  }
});

test('worker, WAV já em 16 bits: os mesmos canais e os picos da conta de sempre (amostra / 32768)', async () => {
  const len = 200_017;
  const chs = [0, 1].map((k) => {
    const a = new Int16Array(len);
    let s = 3 + k;
    for (let i = 0; i < len; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; a[i] = (s % 65536) - 32768; }
    a[10] = -32768; a[11] = 32767;
    return a;
  });
  const copies = chs.map((c) => c.slice());
  const numPeaks = 8000;
  const asFloat = chs.map((c) => Float32Array.from(c, (v) => v / 32768));
  const expected = waveformPeaks(fakeBuffer(asFloat), numPeaks);
  const { m } = worker({ id: 2, kind: 'int16', numPeaks, channels: chs });
  assert.equal(m.ok, true);
  assert.deepEqual(Array.from(m.peaks), expected);
  m.channels.forEach((c, i) => assert.deepEqual(c, copies[i], 'as amostras não mudam'));
  // a reserva na tela (sem worker) dá o mesmo resultado
  assert.deepEqual(await decoder.int16PeaksAsync(copies, numPeaks), expected);
  // nunca passa de 1 (o -32768 dá exatamente 1)
  assert.ok(Math.max(...m.peaks) <= 1);
});

test('worker devolve erro em vez de quebrar (canais vazios)', () => {
  const { m } = worker({ id: 3, kind: 'float', numPeaks: 8000, channels: [] });
  assert.deepEqual(m, { id: 3, ok: false });
});

test('a conta de 16 bits do worker é a mesma de audioLibrary.ts', () => {
  const lib = read('lib/audioLibrary.ts');
  const line = 'out[i] = v >= 1 ? 32767 : v <= -1 ? -32768 : Math.round(v * 32767);';
  assert.ok(lib.includes(line));
  assert.ok(decoder.IMPORT_WORKER_SOURCE.includes(line));
  // e a dos picos, a mesma de waveformPeaks.ts
  const peaksSrc = read('lib/waveformPeaks.ts');
  for (const l of ['const start = Math.floor((i / numPeaks) * dataLen);', 'const end = Math.min(Math.ceil(((i + 1) / numPeaks) * dataLen), dataLen);']) {
    assert.ok(peaksSrc.includes(l));
    assert.ok(decoder.IMPORT_WORKER_SOURCE.includes(l.replace('const ', 'var ')));
  }
});

test('quantidade de picos igual à de antes (100 por segundo, entre 8 mil e 24 mil)', () => {
  for (const d of [0.5, 30, 80, 80.004, 239.99, 240, 600]) {
    assert.equal(decoder.importPeakCount(d), Math.min(24000, Math.max(8000, Math.round(d * 100))));
  }
});

// ---------- cliente do worker (com um Worker de mentira) ----------
test('sem Worker no ambiente: nada é enviado e quem chama faz na tela', async () => {
  const fresh = await import('../src/lib/audioDecoder.ts?sem-worker');
  assert.equal(typeof globalThis.Worker, 'undefined');
  const ch = new Int16Array(10);
  assert.equal(fresh.convertForImport('int16', [ch], 8000), null);
  assert.equal(ch.length, 10, 'o áudio continua com quem chamou');
});

test('com Worker: resolve com os canais e os picos; worker que quebra vira erro e desliga o worker', async () => {
  const sources = [];
  class FakeWorker {
    constructor(url) {
      sources.push(url);
      this.self = { postMessage: (m) => setTimeout(() => this.onmessage?.({ data: m }), 0) };
      new Function('self', globalThis.__lote12Source)(this.self);
    }
    postMessage(m) { setTimeout(() => (globalThis.__lote12Break ? this.onerror?.({ preventDefault() {} }) : this.self.onmessage({ data: m })), 0); }
    terminate() { this.dead = true; }
  }
  globalThis.Worker = FakeWorker;
  try {
    const fresh = await import('../src/lib/audioDecoder.ts?com-worker');
    globalThis.__lote12Source = fresh.IMPORT_WORKER_SOURCE;
    const ch = noise(50_000, 9);
    const expected = waveformPeaks(fakeBuffer([ch]), 8000);
    const done = await fresh.convertForImport('float', [ch], 8000);
    assert.deepEqual(done.peaks, expected);
    assert.deepEqual(done.channels[0], refInt16(ch));
    assert.ok(sources[0].startsWith('blob:'), 'worker por endereço blob:, como os worklets');

    globalThis.__lote12Break = true;
    await assert.rejects(fresh.convertForImport('float', [noise(1000, 2)], 8000), fresh.ImportWorkerError);
    assert.equal(fresh.convertForImport('float', [noise(1000, 2)], 8000), null, 'depois de quebrar, a conta fica na tela');
  } finally {
    delete globalThis.Worker;
    delete globalThis.__lote12Source;
    delete globalThis.__lote12Break;
  }
});

// ---------- WAV: importar passa a dar o mesmo áudio da reabertura ----------
const replies = [];
globalThis.self = { postMessage: (m) => replies.push(m) };
await import('../src/workers/wavReader.worker.ts');
const wavOnMessage = globalThis.self.onmessage;

function wavBlob({ rate, channels, bits, frames }) {
  const block = channels * (bits / 8);
  const buf = new ArrayBuffer(44 + frames * block);
  const v = new DataView(buf);
  const w = (o, t) => { for (let i = 0; i < 4; i++) v.setUint8(o + i, t.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + frames * block, true); w(8, 'WAVE');
  w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, channels, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * block, true); v.setUint16(32, block, true); v.setUint16(34, bits, true);
  w(36, 'data'); v.setUint32(40, frames * block, true);
  const raw = Array.from({ length: channels }, () => new Int16Array(frames));
  let p = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      const x = Math.sin((2 * Math.PI * (330 + c * 110) * i) / rate) * 0.9;
      const s = Math.round(x * 32767);
      raw[c][i] = s;
      v.setInt16(p, s, true); p += 2;
    }
  }
  return { blob: new Blob([buf]), raw };
}

async function readWavNode(blob, targetRate) {
  replies.length = 0;
  await wavOnMessage({ data: { id: 1, blob, targetRate, maxFrames: 0, probeOnly: false } });
  return replies[0];
}

test('WAV 48 kHz 16 bits numa saída de 48 kHz: as amostras do arquivo, sem a volta pelo Float32', async () => {
  const frames = 48_000 * 2 + 17;
  const { blob, raw } = wavBlob({ rate: 48000, channels: 2, bits: 16, frames });
  const r = await readWavNode(blob, 48000);
  assert.equal(r.ok, true);
  assert.equal(r.channels[0].length, frames);
  r.channels.forEach((c, i) => assert.deepEqual(c, raw[i]));
  // o caminho antigo (Float32 do navegador, s / 32768, de volta a 16 bits) mudava até 1 passo
  const old = raw.map((c) => refInt16(Float32Array.from(c, (s) => s / 32768)));
  let maxDiff = 0;
  old.forEach((c, k) => c.forEach((s, i) => { maxDiff = Math.max(maxDiff, Math.abs(s - raw[k][i])); }));
  assert.ok(maxDiff <= 1, `diferença do caminho antigo: ${maxDiff}`);
  // duração: quadros / taxa, a mesma conta do AudioBuffer
  assert.equal(r.channels[0].length / r.sampleRate, frames / 48000);
});

// WAV 44,1 kHz numa saída de 48 kHz entra pelo navegador (como hoje). Depois de importar, a música
// toca do disco pelo leitor: mesmo tamanho (no Chromium, decodeAudioData e o leitor deram o mesmo
// comprimento em 12 tamanhos de arquivo, alinhamento zero e o mesmo BPM e compasso 1 do click).
test('WAV 44,1 kHz numa saída de 48 kHz: o leitor do disco dá o tamanho do arquivo inteiro e trechos idênticos', async () => {
  const frames = 44_100 * 3 + 5;
  const { blob } = wavBlob({ rate: 44100, channels: 2, bits: 16, frames });
  const whole = await readWavNode(blob, 48000);
  assert.equal(whole.channels[0].length, Math.floor((frames * 48000) / 44100));
  // o trecho lido do disco ao tocar (readWavRange) é idêntico ao arquivo inteiro: importar e tocar dão o mesmo
  replies.length = 0;
  await wavOnMessage({ data: { id: 2, blob, targetRate: 48000, maxFrames: 9000, probeOnly: false, startFrame: 70_000 } });
  const part = replies[0];
  part.channels.forEach((c, k) => assert.deepEqual(c, whole.channels[k].subarray(70_000, 79_000)));
});

// ---------- selecionada e próxima durante a importação ----------
const GIB = 1024 ** 3;

test('orçamento de reserva: 15% da RAM entre 0,6 e 3 GB', () => {
  assert.equal(decoder.importBudgetFallback(8 * GIB), 0.15 * 8 * GIB);
  assert.equal(decoder.importBudgetFallback(4 * GIB), 0.6 * GIB);
  assert.equal(decoder.importBudgetFallback(32 * GIB), 3 * GIB);
  assert.equal(decoder.importBudgetFallback(NaN, 8), 0.15 * 8 * GIB, 'sem a RAM do computador: a do navegador');
  assert.equal(decoder.importBudgetFallback(undefined, undefined), 0.15 * 8 * GIB);
});

test('estimativa do arquivo aberto: WAV perto do tamanho, comprimido 12 vezes', () => {
  assert.equal(decoder.importFileBytes({ name: 'Bateria.WAV', size: 1000 }), 1100);
  assert.equal(decoder.importFileBytes({ name: 'baixo.mp3', size: 1000 }), 12000);
  assert.equal(decoder.importFileBytes({ name: 'teclado.m4a', size: 1000 }), 12000);
});

test('a do ar sempre fica; a selecionada e a próxima só se couberem, nessa ordem', () => {
  const keep = (o) => decoder.songsKeptDuringImport({ playingId: null, usedBytes: 0, budget: 1000, ...o });
  assert.deepEqual(keep({ candidates: [{ id: 'sel', bytes: 400 }, { id: 'prox', bytes: 400 }] }), ['sel', 'prox']);
  assert.deepEqual(keep({ candidates: [{ id: 'sel', bytes: 700 }, { id: 'prox', bytes: 400 }] }), ['sel']);
  assert.deepEqual(keep({ candidates: [{ id: 'sel', bytes: 1200 }, { id: 'prox', bytes: 400 }] }), ['prox']);
  assert.deepEqual(keep({ usedBytes: 900, candidates: [{ id: 'sel', bytes: 400 }, { id: 'prox', bytes: 400 }] }), []);
  // tocando: a do ar fica mesmo sem caber; repetidas e vazias não contam
  assert.deepEqual(keep({ playingId: 'ar', usedBytes: 5000, candidates: [{ id: 'ar', bytes: 0 }, { id: 'prox', bytes: 1 }] }), ['ar']);
  assert.deepEqual(keep({ playingId: 'ar', candidates: [{ id: null, bytes: 0 }, { id: 'prox', bytes: 100 }, { id: 'prox', bytes: 100 }] }), ['ar', 'prox']);
  // orçamento inválido: solta como antes
  assert.deepEqual(keep({ budget: NaN, candidates: [{ id: 'sel', bytes: 0 }] }), []);
});

test('Mac de 8 GB importando 24 faixas de 5 min: solta como antes; música pequena num Mac de 16 GB: mantém', () => {
  const wav5min = 5 * 60 * 48000 * 2 * 2; // estéreo 16 bits a 48 kHz
  const big = 2 * 24 * decoder.importFileBytes({ name: 'f.wav', size: wav5min });
  assert.deepEqual(decoder.songsKeptDuringImport({
    playingId: null, usedBytes: big, budget: decoder.importBudgetFallback(8 * GIB),
    candidates: [{ id: 'sel', bytes: 10 * wav5min }, { id: 'prox', bytes: 10 * wav5min }],
  }), []);
  const small = 2 * 6 * decoder.importFileBytes({ name: 'f.wav', size: wav5min });
  assert.deepEqual(decoder.songsKeptDuringImport({
    playingId: null, usedBytes: small, budget: decoder.importBudgetFallback(16 * GIB),
    candidates: [{ id: 'sel', bytes: 6 * wav5min }, { id: 'prox', bytes: 6 * wav5min }],
  }), ['sel', 'prox']);
});

// ---------- o código da importação ----------
test('importação: WAV na taxa da saída pelo leitor em segundo plano, o resto pelo navegador, nada de picos síncronos', () => {
  assert.doesNotMatch(importManager, /decodeFile\(/);
  assert.doesNotMatch(importManager, /generateWaveformPeaks\(/);
  const body = importManager.slice(importManager.indexOf('async function openImportFileOnce'));
  assert.match(body, /const sameRateWav = \(await canReadWavDirect\(file, rate\)\) && !\(await wavConvertsRate\(file, rate\)\);\s*const wav = sameRateWav \? await readWav\(file, rate\) : null;/);
  assert.ok(body.indexOf('await readWav(file, rate)') > 0);
  assert.ok(body.indexOf('await readWav(file, rate)') < body.indexOf('await decodeBlob(file)'));
  assert.match(body, /convertForImport\('int16', wav\.channels, numPeaks\)/);
  assert.match(body, /convertForImport\('float', floats, numPeaks\)/);
  // o worker que falha não perde o arquivo: abre de novo com a conta na tela
  assert.match(importManager, /if \(err instanceof ImportWorkerError\) return openImportFileOnce\(file, false\);/);
  assert.match(importManager, /const opened = await openImportFile\(file\);/);
});

test('importação: a selecionada e a próxima pela mesma conta do App, no começo e no fim', () => {
  assert.doesNotMatch(importManager, /retainSongs\(\[playingId\], \{ strict: true \}\)/);
  assert.match(importManager, /const keep = keptWhileImporting\(2 \* audioFiles\.reduce\(\(n, f\) => n \+ importFileBytes\(f\), 0\)\);\s*retainSongs\(keep, \{ strict: true \}\);\s*audioEngine\.releaseUnretained\(keep\);/);
  assert.match(importManager, /function releaseImportedAudio\(\) \{\s*const keep = keptWhileImporting\(0\);\s*audioEngine\.releaseUnretained\(keep\);\s*retainSongs\(keep, \{ strict: true \}\);/);
  const app = read('App.tsx');
  for (const line of [
    'const selId = st.selectedSongId ?? st.playlist[0]?.songId ?? null;',
    'const anchor = playingId ?? selId;',
  ]) {
    assert.ok(app.includes(line), `App: ${line}`);
    assert.ok(importManager.includes(line), `importação: ${line}`);
  }
  assert.match(app, /\?\? \(anchor \? computeNextSongId\(anchor, st\.playlist, st\.playlistOrder, st\.transport\.playFlow\) : null\)/);
  assert.match(importManager, /\?\? \(anchor \? computeNextSongId\(anchor, st\.playlist, st\.playlistOrder, st\.transport\.playFlow\) : null\)/);
});
