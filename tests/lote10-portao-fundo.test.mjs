// Lote 10: portão único do trabalho de fundo e yieldToUi. O portão só libera com a música parada,
// nada abrindo, o Play assentado, sem clique recente e depois da abertura do projeto; um por vez.
import { test } from 'node:test';
import assert from 'node:assert/strict';
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
};
const reals = { '@/lib/yieldToUi': ${JSON.stringify(real('yieldToUi'))}, '@/lib/backgroundGate': ${JSON.stringify(real('backgroundGate'))} };
export async function resolve(spec, ctx, next) {
  if (reals[spec]) return { shortCircuit: true, url: reals[spec] };
  if (stubs[spec]) return { shortCircuit: true, url: 'data:text/javascript,' + encodeURIComponent(stubs[spec]) };
  return next(spec, ctx);
}
`));

globalThis.__engine = { running: false, settling: false };
globalThis.__state = { transport: { isPlaying: false }, loadingSongIds: [], importProgress: null };

const yieldMod = await import('@/lib/yieldToUi');
const { createBackgroundGate, gateTiming, backgroundGate, acquireBackgroundTurn } = await import('@/lib/backgroundGate');
const { useStore } = await import('@/store');
const { clearAudioLibrary } = await import('@/lib/audioLibrary');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// tempos curtos para o teste (os de verdade: 1,5 s sem mexer e 4 s depois de abrir)
assert.equal(gateTiming.inputIdleMs, 1500);
assert.equal(gateTiming.openSettleMs, 4000);
Object.assign(gateTiming, { inputIdleMs: 40, openSettleMs: 40, pressedMaxMs: 200, pollMs: 10, showRecheckMs: 2000, softCapMs: 300, leaseMaxMs: 60_000 });

/** Conta quantos MessageChannel foram criados enquanto `fn` roda. */
async function countChannels(fn) {
  const Original = globalThis.MessageChannel;
  let made = 0;
  globalThis.MessageChannel = class extends Original { constructor() { super(); made++; } };
  try { await fn(); } finally { globalThis.MessageChannel = Original; }
  return made;
}

test('portão padrão: lê o estado da tela e do motor e avisa o yieldToUi se há música tocando', async () => {
  await sleep(gateTiming.openSettleMs + 5);

  useStore.setState({ transport: { isPlaying: true } });
  assert.equal(await countChannels(() => yieldMod.yieldToUi()), 0, 'tocando: ritmo contido');
  const p = acquireBackgroundTurn();
  assert.equal(await settledWithin(p, 60), false, 'tocando: não libera');
  useStore.setState({ transport: { isPlaying: false } });
  let lease = await p;
  assert.equal(await countChannels(() => yieldMod.yieldToUi()), 1, 'parado: cede pelo MessageChannel');
  lease.release();

  useStore.setState({ loadingSongIds: ['s1'] });
  assert.equal(backgroundGate.isFree(), false, 'música abrindo');
  useStore.setState({ loadingSongIds: [] });
  globalThis.__engine.settling = true;
  assert.equal(backgroundGate.isFree(), false, 'Play largando');
  globalThis.__engine.settling = false;
  useStore.setState({ importProgress: { clipId: 'x', status: 'decoding', message: '' } });
  assert.equal(backgroundGate.isFree(), false, 'importação decodificando');
  useStore.setState({ importProgress: { clipId: 'done', status: 'done', message: '' } });
  assert.equal(backgroundGate.isFree(), true);

  lease = await acquireBackgroundTurn();
  clearAudioLibrary();
  assert.equal(lease.stale(), true, 'abrir projeto (limpa a biblioteca de áudio) troca a vez');
  lease.release();
  assert.equal(backgroundGate.isFree(), false, 'logo depois de abrir, espera');
});

test('yieldToUi: parado cede pelo MessageChannel (sem o atraso dos timers aninhados)', async () => {
  yieldMod.setPlayingCheck(() => false);
  const made = await countChannels(async () => { for (let i = 0; i < 20; i++) await yieldMod.yieldToUi(); });
  assert.equal(made, 20);
});

test('yieldToUi: tocando espera de verdade (ritmo contido), sem MessageChannel', async () => {
  yieldMod.setPlayingCheck(() => true);
  let elapsed = 0;
  const made = await countChannels(async () => {
    const t0 = performance.now();
    for (let i = 0; i < 5; i++) await yieldMod.yieldToUi();
    elapsed = performance.now() - t0;
  });
  assert.equal(made, 0);
  assert.equal(yieldMod.PLAYING_GAP_MS, 4);
  assert.ok(elapsed >= 5 * (yieldMod.PLAYING_GAP_MS - 1), `esperou ${elapsed.toFixed(1)} ms`);
  yieldMod.setPlayingCheck(() => { throw new Error('quebrou'); });
  const madeOnError = await countChannels(() => yieldMod.yieldToUi());
  assert.equal(madeOnError, 1, 'erro ao perguntar conta como parado');
});


const fast = () => ({
  inputIdleMs: 40, openSettleMs: 40, pressedMaxMs: 200, pollMs: 10, showRecheckMs: 2000, softCapMs: 300, leaseMaxMs: 60_000,
});

function fakeDeps() {
  const listeners = new Set();
  const d = {
    show: false, engine: false, importing: false,
    now: () => performance.now(),
    showBusy: () => d.show,
    engineBusy: () => d.engine,
    importBusy: () => d.importing,
    subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    notify: () => listeners.forEach((l) => l()),
    listeners,
  };
  return d;
}

/** Diz se a promessa resolveu dentro de `ms`. */
async function settledWithin(p, ms) {
  let done = false;
  p.then(() => { done = true; }, () => { done = true; });
  await sleep(ms);
  return done;
}

test('portão: com a música tocando não libera; ao parar libera pelo aviso do estado, sem esperar a reconferência', async () => {
  const d = fakeDeps();
  const timing = fast();
  const gate = createBackgroundGate(d, timing);
  await sleep(timing.openSettleMs + 5);
  d.show = true;
  const p = gate.acquire();
  assert.equal(await settledWithin(p, 150), false, 'tocando: não pode liberar');
  assert.equal(d.listeners.size, 1, 'espera pelo aviso do estado, sem ficar consultando');
  const t0 = performance.now();
  d.show = false;
  d.notify();
  const lease = await p;
  assert.ok(performance.now() - t0 < 200, 'liberou logo depois de parar');
  assert.equal(d.listeners.size, 0, 'tirou a escuta do estado');
  lease.release();
});

test('portão: largada do Play (motor assentando) segura até assentar', async () => {
  const d = fakeDeps();
  const timing = fast();
  const gate = createBackgroundGate(d, timing);
  await sleep(timing.openSettleMs + 5);
  d.engine = true;
  const p = gate.acquire();
  assert.equal(await settledWithin(p, 80), false);
  d.engine = false;
  (await p).release();
});

test('portão: clique ou tecla recente adia; botão preso segura até soltar (com teto)', async () => {
  const d = fakeDeps();
  const timing = fast();
  const gate = createBackgroundGate(d, timing);
  await sleep(timing.openSettleMs + 5);
  assert.equal(gate.isFree(), true);
  gate.noteInput();
  assert.equal(gate.isFree(), false);
  const t0 = performance.now();
  (await gate.acquire()).release();
  assert.ok(performance.now() - t0 >= timing.inputIdleMs - 5, 'esperou a pessoa parar');

  gate.notePress(true);
  const p = gate.acquire();
  assert.equal(await settledWithin(p, timing.inputIdleMs + 60), false, 'arrastando: não libera');
  gate.notePress(false);
  const t1 = performance.now();
  (await p).release();
  assert.ok(performance.now() - t1 >= timing.inputIdleMs - 5, 'depois de soltar ainda espera o tempo sem mexer');

  // botão que nunca soltou (soltou fora da janela) deixa de contar no teto
  gate.notePress(true);
  const t2 = performance.now();
  (await gate.acquire()).release();
  const waited = performance.now() - t2;
  assert.ok(waited >= timing.pressedMaxMs - 20 && waited < timing.pressedMaxMs + 400, `teto do botão preso: ${waited.toFixed(0)} ms`);
});

test('portão: espera alguns segundos depois de abrir o projeto; projeto trocado no meio invalida a vez', async () => {
  const d = fakeDeps();
  const timing = fast();
  const t0 = performance.now();
  const gate = createBackgroundGate(d, timing);
  const lease = await gate.acquire();
  assert.ok(performance.now() - t0 >= timing.openSettleMs - 5, 'primeiro trabalho só depois da abertura');
  assert.equal(lease.stale(), false);
  assert.equal(lease.shouldStop(), false);
  gate.noteProjectOpened();
  assert.equal(lease.stale(), true);
  assert.equal(lease.shouldStop(), true);
  lease.release();
  const t1 = performance.now();
  (await gate.acquire()).release();
  assert.ok(performance.now() - t1 >= timing.openSettleMs - 5, 'projeto aberto de novo: espera de novo');
});

test('portão: um trabalho por vez, na ordem em que pediram; release repetido não libera dois', async () => {
  const d = fakeDeps();
  const timing = fast();
  const gate = createBackgroundGate(d, timing);
  const order = [];
  const a = gate.acquire().then((l) => { order.push('a'); return l; });
  const b = gate.acquire().then((l) => { order.push('b'); return l; });
  const c = gate.acquire().then((l) => { order.push('c'); return l; });
  const la = await a;
  assert.equal(await settledWithin(b, 60), false, 'b espera a sair');
  la.release();
  la.release();
  const lb = await b;
  assert.equal(await settledWithin(c, 60), false, 'release repetido de a não solta c');
  lb.release();
  (await c).release();
  assert.deepEqual(order, ['a', 'b', 'c']);
});

test('portão: shouldStop acende quando o Play chega no meio do trabalho', async () => {
  const d = fakeDeps();
  const timing = fast();
  const gate = createBackgroundGate(d, timing);
  const lease = await gate.acquire();
  assert.equal(lease.shouldStop(), false);
  d.show = true;
  assert.equal(lease.shouldStop(), true);
  d.show = false;
  d.engine = true;
  assert.equal(lease.shouldStop(), true, 'largada do Play também');
  d.engine = false;
  assert.equal(lease.shouldStop(), false);
  lease.release();
  assert.equal(lease.shouldStop(), true, 'depois de devolver a vez, para');
});

test('portão: importação decodificando segura, mas nunca para sempre (teto)', async () => {
  const d = fakeDeps();
  const timing = fast();
  const gate = createBackgroundGate(d, timing);
  d.importing = true;
  const t0 = performance.now();
  (await gate.acquire()).release();
  const waited = performance.now() - t0;
  assert.ok(waited >= timing.softCapMs - 20 && waited < timing.softCapMs + 500, `teto: ${waited.toFixed(0)} ms`);
});

test('portão: trabalho que passou do tempo máximo perde a vez (a fila não trava)', async () => {
  const d = fakeDeps();
  const timing = { ...fast(), leaseMaxMs: 80 };
  const gate = createBackgroundGate(d, timing);
  const warn = console.warn;
  const warned = [];
  console.warn = (...a) => warned.push(a.join(' '));
  try {
    const stuck = await gate.acquire();
    const next = gate.acquire();
    assert.equal(await settledWithin(next, 30), false);
    (await next).release();
    assert.equal(stuck.shouldStop(), true);
    assert.equal(warned.length, 1);
  } finally {
    console.warn = warn;
  }
});

test('textos sem travessão', async () => {
  const fs = await import('node:fs');
  for (const name of ['backgroundGate', 'yieldToUi', 'songKeyWatcher', 'songLevelWatcher']) {
    const src = fs.readFileSync(new URL(`../src/lib/${name}.ts`, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /—/, name);
  }
});
