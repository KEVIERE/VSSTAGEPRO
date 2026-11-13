// Salvar o projeto sem travar a tela nem atrapalhar o disco do show:
// - picos da onda com 4 casas no arquivo (o manifest fica umas 3 vezes menor e o desenho igual);
// - depois de salvar no Mac, os áudios passam a ser os pedaços do arquivo novo pelo índice que
//   acabou de ser gravado, sem reler e analisar o projeto inteiro;
// - o app do Mac não relê o manifest antigo quando foi ele mesmo que o gravou;
// - o backup automático acha os antigos pelas chaves, sem abrir os backups de todos os projetos;
// - o salvar automático do produtor espera a música parar.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire, register } from 'node:module';
import { createCoalescedSave } from '../src/lib/coalesceSave.ts';

const require = createRequire(import.meta.url);
const pf = require('../desktop/projectFiles.js');

// A biblioteca de áudio e o estado do programa viram módulos de mentira; o resto é o código real.
globalThis.__lib = { sources: new Map(), registered: [] };
const SRC = new URL('../src/', import.meta.url).href;
register('data:text/javascript,' + encodeURIComponent(`
const SRC = ${JSON.stringify(SRC)};
const stubs = {
  '@/lib/audioLibrary': [
    'export const ensureSongLoaded = async () => {};',
    'export const getClipAudio = () => null;',
    'export const putClipAudio = () => {};',
    'export const getClipSource = (id) => globalThis.__lib.sources.get(id) ?? null;',
    'export const registerClipSource = (id, songId, src) => { globalThis.__lib.registered.push([id, src]); globalThis.__lib.sources.set(id, src); };',
  ].join('\\n'),
  '@/store': 'export const useStore = { getState: () => globalThis.__store };',
};
export async function resolve(spec, ctx, next) {
  if (stubs[spec]) return { shortCircuit: true, url: 'data:text/javascript,' + encodeURIComponent(stubs[spec]) };
  if (spec.startsWith('@/')) return next(SRC + spec.slice(2) + '.ts', ctx);
  return next(spec, ctx);
}
`));

const saver = await import('../src/lib/projectSaver.ts');
const backups = await import('../src/lib/projectBackups.ts');

const read = (...p) => fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), '..', ...p), 'utf8');

// ---------- picos da onda ----------

test('picos com 4 casas: menor no arquivo, mesmo desenho, e sem cópia do que já está assim', () => {
  const full = Array.from({ length: 3000 }, (_, i) => Math.fround(Math.abs(Math.sin(i * 0.37)) * 0.9 + 1e-7));
  const compact = saver.compactPeaks(full);
  assert.notEqual(compact, full, 'os picos do programa não são mexidos');
  assert.equal(compact.length, full.length);
  for (let i = 0; i < full.length; i++) {
    assert.ok(Math.abs(compact[i] - full[i]) <= 0.00005 + 1e-12, 'diferença menor que meio décimo de milésimo');
    assert.ok(String(compact[i]).length <= 6, 'no máximo 6 caracteres por número');
  }
  assert.ok(JSON.stringify(compact).length * 2.5 < JSON.stringify(full).length, 'o texto fica bem menor');
  assert.equal(saver.compactPeaks(full), compact, 'a cópia é feita uma vez só');
  assert.equal(saver.compactPeaks(compact), compact, 'o que já tem 4 casas volta o mesmo');
  const already = [0, 0.5, 0.1234, 1];
  assert.equal(saver.compactPeaks(already), already, 'sem cópia quando já está com 4 casas');
  assert.deepEqual(saver.compactPeaks([NaN, null, 0.00004]), [0, 0, 0], 'valor estranho ou abaixo do que aparece vira zero');
  assert.deepEqual(saver.compactPeaks([]), []);
});

function baseState(extra = {}) {
  return {
    projectName: 'Show',
    tracks: [{ id: 't1', name: 'Click' }, { id: 't2', name: 'Baixo' }],
    songs: [{ id: 's1', name: 'Música 1' }],
    clips: [],
    blocks: [], playlist: [], shows: [], activeShowId: null, defaultPlaylist: null, timelineOrder: [],
    mixerVisible: true, playlistVisible: true, playlistMaximized: false, timelineVisible: true,
    mixerHeight: 200, zoomH: 50, zoomV: 1, lrMasterActive: false,
    lyricMaps: {}, lyricStyle: null, musicianBook: null,
    ...extra,
  };
}

test('o manifest leva os picos com 4 casas e o estado do programa fica como estava', () => {
  const peaks = [0.123456789, 0.987654321];
  const state = baseState({ clips: [{ id: 'c1', songId: 's1', trackId: 't1', startTime: 0, duration: 1, fileName: 'a.wav', waveformPeaks: peaks }, { id: 'c2', songId: 's1', trackId: 't2', startTime: 0, duration: 1, fileName: 'b.wav' }] });
  const m = saver.buildManifestBase(state);
  assert.deepEqual(m.clips[0].waveformPeaks, [0.1235, 0.9877]);
  assert.deepEqual(peaks, [0.123456789, 0.987654321], 'os picos do programa não mudam');
  assert.equal('waveformPeaks' in m.clips[1], false, 'clipe sem picos continua sem');
  // pasta de projeto: sem recuo (com os picos um por linha, o recuo quase dobrava o arquivo)
  assert.doesNotMatch(read('src', 'lib', 'projectSaver.ts'), /JSON\.stringify\(manifest, null, 2\)/);
});

// ---------- salvar no app do Mac (arquivo de verdade, app de verdade) ----------

const MAGIC = 'VSSTAGE1';
const audio = (n, seed) => Buffer.from(Uint8Array.from({ length: n }, (_, i) => (i * 7 + seed) % 251));
const fullPeaks = (n, seed) => Array.from({ length: n }, (_, i) => Math.fround(Math.abs(Math.sin(i * 0.11 + seed)) * 0.8));

function makeProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vs-salvar-disco-'));
  const file = path.join(dir, 'Show.vss');
  const audios = [['c1', audio(120_000, 1)], ['c2', audio(80_000, 2)]];
  const assets = [];
  let offset = 0;
  for (const [clipId, bytes] of audios) {
    assets.push({ clipId, path: `Músicas/${clipId}.wav`, offset, size: bytes.length });
    offset += bytes.length;
  }
  const clips = [
    { id: 'c1', songId: 's1', trackId: 't1', startTime: 0, duration: 10, fileName: 'click.wav', waveformPeaks: fullPeaks(4000, 1) },
    { id: 'c2', songId: 's1', trackId: 't2', startTime: 0, duration: 10, fileName: 'baixo.wav', waveformPeaks: fullPeaks(4000, 2) },
  ];
  const st = baseState();
  const manifest = Buffer.from(JSON.stringify({ version: 3, projectName: 'Show', tracks: st.tracks, songs: st.songs, clips, assets }));
  fs.writeFileSync(file, Buffer.concat([Buffer.from(MAGIC), ...audios.map(([, b]) => b), manifest, pf.trailer(MAGIC.length + offset, manifest.length)]));
  return { file, audios, oldManifestLen: manifest.length };
}

// O app entrega o arquivo do disco num campo de arquivo; aqui o campo é de mentira.
function fakeDesktop() {
  const elements = new Map();
  globalThis.document = {
    createElement: () => { const el = { style: {}, id: '', files: null, remove() { elements.delete(el.id); } }; return el; },
    body: { appendChild: (el) => { elements.set(el.id, el); } },
  };
  globalThis.window = {
    vsDesktop: {
      projectGiveFile: async (filePath, selector) => {
        const el = elements.get(selector.slice(1));
        el.files = [new File([fs.readFileSync(filePath)], path.basename(filePath), { lastModified: fs.statSync(filePath).mtimeMs })];
        return true;
      },
      projectInfo: (p) => pf.info(p),
      projectWriteTail: (p, o) => pf.writeTail(p, o),
      projectWriteOpen: (p) => pf.writeOpen(p),
      projectWriteData: (id, d) => pf.writeData(id, d),
      projectWriteCopy: (id, s, b, n) => pf.writeCopy(id, s, b, n),
      projectWriteClose: (id) => pf.writeClose(id),
      projectWriteAbort: (id) => pf.writeAbort(id),
      projectAppendOpen: (p, o) => pf.appendOpen(p, o),
      projectAppendData: (id, d) => pf.appendData(id, d),
      projectAppendCopy: (id, s, b, n) => pf.appendCopy(id, s, b, n),
      projectAppendClose: (id, m) => pf.appendClose(id, m),
      projectAppendAbort: (id) => pf.appendAbort(id),
    },
  };
}

// Conta as análises de texto grande (o manifest) feitas no programa e no app durante um salvar.
async function countingParses(fn) {
  const realParse = JSON.parse;
  let n = 0;
  JSON.parse = function (text, reviver) {
    if (typeof text === 'string' && text.length > 2000) n++;
    return realParse.call(JSON, text, reviver);
  };
  try {
    await fn();
  } finally {
    JSON.parse = realParse;
  }
  return n;
}

test('salvar só a letra no Mac: os áudios passam a ser os pedaços do arquivo novo sem reler o projeto, e o app não relê o manifest que ele mesmo gravou', async () => {
  fakeDesktop();
  const p = makeProject();
  const loaded = await saver.openProjectFromPath('Show.vss', p.file, () => {});
  assert.equal(loaded.target.kind, 'path');
  assert.ok(loaded.manifest.clips[0].waveformPeaks.every((v) => String(v).length <= 6), 'ao abrir, os picos já ficam com 4 casas');
  globalThis.__lib.sources = new Map(loaded.sources);
  globalThis.__lib.registered = [];
  const state = baseState({ clips: loaded.manifest.clips, lyricMaps: { s1: [{ id: 'a', time: 1, text: 'Primeira letra' }] } });

  // 1º salvar: o app ainda não conhece o manifest antigo (abriu, não gravou) e lê ele uma vez
  let res;
  const first = await countingParses(async () => { res = await saver.quickSave(state, loaded.target, () => {}); });
  assert.equal(res.missingCount, 0);
  assert.equal(res.unchanged, undefined);
  assert.equal(first, 2, 'manifest novo e antigo no app; nenhuma releitura no programa');

  // os pedaços novos são do arquivo como ele está agora e têm o áudio certo
  const size = fs.statSync(p.file).size;
  assert.deepEqual(globalThis.__lib.registered.map(([id]) => id).sort(), ['c1', 'c2']);
  for (const [id, slice] of globalThis.__lib.registered) {
    const original = p.audios.find(([c]) => c === id)[1];
    assert.deepEqual(Buffer.from(await slice.arrayBuffer()), original, `áudio ${id} certo no pedaço novo`);
  }
  const info1 = await pf.info(p.file);
  assert.equal(info1.size, size);

  // 2º salvar: o app usa o que ele mesmo gravou (só analisa o manifest novo)
  globalThis.__lib.registered = [];
  const state2 = { ...state, lyricMaps: { s1: [{ id: 'a', time: 1, text: 'Letra nova do produtor' }] } };
  const second = await countingParses(async () => { res = await saver.quickSave(state2, loaded.target, () => {}); });
  assert.equal(res.unchanged, undefined, 'gravou só o fim de novo');
  assert.equal(second, 1, 'só o manifest novo é analisado');

  // 3º salvar sem mudança: nada é gravado nem analisado
  const third = await countingParses(async () => { res = await saver.quickSave(state2, loaded.target, () => {}); });
  assert.equal(res.unchanged, true);
  assert.equal(third, 0);

  // o arquivo abre com a letra nova, os áudios inteiros e os picos com 4 casas
  const again = await saver.openProjectFromPath('Show.vss', p.file, () => {});
  assert.equal(again.manifest.lyricMaps.s1[0].text, 'Letra nova do produtor');
  for (const [id, bytes] of p.audios) assert.deepEqual(Buffer.from(await again.sources.get(id).arrayBuffer()), bytes);
  const tail = (await pf.info(p.file));
  assert.ok(tail.manifestLen * 2 < p.oldManifestLen, 'o manifest com os picos de 4 casas ficou bem menor');
});

test('arquivo mexido por fora depois do salvar: o app não confia no que lembrava e confere o manifest do disco', async () => {
  fakeDesktop();
  const p = makeProject();
  const loaded = await saver.openProjectFromPath('Show.vss', p.file, () => {});
  globalThis.__lib.sources = new Map(loaded.sources);
  const state = baseState({ clips: loaded.manifest.clips, lyricMaps: { s1: [{ id: 'a', time: 1, text: 'Uma' }] } });
  await saver.quickSave(state, loaded.target, () => {});
  // alguém troca a data do arquivo (outro programa): o que o app lembrava não vale mais
  const later = new Date(Date.now() + 5000);
  fs.utimesSync(p.file, later, later);
  const info = await pf.info(p.file);
  const bytes = Buffer.from(JSON.stringify({ projectName: 'Show', assets: [] }));
  const parses = await countingParses(async () => {
    const r = await pf.writeTail(p.file, { expectedSize: info.size, expectedManifestStart: info.manifestStart, manifest: bytes });
    assert.equal(r.ok, true);
  });
  assert.equal(parses, 1, 'releu o manifest do disco (o novo é pequeno e não entra na conta)');
});

// ---------- backup automático ----------

// IndexedDB de mentira, só com o que o backup usa. Conta quantos backups foram abertos.
function fakeIndexedDB() {
  const dbs = new Map();
  const calls = { get: 0, getAll: 0 };
  const later = (fn) => setImmediate(fn);
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  function storeApi(meta, tx) {
    const req = (fn) => {
      const r = { result: undefined, error: null, onsuccess: null, onerror: null };
      tx.pending++;
      later(() => {
        r.result = fn();
        r.onsuccess?.({ target: r });
        tx.settle();
      });
      return r;
    };
    return {
      indexNames: { contains: (n) => meta.indexes.has(n) },
      get: (id) => { calls.get++; return req(() => structuredClone(meta.records.get(id))); },
      getAll: () => { calls.getAll++; return req(() => [...meta.records.keys()].sort(cmp).map((k) => structuredClone(meta.records.get(k)))); },
      put: (v) => { const c = structuredClone(v); return req(() => { meta.records.set(c[meta.keyPath], c); return c[meta.keyPath]; }); },
      delete: (id) => req(() => { meta.records.delete(id); }),
      index: (name) => ({
        openKeyCursor: () => {
          const keyPath = meta.indexes.get(name);
          const rows = [...meta.records.entries()]
            .filter(([, v]) => typeof v[keyPath] === 'string' || typeof v[keyPath] === 'number')
            .map(([pk, v]) => ({ key: v[keyPath], primaryKey: pk }))
            .sort((a, b) => cmp(a.key, b.key) || cmp(a.primaryKey, b.primaryKey));
          const r = { result: undefined, error: null, onsuccess: null, onerror: null };
          let i = 0;
          const step = () => {
            tx.pending++;
            later(() => {
              const row = rows[i++];
              r.result = row ? { key: row.key, primaryKey: row.primaryKey, continue: step } : null;
              r.onsuccess?.({ target: r });
              tx.settle();
            });
          };
          step();
          return r;
        },
      }),
    };
  }
  const indexedDB = {
    open(name, version) {
      const r = { result: undefined, error: null, onsuccess: null, onerror: null, onupgradeneeded: null };
      later(() => {
        let db = dbs.get(name);
        const upgrade = !db || db.version < version;
        if (!db) { db = { version, stores: new Map() }; dbs.set(name, db); }
        db.version = Math.max(db.version, version);
        r.result = {
          objectStoreNames: { contains: (n) => db.stores.has(n) },
          createObjectStore: (n, { keyPath }) => {
            const meta = { keyPath, records: new Map(), indexes: new Map() };
            db.stores.set(n, meta);
            return { createIndex: (iname, kp) => { meta.indexes.set(iname, kp); } };
          },
          transaction: (n) => {
            const meta = db.stores.get(n);
            const tx = {
              pending: 0, done: false, oncomplete: null, onerror: null, onabort: null,
              settle() { tx.pending--; if (tx.pending === 0) later(() => { if (!tx.done && tx.pending === 0) { tx.done = true; tx.oncomplete?.(); } }); },
              abort() { tx.done = true; later(() => tx.onabort?.()); },
              objectStore: () => storeApi(meta, tx),
            };
            later(() => { if (!tx.done && tx.pending === 0) { tx.done = true; tx.oncomplete?.(); } });
            return tx;
          },
          close() {},
        };
        if (upgrade) r.onupgradeneeded?.();
        r.onsuccess?.();
      });
      return r;
    },
  };
  return { indexedDB, calls, dbs };
}

function seedBackups(fake, list) {
  const db = { version: 2, stores: new Map() };
  fake.dbs.set('vs-stage', db);
  db.stores.set('recentProjects', { keyPath: 'id', records: new Map(), indexes: new Map() });
  const meta = { keyPath: 'id', records: new Map(), indexes: new Map([['projectName', 'projectName'], ['timestamp', 'timestamp']]) };
  db.stores.set('projectBackups', meta);
  for (const b of list) meta.records.set(b.id, b);
  return meta;
}

const heavy = 'x'.repeat(50_000);
const oldBackup = (projectName, timestamp) => ({
  id: `bkp-${timestamp}-${projectName}`, projectName, timestamp, label: '', songCount: 0, trackCount: 0,
  manifest: { clips: [{ id: 'c', waveformPeaks: heavy }] },
});

test('backup do ⌘S: fica com os 10 mais novos do projeto sem abrir nenhum backup', async () => {
  const fake = fakeIndexedDB();
  globalThis.indexedDB = fake.indexedDB;
  const list = [];
  for (let t = 1; t <= 12; t++) list.push(oldBackup(t % 3 === 0 ? 'show' : 'Show', t));
  for (let t = 1; t <= 5; t++) list.push(oldBackup('Outro projeto', 100 + t));
  const meta = seedBackups(fake, list);

  const saved = await backups.saveProjectBackup(baseState());
  assert.ok(saved, 'gravou');
  assert.equal(fake.calls.get + fake.calls.getAll, 0, 'nenhum backup aberto para saber quais apagar');
  const show = [...meta.records.values()].filter((b) => b.projectName.toLowerCase() === 'show');
  assert.equal(show.length, 10, '10 por projeto (maiúscula não faz diferença, como antes)');
  assert.ok(show.some((b) => b.id === saved.id), 'o novo está lá');
  assert.deepEqual(show.filter((b) => b.id !== saved.id).map((b) => b.timestamp).sort((a, b) => a - b), [4, 5, 6, 7, 8, 9, 10, 11, 12], 'saíram os mais antigos');
  assert.equal([...meta.records.values()].filter((b) => b.projectName === 'Outro projeto').length, 5, 'os outros projetos ficam como estavam');
  assert.deepEqual(saved.manifest.clips, [], 'backup sem os picos');
});

test('lista de backups: abre só os 10 mais novos do projeto, do mais novo para o mais antigo', async () => {
  const fake = fakeIndexedDB();
  globalThis.indexedDB = fake.indexedDB;
  const list = [];
  for (let t = 1; t <= 14; t++) list.push(oldBackup('Show', t));
  for (let t = 1; t <= 6; t++) list.push(oldBackup('Outro', 50 + t));
  seedBackups(fake, list);
  const got = await backups.listProjectBackups('SHOW');
  assert.deepEqual(got.map((b) => b.timestamp), [14, 13, 12, 11, 10, 9, 8, 7, 6, 5]);
  assert.equal(fake.calls.getAll, 0);
  assert.equal(fake.calls.get, 10, 'só os 10 da lista foram abertos');
  const all = await backups.listProjectBackups();
  assert.equal(all.length, 10, 'sem nome: os 10 mais novos de todos');
  assert.equal(all[0].timestamp, 56);
});

// ---------- salvar automático do produtor ----------

test('salvar do produtor com a música tocando: espera ela parar para gravar o arquivo', async () => {
  const app = read('src', 'App.tsx');
  assert.match(app, /busy: \(\) => \{\s*const s = useStore\.getState\(\);\s*return s\.saveStatus\?\.kind === 'saving' \|\| s\.transport\.isPlaying;\s*\}/);
  let now = 0;
  const timers = new Map();
  let seq = 0;
  const advance = async (ms) => {
    const end = now + ms;
    for (;;) {
      const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > end) break;
      timers.delete(next[0]);
      now = next[1].at;
      next[1].fn();
      await new Promise((r) => setImmediate(r));
    }
    now = end;
  };
  const st = { saveStatus: null, transport: { isPlaying: true } };
  let runs = 0;
  const s = createCoalescedSave({
    delayMs: 3000,
    busy: () => st.saveStatus?.kind === 'saving' || st.transport.isPlaying,
    run: async () => { runs++; return true; },
    onDone: () => {},
    retryMs: 1000,
    setTimer: (fn, ms) => { const id = ++seq; timers.set(id, { at: now + ms, fn }); return id; },
    clearTimer: (id) => timers.delete(id),
  });
  s.request();
  await advance(60_000);
  assert.equal(runs, 0, 'com a música no ar, não grava');
  st.transport.isPlaying = false;
  await advance(1000);
  assert.equal(runs, 1, 'parou: grava uma vez');
});
