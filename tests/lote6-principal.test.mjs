// Lote 6: abertura e processo principal. O main.js roda com um Electron de mentira e com módulos
// de IA falsos, para conferir: módulos sob demanda com o estado do show, nada carregado para sair,
// RAM total para a tela, voz de IA solta antes de separar, entrada pelo caminho do arquivo,
// faixas servidas por vsstage://stems e a limpeza depois das janelas.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const desktop = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'desktop');
const mainPath = path.join(desktop, 'main.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vs-lote6-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

// o temporizador de 15 s da splash e os de 60 s e 90 s não seguram o teste aberto
const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms, ...rest) => {
  const t = realSetTimeout(fn, ms, ...rest);
  if (ms >= 10_000) t.unref?.();
  return t;
};

// ---------- Electron de mentira ----------
const events = []; // ordem do que a abertura faz
const handlers = new Map();
const appEvents = new Map();
let protocolHandler = null;
let readyResolve;
const ready = new Promise((r) => { readyResolve = r; });
const windows = [];
const anything = new Proxy(function () {}, {
  get: (_t, k) => (k === 'then' ? undefined : k === Symbol.toPrimitive ? () => '' : anything),
  apply: () => anything,
  construct: () => anything,
});
class FakeWindow {
  constructor(opts) {
    this.opts = opts;
    this.sent = [];
    this.webContents = {
      on() {}, once() {}, removeListener() {}, setWindowOpenHandler() {},
      send: (ch, data) => this.sent.push([ch, data]),
      executeJavaScript: () => Promise.resolve(),
      getURL: () => 'vsstage://app/',
    };
    windows.push(this);
    events.push(opts.webPreferences?.preload ? 'janela' : 'splash');
  }
  on() { return this; } once() { return this; } loadURL() {} loadFile() {}
  isDestroyed() { return false; } isVisible() { return false; } isMinimized() { return false; }
  show() {} focus() {} showInactive() {} close() {} restore() {} setDocumentEdited() {}
}
const fakeElectron = {
  app: {
    requestSingleInstanceLock: () => true,
    isPackaged: false,
    getPath: () => tmp,
    getVersion: () => '0.0.0',
    whenReady: () => ready,
    on: (ev, fn) => appEvents.set(ev, fn),
    quit() {}, exit() {},
  },
  BrowserWindow: FakeWindow,
  ipcMain: { handle: (n, fn) => handlers.set(n, fn), on() {}, removeListener() {} },
  protocol: { registerSchemesAsPrivileged() {}, handle: (_s, fn) => { protocolHandler = fn; } },
  net: { fetch: (url, opts) => ({ fetched: url, headers: opts?.headers }) },
  shell: anything,
  session: { defaultSession: anything },
  Menu: anything,
  dialog: anything,
  powerSaveBlocker: { start: () => 7, stop() {} },
};

// ---------- módulos falsos (o main.js não percebe a troca) ----------
const loads = [];
const calls = [];
const record = (name) => (...args) => { calls.push([name, ...args]); return undefined; };
const fakeQwen = {
  setCountPackListener: (fn) => { calls.push(['qwen.listener']); fakeQwen.listener = fn; },
  setPlaying: record('qwen.setPlaying'),
  supported: () => false,
  stopHelper: record('qwen.stopHelper'),
  releaseIfIdle: record('qwen.releaseIfIdle'),
  warm: () => Promise.resolve(true),
};
const fakeStems = {
  acceptsInputPath: false,
  hasLocalDemucs: () => true,
  cancelStemSeparation: () => { calls.push(['stems.cancel']); return true; },
  separateStemsLocal: async (...args) => { calls.push(['stems.separate', ...args]); return fakeStems.reply(...args); },
  reply: () => ({ vocals: new ArrayBuffer(4), bass: new ArrayBuffer(4), drums: new ArrayBuffer(4), other: new ArrayBuffer(4) }),
};
const fakeDrums = {
  separateDrumPieces: async (...args) => { calls.push(['drums.separate', ...args]); return fakeDrums.reply(...args); },
  reply: () => ({ bumbo: Buffer.from('b'), caixa: Buffer.from('c') }),
  status: () => ({ ready: true }),
  stop: record('drums.stop'),
};
const fakes = {
  maestroQwen: () => fakeQwen,
  maestroVoiceDownload: () => ({ setPaused: record('download.setPaused'), start: record('download.start'), stop: record('download.stop') }),
  maestroVoice: () => ({ listVoices: () => ['voz'] }),
  maestroClone: () => ({ list: () => [], publicInfo: (v) => v }),
  maestroPacks: () => ({ setProgressListener: record('packs.listener'), setPaused: record('packs.setPaused'), start: record('packs.start'), stop: record('packs.stop'), status: () => ({}) }),
  lyricsReader: () => ({ setPlaying: record('lyrics.setPlaying'), status: () => ({ supported: true }), stop: record('lyrics.stop') }),
  stemSeparatorLocal: () => fakeStems,
  drumPieces: () => fakeDrums,
  // a abertura sem rede, sem disco e sem comandos de verdade
  antiTamper: () => ({ initAntiTamper: () => events.push('antiTamper'), getHardwareIdAsync: async () => { events.push('placa'); return 'hw'; } }),
  licenseCache: () => ({ startClockWatch() {}, load: () => { events.push('licenseCache.load'); return null; }, save: async () => true, clear() {} }),
  deviceInfo: () => ({ deviceInfo: async () => ({ id: 'x', name: 'Mac' }) }),
  selfUpdate: () => ({ cleanLeftovers: async () => { events.push('limpeza'); return 0; } }),
  localServer: () => ({ LocalServer: class { constructor() { events.push('servidor'); } stop() {} } }),
  networkCheck: () => ({ networkCheck: async () => ({ checks: [] }), defaultGateway: async () => null }),
};
const fakePaths = new Map(Object.entries(fakes).map(([name, make]) => [path.join(desktop, `${name}.js`), [name, make]]));

const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return fakeElectron;
  if (parent?.filename === mainPath && request.startsWith('./')) {
    const resolved = Module._resolveFilename(request, parent, isMain);
    const fake = fakePaths.get(resolved);
    if (fake) {
      if (!require.cache[resolved]) {
        const m = new Module(resolved, parent);
        m.filename = resolved;
        m.exports = fake[1]();
        m.loaded = true;
        require.cache[resolved] = m;
        loads.push(fake[0]);
      }
      return require.cache[resolved].exports;
    }
  }
  return origLoad.call(this, request, parent, isMain);
};
require(mainPath);
readyResolve();
await ready;
await new Promise((r) => setImmediate(r));

const win = windows.find((w) => w.opts.webPreferences?.preload);
const invoke = (name, ...args) => handlers.get(`local:${name}`)({ sender: win.webContents }, ...args);
const lazyNames = ['maestroQwen', 'maestroVoiceDownload', 'maestroVoice', 'maestroClone', 'maestroPacks', 'lyricsReader', 'stemSeparatorLocal', 'drumPieces'];
const lazyLoaded = () => loads.filter((n) => lazyNames.includes(n));

test('abertura: nenhum módulo de IA carregado; placa e limpeza só depois das janelas', () => {
  assert.deepEqual(lazyLoaded(), []);
  const iJanela = events.indexOf('janela');
  assert.ok(events.indexOf('splash') >= 0 && iJanela > events.indexOf('splash'));
  assert.ok(events.indexOf('limpeza') > iJanela, 'a limpeza do /tmp vem depois de criar a janela');
  assert.ok(events.indexOf('placa') > iJanela, 'o número da placa sai em segundo plano depois da janela');
});

test('RAM total vai para a tela pelo argumento da janela (os.totalmem, em bytes)', () => {
  const args = win.opts.webPreferences.additionalArguments;
  assert.deepEqual(args, [`--vs-total-memory=${os.totalmem()}`]);
  assert.equal(win.opts.webPreferences.sandbox, true, 'a janela continua em sandbox');
});

test('música tocando antes de carregar: quem carrega depois já nasce sabendo', async () => {
  await invoke('maestroVoicePlaying', true);
  assert.deepEqual(lazyLoaded(), [], 'avisar que a música toca não carrega nada');
  await invoke('maestroWarm', 'qwen:feminina');
  assert.deepEqual(lazyLoaded(), ['maestroQwen', 'maestroVoiceDownload']);
  assert.ok(calls.some((c) => c[0] === 'qwen.listener'), 'ouvinte do pacote de contagem ligado na carga');
  assert.ok(calls.some((c) => c[0] === 'qwen.setPlaying' && c[1] === true), 'a voz sabe que a música toca');
  assert.ok(calls.some((c) => c[0] === 'download.setPaused' && c[1] === true), 'o download da voz pausa');
  // o ouvinte manda o andamento para a tela, como antes
  fakeQwen.listener({ voice: 'v', state: 'gerando', done: 1, total: 4, extra: 'x' });
  assert.deepEqual(win.sent.at(-1), ['maestroCountPack:progress', { voice: 'v', state: 'gerando', done: 1, total: 4 }]);
  // depois de carregado, o aviso chega direto
  calls.length = 0;
  await invoke('maestroVoicePlaying', false);
  assert.deepEqual(calls.filter((c) => c[0].startsWith('qwen.') || c[0].startsWith('download.')), [['download.setPaused', false], ['qwen.setPlaying', false]]);
  assert.ok(!loads.includes('maestroPacks') && !loads.includes('lyricsReader'), 'pacotes e letra continuam sem carregar');
  await invoke('maestroVoicePlaying', true);
  await invoke('lyricsReaderStatus');
  assert.ok(calls.some((c) => c[0] === 'lyrics.setPlaying' && c[1] === true));
  await invoke('maestroVoicePlaying', false);
});

test('maestroVoice passa pela preparação do maestroQwen antes de carregar', async () => {
  assert.deepEqual(await invoke('maestroVoices'), ['voz']);
  assert.ok(loads.indexOf('maestroQwen') < loads.indexOf('maestroVoice'));
});

test('separar com o Maestro aberto: a voz parada é solta antes; entrada em bytes chega igual', async () => {
  calls.length = 0;
  const audio = new ArrayBuffer(16);
  const reply = await invoke('separateStemsLocal', 'musica.wav', audio);
  const sep = calls.find((c) => c[0] === 'stems.separate');
  assert.ok(calls.findIndex((c) => c[0] === 'qwen.releaseIfIdle') < calls.indexOf(sep), 'voz solta antes de começar');
  assert.equal(sep.length, 4, 'sem opções novas: a mesma chamada de antes');
  assert.equal(sep[1], win, 'a janela vai para o progresso');
  assert.equal(sep[3], audio, 'os bytes vão como chegaram (o Buffer.from do separador não copia)');
  assert.ok(reply.vocals instanceof ArrayBuffer);
});

test('entrada pelo caminho do arquivo: lida aqui quando o separador não sabe ler do disco', async () => {
  const file = path.join(tmp, 'entrada.wav');
  fs.writeFileSync(file, Buffer.from('RIFF-teste'));
  calls.length = 0;
  await invoke('separateStemsLocal', 'entrada.wav', { path: file });
  let sep = calls.find((c) => c[0] === 'stems.separate');
  assert.ok(sep[3] instanceof ArrayBuffer);
  assert.equal(Buffer.from(sep[3]).toString(), 'RIFF-teste');
  // separador que lê do disco recebe o caminho
  fakeStems.acceptsInputPath = true;
  calls.length = 0;
  await invoke('separateStemsLocal', 'entrada.wav', { path: file });
  sep = calls.find((c) => c[0] === 'stems.separate');
  assert.deepEqual(sep[3], { path: file });
  fakeStems.acceptsInputPath = false;
  await assert.rejects(invoke('separateStemsLocal', 'x.wav', { path: 'relativo.wav' }), /caminho do áudio inválido/);
  await assert.rejects(invoke('separateStemsLocal', 'x.wav', { path: path.join(tmp, 'nao-existe.wav') }), /não foi encontrado/);
});

test('cancelar enquanto o principal lê a música do disco não deixa a separação começar', async () => {
  const file = path.join(tmp, 'grande.wav');
  fs.writeFileSync(file, Buffer.alloc(1024));
  calls.length = 0;
  const run = invoke('separateStemsLocal', 'grande.wav', { path: file });
  await invoke('cancelStemSeparation');
  await assert.rejects(run, /separation_cancelled/);
  assert.ok(!calls.some((c) => c[0] === 'stems.separate'));
});

test('faixas no disco: código para a tela que pediu, bytes para a que não pediu', async () => {
  const dir = fs.mkdtempSync(path.join(tmp, 'stems-'));
  const files = {};
  for (const n of ['vocals', 'bass', 'drums', 'other']) { files[n] = path.join(dir, `${n}.wav`); fs.writeFileSync(files[n], `wav-${n}`); }
  fakeStems.reply = (_w, _f, _i, _p, opts) => ({ files: { ...files }, dir, opts });
  calls.length = 0;
  const reply = await invoke('separateStemsLocal', 'm.wav', new ArrayBuffer(8), { files: true });
  const sep = calls.find((c) => c[0] === 'stems.separate');
  assert.deepEqual(sep[5], { files: true }, 'quem separa fica sabendo que a tela lê do disco');
  const { token, names } = reply.stemFiles;
  assert.match(token, /^[0-9a-f]{32}$/);
  assert.deepEqual(names, ['vocals', 'bass', 'drums', 'other']);
  assert.ok(!('dir' in reply) && !('files' in reply), 'o caminho da pasta não vai para a tela');
  // a tela lê pelo esquema, com o endereço montado pelo preload
  const preload = loadPreload({ argv: [] });
  const url = preload.vsDesktop.stemFileUrl(token, 'vocals');
  assert.equal(url, `vsstage://stems/${token}/vocals.wav`);
  const res = await protocolHandler({ url, headers: { range: 'bytes=0-3' } });
  assert.equal(res.fetched, pathToFileURL(files.vocals).toString());
  assert.deepEqual(res.headers, { range: 'bytes=0-3' }, 'os pedidos em pedaços passam (Range)');
  // nome ou código que não existem: 404, e nada de caminho vindo da página
  for (const bad of [`vsstage://stems/${token}/piano.wav`, `vsstage://stems/${'0'.repeat(32)}/vocals.wav`, `vsstage://stems/${token}/..%2Fvocals.wav`, `vsstage://stems/${token}/vocals`]) {
    assert.equal((await protocolHandler({ url: bad, headers: {} })).status, 404, bad);
  }
  // a tela avisa que leu: a pasta sai e o código deixa de valer
  assert.equal(await invoke('stemFilesRelease', token), true);
  assert.equal(fs.existsSync(dir), false);
  assert.equal((await protocolHandler({ url, headers: {} })).status, 404);
  assert.equal(await invoke('stemFilesRelease', token), false);

  // tela que não pediu `files`: recebe os bytes, como antes, e a pasta sai
  const dir2 = fs.mkdtempSync(path.join(tmp, 'stems-'));
  const v2 = path.join(dir2, 'vocals.wav');
  fs.writeFileSync(v2, 'abc');
  fakeStems.reply = () => ({ files: { vocals: v2 }, dir: dir2 });
  const bytes = await invoke('separateStemsLocal', 'm.wav', new ArrayBuffer(8));
  assert.ok(bytes.vocals instanceof ArrayBuffer);
  assert.equal(Buffer.from(bytes.vocals).toString(), 'abc');
  assert.equal(fs.existsSync(dir2), false);
  fakeStems.reply = () => ({ vocals: new ArrayBuffer(4) });
});

test('bateria: bytes sem cópia, voz solta antes e peças pelo mesmo esquema', async () => {
  calls.length = 0;
  const u8 = new Uint8Array([1, 2, 3, 4]);
  const reply = await invoke('separateDrumPieces', u8);
  const sep = calls.find((c) => c[0] === 'drums.separate');
  assert.ok(calls.findIndex((c) => c[0] === 'qwen.releaseIfIdle') < calls.indexOf(sep));
  assert.ok(Buffer.isBuffer(sep[1]));
  assert.equal(sep[1].buffer, u8.buffer, 'o Buffer usa a mesma memória (antes o Buffer.from copiava)');
  assert.deepEqual([...sep[1]], [1, 2, 3, 4]);
  assert.equal(typeof sep[2], 'function', 'progresso continua indo para a tela');
  sep[2]('Separando a bateria...');
  assert.deepEqual(win.sent.at(-1), ['separation:progress', { percent: 97, message: 'Separando a bateria...' }]);
  assert.ok(Buffer.isBuffer(reply.bumbo));
  // peças deixadas no disco
  const dir = fs.mkdtempSync(path.join(tmp, 'pecas-'));
  const bumbo = path.join(dir, 'bumbo.wav');
  fs.writeFileSync(bumbo, 'bumbo');
  fakeDrums.reply = () => ({ files: { bumbo }, dir, elapsedMs: 12 });
  const asFiles = await invoke('separateDrumPieces', u8, { files: true });
  assert.equal(asFiles.elapsedMs, 12);
  assert.deepEqual(asFiles.stemFiles.names, ['bumbo']);
  const asBytes = await invoke('separateDrumPieces', u8);
  assert.ok(Buffer.isBuffer(asBytes.bumbo), 'peças em bytes continuam Buffer, como antes');
  assert.equal(asBytes.bumbo.toString(), 'bumbo');
  await invoke('stemFilesRelease', asFiles.stemFiles.token);
});

test('sem o Maestro carregado, separar não abre o Maestro', () => {
  // conferido no próprio código: a soltura só usa o que já foi carregado
  const main = fs.readFileSync(mainPath, 'utf8');
  assert.match(main, /function freeVoiceForSeparation\(\) \{\s*try \{ ifLoaded\(QWEN\)\?\.releaseIfIdle\?\.\(\); \}/);
});

test('sair do programa: só para o que foi carregado, sem carregar nada', () => {
  const before = [...loads];
  calls.length = 0;
  appEvents.get('before-quit')({ preventDefault() {} });
  assert.deepEqual(loads, before, 'nenhum módulo novo carregado ao sair');
  const names = calls.map((c) => c[0]);
  assert.ok(names.includes('qwen.stopHelper') && names.includes('stems.cancel') && names.includes('drums.stop') && names.includes('download.stop') && names.includes('lyrics.stop'));
  assert.ok(!names.includes('packs.stop'), 'pacotes nunca carregados: nada para parar');
});

test('cancelar sem o separador carregado responde como antes', async () => {
  // o separador já foi carregado neste arquivo; a regra está no código
  const main = fs.readFileSync(mainPath, 'utf8');
  assert.match(main, /const mod = ifLoaded\(STEMS\);\s*return mod \? mod\.cancelStemSeparation\(\) : true;/);
});

// ---------- preload ----------
function loadPreload(proc) {
  const src = fs.readFileSync(path.join(desktop, 'preload.js'), 'utf8');
  const exposed = {};
  const electron = {
    contextBridge: { exposeInMainWorld: (k, v) => { exposed[k] = v; } },
    ipcRenderer: { invoke: async (...a) => a, send() {}, on() {}, removeListener() {} },
    webUtils: { getPathForFile: () => '' },
  };
  new Function('require', 'process', src)((m) => { if (m === 'electron') return electron; throw new Error(m); }, { arch: 'arm64', ...proc });
  return exposed;
}

test('preload: RAM total pelo argumento, reserva do Electron em KB, 0 sem medida', () => {
  assert.equal(loadPreload({ argv: ['electron', '--vs-total-memory=8589934592'] }).vsDesktop.totalMemory, 8589934592);
  assert.equal(loadPreload({ argv: [], getSystemMemoryInfo: () => ({ total: 16 * 1024 * 1024 }) }).vsDesktop.totalMemory, 16 * 1024 ** 3);
  assert.equal(loadPreload({ argv: ['--vs-total-memory=lixo'], getSystemMemoryInfo: () => { throw new Error('sem'); } }).vsDesktop.totalMemory, 0);
  assert.equal(loadPreload({ argv: [] }).vsDesktop.totalMemory, 0);
  const main = fs.readFileSync(mainPath, 'utf8');
  const preload = fs.readFileSync(path.join(desktop, 'preload.js'), 'utf8');
  assert.match(main, /const TOTAL_MEMORY_ARG = '--vs-total-memory=';/);
  assert.match(preload, /const TOTAL_MEMORY_ARG = '--vs-total-memory=';/, 'o mesmo nome dos dois lados');
  assert.doesNotMatch(main + preload, /freemem/, 'nunca a memória livre');
});
