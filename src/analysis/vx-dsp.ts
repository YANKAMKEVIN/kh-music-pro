/** V20 — chant → notes, tempo et tonalité : calculs purs (sans page ni son du navigateur), exécutés dans un Worker.
 *  Tout travaille sur un son mono ramené à ~11 kHz : assez pour la voix, les attaques et l'harmonie, et rapide. */

export const VX_SR = 11025;
type Prog = (f: number) => void;

/** Ramène un son mono à `target` Hz (filtre passe-bas en sinus cardinal fenêtré, puis prélèvement). */
export function resample(x: Float32Array, sr: number, target = VX_SR): { x: Float32Array; sr: number } {
  if (sr <= target * 1.01) return { x, sr };
  const r = sr / target, half = Math.ceil(4 * r), fc = 0.45 / r, h = new Float32Array(2 * half + 1);
  let sum = 0;
  for (let k = -half; k <= half; k++) {
    const w = 0.42 + 0.5 * Math.cos(Math.PI * k / (half + 1)) + 0.08 * Math.cos(2 * Math.PI * k / (half + 1));
    const s = k === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * k) / (Math.PI * k);
    sum += h[k + half] = s * w;
  }
  for (let k = 0; k < h.length; k++) h[k] /= sum;
  const n = Math.floor(x.length / r), y = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const c = Math.round(i * r);
    let acc = 0;
    const a = Math.max(0, c - half), b = Math.min(x.length - 1, c + half);
    for (let j = a; j <= b; j++) acc += x[j] * h[j - c + half];
    y[i] = acc;
  }
  return { x: y, sr: sr / r };
}

// ---------- FFT (base 2, en place) ----------
function fft(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len >> 1; k++) {
        const a = i + k, b = a + (len >> 1);
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}

/** Spectre d'amplitude trame par trame (fenêtre de Hann). `each(i, mag)` reçoit la trame i. */
function stft(x: Float32Array, N: number, H: number, each: (i: number, mag: Float64Array) => void, prog?: Prog, p0 = 0, p1 = 1) {
  const win = new Float64Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);
  const re = new Float64Array(N), im = new Float64Array(N), mag = new Float64Array(N / 2 + 1);
  const frames = Math.max(0, Math.floor((x.length - N) / H) + 1);
  for (let f = 0; f < frames; f++) {
    const o = f * H;
    for (let i = 0; i < N; i++) { re[i] = x[o + i] * win[i]; im[i] = 0; }
    fft(re, im);
    for (let k = 0; k <= N / 2; k++) mag[k] = Math.hypot(re[k], im[k]);
    each(f, mag);
    if (prog && (f & 255) === 0) prog(p0 + (p1 - p0) * f / frames);
  }
  return frames;
}

const peakNorm = (x: Float32Array) => { let m = 0; for (let i = 0; i < x.length; i++) m = Math.max(m, Math.abs(x[i])); return m > 0 ? 1 / m : 1; };
const lin = (a: ArrayLike<number>, p: number) => { const i = Math.floor(p), f = p - i; return i < 0 || i + 1 >= a.length ? 0 : a[i] * (1 - f) + a[i + 1] * f; };
const median = (v: number[]) => { if (!v.length) return NaN; const s = [...v].sort((a, b) => a - b), m = s.length >> 1; return s.length & 1 ? s[m] : (s[m - 1] + s[m]) / 2; };

// ---------- Tempo et premier temps ----------
const ON_N = 512, ON_H = 64, ON_BANDS = [30, 200, 800, 2500, 5000], ON_W = [2, 1, 0.5, 0.5];

/** Courbe des attaques : flux spectral (amplitude en racine carrée) par bandes de fréquence, chaque bande au même poids,
 *  la grave (grosse caisse, basse) pesant le plus : c'est elle qui marque les temps, les cymbales marquant souvent les croches. Une valeur par trame. */
export function onsetEnvelope(x: Float32Array, sr: number, prog?: Prog, p0 = 0, p1 = 1): { env: Float32Array; fps: number; t0: number } {
  const g = peakNorm(x), bins = ON_N / 2 + 1, prev = new Float64Array(bins), nb = ON_BANDS.length - 1, band: number[][] = Array.from({ length: nb }, () => []);
  const edge = ON_BANDS.map(f => Math.min(bins - 1, Math.max(1, Math.round(f / sr * ON_N))));
  // silence ajouté devant : une attaque à l'instant 0 se voit aussi
  const xp = new Float32Array(x.length + ON_N); xp.set(x, ON_N);
  stft(xp, ON_N, ON_H, (f, mag) => {
    for (let j = 0; j < nb; j++) {
      let s = 0;
      for (let k = edge[j]; k < edge[j + 1]; k++) { const v = Math.sqrt(g * mag[k]); if (f) s += Math.max(0, v - prev[k]); prev[k] = v; }
      band[j].push(s);
    }
  }, prog, p0, p1);
  const raw = new Array<number>(band[0].length).fill(0);
  for (const [j, bd] of band.entries()) {
    const srt = [...bd].sort((u, v) => u - v), top = srt[Math.floor(srt.length * 0.98)] || 0;
    if (top > 1e-6) for (let i = 0; i < bd.length; i++) raw[i] += ON_W[j] * Math.min(1.5, bd[i] / top);
  }
  // retire la moyenne locale (~0,3 s) : ne restent que les attaques
  const fps = sr / ON_H, w = Math.round(0.15 * fps), env = new Float32Array(raw.length);
  let acc = 0;
  const cs = [0]; for (const v of raw) cs.push(acc += v);
  for (let i = 0; i < raw.length; i++) {
    const a = Math.max(0, i - w), b = Math.min(raw.length, i + w + 1);
    env[i] = Math.max(0, raw[i] - (cs[b] - cs[a]) / (b - a));
  }
  // une attaque apparaît dans la trame dont la fenêtre commence à la contenir : l'instant est vers la fin de la fenêtre
  return { env, fps, t0: 0.77 * ON_N / sr - ON_N / sr };
}

/** Tempo (BPM, 60..200) et instant du premier temps (s) à partir de la courbe des attaques. */
export function tempoOf(env: Float32Array, fps: number, t0: number): { bpm: number; offset: number; score: number } | null {
  const n = env.length;
  if (n < fps * 2) return null;
  let mean = 0; for (const v of env) mean += v; mean /= n;
  const e = Float64Array.from(env, v => v - mean);
  const L = Math.min(n - 1, Math.round(fps * 12)), ac = new Float64Array(L + 1);
  for (let l = 0; l <= L; l++) { let s = 0; for (let i = 0; i + l < n; i++) s += e[i] * e[i + l]; ac[l] = s / (n - l); }
  if (ac[0] <= 0) return null;
  for (let l = L; l >= 0; l--) ac[l] /= ac[0];
  /** moyenne de l'autocorrélation aux multiples de la période : forte seulement si chaque multiple tombe sur un temps */
  const score = (bpm: number, Kmax = 8) => {
    const P = 60 * fps / bpm; let s = 0, k = 1;
    for (; k <= Kmax && k * P < L; k++) { const q = k * P, i = Math.round(q); let m = -1; for (let j = i - 1; j <= i + 1; j++) m = Math.max(m, lin(ac, q + (j - i) * 0.5)); s += m; }
    return k > 1 ? s / (k - 1) : -1;
  };
  // toutes les périodes possibles ; on garde la plus rapide qui explique presque aussi bien les attaques que la meilleure
  // (une période double ou triple tombe aussi sur chaque temps, mais pas une période moitié si les contretemps sont faibles)
  const grid: [number, number][] = [];
  for (let b = 50; b <= 205; b += 0.25) grid.push([b, score(b)]);
  const bs = Math.max(...grid.map(g => g[1]));
  if (bs <= 0.02) return null;
  const pk = (q: number) => { const i = Math.round(q); let m = 0; for (let j = i - 1; j <= i + 1; j++) if (j >= 0 && j < n) m = Math.max(m, env[j]); return m; };
  /** force du battement : niveau moyen des attaques sur la grille des temps, phase choisie par tranche de 8 s (tolère un tempo qui flotte) */
  const pulse = (bpm: number) => {
    const per = 60 * fps / bpm, seg = Math.max(per * 4, Math.round(8 * fps)); let tot = 0, ns = 0;
    for (let s0 = 0; s0 + per * 2 < n; s0 += seg) {
      let bestS = 0;
      for (let p = 0; p < per; p += 1) { let s = 0, c = 0; for (let q = s0 + p; q < Math.min(n, s0 + seg); q += per) { s += pk(q); c++; } if (c && s / c > bestS) bestS = s / c; }
      tot += bestS; ns++;
    }
    return ns ? tot / ns : 0;
  };
  const refine = (b0: number) => { let fb = b0, fsc = -Infinity; for (let b = b0 * 0.99; b <= b0 * 1.01; b += 0.02) { const sc = score(b, 32); if (sc > fsc) { fsc = sc; fb = b; } } return fb; };
  const cands = grid.filter((g, i) => i > 0 && i + 1 < grid.length && g[1] >= grid[i - 1][1] && g[1] >= grid[i + 1][1] && g[1] >= 0.5 * bs).map(g => { const b = refine(g[0]); return { b, p: pulse(b) }; });
  const pmax = Math.max(0, ...cands.map(c => c.p));
  let best = 0;
  for (const c of cands) if (c.p >= 0.85 * pmax && c.b > best) best = c.b;
  if (!best) best = grid.reduce((a, g) => g[1] > a[1] ? g : a)[0];
  while (best < 60) best *= 2;
  while (best > 205) best /= 2;
  // affinage fin sur toute la longueur de l'autocorrélation
  let fine = best, fs = -Infinity;
  for (let b = best * 0.985; b <= best * 1.015; b += 0.01) { const s = score(b, 64); if (s > fs) { fs = s; fine = b; } }
  // phase : peigne sur la courbe des attaques
  let P = 60 * fps / fine, ph = 0, phs = -Infinity;
  const comb = (p: number, per: number) => { let s = 0; for (let q = p; q < n; q += per) s += lin(env, q); return s; };
  for (let p = 0; p < P; p += 0.25) { const s = comb(p, P); if (s > phs) { phs = s; ph = p; } }
  // ajustement par régression : chaque temps prévu est recalé sur le pic d'attaque voisin
  for (let it = 0; it < 2; it++) {
    const pts: [number, number, number][] = [];
    for (let k = 0; ph + k * P < n; k++) {
      const c = ph + k * P, a = Math.max(1, Math.floor(c - P * 0.2)), b = Math.min(n - 2, Math.ceil(c + P * 0.2));
      let mi = -1, mv = 0;
      for (let i = a; i <= b; i++) if (env[i] > mv && env[i] >= env[i - 1] && env[i] >= env[i + 1]) { mv = env[i]; mi = i; }
      if (mi < 0) continue;
      const y0 = env[mi - 1], y1 = env[mi], y2 = env[mi + 1], den = y0 - 2 * y1 + y2;
      pts.push([k, mi + (den ? 0.5 * (y0 - y2) / den : 0), mv]);
    }
    if (pts.length < 4) break;
    const strong = median(pts.map(p => p[2])) * 0.3, use = pts.filter(p => p[2] >= strong);
    let sw = 0, sk = 0, st = 0, skk = 0, skt = 0;
    for (const [k, t, w] of use) { sw += w; sk += w * k; st += w * t; skk += w * k * k; skt += w * k * t; }
    const den = sw * skk - sk * sk;
    if (!den) break;
    const slope = (sw * skt - sk * st) / den, icpt = (st - slope * sk) / sw;
    if (Math.abs(slope / P - 1) > 0.02) break;
    P = slope; ph = icpt;
  }
  let bpm = 60 * fps / P;
  if (Math.abs(bpm - Math.round(bpm)) < 0.3) bpm = Math.round(bpm); else bpm = Math.round(bpm * 10) / 10;
  ph = ((ph % P) + P) % P;
  // premier temps : celui où la musique commence vraiment (première attaque franche sur la grille)…
  const beats: number[] = []; for (let q = ph; q < n; q += P) beats.push(pk(q));
  const strong = 0.3 * median(beats.filter(v => v > 0));
  let k0 = Math.max(0, beats.findIndex(v => v >= strong));
  // …ou, si un temps sur quatre se détache nettement (accent du premier temps de la mesure), le premier de ceux-là
  const bars = [0, 1, 2, 3].map(b => comb(ph + (k0 + b) * P, 4 * P));
  const order = [...bars].sort((u, v) => v - u);
  if (order[0] > 1.2 * order[1]) k0 += bars.indexOf(order[0]);
  let offset = (ph + k0 * P) / fps + t0;
  offset = Math.max(0, offset);
  return { bpm, offset: Math.round(offset * 1000) / 1000, score: Math.max(0, Math.min(1, fs)) };
}

// ---------- Tonalité ----------
// Profils de Krumhansl et Kessler (majeur, mineur), tonique en position 0.
const KK_MAJ = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KK_MIN = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

/** Chromagramme (12 classes de hauteur), moyenné sur le son, chaque trame normalisée. */
export function chroma(x: Float32Array, sr: number, prog?: Prog, p0 = 0, p1 = 1): Float64Array {
  const N = 4096, H = 2048, c = new Float64Array(12), fr = new Float64Array(12);
  const kLo = Math.ceil(60 / sr * N), kHi = Math.min(N / 2 - 1, Math.floor(2000 / sr * N));
  const pc = new Int8Array(N / 2 + 1), wt = new Float64Array(N / 2 + 1);
  for (let k = kLo; k <= kHi; k++) {
    const m = 69 + 12 * Math.log2(k * sr / N / 440), r = Math.round(m);
    pc[k] = ((r % 12) + 12) % 12; wt[k] = Math.max(0, 1 - 2 * Math.abs(m - r)) * Math.min(1, 300 / (k * sr / N));
  }
  stft(x, N, H, (_, mag) => {
    fr.fill(0); let mx = 0;
    for (let k = kLo; k <= kHi; k++) if (mag[k] > mag[k - 1] && mag[k] >= mag[k + 1]) mx = Math.max(mx, mag[k]);
    if (mx <= 0) return;
    for (let k = kLo; k <= kHi; k++) if (mag[k] > mag[k - 1] && mag[k] >= mag[k + 1] && mag[k] > 0.05 * mx) fr[pc[k]] += Math.sqrt(mag[k] / mx) * wt[k];
    let s = 0; for (const v of fr) s += v;
    if (s > 0) for (let i = 0; i < 12; i++) c[i] += fr[i] / s;
  }, prog, p0, p1);
  return c;
}

const pearson = (a: ArrayLike<number>, b: ArrayLike<number>) => {
  let ma = 0, mb = 0; for (let i = 0; i < 12; i++) { ma += a[i]; mb += b[i]; } ma /= 12; mb /= 12;
  let s = 0, sa = 0, sb = 0; for (let i = 0; i < 12; i++) { const u = a[i] - ma, v = b[i] - mb; s += u * v; sa += u * u; sb += v * v; }
  return sa && sb ? s / Math.sqrt(sa * sb) : 0;
};

/** Tonalité la plus probable (Krumhansl) : tonique 0..11, mode, et corrélation 0..1. */
export function keyOf(c: ArrayLike<number>): { tonic: number; mode: 'major' | 'minor'; score: number } | null {
  let tot = 0; for (let i = 0; i < 12; i++) tot += c[i];
  if (!(tot > 0)) return null;
  let best = { tonic: 0, mode: 'major' as 'major' | 'minor', score: -2 };
  for (let t = 0; t < 12; t++) {
    const rot = Array.from({ length: 12 }, (_, i) => c[(i + t) % 12]);
    const sM = pearson(rot, KK_MAJ), sm = pearson(rot, KK_MIN);
    if (sM > best.score) best = { tonic: t, mode: 'major', score: sM };
    if (sm > best.score) best = { tonic: t, mode: 'minor', score: sm };
  }
  return { ...best, score: Math.round(Math.max(0, best.score) * 100) / 100 };
}

// ---------- Chant → notes ----------
export interface PitchTrack { midi: Float32Array; rms: Float32Array; fps: number; t0: number }

/** Suivi de hauteur monophonique (YIN), 100 trames par seconde. `midi` vaut NaN quand rien de net n'est chanté. */
export function pitchTrack(x: Float32Array, sr: number, prog?: Prog, p0 = 0, p1 = 1): PitchTrack {
  const g = peakNorm(x), hop = Math.round(sr / 100), W = Math.round(sr * 0.03);
  const tauMin = Math.max(2, Math.floor(sr / 1100)), tauMax = Math.ceil(sr / 65);
  const frames = Math.max(0, Math.floor((x.length - W - tauMax - 1) / hop) + 1);
  const midi = new Float32Array(frames).fill(NaN), rms = new Float32Array(frames), d = new Float64Array(tauMax + 2);
  for (let f = 0; f < frames; f++) {
    const o = f * hop;
    let e = 0; for (let i = 0; i < W; i++) e += x[o + i] * x[o + i];
    rms[f] = Math.sqrt(e / W) * g;
    if (rms[f] < 1e-3) continue;
    let sum = 0, found = -1;
    d[0] = 1;
    for (let tau = 1; tau <= tauMax + 1; tau++) {
      let s = 0;
      for (let i = 0; i < W; i++) { const v = x[o + i] - x[o + i + tau]; s += v * v; }
      sum += s; d[tau] = sum ? s * tau / sum : 1;
    }
    let gmin = tauMin;
    for (let tau = tauMin; tau <= tauMax; tau++) {
      if (d[tau] < d[gmin]) gmin = tau;
      if (found < 0 && d[tau] < 0.15) { while (tau + 1 <= tauMax && d[tau + 1] < d[tau]) tau++; found = tau; break; }
    }
    if (found < 0 && d[gmin] < 0.3) found = gmin;
    if (found < 0) continue;
    const a = d[found - 1], b = d[found], c = d[found + 1], den = a - 2 * b + c;
    const tau = found + (den ? (a - c) / (2 * den) : 0);
    midi[f] = 69 + 12 * Math.log2(sr / tau / 440);
    if (prog && (f & 511) === 0) prog(p0 + (p1 - p0) * f / frames);
  }
  return { midi, rms, fps: sr / hop, t0: W / 2 / sr };
}

export interface VxNote { t: number; d: number; midi: number; vel: number }

/** Découpe le suivi de hauteur en notes : vibrato lissé, glissés absorbés, notes trop courtes fusionnées, attaques sur une même hauteur séparées. */
export function segmentNotes(tr: PitchTrack, opts: { minDur?: number } = {}): { notes: VxNote[]; tuning: number } {
  const { fps, t0 } = tr, n = tr.midi.length, minF = Math.round((opts.minDur ?? 0.08) * fps);
  const m = Float32Array.from(tr.midi), r = tr.rms;
  // seuil de silence relatif au niveau du son
  const lv = Array.from(r).filter(v => v > 1e-3).sort((a, b) => a - b), ref = lv.length ? lv[Math.floor(lv.length * 0.95)] : 0;
  const gate = Math.max(2e-3, ref * 0.06);
  for (let i = 0; i < n; i++) if (r[i] < gate) m[i] = NaN;
  // trous très courts (ratés du suivi) bouchés
  for (let i = 1; i < n; i++) if (isNaN(m[i]) && !isNaN(m[i - 1])) {
    let j = i; while (j < n && isNaN(m[j])) j++;
    if (j < n && j - i <= 3 && r.slice(i, j).every(v => v >= gate)) for (let k = i; k < j; k++) m[k] = m[i - 1] + (m[j] - m[i - 1]) * (k - i + 1) / (j - i + 1);
    i = j;
  }
  // passages chantés
  const runs: [number, number][] = [];
  for (let i = 0; i < n;) { if (isNaN(m[i])) { i++; continue; } let j = i; while (j < n && !isNaN(m[j])) j++; if (j - i >= Math.max(3, minF >> 1)) runs.push([i, j]); i = j; }
  // erreurs d'octave isolées corrigées par la médiane voisine
  for (const [a, b] of runs) for (let i = a; i < b; i++) {
    const med = median(Array.from(m.subarray(Math.max(a, i - 7), Math.min(b, i + 8))));
    if (Math.abs(m[i] - med) > 9) m[i] -= 12 * Math.round((m[i] - med) / 12);
  }
  // accord global du chanteur (écart commun au la 440), moyenne circulaire
  let cx = 0, cy = 0;
  for (const [a, b] of runs) for (let i = a; i < b; i++) { const ph = 2 * Math.PI * (m[i] - Math.round(m[i])); cx += Math.cos(ph) * r[i]; cy += Math.sin(ph) * r[i]; }
  const tuning = cx || cy ? Math.atan2(cy, cx) / (2 * Math.PI) : 0;
  for (const [a, b] of runs) for (let i = a; i < b; i++) m[i] -= tuning;

  const notes: VxNote[] = [];
  const W = Math.round(0.18 * fps) | 1, hw = W >> 1;
  for (const [a, b] of runs) {
    // hauteur lissée (moyenne sur une période de vibrato)
    const s = new Float32Array(b - a);
    for (let i = a; i < b; i++) { let acc = 0, c = 0; for (let j = Math.max(a, i - hw); j < Math.min(b, i + hw + 1); j++) { acc += m[j]; c++; } s[i - a] = acc / c; }
    // morceaux de hauteur stable (hystérésis), frontière recalée sur la hauteur brute
    let cuts = [a], cur = Math.round(s[0]);
    for (let i = a + 1; i < b; i++) {
      const v = s[i - a];
      if (Math.abs(v - cur) > 0.65) {
        const nw = Math.round(v); let k = i;
        while (k > cuts[cuts.length - 1] + 1 && Math.abs(m[k - 1] - nw) < Math.abs(m[k - 1] - cur)) k--;
        for (let q = i + 1; q < Math.min(b, i + hw); q++) if (Math.abs(m[q] - nw) >= Math.abs(m[q] - cur)) k = q + 1;
        // un glissé commence la note : on remonte au début du mouvement de hauteur (au plus 0,3 s)
        const dir = Math.sign(nw - cur);
        for (let st = 0; st < Math.round(0.3 * fps) && k > cuts[cuts.length - 1] + 1 && (m[k - 1] - cur) * dir > 0.3 && (m[k] - m[k - 1]) * dir > -0.05; st++) k--;
        if (k > cuts[cuts.length - 1]) cuts.push(k);
        cur = nw;
      }
    }
    // attaques sur la même hauteur : creux d'énergie
    const rs = new Float32Array(b - a);
    for (let i = a; i < b; i++) { let acc = 0, c = 0; for (let j = Math.max(a, i - 1); j < Math.min(b, i + 2); j++) { acc += r[j]; c++; } rs[i - a] = acc / c; }
    const art = new Set<number>();
    for (let i = a + minF; i < b - minF; i++) {
      const v = rs[i - a];
      if (v > rs[i - a - 1] || v > rs[i - a + 1]) continue;
      let lm = 0, rm = 0;
      for (let j = Math.max(a, i - Math.round(0.4 * fps)); j < i; j++) lm = Math.max(lm, rs[j - a]);
      for (let j = i + 1; j < Math.min(b, i + Math.round(0.4 * fps)); j++) rm = Math.max(rm, rs[j - a]);
      if (v < 0.5 * Math.min(lm, rm)) { art.add(i); i += minF; }
    }
    for (const k of art) if (!cuts.some(c => Math.abs(c - k) < minF)) cuts.push(k);
    cuts.sort((x, y) => x - y);
    cuts = cuts.filter((c, i) => i === 0 || c > cuts[i - 1]);
    let pieces = cuts.map((c, i) => ({ a: c, b: i + 1 < cuts.length ? cuts[i + 1] : b, art: c === a || art.has(c) || [...art].some(k => Math.abs(k - c) < minF), p: 0 }));
    const pitchOf = (pc: { a: number; b: number }) => { const L = pc.b - pc.a, tr2 = Math.floor(L * 0.2); return median(Array.from(m.subarray(pc.a + tr2, pc.b - tr2 > pc.a + tr2 ? pc.b - tr2 : pc.b))); };
    for (const pc of pieces) pc.p = pitchOf(pc);
    // glissé : les morceaux brefs de passage entre deux hauteurs vont à la note d'arrivée (de droite à gauche, pour qu'une suite de morceaux y aille toute)
    for (let i = pieces.length - 2; i >= 1; i--) {
      const pc = pieces[i], L2 = pieces[i - 1], R2 = pieces[i + 1];
      if (pc.b - pc.a < minF && !R2.art && L2.b === pc.a && pc.b === R2.a && (pc.p - L2.p) * (R2.p - pc.p) > 0) { R2.a = pc.a; pieces.splice(i, 1); }
    }
    for (const pc of pieces) pc.p = pitchOf(pc);
    // morceaux trop courts (glissés, ratés) fusionnés au voisin le plus proche en hauteur
    for (let guard = 0; guard < 1000; guard++) {
      let si = -1, sl = Infinity;
      pieces.forEach((pc, i) => { const L = pc.b - pc.a; if (L < minF && L < sl && pieces.length > 1) { sl = L; si = i; } });
      if (si < 0) break;
      const pc = pieces[si], L2 = pieces[si - 1], R2 = pieces[si + 1];
      const into = !R2 || (L2 && Math.abs(L2.p - pc.p) <= Math.abs(R2.p - pc.p) && !R2.art) ? L2 : R2;
      if (into === L2) { L2.b = pc.b; } else { R2.a = pc.a; R2.art = R2.art || pc.art; }
      pieces.splice(si, 1);
      into.p = pitchOf(into);
    }
    // voisins de même hauteur sans nouvelle attaque : une seule note
    pieces = pieces.filter((pc, i) => {
      const prev = pieces[i - 1];
      if (i && Math.round(prev.p) === Math.round(pc.p) && !pc.art) { prev.b = pc.b; return false; }
      return true;
    });
    for (const pc of pieces) {
      if (pc.b - pc.a < minF + 2) continue;   // la fenêtre d'analyse allonge un son bref d'environ 40 ms
      let e = 0; for (let i = pc.a; i < pc.b; i++) e += r[i] * r[i];
      notes.push({ t: pc.a / fps + t0, d: (pc.b - pc.a) / fps, midi: Math.round(pitchOf(pc)), vel: Math.sqrt(e / (pc.b - pc.a)) });
    }
  }
  // vélocité selon le niveau, relative à la note la plus forte
  const top = notes.reduce((x, nt) => Math.max(x, nt.vel), 0);
  for (const nt of notes) {
    const db = 20 * Math.log10(Math.max(1e-9, nt.vel / top));
    nt.vel = Math.round(Math.max(0.2, Math.min(1, 1 + db / 30)) * 100) / 100;
    nt.t = Math.round(nt.t * 1000) / 1000; nt.d = Math.round(nt.d * 1000) / 1000;
  }
  return { notes, tuning: Math.round(tuning * 100) / 100 };
}


// ---------- Tempo qui change en cours de morceau ----------
/** Tempo local (BPM) par fenêtre de 8 s tous les 2 s, choisi par Viterbi : un changement coûte, d'autant plus qu'il est grand
 *  (un doublement coûte plus qu'un vrai ralenti), ce qui garde la même pulsation sauf preuve répétée du contraire. */
export function tempoPath(env: Float32Array, fps: number, bpm0: number): { c: number[]; bpm: number[] } {
  const n = env.length, W = Math.round(8 * fps), H = Math.round(2 * fps);
  const B: number[] = []; for (let b = 50; b <= 210; b += 0.5) B.push(b);
  const em: Float64Array[] = [], cen: number[] = [];
  for (let a = 0; a === 0 || a + W <= n; a += H) {
    const e = env.subarray(a, Math.min(n, a + W)), m = e.length;
    let mean = 0; for (const v of e) mean += v; mean /= m;
    const L = Math.min(m - 1, Math.ceil(60 * fps / 50 * 4) + 2), ac = new Float64Array(L + 1);
    for (let l = 0; l <= L; l++) { let s = 0; for (let i = 0; i + l < m; i++) s += (e[i] - mean) * (e[i + l] - mean); ac[l] = s / (m - l); }
    const z = ac[0] > 0 ? ac[0] : 1, row = new Float64Array(B.length);
    for (let j = 0; j < B.length; j++) {
      const P = 60 * fps / B[j]; let s = 0, k = 1;
      for (; k <= 4 && k * P < L; k++) { const q = k * P; s += Math.max(lin(ac, q - 1), lin(ac, q), lin(ac, q + 1)) / z; }
      row[j] = k > 1 ? s / (k - 1) : 0;
    }
    // la pulsation la plus rapide qui explique presque aussi bien les attaques l'emporte (comme pour le tempo global) :
    // un tempo moitié n'est gardé que si le double explique nettement moins bien les attaques
    const dbl = Float64Array.from(row);
    for (let j = 0; j < B.length; j++) { const j2 = B.indexOf(B[j] * 2); if (j2 >= 0) dbl[j] -= 0.6 * Math.max(0, row[j2] - 0.8 * row[j]); }
    row.set(dbl);
    em.push(row); cen.push((a + Math.min(n, a + W)) / 2);
    if (a + W >= n) break;
  }
  const lam = 1.2, S = B.length, T = em.length;
  let cost = Float64Array.from(B, (b, j) => -em[0][j] + 0.3 * lam * Math.abs(Math.log2(b / bpm0)));
  const back: Int16Array[] = [];
  for (let t = 1; t < T; t++) {
    const nc = new Float64Array(S), bk = new Int16Array(S);
    for (let j = 0; j < S; j++) {
      let best = Infinity, bi = j;
      for (let i = 0; i < S; i++) { const c = cost[i] + lam * Math.abs(Math.log2(B[j] / B[i])); if (c < best) { best = c; bi = i; } }
      nc[j] = best - em[t][j]; bk[j] = bi;
    }
    cost = nc; back.push(bk);
  }
  let j = 0; for (let i = 1; i < S; i++) if (cost[i] < cost[j]) j = i;
  const path = new Array<number>(T); path[T - 1] = B[j];
  for (let t = T - 1; t > 0; t--) { j = back[t - 1][j]; path[t - 1] = B[j]; }
  return { c: cen, bpm: path };
}

/** Temps du morceau un par un (programmation dynamique d'Ellis), avec une période qui suit le tempo local. Renvoie des secondes. */
export function beatTrack(env: Float32Array, fps: number, t0: number, path: { c: number[]; bpm: number[] }): number[] {
  const n = env.length;
  if (n < fps * 2 || !path.bpm.length) return [];
  const per = new Float64Array(n);
  for (let i = 0, k = 0; i < n; i++) {
    while (k + 1 < path.c.length && path.c[k + 1] <= i) k++;
    const b = k + 1 < path.c.length && i > path.c[k] ? path.bpm[k] + (path.bpm[k + 1] - path.bpm[k]) * (i - path.c[k]) / (path.c[k + 1] - path.c[k]) : path.bpm[k];
    per[i] = 60 * fps / b;
  }
  let mx = 0; for (const v of env) mx = Math.max(mx, v);
  const o = Float64Array.from(env, v => v / (mx || 1)), C = new Float64Array(n), prev = new Int32Array(n).fill(-1), alpha = 6;
  for (let i = 0; i < n; i++) {
    const P = per[i], a = Math.max(0, Math.floor(i - 2 * P)), b = Math.floor(i - P / 2);
    let best = 0, bj = -1;
    for (let j = a; j <= b; j++) { const r = Math.log((i - j) / P), v = C[j] - alpha * r * r; if (v > best) { best = v; bj = j; } }
    C[i] = o[i] + best; prev[i] = bj;
  }
  const tail = Math.max(0, Math.floor(n - per[n - 1]));
  let i = tail; for (let k = tail; k < n; k++) if (C[k] > C[i]) i = k;
  const out: number[] = [];
  for (; i >= 0; i = prev[i]) out.push(i / fps + t0);
  return out.reverse();
}

/** Sections de tempo constant : dans chaque section, presque tous les temps (sauf un sur dix, coups manqués) restent
 *  à moins de `tol` s de la grille régulière qui va du premier au dernier temps de la section. */
export function tempoSections(beats: number[], tol = 0.04): { beat: number; t: number; bpm: number }[] {
  const out: { beat: number; t: number; bpm: number }[] = [];
  for (let i = 0; i + 1 < beats.length;) {
    let j = i + 1;
    for (let k = j + 1; k < beats.length; k++) {
      const per = (beats[k] - beats[i]) / (k - i);
      let bad = 0; for (let q = i + 1; q < k; q++) if (Math.abs(beats[i] + (q - i) * per - beats[q]) > tol) bad++;
      if (bad > Math.max(1, 0.1 * (k - i))) break;
      j = k;
    }
    out.push({ beat: i, t: beats[i], bpm: 60 * (j - i) / (beats[j] - beats[i]) });
    i = j;
  }
  return out;
}

// ---------- Tâches complètes ----------
export type VxJob = 'tempo' | 'melody';
export function runJob(job: VxJob, x0: Float32Array, sr0: number, prog: Prog) {
  const { x, sr } = resample(x0, sr0);
  prog(0.1);
  if (job === 'tempo') {
    const { env, fps, t0 } = onsetEnvelope(x, sr, prog, 0.1, 0.55);
    const tempo = tempoOf(env, fps, t0);
    const beats = tempo ? beatTrack(env, fps, t0, tempoPath(env, fps, tempo.bpm)) : [];
    prog(0.6);
    const key = keyOf(chroma(x, sr, prog, 0.6, 0.98));
    return { tempo, key, beats };
  }
  const tr = pitchTrack(x, sr, prog, 0.1, 0.9);
  return segmentNotes(tr);
}
