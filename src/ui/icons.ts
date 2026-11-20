import { TrackType } from '../types';

/**
 * Icônes de l'application : dessins au trait, tous de la même épaisseur, dans une grille de 24 × 24. Ils prennent la couleur
 * du texte qui les entoure (`currentColor`) : celle de la piste, ou celle de l'état du bouton. Contrairement aux emojis, ils
 * ont le même dessin sur macOS, Windows, Linux et Android.
 * Chaque entrée est le tracé (attribut `d`) d'une icône.
 */
const PATHS = {
  // Types de piste
  drums: 'M4 10c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 10v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6M8.5 12.7v6M15.5 12.7v6M7 2.5l3.5 5M17 2.5l-3.5 5',
  synth: 'M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM7 5v7h2.5V5M11 5v7h2.5V5M15 5v7h2.5V5M8.2 12v7M12.2 12v7M16.2 12v7',
  audio: 'M12 3a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM6 11a6 6 0 0 0 12 0M12 17v4M8.5 21h7',
  // Mixeur
  fx: 'M12 3l9 4.5-9 4.5-9-4.5L12 3zM3 12l9 4.5 9-4.5M3 16.5L12 21l9-4.5',
  knob: 'M12 7a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM12 13.5l2.8-3.6M4.2 6.2l1.6 1.6M19.8 6.2l-1.6 1.6M12 2.5v2',
  bus: 'M3 7h4.5c5 0 5 10 10 10H21M3 17h4.5c1.6 0 2.7-1 3.6-2.4M21 7h-3.5c-1.6 0-2.7 1-3.6 2.4M18.5 4.5L21 7l-2.5 2.5M18.5 14.5L21 17l-2.5 2.5',
  speaker: 'M4 9.5v5h3.5l5 4v-13l-5 4H4zM16 9.2a4 4 0 0 1 0 5.6M18.6 6.6a7.6 7.6 0 0 1 0 10.8',
  bars: 'M5 20v-9M12 20V4M19 20v-6M3 20h18',
  // Projets, clips, notes
  trash: 'M4 7h16M9.5 7V4h5v3M6 7l1 13h10l1-13M10 11v6M14 11v6',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7.5V12l3 2',
  note: 'M6 3h9l4 4v14H6V3zM15 3v4h4M9 12h7M9 16h7',
} as const;
export type IconName = keyof typeof PATHS;

const NS = 'http://www.w3.org/2000/svg';
/** Une icône, décorative (le nom du bouton ou le texte voisin dit déjà ce qu'elle montre). */
export function icon(name: IconName, size = 18): SVGSVGElement {
  const svg = document.createElementNS(NS, 'svg'), path = document.createElementNS(NS, 'path');
  for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', width: String(size), height: String(size), fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false' })) svg.setAttribute(k, v);
  svg.classList.add('ico'); svg.dataset.ico = name;
  path.setAttribute('d', PATHS[name]); svg.append(path);
  return svg;
}
/** Icône d'un type de piste : batterie, instrument (clavier) ou audio (micro). */
export const typeIcon = (type: TrackType, size = 18) => icon(type, size);
