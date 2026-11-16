// Version bureau : fichiers de projet (.khm) sur le disque, sous window.khFiles (V17).
//
// La page reste isolée (contextIsolation, bac à sable) : elle n'a jamais accès au disque. Elle demande au processus principal
// d'ouvrir la fenêtre « Ouvrir » ou « Enregistrer sous » du système ; le processus principal n'écrit ou ne relit ensuite que
// les fichiers que l'utilisateur a lui-même choisis dans ces fenêtres (ou qui figurent dans ses fichiers récents).
// Ce script n'utilise que le module `electron` : il fonctionne dans le bac à sable, et native-preload.cjs le reprend.
const { contextBridge, ipcRenderer } = require('electron');

const str = v => String(v ?? '');
let onOpen = null;
const queued = [];
// Fichier ouvert depuis le Finder (double-clic sur un .khm, glisser sur l'icône du Dock) : remis à la page dès qu'elle écoute.
ipcRenderer.on('kh:file-opened', (_e, f) => { if (onOpen) onOpen(f); else queued.push(f); });

contextBridge.exposeInMainWorld('khFiles', {
  /** Fenêtre « Ouvrir » : { path, name, text } ou null si annulée. */
  open: () => ipcRenderer.invoke('kh:open'),
  /** Relit un fichier de la liste des récents. */
  openRecent: path => ipcRenderer.invoke('kh:open-recent', str(path)),
  /** Réécrit un fichier déjà choisi par l'utilisateur : { path, name }. */
  save: (path, text) => ipcRenderer.invoke('kh:save', str(path), str(text)),
  /** Fenêtre « Enregistrer sous » : { path, name } ou null si annulée. */
  saveAs: (name, text) => ipcRenderer.invoke('kh:save-as', str(name), str(text)),
  /** Fichiers récents, du plus récent au plus ancien : [{ path, name }]. */
  recent: () => ipcRenderer.invoke('kh:recent'),
  clearRecent: () => ipcRenderer.invoke('kh:recent-clear'),
  /** Fichier ouvert depuis le Finder. */
  onOpen: fn => { onOpen = typeof fn === 'function' ? fn : null; while (onOpen && queued.length) onOpen(queued.shift()); },
  /** Indique au Mac si le document a des changements non enregistrés (point dans le bouton de fermeture). */
  edited: on => ipcRenderer.send('kh:edited', !!on),
});
