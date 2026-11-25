/** V20 — rendu fidèle : une partie rejouée par KHMP prend les nuances et le volume de sa vraie piste séparée.
 *  - Nuances : chaque note reçoit la force mesurée sur la piste au moment où elle commence (au lieu d'une force presque
 *    constante donnée par le modèle de notes). Les notes posées là où la piste est quasi muette (restes d'autres instruments)
 *    sont retirées.
 *  - Guitare : six cordes, donc six notes au plus en même temps ; une note de plus étouffe la plus faible.
 *  - Volume : un extrait de la partie est rendu, comparé à la même portion de la vraie piste, et le volume de la piste
 *    d'instrument est réglé pour qu'elle sonne au même niveau qu'une piste audio de la vraie piste ajoutée à côté. */
import { renderOffline } from '../audio/engine';
import { S } from '../store';
import type { FoundNote, Part, Result } from './types';
import { partTrack } from './build';

export type StemName = 'vocals' | 'drums' | 'bass' | 'other' | 'guitar' | 'piano';
/** Piste séparée qui correspond à une partie (la sienne si elle existe, sinon « autres instruments »). */
export function stemFor(part: Part, r: Result): StemName | null {
  const s = r.stems;
  if (!s) return null;
  const k = part.kind;
  const want: StemName | null = k === 'melody' ? 'vocals' : k === 'bass' ? 'bass' : k === 'guitar' ? (s.guitar ? 'guitar' : 'other')
    : k === 'piano' ? (s.piano ? 'piano' : 'other') : k === 'other' ? 'other' : null;
  return want && s[want] ? want : null;
}

/** pas de l'enveloppe (s) */
export const HOP = 0.01;
const envs = new WeakMap<AudioBuffer, Float32Array>();
/** Énergie moyenne (tous canaux) par tranche de 10 ms. */
export function envelope(b: AudioBuffer): Float32Array {
  let e = envs.get(b);
  if (e) return e;
  const hop = Math.max(1, Math.round(b.sampleRate * HOP)), n = Math.ceil(b.length / hop);
  e = new Float32Array(n);
  for (let c = 0; c < b.numberOfChannels; c++) {
    const x = b.getChannelData(c);
    for (let i = 0; i < n; i++) { let s = 0; const a = i * hop, z = Math.min(x.length, a + hop); for (let j = a; j < z; j++) s += x[j] * x[j]; e[i] += s / Math.max(1, z - a) / b.numberOfChannels; }
  }
  envs.set(b, e);
  return e;
}
const db = (p: number) => 10 * Math.log10(p + 1e-12);
/** Niveau (dB) d'une portion [a, b] secondes de l'enveloppe. */
export function levelAt(e: Float32Array, a: number, b: number) {
  const i0 = Math.max(0, Math.floor(a / HOP)), i1 = Math.min(e.length, Math.max(i0 + 1, Math.ceil(b / HOP)));
  let s = 0; for (let i = i0; i < i1; i++) s += e[i];
  return db(s / Math.max(1, i1 - i0));
}

/** sous le niveau de référence de la partie, au-delà : la piste est muette, la note est un reste d'autre chose */
export const SILENT_DB = 40;
/** écart de volume rendu par une force de 0 à 1 (le moteur joue la force en amplitude) ; resserré pour garder les notes douces audibles */
const SPREAD = 0.75, VMIN = 0.12;

/** Nuances d'après la piste : force de chaque note = niveau de la piste à son attaque (80 ms), rapporté au niveau des notes fortes
 *  de la partie (9e décile). Renvoie les notes gardées et le nombre de notes retirées (posées sur une piste muette). */
export function stemDynamics(notes: FoundNote[], stem: AudioBuffer): { notes: FoundNote[]; dropped: number } {
  if (!notes.length) return { notes, dropped: 0 };
  const e = envelope(stem);
  const lv = notes.map(n => levelAt(e, n.t, n.t + Math.min(0.08, Math.max(0.02, n.d))));
  const sorted = [...lv].sort((a, b) => a - b), ref = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))];
  const out: FoundNote[] = [];
  notes.forEach((n, i) => {
    if (lv[i] < ref - SILENT_DB) return;
    const v = Math.pow(10, Math.min(0, lv[i] - ref) / 20 * SPREAD);
    out.push({ ...n, vel: Math.max(VMIN, Math.min(1, v)) });
  });
  return { notes: out, dropped: notes.length - out.length };
}

/** Au plus `max` notes en même temps : une note de plus étouffe la plus faible de celles qui sonnent (ou n'est pas jouée si
 *  c'est elle la plus faible). Six pour la guitare (six cordes). Renvoie les notes et le nombre de notes retirées ou raccourcies. */
export function capVoices(notes: FoundNote[], max: number): { notes: FoundNote[]; cut: number } {
  const list = notes.map(n => ({ ...n })).sort((a, b) => a.t - b.t || b.vel - a.vel), act: FoundNote[] = [], out: FoundNote[] = [];
  let cut = 0;
  for (const n of list) {
    for (let i = act.length - 1; i >= 0; i--) if (act[i].t + act[i].d <= n.t + 1e-6) act.splice(i, 1);
    if (act.length >= max) {
      let w = 0; for (let i = 1; i < act.length; i++) if (act[i].vel < act[w].vel) w = i;
      if (act[w].vel >= n.vel) { cut++; continue; }   // la nouvelle est la plus faible : pas jouée
      const old = act[w]; old.d = Math.max(0.02, n.t - old.t); act.splice(w, 1); cut++;
    }
    act.push(n); out.push(n);
  }
  return { notes: out, cut };
}

/** Voix au plus selon l'instrument : 6 cordes de guitare, une note pour le chant et la basse, dix doigts au piano. */
export const MAX_VOICES: Partial<Record<Part['kind'], number>> = { guitar: 6, piano: 10, melody: 1, bass: 1 };

/** Prépare une partie pour l'ajout : nuances de la vraie piste et nombre de voix de l'instrument. */
export function shapePart(part: Part, stem: AudioBuffer | null): { notes: FoundNote[]; dropped: number; cut: number } {
  let notes = part.notes, dropped = 0, cut = 0;
  if (stem) ({ notes, dropped } = stemDynamics(notes, stem));
  const max = MAX_VOICES[part.kind];
  if (max && max > 1) ({ notes, cut } = capVoices(notes, max));
  return { notes, dropped, cut };
}

/** durée de l'extrait comparé (s) */
export const FIT_SEC = 20;
/** Portion de `FIT_SEC` secondes où la vraie piste est la plus forte (début, en secondes). */
export function loudestWindow(e: Float32Array, sec = FIT_SEC): number {
  const w = Math.max(1, Math.round(sec / HOP)), step = Math.round(1 / HOP);
  if (e.length <= w) return 0;
  let best = 0, bestS = -1;
  for (let a = 0; a + w <= e.length; a += step) { let s = 0; for (let i = a; i < a + w; i++) s += e[i]; if (s > bestS) { bestS = s; best = a; } }
  return best * HOP;
}

/** Volume de piste à régler pour que la partie sonne comme sa vraie piste ajoutée en piste audio (volume de piste 0,8 par défaut).
 *  Rend `FIT_SEC` s de la partie seule (portion la plus forte de la piste), sans effet ni général. Renvoie le volume et l'écart en dB,
 *  ou null si le rendu est impossible (sons non chargés) ou la portion muette. */
export async function fitVolume(part: Part, notes: FoundNote[], stem: AudioBuffer, vol0 = 0.8): Promise<{ vol: number; db: number } | null> {
  const e = envelope(stem), a = loudestWindow(e), b = Math.min(a + FIT_SEC, stem.duration);
  const bit = notes.filter(n => n.t >= a && n.t < b).map(n => ({ ...n, t: n.t - a, d: Math.min(n.d, b - n.t) }));
  if (!bit.length) return null;
  const bpm = 120, tr = partTrack({ ...part, notes: bit }, bpm);
  Object.assign(tr, { vol: 1, pan: 0, rev: 0, dly: 0, mute: false, solo: false, out: '', inserts: [] });
  const p = { ...JSON.parse(JSON.stringify({ ...S.project, tracks: [], buses: [] })), tracks: [tr], buses: [], tempos: [], bpm, swing: 0, loop: false, master: 1 };
  let out: AudioBuffer;
  try { out = await renderOffline(p, false, { from: 0, to: (b - a) * bpm / 15, tail: false, stem: true, rate: 22050 }); }
  catch { return null; }
  let s = 0, n = 0;
  for (let c = 0; c < out.numberOfChannels; c++) { const x = out.getChannelData(c); for (let i = 0; i < x.length; i++) s += x[i] * x[i]; n += x.length; }
  const got = db(s / Math.max(1, n)), want = levelAt(e, a, b);
  if (got < -90 || want < -90) return null;
  const d = want - got, vol = Math.max(0.02, Math.min(1.25, vol0 * Math.pow(10, d / 20)));
  return { vol, db: 20 * Math.log10(vol / vol0) };
}
