import { t } from './i18n';

export type TrackType = 'drums' | 'synth' | 'audio';
export type Engine = 'sub' | 'fm' | 'pluck' | 'sampler' | 'multi';

/** p = hauteur MIDI, s = début (en pas), l = durée (en pas), v = vélocité 0..1. s et l peuvent être fractionnaires (triolets, triples-croches). */
export interface Note { p: number; s: number; l: number; v: number }

export interface Clip {
  id: string;
  name: string;
  /** position et durée sur la timeline, en pas (double-croches) */
  start: number;
  len: number;
  /** décalage dans le contenu : en pas pour les motifs, en secondes pour l'audio */
  offset: number;
  patLen?: number;
  /** Batterie : nombre de cases par pas (1 = doubles-croches, 2 = triples-croches, 0,75 = triolets de croches, 1,5 = triolets de doubles). */
  res?: number;
  drums?: number[][];
  notes?: Note[];
  bufferId?: string;
  gain?: number;
  /** fondus d'entrée et de sortie, en pas (clips audio) */
  fadeIn?: number; fadeOut?: number;
  /** Prises multiples (enregistrement en boucle) : décalage de chaque prise dans le son, et prise choisie. */
  takes?: number[]; take?: number;
}

/** Point d'automation : s = position (pas), v = valeur (volume 0..1, pan et filtre -1..1). */
export interface Pt { s: number; v: number }
export type AutoParam = 'vol' | 'pan' | 'filter';
export const AUTO: Record<AutoParam, { min: number; def: number }> = { vol: { min: 0, def: 1 }, pan: { min: -1, def: 0 }, filter: { min: -1, def: 0 } };

/** Valeur d'une courbe d'automation (points triés) à la position `s`. */
export function autoAt(pts: Pt[], s: number): number {
  if (s <= pts[0].s) return pts[0].v;
  for (let i = 1; i < pts.length; i++) if (s < pts[i].s) { const a = pts[i - 1], b = pts[i]; return a.v + (b.v - a.v) * (s - a.s) / (b.s - a.s); }
  return pts[pts.length - 1].v;
}

export interface SynthParams {
  preset: string;
  engine: Engine;
  wave: OscillatorType; wave2: OscillatorType;
  detune: number; mix2: number; octave: number;
  cutoff: number; reso: number; envAmt: number;
  a: number; d: number; s: number; r: number;
  pitchEnv: number;                       // chute de hauteur à l'attaque (demi-tons)
  ratio: number; fmAmt: number; fmDecay: number; // FM
  damp: number;                           // corde pincée
  bufferId?: string; sampleName?: string; root: number; // sampler
  bank?: string;                          // instrument échantillonné (moteur « multi »)
}

export interface Pad { bufferId: string; name: string }
/** Réglages d'un pad : volume (1 = normal), hauteur en demi-tons, panoramique. */
export interface PadFx { vol: number; tune: number; pan: number }

export interface Track {
  id: string; name: string; type: TrackType; color: string;
  vol: number; pan: number; mute: boolean; solo: boolean;
  eqLow: number; eqMid: number; eqHigh: number;
  comp: boolean; rev: number; dly: number;
  drive: number;   // saturation 0..1
  filter: number;  // -1..0 passe-bas, 0..1 passe-haut
  duck: number;    // sidechain : atténuation à chaque coup de kick, 0..1
  chorus: number; trem: number; crush: number; // modulation : chorus, trémolo (à la croche), lo-fi, 0..1
  auto?: Partial<Record<AutoParam, Pt[]>>;
  autoShow?: AutoParam | '';
  synth?: SynthParams;
  kit?: string;
  pads?: (Pad | null)[];
  padFx?: Record<number, PadFx>;
  clips: Clip[];
}

export interface Project {
  name: string; bpm: number; swing: number;
  loop: boolean; loopStart: number; loopLen: number;
  metronome: boolean; countIn: boolean;
  master: number; filter: number;
  revSize: number;                 // durée de la réverb (s)
  dlySteps: number; dlyFb: number; // écho : temps (pas) et répétitions 0..0,85
  key: number; scale: string;      // tonalité (0 = do) et gamme
  markers: { s: number; name: string }[]; // repères de la règle
  mLow: number; mMid: number; mHigh: number; // égaliseur du général (dB)
  width: number;                             // largeur stéréo : 0 mono, 1 normale, 2 élargie
  target: number;                            // niveau d'export en LUFS, 0 = simple protection des crêtes
  notes: string;                             // bloc-notes du projet (paroles, idées)
  punch: boolean;                            // enregistrement audio limité à la zone de boucle (punch-in / punch-out)
  tracks: Track[];
}

export const BAR = 16;

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
};

const BASE: Omit<SynthParams, 'preset'> = {
  engine: 'sub', wave: 'sawtooth', wave2: 'square', detune: 8, mix2: 0.4, octave: 0, cutoff: 2600, reso: 2, envAmt: 0.3,
  a: 0.005, d: 0.2, s: 0.6, r: 0.15, pitchEnv: 0, ratio: 1, fmAmt: 1.5, fmDecay: 0.3, damp: 0.5, root: 60,
};
type P = Partial<Omit<SynthParams, 'preset'>>;
/** Instrument échantillonné : l'enveloppe ne fait qu'adoucir l'attaque et la fin de la note. */
const real = (bank: string, a = 0.002, r = 0.3): P => ({ engine: 'multi', bank, cutoff: 16000, reso: 0.5, envAmt: 0, a, d: 0.2, s: 1, r });
const DEFS: [string, string, P][] = [
  ['r_piano', 'real', real('piano', 0.002, 0.35)], ['r_nylon', 'real', real('nylon', 0.002, 0.4)], ['r_eguitar', 'real', real('eguitar', 0.002, 0.3)],
  ['r_ebass', 'real', real('ebass', 0.002, 0.15)], ['r_abass', 'real', real('abass', 0.002, 0.2)],
  ['r_strings', 'real', real('strings', 0.04, 0.4)], ['r_cello', 'real', real('cello', 0.02, 0.3)], ['r_brass', 'real', real('brass', 0.01, 0.2)],
  ['r_sax', 'real', real('sax', 0.01, 0.2)], ['r_flute', 'real', real('flute', 0.01, 0.2)], ['r_choir', 'real', real('choir', 0.05, 0.5)],
  ['epiano', 'keys', { engine: 'fm', ratio: 1, fmAmt: 1.6, fmDecay: 0.35, cutoff: 7000, reso: 0.5, envAmt: 0, a: 0.003, d: 1.2, s: 0.25, r: 0.35 }],
  ['keys', 'keys', { wave: 'triangle', wave2: 'sine', detune: 3, mix2: 0.6, cutoff: 3200, reso: 0.5, envAmt: 0.2, a: 0.004, d: 0.5, s: 0.3, r: 0.3 }],
  ['organ', 'keys', { wave: 'sine', wave2: 'sine', detune: 1200, mix2: 0.6, cutoff: 6000, reso: 0.5, envAmt: 0, a: 0.01, d: 0.1, s: 1, r: 0.08 }],
  ['bass', 'bass', { detune: 5, mix2: 0.5, cutoff: 500, reso: 6, envAmt: 0.5, a: 0.003, d: 0.18, s: 0.5, r: 0.08 }],
  ['sub808', 'bass', { wave: 'sine', mix2: 0, cutoff: 900, reso: 0.5, envAmt: 0, a: 0.002, d: 1.4, s: 0.25, r: 0.25, pitchEnv: 14 }],
  ['fmbass', 'bass', { engine: 'fm', ratio: 1, fmAmt: 3, fmDecay: 0.12, cutoff: 2500, reso: 1, envAmt: 0, a: 0.002, d: 0.3, s: 0.45, r: 0.1 }],
  ['reese', 'bass', { wave2: 'sawtooth', detune: 28, mix2: 1, cutoff: 420, reso: 3, envAmt: 0.15, a: 0.01, d: 0.3, s: 0.9, r: 0.15 }],
  ['acid', 'bass', { mix2: 0, cutoff: 380, reso: 14, envAmt: 0.9, a: 0.003, d: 0.25, s: 0.3, r: 0.08 }],
  ['lead', 'lead', { cutoff: 2600, reso: 4, envAmt: 0.4 }],
  ['supersaw', 'lead', { wave2: 'sawtooth', detune: 32, mix2: 1, cutoff: 5200, reso: 1, envAmt: 0.15, a: 0.01, d: 0.3, s: 0.8, r: 0.3 }],
  ['brass', 'lead', { wave2: 'sawtooth', detune: 7, mix2: 0.7, cutoff: 1100, reso: 1.5, envAmt: 0.45, a: 0.05, d: 0.35, s: 0.75, r: 0.18 }],
  ['flute', 'lead', { wave: 'sine', wave2: 'triangle', detune: 4, mix2: 0.35, cutoff: 4200, reso: 0.5, envAmt: 0, a: 0.07, d: 0.2, s: 0.85, r: 0.2 }],
  ['square', 'lead', { wave: 'square', mix2: 0, cutoff: 3500, reso: 2, envAmt: 0.2, a: 0.004, d: 0.15, s: 0.7, r: 0.12 }],
  ['pluck', 'lead', { wave: 'triangle', wave2: 'sawtooth', detune: 6, mix2: 0.5, cutoff: 900, reso: 3, envAmt: 0.8, a: 0.002, d: 0.14, s: 0.05, r: 0.2 }],
  ['pad', 'pad', { wave2: 'sawtooth', detune: 14, mix2: 0.9, cutoff: 1400, reso: 1, envAmt: 0.1, a: 0.5, d: 0.6, s: 0.8, r: 0.9 }],
  ['strings', 'pad', { wave2: 'sawtooth', detune: 18, mix2: 0.8, cutoff: 3400, reso: 0.5, envAmt: 0, a: 0.22, d: 0.4, s: 0.85, r: 0.55 }],
  ['warm', 'pad', { wave: 'triangle', wave2: 'sine', detune: 9, mix2: 0.8, cutoff: 1800, reso: 0.5, envAmt: 0, a: 0.8, d: 0.8, s: 0.9, r: 1.4 }],
  ['guitar', 'plucked', { engine: 'pluck', damp: 0.5, cutoff: 5000, reso: 0.5, envAmt: 0, a: 0.002, d: 2, s: 0.6, r: 0.25 }],
  ['harp', 'plucked', { engine: 'pluck', damp: 0.2, cutoff: 8000, reso: 0.5, envAmt: 0, a: 0.002, d: 3, s: 0.8, r: 0.9 }],
  ['bell', 'bell', { engine: 'fm', ratio: 3.5, fmAmt: 2.5, fmDecay: 1.2, cutoff: 12000, reso: 0.5, envAmt: 0, a: 0.002, d: 2.5, s: 0, r: 1.5 }],
  ['vibes', 'bell', { engine: 'fm', ratio: 4, fmAmt: 0.7, fmDecay: 0.5, cutoff: 9000, reso: 0.5, envAmt: 0, a: 0.002, d: 3, s: 0, r: 1.2 }],
  ['kalimba', 'bell', { engine: 'fm', ratio: 5.5, fmAmt: 1.1, fmDecay: 0.04, cutoff: 7000, reso: 0.5, envAmt: 0, a: 0.002, d: 0.9, s: 0, r: 0.5 }],
  ['marimba', 'bell', { engine: 'fm', ratio: 4, fmAmt: 1.5, fmDecay: 0.08, cutoff: 9000, reso: 0.5, envAmt: 0, a: 0.002, d: 0.5, s: 0, r: 0.3 }],
  ['sampler', 'sampler', { engine: 'sampler', cutoff: 12000, reso: 0.5, envAmt: 0, a: 0.002, d: 0.2, s: 1, r: 0.15 }],
];
export const PRESETS: Record<string, { cat: string; p: Omit<SynthParams, 'preset'> }> =
  Object.fromEntries(DEFS.map(([id, cat, p]) => [id, { cat, p: { ...BASE, ...p } }]));
export const CATS = ['real', 'keys', 'bass', 'lead', 'pad', 'plucked', 'bell', 'sampler'];
export const makeSynth = (preset: string): SynthParams => ({ preset, ...(PRESETS[preset] ?? PRESETS.lead).p });

export const uid = () => Math.random().toString(36).slice(2, 10);
export const stepDur = (bpm: number) => 60 / bpm / 4;
export const emptyDrums = (len: number) => Array.from({ length: NPADS }, () => new Array(len).fill(0));

export function newTrack(type: TrackType, index: number, preset = 'lead'): Track {
  return {
    id: uid(), name: `${t('type.' + type)} ${index}`, type,
    color: COLORS[(index - 1 + (type === 'drums' ? 0 : type === 'synth' ? 1 : 3)) % COLORS.length],
    vol: 0.8, pan: 0, mute: false, solo: false, eqLow: 0, eqMid: 0, eqHigh: 0, comp: false, rev: 0, dly: 0, drive: 0, filter: 0, duck: 0, chorus: 0, trem: 0, crush: 0,
    synth: type === 'synth' ? makeSynth(preset) : undefined,
    kit: type === 'drums' ? 'electro' : undefined,
    pads: type === 'drums' ? new Array(NPADS).fill(null) : undefined,
    clips: [],
  };
}

export function newPatternClip(type: TrackType, start: number, name: string): Clip {
  const c: Clip = { id: uid(), name, start, len: BAR, offset: 0, patLen: BAR };
  if (type === 'drums') c.drums = emptyDrums(BAR); else c.notes = [];
  return c;
}

export function contentEnd(p: Project): number {
  let e = 0;
  for (const tr of p.tracks) for (const c of tr.clips) e = Math.max(e, c.start + c.len);
  return e;
}

export function blankProject(): Project {
  return {
    name: t('proj.new'), bpm: 120, swing: 0, loop: false, loopStart: 0, loopLen: 4, metronome: false, countIn: true, master: 0.9, filter: 0, revSize: 2.4, dlySteps: 3, dlyFb: 0.38, key: 0, scale: 'off', markers: [], mLow: 0, mMid: 0, mHigh: 0, width: 1, target: 0, notes: '', punch: false,
    tracks: [newTrack('drums', 1), newTrack('synth', 1), newTrack('audio', 1)],
  };
}

const OLD_PRESETS: Record<string, string> = { Lead: 'lead', Basse: 'bass', Nappe: 'pad', Pluck: 'pluck', Clavier: 'keys', Orgue: 'organ' };

/** Met à niveau un projet enregistré avec une version antérieure. */
export function migrate(p: Project): Project {
  p.swing ??= 0; p.countIn ??= false; p.filter ??= 0;
  p.revSize ??= 2.4; p.dlySteps ??= 3; p.dlyFb ??= 0.38; p.key ??= 0; p.scale ??= 'off'; p.markers ??= []; p.mLow ??= 0; p.mMid ??= 0; p.mHigh ??= 0; p.width ??= 1; p.target ??= 0; p.notes ??= ''; p.punch ??= false;
  for (const tr of p.tracks) {
    tr.drive ??= 0; tr.filter ??= 0; tr.duck ??= 0; tr.chorus ??= 0; tr.trem ??= 0; tr.crush ??= 0;
    if (tr.type === 'drums') {
      tr.kit ??= 'electro'; tr.pads ??= new Array(NPADS).fill(null);
      for (const c of tr.clips) while (c.drums && c.drums.length < NPADS) c.drums.push(new Array(c.patLen!).fill(0));
    }
    if (tr.synth) {
      const id = OLD_PRESETS[tr.synth.preset] ?? tr.synth.preset;
      tr.synth = { ...BASE, ...tr.synth, preset: id };
    }
  }
  return p;
}

export function demoProject(): Project {
  const p = blankProject();
  p.name = t('proj.demo'); p.loop = true;
  const [dr, , au] = p.tracks;
  dr.rev = 0.08;
  const d = newPatternClip('drums', 0, 'Beat'); d.len = 64;
  for (const s of [0, 4, 8, 12]) d.drums![0][s] = 1;
  for (const s of [4, 12]) d.drums![2][s] = 1;
  for (const s of [0, 2, 4, 6, 8, 10, 12, 14]) d.drums![3][s] = 1;
  d.drums![4][14] = 1; d.drums![6][7] = 1;
  const d2 = newPatternClip('drums', 64, 'Break'); d2.len = 64;
  for (const s of [0, 6, 10]) d2.drums![8][s] = 1;
  for (const s of [4, 12, 15]) d2.drums![9][s] = 1;
  for (let s = 0; s < 16; s++) d2.drums![12][s] = 1;
  dr.clips.push(d, d2);

  const mk = (name: string, preset: string, color: number, clip: string, fill: (c: Clip) => void) => {
    const tr = newTrack('synth', 1, preset); tr.name = name; tr.color = COLORS[color];
    const c = newPatternClip('synth', 0, clip); c.len = 64; c.patLen = 64; fill(c); tr.clips.push(c);
    return tr;
  };
  const bass = mk(t('demo.bass'), 'bass', 1, t('demo.bassline'), c => {
    [33, 29, 36, 31].forEach((root, bar) => { for (const s of [0, 3, 6, 10, 12]) c.notes!.push({ p: root, s: bar * 16 + s, l: 2, v: 0.9 }); });
  });
  const pad = mk(t('demo.chords'), 'pad', 2, 'Am – F – C – G', c => {
    [[57, 60, 64], [53, 57, 60], [55, 60, 64], [55, 59, 62]].forEach((ch, bar) => ch.forEach(n => c.notes!.push({ p: n, s: bar * 16, l: 16, v: 0.7 })));
  });
  pad.rev = 0.35; pad.vol = 0.6;
  const lead = mk(t('demo.melody'), 'pluck', 4, t('demo.melody'), c => {
    const mel = [[0, 76], [3, 72], [6, 69], [10, 72], [16, 72], [19, 69], [22, 65], [26, 69], [32, 67], [35, 72], [38, 76], [42, 79], [48, 74], [51, 71], [54, 67], [58, 71]];
    for (const [s, n] of mel) c.notes!.push({ p: n, s, l: 2, v: 0.8 });
  });
  lead.dly = 0.3; lead.rev = 0.2;
  const ep = newPatternClip('synth', 64, t('demo.keys')); ep.len = 64; ep.patLen = 64;
  [[57, 64], [53, 60], [60, 64], [55, 62]].forEach((ch, bar) => { for (const s of [0, 6, 10]) ch.forEach(n => ep.notes!.push({ p: n, s: bar * 16 + s, l: 3, v: 0.75 })); });
  lead.clips.push(ep);

  au.name = t('demo.voice');
  p.tracks = [dr, bass, pad, lead, au];
  return p;
}

/** Modèles de départ : un projet déjà en place dans un style donné. */
export const TEMPLATES = ['empty', 'trap', 'house', 'lofi', 'demo'] as const;
export type Template = typeof TEMPLATES[number];
export function templateProject(tpl: Template): Project {
  if (tpl === 'demo') return demoProject();
  const p = blankProject();
  if (tpl === 'empty') return p;
  p.name = t('tpl.' + tpl); p.loop = true; p.loopLen = 2;
  const [dr, , au] = p.tracks;
  const beat = newPatternClip('drums', 0, 'Beat'); beat.len = 32; beat.patLen = 32; beat.drums = emptyDrums(32);
  const hit = (row: number, steps: number[], v = 1) => { for (const s of steps) beat.drums![row][s] = v; };
  const synth = (name: string, preset: string, color: number, notes: [number, number, number][], vel = 0.8) => {
    const tr = newTrack('synth', 1, preset); tr.name = name; tr.color = COLORS[color];
    const c = newPatternClip('synth', 0, name); c.len = 32; c.patLen = 32; c.notes = notes.map(([s, pp, l]) => ({ s, p: pp, l, v: vel })); tr.clips.push(c);
    return tr;
  };
  const chords = (list: number[][], len: number): [number, number, number][] => list.flatMap((ch, i) => ch.map(n => [i * len, n, len] as [number, number, number]));
  let tracks: Track[] = [];
  if (tpl === 'trap') {
    p.bpm = 140; p.key = 0; p.scale = 'minor'; dr.kit = 'deep';
    hit(8, [0, 11, 16, 22, 27]); hit(2, [8, 24]); hit(3, Array.from({ length: 16 }, (_, i) => i * 2)); hit(3, [13, 15, 29, 30, 31], 0.5); hit(4, [6, 22]);
    tracks = [synth(t('demo.bass'), 'sub808', 1, [[0, 36, 6], [11, 36, 3], [16, 39, 6], [22, 34, 4], [27, 31, 4]], 0.9),
      synth(t('demo.melody'), 'bell', 4, [[0, 72, 2], [3, 75, 2], [6, 79, 2], [10, 77, 3], [16, 75, 2], [19, 72, 2], [22, 70, 4], [28, 67, 3]])];
    tracks[1].rev = 0.3; tracks[1].dly = 0.25;
  } else if (tpl === 'house') {
    p.bpm = 124; p.key = 9; p.scale = 'minor';
    hit(0, [0, 4, 8, 12, 16, 20, 24, 28]); hit(2, [4, 12, 20, 28]); hit(4, [2, 6, 10, 14, 18, 22, 26, 30]); hit(12, Array.from({ length: 32 }, (_, i) => i), 0.5);
    tracks = [synth(t('demo.bass'), 'bass', 1, [2, 6, 10, 14].map(s => [s, 33, 2] as [number, number, number]).concat([18, 22, 26, 30].map(s => [s, 29, 2] as [number, number, number])), 0.9),
      synth(t('demo.chords'), 'supersaw', 2, chords([[57, 60, 64, 67], [53, 57, 60, 64]], 16), 0.7)];
    tracks[0].duck = 0.6; tracks[1].duck = 0.8; tracks[1].rev = 0.3; tracks[1].vol = 0.55;
  } else {
    p.bpm = 82; p.swing = 0.3; p.key = 2; p.scale = 'dorian'; dr.kit = 'tight'; dr.drive = 0.25; dr.filter = -0.25;
    hit(0, [0, 7, 10, 16, 23, 26]); hit(1, [4, 12, 20, 28]); hit(3, Array.from({ length: 16 }, (_, i) => i * 2), 0.5); hit(6, [15, 31], 0.5);
    tracks = [synth(t('demo.bass'), 'bass', 1, [[0, 38, 4], [7, 38, 2], [10, 41, 4], [16, 43, 4], [23, 43, 2], [26, 40, 4]], 0.85),
      synth(t('demo.keys'), 'epiano', 4, chords([[62, 65, 69, 72], [67, 71, 74, 77]], 16), 0.7)];
    tracks[0].synth!.cutoff = 380; tracks[1].rev = 0.35; tracks[1].drive = 0.15;
  }
  dr.clips.push(beat);
  p.tracks = [dr, ...tracks, au];
  return p;
}

/** Préréglages de mixage : un point de départ par type de source. */
export const MIX_PRESETS: Record<string, Partial<Track>> = {
  neutral: { eqLow: 0, eqMid: 0, eqHigh: 0, comp: false, drive: 0, filter: 0, rev: 0, dly: 0, chorus: 0, trem: 0, crush: 0 },
  vocal: { eqLow: -4, eqMid: 1.5, eqHigh: 3, comp: true, drive: 0, filter: 0, rev: 0.22, dly: 0.08, chorus: 0, trem: 0, crush: 0 },
  bass: { eqLow: 3, eqMid: -2, eqHigh: -3, comp: true, drive: 0.15, filter: 0, rev: 0, dly: 0, chorus: 0, trem: 0, crush: 0 },
  drums: { eqLow: 2.5, eqMid: -1, eqHigh: 2, comp: true, drive: 0.1, filter: 0, rev: 0.05, dly: 0, chorus: 0, trem: 0, crush: 0 },
  pad: { eqLow: -3, eqMid: 0, eqHigh: 1.5, comp: false, drive: 0, filter: 0, rev: 0.4, dly: 0.1, chorus: 0.5, trem: 0, crush: 0 },
  lofi: { eqLow: 1, eqMid: 0, eqHigh: -4, comp: true, drive: 0.2, filter: -0.35, rev: 0.12, dly: 0, chorus: 0.15, trem: 0, crush: 0.35 },
};
