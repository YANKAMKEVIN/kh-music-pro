/** V20 — basse et piano → notes : le calcul, sans rien de l'interface (tourne dans un Worker, et dans Node pour les mesures).
 *
 *  Méthode par traitement du signal (pas de modèle d'apprentissage) :
 *  - basse (une note à la fois) : hauteur par l'algorithme YIN (périodicité, juste même quand la fondamentale est faible),
 *    débuts de note par les remontées d'énergie et les changements de hauteur ;
 *  - piano (accords) : une raie par demi-ton, mesurée avec une fenêtre de 17 périodes (résolution d'un demi-ton à toutes
 *    les hauteurs), puis, trame par trame, on retient la note dont la série d'harmoniques est la plus forte, on retire
 *    ses harmoniques du spectre et on recommence (jusqu'à 6 notes) ; enfin on suit chaque hauteur dans le temps et on
 *    cale les débuts sur les attaques du son. */

export interface PolyNote { t: number; d: number; midi: number; vel: number }
export interface PolyParams {
  /** sensibilité 0..1 : plus haut = plus de notes faibles retenues (et plus de fausses notes) */
  sens: number;
  /** durée de la note la plus courte gardée, en secondes */
  minDur: number;
}
export const DEFAULTS: PolyParams = { sens: 0.5, minDur: 0.06 };

/** Pas d'analyse commun : 256 échantillons à 22 050 Hz = 64 à 5 512,5 Hz ≈ 11,6 ms. */
export const SR_HI = 22050, SR_LO = 5512.5, HOP_HI = 256, HOP_LO = 64;
const HOP_S = HOP_HI / SR_HI;

const hz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
const midiOf = (f: number) => 69 + 12 * Math.log2(f / 440);
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

type Progress = (f: number) => void;

// ---------------------------------------------------------------- débuts de note (flux spectral)

function fft(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = -2 * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a), half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < half; k++) {
        const p = i + k, q = p + half, tr = re[q] * cr - im[q] * ci, ti = re[q] * ci + im[q] * cr;
        re[q] = re[p] - tr; im[q] = im[p] - ti; re[p] += tr; im[p] += ti;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}

/** Instants d'attaque (en trames d'analyse) : flux spectral logarithmique, seuil adaptatif, maxima locaux. */
export function onsetFrames(x: Float32Array, sr: number, hop: number, nfft: number, nFrames: number, fmax = sr / 2): number[] {
  const win = new Float64Array(nfft).map((_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / nfft));
  const kmax = Math.min(nfft >> 1, Math.ceil(fmax / sr * nfft));
  const re = new Float64Array(nfft), im = new Float64Array(nfft);
  let prev = new Float64Array(kmax), cur = new Float64Array(kmax);
  const flux = new Float64Array(nFrames);
  for (let t = 0; t < nFrames; t++) {
    const c = t * hop - (nfft >> 1);
    for (let i = 0; i < nfft; i++) { const j = c + i; re[i] = j >= 0 && j < x.length ? x[j] * win[i] : 0; im[i] = 0; }
    fft(re, im);
    let f = 0;
    for (let k = 1; k < kmax; k++) { cur[k] = Math.log1p(1000 * Math.hypot(re[k], im[k]) / nfft); const d = cur[k] - prev[k]; if (d > 0) f += d; }
    flux[t] = t ? f : 0;
    const s = prev; prev = cur; cur = s;
  }
  let mx = 0; for (const v of flux) mx = Math.max(mx, v);
  if (!mx) return [];
  const out: number[] = [];
  for (let t = 1; t < nFrames - 1; t++) {
    const v = flux[t];
    if (v < 0.08 * mx) continue;
    let ok = true;
    for (let k = -3; k <= 3 && ok; k++) if (k && t + k >= 0 && t + k < nFrames && flux[t + k] > v) ok = false;
    if (!ok) continue;
    let m = 0, n = 0; for (let k = -12; k <= 12; k++) if (t + k >= 0 && t + k < nFrames) { m += flux[t + k]; n++; }
    if (v < 1.5 * m / n + 0.04 * mx) continue;
    if (out.length && t - out[out.length - 1] < 4) continue;
    out.push(t);
  }
  return out;
}

// ---------------------------------------------------------------- basse : YIN

/** Transcrit une ligne de basse (une note à la fois). `x` : son mono à SR_LO, déjà filtré (passe-bas). */
export function transcribeBass(x: Float32Array, p: PolyParams = DEFAULTS, progress: Progress = () => {}, lo = 28, hi = 67): PolyNote[] {
  const sr = SR_LO, hop = HOP_LO;
  const maxLag = Math.ceil(sr / hz(lo)) + 2, minLag = Math.floor(sr / hz(hi)), W = Math.max(maxLag, 150);
  const nF = Math.ceil(x.length / hop);
  const pitch = new Float64Array(nF).fill(NaN), rms = new Float64Array(nF), aper = new Float64Array(nF).fill(1);
  const d = new Float64Array(maxLag + 1);
  // énergie sur une fenêtre courte (23 ms) centrée sur la trame
  for (let t = 0; t < nF; t++) {
    let s = 0, n = 0; const c = t * hop;
    for (let j = c - 64; j < c + 64; j++) if (j >= 0 && j < x.length) { s += x[j] * x[j]; n++; }
    rms[t] = Math.sqrt(s / Math.max(1, n));
  }
  let rmax = 0; for (const v of rms) rmax = Math.max(rmax, v);
  if (rmax < 1e-5) return [];
  const floor = rmax * Math.pow(10, -(20 + 30 * p.sens) / 20);
  const thr = 0.1 + 0.15 * p.sens;
  for (let t = 0; t < nF; t++) {
    if (t % 500 === 0) progress(0.4 * t / nF);
    if (rms[t] < floor) continue;
    const s0 = t * hop - ((W + maxLag) >> 1);
    if (s0 < 0 || s0 + W + maxLag >= x.length) continue;
    let run = 0; d[0] = 1;
    for (let tau = 1; tau <= maxLag; tau++) {
      let s = 0;
      for (let j = 0; j < W; j++) { const v = x[s0 + j] - x[s0 + j + tau]; s += v * v; }
      run += s; d[tau] = run ? s * tau / run : 1;
    }
    let best = -1;
    for (let tau = minLag; tau < maxLag; tau++) if (d[tau] < thr) { while (tau + 1 < maxLag && d[tau + 1] < d[tau]) tau++; best = tau; break; }
    if (best < 0) continue;
    const a = d[best - 1], b = d[best], c = d[best + 1], den = a - 2 * b + c;
    const lag = best + (den > 0 ? 0.5 * (a - c) / den : 0);
    pitch[t] = midiOf(sr / lag); aper[t] = b;
  }
  // accord général : écart moyen des hauteurs entendues au demi-ton le plus proche (moyenne circulaire)
  let cx = 0, cy = 0; for (const v of pitch) if (!Number.isNaN(v)) { const a = 2 * Math.PI * (v - Math.round(v)); cx += Math.cos(a); cy += Math.sin(a); }
  const tune = cx || cy ? Math.atan2(cy, cx) / (2 * Math.PI) : 0;
  for (let t = 0; t < nF; t++) pitch[t] -= tune;
  // dans un mélange (pas de piste de basse séparée), YIN se trompe : on mesure aussi chaque demi-ton du grave et on prend,
  // trame par trame, la note la plus grave parmi les notes entendues ; YIN garde la main quand le son est bien périodique (une seule note)
  const top = Math.min(hi + 36, 80), nb = top - lo + 1;
  const { mag } = semitoneGram(x, x, nF, lo, top, f => progress(0.4 + 0.4 * f / 0.7), tune * 100);
  let gmax = 0; for (let b = 0; b <= hi - lo; b++) for (let t = 0; t < nF; t++) gmax = Math.max(gmax, mag[b][t]);
  const M = new Float64Array(nb + 2), absThr = gmax * Math.pow(10, -(20 + 30 * p.sens) / 20), rel = 0.25 - 0.17 * p.sens;
  for (let t = 0; t < nF; t++) {
    if (rms[t] < floor) { pitch[t] = NaN; continue; }
    const y = pitch[t];
    if (!Number.isNaN(y) && aper[t] < 0.12) continue;   // son bien périodique : une seule note, YIN suffit
    const got = pickFrame(mag, t, nb, hi - lo, absThr, rel, 3, M);
    pitch[t] = got.length ? lo + Math.min(...got.map(g => g[0])) : NaN;
  }
  // attaques : l'énergie remonte nettement par rapport aux trames précédentes
  const attack = new Uint8Array(nF);
  for (let t = 2; t < nF; t++) {
    let m = Infinity; for (let k = 1; k <= 4; k++) if (t - k >= 0) m = Math.min(m, rms[t - k]);
    if (rms[t] > floor * 2 && rms[t] > 1.45 * m + 1e-9) attack[t] = 1;
  }
  // une seule attaque par remontée : la première trame qui remonte
  for (let t = nF - 1; t > 0; t--) if (attack[t] && attack[t - 1]) attack[t] = 0;
  progress(0.85);
  // découpage en notes
  const notes: PolyNote[] = [];
  let cur: { s: number; e: number; ps: number[]; pk: number } | null = null;
  const close = (e?: number) => {
    if (!cur) return;
    if (e !== undefined) cur.e = Math.min(cur.e, e);
    // hauteur la plus fréquente (les premières trames, encore dans l'attaque, ne comptent pas)
    const ps = cur.ps.slice(Math.min(2, cur.ps.length - 1)).map(Math.round), cnt = new Map<number, number>();
    for (const v of ps) cnt.set(v, (cnt.get(v) || 0) + 1);
    let m = 0, best = -1; for (const [k, c] of cnt) if (c > best) { best = c; m = k; }
    const dur = (cur.e - cur.s + 1) * hop / sr;
    if (dur >= p.minDur && m >= lo && m <= hi) notes.push({ t: cur.s * hop / sr, d: dur, midi: m, vel: cur.pk });
    cur = null;
  };
  let unv = 0, atk = -1;
  for (let t = 0; t < nF; t++) {
    if (attack[t]) atk = t;
    const v = pitch[t];
    if (cur && rms[t] < Math.max(floor, cur.pk * 0.08)) { close(); continue; }
    if (Number.isNaN(v)) { if (cur && ++unv > 3) close(); continue; }
    unv = 0;
    const rounded = Math.round(v);
    const fresh = atk >= 0 && t - atk <= 6;
    if (!cur) { cur = { s: fresh ? atk : t, e: t, ps: [v], pk: rms[t] }; atk = -1; continue; }
    // même hauteur rejouée : une attaque nette pendant la note
    if (fresh && atk > cur.s + 3) { close(atk - 1); cur = { s: atk, e: t, ps: [v], pk: rms[t] }; atk = -1; continue; }
    const recent = cur.ps.slice(-6).map(Math.round), curP = Math.round(median(recent));
    if (Math.abs(rounded - curP) >= 1 && Math.abs(rounded - curP) !== 12) {
      // changement de hauteur tenu sur trois trames (jeu lié, sans nouvelle attaque)
      let same = 0; for (let k = 0; k < 3 && t + k < nF; k++) if (Math.round(pitch[t + k]) === rounded) same++;
      if (same === 3) { close(t - 1); cur = { s: t, e: t, ps: [v], pk: rms[t] }; continue; }
    }
    cur.e = t; cur.ps.push(v); cur.pk = Math.max(cur.pk, rms[t]);
  }
  close();
  for (const n of notes) n.vel = clamp(0.25 + 0.75 * Math.sqrt(n.vel / rmax), 0.05, 1);
  progress(1);
  return notes;
}

// ---------------------------------------------------------------- piano : raies d'un demi-ton et retrait des harmoniques

/** Décalages en demi-tons des harmoniques 1, 2, 3, 4, 5, 6, 8 (la 7e tombe entre deux demi-tons) et leur poids. */
const H_OFF = [0, 12, 19, 24, 28, 31, 36], H_W = [1, 0.9, 0.8, 0.7, 0.6, 0.5, 0.45];
/** Harmoniques 1 à 12 retirées du spectre une fois la note retenue (demi-ton le plus proche). */
const H_SUB = Array.from({ length: 12 }, (_, i) => Math.round(12 * Math.log2(i + 1)));
const Q = 17;

/** Amplitude de chaque demi-ton (lo..top) à chaque trame. Les notes graves sont mesurées sur le son à SR_LO, les aiguës sur SR_HI. */
function semitoneGram(xHi: Float32Array, xLo: Float32Array, nF: number, lo: number, top: number, progress: Progress, cents = 0, step = 1, q = Q) {
  const nb = top - lo + 1, mag = Array.from({ length: nb }, () => new Float32Array(nF));
  const kern = [] as { x: Float32Array; sr: number; c: Float32Array; s: Float32Array; half: number }[];
  for (let m = lo; m <= top; m++) {
    const f = hz(m + cents / 100), useLo = f < 1000, sr = useLo ? SR_LO : SR_HI, x = useLo ? xLo : xHi;
    const W = Math.max(32, Math.round(q * sr / f)), c = new Float32Array(W), s = new Float32Array(W);
    let sw = 0; for (let i = 0; i < W; i++) sw += 0.5 - 0.5 * Math.cos(2 * Math.PI * (i + 0.5) / W);
    for (let i = 0; i < W; i++) { const w = (0.5 - 0.5 * Math.cos(2 * Math.PI * (i + 0.5) / W)) * 2 / sw, a = 2 * Math.PI * f * i / sr; c[i] = w * Math.cos(a); s[i] = w * Math.sin(a); }
    kern.push({ x, sr, c, s, half: W >> 1 });
  }
  for (let t = 0; t < nF; t += step) {
    if (t % 200 === 0) progress(0.7 * t / nF);
    const tc = t * HOP_S;
    for (let b = 0; b < nb; b++) {
      const k = kern[b], st = Math.round(tc * k.sr) - k.half, W = k.c.length, x = k.x;
      let re = 0, im = 0;
      if (st >= 0 && st + W <= x.length) for (let i = 0; i < W; i++) { const v = x[st + i]; re += v * k.c[i]; im += v * k.s[i]; }
      else for (let i = 0; i < W; i++) { const j = st + i; if (j >= 0 && j < x.length) { const v = x[j]; re += v * k.c[i]; im += v * k.s[i]; } }
      mag[b][t] = Math.hypot(re, im);
    }
  }
  return { mag, halfFrames: kern.map(k => k.c.length / k.sr / 2 / HOP_S) };
}

/** Notes d'une trame : on retient la hauteur dont la série d'harmoniques est la plus forte, on retire ses harmoniques, on recommence.
 *  `nCand` : dernier demi-ton candidat (les suivants ne servent qu'aux harmoniques). Renvoie [demi-ton, amplitude]. */
function pickFrame(mag: Float32Array[], t: number, nb: number, nCand: number, absThr: number, rel: number, maxPoly: number, M: Float64Array): [number, number][] {
  const out: [number, number][] = [];
  let fmax = 0;
  for (let b = 0; b < nb; b++) { M[b] = mag[b][t]; if (b <= nCand) fmax = Math.max(fmax, M[b]); }
  M[nb] = M[nb + 1] = 0;
  if (fmax < absThr) return out;
  for (let it = 0; it < maxPoly; it++) {
    let best = -1, bs = 0;
    for (let b = 0; b <= nCand; b++) {
      const v = M[b];
      if (v < absThr || v < rel * fmax) continue;
      if ((b > 0 && M[b - 1] > v) || M[b + 1] > v) continue;
      let s = 0, hmax = 0;
      for (let h = 0; h < H_OFF.length; h++) { const j = b + H_OFF[h]; if (j < nb) { s += H_W[h] * M[j]; hmax = Math.max(hmax, M[j]); } }
      if (v < 0.12 * hmax) continue;   // la fondamentale doit s'entendre (sinon c'est un harmonique d'une autre note)
      if (s > bs) { bs = s; best = b; }
    }
    if (best < 0) break;
    out.push([best, M[best]]);
    // retrait de ses harmoniques : enveloppe qui ne remonte pas (une harmonique plus forte appartient en partie à une autre note)
    // et spectre lisse (une harmonique bien plus forte que ses voisines est surtout celle d'une autre note : octave dans l'accord)
    const obs = H_SUB.map(o => best + o < nb ? M[best + o] : 0);
    let env = Infinity;
    for (let h = 0; h < H_SUB.length; h++) {
      const j = best + H_SUB[h]; if (j >= nb) break;
      const smooth = h > 0 && h < H_SUB.length - 1 ? (obs[h - 1] + obs[h + 1]) / 2 : Infinity;
      const e = Math.min(obs[h], env, smooth); env = Math.min(env, obs[h]);
      M[j] = Math.max(0, M[j] - e);
      if (j > 0) M[j - 1] = Math.max(0, M[j - 1] - 0.5 * e);
      M[j + 1] = Math.max(0, M[j + 1] - 0.5 * e);
    }
  }
  return out;
}

/** Accord général du morceau en cents (−50..+50 par rapport au la 440) : l'écart où l'énergie se concentre le mieux sur les demi-tons. */
export function estimateTuning(xHi: Float32Array, xLo: Float32Array): number {
  const nF = Math.min(Math.ceil(xHi.length / HOP_HI), Math.round(40 / HOP_S));
  let best = 0, bs = -1;
  for (let c = -40; c <= 50; c += 10) {
    const { mag } = semitoneGram(xHi, xLo, nF, 52, 88, () => {}, c, 6, 68);
    let s = 0; for (const row of mag) for (let t = 0; t < nF; t += 6) s += row[t] * row[t];
    if (s > bs) { bs = s; best = c; }
  }
  return best;
}

/** Transcrit des accords (plusieurs notes à la fois). `xHi` à SR_HI, `xLo` à SR_LO (même son). */
export function transcribePiano(xHi: Float32Array, xLo: Float32Array, p: PolyParams = DEFAULTS, progress: Progress = () => {}, keepFrom = 33, hi = 96): PolyNote[] {
  // les notes plus graves que `keepFrom` sont quand même cherchées (une basse dans le mélange), pour retirer leurs harmoniques, puis écartées
  const lo = Math.min(keepFrom, 28);
  const top = Math.min(120, hi + 36), nb = top - lo + 1;
  const nF = Math.ceil(xHi.length / HOP_HI);
  const cents = estimateTuning(xHi, xLo);
  const { mag, halfFrames } = semitoneGram(xHi, xLo, nF, lo, top, progress, cents);
  let gmax = 0; for (let b = 0; b <= hi - lo; b++) for (let t = 0; t < nF; t++) gmax = Math.max(gmax, mag[b][t]);
  if (gmax < 1e-5) return [];
  const absThr = gmax * Math.pow(10, -(18 + 24 * p.sens) / 20), rel = 0.25 - 0.17 * p.sens;
  const act = Array.from({ length: hi - lo + 1 }, () => new Float32Array(nF));
  const M = new Float64Array(nb + 2);
  for (let t = 0; t < nF; t++) {
    if (t % 400 === 0) progress(0.7 + 0.15 * t / nF);
    for (const [b, v] of pickFrame(mag, t, nb, hi - lo, absThr, rel, 6, M)) act[b][t] = v;
  }
  progress(0.88);
  const ons = onsetFrames(xHi, SR_HI, HOP_HI, 1024, nF);
  const found: { n: PolyNote; b: number; on: number; end: number; pkT: number }[] = [];
  const minF = p.minDur / HOP_S;
  const longEnough = (n: number, hw: number) => n >= minF + 0.8 * hw;   // une vraie note dure au moins la moitié de sa fenêtre de mesure
  for (let b = 0; b <= hi - lo; b++) {
    const a = act[b], mg = mag[b], hw = halfFrames[b];
    let t = 0;
    while (t < nF) {
      if (!a[t]) { t++; continue; }
      let e = t, gap = 0;
      for (let k = t + 1; k < nF; k++) { if (a[k]) { e = k; gap = 0; } else if (++gap > 3) break; }
      const segs = splitReattacks(t, e, mg, hw, ons);
      for (const [s0, e0] of segs) {
        // début : la trame où l'amplitude atteint la moitié de son maximum (fenêtre centrée sur l'attaque)
        let pk = 0, pkT = s0; for (let k = s0; k <= Math.min(e0, s0 + Math.ceil(2 * hw)); k++) if (mg[k] > pk) { pk = mg[k]; pkT = k; }
        let on = s0; for (let k = Math.max(0, Math.floor(s0 - hw)); k <= e0; k++) if (mg[k] >= 0.5 * pk) { on = k; break; }
        const snap = nearest(ons, on, 0.06 / HOP_S); if (snap >= 0) on = snap;
        // un piano attaque toujours : sans attaque du son à moins de 80 ms, ce n'est pas une note jouée (fin d'accord, battement d'harmoniques)
        else if (nearest(ons, on, 0.08 / HOP_S) < 0) continue;
        // fin : la dernière trame encore à la moitié du niveau, moins le débord de la fenêtre
        let off = e0; while (off > on && mg[off] < 0.5 * mg[Math.max(on, Math.round(off - hw))]) off--;
        const end = Math.max(on + 1, off);
        if (!longEnough(e0 - s0 + 1, hw) || end - on + 1 < minF) continue;
        found.push({ n: { t: on * HOP_S, d: (end - on + 1) * HOP_S, midi: lo + b, vel: pk }, b, on, end, pkT });
      }
      t = e + 1;
    }
  }
  // une note qui n'est qu'un reste d'harmonique d'une note plus grave jouée en même temps est écartée :
  // à son maximum, elle est nettement plus faible que la fondamentale de cette note
  const HARM = new Set(H_SUB.slice(1));
  const notes = found.filter(f => !found.some(g => g !== f && HARM.has(f.b - g.b) && g.on <= f.on + 4 && g.end >= f.end - 4
    && mag[f.b][f.pkT] < (f.b - g.b === 12 ? 0.75 : 0.6) * mag[g.b][f.pkT])).map(f => f.n);
  for (const n of notes) n.vel = clamp(0.25 + 0.75 * Math.sqrt(n.vel / gmax), 0.05, 1);
  progress(1);
  return notes.filter(n => n.midi >= keepFrom).sort((x, y) => x.t - y.t || x.midi - y.midi);
}

/** Une même hauteur rejouée : à chaque attaque du son, si l'amplitude de cette hauteur remonte, on coupe la note. */
function splitReattacks(s: number, e: number, mg: Float32Array, hw: number, ons: number[]): [number, number][] {
  const out: [number, number][] = [];
  let cur = s;
  const d = Math.max(2, Math.ceil(hw));
  for (const o of ons) {
    if (o <= cur + d || o >= e - 1) continue;
    const before = mg[Math.max(0, o - d)], after = mg[Math.min(mg.length - 1, o + d)];
    if (after > 1.3 * before) { out.push([cur, o - 1]); cur = o; }
  }
  out.push([cur, e]);
  return out;
}

function nearest(list: number[], v: number, maxDist: number) {
  let best = -1, bd = maxDist + 1e-9;
  for (const x of list) { const dd = Math.abs(x - v); if (dd <= bd) { bd = dd; best = x; } }
  return best;
}

// ---------------------------------------------------------------- accords

const CHORDS: [string, number[]][] = [['', [0, 4, 7]], ['m', [0, 3, 7]], ['7', [0, 4, 7, 10]], ['maj7', [0, 4, 7, 11]], ['m7', [0, 3, 7, 10]], ['dim', [0, 3, 6]], ['sus4', [0, 5, 7]]];

/** Accord entendu entre t0 et t1 (secondes) : tonique 0..11 et qualité ('', 'm', '7', 'maj7', 'm7', 'dim', 'sus4'), ou null. */
export function chordAt(notes: PolyNote[], t0: number, t1: number): { root: number; q: string } | null {
  const w = new Float64Array(12); let lowest = 999, total = 0;
  for (const n of notes) {
    const ov = Math.min(t1, n.t + n.d) - Math.max(t0, n.t);
    if (ov <= 0.02) continue;
    const v = ov * n.vel; w[n.midi % 12] += v; total += v;
    if (ov > 0.25 * (t1 - t0) && n.midi < lowest) lowest = n.midi;
  }
  if (!total) return null;
  let best: { root: number; q: string } | null = null, bs = -Infinity;
  for (let r = 0; r < 12; r++) for (const [q, iv] of CHORDS) {
    let inn = 0, miss = 0;
    for (const i of iv) { const v = w[(r + i) % 12]; inn += v; if (v < 0.08 * total) miss++; }
    if (miss > (iv.length > 3 ? 0 : 1)) continue;
    let s = inn - 1.2 * (total - inn) - 0.25 * total * miss - 0.03 * total * iv.length;
    if (lowest < 999 && lowest % 12 === r) s += 0.3 * total;
    if (s > bs) { bs = s; best = { root: r, q }; }
  }
  return best;
}

/** Registre (note la plus grave et la plus aiguë). */
export const range = (notes: PolyNote[]) => notes.length ? [Math.min(...notes.map(n => n.midi)), Math.max(...notes.map(n => n.midi))] as const : null;
