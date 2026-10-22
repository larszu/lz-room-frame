// Electron main process: one window (the app), the output window on a chosen screen, the
// control server for Crestron / Q-SYS / web remote, the outputs (NDI, stream, v4l2) and the
// network inputs. The framing itself runs in the renderer (src/engine).
const { app, BrowserWindow, ipcMain, screen, dialog, shell, protocol, net, Tray, Menu, nativeImage, systemPreferences } = require('electron');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { ControlServer } = require('./server.cjs');
const { Sinks, NetworkInput, probeNdi, hasFfmpeg } = require('./sinks.cjs');
const { Ptz } = require('./ptz.cjs');
const { AtemLink } = require('./atem.cjs');

const DEV = !!process.env.LZRF_DEV;
const token = crypto.randomBytes(16).toString('hex');
let win = null;
let tray = null;
let quitting = false;

// renderer timers must keep running when the window is hidden or minimized (room PCs)
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

// lzrf-app: the renderer (fetch of WASM and models works, unlike file://); lzrf-media: local video files
protocol.registerSchemesAsPrivileged([
  { scheme: 'lzrf-app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
  { scheme: 'lzrf-media', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => { if (win) { win.show(); win.focus(); } });

const sinks = new Sinks();
const network = new NetworkInput();
let pending = new Map();
let seq = 0;

function exec(line) {
  if (!win || win.isDestroyed()) return Promise.resolve('ERR app not ready');
  const id = ++seq;
  return new Promise((ok) => {
    const t = setTimeout(() => { pending.delete(id); ok('ERR timeout'); }, 3000);
    pending.set(id, (ans) => { clearTimeout(t); ok(ans); });
    win.webContents.send('lzrf:command', { id, line });
  });
}
ipcMain.on('lzrf:reply', (_e, { id, text }) => { const f = pending.get(id); if (f) { pending.delete(id); f(String(text)); } });

const server = new ControlServer({ exec, sinks, network, token });
sinks.onChange = () => server.pushSinkStatus();
ipcMain.on('lzrf:event', (_e, text) => server.event(String(text)));
ipcMain.on('lzrf:tracking', (_e, data) => server.tracking(data));

const ptz = new Ptz();
ipcMain.on('lzrf:ptz-config', (_e, cfg) => ptz.configure(cfg));
ipcMain.on('lzrf:ptz-send', (_e, packets) => ptz.send(packets));
ipcMain.on('lzrf:ptz-stop', () => ptz.stop());
ipcMain.handle('lzrf:ptz-status', () => ptz.state);
const atem = new AtemLink();
ipcMain.on('lzrf:atem-config', (_e, host) => atem.configure(String(host || '')));
ipcMain.on('lzrf:atem-box', (_e, ssrc, box, props) => atem.setBox(ssrc, box, props));
ipcMain.handle('lzrf:atem-status', () => atem.state);

function addresses() {
  return Object.values(os.networkInterfaces()).flat().filter((a) => a && a.family === 'IPv4' && !a.internal).map((a) => a.address);
}

let ndiInfo = null, ffmpegOk = null;
ipcMain.handle('lzrf:info', () => {
  ndiInfo ??= probeNdi();
  ffmpegOk ??= hasFfmpeg();
  return { httpPort: server.ports.http, tcpPort: server.ports.tcp, token, platform: process.platform, version: app.getVersion(), ndi: ndiInfo, ffmpeg: ffmpegOk, addresses: addresses() };
});
ipcMain.handle('lzrf:displays', () => {
  const primary = screen.getPrimaryDisplay().id;
  return screen.getAllDisplays().map((d, i) => ({ id: d.id, label: d.label || `Bildschirm ${i + 1}`, width: Math.round(d.size.width * d.scaleFactor), height: Math.round(d.size.height * d.scaleFactor), primary: d.id === primary }));
});
ipcMain.handle('lzrf:net-start', (_e, url) => {
  const r = network.start(String(url));
  return r.ok ? { ok: true, url: `http://127.0.0.1:${server.ports.http}/net.mjpg?t=${Date.now()}` } : r;
});
ipcMain.on('lzrf:net-stop', () => network.stop());
ipcMain.handle('lzrf:open-video', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Video', extensions: ['mp4', 'mov', 'm4v', 'webm', 'mkv'] }] });
  if (r.canceled || !r.filePaths[0]) return null;
  return `lzrf-media://file/${encodeURIComponent(r.filePaths[0])}`;
});
ipcMain.handle('lzrf:set-control', async (_e, c) => {
  try { await server.listen(c.http, c.tcp, c.enabled); return { ok: true }; }
  catch (e) {
    try { await server.listen(0, 0, false); } catch { /* keep going */ }
    return { ok: false, error: e.code === 'EADDRINUSE' ? 'Port ist belegt' : String(e.message || e) };
  }
});
ipcMain.handle('lzrf:autostart', (_e, on, hidden) => {
  if (process.platform === 'linux') return; // Linux: .desktop autostart, see docs
  app.setLoginItemSettings({ openAtLogin: !!on, args: hidden ? ['--hidden'] : [] });
});
ipcMain.on('lzrf:open-external', (_e, url) => { if (/^https?:\/\//.test(url)) shell.openExternal(url); });
ipcMain.on('lzrf:show-folder', (_e, what) => {
  const base = app.isPackaged ? path.join(process.resourcesPath, 'integrations') : path.join(__dirname, '..', 'docs', 'integrations');
  shell.openPath(what === 'docs' ? base : path.join(base, what));
});

function outputWindowOptions(features) {
  const m = /lzrfDisplay=(\d+)/.exec(features || '');
  const displays = screen.getAllDisplays();
  const d = (m && displays.find((x) => String(x.id) === m[1])) || displays.find((x) => x.id !== screen.getPrimaryDisplay().id) || screen.getPrimaryDisplay();
  const { x, y, width, height } = d.bounds;
  const own = d.id === screen.getPrimaryDisplay().id && displays.length === 1;
  return {
    x, y, width: own ? Math.round(width * 0.5) : width, height: own ? Math.round(height * 0.5) : height,
    frame: own, fullscreen: !own, autoHideMenuBar: true, backgroundColor: '#000000', title: 'LZ Room Frame – Ausgabe',
    webPreferences: { backgroundThrottling: false },
  };
}

function createWindow() {
  const hidden = process.argv.includes('--hidden');
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 380, minHeight: 600, show: !hidden, title: 'LZ Room Frame',
    backgroundColor: '#1E1F23',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), backgroundThrottling: false, contextIsolation: true, sandbox: false },
  });
  win.webContents.setWindowOpenHandler(({ frameName, features }) => {
    if (frameName === 'lzrf-output' || frameName === 'lzrf-output-b') return { action: 'allow', overrideBrowserWindowOptions: outputWindowOptions(features) };
    if (/^https?:\/\//.test(frameName)) shell.openExternal(frameName);
    return { action: 'deny' };
  });
  win.webContents.on('did-create-window', (child) => { child.setMenuBarVisibility(false); });
  // cameras and microphones: allowed for the app itself
  win.webContents.session.setPermissionRequestHandler((_wc, perm, cb) => cb(['media', 'mediaKeySystem'].includes(perm)));
  win.webContents.session.setPermissionCheckHandler((_wc, perm) => perm === 'media');
  if (DEV) win.loadURL('http://localhost:4196');
  else win.loadURL('lzrf-app://app/index.html');
  // closing the window keeps the room running in the tray; quit from the tray menu
  win.on('close', (e) => { if (!quitting && tray) { e.preventDefault(); win.hide(); } });
}

function createTray() {
  const mac = process.platform === 'darwin';
  let icon = nativeImage.createFromPath(path.join(__dirname, mac ? 'trayTemplate.png' : 'tray.png'));
  if (icon.isEmpty()) return;
  if (mac) icon.setTemplateImage(true); else icon = icon.resize({ width: 24, height: 24 });
  tray = new Tray(icon);
  tray.setToolTip('LZ Room Frame');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Öffnen', click: () => { win.show(); win.focus(); } },
    { type: 'separator' },
    { label: 'Beenden', click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on('click', () => { win.show(); win.focus(); });
}

app.whenReady().then(async () => {
  const dist = path.join(__dirname, '..', 'dist');
  protocol.handle('lzrf-app', (req) => {
    const rel = decodeURIComponent(new URL(req.url).pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.normalize(path.join(dist, rel));
    if (!file.startsWith(dist)) return new Response('forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).href);
  });
  protocol.handle('lzrf-media', async (req) => {
    const p = decodeURIComponent(new URL(req.url).pathname.slice(1));
    const res = await net.fetch(pathToFileURL(p).href, { headers: req.headers });
    const h = new Headers(res.headers); h.set('Access-Control-Allow-Origin', '*');
    return new Response(res.body, { status: res.status, headers: h });
  });
  if (process.platform === 'darwin') { try { await systemPreferences.askForMediaAccess('camera'); } catch { /* not needed */ } }
  try { await server.listen(4197, 4198, true); } catch (e) { console.warn('control server', e.message); await server.listen(0, 0, false).catch(() => {}); }
  createWindow();
  createTray();
});

app.on('before-quit', () => { quitting = true; sinks.stopAll(); network.stop(); ptz.close(); atem.close(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin' || !tray) app.quit(); });
app.on('activate', () => { if (win) win.show(); });
