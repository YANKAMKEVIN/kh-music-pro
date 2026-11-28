// Noms des notes (solfège selon la langue), étiquettes des touches du clavier d'ordinateur et des pads.
import { drumBank } from '../../audio/banks';
import { hasKey, lang, t } from '../../i18n';
import { Track } from '../../types';

export const SOLF = { fr: ['Do', 'Do#', 'Ré', 'Ré#', 'Mi', 'Fa', 'Fa#', 'Sol', 'Sol#', 'La', 'La#', 'Si'], es: ['Do', 'Do#', 'Re', 'Re#', 'Mi', 'Fa', 'Fa#', 'Sol', 'Sol#', 'La', 'La#', 'Si'], en: ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] };
export const isBlack = (p: number) => [1, 3, 6, 8, 10].includes(p % 12);
export const noteName = (p: number) => SOLF[lang()][p % 12] + (Math.floor(p / 12) - 1);
/** Disposition réelle du clavier, quand le navigateur la donne (Chromium, version bureau) : code physique → lettre imprimée. */
let layout: Map<string, string> | null = null;
export function readKeyboardLayout(done: () => void) {
  const kbd = (navigator as unknown as { keyboard?: { getLayoutMap?: () => Promise<Map<string, string>> } }).keyboard;
  kbd?.getLayoutMap?.().then(m => { const before = layout && [...layout].join(); layout = m; if (before !== [...m].join()) done(); }).catch(() => { });
}
export const setKeyboardLayout = (m: Map<string, string> | null) => { layout = m; };
/** Étiquette d'une touche physique (code « KeyA », écrit ici « A ») : la lettre réellement imprimée sur le clavier quand on la connaît,
 *  sinon la disposition la plus probable selon la langue (AZERTY en français). */
export const keyLabel = (k: string) => {
  const real = /^[A-Z]$/.test(k) ? layout?.get('Key' + k) : undefined;
  if (real && /^\p{L}$/u.test(real)) return real.toUpperCase();
  return lang() === 'fr' ? ({ A: 'Q', Q: 'A', W: 'Z', Z: 'W' } as Record<string, string>)[k] ?? k : k;
};
export const PAD_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', 'A', 'S', 'D', 'F', 'G', 'H', 'J', 'K'];
export const padName = (tr: Track, r: number) => tr.pads?.[r]?.name ?? t(tr.kit === 'percussion' ? 'perc.' + r : drumBank(tr.kit) && hasKey('da' + r) ? 'da' + r : 'd' + r);
