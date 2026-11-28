// Retouches pures des notes : quantification, humanisation, légato (V19).
import { t } from '../i18n';
import { commit } from '../store';
import { snapTo } from '../types';
import { toast } from '../ui/dom';

/**
 * Recale les notes sélectionnées (ou toutes) sur la grille du piano roll. V19 : `str` = force (1 = sur la grille, 0,5 = à
 * mi-chemin, pour garder un peu du jeu), `swing` = les points pairs de la grille gardent leur place, les impairs sont retardés de
 * `swing` × une demi-division (même règle que le swing du séquenceur : 0,66 ≈ croches ternaires). À 100 % sans swing, la durée
 * est aussi recalée, comme avant ; sinon seul le début bouge et la durée est gardée.
 */
export function quantizeNotes(notes: { s: number; l: number }[], g: number, patLen: number, o: { str?: number; swing?: number } = {}) {
  const str = Math.max(0, Math.min(1, o.str ?? 1)), sw = Math.max(0, Math.min(1, o.swing ?? 0)), last = snapTo(Math.floor((patLen - 1e-6) / g) * g, g);
  for (const n of notes) {
    const k = Math.round(Math.min(snapTo(n.s, g), last) / g), target = k * g + (k % 2 ? sw * g * 0.5 : 0);
    if (str === 1 && !sw) { n.s = Math.min(snapTo(n.s, g), last); n.l = Math.max(g, Math.min(snapTo(n.l, g), patLen - n.s)); continue; }
    n.s = Math.round(Math.max(0, Math.min(patLen - 1 / 24, n.s + (target - n.s) * str)) * 1e4) / 1e4;
    n.l = Math.max(1 / 24, Math.min(n.l, patLen - n.s));
  }
  commit(); toast(t('toast.quantized', notes.length));
}
/** Humanise (V19) : décale chaque début d'au plus ± 0,12 pas (± 15 ms à 120 BPM) et chaque force d'au plus ± 12 %, selon `amt` (0..1). */
export function humanizeNotes(notes: { s: number; l: number; v: number }[], amt: number, patLen: number) {
  const a = Math.max(0, Math.min(1, amt)), r = () => Math.random() * 2 - 1;
  for (const n of notes) {
    n.s = Math.round(Math.max(0, Math.min(patLen - 1 / 24, n.s + r() * 0.12 * a)) * 1e4) / 1e4;
    n.l = Math.max(1 / 24, Math.min(n.l, patLen - n.s));
    n.v = Math.round(Math.max(0.05, Math.min(1, n.v * (1 + r() * 0.12 * a))) * 100) / 100;
  }
  commit(); toast(t('toast.humanized', notes.length));
}
/** Légato (V19) : chaque note dure jusqu'au début de la note suivante du clip (les notes d'un accord gardent la même fin). */
export function legatoNotes(notes: { s: number; l: number }[], all: { s: number }[], patLen: number) {
  const starts = [...new Set(all.map(n => n.s))].sort((a, b) => a - b);
  for (const n of notes) { const next = starts.find(x => x > n.s + 1e-6) ?? patLen; n.l = Math.max(1 / 24, next - n.s); }
  commit(); toast(t('toast.legato', notes.length));
}
