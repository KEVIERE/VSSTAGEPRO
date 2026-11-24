// Lote 9 (leitura do disco), cópias prontas e leitores de trecho:
//  - os dois canais de uma cópia pronta são lidos juntos e saem iguais aos gravados;
//  - metadado ao lado de uma cópia (para o adiantamento do BPM): grava, junta, some quando a cópia
//    é regravada ou apagada, e a limpeza não o trata como cópia;
//  - leitor de trecho guardado por clipe: reabrir não consulta o disco, o corte vale na hora, e a
//    cópia gravada, apagada ou um arquivo de origem novo fazem abrir de novo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

// ---------- disco do app de mentira (OPFS) ----------
class FakeDir {
  constructor() {
    this.files = new Map();
    this.opens = 0;
    this.gate = null;
    this.started = [];
  }
  async getFileHandle(name, opts) {
    this.opens++;
    if (!this.files.has(name)) {
      if (!opts?.create) throw new DOMException('não existe', 'NotFoundError');
      this.files.set(name, new Uint8Array(0));
    }
    const dir = this;
    return {
      getFile: async () => {
        const real = new File([dir.files.get(name)], name);
        return {
          size: real.size,
          text: () => real.text(),
          arrayBuffer: () => real.arrayBuffer(),
          slice: (a, b) => {
            const part = real.slice(a, b);
            return { arrayBuffer: async () => { dir.started.push([name, a, b]); if (dir.gate) await dir.gate; return part.arrayBuffer(); } };
          },
        };
      },
      createWritable: async () => {
        const parts = [];
        return {
          write: async (d) => {
            if (dir.failWrite) throw new DOMException('disco cheio', 'QuotaExceededError');
            if (typeof d === 'string') parts.push(new TextEncoder().encode(d));
            else parts.push(new Uint8Array(d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength)));
          },
          close: async () => {
            const len = parts.reduce((s, p) => s + p.length, 0);
            const out = new Uint8Array(len);
            let o = 0;
            for (const p of parts) { out.set(p, o); o += p.length; }
            dir.files.set(name, out);
          },
          abort: async () => {},
        };
      },
    };
  }
  async removeEntry(name) {
    if (!this.files.delete(name)) throw new DOMException('não existe', 'NotFoundError');
  }
  async *keys() { for (const k of [...this.files.keys()]) yield k; }
}

const dir = new FakeDir();
const root = {
  removeEntry: async () => { throw new DOMException('não existe', 'NotFoundError'); },
  getDirectoryHandle: async () => dir,
};
const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
Object.defineProperty(globalThis, 'navigator', {
  value: { hardwareConcurrency: 8, storage: { getDirectory: async () => root, estimate: async () => ({ quota: 1e12, usage: 0 }) } },
  configurable: true,
  writable: true,
});

// ---------- biblioteca, taxa e leitor de WAV de mentira; readyStore e diskSource são os de verdade ----------
globalThis.__lib = { sources: new Map(), layoutCalls: 0, rangeCalls: [], failNext: false };
const SRC = new URL('../src/', import.meta.url).href;
register('data:text/javascript,' + encodeURIComponent(`
const SRC = ${JSON.stringify(SRC)};
const stubs = {
  '@/lib/audioDecoder': 'export const deviceSampleRate = () => 48000;',
  '@/lib/audioLibrary': [
    'export const getClipSource = (id) => globalThis.__lib.sources.get(id) ?? null;',
    'export const clipPlayLength = (clip) => Math.max(0.05, clip.duration - (clip.trimStart ?? 0) - (clip.trimEnd ?? 0));',
  ].join('\\n'),
  '@/lib/wavReader': [
    'export const wavLayoutAtRate = async () => { globalThis.__lib.layoutCalls++; return { frames: 480000, channels: 2 }; };',
    'export const readWavRange = async (blob, rate, s, n) => {',
    '  globalThis.__lib.rangeCalls.push([s, n]);',
    '  if (globalThis.__lib.failNext) { globalThis.__lib.failNext = false; return null; }',
    '  const a = new Int16Array(n); a.fill(7); return [a, a];',
    '};',
  ].join('\\n'),
};
export async function resolve(spec, ctx, next) {
  if (stubs[spec]) return { shortCircuit: true, url: 'data:text/javascript,' + encodeURIComponent(stubs[spec]) };
  if (spec.startsWith('@/')) return next(SRC + spec.slice(2) + '.ts', ctx);
  return next(spec, ctx);
}
`));

const ready = await import('../src/lib/readyStore.ts');
const { openRangeReader, openRangeReaders } = await import('../src/lib/diskSource.ts');
const d = await ready.readyDir();
assert.equal(d, dir);

test('cópia pronta: os dois canais são pedidos ao disco juntos e saem iguais aos gravados', async () => {
  const left = Int16Array.from({ length: 5000 }, (_, i) => (i * 7) % 30000);
  const right = Int16Array.from({ length: 5000 }, (_, i) => -((i * 13) % 30000));
  await ready.writeEntry(dir, 'f_canais', 48000, [left, right], 5000, 5000);
  const r = await ready.openEntryRange(dir, 'f_canais');
  assert.ok(r);
  let release;
  dir.gate = new Promise((res) => { release = res; });
  dir.started = [];
  const pending = r.read(1000, 2500);
  await new Promise((res) => setTimeout(res, 5));
  assert.equal(dir.started.length, 2, 'as duas leituras saem antes de a primeira voltar');
  release();
  dir.gate = null;
  const [l, rr] = await pending;
  assert.deepEqual(Array.from(l), Array.from(left.subarray(1000, 3500)));
  assert.deepEqual(Array.from(rr), Array.from(right.subarray(1000, 3500)));
  // fim do arquivo e mono continuam iguais
  const tail = await r.read(4900, 500);
  assert.equal(tail[0].length, 100);
  await ready.writeEntry(dir, 'f_mono', 48000, [left], 5000, 5000);
  const mono = await (await ready.openEntryRange(dir, 'f_mono')).read(0, 10);
  assert.equal(mono.length, 1);
  assert.deepEqual(Array.from(mono[0]), Array.from(left.subarray(0, 10)));
});

test('metadado da cópia: grava, junta, só números, e some quando a cópia é regravada', async () => {
  const ch = [new Int16Array(100)];
  await ready.writeEntry(dir, 'r_meta', 48000, ch, 100, 100);
  assert.equal(await ready.readEntryMeta(dir, 'r_meta'), null);
  assert.equal(await ready.writeEntryMeta(dir, 'r_meta', { 'clip|0|0|1.050000|1.000000': 123 }), true);
  assert.equal(await ready.writeEntryMeta(dir, 'r_meta', { outro: -4.5, texto: 'não', nan: Number.NaN }), true);
  assert.deepEqual(await ready.readEntryMeta(dir, 'r_meta'), { 'clip|0|0|1.050000|1.000000': 123, outro: -4.5 });
  assert.equal(await ready.writeEntryMeta(dir, 'r_meta', { outro: 9 }), true);
  assert.equal((await ready.readEntryMeta(dir, 'r_meta')).outro, 9);
  // arquivo estragado não derruba
  dir.files.set(ready.metaName('r_estragado'), new TextEncoder().encode('{nada'));
  assert.equal(await ready.readEntryMeta(dir, 'r_estragado'), null);
  dir.files.delete(ready.metaName('r_estragado'));
  // cópia regravada: o metadado era da anterior
  await ready.writeEntry(dir, 'r_meta', 48000, ch, 100, 100);
  assert.equal(await ready.readEntryMeta(dir, 'r_meta'), null);
  assert.equal(dir.files.has(ready.metaName('r_meta')), false);
});

test('limpeza: metadado segue a cópia dona, órfão sai, e nenhum metadado entra na conta de uso', async () => {
  const ch = [new Int16Array(10)];
  await ready.writeEntry(dir, 'r_velho', 48000, ch, 10, 10);
  await ready.writeEntry(dir, 'r_vivo', 48000, ch, 10, 10);
  await ready.writeEntryMeta(dir, 'r_velho', { a: 1 });
  await ready.writeEntryMeta(dir, 'r_vivo', { a: 2 });
  dir.files.set(ready.metaName('r_sumiu'), new TextEncoder().encode('{"a":3}'));
  const old = Date.now() - 60 * 24 * 60 * 60 * 1000;
  store.set('vs-ready-seen-v2', JSON.stringify({ r_velho: old, r_vivo: old }));
  const g0 = ready.entryGeneration('r_velho');
  await ready.purgeStale(dir, new Set(['r_vivo']));
  assert.equal(dir.files.has('r_velho'), false, 'sem uso há 60 dias: sai');
  assert.equal(dir.files.has(ready.metaName('r_velho')), false, 'o metadado sai junto');
  assert.equal(dir.files.has('r_vivo'), true);
  assert.deepEqual(await ready.readEntryMeta(dir, 'r_vivo'), { a: 2 }, 'cópia em uso: o metadado fica');
  assert.equal(dir.files.has(ready.metaName('r_sumiu')), false, 'órfão sai');
  const seen = JSON.parse(store.get('vs-ready-seen-v2'));
  assert.ok(!Object.keys(seen).some((k) => k.endsWith('.meta')), 'metadado não vira cópia na conta de uso');
  assert.ok(ready.entryGeneration('r_velho') > g0, 'apagar muda a geração');
});

test('geração da cópia muda ao gravar e ao falhar a gravação', async () => {
  const g0 = ready.entryGeneration('f_gen');
  await ready.writeEntry(dir, 'f_gen', 48000, [new Int16Array(4)], 4, 4);
  const g1 = ready.entryGeneration('f_gen');
  assert.ok(g1 > g0);
  dir.failWrite = true;
  await assert.rejects(ready.writeEntry(dir, 'f_gen', 48000, [new Int16Array(4)], 4, 4));
  dir.failWrite = false;
  assert.ok(ready.entryGeneration('f_gen') > g1, 'gravação que falha apaga a cópia e muda a geração');
  assert.equal(dir.files.has('f_gen'), false);
  assert.equal(await ready.entryExists(dir, 'f_gen'), false);
  assert.equal(ready.entryGeneration('f_nunca'), 0);
});

// ---------- leitores guardados por clipe ----------
const clip = (over = {}) => ({ id: 'c1', songId: 's1', trackId: 't1', startTime: 0, duration: 10, ...over });

test('reabrir o mesmo clipe não consulta o disco; o corte vale na hora', async () => {
  const src = new Blob([new Uint8Array(1000)]);
  globalThis.__lib.sources.set('c1', src);
  const r1 = await openRangeReader(clip());
  assert.ok(r1);
  assert.equal(r1.length, 480000);
  const opens = dir.opens;
  const probes = globalThis.__lib.layoutCalls;
  const r2 = await openRangeReader(clip());
  assert.equal(dir.opens, opens, 'sem abrir arquivo de novo');
  assert.equal(globalThis.__lib.layoutCalls, probes, 'sem sondar o WAV de novo');
  assert.equal(r2.length, 480000);
  // corte novo: mesmo leitor guardado, janela nova
  const cut = await openRangeReader(clip({ trimStart: 1, duration: 10 }));
  assert.equal(cut.length, 480000 - 48000);
  globalThis.__lib.rangeCalls = [];
  await cut.read(0, 100);
  assert.deepEqual(globalThis.__lib.rangeCalls, [[48000, 100]], 'lê a partir do corte');
  // vários de uma vez
  const all = await openRangeReaders([clip()]);
  assert.equal(all.get('c1').length, 480000);
});

test('cópia pronta gravada depois, cópia apagada e arquivo de origem novo fazem abrir de novo', async () => {
  const src = globalThis.__lib.sources.get('c1');
  const name = ready.fullCopyName('s1', 'c1', src, 48000);
  // a cópia convertida fica pronta: a próxima abertura passa a ler dela
  const left = new Int16Array(480000).fill(3);
  await ready.writeEntry(dir, name, 48000, [left, left], 480000, 480000);
  const viaCopy = await openRangeReader(clip());
  globalThis.__lib.rangeCalls = [];
  const got = await viaCopy.read(10, 5);
  assert.deepEqual(Array.from(got[0]), [3, 3, 3, 3, 3]);
  assert.equal(globalThis.__lib.rangeCalls.length, 0, 'leu da cópia, não do WAV');
  // e fica guardada
  const opens = dir.opens;
  await openRangeReader(clip());
  assert.equal(dir.opens, opens);
  // a limpeza apaga a cópia: volta para o WAV
  store.set('vs-ready-seen-v2', JSON.stringify({ [name]: Date.now() - 60 * 24 * 60 * 60 * 1000 }));
  await ready.purgeStale(dir, new Set());
  assert.equal(dir.files.has(name), false);
  const back = await openRangeReader(clip());
  globalThis.__lib.rangeCalls = [];
  const w = await back.read(0, 4);
  assert.deepEqual(Array.from(w[0]), [7, 7, 7, 7]);
  assert.equal(globalThis.__lib.rangeCalls.length, 1, 'lê do WAV de novo');
  // arquivo de origem trocado (stem refeito): outro leitor
  const probes = globalThis.__lib.layoutCalls;
  globalThis.__lib.sources.set('c1', new Blob([new Uint8Array(1000)]));
  await openRangeReader(clip());
  assert.equal(globalThis.__lib.layoutCalls, probes + 1);
});

test('leitura que falha tira o leitor guardado; clipe sem fonte continua null', async () => {
  const first = await openRangeReader(clip());
  const probes = globalThis.__lib.layoutCalls;
  globalThis.__lib.failNext = true;
  await assert.rejects(first.read(0, 10));
  await openRangeReader(clip());
  assert.equal(globalThis.__lib.layoutCalls, probes + 1, 'abriu de novo depois da falha');
  assert.equal(await openRangeReader(clip({ id: 'sem-fonte' })), null);
});
