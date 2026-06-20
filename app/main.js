'use strict';

/**
 * Phone Keyboard — Electron desktop app (main process).
 *
 * Runs the relay (server/relay.js) inside the app and exposes a window + a
 * menu-bar/tray icon to control it. Cross-platform: the same code packages to a
 * .dmg on macOS and an .AppImage/.deb on Linux.
 */

const { app, BrowserWindow, Tray, Menu, ipcMain, shell, clipboard, nativeImage } = require('electron');
const path = require('path');
const QRCode = require('qrcode');
const { createRelay } = require('../server/relay');

const DEFAULT_PORT = 8787;
const ASSETS = path.join(__dirname, 'assets');

let win = null;
let tray = null;
let trayAvailable = false;
let relay = null;
let currentPort = DEFAULT_PORT;

// Persist the token where the OS lets a packaged app write.
function makeRelay() {
  return createRelay({ configPath: path.join(app.getPath('userData'), 'pk-config.json') });
}

// --- window ---------------------------------------------------------------
function createWindow() {
  win = new BrowserWindow({
    width: 460,
    height: 720,
    resizable: true,
    minWidth: 400,
    minHeight: 560,
    title: 'Phone Keyboard',
    icon: path.join(ASSETS, 'icon.png'),
    backgroundColor: '#f4f5fb',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, 'ui', 'index.html'));

  win.on('close', (e) => {
    // Close to tray if we have one; otherwise let it really close (and quit).
    if (!app.isQuitting && trayAvailable) {
      e.preventDefault();
      win.hide();
    }
  });
}

function showWindow() {
  if (!win) createWindow();
  else {
    win.show();
    win.focus();
  }
}

// --- tray (menu bar) ------------------------------------------------------
function buildTray() {
  try {
    // Colored bubble icon (violet), matching the app icon — not a mono template.
    let img = nativeImage.createFromPath(path.join(ASSETS, 'tray.png'));
    if (!img.isEmpty()) img = img.resize({ width: 22, height: 22 });
    tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img);
    tray.setToolTip('Phone Keyboard');
    tray.on('click', showWindow);
    trayAvailable = true;
    refreshTrayMenu();
  } catch (e) {
    trayAvailable = false; // some Linux desktops have no tray support
  }
}

function refreshTrayMenu() {
  if (!tray) return;
  const running = relay && relay.running;
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: running ? `● Running on port ${currentPort}` : '○ Stopped', enabled: false },
      { type: 'separator' },
      running
        ? { label: 'Stop server', click: () => stopRelay() }
        : { label: 'Start server', click: () => startRelay(currentPort) },
      { label: 'Show window', click: showWindow },
      { label: 'Open logs in browser', enabled: !!running, click: openLogs },
      { type: 'separator' },
      { label: 'Quit Phone Keyboard', click: () => { app.isQuitting = true; app.quit(); } },
    ])
  );
}

// --- relay control --------------------------------------------------------
function pushState(extra) {
  const info = relay.getInfo();
  if (win && !win.isDestroyed()) win.webContents.send('pk:state', { ...info, ...extra });
  refreshTrayMenu();
  if (tray) tray.setToolTip(info.running ? `Phone Keyboard — running :${info.port}` : 'Phone Keyboard — stopped');
}

async function startRelay(port) {
  try {
    currentPort = Number(port) || DEFAULT_PORT;
    await relay.start(currentPort);
    pushState();
    return relay.getInfo();
  } catch (e) {
    pushState({ error: e.message });
    return { error: e.message };
  }
}

async function stopRelay() {
  await relay.stop();
  pushState();
  return relay.getInfo();
}

function openLogs() {
  if (relay.running) shell.openExternal(`http://localhost:${currentPort}/logs`);
}

// --- IPC ------------------------------------------------------------------
function wireIPC() {
  ipcMain.handle('pk:getInfo', () => relay.getInfo());
  ipcMain.handle('pk:start', (_e, port) => startRelay(port));
  ipcMain.handle('pk:stop', () => stopRelay());
  ipcMain.handle('pk:getLogs', () => relay.getLogs());
  ipcMain.handle('pk:openLogs', () => { openLogs(); });
  ipcMain.handle('pk:copy', (_e, text) => { clipboard.writeText(String(text || '')); });
  ipcMain.handle('pk:resetToken', () => { relay.resetToken(); pushState(); return relay.getInfo(); });
  ipcMain.handle('pk:qr', async (_e, text) => {
    if (!text) return null;
    try {
      return await QRCode.toDataURL(text, { margin: 1, width: 320, color: { dark: '#20223a', light: '#ffffff' } });
    } catch {
      return null;
    }
  });
}

// --- lifecycle ------------------------------------------------------------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', showWindow);

  app.whenReady().then(() => {
    // Hide the default File/Edit/View/Window/Help menu. On macOS keep a minimal
    // menu so the standard shortcuts (copy/paste, ⌘Q) still work.
    if (process.platform === 'darwin') {
      Menu.setApplicationMenu(
        Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }])
      );
    } else {
      Menu.setApplicationMenu(null);
    }

    relay = makeRelay();
    relay.on('log', (e) => { if (win && !win.isDestroyed()) win.webContents.send('pk:log', e); });
    relay.on('presence', () => pushState());

    wireIPC();
    createWindow();
    buildTray();

    app.on('activate', showWindow); // macOS dock click
  });

  app.on('window-all-closed', () => {
    // With a tray we keep running in the background; without one, quit.
    if (!trayAvailable) app.quit();
  });

  app.on('before-quit', async () => {
    app.isQuitting = true;
    if (relay) await relay.stop();
  });
}
