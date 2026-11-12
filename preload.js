const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('electronAPI', {
  isDesktop: true,
  printCurrent: (opts) => ipcRenderer.invoke('print:current', opts),
  printHtml: (html, opts) => ipcRenderer.invoke('print:html', html, opts),
  listPrinters: () => ipcRenderer.invoke('printers:list'),
  getPrinter: () => ipcRenderer.invoke('printers:get'),
  setPrinter: (name) => ipcRenderer.invoke('printers:set', name),
  retry: () => ipcRenderer.invoke('app:retry'),
});
