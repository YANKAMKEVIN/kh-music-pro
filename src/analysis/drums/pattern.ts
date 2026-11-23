/** V20 — Batterie → motif : des coups repérés (secondes) au motif du séquenceur (pas, une ligne par pad). */
import { S, commit } from '../../store';
import { BAR, GM_DRUMS, NPADS, Track, emptyDrums, newTrack, uid } from '../../types';
import type { FoundNote } from '../types';
import type { DrumHit } from './dsp';

/** Métal : seuils d'extinction (dB/s), mesurés par la QA (cas DR). Un charleston est ouvert s'il s'éteint nettement plus
 *  lentement que les autres coups de métal du morceau ET sous `HAT_OPEN_DB_S` ; une cymbale, sous `CYMBAL_DB_S`. */
export const HAT_OPEN_DB_S = 200, CYMBAL_DB_S = 80;

/** Numéro General MIDI d'un coup (`med` = extinction médiane du métal du morceau ; toms : voir `toNotesGM`). */
export function gmOf(h: DrumHit, med = 1000): number {
  if (h.cls === 'kick') return 36;
  if (h.cls === 'snare') return 38;
  if (h.cls === 'tom') return 45;
  const d = h.decay ?? 1000;
  if (d <= CYMBAL_DB_S && d < 0.4 * med) return 49;
  // avec une grosse caisse ou une caisse claire, l'extinction mesurée est moins sûre : il faut un écart plus net
  return d < (h.shared ? 0.6 : 1) * HAT_OPEN_DB_S && d < (h.shared ? 0.3 : 0.5) * med ? 46 : 42;
}

/** Toms : rangés en grave, médium et aigu selon leurs hauteurs relatives (écarts de plus d'un quart d'octave). */
function tomGroups(pitches: number[]): (p: number) => number {
  const v = [...new Set(pitches.map(p => Math.log2(p)))].sort((a, b) => a - b);
  const gaps = v.slice(1).map((x, i) => ({ at: (x + v[i]) / 2, d: x - v[i] })).filter(g => g.d > 0.25).sort((a, b) => b.d - a.d).slice(0, 2).map(g => g.at).sort((a, b) => a - b);
  const gm = gaps.length === 0 ? [47] : gaps.length === 1 ? [45, 50] : [45, 47, 50];
  return p => { const l = Math.log2(p); let i = 0; while (i < gaps.length && l > gaps[i]) i++; return gm[i]; };
}

export function toNotesGM(hits: DrumHit[]): FoundNote[] {
  const tom = tomGroups(hits.filter(h => h.cls === 'tom').map(h => h.pitch ?? 150));
  const dec = hits.filter(h => h.cls === 'hat').map(h => h.decay ?? 1000).sort((a, b) => a - b), med = dec.length ? dec[dec.length >> 1] : 1000;
  return hits.map(h => ({ t: h.t, d: 0.1, midi: h.cls === 'tom' ? tom(h.pitch ?? 150) : gmOf(h, med), vel: Math.max(0.05, Math.min(1, h.vel)) }));
}

export interface Grid {
  bpm: number;
  /** instant (s) du premier temps de la première mesure ; peut être négatif si le son commence en levée */
  offset: number;
  /** swing trouvé, à la manière du séquenceur (0 = droit ; doubles-croches impaires retardées de swing × ½ pas) */
  swing: number;
}

const stepOf = (bpm: number) => 15 / bpm;

/** Cale la grille : phase des doubles-croches, swing, puis premier temps de la mesure (grosse caisse sur 1, caisse claire sur 2 et 4). */
export function fitGrid(notes: FoundNote[], bpm: number, beatOffset?: number): Grid {
  const st = stepOf(bpm), bar = st * BAR;
  if (!notes.length) return { bpm, offset: 0, swing: 0 };
  // Phase : moyenne circulaire des positions des coups graves (presque toujours sur les pas pairs), sinon de tous.
  let phase: number;
  if (beatOffset !== undefined) phase = beatOffset;
  else {
    const strong = notes.filter(n => n.midi === 36 || n.midi === 38);
    const use = strong.length >= 4 ? strong : notes;
    let c = 0, s = 0;
    for (const n of use) { const a = 2 * Math.PI * n.t / (2 * st); c += n.vel * Math.cos(a); s += n.vel * Math.sin(a); }
    phase = (Math.atan2(s, c) / (2 * Math.PI)) * 2 * st;
  }
  // Swing : retard moyen des pas impairs par rapport aux pas pairs.
  const odd: number[] = [], even: number[] = [];
  for (const n of notes) {
    const x = (n.t - phase) / st, k = Math.round(x), u = x - k;
    (((k % 2) + 2) % 2 ? odd : even).push(u);
  }
  const med = (v: number[]) => v.length ? [...v].sort((a, b) => a - b)[v.length >> 1] : 0;
  let swing = 0;
  if (odd.length >= 4) { const d = med(odd) - med(even); if (d > 0.06) swing = Math.min(0.9, Math.round(2 * d * 20) / 20); }
  // Premier temps : décalage en pas (0..BAR-1) qui met le plus de grosses caisses sur 1 (et le milieu) et de caisses claires sur 2 et 4.
  const beat = BAR / 4, first = Math.min(...notes.map(n => n.t));
  let best = 0, bestScore = -Infinity;
  for (let d = 0; d < BAR; d += 2) {
    let sc = 0;
    for (const n of notes) {
      const k = posOf(n.t, { bpm, offset: phase + d * st, swing });
      const m = ((k % BAR) + BAR) % BAR;
      if (n.midi === 36) sc += m === 0 ? 3 : m === BAR / 2 ? 1 : m % beat === 0 ? -0.5 : 0;
      if (n.midi === 38) sc += m % beat === 0 && (m / beat) % 2 === 1 ? 2 : m === 0 ? -1.5 : 0;
    }
    // à égalité, la mesure commence sur le premier coup
    if (posOf(first, { bpm, offset: phase + d * st, swing }) % BAR === 0) sc += 0.75;
    if (sc > bestScore + 1e-9) { bestScore = sc; best = d; }
  }
  let offset = phase + best * st;
  // La première mesure est celle qui contient le premier coup (à un pas près).
  offset -= Math.ceil((offset - first - st / 2) / bar) * bar;
  return { bpm, offset, swing };
}

/** Position (en pas) d'un instant sur la grille, en tenant compte du swing. */
export function posOf(t: number, g: Grid): number {
  const st = stepOf(g.bpm), x = (t - g.offset) / st, f = Math.floor(x);
  let best = f, bd = Infinity;
  for (let k = f - 1; k <= f + 2; k++) {
    const at = k + (((k % 2) + 2) % 2 ? g.swing / 2 : 0), d = Math.abs(x - at);
    if (d < bd) { bd = d; best = k; }
  }
  return best;
}

/** Motif complet : une ligne par pad (ordre de `GM_DRUMS`), une case par pas ; la valeur est la force du coup. */
export function toGridRows(notes: FoundNote[], g: Grid): { rows: number[][]; len: number } {
  const pos = notes.map(n => posOf(n.t, g));
  const end = Math.max(0, ...pos) + 1;
  const len = Math.max(BAR, Math.ceil(end / BAR) * BAR);
  const rows = emptyDrums(len);
  notes.forEach((n, i) => {
    const r = GM_DRUMS.indexOf(n.midi), s = pos[i];
    if (r < 0 || s < 0 || s >= len) return;
    rows[r][s] = Math.max(rows[r][s], Math.round(n.vel * 100) / 100);
  });
  return { rows, len };
}

const barSlice = (rows: number[][], i: number, n: number) => rows.map(r => r.slice(i * BAR, (i + n) * BAR));
function similar(a: number[][], b: number[][]) {
  let both = 0, any = 0;
  for (let r = 0; r < a.length; r++) for (let s = 0; s < a[r].length; s++) { const x = a[r][s] > 0, y = b[r][s] > 0; if (x && y) both++; if (x || y) any++; }
  return any ? both / any : 1;
}

/** Repère la mesure (ou les deux mesures) qui se répète : renvoie le motif en boucle, sa longueur en mesures et sa part du morceau. */
export function findLoop(rows: number[][], len: number): { pat: number[][]; bars: 1 | 2; share: number } {
  const nb = len / BAR;
  const full = (i: number) => barSlice(rows, i, 1).some(r => r.some(v => v > 0));
  const used = Array.from({ length: nb }, (_, i) => i).filter(full);
  const score = (p: number) => {
    let s = 0, n = 0;
    for (const i of used) if (i + p < nb && full(i + p)) { s += similar(barSlice(rows, i, 1), barSlice(rows, i + p, 1)); n++; }
    return n ? s / n : 0;
  };
  const s1 = score(1), s2 = nb >= 4 ? score(2) : 0;
  const bars: 1 | 2 = s2 > s1 + 0.12 ? 2 : 1;
  // Pour chaque case du bloc, le coup est gardé s'il revient dans plus de la moitié des blocs joués.
  const blocks: number[] = [];
  for (let i = 0; i + bars <= nb; i += bars) if (barSlice(rows, i, bars).some(r => r.some(v => v > 0))) blocks.push(i);
  if (!blocks.length) blocks.push(0);
  const L = bars * BAR, pat = emptyDrums(L);
  for (let r = 0; r < NPADS; r++) for (let s = 0; s < L; s++) {
    const v = blocks.map(i => rows[r][i * BAR + s] || 0).filter(x => x > 0);
    if (v.length * 2 > blocks.length) pat[r][s] = v.sort((a, b) => a - b)[v.length >> 1];
  }
  const share = blocks.filter(i => similar(barSlice(rows, i, bars), pat) >= 0.75).length / blocks.length;
  return { pat, bars, share };
}

export interface DrumAddOpts { loop?: boolean; swing?: boolean; kit?: string; name: string }

/** Ajoute la batterie trouvée au morceau : une piste de batterie du séquenceur. Renvoie la piste. */
export function addDrumTrack(notes: FoundNote[], g: Grid, o: DrumAddOpts): Track {
  const { rows, len } = toGridRows(notes, g);
  const n = S.project.tracks.filter(x => x.type === 'drums').length + 1;
  const tr = newTrack('drums', n);
  tr.name = o.name; tr.kit = o.kit ?? 'acoustic';
  let drums = rows, patLen = len;
  if (o.loop) { const L = findLoop(rows, len); drums = L.pat; patLen = L.bars * BAR; }
  tr.clips.push({ id: uid(), name: o.name, start: 0, len, offset: 0, patLen, drums });
  if (o.swing && g.swing > 0) S.project.swing = Math.round(g.swing * 100) / 100;
  S.project.tracks.push(tr); S.selTrack = tr.id; S.selClip = tr.clips[0].id;
  commit();
  return tr;
}
