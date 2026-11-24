// Lote 5, passo 1: o texto do manifest é montado por partes e o texto dos picos de cada clipe é
// guardado. O arquivo tem de sair byte a byte igual ao JSON.stringify de antes (senão a comparação
// "nada mudou" do ⌘S deixa de valer e o projeto pode abrir diferente).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire, register } from 'node:module';

const require = createRequire(import.meta.url);
const pf = require('../desktop/projectFiles.js');

// A biblioteca de áudio vira módulo de mentira; o resto é o código real.
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
const hooks = await import('../src/lib/projectHooks.ts');

// O jeito de antes, tirado do código antigo: buildManifestBase + nome + caminhos + índice.
function legacyJson(state, projectName, assets, index) {
  const m = saver.buildManifestBase(state);
  m.projectName = projectName;
  const pathById = new Map(assets.map((a) => [a.clip.id, a.relPath]));
  m.clips = m.clips.map((c) => {
    const relPath = pathById.get(c.id);
    return relPath ? { ...c, filePath: relPath } : c;
  });
  if (index) m.assets = index;
  return JSON.stringify(m);
}

// Gerador fixo (o mesmo a cada rodada).
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NAMES = ['Baixo', 'Click', 'Voz "guia"', 'Teclado $& $1 $\' $`', 'Guitarra\\Violão', 'Música/Nova', 'linha\nnova', '"waveformPeaks":"x"', '"clips":[]', 'Ação 🎸', '\u0000\u001f'];

function randomPeaks(r) {
  const kind = Math.floor(r() * 6);
  const n = Math.floor(r() * 400);
  if (kind === 0) return [];
  if (kind === 1) return Array.from({ length: n }, () => Math.round(r() * 10_000) / 10_000); // já com 4 casas
  if (kind === 2) return Array.from({ length: n }, () => Math.fround(r())); // precisão inteira
  if (kind === 3) return Array.from({ length: n }, (_, i) => (i % 7 === 0 ? NaN : i % 11 === 0 ? null : -r()));
  if (kind === 4) return Float32Array.from({ length: n }, () => r()); // não é array: vai como objeto
  return undefined;
}

function randomState(r) {
  const tracks = Array.from({ length: 1 + Math.floor(r() * 5) }, (_, i) => ({ id: `t${i}`, name: NAMES[Math.floor(r() * NAMES.length)], volume: r() }));
  const songs = Array.from({ length: 1 + Math.floor(r() * 3) }, (_, i) => ({
    id: `s${i}`, name: NAMES[Math.floor(r() * NAMES.length)], bpm: 60 + Math.floor(r() * 100),
    regions: r() < 0.5 ? [{ id: `r${i}`, start: 0, end: 4, loop: r() < 0.5 }] : undefined,
  }));
  const clips = Array.from({ length: Math.floor(r() * 12) }, (_, i) => {
    const c = {};
    // ordem das chaves variada: o texto depende dela
    const keys = ['id', 'songId', 'trackId', 'startTime', 'duration', 'fileName', 'filePath', 'waveformPeaks', 'gain', 'mute', 'name'];
    for (let k = keys.length - 1; k > 0; k--) { const j = Math.floor(r() * (k + 1)); [keys[k], keys[j]] = [keys[j], keys[k]]; }
    for (const k of keys) {
      if (k === 'id') c.id = `c${i}`;
      else if (k === 'songId') c.songId = songs[Math.floor(r() * songs.length)].id;
      else if (k === 'trackId') c.trackId = tracks[Math.floor(r() * tracks.length)].id;
      else if (k === 'startTime') c.startTime = Math.round(r() * 1000) / 10;
      else if (k === 'duration') c.duration = r() * 300;
      else if (k === 'fileName') c.fileName = `${NAMES[Math.floor(r() * NAMES.length)]}.wav`;
      else if (k === 'filePath') { if (r() < 0.8) c.filePath = r() < 0.5 ? `blob:vsstage://app/${i}` : `Músicas/x/${i}.wav`; }
      else if (k === 'waveformPeaks') { const p = randomPeaks(r); if (p !== undefined) c.waveformPeaks = p; }
      else if (k === 'gain') c.gain = r() < 0.3 ? undefined : r();
      else if (k === 'mute') c.mute = r() < 0.5;
      else if (k === 'name') c.name = NAMES[Math.floor(r() * NAMES.length)];
    }
    return c;
  });
  return {
    projectName: NAMES[Math.floor(r() * NAMES.length)],
    tracks, songs, clips,
    blocks: [], playlist: songs.map((s, i) => ({ id: `p${i}`, songId: s.id })), shows: [], activeShowId: null, defaultPlaylist: null,
    timelineOrder: songs.map((s) => s.id),
    mixerVisible: true, playlistVisible: r() < 0.5, playlistMaximized: false, timelineVisible: true,
    mixerHeight: 200, zoomH: 50, zoomV: 1, lrMasterActive: false,
    lyricMaps: { s0: [{ id: 'a', time: 1, text: NAMES[Math.floor(r() * NAMES.length)] }] }, lyricStyle: null, musicianBook: null,
    songLoudness: r() < 0.5 ? undefined : { s0: { lufs: -14 } },
  };
}

function randomAssets(r, state) {
  const assets = [];
  for (const c of state.clips) if (r() < 0.7) assets.push({ clip: { id: c.id }, relPath: `Músicas/${NAMES[Math.floor(r() * NAMES.length)]}/${c.id}.wav` });
  if (r() < 0.3) assets.push({ clip: { id: 'pad:1' }, relPath: 'Pads/Banco A/1 - Som.wav' });
  return assets;
}

test('o manifest montado por partes é o mesmo texto, byte a byte, do JSON.stringify de antes', () => {
  const r = rng(20261124);
  for (let round = 0; round < 400; round++) {
    const state = randomState(r);
    const assets = randomAssets(r, state);
    const index = r() < 0.8 ? assets.map((a, i) => ({ clipId: a.clip.id, path: a.relPath, offset: i * 1000, size: 1000 })) : undefined;
    const name = NAMES[Math.floor(r() * NAMES.length)];
    const want = legacyJson(state, name, assets, index);
    assert.equal(saver.manifestJson(state, name, assets, index), want, `rodada ${round}`);
    // de novo, já com os textos dos picos guardados
    assert.equal(saver.manifestJson(state, name, assets, index), want, `rodada ${round}, segunda vez`);
  }
});

test('campos dos pads (fora do estado principal) entram no mesmo lugar de antes', () => {
  hooks.registerProjectExtras({
    manifest: () => ({ samplePads: { banks: [{ name: 'A "um"', pads: [1, 2] }] } }),
    assets: () => [], folderAssets: () => [], loaded: () => {}, rebind: () => {},
  });
  const r = rng(7);
  for (let round = 0; round < 50; round++) {
    const state = randomState(r);
    const assets = randomAssets(r, state);
    const index = assets.map((a, i) => ({ clipId: a.clip.id, path: a.relPath, offset: i, size: 1 }));
    assert.equal(saver.manifestJson(state, 'Show', assets, index), legacyJson(state, 'Show', assets, index));
  }
});

// Conta os textos de picos feitos (JSON.stringify de arrays grandes de números).
function countPeakStringify(fn) {
  const real = JSON.stringify;
  let n = 0;
  JSON.stringify = function (value, ...rest) {
    if (Array.isArray(value) && value.length >= 1000 && typeof value[0] === 'number') n++;
    return real.call(JSON, value, ...rest);
  };
  try {
    fn();
  } finally {
    JSON.stringify = real;
  }
  return n;
}

const peaksOf = (n, seed) => Array.from({ length: n }, (_, i) => Math.fround(Math.abs(Math.sin(i * 0.11 + seed)) * 0.8));

test('⌘S seguinte: o texto dos picos não é refeito, nem quando o clipe muda (Desfazer, arraste)', () => {
  const state = randomState(rng(3));
  state.clips = Array.from({ length: 6 }, (_, i) => ({ id: `k${i}`, songId: 's0', trackId: 't0', startTime: i, duration: 10, fileName: 'a.wav', filePath: `blob:x/${i}`, waveformPeaks: peaksOf(3000, i) }));
  const assets = state.clips.map((c) => ({ clip: { id: c.id }, relPath: `Músicas/${c.id}.wav` }));
  const first = countPeakStringify(() => saver.manifestJson(state, 'Show', assets, []));
  assert.equal(first, 6, 'na primeira vez, um texto por clipe');
  const again = countPeakStringify(() => saver.manifestJson(state, 'Show', assets, []));
  assert.equal(again, 0, 'nada refeito no salvar seguinte');
  // clipe arrastado: objeto novo com os mesmos picos (é assim que a store muda um clipe)
  const moved = { ...state, clips: state.clips.map((c, i) => (i === 2 ? { ...c, startTime: 99 } : c)) };
  let json;
  const afterMove = countPeakStringify(() => { json = saver.manifestJson(moved, 'Show', assets, []); });
  assert.equal(afterMove, 0, 'o texto dos picos é do array, não do clipe');
  assert.equal(json, legacyJson(moved, 'Show', assets, []));
  assert.match(json, /"id":"k2","songId":"s0","trackId":"t0","startTime":99,/);
  // picos trocados (onda refeita): texto novo só desse clipe
  const repeaked = { ...moved, clips: moved.clips.map((c, i) => (i === 4 ? { ...c, waveformPeaks: peaksOf(3000, 40) } : c)) };
  const afterPeaks = countPeakStringify(() => { json = saver.manifestJson(repeaked, 'Show', assets, []); });
  assert.equal(afterPeaks, 1);
  assert.equal(json, legacyJson(repeaked, 'Show', assets, []));
});

// ---------- pelo caminho de verdade do ⌘S no Mac (arquivo e app de verdade) ----------

const MAGIC = 'VSSTAGE1';
const audio = (n, seed) => Buffer.from(Uint8Array.from({ length: n }, (_, i) => (i * 7 + seed) % 251));

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

async function manifestOnDisk(file) {
  const info = await pf.info(file);
  const buf = fs.readFileSync(file);
  return buf.subarray(info.manifestStart, info.manifestStart + info.manifestLen).toString('utf8');
}

test('salvar inteiro, salvar só o fim e "nada mudou" no Mac: o manifest do disco é o de antes', async () => {
  fakeDesktop();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vs-manifesto-memo-'));
  const file = path.join(dir, 'Show.vss');
  const a1 = audio(50_000, 1);
  const a2 = audio(30_000, 2);
  globalThis.__lib.sources = new Map([['c1', new Blob([a1])], ['c2', new Blob([a2])]]);
  const clips = [
    { id: 'c1', songId: 's1', trackId: 't1', startTime: 0, duration: 10, fileName: 'click.wav', filePath: 'blob:vsstage://app/1', waveformPeaks: peaksOf(5000, 1) },
    { id: 'c2', songId: 's1', trackId: 't2', startTime: 0, duration: 10, fileName: 'baixo.wav', filePath: 'blob:vsstage://app/2', waveformPeaks: peaksOf(5000, 2) },
  ];
  const state = baseState({ clips });
  // grava inteiro (como o "Salvar Projeto..." escolhendo o caminho)
  const target = { kind: 'path', path: file, name: 'Show.vss' };
  globalThis.window.vsDesktop.projectPickSave = async () => ({ path: file, name: 'Show.vss' });
  const first = await saver.saveProjectAsPackage(state, 'Show', () => {});
  assert.equal(first.missingCount, 0);
  const assets1 = [
    { clip: { id: 'c1' }, relPath: 'Músicas/Música 1/01 - Click.wav' },
    { clip: { id: 'c2' }, relPath: 'Músicas/Música 1/02 - Baixo.wav' },
  ];
  const index1 = [
    { clipId: 'c1', path: assets1[0].relPath, offset: 0, size: a1.length },
    { clipId: 'c2', path: assets1[1].relPath, offset: a1.length, size: a2.length },
  ];
  assert.equal(await manifestOnDisk(file), legacyJson(state, 'Show', assets1, index1), 'salvar inteiro: mesmo texto de antes');

  // ⌘S sem mudança nenhuma: nada gravado
  const same = await saver.quickSave(state, target, () => {});
  assert.equal(same.unchanged, true);

  // ⌘S com a letra nova: troca só o fim, mesmo texto de antes
  const state2 = { ...state, lyricMaps: { s1: [{ id: 'a', time: 1, text: 'Letra nova' }] } };
  const res = await saver.quickSave(state2, target, () => {});
  assert.equal(res.unchanged, undefined);
  assert.equal(await manifestOnDisk(file), legacyJson(state2, 'Show', assets1, index1), 'salvar só o fim: mesmo texto de antes');
  assert.equal((await saver.quickSave(state2, target, () => {})).unchanged, true, 'e o seguinte, sem mudança, não grava');

  // e o projeto abre igual
  const loaded = await saver.openProjectFromPath('Show.vss', file, () => {});
  assert.equal(loaded.manifest.lyricMaps.s1[0].text, 'Letra nova');
  assert.deepEqual(Buffer.from(await loaded.sources.get('c1').arrayBuffer()), a1);
  assert.deepEqual(Buffer.from(await loaded.sources.get('c2').arrayBuffer()), a2);
  assert.equal(loaded.manifest.clips[0].filePath, assets1[0].relPath);
});
