const { app, BrowserWindow, ipcMain, protocol, net, shell, session, Menu, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { resolveStatic } = require('./staticFiles');
const { LocalServer } = require('./localServer');
const { networkCheck, defaultGateway } = require('./networkCheck');
const exportFiles = require('./exportFiles');
const selfUpdate = require('./selfUpdate');
const { separateStemsLocal, cancelStemSeparation, hasLocalDemucs } = require('./stemSeparatorLocal');
const { initAntiTamper } = require('./antiTamper');

const SCHEME = 'vsstage';
const hasSingleInstance = app.requestSingleInstanceLock();
const webRoot = app.isPackaged ? path.join(process.resourcesPath, 'web') : path.join(__dirname, '..', 'dist');

// Origem fixa para o app guardar preferências e sessão entre aberturas.
protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

let win = null;
let server = null;
let splash = null;

// Projeto aberto no Finder (duplo clique no .vss): fica guardado até a janela escutar o canal.
const PROJECT_EXT = /\.(vss|vsc)$/i;
let pendingProjectPath = null;
let webReady = false;
let lastQueuedPath = null;
let queueCheckTimer = null;
// Projetos que a tela pode ler pelo protocolo (o caminho vem da janela, não da página).
const openedProjects = new Set();
// Menu principal desabilitado durante a troca de projeto.
let menuLocked = false;
let menuTemplate = null;

function lockMenu() {
  if (menuLocked) return;
  menuLocked = true;
  Menu.setApplicationMenu(null);
}

function unlockMenu() {
  if (!menuLocked) return;
  menuLocked = false;
  if (menuTemplate && win && !win.isDestroyed()) Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate));
}

/** A tela anotou a troca e já escuta de novo "project:open-file" (vem depois do project:taken). */
ipcMain.on('project:listenerReady', (event) => {
  if (!fromDirector(event)) return;
  if (queueCheckTimer) { clearTimeout(queueCheckTimer); queueCheckTimer = null; }
  deliverPendingProject();
});

// A tela respondeu (abriu, cancelou ou falhou): o menu volta e o mesmo arquivo pode ser pedido de novo.
ipcMain.on('project:taken', (event) => {
  if (!fromDirector(event)) return;
  if (queueCheckTimer) { clearTimeout(queueCheckTimer); queueCheckTimer = null; }
  pendingProjectPath = null;
  lastQueuedPath = null;
  unlockMenu();
});

// Projetos grandes (passam de 2 GiB) não podem ir pelo IPC: manda só o caminho e a tela lê pelo
// protocolo vsstage://project, que entrega o arquivo em pedaços para os áudios.
function sendProjectToWindow(filePath) {
  if (!win || win.isDestroyed()) return false;
  try {
    // macOS manda às vezes /private/var/... e às vezes /var/...: guarda o caminho real.
    const resolved = (() => { try { return fs.realpathSync(filePath); } catch { return path.resolve(filePath); } })();
    openedProjects.add(resolved);
    win.webContents.send('project:open-file', { name: path.basename(resolved), path: resolved });
    return true;
  } catch (err) {
    dialog.showErrorBox('Não foi possível abrir o projeto', err.message || String(err));
    return false;
  }
}

/**
 * Entrega o projeto guardado: na abertura, espera a splash sair para não avisar por cima do menu
 * principal; com o app aberto, a própria tela mostra o aviso "abrir mesmo assim?".
 */
function deliverPendingProject(force) {
  if (!pendingProjectPath || !webReady || !win || win.isDestroyed()) return;
  if (splash && !force) return;
  const filePath = pendingProjectPath;
  pendingProjectPath = null;
  if (!sendProjectToWindow(filePath)) {
    lastQueuedPath = null;
    unlockMenu();
  }
}

// "Arquivo --pasta/file.vss": no Mac o Finder costuma passar o caminho antes do segundo "--".
function takeProjectArg(argv) {
  const hit = (argv || []).find((a) => typeof a === 'string' && PROJECT_EXT.test(a) && fs.existsSync(a));
  return hit ? path.resolve(hit) : null;
}

function queueProjectPath(filePath) {
  if (!filePath) return;
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore();
    if (!win.isVisible() && !splash) win.show();
    win.focus();
  }
  // Pedir e já abrir o mesmo arquivo (menu "Abrir com" + aviso de instância): abre uma vez só.
  if (lastQueuedPath === filePath && (webReady || pendingProjectPath)) return;
  lastQueuedPath = filePath;
  pendingProjectPath = filePath;
  if (!webReady) return;
  lockMenu();
  if (queueCheckTimer) clearTimeout(queueCheckTimer);
  // Rede de segurança: tela que não responde não deixa o menu travado.
  queueCheckTimer = setTimeout(() => {
    queueCheckTimer = null;
    pendingProjectPath = null;
    lastQueuedPath = null;
    unlockMenu();
  }, 8000);
  deliverPendingProject();
}

const SPLASH_MIN_MS = 3800;
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
    backgroundColor: '#00000000',
    center: true,
    show: false,
    // a animação roda mesmo antes da janela ganhar foco (a abertura aparece sem roubar o foco)
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
  });
  splash.webContents.on('will-navigate', (e) => { e.preventDefault(); finishSplash(true); });
  splash.once('ready-to-show', () => {
    if (!splash || splash.isDestroyed()) return;
    splash.showInactive();
    // A animação começa só agora, com a janela na tela, e o tempo mínimo conta a partir daqui:
    // antes ela já tinha tocado escondida e a abertura aparecia parada no último quadro.
    splashShownAt = Date.now();
    splash.webContents.executeJavaScript("window.postMessage('vs:go', '*')").catch(() => {});
  });
  splash.on('closed', () => { splash = null; });
  splash.loadFile(path.join(__dirname, 'splash.html'), { query: { v: app.getVersion() } });
}

let splashShownAt = 0;
let appReady = false;
let splashLeaving = false;

function showMain() {
  if (win && !win.isDestroyed() && !win.isVisible()) { win.show(); win.focus(); }
  deliverPendingProject();
}

// A janela principal só aparece pronta; a abertura sai em fade por cima dela.
function finishSplash(force) {
  if (splashLeaving) return;
  if (!force && !appReady) return;
  const shownFor = splashShownAt ? Date.now() - splashShownAt : 0;
  const wait = force ? 0 : Math.max(0, SPLASH_MIN_MS - shownFor);
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
  webReady = true;
  finishSplash(false);
  deliverPendingProject();
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
handle('exportStreamOpen', (id, rel) => exportFiles.streamOpen(id, rel));
handle('exportStreamAppend', (streamId, chunk) => exportFiles.streamAppend(streamId, chunk));
handle('exportStreamClose', (streamId) => exportFiles.streamClose(streamId));
handle('exportStreamAbort', (streamId) => exportFiles.streamAbort(streamId));
handle('hasLocalDemucs', () => hasLocalDemucs());
handle('separateStemsLocal', (filename, audioData) => separateStemsLocal(win, filename, audioData));
handle('cancelStemSeparation', () => cancelStemSeparation());

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
      label: 'VS Stage Pro',
      submenu: [
        { role: 'about', label: 'Sobre o VS Stage Pro' },
        {
          label: 'Verificar Atualizações...',
          // Verificação manual: pede pro renderer checar na hora (reaproveita o mesmo
          // fluxo da barra automática) e mostrar o resultado, mesmo quando já está atualizado.
          click: () => { if (win && !win.isDestroyed()) win.webContents.send('update:manualCheck'); },
        },
        { type: 'separator' },
        { role: 'hide', label: 'Ocultar VS Stage Pro' },
        { role: 'hideOthers', label: 'Ocultar Outros' },
        { role: 'unhide', label: 'Mostrar Todos' },
        { type: 'separator' },
        { role: 'quit', label: 'Encerrar VS Stage Pro' },
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
        {
          label: 'Modo Show',
          // ⌘M abre e fecha o Modo Show (Esc também fecha); Minimizar foi para ⌥⌘M
          accelerator: 'CmdOrCtrl+M',
          click: () => { if (win && !win.isDestroyed()) win.webContents.send('menu:showMode'); },
        },
        { type: 'separator' },
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
        { role: 'minimize', label: 'Minimizar', accelerator: 'Alt+CmdOrCtrl+M' },
        { role: 'zoom', label: 'Zoom' },
        ...(isMac ? [{ type: 'separator' }, { role: 'front', label: 'Trazer Todas para a Frente' }] : []),
      ],
    },
    { role: 'help', label: 'Ajuda', submenu: [{ label: 'Site do VS Stage Pro', click: () => shell.openExternal('https://vsstagepro.com.br') }] },
  ];
  menuTemplate = template;
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

if (hasSingleInstance) app.whenReady().then(() => {
  buildMenu();
  server = new LocalServer({
    webRoot,
    storePath: path.join(app.getPath('userData'), 'rede-local.json'),
    version: app.getVersion(),
    onTransportCommand: (cmd) => {
      if (win && !win.isDestroyed()) win.webContents.send('remote:transport', cmd);
    },
  });

  protocol.handle(SCHEME, (request) => {
    const url = new URL(request.url);
    if (url.hostname === 'project') {
      const asked = decodeURIComponent(url.pathname.slice(1));
      let filePath = null;
      try { filePath = fs.realpathSync(asked); } catch { /* sem acesso */ }
      if (!filePath || !openedProjects.has(filePath)) return new Response('not_found', { status: 404 });
      return net.fetch(pathToFileURL(filePath).toString(), { headers: request.headers });
    }
    const { file } = resolveStatic(webRoot, url.pathname);
    return net.fetch(pathToFileURL(file).toString());
  });

  // Projetos que a pessoa já abriu reabrem sem perguntar de novo a cada início.
  const fromApp = (url) => typeof url === 'string' && url.startsWith(`${SCHEME}://app`);
  session.defaultSession.setPermissionCheckHandler((_wc, permission, origin) => permission !== 'fileSystem' || fromApp(origin));
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => cb(permission !== 'fileSystem' || fromApp(wc.getURL())));

  initAntiTamper();

  createSplash();
  createWindow();
  setTimeout(() => finishSplash(true), SPLASH_MAX_MS);
  deliverPendingProject();
  app.on('activate', () => { if (!win) createWindow(); });
});

app.on('open-file', (event, filePath) => {
  event.preventDefault();
  queueProjectPath(path.resolve(filePath));
});

app.on('second-instance', (_event, argv) => {
  const filePath = takeProjectArg(argv);
  if (filePath) queueProjectPath(filePath);
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }
});

const initialProject = takeProjectArg(process.argv);
if (initialProject) pendingProjectPath = initialProject;

if (!hasSingleInstance) app.quit();

app.on('window-all-closed', () => { app.quit(); });
app.on('before-quit', () => { server?.stop(); });
