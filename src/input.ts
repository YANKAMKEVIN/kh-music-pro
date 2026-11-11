import { engine } from './audio/engine';
import { t } from './i18n';
import { S, emit, findTrack } from './store';
import { BAR, Clip, NPADS, Note, Track, chordOf, newPatternClip } from './types';

/** Décalage d'octave du clavier d'ordinateur. */
export const kb = { octave: 0, chord: 1 };
interface Held { track: Track; keys: number[]; notes: Note[]; clip?: Clip; start: number }
const held = new Map<number, Held>();

const isRec = (tr: Track) => engine.recording === 'midi' && engine.recTrack === tr.id && engine.playing;

/** Trouve (ou crée) le clip sous la tête de lecture et renvoie la position locale à écrire. */
function recSpot(tr: Track): { clip: Clip; local: number } {
  const p = S.project, ls = p.loopStart * BAR, le = ls + p.loopLen * BAR;
  let abs = Math.round(engine.currentStep());
  if (p.loop && abs === le) abs = ls;
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

export function padHit(row: number, vel = 1, track?: Track) {
  const tr = track ?? findTrack(S.selTrack);
  if (!tr || tr.type !== 'drums' || row < 0 || row >= NPADS) return;
  engine.pad(tr, row, vel);
  if (isRec(tr)) { const { clip, local } = recSpot(tr); later(() => { clip.drums![row][local] = 1; }); }
}

export function noteOn(midi: number, vel = 0.8) {
  const tr = findTrack(S.selTrack);
  if (!tr) return;
  if (tr.type === 'drums') return padHit(midi - 36, Math.max(0.3, vel));
  if (tr.type !== 'synth' || held.has(midi) || midi < 0 || midi > 127) return;
  // Accords à un doigt : une touche joue l'accord construit dans la gamme du projet.
  const keys = kb.chord > 1 ? chordOf(S.project, midi, kb.chord) : [midi];
  for (const k of keys) engine.noteOn(tr, k, vel);
  const h: Held = { track: tr, keys, notes: [], start: engine.currentStep() };
  if (isRec(tr)) {
    const { clip, local } = recSpot(tr);
    h.notes = keys.map(k => ({ p: k, s: local, l: 1, v: Math.round(vel * 100) / 100 })); h.clip = clip;
    later(() => { clip.notes!.push(...h.notes); });
  }
  held.set(midi, h);
}

export function noteOff(midi: number) {
  const h = held.get(midi);
  if (!h) return;
  held.delete(midi);
  for (const k of h.keys) engine.noteOff(h.track, k);
  if (h.clip) {
    let d = engine.currentStep() - h.start;
    if (d < 0) d += S.project.loopLen * BAR;
    for (const n of h.notes) n.l = Math.max(1, Math.min(Math.round(d), h.clip.patLen! - n.s));
  }
}

export function allNotesOff() { for (const m of [...held.keys()]) noteOff(m); }

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

export function onMidi(d: Uint8Array | number[]) {
  const cmd = d[0] & 0xf0;
  if (cmd === 0x90 && d[2] > 0) noteOn(d[1], d[2] / 127);
  else if (cmd === 0x80 || cmd === 0x90) noteOff(d[1]);
}
