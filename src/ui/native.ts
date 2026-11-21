/**
 * Réglage « moteur audio natif » (version bureau macOS, quand le module natif est présent).
 * Activé (par défaut sur Mac depuis la décision de Kevin du 21/11/2026) : la carte son passe par Core Audio et Web Audio ne fait
 * plus que le mixage. Désactivé : le navigateur. Le choix de l'utilisateur est retenu sur l'appareil ; un échec rend toujours la main
 * au navigateur, pour que le son ne s'arrête jamais. Sans module natif (site web, Windows, Linux, KH_NATIVE=0), rien ne change.
 */
import { engine } from '../audio/engine';
import { auBridge } from '../audio/au';
import { ioBridge } from '../audio/native-io';
import { t } from '../i18n';
import { S } from '../store';
import { toast } from './dom';

const KEY = 'kh-native';
/** Le réglage n'apparaît que si le pont natif est là (version bureau macOS avec le module). */
export const nativeAvailable = () => !!ioBridge();
/** Dernier échec, affiché dans les Réglages audio jusqu'au prochain essai. */
export let nativeError = '';
export let nativeBusy = false;

/** Choix retenu sur l'appareil : '1' activé, '0' désactivé, null jamais choisi (le défaut s'applique). */
function stored(): string | null {
  try { return localStorage.getItem(KEY); } catch { return null; /* stockage désactivé */ }
}
/** Activé par défaut quand le module est là ; « Désactivé » dans les Réglages audio (retenu) ou KH_NATIVE=0 le coupent. */
function wanted(): boolean {
  return stored() !== '0' || !!auBridge()?.forced;
}
function remember(on: boolean) { try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* stockage désactivé */ } }

/**
 * Active ou désactive le moteur natif. Renvoie l'état obtenu. `quiet` : sans message de réussite (démarrage de l'application).
 * `auto` : allumage par défaut au démarrage, sans choix de l'utilisateur. Rien n'est retenu et un échec rend la main au
 * navigateur sans message d'erreur à l'écran (la raison reste affichée dans les Réglages audio).
 */
export async function setNativeEngine(on: boolean, quiet = false, auto = false): Promise<boolean> {
  if (nativeBusy) return !!engine.native;
  nativeBusy = true;
  try {
    if (!on) {
      remember(false); nativeError = '';
      await engine.stopNative();
      if (!quiet) toast(t('nat.stopped'));
      return false;
    }
    if (!nativeAvailable()) throw new Error('module');
    if (!auto) remember(true);
    try {
      const io = await engine.useNative();
      // Écouteurs branchés ou débranchés : le natif suit la sortie du système, ou s'y rabat si l'appareil choisi a disparu.
      io.onDevices = info => { if (!io.opts.output) S.outputDevice = ''; toast(`${t('aud.auto')} ${info.output}`); };
      if (S.outputDevice) await engine.setOutput(S.outputDevice);
      nativeError = '';
      if (!quiet) toast(t('nat.started'));
      return true;
    } catch (e) {
      nativeError = e instanceof Error ? e.message : String(e);
      // Le natif a pu changer la sortie du navigateur avant d'échouer : on la remet sur l'appareil choisi.
      if (engine.native) await engine.stopNative().catch(() => undefined); else await engine.setOutput(S.outputDevice);
      if (!auto) toast(t('nat.fail', nativeError), 'error');
      return false;
    }
  } finally { nativeBusy = false; }
}

let startup: Promise<boolean> = Promise.resolve(false);
/** Au démarrage : allume le moteur natif, sauf s'il a été désactivé dans les Réglages audio. Renvoie l'état obtenu. */
export function initNative(): Promise<boolean> {
  startup = nativeAvailable() && wanted() ? setNativeEngine(true, true, stored() !== '1' && !auBridge()?.forced) : Promise.resolve(false);
  return startup;
}
/** Fin de l'allumage du démarrage (vérifications de l'application empaquetée). */
export const nativeStartup = () => startup;
