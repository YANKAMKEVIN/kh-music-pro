/**
 * Réglage « moteur audio natif » (version bureau macOS, quand le module natif est présent).
 * Activé : la carte son passe par Core Audio et Web Audio ne fait plus que le mixage. Désactivé (par défaut) : le navigateur.
 * Le choix est retenu sur l'appareil ; un échec rend toujours la main au navigateur, pour que le son ne s'arrête jamais.
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

function wanted(): boolean {
  try { if (localStorage.getItem(KEY) === '1') return true; } catch { /* stockage désactivé */ }
  return !!auBridge()?.forced;
}
function remember(on: boolean) { try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* stockage désactivé */ } }

/** Active ou désactive le moteur natif. Renvoie l'état obtenu. `quiet` : sans message de réussite (démarrage de l'application). */
export async function setNativeEngine(on: boolean, quiet = false): Promise<boolean> {
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
    remember(true);
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
      toast(t('nat.fail', nativeError), 'error');
      return false;
    }
  } finally { nativeBusy = false; }
}

/** Au démarrage : rallume le moteur natif s'il était activé. */
export function initNative() {
  if (nativeAvailable() && wanted()) void setNativeEngine(true, true);
}
