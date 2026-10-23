const { app, BrowserWindow, ipcMain, dialog, protocol, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { Readable } = require('stream');
const media = require('./media.cjs');
const exporter = require('./export.cjs');
const captions = require('./captions.cjs');
const updater = require('./updater.cjs');

const isDev = !!process.env.VITE_DEV_SERVER_URL;
let win = null;

protocol.registerSchemesAsPrivileged([
  { scheme: 'media', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, bypassCSP: true } },
]);

const MIME = {
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.aac': 'audio/aac',
  '.ogg': 'audio/ogg', '.flac': 'audio/flac', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp',
};

// media://local/<encoded absolute path> -> local file, with HTTP Range support so <video> can seek.
function registerMediaProtocol() {
  protocol.handle('media', async (request) => {
    const url = new URL(request.url);
    const filePath = decodeURIComponent(url.pathname.slice(1));
    let stat;
    try { stat = fs.statSync(filePath); } catch { return new Response('Not found', { status: 404 }); }
    const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    const range = request.headers.get('range');
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      let start = m && m[1] ? parseInt(m[1], 10) : 0;
      let end = m && m[2] ? parseInt(m[2], 10) : stat.size - 1;
      end = Math.min(end, stat.size - 1);
      if (start > end) return new Response('', { status: 416, headers: { 'Content-Range': `bytes */${stat.size}` } });
      const body = Readable.toWeb(fs.createReadStream(filePath, { start, end }));
      return new Response(body, {
        status: 206,
        headers: {
          'Content-Type': type, 'Accept-Ranges': 'bytes',
          'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': String(end - start + 1),
        },
      });
    }
    const body = Readable.toWeb(fs.createReadStream(filePath));
    return new Response(body, { status: 200, headers: { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': String(stat.size) } });
  });
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function buildMenu() {
  const menu = Menu.buildFromTemplate([
    {
      label: 'ملف',
      submenu: [
        { label: 'مشروع جديد', accelerator: 'CmdOrCtrl+N', click: () => send('menu', 'new') },
        { label: 'فتح مشروع…', accelerator: 'CmdOrCtrl+O', click: () => send('menu', 'open') },
        { label: 'حفظ', accelerator: 'CmdOrCtrl+S', click: () => send('menu', 'save') },
        { label: 'حفظ باسم…', accelerator: 'CmdOrCtrl+Shift+S', click: () => send('menu', 'saveAs') },
        { type: 'separator' },
        { label: 'استيراد وسائط…', accelerator: 'CmdOrCtrl+I', click: () => send('menu', 'import') },
        { label: 'تصدير الفيديو…', accelerator: 'CmdOrCtrl+E', click: () => send('menu', 'export') },
        { type: 'separator' },
        { label: 'خروج', role: 'quit' },
      ],
    },
    {
      label: 'تحرير',
      submenu: [
        { label: 'تراجع', accelerator: 'CmdOrCtrl+Z', click: () => send('menu', 'undo') },
        { label: 'إعادة', accelerator: 'CmdOrCtrl+Y', click: () => send('menu', 'redo') },
        { type: 'separator' },
        { label: 'قص', role: 'cut' }, { label: 'نسخ', role: 'copy' }, { label: 'لصق', role: 'paste' },
      ],
    },
    {
      label: 'عرض',
      submenu: [
        { label: 'تكبير', role: 'zoomIn' }, { label: 'تصغير', role: 'zoomOut' }, { label: 'الحجم الافتراضي', role: 'resetZoom' },
        { type: 'separator' },
        { label: 'ملء الشاشة', role: 'togglefullscreen' },
        ...(isDev ? [{ label: 'أدوات المطور', role: 'toggleDevTools' }] : []),
      ],
    },
    {
      label: 'مساعدة',
      submenu: [
        { label: 'التحقق من التحديثات', click: () => updater.checkNow(true) },
        { label: `الإصدار ${app.getVersion()}`, enabled: false },
      ],
    },
  ]);
  Menu.setApplicationMenu(menu);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1100, minHeight: 700,
    backgroundColor: '#15161a', title: 'مونتاج',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false },
  });
  if (isDev) win.loadURL(process.env.VITE_DEV_SERVER_URL);
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  if (process.env.MONTAJ_SELFTEST) selfTest(process.env.MONTAJ_SELFTEST);
  win.on('close', (e) => {
    if (win.__allowClose) return;
    e.preventDefault();
    send('menu', 'requestClose');
  });
}

// Development aid: MONTAJ_SELFTEST=<dir> loads <dir>/project.json if present, saves window screenshots there, then quits.
function selfTest(dir) {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  win.webContents.once('did-finish-load', async () => {
    const shot = async (name) => fs.writeFileSync(path.join(dir, name), (await win.webContents.capturePage()).toPNG());
    await wait(2500);
    await shot('empty.png');
    const projectFile = path.join(dir, 'project.json');
    if (fs.existsSync(projectFile)) {
      const steps = JSON.parse(fs.readFileSync(path.join(dir, 'steps.json'), 'utf8'));
      await win.webContents.executeJavaScript(`window.__montajTest.load(${fs.readFileSync(projectFile, 'utf8')})`);
      for (const s of steps) {
        await win.webContents.executeJavaScript(`window.__montajTest.seek(${s.time}); window.__montajTest.select(${JSON.stringify(s.select || null)})`);
        await wait(1500);
        await shot(s.name);
      }
    }
    win.__allowClose = true;
    app.quit();
  });
}

ipcMain.handle('app:confirmClose', () => { if (win) { win.__allowClose = true; win.close(); } });
ipcMain.handle('app:version', () => app.getVersion());

ipcMain.handle('dialog:importMedia', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'استيراد وسائط', properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'وسائط', extensions: ['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi', 'mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'jpg', 'jpeg', 'png', 'webp', 'bmp'] },
    ],
  });
  return r.canceled ? [] : r.filePaths;
});

ipcMain.handle('media:probe', async (_e, filePath) => media.probe(filePath));

ipcMain.handle('project:save', async (_e, { filePath, data, saveAs }) => {
  let target = filePath;
  if (!target || saveAs) {
    const r = await dialog.showSaveDialog(win, { title: 'حفظ المشروع', defaultPath: 'مشروعي.montaj', filters: [{ name: 'مشروع مونتاج', extensions: ['montaj'] }] });
    if (r.canceled) return null;
    target = r.filePath;
  }
  fs.writeFileSync(target, JSON.stringify(data, null, 2), 'utf8');
  return target;
});

ipcMain.handle('project:open', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'فتح مشروع', properties: ['openFile'], filters: [{ name: 'مشروع مونتاج', extensions: ['montaj'] }] });
  if (r.canceled) return null;
  const filePath = r.filePaths[0];
  return { filePath, data: JSON.parse(fs.readFileSync(filePath, 'utf8')) };
});

ipcMain.handle('export:chooseFile', async () => {
  const r = await dialog.showSaveDialog(win, { title: 'تصدير الفيديو', defaultPath: 'فيديو.mp4', filters: [{ name: 'MP4', extensions: ['mp4'] }] });
  return r.canceled ? null : r.filePath;
});

ipcMain.handle('export:start', async (_e, job) => exporter.run(job, (p) => send('export:progress', p)));
ipcMain.handle('export:cancel', () => exporter.cancel());
ipcMain.handle('export:reveal', (_e, p) => shell.showItemInFolder(p));

ipcMain.handle('captions:generate', async (_e, job) => captions.generate(job, (p) => send('captions:progress', p)));

ipcMain.handle('updater:install', () => updater.installNow());

app.whenReady().then(() => {
  registerMediaProtocol();
  buildMenu();
  createWindow();
  updater.init(send, app.isPackaged);
});

app.on('window-all-closed', () => app.quit());
