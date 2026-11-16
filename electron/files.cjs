// Fichiers de projet de la version bureau (V17) : fenêtres Ouvrir / Enregistrer sous du système, écriture sûre, fichiers récents.
// Appelé par main.cjs ; la page y accède par electron/preload.cjs (window.khFiles).
const { app, dialog, ipcMain, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const MAX_RECENT = 10;
const MAX_SIZE = 1024 * 1024 * 1024; // 1 Go : au-delà, ce n'est pas un projet raisonnable
const recentFile = () => path.join(app.getPath('userData'), 'recent-projects.json');
/** Fichiers que l'utilisateur a choisis lui-même dans cette session : seuls ceux-là (et les récents) peuvent être réécrits. */
const chosen = new Set();

function readRecent() {
  try { const l = JSON.parse(fs.readFileSync(recentFile(), 'utf8')); return Array.isArray(l) ? l.filter(p => typeof p === 'string') : []; } catch { return []; }
}
function writeRecent(list) { try { fs.writeFileSync(recentFile(), JSON.stringify(list.slice(0, MAX_RECENT))); } catch { /* dossier inaccessible */ } }
function remember(p) {
  chosen.add(p);
  writeRecent([p, ...readRecent().filter(x => x !== p)]);
  try { app.addRecentDocument(p); } catch { /* hors macOS/Windows */ }
}
const info = p => ({ path: p, name: path.basename(p, path.extname(p)) });
const isKhm = p => typeof p === 'string' && path.isAbsolute(p) && path.extname(p).toLowerCase() === '.khm';

function read(p) {
  const st = fs.statSync(p);
  if (!st.isFile() || st.size > MAX_SIZE) throw new Error('not a project file');
  return { ...info(p), text: fs.readFileSync(p, 'utf8') };
}
/** Écriture sûre : fichier temporaire à côté, puis remplacement d'un coup ; un plantage pendant l'écriture ne laisse jamais un fichier à moitié écrit. */
function write(p, text) {
  if (Buffer.byteLength(text) > MAX_SIZE) throw new Error('too large');
  const tmp = path.join(path.dirname(p), `.${path.basename(p)}.${process.pid}.tmp`);
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, p);
}

/** Fichier .khm ouvert depuis le Finder avant ou après le démarrage. */
let pendingOpen = [];
function openFromSystem(p) {
  if (!isKhm(p)) return;
  let f; try { f = read(p); } catch { return; }
  remember(p);
  const win = BrowserWindow.getAllWindows()[0];
  if (win && !win.webContents.isLoading()) win.webContents.send('kh:file-opened', f); else pendingOpen.push(f);
}

function setup() {
  const win = e => BrowserWindow.fromWebContents(e.sender);
  ipcMain.handle('kh:open', async e => {
    const r = await dialog.showOpenDialog(win(e), { properties: ['openFile'], filters: [{ name: 'KH Music Pro', extensions: ['khm'] }] });
    if (r.canceled || !r.filePaths[0]) return null;
    const p = r.filePaths[0]; const f = read(p); remember(p); return f;
  });
  ipcMain.handle('kh:open-recent', (_e, p) => {
    if (!readRecent().includes(p)) throw new Error('not in recent files');
    try { const f = read(p); remember(p); return f; }
    catch (err) { writeRecent(readRecent().filter(x => x !== p)); throw new Error('missing'); }
  });
  ipcMain.handle('kh:save', (_e, p, text) => {
    // Seulement un fichier .khm choisi par l'utilisateur : la page ne peut pas écrire où elle veut.
    if (!isKhm(p) || !(chosen.has(p) || readRecent().includes(p))) throw new Error('not allowed');
    write(p, text); remember(p); return info(p);
  });
  ipcMain.handle('kh:save-as', async (e, name, text) => {
    const base = (String(name).replace(/[\\/:*?"<>|]/g, '_').trim() || 'Projet').replace(/\.khm$/i, '');
    const r = await dialog.showSaveDialog(win(e), { defaultPath: path.join(app.getPath('documents'), base + '.khm'), filters: [{ name: 'KH Music Pro', extensions: ['khm'] }] });
    if (r.canceled || !r.filePath) return null;
    const p = path.extname(r.filePath).toLowerCase() === '.khm' ? r.filePath : r.filePath + '.khm';
    write(p, text); remember(p); return info(p);
  });
  ipcMain.handle('kh:recent', () => readRecent().filter(p => fs.existsSync(p)).map(info));
  ipcMain.handle('kh:recent-clear', () => { writeRecent([]); try { app.clearRecentDocuments(); } catch { /* ignore */ } return true; });
  ipcMain.on('kh:edited', (e, on) => { try { win(e)?.setDocumentEdited(!!on); } catch { /* hors macOS */ } });
}
/** À appeler quand la page a fini de charger : lui remet les fichiers ouverts depuis le Finder pendant le démarrage. */
function flush(webContents) { for (const f of pendingOpen) webContents.send('kh:file-opened', f); pendingOpen = []; }

module.exports = { setup, openFromSystem, flush };
