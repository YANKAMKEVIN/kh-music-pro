// Version bureau macOS : rend le module natif (plugins Audio Unit, carte son par Core Audio) accessible à la page, sous window.khNative.
//
// L'isolation de contexte reste active : la page n'a ni `require` ni accès à Node, seulement les fonctions listées ci-dessous,
// passées par contextBridge. Seul ce script de préchargement sort du bac à sable, parce qu'il doit charger le module natif.
// La mémoire partagée du son (SharedArrayBuffer) ne passe pas par contextBridge (« objet non copiable ») : la page la confie
// une fois par window.postMessage({ khSab, key }), le préchargement la garde sous cette clé et confirme par { khSabOk: key }.
// Les fonctions du pont reçoivent ensuite la clé à la place de la mémoire. La mémoire reste bien partagée (même processus).
const { contextBridge } = require('electron');
// Fichiers de projet (window.khFiles) : le même pont que hors module natif.
require('./preload.cjs');

const arg = process.argv.find(a => a.startsWith('--kh-native='));
let m = null;
try { if (arg) m = require(arg.slice('--kh-native='.length)); } catch (e) { console.warn('Module natif indisponible :', e.message); }

if (m) {
  const sabs = new Map();
  window.addEventListener('message', e => {
    const d = e.data;
    if (e.source !== window || !d || typeof d.key !== 'string' || !(d.khSab instanceof SharedArrayBuffer)) return;
    sabs.set(d.key, d.khSab);
    window.postMessage({ khSabOk: d.key }, '*');
  });
  const sab = key => { const s = sabs.get(String(key)); if (!s) throw new Error('mémoire partagée inconnue'); return s; };
  const str = v => (v === null || v === undefined ? v : String(v));
  const num = v => Number(v);
  // Options de la carte son : seules les clés connues, avec leur type.
  const ioOpts = o => {
    const r = {};
    for (const k of ['output', 'input']) if (k in (o || {})) r[k] = str(o[k]);
    for (const k of ['sampleRate', 'buffer', 'outTarget', 'inTarget', 'gain', 'inFirst']) if (o && o[k] !== undefined) r[k] = num(o[k]);
    return r;
  };
  contextBridge.exposeInMainWorld('khNative', {
    /** KH_NATIVE=1 : les scripts de vérification démarrent le moteur natif sans passer par le réglage. */
    forced: process.env.KH_NATIVE === '1',
    forget: key => { sabs.delete(String(key)); },
    list: () => m.list(),
    open: (key, type, sub, man, sr, ch, max) => m.open(sab(key), str(type), str(sub), str(man), num(sr), num(ch), num(max)),
    setParam: (id, address, value) => m.setParam(num(id), num(address), num(value)),
    params: id => m.params(num(id)),
    presets: id => m.presets(num(id)),
    setPreset: (id, n) => m.setPreset(num(id), num(n)),
    // État complet d'un plugin (V19, instruments) : chaîne base64.
    getState: id => (m.getState ? m.getState(num(id)) : ''),
    setState: (id, b64) => (m.setState ? m.setState(num(id), str(b64)) : false),
    info: id => m.info(num(id)),
    close: id => m.close(num(id)),
    // Fenêtre graphique du plugin (V17) : vue Cocoa du plugin ou vue générique d'Apple, dans une fenêtre native.
    uiOpen: id => (m.uiOpen ? m.uiOpen(num(id)) : null),
    uiClose: id => { if (m.uiClose) m.uiClose(num(id)); },
    uiIsOpen: id => (m.uiIsOpen ? m.uiIsOpen(num(id)) : false),
    uiPump: () => { if (m.uiPump) m.uiPump(); },
    ioStart: (key, o) => m.ioStart(sab(key), ioOpts(o)),
    ioStop: () => m.ioStop(),
    ioInput: (name, inTarget, inFirst) => (inTarget === undefined ? m.ioInput(str(name)) : inFirst === undefined ? m.ioInput(str(name), num(inTarget)) : m.ioInput(str(name), num(inTarget), num(inFirst))),
    ioStats: () => m.ioStats(),
    ioArm: t => m.ioArm(num(t)),
    ioResetStats: () => m.ioResetStats(),
    ioGain: g => m.ioGain(num(g)),
    ioDevices: () => m.ioDevices(),
  });
}
