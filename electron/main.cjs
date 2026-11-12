// Version bureau de KH Music Pro : une fenêtre qui charge l'application construite (dossier dist/).
const { app, BrowserWindow, session, shell } = require('electron');
const path = require('path');

// Prototype V14b : KH_NATIVE=1 charge le pont Audio Unit natif (macOS). Il faut alors quitter le bac à sable
// pour le script de préchargement et partager la mémoire avec l'AudioWorklet (SharedArrayBuffer).
const NATIVE = process.env.KH_NATIVE === '1' && process.platform === 'darwin';
if (NATIVE) app.commandLine.appendSwitch('enable-features', 'SharedArrayBuffer');

function createWindow() {
  const win = new BrowserWindow({
    width: 1500, height: 920, minWidth: 900, minHeight: 600, backgroundColor: '#060914', title: 'KH Music Pro', autoHideMenuBar: true,
    webPreferences: NATIVE
      ? { contextIsolation: false, nodeIntegration: false, sandbox: false, backgroundThrottling: false, preload: path.join(__dirname, 'native-preload.cjs') }
      : { contextIsolation: true, nodeIntegration: false, sandbox: true },
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
