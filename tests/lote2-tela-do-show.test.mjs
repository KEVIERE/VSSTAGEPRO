// Lote 2 do plano de velocidade (tela do show e Play na tela): a hora da largada é marcada antes
// do redesenho do Play, um relógio de quadro único que dorme parado, Rede Local e Show Online sem
// redesenhar o programa a cada consulta, limpeza da memória que só percorre o desfazer quando ele
// muda, playlist com linhas em memo e Modo Show que assina só a parte no ar.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { register, stripTypeScriptTypes } from 'node:module';
import { createStore } from 'zustand/vanilla';
import { temporal } from 'zundo';

const read = (p) => fs.readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');
const real = (p) => new URL(`../src/${p}`, import.meta.url).href;

// '@/...' para o node: os módulos sem dependência pesada vêm do próprio src; o store e o motor
// viram falsos que leem globalThis.__l2 na hora da chamada.
register('data:text/javascript,' + encodeURIComponent(`
const real = ${JSON.stringify({
  '@/lib/playFlow': real('lib/playFlow.ts'),
  '@/lib/regions': real('lib/regions.ts'),
  '@/lib/medley': real('lib/medley.ts'),
})};
const stubs = {
  '@/store': 'export const useStore = { getState: () => globalThis.__l2.store.getState(), setState: (x) => globalThis.__l2.store.setState(x), subscribe: (fn) => globalThis.__l2.store.subscribe(fn) };',
  '@/lib/audioEngine': 'export const audioEngine = new Proxy({}, { get: (_, k) => globalThis.__l2.engine[k] });',
  '@/lib/audioRecorder': 'export const audioRecorder = { stop: async () => null }; export const saveRecordingToMaestro = async () => {};',
  '@/lib/timeStretch': 'export const bpmAdjustToAlpha = () => 1;',
};
export async function resolve(spec, ctx, next) {
  if (real[spec]) return { shortCircuit: true, url: real[spec] };
  if (stubs[spec]) return { shortCircuit: true, url: 'data:text/javascript,' + encodeURIComponent(stubs[spec]) };
  return next(spec, ctx);
}
`));

/** Store falso no formato do zustand: setState avisa (estado, anterior). */
function makeStore(init) {
  let state = init;
  const subs = new Set();
  return {
    getState: () => state,
    setState: (patch) => {
      const prev = state;
      state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
      subs.forEach((fn) => fn(state, prev));
    },
    subscribe: (fn) => { subs.add(fn); return () => subs.delete(fn); },
  };
}

/** Projeto parado com uma música, e as ações que o transportControl chama. */
function showStore(log) {
  const store = makeStore({
    transport: { isPlaying: false, isPaused: false, isStopped: true, currentSongId: null, nextSongId: null, currentTime: 0, cursorSongId: null, playFlow: 'continuo' },
    selectedSongId: 'a',
    playlist: [{ songId: 'a', blockId: null }, { songId: 'b', blockId: null }],
    playlistOrder: ['a', 'b'],
    songs: [{ id: 'a', duration: 200 }, { id: 'b', duration: 180 }],
    playbackError: null,
  });
  const st = store.getState();
  Object.assign(st, {
    setPlaybackError: (e) => store.setState({ playbackError: e }),
    // O React 18 desenha o que o store mudou numa microtarefa (SyncLane, scheduleMicrotask):
    // o falso faz o mesmo, para a ordem ser a do programa.
    play: () => {
      store.setState((s) => ({ transport: { ...s.transport, isPlaying: true, isStopped: false, currentSongId: 'a' } }));
      log.push('play');
      queueMicrotask(() => log.push('render'));
    },
    stop: (t = 0) => store.setState((s) => ({ transport: { ...s.transport, isPlaying: false, isStopped: true, currentTime: t } })),
    setNextSong: (id) => store.setState((s) => ({ transport: { ...s.transport, nextSongId: id } })),
  });
  return store;
}

const tc = await import('../src/lib/transportControl.ts');
const fc = await import('../src/lib/frameClock.ts');
const medley = await import('../src/lib/medley.ts');

// ---------- passo 1: ordem do Play ----------

test('Play: a continuação que marca a hora da largada roda antes do redesenho pedido pelo st.play()', async () => {
  const log = [];
  const store = showStore(log);
  let running = false;
  let playingAtMark = null;
  globalThis.__l2 = {
    store,
    engine: {
      isStarting: () => false,
      isRunning: () => running,
      // como o startSong: parte síncrona até a primeira espera (ensureWorklet já resolvido) e,
      // depois dela, a conta ctx.currentTime + folga para todas as faixas
      playSong: async (id, offset) => {
        log.push(`motor ${id} ${offset}`);
        await Promise.resolve();
        playingAtMark = store.getState().transport.isPlaying;
        log.push('marca');
        running = true;
      },
    },
  };
  await tc.startPlayback();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(log, ['motor a 0', 'play', 'marca', 'render']);
  assert.equal(playingAtMark, true, 'na hora de marcar, o store já está tocando (igual a antes)');
  assert.equal(store.getState().transport.isPlaying, true);
  assert.equal(store.getState().transport.nextSongId, 'b', 'a próxima continua engatilhada');
  assert.equal(store.getState().playbackError, null);

  // A ordem antiga, com o mesmo falso: o redesenho passava na frente da hora da largada.
  const old = [];
  const store2 = showStore(old);
  const engine = { playSong: async () => { old.push('motor'); await Promise.resolve(); old.push('marca'); } };
  store2.getState().play();
  engine.playSong();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(old, ['play', 'motor', 'render', 'marca']);
});

test('Play: largada que não saiu ainda cai no aviso (verifyStarted continua preso ao playSong)', async () => {
  const log = [];
  const store = showStore(log);
  globalThis.__l2 = {
    store,
    engine: { isStarting: () => false, isRunning: () => false, playSong: async () => { await Promise.resolve(); } },
  };
  await tc.startPlayback();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(store.getState().transport.isPlaying, false);
  assert.match(store.getState().playbackError ?? '', /Não foi possível tocar esta música/);
});

test('o começo da largada no motor (até a primeira espera) não lê o transporte do store', () => {
  // É o único trecho que agora roda antes do st.play(): se ele lesse o isPlaying, a ordem mudaria o som.
  const eng = read('lib/audioEngine.ts');
  const start = eng.indexOf('  private async startSong(');
  const body = eng.slice(start, eng.indexOf('    const store = useStore.getState();', start));
  assert.ok(start > 0 && body.length > 0);
  assert.doesNotMatch(body, /transport|useStore/);
  const src = read('lib/transportControl.ts');
  const fn = src.slice(src.indexOf('export async function startPlayback'), src.indexOf('export function pausePlayback'));
  assert.ok(fn.indexOf('audioEngine.playSong(songId, offset)') < fn.indexOf('st.play();'));
  assert.match(fn, /started\s*\.catch\(\(err\) => console\.error\('\[play\] falha', err\)\)\s*\.finally\(\(\) => verifyStarted\(songId\)\);/);
});

// ---------- passo 5: relógio de quadro único ----------

function fakeRaf() {
  const queue = new Map();
  let seq = 0;
  return {
    raf: (cb) => { seq += 1; queue.set(seq, cb); return seq; },
    caf: (id) => { queue.delete(id); },
    pending: () => queue.size,
    /** roda os quadros pedidos até agora */
    frame: (now = 16) => { const cbs = [...queue.values()]; queue.clear(); cbs.forEach((cb) => cb(now)); },
  };
}

test('relógio de quadro: anda tocando, dorme parado e acorda por um quadro', () => {
  const r = fakeRaf();
  let active = false;
  const clock = fc.createFrameClock({ raf: r.raf, caf: r.caf, isActive: () => active });
  let a = 0;
  let b = 0;
  const offA = clock.subscribe(() => { a += 1; });
  clock.subscribe(() => { throw new Error('falha de uma barra'); });
  const offB = clock.subscribe(() => { b += 1; });
  assert.equal(r.pending(), 1, 'assinar pede um quadro (as barras nascem com o valor certo)');
  const origError = console.error;
  console.error = () => {};
  try {
    r.frame();
    assert.equal(a, 1);
    assert.equal(b, 1, 'uma barra com erro não para as outras');
    assert.equal(r.pending(), 0, 'parado: dorme depois do quadro');
    clock.wake();
    clock.wake();
    assert.equal(r.pending(), 1, 'acordar duas vezes pede um quadro só');
    active = true;
    r.frame();
    r.frame();
    r.frame();
    assert.equal(a, 4);
    assert.equal(r.pending(), 1, 'tocando: sempre um quadro pedido');
    active = false;
    r.frame();
    assert.equal(a, 5, 'depois de parar, um quadro a mais mostra o valor final');
    assert.equal(r.pending(), 0);
  } finally {
    console.error = origError;
  }
  clock.wake();
  offA();
  offB();
  assert.equal(r.pending(), 1, 'ainda há quem assina');
});

test('relógio de quadro: sem ninguém assinando, cancela o quadro pedido e não acorda', () => {
  const r = fakeRaf();
  const clock = fc.createFrameClock({ raf: r.raf, caf: r.caf, isActive: () => true });
  const off = clock.subscribe(() => {});
  assert.equal(clock.running(), true);
  off();
  assert.equal(r.pending(), 0);
  assert.equal(clock.running(), false);
  clock.wake();
  assert.equal(r.pending(), 0);
});

test('relógio do programa: acorda quando o transporte, as músicas ou a seleção mudam, e anda só tocando', () => {
  const r = fakeRaf();
  globalThis.requestAnimationFrame = r.raf;
  globalThis.cancelAnimationFrame = r.caf;
  const store = makeStore({ transport: { isPlaying: false, currentTime: 0 }, songs: [], selectedSongId: null, playlist: [], mixerVisible: false });
  globalThis.__l2 = { store, engine: {} };
  try {
    const clock = fc.frameClock();
    assert.equal(fc.frameClock(), clock, 'um relógio só');
    let frames = 0;
    clock.subscribe(() => { frames += 1; });
    r.frame();
    assert.equal(frames, 1);
    store.setState({ mixerVisible: true });
    assert.equal(r.pending(), 0, 'mudança que não aparece nas barras não acorda');
    store.setState((s) => ({ transport: { ...s.transport, currentTime: 12 } }));
    assert.equal(r.pending(), 1, 'cursor arrastado parado: um quadro');
    r.frame();
    assert.equal(r.pending(), 0);
    store.setState((s) => ({ transport: { ...s.transport, isPlaying: true } }));
    r.frame();
    r.frame();
    assert.equal(r.pending(), 1, 'tocando, não dorme');
    store.setState((s) => ({ transport: { ...s.transport, isPlaying: false } }));
    r.frame();
    assert.equal(r.pending(), 0, 'parou: dorme');
  } finally {
    delete globalThis.requestAnimationFrame;
    delete globalThis.cancelAnimationFrame;
  }
});

test('preenchimento por transform mostra a mesma parte da barra que a largura mostrava', () => {
  assert.equal(fc.fillTransform(0), 'translateX(-100.00%)');
  assert.equal(fc.fillTransform(100), 'translateX(0.00%)');
  assert.equal(fc.fillTransform(37.5), 'translateX(-62.50%)');
  assert.equal(fc.fillTransform(37.5, true), 'translateX(62.50%)');
  assert.equal(fc.fillTransform(150), 'translateX(0.00%)', 'nunca passa da barra');
  assert.equal(fc.fillTransform(-3), 'translateX(-100.00%)');
  assert.equal(fc.fillTransform(Number.NaN), 'translateX(-100.00%)');
  // barra do tamanho do contêiner (0 a 100) empurrada pelo transform, cortada pelo overflow hidden
  const shown = (pct, fromRight) => {
    const shift = Number(fc.fillTransform(pct, fromRight).match(/-?\d+\.\d+/)[0]);
    return [Math.max(0, shift), Math.min(100, 100 + shift)];
  };
  for (const pct of [0, 0.4, 12.5, 50, 99.6, 100]) {
    const left = shown(pct, false);
    assert.ok(Math.abs(left[0]) < 1e-9 && Math.abs(left[1] - pct) < 0.006, `esquerda ${pct}: largura ${pct}%`);
    const right = shown(pct, true);
    assert.ok(Math.abs(right[0] - (100 - pct)) < 0.006 && right[1] === 100, `direita ${pct}: justify-end com largura ${pct}%`);
  }
  // o marcador do pad fica na borda direita da camada empurrada: o mesmo ponto do "left: p%" de antes
  for (const pct of [0, 25, 80, 100]) assert.ok(Math.abs(shown(pct, false)[1] - pct) < 0.006);
});

test('barras e contadores usam o relógio único, sem laço próprio de quadro nem largura por quadro', () => {
  for (const f of ['components/TransportBar.tsx', 'components/PlaylistPanel.tsx', 'components/ShowModePanel.tsx', 'lib/useSongRemaining.ts', 'components/SectionPads.tsx']) {
    const src = read(f);
    assert.doesNotMatch(src, /requestAnimationFrame\(/, f);
    assert.doesNotMatch(src, /style\.width =/, f);
    assert.doesNotMatch(src, /will-change-\[width\]/, f);
  }
  assert.equal((read('components/TransportBar.tsx').match(/useLiveFill\(barRef, getLiveProgressPct/g) ?? []).length, 2);
  assert.equal((read('components/PlaylistPanel.tsx').match(/useLiveFill\(barRef, getLiveProgressPct/g) ?? []).length, 2);
  assert.match(read('components/ShowModePanel.tsx'), /useLiveFill\(barRef, getLiveProgressPct, reverse\)/);
  assert.match(read('lib/useSongRemaining.ts'), /useFrame\(\(\) => \{/);
  // o pad continua sem transição: segue o relógio do áudio
  assert.doesNotMatch(read('components/SectionPads.tsx'), /transition-\[left\]/);
});

// ---------- passo 6: Modo Show assina só a parte no ar ----------

test('pads e partes do medley assinam só o id da parte, não o cursor', () => {
  const pads = read('components/SectionPads.tsx');
  assert.doesNotMatch(pads, /useStore\(\(s\) => s\.transport\.currentTime\)/);
  assert.match(pads, /const activeId = useStore\(\(s\) => regionAt\(regions, s\.transport\.currentTime\)\?\.id \?\? null\);/);
  assert.match(pads, /const nextRegionId = useStore\(\(s\) => followingRegion\(regions, s\.transport\.currentTime\)\?\.id \?\? null\);/);
  const slices = read('components/MedleySlices.tsx');
  assert.doesNotMatch(slices, /s\.transport\.currentTime : -1/);
  assert.match(slices, /const playingId = useStore\(\(s\) => \(isCurrent \? sliceAt\(slices, s\.transport\.currentTime\)\?\.id \?\? null : null\)\);/);
});

test('Modo Show: a parte do medley vem de um seletor que só muda quando a parte muda', () => {
  const src = read('components/ShowModePanel.tsx');
  assert.doesNotMatch(src, /currentAndNextSlice\(current, isPlaying && audioEngine\.isRunning\(\)/);
  const start = src.indexOf('const selShowSlices = ');
  const body = src.slice(start, src.indexOf('};\n', start) + 2);
  const sel = new Function('currentAndNextSlice', `${stripTypeScriptTypes(body.replace(/\(s: StoreState\)/, '(s)'))}\nreturn selShowSlices;`)(medley.currentAndNextSlice);
  const song = {
    id: 'm', duration: 300,
    medley: [{ id: 'p1', name: 'Um', start: 0 }, { id: 'p2', name: 'Dois', start: 100 }, { id: 'p3', name: 'Três', start: 200, enabled: false }],
  };
  const state = (t) => ({ songs: [song], transport: { currentSongId: 'm', currentTime: 0, isPlaying: true, isStopped: false, ...t } });
  assert.equal(sel(state({ currentTime: 10 })), 'p1|p2');
  assert.equal(sel(state({ currentTime: 99.9 })), 'p1|p2', 'dentro da mesma parte: mesmo texto, nada redesenha');
  assert.equal(sel(state({ currentTime: 150 })), 'p2|', 'a parte pulada não é a próxima');
  assert.equal(sel(state({ currentTime: 150, isPlaying: false })), 'p1|p2', 'pausado: como antes, vale o começo');
  assert.equal(sel(state({ isPlaying: false, isStopped: true })), '|', 'parado: sem música no ar');
  assert.equal(sel({ songs: [{ id: 'x', duration: 10 }], transport: { currentSongId: 'x', currentTime: 3, isPlaying: true, isStopped: false } }), '|', 'música comum');
});

// ---------- passo 3: Rede Local e Show Online ----------

function loadSameLocalInfo() {
  const src = read('lib/useLocalBroadcast.ts');
  const body = src.slice(src.indexOf('const sameList = '), src.indexOf('const INFO_POLL_MS'));
  const js = stripTypeScriptTypes(body).replace(/^export /m, '');
  return new Function(`${js}\nreturn sameLocalInfo;`)();
}

test('Rede Local: a consulta a cada 2 s só troca o estado quando muda o que a tela mostra', () => {
  const same = loadSameLocalInfo();
  const info = (patch = {}) => ({
    running: true, port: 8080, hostName: 'palco.local', addresses: ['192.168.0.10'],
    pins: { musician: '1234', producer: '5678' }, qr: { musician: 'data:a', screen: 'data:b' }, urls: { musician: 'http://a', screen: 'http://b' },
    clients: [{ id: 'c1', role: 'musician', name: 'Ana', address: '192.168.0.20', lastSeen: 1000, accountId: 'acc1' }],
    lyrics: { s1: [] }, lyricsSaveRequestedAt: null, lyricStyle: { size: 1 }, error: null,
    ...patch,
  });
  const a = info();
  assert.equal(same(a, a), true);
  assert.equal(same(null, null), true);
  assert.equal(same(null, a), false);
  assert.equal(same(a, info({ clients: [{ ...a.clients[0], lastSeen: 3000 }] })), true, 'último sinal de cada aparelho não conta');
  assert.equal(same(a, info({ lyrics: { s1: [{ text: 'x' }] }, lyricsSaveRequestedAt: '2026-11-24', lyricStyle: { size: 2 } })), true, 'letras são lidas da própria consulta');
  assert.equal(same(a, info({ clients: [] })), false, 'saiu alguém');
  assert.equal(same(a, info({ clients: [...a.clients, { id: 'c2', role: 'remote', name: 'Celular', address: 'x', lastSeen: 1 }] })), false, 'entrou alguém');
  assert.equal(same(a, info({ clients: [{ ...a.clients[0], accountId: null }] })), false, 'a conta do músico muda a lista');
  assert.equal(same(a, info({ pins: { musician: '9999', producer: '5678' } })), false, 'PIN novo');
  assert.equal(same(a, info({ qr: { musician: 'data:z', screen: 'data:b' } })), false, 'QR novo');
  assert.equal(same(a, info({ urls: { musician: 'http://z', screen: 'http://b' } })), false);
  assert.equal(same(a, info({ addresses: ['10.0.0.2'] })), false, 'mudou de rede');
  assert.equal(same(a, info({ error: 'porta ocupada' })), false);
  assert.equal(same(a, info({ running: false })), false);
  const src = read('lib/useLocalBroadcast.ts');
  assert.match(src, /setInfo\(\(prev\) => \(sameLocalInfo\(prev, i\) \? prev : i\)\);/);
  assert.match(src, /const req = i\.lyricsSaveRequestedAt;/, 'as letras do produtor continuam lidas do i da consulta');
  assert.match(src, /return useMemo\(\s*\(\) => \(\{ available, mode, info, error, lyricsReceived, dismissLyrics, setMode, regeneratePin, kick \}\)/);
});

test('Show Online: a hora do último envio sai do estado do React e só a janela do show lê', () => {
  const live = read('lib/useLiveBroadcast.ts');
  assert.doesNotMatch(live, /setLastSentAt|useState<number \| null>\(null\)/);
  assert.doesNotMatch(live.slice(live.indexOf('export interface LiveBroadcast'), live.indexOf('const TAB_ID')), /lastSentAt/);
  assert.match(live, /lastSentAt = Date\.now\(\);/);
  assert.match(live, /export function getLastSentAt\(\): number \| null \{/);
  assert.match(live, /return useMemo\(\s*\(\) => \(\{ show, setShow, onAir, error, showName, yielded, takeOver: claim, resendSetlist, start, stop \}\)/);
  const dialog = read('components/ShowManagerDialog.tsx');
  assert.match(dialog, /Último sinal: \{sentAgo\(getLastSentAt\(\), now\)\}/);
  assert.match(dialog, /const id = setInterval\(\(\) => setNow\(Date\.now\(\)\), 1000\);/, 'a janela aberta se redesenha a cada segundo');
});

test('barra de menu, transporte, playlist e Modo Show em memo, com funções estáveis no App', () => {
  for (const [f, name] of [['components/MenuBar.tsx', 'MenuBar'], ['components/TransportBar.tsx', 'TransportBar'], ['components/PlaylistPanel.tsx', 'PlaylistPanel'], ['components/ShowModePanel.tsx', 'ShowModePanel']]) {
    const src = read(f);
    assert.match(src, new RegExp(`export default memo\\(${name}\\);`), f);
    assert.doesNotMatch(src, new RegExp(`export default function ${name}\\b`), f);
  }
  const app = read('App.tsx');
  assert.match(app, /const openAiSeparator = useCallback\(\(\) => setAiSeparatorOpen\(true\), \[\]\);/);
  assert.match(app, /const trialBadge = useMemo\(\(\) => <TrialBadge license=\{license\} \/>, \[license\]\);/);
  assert.match(app, /onOpenShowManager=\{openShowManager\} onOpenPrompter=\{openPrompter\}/);
  assert.match(app, /onOpenLocal=\{openLocal\} onOpenAiSeparator=\{openAiSeparator\}/);
  assert.match(app, /<PlaylistPanel maximized=\{playlistMaximized\} onOpenAiSeparator=\{openAiSeparator\} \/>/);
  assert.doesNotMatch(app, /onOpenAiSeparator=\{\(\) =>/);
});

// ---------- passo 4: limpeza da memória e o desfazer ----------

function loadPruneGate() {
  const app = read('App.tsx');
  const start = app.indexOf('function createPruneGate()');
  const end = app.indexOf('\n}\n', start) + 3;
  return new Function(`${stripTypeScriptTypes(app.slice(start, end))}\nreturn createPruneGate;`)();
}

test('limpeza da memória: só percorre o desfazer quando os clipes ou o histórico mudam', () => {
  const createPruneGate = loadPruneGate();
  // o mesmo desfazer do programa (zundo com partialize, equality e limite)
  const store = createStore(temporal((set) => ({
    clips: [{ id: 'c1' }],
    selectedSongId: 'a',
    nextSongId: null,
    setClips: (clips) => set({ clips }),
    select: (id) => set({ selectedSongId: id }),
    setNext: (id) => set({ nextSongId: id }),
  }), {
    partialize: (s) => ({ clips: s.clips }),
    equality: (a, b) => a.clips === b.clips,
    limit: 2,
  }));
  const gate = createPruneGate();
  const ask = (loading = false) => {
    const { pastStates, futureStates } = store.temporal.getState();
    return gate({ clips: store.getState().clips, past: pastStates, future: futureStates, loading });
  };
  assert.equal(ask(), true, 'a primeira volta sempre limpa');
  assert.equal(ask(), false);
  store.getState().select('b');
  store.getState().setNext('c');
  assert.equal(ask(), false, 'trocar a selecionada ou a próxima não percorre o histórico');
  store.getState().setClips([{ id: 'c1' }, { id: 'c2' }]);
  assert.equal(ask(), true, 'clipe novo');
  assert.equal(ask(), false);
  store.temporal.getState().undo();
  assert.equal(ask(), true, 'desfazer');
  store.temporal.getState().redo();
  assert.equal(ask(), true, 'refazer');
  store.getState().setClips([{ id: 'c3' }]);
  store.getState().setClips([{ id: 'c4' }]);
  assert.equal(store.temporal.getState().pastStates.length, 2, 'o limite tira o mais velho da lista');
  assert.equal(ask(), true);
  store.temporal.getState().undo();
  store.temporal.getState().redo();
  const before = store.temporal.getState();
  assert.equal(ask(), true);
  store.temporal.getState().clear();
  assert.notEqual(store.temporal.getState().pastStates, before.pastStates);
  assert.equal(ask(), true, 'limpar o desfazer');
  assert.equal(ask(true), false, 'nada mudou');
  // música abrindo: a limpeza pulou o áudio dela, então a volta seguinte limpa de novo
  store.getState().setClips([{ id: 'c5' }]);
  assert.equal(ask(true), true);
  assert.equal(ask(false), true, 'confere de novo depois de abrir');
  assert.equal(ask(false), false);
  const app = read('App.tsx');
  assert.match(app, /if \(needsPrune\(\{ clips: st\.clips, past: pastStates, future: futureStates, loading: st\.loadingSongIds\.length > 0 \}\)\) \{\s*const historyIds = new Set<string>\(\);/);
  // retainSongs e o preparo da próxima continuam rodando a cada troca
  const sched = app.slice(app.indexOf('const needsPrune = createPruneGate();'), app.indexOf('// Preparar de novo depois de editar'));
  assert.ok(sched.indexOf('retainSongs(keep);') > sched.indexOf('releaseClipUrls(urlsInUse);\n        }'));
  assert.match(sched, /audioEngine\.prepareSong\(first\)/);
});

// ---------- passo 2: linhas da playlist ----------

test('playlist: cada música é uma linha em memo, com ações estáveis e marca de soltar sem objeto novo', () => {
  const src = read('components/PlaylistPanel.tsx');
  assert.match(src, /const PlaylistRow = memo\(function PlaylistRow\(/);
  assert.match(src, /actions=\{actions\.row\}/);
  assert.match(src, /\}, \[\]\);\n  const \{ clearDrag, markDrop, resolveDrop \} = actions;/, 'as ações nascem uma vez');
  assert.match(src, /setDropPos\(\(p\) => \(p && p\.type === type && p\.id === id && p\.half === half \? p : \{ type, id, half \}\)\);/);
  assert.doesNotMatch(src, /setDropPos\(\{/, 'nenhum dragover cria objeto novo direto');
  assert.doesNotMatch(src, /const DropLine = \(/, 'a linha de soltar não é um componente novo a cada desenho');
  assert.doesNotMatch(src, /lastVisibleEntryRef/);
  // a linha recebe só o que muda nela; o nome em edição só vai para a linha em edição
  assert.match(src, /renameValue=\{renamingId === entry\.songId \? renameValue : ''\}/);
  assert.match(src, /countdown=\{isNext && transport\.isPlaying\}/);
});
