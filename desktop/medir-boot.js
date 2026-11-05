// Mede a abertura do programa: serve um build pelo mesmo esquema do app e conta os tempos até
// o primeiro desenho e até o React montar. Não mostra janela e não altera nada.
// Uso:  npx electron desktop/medir-boot.js <pasta-do-build> [codeCache=0|1]
const { app, BrowserWindow, protocol, net } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const webRoot = path.resolve(process.argv[2] || path.join(__dirname, '..', 'dist'));
const useCodeCache = process.argv[3] !== '0';
const SCHEME = 'vsstage';

protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: useCodeCache } },
]);

app.disableHardwareAcceleration();
const t0 = Date.now();

app.on('ready', () => {
  protocol.handle(SCHEME, (request) => {
    const url = new URL(request.url);
    let p = decodeURIComponent(url.pathname);
    if (p === '/' || p === '') p = '/index.html';
    const file = path.join(webRoot, p);
    if (!file.startsWith(webRoot) || !fs.existsSync(file)) return new Response('not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });

  const readyAt = Date.now() - t0;
  const win = new BrowserWindow({ show: false, width: 1440, height: 900, backgroundColor: '#0a0b0d' });
  const marks = {};
  win.webContents.once('dom-ready', () => { marks.domReady = Date.now() - t0; });
  win.webContents.once('did-finish-load', async () => {
    marks.finishLoad = Date.now() - t0;
    const paint = await win.webContents.executeJavaScript(`(function () {
      const p = performance.getEntriesByType('paint');
      const fp = p.find((e) => e.name === 'first-paint');
      const fcp = p.find((e) => e.name === 'first-contentful-paint');
      return { firstPaint: fp ? Math.round(fp.startTime) : null, firstContentfulPaint: fcp ? Math.round(fcp.startTime) : null };
    })()`).catch(() => ({}));
    await new Promise((r) => setTimeout(r, 2500));
    const after = await win.webContents.executeJavaScript(`(function () {
      const root = document.querySelector('#root');
      return { rootChildren: root ? root.children.length : -1, textLen: document.body.innerText.length };
    })()`).catch(() => ({}));
    console.log(JSON.stringify({ codeCache: useCodeCache, readyAt, ...marks, ...paint, ...after, total: Date.now() - t0 }));
    app.exit(0);
  });
  win.loadURL(`${SCHEME}://app/index.html`);
});
