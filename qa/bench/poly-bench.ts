/* V20 — mesure hors navigateur de la transcription basse et piano (sons fabriqués). Usage : node qa/bench/poly-bench.ts [cas] (V=1 pour voir les notes). */
import { transcribeBass, transcribePiano, chordAt, SR_HI, SR_LO, DEFAULTS } from '../../src/analysis/poly/core.ts';
type N = { t: number; d: number; midi: number };
const hz = (m: number) => 440 * 2 ** ((m - 69) / 12);
// timbres: 'piano' harmoniques 1/h, inharmonicité, déclin ; 'bassweak' fondamentale faible ; 'sine'
function synth(notes: (N & { a?: number; cents?: number })[], dur: number, sr: number, kind: string, lp = Infinity, noise = 0) {
  const x = new Float32Array(Math.ceil(dur * sr));
  let seed = 1; for (let i = 0; i < x.length; i++) { seed = (seed * 16807) % 2147483647; x[i] = noise * (seed / 2147483647 * 2 - 1); }
  for (const n of notes) {
    const f0 = hz(n.midi + (n.cents || 0) / 100), i0 = Math.round(n.t * sr), i1 = Math.min(x.length, Math.round((n.t + n.d) * sr));
    const H = kind === 'sine' ? 1 : 10;
    for (let h = 1; h <= H; h++) {
      const B = kind === 'piano' ? 0.0004 : 0;
      const f = f0 * h * Math.sqrt(1 + B * h * h); if (f > sr / 2 * 0.9 || f > lp) continue;
      let a = kind === 'piano' ? 1 / h : kind === 'bassweak' ? (h === 1 ? 0.15 : 1 / (h - 0.5)) : 1;
      if (kind === 'bass') a = 1 / h;
      const decay = kind === 'piano' ? 0.7 * (1 + 0.3 * h) : kind.startsWith('bass') ? 2.5 : 0;
      for (let i = i0; i < i1; i++) { const tt = (i - i0) / sr; const env = Math.min(1, tt / 0.004) * Math.exp(-decay * tt) * Math.min(1, (i1 - i) / sr / 0.03); x[i] += 0.15 * (n.a ?? 1) * a * env * Math.sin(2 * Math.PI * f * tt + h); }
    }
  }
  return x;
}
function score(ref: N[], est: N[], tol = 0.05) {
  const used = new Set<number>(); let tp = 0;
  for (const r of ref) { let bi = -1, bd = tol; est.forEach((e, i) => { if (!used.has(i) && e.midi === r.midi && Math.abs(e.t - r.t) <= bd) { bd = Math.abs(e.t - r.t); bi = i; } }); if (bi >= 0) { used.add(bi); tp++; } }
  const P = est.length ? tp / est.length : 0, R = tp / ref.length; return { F: P + R ? 2 * P * R / (P + R) : 0, P, R, n: est.length, ref: ref.length };
}
const cases: Record<string, () => { notes: any[]; dur: number; kind: string; mode: string; noise?: number }> = {};
const bassLine = [40, 40, 43, 45, 47, 45, 43, 38, 36, 36, 41, 43, 28, 33, 35, 52];
cases.bassSine = () => ({ mode: 'bass', kind: 'sine', dur: 8.5, notes: bassLine.map((m, i) => ({ t: 0.3 + i * 0.5, d: 0.42, midi: m })) });
cases.bassWeak = () => ({ mode: 'bass', kind: 'bassweak', dur: 8.5, notes: bassLine.map((m, i) => ({ t: 0.3 + i * 0.5, d: 0.42, midi: m })) });
cases.bassFast = () => ({ mode: 'bass', kind: 'bass', dur: 6, notes: Array.from({ length: 32 }, (_, i) => ({ t: 0.2 + i * 0.17, d: 0.16, midi: [33, 33, 45, 33, 36, 36, 48, 36][i % 8] })) });
cases.bassLegato = () => ({ mode: 'bass', kind: 'bass', dur: 6, notes: Array.from({ length: 10 }, (_, i) => ({ t: 0.2 + i * 0.5, d: 0.5, midi: [40, 42, 43, 45, 47, 48, 50, 52, 50, 48][i] })) });
const triads = [[48, 52, 55], [45, 48, 52], [41, 45, 48, 53], [43, 47, 50, 55], [48, 52, 55, 60], [50, 53, 57, 60], [55, 59, 62, 65], [52, 55, 59]];
cases.chords = () => ({ mode: 'piano', kind: 'piano', dur: 9, notes: triads.flatMap((c, i) => c.map(m => ({ t: 0.3 + i * 1.0, d: 0.9, midi: m }))) });
cases.chordsSine = () => ({ mode: 'piano', kind: 'sine', dur: 9, notes: triads.flatMap((c, i) => c.map(m => ({ t: 0.3 + i * 1.0, d: 0.9, midi: m }))) });
cases.arpeggio = () => ({ mode: 'piano', kind: 'piano', dur: 7, notes: Array.from({ length: 24 }, (_, i) => ({ t: 0.2 + i * 0.25, d: 0.6, midi: [48, 52, 55, 60, 64, 60, 55, 52, 45, 48, 52, 57][i % 12] })) });
cases.held = () => ({ mode: 'piano', kind: 'piano', dur: 7, notes: [{ t: 0.2, d: 6, midi: 36 }, { t: 0.2, d: 6, midi: 43 }, ...[60, 64, 67, 72, 67, 64, 62, 59].map((m, i) => ({ t: 0.5 + i * 0.7, d: 0.6, midi: m }))] });
cases.repeated = () => ({ mode: 'piano', kind: 'piano', dur: 5, notes: Array.from({ length: 8 }, (_, i) => [60, 64, 67].map(m => ({ t: 0.2 + i * 0.5, d: 0.45, midi: m }))).flat() });
cases.highChords = () => ({ mode: 'piano', kind: 'piano', dur: 6, notes: [[72, 76, 79], [74, 77, 81], [71, 74, 79, 83], [76, 79, 84]].flatMap((c, i) => c.map(m => ({ t: 0.3 + i * 1.2, d: 1.1, midi: m }))) });
cases.noisyChords = () => ({ ...cases.chords(), noise: 0.01 });
cases.softNotes = () => ({ mode: 'piano', kind: 'piano', dur: 9, notes: triads.flatMap((c, i) => c.map((m, k) => ({ t: 0.3 + i * 1.0, d: 0.9, midi: m, a: k === 1 ? 0.35 : 1 }))) });
cases.detuned = () => ({ mode: 'piano', kind: 'piano', dur: 9, notes: triads.flatMap((c, i) => c.map(m => ({ t: 0.3 + i * 1.0, d: 0.9, midi: m, cents: 25 }))) });
cases.noisyBass = () => ({ ...cases.bassWeak(), noise: 0.01 });
cases.long = () => ({ mode: 'piano', kind: 'piano', dur: 180, notes: Array.from({ length: 170 }, (_, i) => triads[i % 8].map(m => ({ t: 0.3 + i * 1.05, d: 0.9, midi: m }))).flat() });
cases.longBass = () => ({ mode: 'bass', kind: 'bassweak', dur: 180, notes: Array.from({ length: 350 }, (_, i) => ({ t: 0.3 + i * 0.5, d: 0.42, midi: bassLine[i % 16] })) });
cases.detunedBass = () => ({ mode: 'bass', kind: 'bassweak', dur: 8.5, notes: bassLine.map((m, i) => ({ t: 0.3 + i * 0.5, d: 0.42, midi: m, cents: -40 })) });
cases.detunedLow = () => ({ mode: 'piano', kind: 'piano', dur: 9, notes: triads.flatMap((c, i) => c.map(m => ({ t: 0.3 + i * 1.0, d: 0.9, midi: m, cents: -35 }))) });
const mixBass = bassLine.map((m, i) => ({ t: 0.3 + i * 0.5, d: 0.42, midi: m }));
const mixKeys = triads.flatMap((c, i) => c.map(m => ({ t: 0.3 + i * 1.0, d: 0.9, midi: m + 12, a: 0.6 })));
cases.bassInMix = () => ({ mode: 'bassmix', kind: 'bass', dur: 9, notes: mixBass });
cases.pianoInMix = () => ({ mode: 'pianomix', kind: 'piano', dur: 9, notes: mixKeys });
const only = process.argv[2];
for (const [name, mk] of Object.entries(cases)) {
  if (only && !name.startsWith(only)) continue;
  const c = mk(); const t0 = performance.now();
  let est;
  if (c.mode === 'bassmix') { const a = synth(mixBass, c.dur, SR_LO, 'bass', 600), k = synth(mixKeys, c.dur, SR_LO, 'piano', 600); for (let i = 0; i < a.length; i++) a[i] += k[i]; est = transcribeBass(a, DEFAULTS); }
  else if (c.mode === 'pianomix') { const mk = (sr: number, lp: number) => { const a = synth(mixKeys, c.dur, sr, 'piano', lp), k = synth(mixBass, c.dur, sr, 'bass', lp); for (let i = 0; i < a.length; i++) a[i] += k[i]; return a; }; est = transcribePiano(mk(SR_HI, Infinity), mk(SR_LO, 2400), DEFAULTS, undefined, 45); }
  else if (c.mode === 'bass') est = transcribeBass(synth(c.notes, c.dur, SR_LO, c.kind, 600, c.noise), DEFAULTS);
  else est = transcribePiano(synth(c.notes, c.dur, SR_HI, c.kind, Infinity, c.noise), synth(c.notes, c.dur, SR_LO, c.kind, 2400, c.noise), DEFAULTS);
  const s = score(c.notes, est);
  console.log(name.padEnd(12), 'F', s.F.toFixed(2), 'P', s.P.toFixed(2), 'R', s.R.toFixed(2), `n=${s.n}/${s.ref}`, `${Math.round(performance.now() - t0)}ms`);
  if (process.env.V) console.log(est.map(e => `${e.t.toFixed(2)}:${e.midi}`).join(' '));
}

const names = ['C','C#','D','Eb','E','F','F#','G','Ab','A','Bb','B'];
if (!only) for (const c of triads) { const r = chordAt(c.map(m => ({ t: 0, d: 1, midi: m, vel: 1 })), 0, 1); console.log(c.join(','), '→', r && names[r.root] + r.q); }
