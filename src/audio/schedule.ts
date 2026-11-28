/** Séquenceur : clips audio étirés au tempo, comping et fondus enchaînés, programmation des pas (lecture et Live). */
import { COMP_XFADE, bpmAt, durAt, stepDur as sd, synthAt, timeOf, type Clip, type Project, type Track } from '../types';
import { stretchBuffer } from './stretch';
import { hitPad, playNote } from './voices';
import type { Buffers, Mix, TrackNodes } from './graph';

// ---------- Clips audio qui suivent le tempo (V17) ----------
// Pour chaque tempo rencontré, le son du clip est étiré sans changer de hauteur (WSOLA, stretch.ts) dans le rapport
// tempo d'origine / tempo joué. Les versions étirées sont gardées en mémoire (les plus anciennes sont oubliées au-delà de 24).
const warpCache = new Map<string, AudioBuffer>();
export function warped(buf: AudioBuffer, id: string, ratio: number): AudioBuffer {
  if (Math.abs(ratio - 1) < 1e-4) return buf;
  const key = `${id}|${ratio.toFixed(5)}|${buf.length}`;
  let b = warpCache.get(key);
  if (!b) {
    b = stretchBuffer(buf, ratio, 0); warpCache.set(key, b);
    if (warpCache.size > 24) warpCache.delete(warpCache.keys().next().value!);
  }
  return b;
}
/** Prépare d'avance les versions étirées dont le morceau aura besoin (évite un calcul au moment de jouer). */
export function warmWarp(p: Project, buffers: Buffers) {
  const bpms = new Set([p.bpm, ...(p.tempos ?? []).map(m => m.bpm)]);
  for (const tr of p.tracks) if (tr.type === 'audio') for (const c of tr.clips) {
    const buf = c.warp && c.srcBpm && c.bufferId ? buffers.get(c.bufferId) : undefined;
    if (buf) for (const b of bpms) warped(buf, c.bufferId!, c.srcBpm! / b);
  }
}
export const warpCacheSize = () => warpCache.size;

// ---------- Comping et fondus enchaînés (V19) ----------
/** Morceau de clip audio tel qu'il est joué : une portion de comping, ou le clip entier. `xIn` / `xOut` : fondus enchaînés en secondes. */
export interface Piece extends Clip { xIn?: number; xOut?: number }
/**
 * Clips d'une piste audio tels qu'ils sont joués : un clip à comping devient une portion par prise choisie, et deux morceaux
 * qui se touchent reçoivent leur fondu enchaîné (celui choisi par l'utilisateur, ou un fondu très court entre deux portions).
 * Le fondu se place juste après la jonction : le morceau de gauche continue de jouer en s'effaçant pendant que celui de droite
 * monte. Le temps de chaque morceau reste donc sur la grille.
 */
export function audioPieces(p: Project, tr: Track): Piece[] {
  if (!tr.clips.some(c => c.comp || c.xfade)) return tr.clips;
  const out: Piece[] = [];
  for (const c of tr.clips) {
    if (!c.comp?.length || !c.takes?.length) { out.push({ ...c }); continue; }
    const warp = !!(c.warp && c.srcBpm);
    c.comp.forEach((seg, i) => {
      const a = seg.s, b = i + 1 < c.comp!.length ? c.comp![i + 1].s : c.len;
      if (b <= a) return;
      const into = warp ? a * 15 / c.srcBpm! : timeOf(p, c.start + a) - timeOf(p, c.start);
      out.push({ ...c, id: c.id + '#' + i, start: c.start + a, len: b - a, offset: (c.takes![seg.take] ?? c.offset) + into, fadeIn: a === 0 ? c.fadeIn : 0, fadeOut: b === c.len ? c.fadeOut : 0, xfade: a === 0 ? c.xfade : undefined, xIn: a > 0 ? COMP_XFADE : undefined });
    });
  }
  for (const b of out) {
    const a = out.find(x => x !== b && Math.abs(x.start + x.len - b.start) < 1e-6);
    if (!a) { delete b.xIn; continue; }
    const x = b.xIn ?? (b.xfade ? timeOf(p, b.start + Math.min(b.xfade, b.len)) - timeOf(p, b.start) : 0);
    if (x > 0) { b.xIn = x; a.xOut = x; }
  }
  return out;
}
/** Courbe à puissance constante : montée (sinus) ou descente (cosinus), à partir de la phase `ph0` (0..1). */
function eqPower(up: boolean, ph0: number): Float32Array {
  const n = 32, c = new Float32Array(n);
  for (let i = 0; i < n; i++) { const ph = (ph0 + (1 - ph0) * i / (n - 1)) * Math.PI / 2; c[i] = up ? Math.sin(ph) : Math.cos(ph); }
  return c;
}

/** Décalage de swing : les double-croches impaires sont retardées. */
export const swingT = (p: Project, s: number, t: number) => t + (s % 2 ? p.swing * durAt(p, s) * 0.5 : 0);

/**
 * Programme ce qui démarre dans un clip. `rel` = pas écoulés depuis le début du clip,
 * `remain` = pas restants avant sa fin (ou avant une coupure de boucle).
 */
function fireClip(mix: Mix, p: Project, buffers: Buffers, tr: Track, n: TrackNodes, c: Clip,
  rel: number, remain: number, t: number, startAudio: boolean, onSrc?: (trackId: string, src: AudioBufferSourceNode) => void,
  /** Durée du pas courant, et temps réel écoulé depuis le début du clip / restant jusqu'à sa fin (le tempo peut changer en route). */
  dur = sd(p.bpm), elapsedSec = rel * dur, remainSec = remain * dur,
  /** Pas absolu (arrangement) : le tempo peut changer en cours de clip. Absent en mode Live (tempo fixe). */
  abs?: number) {
  if (tr.type === 'audio') {
    if (!startAudio) return;
    const warp = !!(c.warp && c.srcBpm);
    const buf = c.bufferId ? buffers.get(c.bufferId) : undefined, off = c.offset + (warp ? rel * 15 / c.srcBpm! : elapsedSec);
    if (!buf || off >= buf.duration || remain <= 0) return;
    const src = mix.reg(mix.ctx.createBufferSource()), g = mix.ctx.createGain();
    // Fondus : gain en fonction de la position dans le clip (en pas).
    const full = c.gain ?? 1, fi = Math.min(c.fadeIn ?? 0, c.len), fo = Math.min(c.fadeOut ?? 0, c.len - fi), endRel = rel + remain;
    const gAt = (x: number) => full * Math.max(0, Math.min(1, fi > 0 ? x / fi : 1, fo > 0 ? (c.len - x) / fo : 1));
    g.gain.setValueAtTime(gAt(rel), t);
    if (fi > rel) g.gain.linearRampToValueAtTime(gAt(Math.min(fi, endRel)), t + (Math.min(fi, endRel) - rel) * dur);
    if (fo > 0 && endRel > c.len - fo) {
      const x0 = Math.max(rel, c.len - fo);
      g.gain.setValueAtTime(gAt(x0), t + (x0 - rel) * dur); g.gain.linearRampToValueAtTime(gAt(endRel), t + remain * dur);
    }
    // Fondus enchaînés (V19) : montée au début du morceau, et, à sa fin, quelques instants de plus en s'effaçant.
    const pc = c as Piece, reachesEnd = endRel >= c.len - 1e-9;
    // Son encore disponible après la fin du clip, en secondes jouées. Un clip qui suit le tempo (suite, 21/11/2026)
    // se prolonge lui aussi, dans la version étirée au tempo de sa fin.
    const endBpm = warp ? (abs === undefined ? p.bpm : bpmAt(p, abs + remain - 1e-6)) : 0;
    const left = warp ? (buf.duration - (c.offset + endRel * 15 / c.srcBpm!)) * c.srcBpm! / endBpm : buf.duration - off - remainSec;
    let out: AudioNode = g, extra = 0;
    if ((pc.xIn && elapsedSec < pc.xIn) || (pc.xOut && reachesEnd)) {
      const xg = mix.ctx.createGain(); g.connect(xg); out = xg;
      let busyUntil = t;
      if (pc.xIn && elapsedSec < pc.xIn) { const d = pc.xIn - elapsedSec; xg.gain.setValueCurveAtTime(eqPower(true, elapsedSec / pc.xIn), t, d); busyUntil = t + d; }
      if (pc.xOut && reachesEnd) {
        extra = Math.max(0, Math.min(pc.xOut, left));
        if (extra > 0.001 && t + remainSec >= busyUntil) xg.gain.setValueCurveAtTime(eqPower(false, 0), t + remainSec, extra); else extra = 0;
      }
    }
    out.connect(n.input);
    if (!warp) {
      src.buffer = buf; src.connect(g);
      src.start(t, Math.max(0, off), remainSec + extra);
      onSrc?.(tr.id, src);
      return;
    }
    // Le clip suit le tempo : une portion par tempo traversé, chacune lue dans la version étirée correspondante,
    // avec un fondu enchaîné de 10 ms aux changements de tempo.
    const segs: [number, number, number][] = [];
    if (abs === undefined) segs.push([rel, rel + remain, p.bpm]);
    else for (let x = abs, end = abs + remain; x < end - 1e-9;) {
      const nxt = (p.tempos ?? []).find(m => m.s > x + 1e-9)?.s ?? Infinity, x1 = Math.min(end, nxt);
      segs.push([x - c.start, x1 - c.start, bpmAt(p, x)]); x = x1;
    }
    const X = 0.005;
    let tt = t;
    segs.forEach(([r0, r1, B], i) => {
      const ratio = c.srcBpm! / B, sb = warped(buf, c.bufferId!, ratio), so = c.offset + r0 * 15 / c.srcBpm!, d = (r1 - r0) * 15 / B;
      if (so < buf.duration) {
        const first = i === 0, last = i === segs.length - 1, s2 = first ? src : mix.reg(mix.ctx.createBufferSource()), sg = mix.ctx.createGain();
        s2.buffer = sb;
        const a = first ? tt : tt - X, b = last ? tt + d + extra : tt + d + X;   // extra : prolongé pendant le fondu enchaîné
        if (!first) { sg.gain.setValueAtTime(0, a); sg.gain.linearRampToValueAtTime(1, a + 2 * X); }
        if (!last) { sg.gain.setValueAtTime(1, b - 2 * X); sg.gain.linearRampToValueAtTime(0, b); }
        s2.connect(sg).connect(g);
        s2.start(Math.max(0, a), Math.max(0, so * ratio - (first ? 0 : X)), b - a);
        onSrc?.(tr.id, s2);
      }
      tt += d;
    });
    return;
  }
  const local = (rel + c.offset) % c.patLen!;
  if (tr.type === 'drums') {
    // Les cases qui tombent dans ce pas : une seule à la double-croche, plusieurs avec une grille plus fine.
    const res = c.res ?? 1, i0 = Math.ceil(local * res - 1e-6), i1 = Math.ceil((local + 1) * res - 1e-6);
    c.drums!.forEach((row, r) => { for (let i = i0; i < i1 && i < row.length; i++) if (row[i]) hitPad(mix, buffers, tr, n.input, r, t + (i / res - local) * dur, row[i]); });
  } else if (tr.synth) {
    // Une note démarre dans ce pas, éventuellement avec un décalage (triolet, triple-croche, placement libre).
    // Coupure et résonance automatisées (suite) : lues au départ de la note, dans l'arrangement seulement.
    const sp = mix.autoOn && abs !== undefined ? synthAt(tr, abs) : tr.synth;
    for (const nt of c.notes!) {
      const f = nt.s - local;
      if (f >= 0 && f < 1) playNote(mix, n.input, sp, nt.p, t + f * dur, Math.max(0.02, Math.min(nt.l, remain - f) * dur * 0.98), nt.v, buffers);
    }
    if (c.ctl && mix.liveCtl !== tr.id) mix.schedCtl(n, c, local, t, dur, remain, startAudio);
  }
}

/** Arrangement : programme tout ce qui démarre au pas `s`. */
export function scheduleStep(mix: Mix, p: Project, buffers: Buffers, s: number, t: number, segStart: boolean, endLimit: number | null) {
  for (const tr of p.tracks) {
    const n = mix.tracks.get(tr.id);
    if (!n || tr.frozen) continue;   // piste gelée : sa version audio joue à sa place, elle ne calcule plus rien
    for (const c of tr.type === 'audio' ? audioPieces(p, tr) : tr.clips) {
      if (s < c.start || s >= c.start + c.len) continue;
      const remain = Math.min(c.start + c.len, endLimit ?? Infinity) - s;
      fireClip(mix, p, buffers, tr, n, c, s - c.start, remain, t, s === c.start || segStart, undefined,
        durAt(p, s), timeOf(p, s) - timeOf(p, c.start), timeOf(p, s + remain) - timeOf(p, s), s);
    }
  }
}

/** Mode Live : chaque piste boucle son clip actif. */
export function scheduleLive(mix: Mix, p: Project, buffers: Buffers, s: number, t: number,
  active: Map<string, { clipId: string; since: number }>, onSrc: (trackId: string, src: AudioBufferSourceNode) => void) {
  for (const tr of p.tracks) {
    const a = active.get(tr.id), n = mix.tracks.get(tr.id), c = a && tr.clips.find(x => x.id === a.clipId);
    if (!a || !n || !c || tr.frozen) continue;
    const rel = (s - a.since) % c.len;
    fireClip(mix, p, buffers, tr, n, c, rel, c.len - rel, t, rel === 0, onSrc);
  }
}
