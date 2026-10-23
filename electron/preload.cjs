const { contextBridge, ipcRenderer } = require('electron');

function on(channel, cb) {
  const handler = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld('api', {
  version: () => ipcRenderer.invoke('app:version'),
  confirmClose: () => ipcRenderer.invoke('app:confirmClose'),
  importMedia: () => ipcRenderer.invoke('dialog:importMedia'),
  probe: (filePath) => ipcRenderer.invoke('media:probe', filePath),
  saveProject: (args) => ipcRenderer.invoke('project:save', args),
  openProject: () => ipcRenderer.invoke('project:open'),
  chooseExportFile: () => ipcRenderer.invoke('export:chooseFile'),
  startExport: (job) => ipcRenderer.invoke('export:start', job),
  cancelExport: () => ipcRenderer.invoke('export:cancel'),
  revealFile: (p) => ipcRenderer.invoke('export:reveal', p),
  generateCaptions: (job) => ipcRenderer.invoke('captions:generate', job),
  installUpdate: () => ipcRenderer.invoke('updater:install'),
  importImages: () => ipcRenderer.invoke('dialog:importImage'),
  runJob: (kind, args) => ipcRenderer.invoke('job:run', { kind, args }),
  cancelJob: () => ipcRenderer.invoke('job:cancel'),
  ttsVoices: () => ipcRenderer.invoke('tts:voices'),
  onJobProgress: (cb) => on('job:progress', cb),
  onMenu: (cb) => on('menu', cb),
  onExportProgress: (cb) => on('export:progress', cb),
  onCaptionsProgress: (cb) => on('captions:progress', cb),
  onUpdater: (cb) => on('updater', cb),
  mediaUrl: (filePath) => 'media://local/' + encodeURIComponent(filePath),
});
