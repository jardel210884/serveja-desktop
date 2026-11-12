const { app, BrowserWindow, ipcMain, Menu, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

const APP_URL = 'https://serveja.com.br';
const START_URL = APP_URL + '/admin';

const configFile = () => path.join(app.getPath('userData'), 'config.json');
function loadConfig() { try { return JSON.parse(fs.readFileSync(configFile(), 'utf8')); } catch { return {}; } }
function saveConfig(cfg) { fs.writeFileSync(configFile(), JSON.stringify(cfg, null, 2)); }
function setCfg(key, value) { const c = loadConfig(); if (value === undefined) delete c[key]; else c[key] = value; saveConfig(c); buildMenu(); }

// "Texto preto forte" vem ligado por padrão (térmica USB imprime clara sem isso)
const darkOn = () => loadConfig().dark !== false;

const DARK_CSS = `
  *, *::before, *::after { color: #000 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body, body * { font-weight: 700 !important; text-shadow: 0 0 0.4px #000, 0 0 0.4px #000; }
  hr, .divider, [class*="border"] { border-color: #000 !important; }
`;

let win;

function printSilent(webContents, opts = {}) {
  const cfg = loadConfig();
  const deviceName = opts.printer || cfg.printer || undefined;
  return new Promise((resolve) => {
    webContents.print({
      silent: true, printBackground: true, deviceName,
      margins: { marginType: 'none' }, copies: opts.copies || 1,
      ...(opts.pageSize ? { pageSize: opts.pageSize } : {}),
    }, (success, failureReason) => resolve({ success, failureReason }));
  });
}

async function applyDark(webContents) {
  if (darkOn()) { try { await webContents.insertCSS(DARK_CSS); } catch {} }
}

ipcMain.handle('print:current', async (e, opts) => {
  let key = null;
  if (darkOn()) { try { key = await e.sender.insertCSS('@media print {' + DARK_CSS + '}'); } catch {} }
  const r = await printSilent(e.sender, opts);
  if (key) { try { await e.sender.removeInsertedCSS(key); } catch {} }
  return r;
});

ipcMain.handle('print:html', async (_e, html, opts = {}) => {
  const printWin = new BrowserWindow({ show: false, webPreferences: { javascript: false } });
  try {
    await printWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    await applyDark(printWin.webContents);
    await new Promise((r) => setTimeout(r, 150));
    const r = await printSilent(printWin.webContents, opts);
    if (!r.success && r.failureReason !== 'cancelled') {
      dialog.showErrorBox('Falha na impressão', String(r.failureReason || 'erro desconhecido'));
    }
    return r;
  } finally { printWin.close(); }
});

ipcMain.handle('printers:list', (e) => e.sender.getPrintersAsync());
ipcMain.handle('printers:get', () => loadConfig().printer || null);
ipcMain.handle('printers:set', (_e, name) => { setCfg('printer', name); return true; });
ipcMain.handle('app:retry', () => win.loadURL(START_URL));

const TEST_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
  @page { margin: 0; } body { font-family: Arial, sans-serif; width: 72mm; padding: 3mm; margin: 0; }
  h1 { font-size: 22px; text-align: center; margin: 0 0 6px; } p { font-size: 14px; margin: 3px 0; }
  .big { font-size: 20px; } hr { border: 0; border-top: 1px dashed #000; }
</style></head><body>
  <h1>ServeJa</h1><hr><p>Teste de impressão direta</p><p class="big">LETRA GRANDE 123</p>
  <p>Texto normal - R$ 12,50</p><hr><p>${new Date().toLocaleString('pt-BR')}</p><br><br>
</body></html>`;

async function buildMenu() {
  const printers = win ? await win.webContents.getPrintersAsync() : [];
  const current = loadConfig().printer;
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Impressora', submenu: [
      { label: 'Padrão do Windows', type: 'radio', checked: !current, click: () => setCfg('printer', undefined) },
      { type: 'separator' },
      ...printers.map((p) => ({ label: p.displayName || p.name, type: 'radio', checked: current === p.name,
        click: () => setCfg('printer', p.name) })),
      { type: 'separator' },
      { label: 'Texto preto forte (negrito)', type: 'checkbox', checked: darkOn(), click: (m) => setCfg('dark', m.checked) },
      { type: 'separator' },
      { label: 'Atualizar lista', click: () => buildMenu() },
      { label: 'Imprimir teste', click: () => win.webContents.executeJavaScript(`window.electronAPI.printHtml(${JSON.stringify(TEST_HTML)})`) },
    ] },
    { label: 'Exibir', submenu: [
      { role: 'reload', label: 'Recarregar' }, { role: 'togglefullscreen', label: 'Tela cheia' },
      { role: 'zoomIn', label: 'Aumentar zoom' }, { role: 'zoomOut', label: 'Diminuir zoom' },
      { role: 'resetZoom', label: 'Zoom normal' }, { role: 'toggleDevTools', label: 'Ferramentas de desenvolvedor' },
    ] },
  ]));
}

// O ServeJa imprime abrindo uma janela em branco (window.open('')), escrevendo o
// cupom nela e chamando print(). Aqui trocamos isso por impressão direta, sem prévia.
const OVERRIDE_JS = `(() => {
  if (window.__servejaDesktop || !window.electronAPI) return;
  window.__servejaDesktop = true;
  window.print = () => window.electronAPI.printCurrent();
  const realOpen = window.open.bind(window);
  window.open = function (url, target, features) {
    if (url && url !== 'about:blank') return realOpen(url, target, features);
    let html = '', printed = false, timer = null;
    const doPrint = () => {
      if (printed) return; printed = true; clearTimeout(timer);
      window.electronAPI.printHtml(html);
    };
    const schedule = () => { clearTimeout(timer); timer = setTimeout(doPrint, 400); };
    const doc = {
      write: (...s) => { html += s.join(''); }, writeln: (...s) => { html += s.join('') + '\\n'; },
      open: () => { html = ''; }, close: () => schedule(), title: '',
      body: { set innerHTML(v) { html = v; }, get innerHTML() { return html; } },
    };
    return {
      document: doc, closed: false, opener: window, location: { href: 'about:blank' },
      print: () => doPrint(), focus() {}, blur() {}, moveTo() {}, resizeTo() {},
      close() { this.closed = true; }, addEventListener() {}, removeEventListener() {},
      set onload(fn) {}, setTimeout: (f, t) => setTimeout(f, t),
    };
  };
})();`;

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 800, title: 'ServeJa', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  win.maximize();
  win.loadURL(START_URL);
  win.webContents.on('dom-ready', () => { win.webContents.executeJavaScript(OVERRIDE_JS).catch(() => {}); });
  win.webContents.on('did-fail-load', (_e, code, _d, _u, isMainFrame) => {
    if (!isMainFrame || code === -3) return;
    win.loadFile(path.join(__dirname, 'offline.html'));
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(APP_URL)) { shell.openExternal(url); return { action: 'deny' }; }
    return { action: 'allow' };
  });
  buildMenu();
}

if (!app.requestSingleInstanceLock()) { app.quit(); } else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(createWindow);
  app.on('window-all-closed', () => app.quit());
}
