'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// Safe, minimal API surface for the renderer (ui/ui.js).
contextBridge.exposeInMainWorld('pk', {
  getInfo: () => ipcRenderer.invoke('pk:getInfo'),
  start: (port) => ipcRenderer.invoke('pk:start', port),
  stop: () => ipcRenderer.invoke('pk:stop'),
  getLogs: () => ipcRenderer.invoke('pk:getLogs'),
  openLogs: () => ipcRenderer.invoke('pk:openLogs'),
  copy: (text) => ipcRenderer.invoke('pk:copy', text),
  resetToken: () => ipcRenderer.invoke('pk:resetToken'),
  qr: (text) => ipcRenderer.invoke('pk:qr', text),
  onState: (cb) => ipcRenderer.on('pk:state', (_e, s) => cb(s)),
  onLog: (cb) => ipcRenderer.on('pk:log', (_e, l) => cb(l)),
});
