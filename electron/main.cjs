// Version bureau de KH Music Pro : une fenêtre qui charge l'application construite (dossier dist/).
const { app, BrowserWindow, session, shell } = require('electron');
const fs = require('fs');
const path = require('path');

// Module natif (macOS) : plugins Audio Unit du Mac et carte son par Core Audio (V14b). Dans l'installateur, il est rangé
// hors de l'archive de l'application (Resources/native) ; en développement, c'est le résultat de la construction.
// KH_NATIVE=0 fait comme s'il était absent. S'il est là, la page peut s'en servir (plugins du Mac, réglage « moteur audio natif »)
// par un pont limité : l'isolation de contexte reste active et la page n'a jamais accès à Node (voir native-preload.cjs).
const MODULE = process.platform === 'darwin' && process.env.KH_NATIVE !== '0'
  ? [path.join(process.resourcesPath || '', 'native', 'kh_au_bridge.node'), path.join(__dirname, '..', 'native', 'kh-au-bridge', 'build', 'Release', 'kh_au_bridge.node')].find(f => fs.existsSync(f))
  : undefined;
const NATIVE = !!MODULE;
// KH_RT=1 : calcul audio de Chromium en priorité temps réel (option d'essai, effet non démontré).
if (NATIVE) app.commandLine.appendSwitch('enable-features', process.env.KH_RT === '1' ? 'SharedArrayBuffer,AudioWorkletRealtimeThread' : 'SharedArrayBuffer');

function createWindow() {
  const win = new BrowserWindow({
    width: 1500, height: 920, minWidth: 900, minHeight: 600, backgroundColor: '#060914', title: 'KH Music Pro', autoHideMenuBar: true,
    webPreferences: NATIVE
      ? { contextIsolation: true, nodeIntegration: false, sandbox: false, backgroundThrottling: false, preload: path.join(__dirname, 'native-preload.cjs'), additionalArguments: ['--kh-native=' + MODULE] }
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
