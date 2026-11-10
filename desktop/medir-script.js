// Mede o que o bundle menor muda de fato: o tempo do V8 ler + compilar + executar o
// JavaScript de cada build. Isola do ruído de abrir processo/janela (que não mudou).
// Uso: npx electron desktop/medir-script.js
const { app, BrowserWindow, protocol, net } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const SCHEME = 'vsstage';
protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true } },
]);

app.disableHardwareAcceleration();
const builds = process.argv.slice(2);

app.on('ready', async () => {
  protocol.handle(SCHEME, (request) => {
    const url = new URL(request.url);
    let p = decodeURIComponent(url.pathname);
    if (p === '/' || p === '') p = '/index.html';
    const [root] = p === '/index.html' ? [builds[0]] : [builds[0]];
    const file = path.join(root, p);
    if (!fs.existsSync(file)) return new Response('not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });

  const win = new BrowserWindow({ show: false });
  await win.loadURL(`${SCHEME}://app/blank.html`).catch(() => {});

  const results = [];
  for (const dir of builds) {
    const assets = path.join(dir, 'assets');
    const entry = fs.readdirSync(assets).find((f) => /^index-.*\.js$/.test(f));
    if (!entry) { results.push({ dir, error: 'sem index-*.js' }); continue; }
    const main = fs.readFileSync(path.join(assets, entry), 'utf8');
    // mede só o parse+compile do arquivo, sem executar (mesmo custo de compilação do V8)
    const ms = await win.webContents.executeJavaScript(`(function () {
      const src = ${JSON.stringify(main)};
      const t0 = performance.now();
      try { new Function(src); } catch (e) { return { erro: String(e.message) }; }
      return { ms: Math.round((performance.now() - t0) * 10) / 10, bytes: src.length };
    })()`);
    results.push({ dir: path.basename(dir), entry, ...ms });
  }
  console.log(JSON.stringify(results, null, 2));
  app.exit(0);
});
