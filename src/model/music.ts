/** Musique : pads, couleurs, gammes et accords, notes GM de la batterie, kits. */
import type { Project } from '../types';

export const NPADS = 16;
export const COLORS = ['#22d3ee', '#a78bfa', '#f472b6', '#34d399', '#fbbf24', '#fb7185', '#60a5fa', '#c084fc'];
/** Gammes : intervalles en demi-tons. `parent` = gamme à 7 notes servant à construire les accords. */
export const SCALES: Record<string, { iv: number[]; parent?: string }> = {
  off: { iv: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], parent: 'major' },
  major: { iv: [0, 2, 4, 5, 7, 9, 11] }, minor: { iv: [0, 2, 3, 5, 7, 8, 10] }, dorian: { iv: [0, 2, 3, 5, 7, 9, 10] },
  pentaMaj: { iv: [0, 2, 4, 7, 9], parent: 'major' }, pentaMin: { iv: [0, 3, 5, 7, 10], parent: 'minor' }, blues: { iv: [0, 3, 5, 6, 7, 10], parent: 'minor' },
};
export const inScale = (p: Project, midi: number) => (SCALES[p.scale] ?? SCALES.off).iv.includes(((midi - p.key) % 12 + 12) % 12);
/** Note de la gamme la plus proche (vers le bas en cas d'égalité). */
export function snapToScale(p: Project, midi: number): number {
  for (let d = 0; d < 12; d++) { if (inScale(p, midi - d)) return midi - d; if (inScale(p, midi + d)) return midi + d; }
  return midi;
}
/** Accord construit par empilement de tierces dans la gamme du projet. */
export function chordOf(p: Project, midi: number, size: number): number[] {
  const sc = SCALES[p.scale] ?? SCALES.off, iv = (sc.parent ? SCALES[sc.parent] : sc).iv;
  const all: number[] = [];
  for (let o = -1; o < 11; o++) for (const i of iv) all.push(p.key + o * 12 + i);
  let k = 0;
  for (let i = 0; i < all.length; i++) if (all[i] <= midi) k = i;
  return Array.from({ length: size }, (_, j) => all[k + j * 2]).filter(n => n !== undefined && n <= 127);
}
/** Notes GM de la batterie, pour l'export et l'import MIDI. */
export const GM_DRUMS = [36, 38, 39, 42, 46, 45, 37, 56, 35, 40, 47, 50, 70, 49, 51, 63];

export const KITS: Record<string, { tune: number; dec: number }> = {
  electro: { tune: 1, dec: 1 }, deep: { tune: 0.8, dec: 1.6 }, tight: { tune: 1.25, dec: 0.6 },
  acoustic: { tune: 1, dec: 1 }, // batterie enregistrée (banque « drums »)
  percussion: { tune: 1, dec: 1 },
  studio: { tune: 1, dec: 1 }, // nuances et répétitions réellement enregistrées
};
