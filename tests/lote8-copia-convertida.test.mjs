// Lote 8: o WAV em outra taxa (44,1 kHz numa saída de 48 kHz) ganha em segundo plano a cópia já
// convertida, só da selecionada e da próxima e só com tudo parado. A cópia tem de sair idêntica,
// amostra por amostra, ao arquivo convertido inteiro (é o que o leitor do disco toca no lugar da
// conversão trecho a trecho), e o Play no meio não pode deixar nada gravado pela metade.
// Roda o código real do instantStart e do readyStore, com o worker real de leitura do WAV.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

const RATE = 48000;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- worker de leitura do WAV (o mesmo código do programa) ----------
const waiting = new Map();
let nextId = 0;
globalThis.self = { postMessage: (m) => { const r = waiting.get(m.id); waiting.delete(m.id); r?.(m); } };
await import('../src/workers/wavReader.worker.ts');
const onmessage = globalThis.self.onmessage;
function ask(msg) {
  const id = ++nextId;
  return new Promise((resolve) => {
    waiting.set(id, resolve);
    onmessage({ data: { id, probeOnly: false, maxFrames: 0, ...msg } });
  });
}
const probes = new Map();
const probe = (blob, rate) => {
  const key = blob;
  if (!probes.has(key)) probes.set(key, ask({ blob, targetRate: rate, probeOnly: true }));
  return probes.get(key);
};
globalThis.__wav = { ask, probe, ranges: [], onRange: null };

function wavBlob({ rate, channels, bits, frames, seed }) {
  const block = channels * (bits / 8);
  const buf = new ArrayBuffer(44 + frames * block);
  const v = new DataView(buf);
  const w = (o, t) => { for (let i = 0; i < 4; i++) v.setUint8(o + i, t.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + frames * block, true); w(8, 'WAVE');
  w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, channels, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * block, true); v.setUint16(32, block, true); v.setUint16(34, bits, true);
  w(36, 'data'); v.setUint32(40, frames * block, true);
  let p = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      const x = Math.sin((2 * Math.PI * (220 + seed * 30 + c * 110) * i) / rate) * 0.6 + Math.sin(i * 0.37 + seed) * 0.05;
      if (bits === 16) { v.setInt16(p, Math.round(x * 32767), true); p += 2; }
      else { const s = Math.round(x * 8388607); v.setUint8(p, s & 255); v.setUint8(p + 1, (s >> 8) & 255); v.setUint8(p + 2, (s >> 16) & 255); p += 3; }
    }
  }
  return new Blob([buf]);
}

// ---------- disco do app (OPFS) em memória ----------
class FileHandle {
  constructor(dir, name) { this.dir = dir; this.name = name; }
  async getFile() { return new Blob([this.dir.files.get(this.name) ?? new Uint8Array(0)]); }
  async createWritable() {
    const parts = [];
    return {
      write: async (x) => { parts.push(new Uint8Array(x.buffer ?? x, x.byteOffset ?? 0, x.byteLength).slice()); },
      close: async () => {
        const size = parts.reduce((n, p) => n + p.length, 0);
        const all = new Uint8Array(size);
        let o = 0;
        for (const p of parts) { all.set(p, o); o += p.length; }
        this.dir.files.set(this.name, all);
        this.dir.closed.push(this.name);
      },
      abort: async () => {},
    };
  }
}
class DirHandle {
  constructor() { this.files = new Map(); this.dirs = new Map(); this.closed = []; }
  async getDirectoryHandle(name) {
    if (!this.dirs.has(name)) this.dirs.set(name, new DirHandle());
    return this.dirs.get(name);
  }
  async getFileHandle(name, opts = {}) {
    if (!opts.create) this.onLookup?.(name);
    if (!this.files.has(name)) {
      if (!opts.create) throw new DOMException('não existe', 'NotFoundError');
      this.files.set(name, new Uint8Array(0));
    }
    return new FileHandle(this, name);
  }
  async removeEntry(name) { this.files.delete(name); this.dirs.delete(name); }
  async *keys() { yield* [...this.files.keys()]; }
}
const root = new DirHandle();
let estimate = { quota: 5 * 1024 ** 3, usage: 2 * 1024 ** 3 };
Object.defineProperty(globalThis.navigator, 'storage', {
  configurable: true,
  value: { getDirectory: async () => root, estimate: async () => estimate },
});

// ---------- estado do programa ----------
globalThis.window = globalThis;
const subs = new Set();
globalThis.__store = null;
function setState(patch) {
  const before = globalThis.__store;
  globalThis.__store = { ...before, ...patch };
  for (const fn of subs) fn(globalThis.__store, before);
}
function setTransport(patch) { setState({ transport: { ...globalThis.__store.transport, ...patch } }); }
globalThis.__subs = subs;
globalThis.__sources = new Map();

const SRC = new URL('../src/', import.meta.url).href;
register('data:text/javascript,' + encodeURIComponent(`
const SRC = ${JSON.stringify(SRC)};
const stubs = {
  '@/store': 'export const useStore = { getState: () => globalThis.__store, subscribe: (fn) => { globalThis.__subs.add(fn); return () => globalThis.__subs.delete(fn); } };',
  '@/lib/audioDecoder': 'export const deviceSampleRate = () => ${RATE};',
  '@/lib/audioLibrary': [
    'export const clipPlayLength = (c) => Math.max(0.05, c.duration - (c.trimStart ?? 0) - (c.trimEnd ?? 0));',
    'export const getClipAudio = () => null;',
    'export const getClipPlayAudio = () => null;',
    'export const getClipSource = (id) => globalThis.__sources.get(id) ?? null;',
    'export const openClipAudio = async () => { throw new Error("WAV direto não abre inteiro no preparo"); };',
  ].join('\\n'),
  '@/lib/medley': 'export const hasSliceParams = () => false;',
  '@/lib/timecode': 'export const isTimecodeTrackId = () => false;',
  '@/lib/timeStretch': 'export const tempoFromBpm = () => 1; export const stretchClipAudio = async () => { throw new Error("sem BPM no teste"); };',
  '@/lib/interactionTracker': 'export const isUserInteracting = () => false;',
  // portão do Lote 10: aqui sempre livre (o portão de verdade tem os testes dele)
  '@/lib/backgroundGate': 'export const acquireBackgroundTurn = async () => { globalThis.__turns = (globalThis.__turns ?? 0) + 1; return { release() { globalThis.__released = (globalThis.__released ?? 0) + 1; }, shouldStop: () => false, stale: () => false }; };',
  '@/lib/wavReader': [
    'const w = () => globalThis.__wav;',
    'export const canReadWavDirect = (b, r) => w().probe(b, r).then((x) => x.ok);',
    'export const wavConvertsRate = (b, r) => w().probe(b, r).then((x) => x.ok && x.sourceRate !== r);',
    'export const wavLayoutAtRate = (b, r) => w().probe(b, r).then((x) => (x.ok ? { frames: x.totalFrames, channels: x.channelCount } : null));',
    'export const readWav = async (b, r, max = 0) => { const x = await w().ask({ blob: b, targetRate: r, maxFrames: max }); return x.ok ? { channels: x.channels, sampleRate: x.sampleRate, length: x.channels[0].length, totalFrames: x.totalFrames } : null; };',
    'export const readWavRangeBackground = async (b, r, s, n) => { w().ranges.push([b, s, n]); w().onRange?.(b, s); const x = await w().ask({ blob: b, targetRate: r, startFrame: s, maxFrames: n }); return x.ok ? x.channels : null; };',
  ].join('\\n'),
};
export async function resolve(spec, ctx, next) {
  if (stubs[spec]) return { shortCircuit: true, url: 'data:text/javascript,' + encodeURIComponent(stubs[spec]) };
  if (spec.startsWith('@/')) return next(SRC + spec.slice(2) + '.ts', ctx);
  return next(spec, ctx);
}
`));

const inst = await import('../src/lib/instantStart.ts');
const store = await import('../src/lib/readyStore.ts');

async function fullConversion(blob) {
  const r = await ask({ blob, targetRate: RATE });
  assert.ok(r.ok);
  return r.channels;
}

function assertSame(got, want, label) {
  assert.equal(got.length, want.length, `${label}: canais`);
  for (let c = 0; c < want.length; c++) {
    assert.equal(got[c].length, want[c].length, `${label}: quadros do canal ${c}`);
    for (let i = 0; i < want[c].length; i++) {
      if (got[c][i] !== want[c][i]) assert.fail(`${label}: canal ${c}, amostra ${i}: ${got[c][i]} != ${want[c][i]}`);
    }
  }
}

// ---------- montagem da cópia ----------

for (const fmt of [
  { rate: 44100, channels: 2, bits: 24, label: 'WAV 44,1 kHz estéreo 24 bits' },
  { rate: 44100, channels: 1, bits: 16, label: 'WAV 44,1 kHz mono 16 bits' },
  { rate: 96000, channels: 2, bits: 16, label: 'WAV 96 kHz estéreo' },
]) {
  test(`${fmt.label}: cópia montada em trechos = arquivo convertido inteiro`, async () => {
    const blob = wavBlob({ ...fmt, frames: Math.round(fmt.rate * 3.3), seed: 1 });
    const want = await fullConversion(blob);
    const layout = await probe(blob, RATE);
    assert.ok(layout.totalFrames % inst.COPY_CHUNK_FRAMES !== 0, 'o último trecho é menor');
    let calls = 0;
    const got = await inst.assembleConvertedCopy(layout.totalFrames, layout.channelCount, async (s, n) => {
      const r = await ask({ blob, targetRate: RATE, startFrame: s, maxFrames: n });
      return r.ok ? r.channels : null;
    }, async () => { calls++; return true; });
    assertSame(got, want, fmt.label);
    assert.equal(calls, Math.ceil(layout.totalFrames / inst.COPY_CHUNK_FRAMES), 'uma conferência antes de cada trecho');
  });
}

test('cópia montada: parar no meio ou trecho com defeito não devolve nada', async () => {
  const ok = async (s, n) => [new Int16Array(n), new Int16Array(n)];
  let left = 2;
  assert.equal(await inst.assembleConvertedCopy(200000, 2, ok, async () => left-- > 0), null, 'parou no terceiro trecho');
  assert.equal(await inst.assembleConvertedCopy(200000, 2, async () => null, async () => true), null, 'trecho falhou');
  assert.equal(await inst.assembleConvertedCopy(200000, 2, async (s, n) => [new Int16Array(n)], async () => true), null, 'canais a menos');
  assert.equal(await inst.assembleConvertedCopy(200000, 2, async (s, n) => [new Int16Array(n - 1), new Int16Array(n - 1)], async () => true), null, 'trecho curto');
  assert.equal(await inst.assembleConvertedCopy(0, 2, ok, async () => true), null);
  assert.equal(await inst.assembleConvertedCopy(10, 3, ok, async () => true), null);
});

// ---------- preparo em segundo plano ----------

async function until(fn, ms, label) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return;
    await wait(50);
  }
  assert.fail(`esperei demais: ${label}`);
}

test('selecionada e próxima ganham a cópia convertida parada; tocando nada é gravado; disco cheio pula', async () => {
  const clips = [
    { id: 'a1', songId: 'A', trackId: 't1', name: 'a1', startTime: 0, duration: 3.3, blob: wavBlob({ rate: 44100, channels: 2, bits: 24, frames: 145530, seed: 2 }) },
    { id: 'a0', songId: 'A', trackId: 't2', name: 'a0', startTime: 0, duration: 3.3, blob: wavBlob({ rate: 48000, channels: 2, bits: 16, frames: 158400, seed: 3 }) },
    { id: 'b1', songId: 'B', trackId: 't1', name: 'b1', startTime: 0, duration: 3.3, blob: wavBlob({ rate: 44100, channels: 1, bits: 16, frames: 145530, seed: 4 }) },
    { id: 'c1', songId: 'C', trackId: 't1', name: 'c1', startTime: 0, duration: 3.3, blob: wavBlob({ rate: 44100, channels: 2, bits: 16, frames: 145530, seed: 5 }) },
  ];
  for (const c of clips) globalThis.__sources.set(c.id, c.blob);
  const copyName = (c) => store.fullCopyName(c.songId, c.id, c.blob, RATE);
  globalThis.__store = {
    songs: ['A', 'B', 'C'].map((id) => ({ id, name: id, bpmAdjust: 0, tuner: 0 })),
    clips: clips.map(({ blob, ...c }) => c),
    tracks: [{ id: 't1', name: 'Baixo' }, { id: 't2', name: 'Guitarra' }],
    selectedSongId: 'A',
    playlist: [{ songId: 'A' }, { songId: 'B' }, { songId: 'C' }],
    playlistOrder: ['A', 'B', 'C'],
    transport: { isPlaying: false, isStopped: true, currentSongId: null, nextSongId: null, playFlow: 'continuo' },
    importProgress: null,
    instantPrep: null,
    setInstantPrep: (v) => { globalThis.__store = { ...globalThis.__store, instantPrep: v }; },
  };
  const stop = inst.startInstantStartBuilder({ isBusy: () => false, pitchFor: () => 1 });
  try {
    const dir = await store.readyDir();
    const has = (c) => (dir.files.get(copyName(c))?.length ?? 0) > 0;

    // 1. disco quase cheio (sobra menos que a reserva): os começos prontos saem, a cópia não
    const heads = () => [...dir.files.entries()].filter(([n, d]) => n.startsWith('h_') && d.length > 0).length;
    await until(async () => heads() === clips.length, 5000, 'começos prontos');
    await wait(3000);
    assert.ok(!clips.some(has), 'nenhuma cópia com o disco apertado');

    // 2. disco folgado: a próxima muda parada e a conferência roda de novo
    estimate = { quota: 500 * 1024 ** 3, usage: 1024 ** 3 };
    setTransport({ nextSongId: 'B' });
    await until(async () => has(clips[0]) && has(clips[2]), 10000, 'cópias da selecionada e da próxima');
    assert.ok(!has(clips[1]), 'WAV na taxa da saída não ganha cópia');
    assert.ok(!has(clips[3]), 'música que não é a selecionada nem a próxima fica sem cópia');
    for (const c of [clips[0], clips[2]]) {
      const entry = await store.readEntry(dir, copyName(c));
      const want = await fullConversion(c.blob);
      assert.equal(entry.sampleRate, RATE);
      assert.equal(entry.fullFrames, want[0].length);
      assert.equal(entry.validFrames, want[0].length);
      assertSame(entry.channels, want, `cópia gravada de ${c.id}`);
      const range = await store.openEntryRange(dir, copyName(c));
      assert.equal(range.frames, range.fullFrames, 'o leitor do disco aceita a cópia');
    }
    const a1Reads = globalThis.__wav.ranges.filter(([b]) => b === clips[0].blob).length;
    assert.equal(a1Reads, Math.ceil(158400 / inst.COPY_CHUNK_FRAMES), 'cada trecho lido uma vez');

    // 3. Play no meio da montagem: nada gravado tocando; ao parar, a cópia sai inteira
    const cName = copyName(clips[3]);
    let played = false;
    globalThis.__wav.onRange = (b, s) => {
      if (b === clips[3].blob && s > 0 && !played) {
        played = true;
        setTransport({ isPlaying: true, isStopped: false, currentSongId: 'A' });
      }
    };
    setTransport({ nextSongId: 'C' });
    await until(async () => played, 10000, 'Play durante a montagem');
    const closedBefore = dir.closed.filter((n) => n === cName).length;
    await wait(3000);
    assert.equal(dir.closed.filter((n) => n === cName).length, closedBefore, 'tocando, a cópia não é gravada');
    assert.ok(!has(clips[3]));
    globalThis.__wav.onRange = null;
    setTransport({ isPlaying: false, isStopped: true });
    await until(async () => has(clips[3]), 10000, 'cópia depois de parar');
    assertSame((await store.readEntry(dir, cName)).channels, await fullConversion(clips[3].blob), 'cópia de c1 depois do Play');
    assert.equal(dir.closed.filter((n) => n === copyName(clips[0])).length, 1, 'cópia pronta não é gravada de novo');
  } finally {
    stop();
    await wait(300);
  }
});

test('teto cheio: a parada não reconta nem espera; na pausa nada é montado; Play antes da gravação não grava', async () => {
  const mk = (id, songId, seed) => ({ id, songId, trackId: 't1', name: id, startTime: 0, duration: 3.3, blob: wavBlob({ rate: 44100, channels: 2, bits: 16, frames: 145530, seed }) });
  const clips = [mk('d1', 'D', 6), mk('e1', 'E', 7), mk('f1', 'F', 8)];
  for (const c of clips) globalThis.__sources.set(c.id, c.blob);
  const copyName = (c) => store.fullCopyName(c.songId, c.id, c.blob, RATE);
  const need = 158400 * 2 * 2; // 145530 quadros a 44,1 kHz viram 158400 a 48 kHz, estéreo, 16 bits
  assert.equal((await probe(clips[0].blob, RATE)).totalFrames, 158400);
  const limits = { ...inst.copyLimits };
  inst.copyLimits.projectBytes = need * 1.5; // cabe uma cópia só
  estimate = { quota: 500 * 1024 ** 3, usage: 1024 ** 3 };
  globalThis.__store = {
    songs: ['D', 'E', 'F'].map((id) => ({ id, name: id, bpmAdjust: 0, tuner: 0 })),
    clips: clips.map(({ blob, ...c }) => c),
    tracks: [{ id: 't1', name: 'Baixo' }],
    selectedSongId: 'D',
    playlist: [{ songId: 'D' }, { songId: 'E' }, { songId: 'F' }],
    playlistOrder: ['D', 'E', 'F'],
    transport: { isPlaying: false, isStopped: true, currentSongId: null, nextSongId: 'E', playFlow: 'continuo' },
    importProgress: null,
    instantPrep: null,
    setInstantPrep: (v) => { globalThis.__store = { ...globalThis.__store, instantPrep: v }; },
  };
  const dir = await store.readyDir();
  const has = (c) => (dir.files.get(copyName(c))?.length ?? 0) > 0;
  const reads = (c) => globalThis.__wav.ranges.filter(([b]) => b === c.blob).length;
  const scans0 = inst.copyStats.scans;
  const stop = inst.startInstantStartBuilder({ isBusy: () => false, pitchFor: () => 1 });
  try {
    // 1. a selecionada ganha a cópia; a próxima não cabe no teto
    await until(async () => has(clips[0]), 10000, 'cópia da selecionada');
    await wait(2500);
    assert.ok(!has(clips[1]), 'a próxima não cabe no teto');
    assert.equal(reads(clips[1]), 0, 'nada lido de uma faixa que não cabe');
    const { scans, waits } = inst.copyStats;
    assert.equal(scans - scans0, 1, 'o espaço foi contado uma vez');

    // 2. teto cheio: trocar a próxima e dar Play e Stop várias vezes não reconta, não espera, não lê
    setTransport({ nextSongId: 'F' });
    await wait(400);
    for (let i = 0; i < 3; i++) {
      setTransport({ isPlaying: true, isStopped: false, currentSongId: 'D' });
      await wait(100);
      setTransport({ isPlaying: false, isStopped: true });
      await wait(400);
    }
    assert.equal(inst.copyStats.scans, scans, 'sem recontar o projeto a cada parada');
    assert.equal(inst.copyStats.waits, waits, 'sem a espera de 2 s a cada parada');
    assert.equal(reads(clips[1]) + reads(clips[2]), 0);

    // 3. na pausa nada é montado, mesmo com espaço
    inst.copyLimits.projectBytes = limits.projectBytes;
    setTransport({ isPlaying: true, isStopped: false, currentSongId: 'D' });
    await wait(100);
    setTransport({ isPlaying: false, isStopped: false });
    await wait(3000);
    assert.equal(reads(clips[1]) + reads(clips[2]), 0, 'pausado, nenhuma cópia é montada');
    assert.equal(inst.copyStats.waits, waits, 'pausado, nem a espera começa');

    // 4. Play logo depois do último trecho, durante a conferência antes de gravar: nada gravado
    const fName = copyName(clips[2]);
    let played = false;
    dir.onLookup = (name) => {
      const last = globalThis.__wav.ranges.some(([b, st, n]) => b === clips[2].blob && st + n >= 158400);
      if (name === fName && last && !played) {
        played = true;
        setTransport({ isPlaying: true, isStopped: false, currentSongId: 'D' });
      }
    };
    setTransport({ isStopped: true });
    await until(async () => played, 10000, 'Play antes de gravar');
    await wait(1500);
    assert.ok(!dir.closed.includes(fName), 'o Play antes da gravação vence');
    dir.onLookup = null;
    setTransport({ isPlaying: false, isStopped: true });
    await until(async () => has(clips[2]), 10000, 'cópia depois de parar');
    assertSame((await store.readEntry(dir, fName)).channels, await fullConversion(clips[2].blob), 'cópia de f1');
  } finally {
    Object.assign(inst.copyLimits, limits);
    stop();
    await wait(300);
  }
});

test('faixa maior que o teto por faixa e pasta das cópias cheia ficam sem cópia', async () => {
  const c = { id: 'g1', songId: 'G', trackId: 't1', name: 'g1', startTime: 0, duration: 3.3, blob: wavBlob({ rate: 44100, channels: 2, bits: 16, frames: 145530, seed: 9 }) };
  const h = { id: 'h1', songId: 'H', trackId: 't1', name: 'h1', startTime: 0, duration: 3.3, blob: wavBlob({ rate: 44100, channels: 1, bits: 16, frames: 145530, seed: 10 }) };
  for (const x of [c, h]) globalThis.__sources.set(x.id, x.blob);
  const copyName = (x) => store.fullCopyName(x.songId, x.id, x.blob, RATE);
  const limits = { ...inst.copyLimits };
  inst.copyLimits.clipBytes = 158400 * 2 * 2 - 1; // a estéreo passa do teto por faixa, a mono não
  const dir = await store.readyDir();
  const used = [...dir.files.values()].reduce((n, d) => n + d.length, 0);
  inst.copyLimits.readyBytes = used + 1000; // e a pasta inteira já está no limite
  globalThis.__store = {
    ...globalThis.__store,
    songs: ['G', 'H'].map((id) => ({ id, name: id, bpmAdjust: 0, tuner: 0 })),
    clips: [c, h].map(({ blob, ...x }) => x),
    selectedSongId: 'G',
    playlist: [{ songId: 'G' }, { songId: 'H' }],
    playlistOrder: ['G', 'H'],
    transport: { isPlaying: false, isStopped: true, currentSongId: null, nextSongId: 'H', playFlow: 'continuo' },
  };
  const stop = inst.startInstantStartBuilder({ isBusy: () => false, pitchFor: () => 1 });
  try {
    await wait(4500); // começos prontos e a conferência da cópia
    assert.ok(!dir.closed.includes(copyName(c)), 'acima do teto por faixa');
    assert.ok(!dir.closed.includes(copyName(h)), 'pasta das cópias cheia');
    assert.equal(globalThis.__wav.ranges.filter(([b]) => b === c.blob || b === h.blob).length, 0);
    // com espaço na pasta, a mono sai; a estéreo continua de fora
    inst.copyLimits.readyBytes = limits.readyBytes;
    setTransport({ nextSongId: null });
    setTransport({ nextSongId: 'H' });
    await until(async () => dir.closed.includes(copyName(h)), 10000, 'cópia da mono');
    assert.ok(!dir.closed.includes(copyName(c)));
  } finally {
    Object.assign(inst.copyLimits, limits);
    stop();
    await wait(300);
  }
});
