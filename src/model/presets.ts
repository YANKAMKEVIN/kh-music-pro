/** Préréglages d'instruments (vrais instruments échantillonnés et synthés) et leurs catégories. */
import type { SynthParams } from '../types';
import { SUSTAIN_BANKS } from '../audio/sustain';

/** Réglages de base de tout instrument ; chaque préréglage n'en change qu'une partie. */
export const SYNTH_BASE: Omit<SynthParams, 'preset'> = {
  engine: 'sub', wave: 'sawtooth', wave2: 'square', detune: 8, mix2: 0.4, octave: 0, cutoff: 2600, reso: 2, envAmt: 0.3,
  a: 0.005, d: 0.2, s: 0.6, r: 0.15, pitchEnv: 0, ratio: 1, fmAmt: 1.5, fmDecay: 0.3, damp: 0.5, root: 60, hold: false, touch: 0,
};
type P = Partial<Omit<SynthParams, 'preset'>>;
/** Nuances des nouveaux instruments enregistrés ; les anciens projets gardent 0 (volume seul). */
export const TOUCH_DEFAULT = 0.7;
/** Instrument échantillonné : l'enveloppe ne fait qu'adoucir l'attaque et la fin de la note. */
const real = (bank: string, a = 0.002, r = 0.3): P => ({ engine: 'multi', bank, hold: SUSTAIN_BANKS.has(bank), touch: TOUCH_DEFAULT, cutoff: 16000, reso: 0.5, envAmt: 0, a, d: 0.2, s: 1, r });
const DEFS: [string, string, P][] = [
  ['r_piano', 'realKeys', real('piano', 0.002, 0.35)], ['r_nylon', 'realGuitar', real('nylon', 0.002, 0.4)], ['r_eguitar', 'realGuitar', real('eguitar', 0.002, 0.3)],
  ['r_ebass', 'realBass', real('ebass', 0.002, 0.15)], ['r_abass', 'realBass', real('abass', 0.002, 0.2)],
  ['r_strings', 'realStrings', real('strings', 0.04, 0.4)], ['r_cello', 'realStrings', real('cello', 0.02, 0.3)], ['r_brass', 'realBrass', real('brass', 0.01, 0.2)],
  ['r_sax', 'realWind', real('sax', 0.01, 0.2)], ['r_flute', 'realWind', real('flute', 0.01, 0.2)], ['r_choir', 'realPad', real('choir', 0.05, 0.5)],
  ['r_honky', 'realKeys', real('honky', 0.002, 0.35)],
  ['r_epiano', 'realKeys', real('epiano', 0.002, 0.4)],
  ['r_clavinet', 'realKeys', real('clavinet', 0.002, 0.15)],
  ['r_drawbar', 'realKeys', real('drawbar', 0.008, 0.12)],
  ['r_church', 'realKeys', real('church', 0.015, 0.5)],
  ['r_steel', 'realGuitar', real('steel', 0.002, 0.3)],
  ['r_overdrive', 'realGuitar', real('overdrive', 0.002, 0.2)],
  ['r_slap', 'realBass', real('slap', 0.002, 0.15)],
  ['r_violin', 'realStrings', real('violin', 0.025, 0.3)],
  ['r_contrabass', 'realStrings', real('contrabass', 0.02, 0.3)],
  ['r_trumpet', 'realBrass', real('trumpet', 0.01, 0.2)],
  ['r_trombone', 'realBrass', real('trombone', 0.01, 0.2)],
  ['r_marimba', 'realMallet', real('marimba', 0.002, 0.3)],
  ['r_vibes', 'realMallet', real('vibes', 0.002, 0.8)],
  ['r_steelpan', 'realMallet', real('steelpan', 0.002, 0.4)],
  ['r_air', 'realPad', real('air', 0.15, 0.7)],
  ['r_cinema', 'realPad', real('cinema', 0.12, 0.7)],
  ['r_synthchoir', 'realPad', real('synthchoir', 0.08, 0.5)],
  ['r_wurli', 'realKeys', { ...real('wurli', 0.002, 0.4), touch: 0 }],
  ['r_fashionbass', 'realBass', { ...real('fashionbass', 0.002, 0.18), touch: 0 }],
  ['r_salamander', 'realKeys', { ...real('salamander', 0.002, 0.45), touch: 0 }],
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
  Object.fromEntries(DEFS.map(([id, cat, p]) => [id, { cat, p: { ...SYNTH_BASE, ...p } }]));
export const CATS = ['realKeys', 'realGuitar', 'realBass', 'realStrings', 'realBrass', 'realWind', 'realMallet', 'realPad', 'keys', 'bass', 'lead', 'pad', 'plucked', 'bell', 'sampler'];
export const makeSynth = (preset: string): SynthParams => ({ preset, ...(PRESETS[preset] ?? PRESETS.lead).p });
