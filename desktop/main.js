const { app, BrowserWindow, ipcMain, protocol, net, shell, session, Menu, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { resolveStatic } = require('./staticFiles');
const { LocalServer } = require('./localServer');
const { networkCheck, defaultGateway } = require('./networkCheck');
const exportFiles = require('./exportFiles');
const projectFiles = require('./projectFiles');
const selfUpdate = require('./selfUpdate');
const { separateStemsLocal, cancelStemSeparation, hasLocalDemucs } = require('./stemSeparatorLocal');
const drumPieces = require('./drumPieces');
const maestroVoice = require('./maestroVoice');
const maestroQwen = require('./maestroQwen');
const maestroVoiceDownload = require('./maestroVoiceDownload');
const lyricsReader = require('./lyricsReader');
const { initAntiTamper } = require('./antiTamper');
const licenseCache = require('./licenseCache');
const { deviceInfo } = require('./deviceInfo');

const SCHEME = 'vsstage';
const hasSingleInstance = app.requestSingleInstanceLock();
const webRoot = app.isPackaged ? path.join(process.resourcesPath, 'web') : path.join(__dirname, '..', 'dist');

// Origem fixa para o app guardar preferências e sessão entre aberturas.
protocol.registerSchemesAsPrivileged([
  // codeCache guarda o código já compilado pelo V8 dos arquivos servidos por este esquema: nas
  // aberturas seguintes o programa não compila o JS inteiro de novo.
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true } },
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

// Projeto com alteração não salva: a tela avisa, e fechar a janela ou sair do app pergunta antes.
let projectUnsaved = false;
let projectLabel = '';
let closeConfirmed = false;
let closeAsking = false;

ipcMain.on('project:unsaved', (event, state) => {
  if (!fromDirector(event)) return;
  projectUnsaved = Boolean(state && state.unsaved);
  projectLabel = state && typeof state.name === 'string' ? state.name.slice(0, 120) : '';
  // bolinha no botão vermelho de fechar, como nos apps do Mac
  if (process.platform === 'darwin' && win && !win.isDestroyed()) win.setDocumentEdited(projectUnsaved);
});

function needsSaveQuestion() {
  return projectUnsaved && !closeConfirmed && win && !win.isDestroyed();
}

// "Salvar": a tela salva (ou abre "Salvar Projeto..." se o projeto nunca foi salvo) e responde se deu certo.
function saveFromWindow() {
  return new Promise((resolve) => {
    if (!win || win.isDestroyed()) { resolve(false); return; }
    const wc = win.webContents;
    const done = (ok) => {
      ipcMain.removeListener('project:savedBeforeClose', onSaved);
      wc.removeListener('render-process-gone', onGone);
      resolve(ok);
    };
    const onSaved = (event, ok) => { if (event.sender === wc) done(Boolean(ok)); };
    const onGone = () => done(false);
    ipcMain.on('project:savedBeforeClose', onSaved);
    wc.on('render-process-gone', onGone);
    wc.send('project:saveBeforeClose');
  });
}

// "Salvar" de um músico pela rede local: a tela grava o projeto e responde como ficou
// ('saved', 'later', 'no_file' ou 'error'). Cada pedido tem número próprio: vários músicos
// podem apertar ao mesmo tempo.
let projectSaveSeq = 0;
const PROJECT_SAVE_TIMEOUT_MS = 120_000;
function askProjectSave() {
  return new Promise((resolve) => {
    if (!win || win.isDestroyed()) { resolve('error'); return; }
    const wc = win.webContents;
    const id = ++projectSaveSeq;
    let timer = null;
    const done = (status) => {
      clearTimeout(timer);
      ipcMain.removeListener('local:projectSaved', onSaved);
      wc.removeListener('render-process-gone', onGone);
      resolve(typeof status === 'string' ? status : 'error');
    };
    const onSaved = (event, replyId, status) => { if (event.sender === wc && replyId === id) done(status); };
    const onGone = () => done('error');
    timer = setTimeout(() => done('error'), PROJECT_SAVE_TIMEOUT_MS);
    ipcMain.on('local:projectSaved', onSaved);
    wc.on('render-process-gone', onGone);
    wc.send('local:saveProject', id);
  });
}

async function askBeforeClosing(quit) {
  if (closeAsking || !win || win.isDestroyed()) return;
  closeAsking = true;
  try {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    const { response } = await dialog.showMessageBox(win, {
      type: 'warning',
      buttons: ['Salvar', 'Não salvar', 'Cancelar'],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
      message: projectLabel ? `Salvar as alterações do projeto "${projectLabel}"?` : 'Salvar as alterações do projeto?',
      detail: 'Se não salvar, o que você mudou desde o último salvamento será perdido.',
    });
    if (response === 2) return;
    if (response === 0 && !(await saveFromWindow())) return;
    closeConfirmed = true;
  } finally {
    closeAsking = false;
  }
  if (quit) app.quit();
  else if (win && !win.isDestroyed()) win.close();
}

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

// A abertura (splash.html) canta a contagem 1-2-3-4, uma batida por etapa, e a última ("Pronto")
// cai em 1460 ms. Esperar além disso deixa a tela parada à toa: o app já estava pronto.
// 1550 ms deixa a contagem terminar e sai logo em seguida.
const SPLASH_MIN_MS = 1550;
const SPLASH_EXIT_MS = 380;
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
    setTimeout(showMain, 120);
    setTimeout(() => { if (splash && !splash.isDestroyed()) splash.close(); }, SPLASH_EXIT_MS + 120);
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
  projectUnsaved = false;
  closeConfirmed = false;
  // tela recarregada ou travada: o que ela avisou antes não vale mais
  win.webContents.on('did-navigate', () => { projectUnsaved = false; });
  win.webContents.on('render-process-gone', () => { projectUnsaved = false; });
  win.on('close', (event) => {
    if (!needsSaveQuestion()) return;
    event.preventDefault();
    void askBeforeClosing(false);
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
handle('applyLyricStyle', (style) => server.applyLyricStyle(style));
// Repertório do produtor na rede local (ver localRepertoire.js)
handle('refStatus', () => server.repertoire.status());
handle('refStart', () => { server.repertoire.start(); return server.repertoire.status(); });
handle('refPut', (songId, kind, data) => { server.repertoire.put(String(songId), String(kind), typeof data === 'string' ? data : Buffer.from(data)); });
handle('refTakeRequest', () => server.repertoire.takeRequest());
handle('setMusicianBook', (book) => server.setMusicianBook(book));
// medidores dos faders para o VS Stage Remote: muitas vezes por segundo, sem resposta
ipcMain.on('local:meters', (event, meters) => {
  if (fromDirector(event)) server.publishMeters(meters);
});
handle('networkCheck', async () => (await networkCheck(server, { appPath: process.execPath })).checks);
// Última conferência da conta, para abrir sem internet (ver licenseCache.js).
handle('licenseCacheLoad', () => licenseCache.load());
handle('licenseCacheSave', (userId, license) => licenseCache.save(userId, license));
handle('licenseCacheClear', () => licenseCache.clear());
// Quem é este Mac, para a regra de um Mac por vez em cada conta (ver deviceInfo.js).
handle('deviceInfo', () => deviceInfo());
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
// Projeto .vss pelo caminho do arquivo (salvar só a letra troca só o fim do arquivo)
handle('projectPickOpen', () => projectFiles.pickOpen(win));
handle('projectPickSave', (name) => projectFiles.pickSave(win, name));
handle('projectInfo', (filePath) => projectFiles.info(filePath));
handle('projectWriteTail', (filePath, opts) => projectFiles.writeTail(filePath, opts));
handle('projectWriteOpen', (filePath) => projectFiles.writeOpen(filePath));
handle('projectWriteData', (id, data) => projectFiles.writeData(id, data));
handle('projectWriteCopy', (id, srcPath, begin, size) => projectFiles.writeCopy(id, srcPath, begin, size));
handle('projectWriteClose', (id) => projectFiles.writeClose(id));
handle('projectWriteAbort', (id) => projectFiles.writeAbort(id));
handle('projectAppendOpen', (filePath, opts) => projectFiles.appendOpen(filePath, opts));
handle('projectAppendData', (id, data) => projectFiles.appendData(id, data));
handle('projectAppendCopy', (id, srcPath, begin, size) => projectFiles.appendCopy(id, srcPath, begin, size));
handle('projectAppendClose', (id, manifest) => projectFiles.appendClose(id, manifest));
handle('projectAppendAbort', (id) => projectFiles.appendAbort(id));
handle('projectGiveFile', (filePath, selector) => projectFiles.giveFile(win.webContents, filePath, selector));
handle('hasLocalDemucs', () => hasLocalDemucs());
handle('maestroVoices', () => maestroVoice.listVoices());
handle('maestroSpeak', (payload) => maestroVoice.renderNarration(payload));
handle('maestroVoiceStatus', () => maestroVoice.voiceStatus());
// música tocando: o download da voz pausa (não disputa a rede e o disco durante o show)
handle('maestroVoicePlaying', (playing) => { maestroVoiceDownload.setPaused(!!playing); lyricsReader.setPlaying(!!playing); });
// Leitor de letra (repertório do produtor): roda no Mac, sem internet e sem custo.
handle('lyricsReaderStatus', () => lyricsReader.status());
handle('lyricsReaderPrepare', () => lyricsReader.prepare());
handle('lyricsTranscribe', (wav, opts) => lyricsReader.transcribe(wav, { separate: !!opts?.separate }));
handle('lyricsTranscribeCancel', () => lyricsReader.cancel());
handle('separateStemsLocal', (filename, audioData) => separateStemsLocal(win, filename, audioData));
handle('cancelStemSeparation', () => cancelStemSeparation());
// Separação da BATERIA em peças (bumbo, caixa, pratos, tons): roda depois do Demucs.
handle('separateDrumPieces', (drumsWav) => drumPieces.separateDrumPieces(
  Buffer.from(drumsWav),
  (message) => { if (!win.isDestroyed()) win.webContents.send('separation:progress', { percent: 97, message }); },
));
handle('drumPiecesStatus', () => drumPieces.status());
// abre o painel do macOS onde se baixam as vozes premium (Luciana Premium) — grátis e local
handle('openVoiceSettings', () => maestroVoice.openVoiceSettings().then(() => true).catch(() => false));

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
  // Restos de atualizações que morreram no meio deixavam o .dmg (≈400 MB) em /tmp para sempre.
  selfUpdate.cleanLeftovers();
  server = new LocalServer({
    webRoot,
    storePath: path.join(app.getPath('userData'), 'rede-local.json'),
    version: app.getVersion(),
    onTransportCommand: (cmd) => {
      if (win && !win.isDestroyed()) win.webContents.send('remote:transport', cmd);
    },
    // conta nova, caderno salvo ou senha trocada pela rede: vai para o projeto aberto
    onAccountsChange: (change) => {
      if (win && !win.isDestroyed()) win.webContents.send('local:accounts', change);
    },
    // botão "Salvar" da Área do Músico
    onProjectSave: askProjectSave,
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

  // O antiTamper lê e calcula o hash do app.asar: fica fora do caminho da abertura, senão a
  // janela nasce com a tela presa (ver readIntegrityAsync em antiTamper.js).
  setImmediate(() => initAntiTamper());
  licenseCache.startClockWatch();

  createSplash();
  createWindow();
  setTimeout(() => finishSplash(true), SPLASH_MAX_MS);
  deliverPendingProject();
  app.on('activate', () => { if (!win) createWindow(); });

  // Voz brasileira do Maestro IA: baixa o modelo uma vez, em silêncio, 1 min depois de abrir
  // (só em Mac com chip Apple; em Intel a fala usa a voz do Mac).
  if (maestroQwen.supported()) setTimeout(() => maestroVoiceDownload.start(), 60_000).unref?.();
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
app.on('before-quit', (event) => {
  // Cmd+Q com alteração não salva: pergunta antes; os serviços só param quando sair de verdade
  if (needsSaveQuestion()) {
    event.preventDefault();
    void askBeforeClosing(true);
    return;
  }
  server?.stop();
  maestroVoiceDownload.stop();
  lyricsReader.stop();
  maestroQwen.stopHelper();
});
