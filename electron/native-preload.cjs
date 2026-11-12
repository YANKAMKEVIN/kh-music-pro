// Prototype V14b (KH_NATIVE=1 seulement) : rend le pont Audio Unit natif accessible à la page, sous window.khNative.
// Hors de ce mode, la fenêtre garde son bac à sable complet et ce fichier n'est pas chargé.
const path = require('path');
try {
  window.khNative = require(path.join(__dirname, '..', 'native', 'kh-au-bridge', 'build', 'Release', 'kh_au_bridge.node'));
} catch (e) {
  console.warn('Pont Audio Unit indisponible :', e.message);
}
