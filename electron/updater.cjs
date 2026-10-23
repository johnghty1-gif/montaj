const { autoUpdater } = require('electron-updater');

let send = () => {};
let enabled = false;
let manual = false;

function init(sendFn, isPackaged) {
  send = sendFn;
  enabled = isPackaged;
  if (!enabled) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => manual && send('updater', { state: 'checking' }));
  autoUpdater.on('update-available', (info) => send('updater', { state: 'available', version: info.version }));
  autoUpdater.on('update-not-available', () => manual && send('updater', { state: 'latest' }));
  autoUpdater.on('download-progress', (p) => send('updater', { state: 'downloading', progress: p.percent / 100 }));
  autoUpdater.on('update-downloaded', (info) => send('updater', { state: 'ready', version: info.version }));
  autoUpdater.on('error', (err) => manual && send('updater', { state: 'error', message: String(err && err.message || err) }));
  setTimeout(() => checkNow(false), 5000);
  setInterval(() => checkNow(false), 4 * 60 * 60 * 1000);
}

function checkNow(isManual) {
  manual = isManual;
  if (!enabled) {
    if (isManual) send('updater', { state: 'dev' });
    return;
  }
  autoUpdater.checkForUpdates().catch(() => {});
}

function installNow() {
  if (enabled) autoUpdater.quitAndInstall();
}

module.exports = { init, checkNow, installNow };
