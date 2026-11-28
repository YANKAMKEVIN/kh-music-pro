// Économie d'énergie quand l'onglet est caché (téléphone en poche, autre application au premier plan).
//
// Choix (à garder) : une lecture, un enregistrement ou une écoute de l'entrée VOLONTAIRES ne sont jamais coupés.
// On ne met en veille le moteur audio (AudioContext.suspend) que s'il ne sert à rien : ni lecture ni enregistrement,
// aucune entrée audio ouverte (écoute de contrôle, accordeur), pas de moteur natif (version bureau), et seulement après
// HIDDEN_DELAY de discrétion, pour qu'un aller-retour rapide vers une autre application ne coupe rien.
// En veille, le fil audio du navigateur s'arrête : plus de calcul des effets et des plugins dans le vide.
// Réveil : au retour sur l'onglet, et de toute façon à la première note jouée (MIDI compris), car le moteur appelle
// ctx.resume() avant chaque note, pad, contrôle ou lecture.
// Le reste s'arrête déjà tout seul : l'affichage (requestAnimationFrame) est suspendu par le navigateur dans un onglet caché.

/** Délai avant la mise en veille d'un onglet caché, en millisecondes. */
export const HIDDEN_DELAY = 30_000;

export interface PowerState { playing: boolean; recording: boolean; inputOpen: boolean; native: boolean; running: boolean }

/** Le moteur peut-il être mis en veille sans rien couper de ce que l'utilisateur a lancé ? */
export const canSleep = (s: PowerState) => s.running && !s.playing && !s.recording && !s.inputOpen && !s.native;

interface EngineLike {
  ctx: { state: string; suspend(): Promise<void>; resume(): Promise<void> };
  playing: boolean; recording: false | string; inp?: unknown; native?: unknown;
}

/** Branche la mise en veille sur la visibilité de la page. Renvoie de quoi la débrancher (tests). */
export function initPowerSaving(engine: EngineLike, doc: Document = document, delay = HIDDEN_DELAY): () => void {
  let timer = 0, slept = false;
  const state = (): PowerState => ({ playing: engine.playing, recording: !!engine.recording, inputOpen: !!engine.inp, native: !!engine.native, running: engine.ctx.state === 'running' });
  const sleep = () => { timer = 0; if (doc.visibilityState === 'hidden' && canSleep(state())) { slept = true; engine.ctx.suspend().catch(() => { slept = false; }); } };
  const onChange = () => {
    clearTimeout(timer); timer = 0;
    if (doc.visibilityState === 'hidden') timer = window.setTimeout(sleep, delay);
    else if (slept) { slept = false; if (engine.ctx.state === 'suspended') engine.ctx.resume().catch(() => { /* reprise au prochain geste */ }); }
  };
  doc.addEventListener('visibilitychange', onChange);
  return () => { clearTimeout(timer); doc.removeEventListener('visibilitychange', onChange); };
}
