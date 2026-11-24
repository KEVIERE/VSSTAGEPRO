// Lote 10: IA de tom e "volume igual" não rodam com a música tocando (antes bastava passar 5 s do
// Play). Passam pelo portão de fundo; a medida do volume para no próximo clipe se o Play vier no
// meio e é refeita depois, sem virar "falha".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { register } from 'node:module';

const real = (name) => new URL(`../src/lib/${name}.ts`, import.meta.url).href;
register('data:text/javascript,' + encodeURIComponent(`
const stubs = {
  '@/store': \`
    const listeners = new Set();
    const g = globalThis;
    export const useStore = {
      getState: () => g.__state,
      setState: (patch) => {
        const prev = g.__state;
        g.__state = { ...prev, ...(typeof patch === 'function' ? patch(prev) : patch) };
        listeners.forEach((l) => l(g.__state, prev));
      },
      subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    };\`,
  '@/lib/audioEngine': 'export const audioEngine = { isRunning: () => !!globalThis.__engine.running, isSettling: () => !!globalThis.__engine.settling };',
  '@/lib/audioLibrary': 'const ls = new Set(); export const onAudioLibraryCleared = (fn) => { ls.add(fn); return () => ls.delete(fn); }; export const clearAudioLibrary = () => ls.forEach((f) => f());',
  '@/lib/bounceEngine': 'export const detectSongKey = (...a) => globalThis.__detect(...a); export const measureSongLoudness = (...a) => globalThis.__measure(...a);',
  '@/lib/songLevel': "export const loudnessSignature = (id) => 'sig-' + id; export const validLoudness = (st, id) => st.songLoudness?.[id]?.sig === 'sig-' + id;",
};
const reals = { '@/lib/yieldToUi': ${JSON.stringify(real('yieldToUi'))}, '@/lib/backgroundGate': ${JSON.stringify(real('backgroundGate'))} };
export async function resolve(spec, ctx, next) {
  if (reals[spec]) return { shortCircuit: true, url: reals[spec] };
  if (stubs[spec]) return { shortCircuit: true, url: 'data:text/javascript,' + encodeURIComponent(stubs[spec]) };
  return next(spec, ctx);
}
`));

globalThis.__engine = { running: false, settling: false };
globalThis.__state = {};
const { useStore } = await import('@/store');
const { gateTiming } = await import('@/lib/backgroundGate');
const { startSongLevelWatcher, levelProgress } = await import('../src/lib/songLevelWatcher.ts');
const { startSongKeyWatcher } = await import('../src/lib/songKeyWatcher.ts');
Object.assign(gateTiming, { inputIdleMs: 30, openSettleMs: 30, pollMs: 10, showRecheckMs: 2000 });
// o vigia de tom agenda pelo window.setTimeout (o portão já carregou, sem escutar a janela)
globalThis.window = { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (t) => clearTimeout(t) };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(cond, ms = 2000) {
  const t0 = performance.now();
  while (!cond()) {
    if (performance.now() - t0 > ms) return false;
    await sleep(5);
  }
  return true;
}
function deferred() {
  let resolve; let reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}

function project(extra = {}) {
  return {
    levelMatch: true,
    songs: [{ id: 'a', name: 'A' }],
    playlist: [{ songId: 'a' }],
    clips: [{ id: 'c1', songId: 'a' }],
    tracks: [],
    transport: { isPlaying: true, currentSongId: 'a', nextSongId: null },
    selectedSongId: 'a',
    loadingSongIds: [],
    importProgress: null,
    songLoudness: {},
    songKeys: {},
    setSongLoudness: (id, v) => useStore.setState((s) => ({ songLoudness: { ...s.songLoudness, [id]: v } })),
    setSongDetectedKey: (id, v) => useStore.setState((s) => ({ songKeys: { ...s.songKeys, [id]: v } })),
    ...extra,
  };
}
const play = (isPlaying) => useStore.setState((s) => ({ transport: { ...s.transport, isPlaying } }));

test('volume igual: tocando (já assentado) não mede; parou, mede; Play no meio para e mede de novo, sem falha', async () => {
  globalThis.__state = project();
  const calls = [];
  globalThis.__measure = (song, st, cancelled) => {
    const d = deferred();
    calls.push({ song, cancelled, d });
    return d.promise;
  };
  const warn = console.warn;
  const warned = [];
  console.warn = (...a) => warned.push(a.join(' '));
  const off = startSongLevelWatcher();
  try {
    // o motor já assentou (isSettling falso): antes, a medida começava aqui, no meio da música
    await sleep(250);
    assert.equal(calls.length, 0, 'com a música tocando a medida não pode começar');
    assert.deepEqual(levelProgress(), { done: 0, total: 1 }, 'a fila aparece, esperando');

    play(false);
    assert.ok(await until(() => calls.length === 1), 'parou: mede');
    assert.equal(typeof calls[0].cancelled, 'function', 'a medida recebe quando parar');
    assert.equal(calls[0].cancelled(), false);

    play(true);
    assert.equal(calls[0].cancelled(), true, 'Play no meio: a medida para no próximo clipe');
    calls[0].d.reject(new DOMException('Exportação cancelada', 'AbortError'));
    await sleep(150);
    assert.equal(calls.length, 1, 'tocando de novo: espera');
    assert.equal(warned.length, 0, 'parar pelo Play não é falha');

    play(false);
    assert.ok(await until(() => calls.length === 2), 'parou de novo: mede de novo a mesma música');
    calls[1].d.resolve({ lufs: -14, peak: -1 });
    assert.ok(await until(() => levelProgress() === null), 'terminou');
    assert.deepEqual(useStore.getState().songLoudness.a, { lufs: -14, peak: -1, sig: 'sig-a' });
  } finally {
    off();
    console.warn = warn;
  }
});

test('volume igual: erro de verdade continua marcando a falha (não fica tentando)', async () => {
  globalThis.__state = project({ songs: [{ id: 'b', name: 'B' }], playlist: [{ songId: 'b' }], transport: { isPlaying: false, currentSongId: 'b' }, selectedSongId: 'b' });
  let n = 0;
  globalThis.__measure = async () => { n++; throw new Error('sem memória'); };
  const warn = console.warn;
  console.warn = () => {};
  const off = startSongLevelWatcher();
  try {
    assert.ok(await until(() => n === 1));
    assert.ok(await until(() => levelProgress() === null));
    useStore.setState((s) => ({ playlist: [...s.playlist] }));
    await sleep(150);
    assert.equal(n, 1, 'a mesma assinatura não é medida de novo');
  } finally {
    off();
    console.warn = warn;
  }
});

test('IA de tom: tocando (já assentado) não analisa; parou, analisa e guarda o tom', async () => {
  globalThis.__state = project({ levelMatch: false, songs: [{ id: 'k', name: 'K' }], playlist: [{ songId: 'k' }], transport: { isPlaying: true, currentSongId: 'k' }, selectedSongId: 'k' });
  const calls = [];
  globalThis.__detect = async (song) => { calls.push(song.id); return { key: 'Am', confident: true }; };
  const off = startSongKeyWatcher();
  try {
    // o vigia começa 1,5 s depois de abrir
    await sleep(1800);
    assert.equal(calls.length, 0, 'com a música tocando a IA de tom não pode rodar');
    play(false);
    assert.ok(await until(() => calls.length === 1), 'parou: analisa');
    assert.ok(await until(() => useStore.getState().songKeys.k?.key === 'Am'));
    assert.equal(useStore.getState().songKeys.k.sig, 'sig-k');
  } finally {
    off();
  }
});

test('IA de tom: projeto trocado durante a análise não grava o tom no projeto novo', async () => {
  globalThis.__state = project({ levelMatch: false, songs: [{ id: 'm', name: 'M' }], playlist: [{ songId: 'm' }], transport: { isPlaying: false, currentSongId: 'm' }, selectedSongId: 'm' });
  const { clearAudioLibrary } = await import('@/lib/audioLibrary');
  const d = deferred();
  let n = 0;
  globalThis.__detect = () => { n++; return d.promise; };
  const off = startSongKeyWatcher();
  try {
    assert.ok(await until(() => n === 1, 3000));
    clearAudioLibrary();
    d.resolve({ key: 'C', confident: true });
    await sleep(100);
    assert.equal(useStore.getState().songKeys.m, undefined);
  } finally {
    off();
  }
});

test('os dois vigias passam pelo portão e não usam mais só a espera de 5 s do Play', () => {
  for (const name of ['songKeyWatcher', 'songLevelWatcher']) {
    const src = fs.readFileSync(new URL(`../src/lib/${name}.ts`, import.meta.url), 'utf8');
    assert.match(src, /await acquireBackgroundTurn\(\)/, name);
    assert.match(src, /finally \{\s*turn\.release\(\);/, `${name} devolve a vez num finally`);
    assert.doesNotMatch(src, /isSettling\(\)\) await/, name);
  }
  const level = fs.readFileSync(new URL('../src/lib/songLevelWatcher.ts', import.meta.url), 'utf8');
  assert.match(level, /measureSongLoudness\(song, st, turn\.shouldStop\)/);
});
