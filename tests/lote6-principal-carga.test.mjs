// Lote 6: o processo principal abre sem carregar os módulos de IA, voz e letra, nem o qrcode e o
// bcryptjs. Roda o main.js de verdade com um Electron de mentira (nada abre, nada é gravado).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const desktop = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'desktop');

const anything = new Proxy(function () {}, {
  get: (_t, k) => (k === 'then' ? undefined : k === Symbol.toPrimitive ? () => '' : anything),
  apply: () => anything,
  construct: () => anything,
});
const handlers = new Set();
const fakeElectron = new Proxy({
  app: new Proxy({
    requestSingleInstanceLock: () => true,
    isPackaged: false,
    getPath: () => os.tmpdir(),
    getVersion: () => '0.0.0',
    whenReady: () => new Promise(() => {}), // a abertura não roda aqui: só a carga do arquivo
  }, { get: (t, k) => (k in t ? t[k] : anything) }),
  ipcMain: { handle: (name) => handlers.add(name), on: () => {}, removeListener: () => {} },
}, { get: (t, k) => (k in t ? t[k] : anything) });

test('main.js abre sem os módulos pesados; eles carregam na primeira chamada', () => {
  const origLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === 'electron') return fakeElectron;
    return origLoad.call(this, request, parent, isMain);
  };
  try {
    const before = new Set(Object.keys(require.cache));
    require(path.join(desktop, 'main.js'));
    const loaded = Object.keys(require.cache).filter((k) => !before.has(k)).map((k) => path.relative(desktop, k));
    for (const m of ['stemSeparatorLocal', 'drumPieces', 'maestroVoice', 'maestroClone', 'maestroQwen', 'maestroVoiceDownload', 'maestroPacks', 'lyricsReader']) {
      assert.ok(!loaded.includes(`${m}.js`), `${m} não carrega na abertura`);
    }
    assert.ok(!loaded.some((k) => k.includes(`${path.sep}qrcode${path.sep}`)), 'qrcode só com o primeiro QR');
    assert.ok(!loaded.some((k) => k.includes(`${path.sep}bcryptjs${path.sep}`)), 'bcryptjs só com a primeira senha');
    assert.ok(loaded.includes('localServer.js') && loaded.includes('antiTamper.js'), 'o resto continua na abertura');
    // os canais continuam todos lá
    for (const n of ['separateStemsLocal', 'separateDrumPieces', 'stemFilesRelease', 'cancelStemSeparation', 'maestroVoices', 'maestroCloneList', 'maestroPackStatus', 'lyricsReaderStatus', 'maestroVoicePlaying', 'deviceInfo', 'licenseCacheLoad']) {
      assert.ok(handlers.has(`local:${n}`), n);
    }
  } finally {
    Module._load = origLoad;
  }
});

test('preload: cada canal novo tem o seu handle no main.js', () => {
  const preload = fs.readFileSync(path.join(desktop, 'preload.js'), 'utf8');
  const main = fs.readFileSync(path.join(desktop, 'main.js'), 'utf8');
  for (const n of [...preload.matchAll(/call\('(\w+)'\)/g)].map((m) => m[1])) {
    assert.match(main, new RegExp(`handle\\('${n}'`), n);
  }
});
