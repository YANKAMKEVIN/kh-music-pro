/** Temps musical : signatures, tempo et changements de tempo, grilles et aimantation. */
import type { Clip, Project } from '../types';

/** Longueur d'une mesure en pas. Suit la signature rythmique du projet ouvert (4/4 = 16 pas, 3/4 = 12…). */
export let BAR = 16;
/** Longueur d'un temps en pas : la noire (4) ; en 6/8, 9/8 et 12/8 la noire pointée (6), en 5/8 et 7/8 la croche (2). */
export let BEAT = 4;
export const setBar = (steps: number, beat = 4) => { BAR = steps; BEAT = beat; };
/** Mesure en pas pour une signature : x/4 = 4x pas, x/8 = 2x pas. */
export const barSteps = (sig: number, den: number = 4) => Math.round(sig * 16 / (den === 8 ? 8 : 4));
/** Temps en pas : signatures composées (6/8, 9/8, 12/8) par noires pointées, autres x/8 par croches, x/4 par noires. */
export const beatSteps = (sig: number, den: number = 4) => (den === 8 ? (sig % 3 === 0 && sig > 3 ? 6 : 2) : 4);
/** Signatures proposées : valeur du menu (« 3 » pour 3/4, comme avant ; « 6/8 » pour les croches). */
/** Mode Live : calage du lancement en pas ; « au temps » (4) suit le temps de la signature (noire pointée en 6/8). */
export const liveQuant = (q: number) => (q === 4 ? BEAT : q || BAR);
export const SIGS: [number, 4 | 8][] = [[2, 4], [3, 4], [4, 4], [5, 4], [6, 4], [7, 4], [5, 8], [6, 8], [7, 8], [9, 8], [12, 8]];

/** Tempo en vigueur au pas `s` : le tempo de départ, puis les changements placés dans le morceau. */
export function bpmAt(p: Project, s: number): number {
  let b = p.bpm;
  for (const m of p.tempos ?? []) { if (m.s <= s) b = m.bpm; else break; }
  return b;
}
/** Secondes de son (dans le fichier) par pas, pour un clip audio : fixe s'il suit le tempo, sinon celle du tempo du morceau. */
export const srcStep = (p: Project, c: Clip) => (c.warp && c.srcBpm ? 15 / c.srcBpm : 15 / p.bpm);
/** Durée d'un pas (double-croche) au pas `s`, en secondes. */
export const durAt = (p: Project, s: number) => 15 / bpmAt(p, s);
/** Temps écoulé depuis le début du morceau jusqu'au pas `s`, en tenant compte des changements de tempo. */
export function timeOf(p: Project, s: number): number {
  let t = 0, pos = 0, bpm = p.bpm;
  for (const m of p.tempos ?? []) { if (m.s >= s) break; t += (m.s - pos) * 15 / bpm; pos = m.s; bpm = m.bpm; }
  return t + (s - pos) * 15 / bpm;
}

/** Grilles du piano roll : taille d'une division, en pas (un pas = une double-croche). */
export const GRIDS: Record<string, number> = { '16': 1, '32': 0.5, '8t': 4 / 3, '16t': 2 / 3, free: 1 / 6 };
/** Aimante une position sur la grille `g`, sans erreur d'arrondi cumulée. */
export const snapTo = (x: number, g: number) => Math.round(Math.round(x / g) * g * 1e4) / 1e4;
export const resOf = (c: Clip) => c.res ?? 1;
/** Change la résolution d'un motif de batterie en gardant chaque coup au plus près de sa place. */
export function setRes(c: Clip, res: number) {
  if (!c.drums) return;
  const old = resOf(c), n = Math.max(1, Math.round(c.patLen! * res));
  c.drums = c.drums.map(row => {
    const out = new Array(n).fill(0);
    row.forEach((v, i) => { if (v) { const j = Math.min(n - 1, Math.round(i / old * res)); out[j] = Math.max(out[j], v); } });
    return out;
  });
  if (res === 1) delete c.res; else c.res = res;
}
export const stepDur = (bpm: number) => 60 / bpm / 4;
