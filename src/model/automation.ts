/** Automation et effets : courbes, contrôles joués, réglages d'effets normalisés, tranche fixe automatisable. */
import type { AutoParam, CtlKind, Insert, Pt, SynthParams, Track } from '../types';
import { uid } from './ids';

export const CTL_KINDS: CtlKind[] = ['pb', 'mod', 'at'];
/** Valeur de repos de chaque contrôle. */
export const CTL_REST: Record<CtlKind, number> = { pb: 0, mod: 0, at: 0 };
/** Vibrato de la molette à fond (cents), de l'aftertouch à fond (cents), et gonflement de volume de l'aftertouch à fond (gain). */
export const MOD_CENTS = 40, AT_CENTS = 20, AT_GAIN = 0.4;
/** Valeur d'un contrôle à la position `s` : la valeur de repos avant le premier point, puis la courbe. */
export const ctlAt = (pts: Pt[] | undefined, s: number, k: CtlKind) => (!pts?.length || s < pts[0].s - 1e-9 ? CTL_REST[k] : autoAt(pts, s));
export const AUTO: Record<AutoParam, { min: number; def: number }> = { vol: { min: 0, def: 1 }, pan: { min: -1, def: 0 }, filter: { min: -1, def: 0 }, rev: { min: 0, def: 0 }, dly: { min: 0, def: 0 }, chorus: { min: 0, def: 0 } };

/** Valeur d'une courbe d'automation (points triés) à la position `s`. */
export function autoAt(pts: Pt[], s: number): number {
  if (s <= pts[0].s) return pts[0].v;
  for (let i = 1; i < pts.length; i++) if (s < pts[i].s) { const a = pts[i - 1], b = pts[i]; return a.v + (b.v - a.v) * (s - a.s) / (b.s - a.s); }
  return pts[pts.length - 1].v;
}
/** Effets disponibles : pour chaque réglage [clé, minimum, maximum, pas, valeur par défaut]. */
export const FX: Record<string, [string, number, number, number, number][]> = {
  delay: [['time', 1, 8, 1, 3], ['fb', 0, 0.9, 0.01, 0.35], ['mix', 0, 1, 0.01, 0.3]],
  reverb: [['size', 0.3, 6, 0.1, 1.8], ['mix', 0, 1, 0.01, 0.25]],
  phaser: [['rate', 0.05, 5, 0.05, 0.5], ['depth', 0, 1, 0.01, 0.7], ['mix', 0, 1, 0.01, 0.5]],
  autopan: [['rate', 0.1, 8, 0.1, 1], ['depth', 0, 1, 0.01, 0.8]],
  eq: [['freq', 40, 12000, 10, 1000], ['gain', -18, 18, 0.5, 0], ['q', 0.3, 8, 0.1, 1]],
  gain: [['gain', -24, 24, 0.5, 0]],
  // Chaînes d'effets (21/11/2026) : les sept étages de la tranche fixe, devenus des effets comme les autres.
  filter: [['v', -1, 1, 0.01, 0]],
  drive: [['amt', 0, 1, 0.01, 0.3]],
  lofi: [['amt', 0, 1, 0.01, 0.3]],
  chorus: [['mix', 0, 1, 0.01, 0.5]],
  trem: [['depth', 0, 1, 0.01, 0.5]],
  eq3: [['low', -15, 15, 0.5, 0], ['mid', -15, 15, 0.5, 0], ['freq', 200, 8000, 10, 1000], ['high', -15, 15, 0.5, 0]],
  comp: [['thr', -60, 0, 1, -24], ['ratio', 1, 20, 0.5, 4]],
  wam: [],
};
/**
 * Étages de la tranche fixe, dans l'ordre où le son les traverse (filtre, saturation, lo-fi, chorus, trémolo, égaliseur,
 * compresseur). Une piste en mode « chaîne » n'a plus de tranche fixe : ces étages sont des effets de sa chaîne.
 * Ils ne comptent pas dans la limite de huit effets (sept au plus, un de chaque).
 */
export const STRIP_FX = ['filter', 'drive', 'lofi', 'chorus', 'trem', 'eq3', 'comp'] as const;
export type StripFx = typeof STRIP_FX[number];
export const isStripFx = (type: string): type is StripFx => (STRIP_FX as readonly string[]).includes(type);
/** Effets « ordinaires » d'une tranche (ceux qui comptent dans la limite de huit). */
export const fxCount = (tr: Track) => tr.inserts.filter(i => !isStripFx(i.type)).length;
// ---------- Automation des réglages d'effets (V17) ----------
// Clé « ins:<id de l'effet>:<réglage> » : réglage d'un effet intégré (clé de FX) ou adresse d'un réglage d'Audio Unit.
// La courbe va de 0 à 1 sur toute la plage du réglage (échelle logarithmique pour les fréquences).
export const insKey = (id: string, k: string) => `ins:${id}:${k}`;
export function parseInsKey(key: string): { id: string; k: string } | null { const m = /^ins:([^:]+):(.+)$/.exec(key); return m ? { id: m[1], k: m[2] } : null; }
/** La taille de la réverbération reconstruit sa réponse à chaque changement : elle n'est pas automatisable ; la saturation et le lo-fi
 *  (courbes recalculées) non plus, comme dans la tranche fixe. */
export const fxAutomatable = (type: string, k: string) => !!FX[type]?.some(d => d[0] === k) && !(type === 'reverb' && k === 'size') && !((type === 'drive' || type === 'lofi') && k === 'amt');
const fxDef = (type: string, k: string) => FX[type]?.find(d => d[0] === k);
const isLogRange = (min: number, max: number) => min > 0 && max / min >= 20;
export function fxFromNorm(type: string, k: string, v: number): number {
  const d = fxDef(type, k); if (!d) return v;
  const [, min, max] = d, x = isLogRange(min, max) ? min * Math.pow(max / min, v) : min + v * (max - min);
  return type === 'delay' && k === 'time' ? Math.round(x) : x;   // l'écho reste calé sur la grille (en pas)
}
export function fxToNorm(type: string, k: string, x: number): number {
  const d = fxDef(type, k); if (!d) return 0;
  const [, min, max] = d;
  return Math.min(1, Math.max(0, isLogRange(min, max) ? Math.log(x / min) / Math.log(max / min) : (x - min) / (max - min)));
}
/**
 * Automation de la tranche fixe et de l'instrument (suite, 21/11/2026) : clé `set:<champ de la piste ou de l'instrument>`,
 * courbe de 0 à 1 sur la plage du réglage, comme pour les effets. Égaliseur (gains et fréquence du médium), seuil et taux
 * du compresseur par rampes ;
 * coupure et résonance du filtre de l'instrument lues au départ de chaque note (une note tenue garde sa valeur).
 */
export const SET_AUTO: Record<string, { min: number; max: number; synth?: boolean }> = {
  eqLow: { min: -15, max: 15 }, eqMid: { min: -15, max: 15 }, eqHigh: { min: -15, max: 15 }, compThr: { min: -60, max: 0 },
  // Suite 3 (22/11/2026) : fréquence du médium et taux du compresseur, mêmes plages (logarithmiques) que dans la chaîne d'effets.
  eqMidF: { min: 200, max: 8000 }, compRatio: { min: 1, max: 20 },
  cutoff: { min: 80, max: 12000, synth: true }, reso: { min: 0, max: 18, synth: true },
};
export const setKey = (k: string) => `set:${k}`;
export const parseSetKey = (key: string): string | null => { const m = /^set:(.+)$/.exec(key); return m && SET_AUTO[m[1]] ? m[1] : null; };
export function setFromNorm(k: string, v: number): number {
  const d = SET_AUTO[k]; if (!d) return v;
  return isLogRange(d.min, d.max) ? d.min * Math.pow(d.max / d.min, v) : d.min + v * (d.max - d.min);
}
export function setToNorm(k: string, x: number): number {
  const d = SET_AUTO[k]; if (!d) return 0;
  return Math.min(1, Math.max(0, isLogRange(d.min, d.max) ? Math.log(x / d.min) / Math.log(d.max / d.min) : (x - d.min) / (d.max - d.min)));
}
/** Réglages de la piste automatisés par une courbe non vide (champs de SET_AUTO). */
export const setAutoKeys = (tr: Track): string[] => Object.keys(SET_AUTO).filter(k => tr.auto?.[setKey(k)]?.length);
/** Réglages de l'instrument au pas `s` : ceux de la piste, avec la coupure et la résonance prises sur leur courbe. */
export function synthAt(tr: Track, s: number): SynthParams {
  const sp = tr.synth!; let out = sp;
  for (const k of ['cutoff', 'reso'] as const) {
    const pts = tr.auto?.[setKey(k)];
    if (pts?.length) { if (out === sp) out = { ...sp }; out[k] = setFromNorm(k, autoAt(pts, s)); }
  }
  return out;
}
/** Bornes d'une courbe : minimum et valeur par défaut (réglages de la piste) ; 0 à 1 pour un réglage d'effet. */
export const autoMeta = (k: string): { min: number; def: number } => AUTO[k as AutoParam] ?? { min: 0, def: 0.5 };

export const newInsert = (type: string): Insert => ({ id: uid(), type, on: true, p: Object.fromEntries((FX[type] ?? []).map(([k, , , , d]) => [k, d])) });
