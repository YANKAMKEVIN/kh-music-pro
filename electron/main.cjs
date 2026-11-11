// Version bureau de KH Music Pro : une fenêtre qui charge l'application construite (dossier dist/).
const { app, BrowserWindow, session, shell } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1500, height: 920, minWidth: 900, minHeight: 600, backgroundColor: '#060914', title: 'KH Music Pro', autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  // Les liens externes s'ouvrent dans le navigateur, jamais dans l'application.
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', e => e.preventDefault());
}

app.whenReady().then(() => {
  // L'application n'a besoin que du micro et du MIDI ; tout le reste est refusé.
  const allowed = new Set(['media', 'midi', 'midiSysex']);
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(allowed.has(permission)));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));
  createWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
