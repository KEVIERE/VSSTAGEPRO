const { contextBridge, ipcRenderer, webUtils } = require('electron');

const call = (name) => (...args) => ipcRenderer.invoke(`local:${name}`, ...args);

// RAM total do computador em bytes, lida uma vez. O principal manda no argumento da janela (mesmo
// nome em main.js); a reserva é a medida do Electron, em KB. 0: não deu para saber (a tela fica
// com a conta de hoje). Nunca a memória livre: no macOS ela não conta a que pode ser reaproveitada.
const TOTAL_MEMORY_ARG = '--vs-total-memory=';
function readTotalMemory() {
  try {
    const arg = (process.argv || []).find((a) => typeof a === 'string' && a.startsWith(TOTAL_MEMORY_ARG));
    const bytes = arg ? Number(arg.slice(TOTAL_MEMORY_ARG.length)) : NaN;
    if (Number.isFinite(bytes) && bytes > 0) return bytes;
  } catch { /* segue para a reserva */ }
  try {
    const kb = Number(process.getSystemMemoryInfo?.()?.total);
    if (Number.isFinite(kb) && kb > 0) return kb * 1024;
  } catch { /* sem a medida */ }
  return 0;
}

contextBridge.exposeInMainWorld('vsLocal', {
  getInfo: call('getInfo'),
  start: call('start'),
  stop: call('stop'),
  publish: call('publish'),
  regeneratePin: call('regeneratePin'),
  kick: call('kick'),
  ackLyricsSave: call('ackLyricsSave'),
  applyLyricStyle: call('applyLyricStyle'),
  refStatus: call('refStatus'),
  refStart: call('refStart'),
  refPut: call('refPut'),
  refTakeRequest: call('refTakeRequest'),
  setMusicianBook: call('setMusicianBook'),
  // medidores dos faders para o VS Stage Remote (sem esperar resposta)
  publishMeters: (meters) => ipcRenderer.send('local:meters', meters),
  onMusicianAccounts: (cb) => {
    const listener = (_event, change) => cb(change);
    ipcRenderer.on('local:accounts', listener);
    return () => ipcRenderer.removeListener('local:accounts', listener);
  },
  // "Salvar" de um músico: a tela grava o projeto e responde como ficou
  onProjectSaveRequest: (cb) => {
    const listener = async (_event, id) => {
      let status = 'error';
      try { status = String(await cb()); } catch { status = 'error'; }
      ipcRenderer.send('local:projectSaved', id, status);
    };
    ipcRenderer.on('local:saveProject', listener);
    return () => ipcRenderer.removeListener('local:saveProject', listener);
  },
  networkCheck: call('networkCheck'),
  openAction: call('openAction'),
});

contextBridge.exposeInMainWorld('vsDesktop', {
  // Arquitetura do programa: 'x64' é a versão Intel (num Mac Intel, ou traduzida pelo Rosetta num
  // Mac com chip Apple). A tela usa para ligar o modo leve, com menos efeitos de desenho.
  arch: process.arch,
  // RAM total em bytes (0 se não deu para saber): a tela decide quanto áudio guarda na memória.
  totalMemory: readTotalMemory(),
  appReady: () => ipcRenderer.send('app:ready'),
  // Caminho no disco de um arquivo aberto pela janela do navegador (projeto antigo nos recentes):
  // com ele o salvar usa o caminho rápido do app (só o que mudou) em vez de copiar o arquivo inteiro.
  pathForFile: (file) => {
    try { return webUtils.getPathForFile(file) || ''; } catch { return ''; }
  },
  exportPickFolder: call('exportPickFolder'),
  exportPickFile: call('exportPickFile'),
  exportWrite: call('exportWrite'),
  exportFreeSpace: call('exportFreeSpace'),
  exportReveal: call('exportReveal'),
  exportStreamOpen: call('exportStreamOpen'),
  exportStreamAppend: call('exportStreamAppend'),
  exportStreamClose: call('exportStreamClose'),
  exportStreamAbort: call('exportStreamAbort'),
  projectPickOpen: call('projectPickOpen'),
  projectPickSave: call('projectPickSave'),
  projectInfo: call('projectInfo'),
  projectLocate: call('projectLocate'),
  projectWriteTail: call('projectWriteTail'),
  projectWriteOpen: call('projectWriteOpen'),
  projectWriteData: call('projectWriteData'),
  projectWriteCopy: call('projectWriteCopy'),
  projectWriteClose: call('projectWriteClose'),
  projectWriteAbort: call('projectWriteAbort'),
  projectAppendOpen: call('projectAppendOpen'),
  projectAppendData: call('projectAppendData'),
  projectAppendCopy: call('projectAppendCopy'),
  projectAppendClose: call('projectAppendClose'),
  projectAppendAbort: call('projectAppendAbort'),
  projectGiveFile: call('projectGiveFile'),
  checkUpdate: call('checkUpdate'),
  installUpdate: call('installUpdate'),
  hasLocalDemucs: call('hasLocalDemucs'),
  maestroVoices: call('maestroVoices'),
  maestroSpeak: call('maestroSpeak'),
  maestroVoiceStatus: call('maestroVoiceStatus'),
  maestroSpeechReady: call('maestroSpeechReady'),
  maestroSpeechState: call('maestroSpeechState'),
  maestroSpeakCancel: call('maestroSpeakCancel'),
  maestroCloneList: call('maestroCloneList'),
  maestroClonePrepare: call('maestroClonePrepare'),
  maestroCloneSave: call('maestroCloneSave'),
  maestroCloneRemove: call('maestroCloneRemove'),
  maestroWarm: call('maestroWarm'),
  maestroPinPhrase: call('maestroPinPhrase'),
  maestroUnpinPhrase: call('maestroUnpinPhrase'),
  maestroPinnedStates: call('maestroPinnedStates'),
  maestroCountPackEnsure: call('maestroCountPackEnsure'),
  maestroCountPackStatus: call('maestroCountPackStatus'),
  maestroCountWord: call('maestroCountWord'),
  onMaestroCountPackProgress: (cb) => {
    const listener = (_e, p) => cb(p);
    ipcRenderer.on('maestroCountPack:progress', listener);
    return () => ipcRenderer.removeListener('maestroCountPack:progress', listener);
  },
  onMaestroCloneProgress: (cb) => {
    const listener = (_event, data) => cb(data);
    ipcRenderer.on('maestroClone:progress', listener);
    return () => ipcRenderer.removeListener('maestroClone:progress', listener);
  },
  maestroPackStatus: call('maestroPackStatus'),
  maestroPackFile: call('maestroPackFile'),
  onMaestroPackProgress: (cb) => {
    const listener = (_event, p) => cb(p);
    ipcRenderer.on('maestroPack:progress', listener);
    return () => ipcRenderer.removeListener('maestroPack:progress', listener);
  },
  maestroVoicePlaying: call('maestroVoicePlaying'),
  lyricsReaderStatus: call('lyricsReaderStatus'),
  lyricsReaderPrepare: call('lyricsReaderPrepare'),
  lyricsTranscribe: call('lyricsTranscribe'),
  lyricsTranscribeCancel: call('lyricsTranscribeCancel'),
  separateStemsLocal: call('separateStemsLocal'),
  cancelStemSeparation: call('cancelStemSeparation'),
  separateDrumPieces: call('separateDrumPieces'),
  // Faixas separadas deixadas no disco (separação pedida com `{ files: true }`): a tela lê cada
  // uma por este endereço e avisa quando terminou, para a pasta temporária sair.
  stemFileUrl: (token, name) => `vsstage://stems/${encodeURIComponent(String(token))}/${encodeURIComponent(String(name))}.wav`,
  stemFilesRelease: call('stemFilesRelease'),
  drumPiecesStatus: call('drumPiecesStatus'),
  openVoiceSettings: call('openVoiceSettings'),
  licenseCacheLoad: call('licenseCacheLoad'),
  licenseCacheSave: call('licenseCacheSave'),
  licenseCacheClear: call('licenseCacheClear'),
  deviceInfo: call('deviceInfo'),
  // Entrar com o Google pelo navegador padrão (ver googleAuth.js).
  googleAuthPrepare: call('googleAuthPrepare'),
  googleAuthWait: call('googleAuthWait'),
  googleAuthCancel: call('googleAuthCancel'),
  projectFileUrl: (filePath) => `vsstage://project/${encodeURIComponent(filePath)}`,
  onSeparationProgress: (cb) => {
    const listener = (_event, data) => cb(data);
    ipcRenderer.on('separation:progress', listener);
    return () => ipcRenderer.removeListener('separation:progress', listener);
  },
  onUpdateProgress: (cb) => {
    const listener = (_event, pct) => cb(pct);
    ipcRenderer.on('update:progress', listener);
    return () => ipcRenderer.removeListener('update:progress', listener);
  },
  onManualUpdateCheck: (cb) => {
    const listener = () => cb();
    ipcRenderer.on('update:manualCheck', listener);
    return () => ipcRenderer.removeListener('update:manualCheck', listener);
  },
  onMenuShowMode: (cb) => {
    const listener = () => cb();
    ipcRenderer.on('menu:showMode', listener);
    return () => ipcRenderer.removeListener('menu:showMode', listener);
  },
  // Atalhos de teclado do usuário: os itens do menu do programa mostram (e usam) a tecla escolhida.
  setMenuShortcuts: (map) => {
    const clean = {};
    if (map && typeof map === 'object') {
      for (const [id, acc] of Object.entries(map)) {
        if (typeof id === 'string' && typeof acc === 'string' && id.length <= 64 && acc.length <= 64) clean[id] = acc;
      }
    }
    ipcRenderer.send('menu:setShortcuts', clean);
  },
  onMenuCommand: (cb) => {
    const listener = (_event, id) => { if (typeof id === 'string') cb(id); };
    ipcRenderer.on('menu:command', listener);
    return () => ipcRenderer.removeListener('menu:command', listener);
  },
  onOpenProjectFile: (cb) => {
    const listener = (_event, file) => cb(file);
    ipcRenderer.on('project:open-file', listener);
    ipcRenderer.send('project:listenerReady');
    return () => ipcRenderer.removeListener('project:open-file', listener);
  },
  projectTaken: () => ipcRenderer.send('project:taken'),
  // Alteração não salva: fechar a janela ou sair do app pergunta Salvar / Não salvar / Cancelar.
  setProjectUnsaved: (unsaved, projectName) => ipcRenderer.send('project:unsaved', {
    unsaved: Boolean(unsaved),
    name: String(projectName ?? ''),
  }),
  onSaveBeforeClose: (cb) => {
    const listener = async () => {
      let ok = false;
      try { ok = Boolean(await cb()); } catch { ok = false; }
      ipcRenderer.send('project:savedBeforeClose', ok);
    };
    ipcRenderer.on('project:saveBeforeClose', listener);
    return () => ipcRenderer.removeListener('project:saveBeforeClose', listener);
  },
  onRemoteTransport: (cb) => {
    const listener = (_event, cmd) => cb(cmd);
    ipcRenderer.on('remote:transport', listener);
    return () => ipcRenderer.removeListener('remote:transport', listener);
  },
  notifySessionState: (active) => ipcRenderer.send('auth:sessionState', Boolean(active)),
});
