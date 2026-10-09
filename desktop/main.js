const { app, BrowserWindow, ipcMain, protocol, net, shell, session, Menu } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');
const { resolveStatic } = require('./staticFiles');
const { LocalServer } = require('./localServer');
const { networkCheck, defaultGateway } = require('./networkCheck');
const exportFiles = require('./exportFiles');
const selfUpdate = require('./selfUpdate');

const SCHEME = 'vsstage';
const webRoot = app.isPackaged ? path.join(process.resourcesPath, 'web') : path.join(__dirname, '..', 'dist');

// Origem fixa para o app guardar preferências e sessão entre aberturas.
protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

let win = null;
let server = null;
let splash = null;

const SPLASH_MIN_MS = 2400;
const SPLASH_EXIT_MS = 600;
const SPLASH_MAX_MS = 15000;

function createSplash() {
  splash = new BrowserWindow({
    width: 476,
    height: 323,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: true,
    roundedCorners: true,
    vibrancy: 'hud',
    visualEffectState: 'active',
    backgroundColor: '#00000000',
    center: true,
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  splash.webContents.on('will-navigate', (e) => { e.preventDefault(); finishSplash(true); });
  splash.once('ready-to-show', () => splash?.showInactive());
  splash.on('closed', () => { splash = null; });
  splash.loadFile(path.join(__dirname, 'splash.html'), { query: { v: app.getVersion() } });
}

const splashStarted = Date.now();
let appReady = false;
let splashLeaving = false;

function showMain() {
  if (win && !win.isDestroyed() && !win.isVisible()) { win.show(); win.focus(); }
}

// A janela principal só aparece pronta; a abertura sai em fade por cima dela.
function finishSplash(force) {
  if (splashLeaving) return;
  if (!force && !appReady) return;
  const wait = force ? 0 : Math.max(0, SPLASH_MIN_MS - (Date.now() - splashStarted));
  splashLeaving = true;
  setTimeout(() => {
    if (!splash || splash.isDestroyed()) { showMain(); return; }
    splash.webContents.executeJavaScript("window.postMessage('vs:leave', '*')").catch(() => {});
    setTimeout(showMain, 200);
    setTimeout(() => { if (splash && !splash.isDestroyed()) splash.close(); }, SPLASH_EXIT_MS + 200);
  }, wait);
}

const SETTINGS_URL = {
  firewall: 'x-apple.systempreferences:com.apple.settings.Security.extension?Firewall',
  network: 'x-apple.systempreferences:com.apple.Network-Settings.extension',
  sharing: 'x-apple.systempreferences:com.apple.Sharing-Settings.extension',
};

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#0a0b0d',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(`${SCHEME}://`)) { e.preventDefault(); if (/^https?:\/\//.test(url)) shell.openExternal(url); }
  });
  win.loadURL(`${SCHEME}://app/`);
  win.on('closed', () => { win = null; });
  if (splashLeaving) win.once('ready-to-show', showMain);
}

function fromDirector(event) {
  return win && event.sender === win.webContents;
}

function handle(name, fn) {
  ipcMain.handle(`local:${name}`, async (event, ...args) => {
    if (!fromDirector(event)) throw new Error('not_allowed');
    return fn(...args);
  });
}

ipcMain.on('app:ready', (event) => {
  if (!fromDirector(event)) return;
  appReady = true;
  finishSplash(false);
});

handle('getInfo', () => server.info());
handle('start', async () => { await server.start(); return server.info(); });
handle('stop', () => server.stop());
handle('publish', (payload) => server.publish(payload));
handle('regeneratePin', (role) => { server.regeneratePin(role); return server.info(); });
handle('kick', (id) => server.kick(String(id)));
handle('ackLyricsSave', () => server.ackLyricsSave());
handle('networkCheck', async () => (await networkCheck(server)).checks);
handle('openAction', async (action) => {
  if (action === 'router') {
    const gw = await defaultGateway();
    if (gw) await shell.openExternal(`http://${gw}`);
    return;
  }
  if (SETTINGS_URL[action]) await shell.openExternal(SETTINGS_URL[action]);
});

handle('exportPickFolder', (title) => exportFiles.pickFolder(win, title));
handle('exportPickFile', (name) => exportFiles.pickFile(win, name));
handle('exportWrite', (id, rel, data) => exportFiles.writeFile(id, rel, data));
handle('exportFreeSpace', (id) => exportFiles.freeSpace(id));
handle('exportReveal', (id, rel) => exportFiles.reveal(id, rel));

// Atualização silenciosa: confere, baixa, instala por cima do app atual e reabre —
// o cliente só vê uma barra de progresso dentro do próprio programa.
let updating = false;
handle('checkUpdate', (supabaseUrl) => selfUpdate.checkForUpdate(supabaseUrl));
handle('installUpdate', async (info) => {
  if (updating) throw new Error('update_in_progress');
  updating = true;
  try {
    const appPath = await selfUpdate.downloadAndInstall(info, (pct) => {
      if (win && !win.isDestroyed()) win.webContents.send('update:progress', pct);
    });
    selfUpdate.relaunchFromPath(appPath);
  } finally {
    updating = false;
  }
});

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{
      label: 'VS Stage',
      submenu: [
        { role: 'about', label: 'Sobre o VS Stage' },
        { type: 'separator' },
        { role: 'hide', label: 'Ocultar VS Stage' },
        { role: 'hideOthers', label: 'Ocultar Outros' },
        { role: 'unhide', label: 'Mostrar Todos' },
        { type: 'separator' },
        { role: 'quit', label: 'Encerrar VS Stage' },
      ],
    }] : []),
    {
      label: 'Arquivo',
      submenu: [isMac ? { role: 'close', label: 'Fechar Janela' } : { role: 'quit', label: 'Sair' }],
    },
    {
      label: 'Editar',
      submenu: [
        { role: 'undo', label: 'Desfazer' },
        { role: 'redo', label: 'Refazer' },
        { type: 'separator' },
        { role: 'cut', label: 'Recortar' },
        { role: 'copy', label: 'Copiar' },
        { role: 'paste', label: 'Colar' },
        { role: 'selectAll', label: 'Selecionar Tudo' },
      ],
    },
    {
      label: 'Visualizar',
      submenu: [
        { role: 'resetZoom', label: 'Tamanho Real' },
        { role: 'zoomIn', label: 'Ampliar' },
        { role: 'zoomOut', label: 'Reduzir' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Tela Cheia' },
      ],
    },
    {
      label: 'Janela',
      submenu: [
        { role: 'minimize', label: 'Minimizar' },
        { role: 'zoom', label: 'Zoom' },
        ...(isMac ? [{ type: 'separator' }, { role: 'front', label: 'Trazer Todas para a Frente' }] : []),
      ],
    },
    { role: 'help', label: 'Ajuda', submenu: [{ label: 'Site do VS Stage', click: () => shell.openExternal('https://vsstage-pro-showonline.bolt.host') }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  buildMenu();
  server = new LocalServer({ webRoot, storePath: path.join(app.getPath('userData'), 'rede-local.json'), version: app.getVersion() });

  protocol.handle(SCHEME, (request) => {
    const { file } = resolveStatic(webRoot, new URL(request.url).pathname);
    return net.fetch(pathToFileURL(file).toString());
  });

  // Projetos que a pessoa já abriu reabrem sem perguntar de novo a cada início.
  const fromApp = (url) => typeof url === 'string' && url.startsWith(`${SCHEME}://app`);
  session.defaultSession.setPermissionCheckHandler((_wc, permission, origin) => permission !== 'fileSystem' || fromApp(origin));
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => cb(permission !== 'fileSystem' || fromApp(wc.getURL())));

  createSplash();
  createWindow();
  setTimeout(() => finishSplash(true), SPLASH_MAX_MS);
  app.on('activate', () => { if (!win) createWindow(); });
});

app.on('window-all-closed', () => { app.quit(); });
app.on('before-quit', () => { server?.stop(); });
