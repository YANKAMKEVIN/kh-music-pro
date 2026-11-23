import { S, commit } from '../store';
import { BAR, Note, Track, newTrack, uid } from '../types';
import type { FoundNote, Part } from './types';

/** Seconde → pas (double-croche) à un tempo donné, arrondi à la grille `grid` (en pas ; 0 = pas d'arrondi). */
export const toStep = (sec: number, bpm: number, grid = 1) => { const s = sec * bpm / 15; return grid ? Math.round(s / grid) * grid : s; };

/** Notes trouvées → notes du séquenceur (positions en pas depuis `fromSec`), calées sur `grid`. */
export function toNotes(notes: FoundNote[], bpm: number, fromSec = 0, grid = 1): Note[] {
  const out: Note[] = [];
  for (const n of notes) {
    const s = toStep(n.t - fromSec, bpm, grid);
    if (s < 0) continue;
    const l = Math.max(grid || 0.25, toStep(n.d, bpm, grid));
    out.push({ p: n.midi, s, l, v: Math.max(0.05, Math.min(1, n.vel)) });
  }
  return out.sort((a, b) => a.s - b.s || a.p - b.p);
}

/** Ajoute une partie au morceau : une piste d'instrument avec un clip qui couvre toutes ses notes. Renvoie la piste. */
export function addPartAsTrack(part: Part, bpm: number, opts: { fromSec?: number; grid?: number; at?: number } = {}): Track {
  const notes = toNotes(part.notes, bpm, opts.fromSec ?? 0, opts.grid ?? 1);
  const end = notes.reduce((e, n) => Math.max(e, n.s + n.l), 0);
  const len = Math.max(BAR, Math.ceil(end / BAR) * BAR);
  const n = S.project.tracks.filter(x => x.type === 'synth').length + 1;
  const tr = newTrack('synth', n, part.preset || 'lead');
  tr.name = part.name;
  tr.clips.push({ id: uid(), name: part.name, start: opts.at ?? 0, len, offset: 0, patLen: len, notes });
  S.project.tracks.push(tr); S.selTrack = tr.id; S.selClip = tr.clips[0].id;
  commit();
  return tr;
}
