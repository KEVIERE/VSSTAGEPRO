const { contextBridge, ipcRenderer } = require('electron');

const call = (name) => (...args) => ipcRenderer.invoke(`local:${name}`, ...args);

contextBridge.exposeInMainWorld('vsLocal', {
  getInfo: call('getInfo'),
  start: call('start'),
  stop: call('stop'),
  publish: call('publish'),
  regeneratePin: call('regeneratePin'),
  kick: call('kick'),
  ackLyricsSave: call('ackLyricsSave'),
  networkCheck: call('networkCheck'),
  openAction: call('openAction'),
});

contextBridge.exposeInMainWorld('vsDesktop', {
  appReady: () => ipcRenderer.send('app:ready'),
  exportPickFolder: call('exportPickFolder'),
  exportPickFile: call('exportPickFile'),
  exportWrite: call('exportWrite'),
  exportFreeSpace: call('exportFreeSpace'),
  exportReveal: call('exportReveal'),
  checkUpdate: call('checkUpdate'),
  installUpdate: call('installUpdate'),
  separateStemsLocal: call('separateStemsLocal'),
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
});
