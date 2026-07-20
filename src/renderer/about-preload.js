const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getCurrentVersion: () => ipcRenderer.invoke('about:get-version'),
  checkLatestRelease: () => ipcRenderer.invoke('about:check-latest'),
  openExternal: (url) => ipcRenderer.invoke('about:open-external', url),
});
