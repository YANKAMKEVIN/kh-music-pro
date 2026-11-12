import { engine } from './audio/engine';
import { t } from './i18n';
import { S, emit, findTrack } from './store';
import { BAR, Clip, GRIDS, NPADS, Note, Track, chordOf, newPatternClip, snapTo, stepDur } from './types';

/** Décalage d'octave du clavier d'ordinateur. */
export const kb = { octave: 0, chord: 1, arp: 'off' as 'off' | 'up' | 'down' | 'updown' | 'random', arpRate: 2, repeat: 0 };
interface Held { track: Track; keys: number[]; notes: Note[]; clip?: Clip; start: number; arp?: boolean }
const held = new Map<number, Held>();

const isRec = (tr: Track) => engine.recording === 'midi' && engine.recTrack === tr.id && engine.playing;

/** Trouve (ou crée) le clip sous la tête de lecture et renvoie la position locale à écrire. */
function recSpot(tr: Track, at?: number): { clip: Clip; local: number } {
  const p = S.project, ls = p.loopStart * BAR, le = ls + p.loopLen * BAR;
  let abs = at ?? Math.round(engine.currentStep());
  if (p.loop && abs > le - 1e-6 && abs < le + 1) abs = ls + (abs - le);
  let clip = tr.clips.find(c => abs >= c.start && abs < c.start + c.len);
  if (!clip) {
    let start = Math.floor(abs / BAR) * BAR, len = BAR;
    if (p.loop && abs >= ls && abs < le) { start = ls; len = le - ls; }
    const next = Math.min(...tr.clips.filter(c => c.start > abs).map(c => c.start), Infinity);
    len = Math.min(len, next - start);
    clip = newPatternClip(tr.type, start, t('clip.take'));
    clip.len = len; clip.patLen = Math.min(len, 128);
    if (clip.drums) clip.drums = clip.drums.map(() => new Array(clip!.patLen!).fill(0));
    tr.clips.push(clip); S.selClip = clip.id;
  }
  return { clip, local: (abs - clip.start + clip.offset) % clip.patLen! };
}

/** L'écriture est différée : sinon le séquenceur rejouerait aussitôt la note qu'on vient de jouer. */
const later = (fn: () => void) => setTimeout(() => { fn(); emit(); }, 300);

/** Pads maintenus, pour la répétition de notes (roulements). */
const rolls = new Map<number, Track>();
let rollT = 0, clock = 0;
function ensureClock() { if (!clock) clock = window.setInterval(() => { arpFree(); rollFree(); if (!arp.keys.length && !rolls.size) { clearInterval(clock); clock = 0; } }, 25); }
function rollFree() {
  if (!rolls.size || !kb.repeat || engine.grid()) { rollT = 0; return; }
  const now = engine.ctx.currentTime, d = kb.repeat * stepDur(S.project.bpm);
  if (rollT < now) rollT = now + d;
  while (rollT < now + 0.1) { for (const [row, tr] of rolls) engine.padAt(tr, row, rollT, 0.85); rollT += d; }
}

const cellOf = (clip: Clip, local: number) => { const n = clip.drums![0].length; return Math.round(local * (clip.res ?? 1)) % n; };

export function padHit(row: number, vel = 1, track?: Track) {
  const tr = track ?? findTrack(S.selTrack);
  if (!tr || tr.type !== 'drums' || row < 0 || row >= NPADS) return;
  engine.pad(tr, row, vel);
  // La frappe est rangée dans la case la plus proche, selon la résolution du motif.
  if (isRec(tr)) { const { clip, local } = recSpot(tr, engine.currentStep()); later(() => { clip.drums![row][cellOf(clip, local)] = 1; }); }
  if (kb.repeat) { rolls.set(row, tr); ensureClock(); }
}
export function padRelease(row: number) { rolls.delete(row); }

// ---------- Arpégiateur : les notes tenues sont égrenées en rythme ----------
const arp = { keys: [] as number[], track: null as Track | null, vel: 0.8, idx: 0, nextT: 0 };
function arpPick(): number {
  const ks = [...new Set(arp.keys)].sort((a, b) => a - b), n = ks.length, k = arp.idx++;
  if (kb.arp === 'down') return ks[n - 1 - (k % n)];
  if (kb.arp === 'random') return ks[Math.floor(Math.random() * n)];
  if (kb.arp === 'updown') { const per = Math.max(1, 2 * n - 2), j = k % per; return ks[j < n ? j : per - j]; }
  return ks[k % n];
}
/** En lecture : calé sur les pas du séquenceur, et enregistré si l'enregistrement est armé. */
engine.onStep = (s, t) => {
  if (kb.repeat && rolls.size && s % kb.repeat === 0) for (const [row, rt] of rolls) {
    engine.padAt(rt, row, t, 0.85);
    if (isRec(rt)) { const { clip, local } = recSpot(rt, s); later(() => { clip.drums![row][cellOf(clip, local)] = 1; }); }
  }
  const tr = arp.track;
  if (!tr || !arp.keys.length || s % kb.arpRate) return;
  const m = arpPick();
  engine.playAt(tr, m, t, kb.arpRate * stepDur(S.project.bpm) * 0.8, arp.vel);
  if (isRec(tr)) {
    const { clip, local } = recSpot(tr, s), note: Note = { p: m, s: local, l: Math.max(1, Math.min(kb.arpRate, clip.patLen! - local)), v: Math.round(arp.vel * 100) / 100 };
    later(() => { clip.notes!.push(note); });
  }
};
/** À l'arrêt : horloge libre au tempo du projet. */
function arpFree() {
  const tr = arp.track;
  if (!tr || !arp.keys.length || engine.grid()) { arp.nextT = 0; return; }
  const now = engine.ctx.currentTime, d = kb.arpRate * stepDur(S.project.bpm);
  if (arp.nextT < now) arp.nextT = now + 0.01;
  while (arp.nextT < now + 0.1) { engine.playAt(tr, arpPick(), arp.nextT, d * 0.8, arp.vel); arp.nextT += d; }
}
function arpAdd(tr: Track, keys: number[], vel: number) {
  if (!arp.keys.length) { arp.idx = 0; arp.nextT = 0; }
  arp.track = tr; arp.vel = vel; arp.keys.push(...keys);
  engine.ctx.resume(); engine.sync();
  // Premier coup au prochain battement de l'horloge : les notes d'un accord plaqué ont le temps d'arriver.
  ensureClock();
}
function arpRemove(keys: number[]) {
  for (const k of keys) { const i = arp.keys.indexOf(k); if (i >= 0) arp.keys.splice(i, 1); }
}

export function noteOn(midi: number, vel = 0.8) {
  const tr = findTrack(S.selTrack);
  if (!tr || !Number.isFinite(midi)) return;
  if (tr.type === 'drums') return padHit(midi - 36, Math.max(0.3, vel));
  if (tr.type !== 'synth' || held.has(midi) || !Number.isFinite(midi) || midi < 0 || midi > 127) return;
  // Accords à un doigt : une touche joue l'accord construit dans la gamme du projet.
  const keys = kb.chord > 1 ? chordOf(S.project, midi, kb.chord) : [midi];
  const h: Held = { track: tr, keys, notes: [], start: engine.currentStep(), arp: kb.arp !== 'off' };
  if (h.arp) { arpAdd(tr, keys, vel); held.set(midi, h); return; }
  for (const k of keys) engine.noteOn(tr, k, vel);
  if (isRec(tr)) {
    // Les notes jouées sont calées sur la grille choisie dans le piano roll.
    const g = GRIDS[S.grid] ?? 1, { clip, local } = recSpot(tr, snapTo(engine.currentStep(), g));
    h.notes = keys.map(k => ({ p: k, s: Math.min(snapTo(local, g), clip.patLen! - g), l: g, v: Math.round(vel * 100) / 100 })); h.clip = clip;
    later(() => { clip.notes!.push(...h.notes); });
  }
  held.set(midi, h);
}

export function noteOff(midi: number) {
  const h = held.get(midi);
  if (!h) { padRelease(midi - 36); return; }
  held.delete(midi);
  if (h.arp) return arpRemove(h.keys);
  for (const k of h.keys) engine.noteOff(h.track, k);
  if (h.clip) {
    let d = engine.currentStep() - h.start;
    if (d < 0) d += S.project.loopLen * BAR;
    const g = GRIDS[S.grid] ?? 1;
    for (const n of h.notes) n.l = Math.max(g, Math.min(snapTo(d, g), h.clip.patLen! - n.s));
  }
}

export function allNotesOff() { for (const m of [...held.keys()]) noteOff(m); rolls.clear(); }

// ---------- Clavier maître MIDI ----------
export const midi = { inputs: 0, supported: 'requestMIDIAccess' in navigator, onChange: () => { } };

export async function connectMidi(): Promise<number> {
  const acc = await navigator.requestMIDIAccess();
  const hook = () => {
    midi.inputs = acc.inputs.size;
    acc.inputs.forEach(i => { i.onmidimessage = e => { if (e.data) onMidi(e.data); }; });
    midi.onChange();
  };
  acc.onstatechange = hook; hook();
  return midi.inputs;
}

// ---------- Assignation des boutons d'un contrôleur (messages CC) ----------
/** cible = « index de piste:paramètre » ou « m:paramètre » pour le général. */
export const RANGES: Record<string, [number, number]> = { vol: [0, 1.25], pan: [-1, 1], filter: [-1, 1], drive: [0, 1], rev: [0, 1], dly: [0, 1], duck: [0, 1], chorus: [0, 1], trem: [0, 1], crush: [0, 1], master: [0, 1.25] };
export const learn = { on: false, target: '', map: {} as Record<string, string>, onChange: () => { } };
try { learn.map = JSON.parse(localStorage.getItem('kh-midimap') || '{}'); } catch { /* stockage désactivé */ }
const saveMap = () => { try { localStorage.setItem('kh-midimap', JSON.stringify(learn.map)); } catch { /* stockage désactivé */ } };
export function clearMidiMap() { learn.map = {}; learn.target = ''; saveMap(); learn.onChange(); }
export const ccOf = (target: string) => Object.keys(learn.map).find(cc => learn.map[cc] === target);

let ccTimer = 0;
function applyCC(target: string, v: number) {
  const [who, prm] = target.split(':'), [lo, hi] = RANGES[prm] ?? [0, 1], val = Math.round((lo + (hi - lo) * v) * 100) / 100, p = S.project;
  if (who === 'm') { if (prm === 'master') p.master = val; else p.filter = Math.abs(val) < 0.04 ? 0 : val; }
  else { const tr = p.tracks[+who]; if (!tr) return; (tr as unknown as Record<string, number>)[prm] = (prm === 'pan' || prm === 'filter') && Math.abs(val) < 0.04 ? 0 : val; }
  engine.sync();
  clearTimeout(ccTimer); ccTimer = window.setTimeout(emit, 120); // l'affichage suit, sans ralentir le geste
}

export function onMidi(d: Uint8Array | number[]) {
  const cmd = d[0] & 0xf0;
  if (cmd === 0xb0) {
    const cc = String(d[1]);
    if (learn.on && learn.target) {
      for (const k of Object.keys(learn.map)) if (learn.map[k] === learn.target) delete learn.map[k];
      learn.map[cc] = learn.target; learn.target = ''; saveMap(); learn.onChange();
    } else if (learn.map[cc]) applyCC(learn.map[cc], d[2] / 127);
    return;
  }
  if (cmd === 0x90 && d[2] > 0) noteOn(d[1], d[2] / 127);
  else if (cmd === 0x80 || cmd === 0x90) noteOff(d[1]);
}
