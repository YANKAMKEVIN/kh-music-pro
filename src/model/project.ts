/** Projets : pistes et clips neufs, projet vide, migration des anciens projets, démo et modèles, préréglages de mixage. */
import type { Clip, ExportOpts, Project, Track, TrackType } from '../types';
import { t } from '../i18n';
import { uid } from './ids';
import { BAR } from './timing';
import { COLORS, NPADS } from './music';
import { SYNTH_BASE, makeSynth } from './presets';

export const defaultExport = (): ExportOpts => ({ range: 'all', from: 1, to: 4, tail: true, bits: 16, rate: 44100 });
export const emptyDrums = (len: number) => Array.from({ length: NPADS }, () => new Array(len).fill(0));

export function newTrack(type: TrackType, index: number, preset = 'lead'): Track {
  return {
    id: uid(), name: `${t('type.' + type)} ${index}`, type,
    color: COLORS[(index - 1 + (type === 'drums' ? 0 : type === 'synth' ? 1 : 3)) % COLORS.length],
    vol: 0.8, pan: 0, mute: false, solo: false, eqLow: 0, eqMid: 0, eqHigh: 0, comp: false, rev: 0, dly: 0, drive: 0, filter: 0, duck: 0, chorus: 0, trem: 0, crush: 0, eqMidF: 1000, compThr: -24, compRatio: 4, out: '', inserts: [], strip: 'fixe',
    synth: type === 'synth' ? makeSynth(preset) : undefined,
    kit: type === 'drums' ? 'electro' : undefined,
    pads: type === 'drums' ? new Array(NPADS).fill(null) : undefined,
    clips: [],
  };
}

export function newBus(index: number): Track {
  const b = newTrack('audio', index); b.name = `Bus ${index}`; b.color = '#c084fc';
  return b;
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

/** Schéma courant des projets (src/persist.ts : étapes de migration d'un schéma au suivant). */
export const PROJECT_SCHEMA = 1;

export function blankProject(): Project {
  return {
    schema: PROJECT_SCHEMA, name: t('proj.new'), bpm: 120, swing: 0, loop: false, loopStart: 0, loopLen: 4, metronome: false, countIn: true, master: 0.9, filter: 0, revSize: 2.4, dlySteps: 3, dlyFb: 0.38, key: 0, scale: 'off', markers: [], mLow: 0, mMid: 0, mHigh: 0, width: 1, target: 0, notes: '', punch: false, buses: [], tempos: [], sig: 4, den: 4, liveQ: 0, liveLen: 2, exp: defaultExport(),
    tracks: [newTrack('drums', 1), newTrack('synth', 1), newTrack('audio', 1)],
  };
}

const OLD_PRESETS: Record<string, string> = { Lead: 'lead', Basse: 'bass', Nappe: 'pad', Pluck: 'pluck', Clavier: 'keys', Orgue: 'organ' };

/** Met à niveau un projet enregistré avec une version antérieure. */
export function migrate(p: Project): Project {
  p.swing ??= 0; p.countIn ??= false; p.filter ??= 0;
  p.revSize ??= 2.4; p.dlySteps ??= 3; p.dlyFb ??= 0.38; p.key ??= 0; p.scale ??= 'off'; p.markers ??= []; p.mLow ??= 0; p.mMid ??= 0; p.mHigh ??= 0; p.width ??= 1; p.target ??= 0; p.notes ??= ''; p.punch ??= false; p.buses ??= []; p.tempos ??= []; p.sig ??= 4; p.den = p.den === 8 ? 8 : 4; p.liveQ ??= 0; p.liveLen ??= 2; p.exp = { ...defaultExport(), ...p.exp };
  for (const b of p.buses) { b.eqMidF ??= 1000; b.compThr ??= -24; b.compRatio ??= 4; b.out = ''; b.inserts ??= []; b.strip = b.strip === 'chaine' ? 'chaine' : 'fixe'; }
  for (const tr of p.tracks) {
    tr.drive ??= 0; tr.filter ??= 0; tr.duck ??= 0; tr.chorus ??= 0; tr.trem ??= 0; tr.crush ??= 0; tr.eqMidF ??= 1000; tr.compThr ??= -24; tr.compRatio ??= 4; tr.inserts ??= [];
    tr.strip = tr.strip === 'chaine' ? 'chaine' : 'fixe';   // chaînes d'effets : un ancien projet garde sa tranche fixe (son identique)
    tr.out = tr.out && p.buses.some(b => b.id === tr.out) ? tr.out : '';
    if (tr.type === 'drums') {
      tr.kit ??= 'electro'; tr.pads ??= new Array(NPADS).fill(null);
      for (const c of tr.clips) while (c.drums && c.drums.length < NPADS) c.drums.push(new Array(c.patLen!).fill(0));
    }
    if (tr.synth) {
      const id = OLD_PRESETS[tr.synth.preset] ?? tr.synth.preset;
      tr.synth = { ...SYNTH_BASE, ...tr.synth, preset: id };
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
