/** V20 — Familles d'instruments : regroupement des classes AudioSet de YAMNet en familles,
 *  et choix du son de KH Music Pro le plus proche. Sans dépendance au navigateur (sert aussi au Worker). */

/** Pour une famille : classes AudioSet membres → son conseillé quand cette classe domine. */
export interface Family { id: string; classes: Record<number, string> }

/** Son de batterie : « drums:<kit> » (piste de batterie avec ce kit), sinon une clé de PRESETS. */
export const FAMILIES: Family[] = [
  { id: 'voice', classes: { 0: 'r_choir', 24: 'r_choir', 25: 'r_choir', 26: 'r_choir', 27: 'r_choir', 29: 'r_choir', 30: 'r_synthchoir', 31: 'r_choir', 32: 'r_choir', 249: 'r_choir', 250: 'r_choir' } },
  { id: 'piano', classes: { 148: 'r_piano', 147: 'r_piano', 155: 'r_clavinet' } },
  { id: 'epiano', classes: { 149: 'r_epiano' } },
  { id: 'organ', classes: { 150: 'r_drawbar', 151: 'r_drawbar', 152: 'r_drawbar', 204: 'r_drawbar' } },
  { id: 'aguitar', classes: { 138: 'r_steel', 141: 'r_steel', 134: 'r_nylon', 142: 'r_steel', 143: 'r_steel', 144: 'r_steel', 145: 'r_nylon', 146: 'r_nylon' } },
  { id: 'eguitar', classes: { 136: 'r_eguitar', 139: 'r_eguitar', 140: 'r_eguitar' } },
  { id: 'bass', classes: { 137: 'r_ebass', 189: 'r_contrabass' } },
  { id: 'drums', classes: { 157: 'drums:studio', 158: 'drums:electro', 159: 'drums:studio', 160: 'drums:studio', 161: 'drums:studio', 162: 'drums:studio', 163: 'drums:studio', 166: 'drums:studio', 167: 'drums:studio', 156: 'drums:percussion', 165: 'drums:percussion', 169: 'drums:percussion', 170: 'drums:percussion', 171: 'drums:percussion' } },
  { id: 'strings', classes: { 184: 'r_strings', 185: 'r_strings', 186: 'r_violin', 187: 'r_strings', 188: 'r_cello', 179: 'r_strings', 194: 'harp' } },
  { id: 'brass', classes: { 180: 'r_brass', 181: 'r_brass', 182: 'r_trumpet', 183: 'r_trombone' } },
  { id: 'wind', classes: { 190: 'r_flute', 191: 'r_flute', 192: 'r_sax', 193: 'r_flute', 203: 'r_sax' } },
  { id: 'mallet', classes: { 174: 'r_marimba', 175: 'r_marimba', 176: 'r_vibes', 177: 'r_vibes', 178: 'r_steelpan', 173: 'bell', 195: 'bell', 200: 'bell' } },
  { id: 'synth', classes: { 153: 'pad', 154: 'pad', 208: 'lead' } },
];
/** Classe « Guitar » sans précision : comptée pour la guitare (acoustique ou électrique) la plus probable dans la même fenêtre. */
const GUITAR = 135, ACOUSTIC = 138, ELECTRIC = 136;

/** Toutes les classes utiles, dans l'ordre : le Worker ne renvoie que ces colonnes. */
export const USED: number[] = [...new Set([GUITAR, ...FAMILIES.flatMap(f => Object.keys(f.classes).map(Number))])].sort((a, b) => a - b);

/** Réglages mesurés sur les sons de l'application (voir docs/v20-du-son-a-la-sequence.md). */
export const TUNE = {
  /** une famille « s'entend » dans une fenêtre si sa probabilité y dépasse ce seuil */
  hear: 0.12,
  /** …et au moins cette fraction de la famille la plus probable dans la même fenêtre */
  rel: 0,
  /** part minimale des fenêtres sonores pour retenir une famille */
  presence: 0.08,
  /** fenêtre trop faible (RMS) pour compter : silence */
  silence: 0.003,
};

export interface FrameData {
  /** nombre de fenêtres */
  n: number;
  /** probabilités : n × USED.length (ligne = fenêtre) */
  scores: Float32Array;
  /** niveau RMS de chaque fenêtre */
  rms: Float32Array;
  /** variation d'enveloppe de chaque fenêtre (écart-type / moyenne des niveaux sur 20 ms) : bas = son tenu */
  flux: Float32Array;
}

export interface FamilyFound { family: string; score: number; presence: number; preset: string }

/** Probabilité de chaque famille dans une fenêtre. */
export function frameFamilies(row: (cls: number) => number): number[] {
  const g = row(GUITAR), ac = row(ACOUSTIC), el = row(ELECTRIC);
  return FAMILIES.map(f => {
    let m = 0;
    for (const k in f.classes) m = Math.max(m, row(+k));
    if (f.id === 'aguitar' && ac >= el) m = Math.max(m, g);
    if (f.id === 'eguitar' && el > ac) m = Math.max(m, g);
    return m;
  });
}

/** Résumé sur tout le morceau : familles entendues, triées de la plus sûre à la moins sûre. */
export function summarize(d: FrameData, tune = TUNE): FamilyFound[] {
  const col = new Map(USED.map((c, i) => [c, i]));
  const W = USED.length;
  let live = 0;
  const hits = FAMILIES.map(() => 0), sum = FAMILIES.map(() => 0);
  const votes = FAMILIES.map(() => new Map<string, number>());
  const flux: number[] = [];
  for (let i = 0; i < d.n; i++) {
    if (d.rms[i] < tune.silence) continue;
    live++;
    const row = (c: number) => d.scores[i * W + (col.get(c) ?? 0)];
    const fam = frameFamilies(row), top = Math.max(...fam);
    fam.forEach((v, j) => {
      if (v < tune.hear || v < tune.rel * top) return;
      hits[j]++; sum[j] += v;
      for (const k in FAMILIES[j].classes) { const p = FAMILIES[j].classes[+k]; votes[j].set(p, (votes[j].get(p) || 0) + row(+k)); }
      if (FAMILIES[j].id === 'synth') flux.push(d.flux[i]);
    });
  }
  if (!live) return [];
  const out: FamilyFound[] = [];
  FAMILIES.forEach((f, j) => {
    const presence = hits[j] / live;
    if (presence < tune.presence) return;
    let preset = '', best = -1;
    for (const [p, v] of votes[j]) if (v > best) { best = v; preset = p; }
    if (f.id === 'synth') preset = median(flux) < 0.25 ? 'pad' : 'lead';
    // confiance : probabilité moyenne quand on l'entend, ramenée vers 1 (les probabilités de YAMNet restent basses pour un instrument dans un mélange)
    const mean = sum[j] / hits[j];
    const score = Math.min(1, Math.sqrt(mean) * (0.6 + 0.4 * presence));
    out.push({ family: f.id, score, presence, preset });
  });
  return out.sort((a, b) => b.score - a.score);
}

const median = (a: number[]) => { if (!a.length) return 1; const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };

/** Variation d'enveloppe d'une fenêtre (blocs de 20 ms à 16 kHz). */
export function envelopeFlux(x: Float32Array, from: number, len: number): number {
  const B = 320, lv: number[] = [];
  for (let s = from; s + B <= from + len && s + B <= x.length; s += B) { let q = 0; for (let i = s; i < s + B; i++) q += x[i] * x[i]; lv.push(Math.sqrt(q / B)); }
  if (lv.length < 2) return 0;
  const m = lv.reduce((a, b) => a + b, 0) / lv.length;
  if (m < 1e-6) return 0;
  const v = lv.reduce((a, b) => a + (b - m) ** 2, 0) / lv.length;
  return Math.sqrt(v) / m;
}
