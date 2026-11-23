/** V20 — Séparation des pistes par traitement du signal (sans modèle d'apprentissage).
 *
 *  Le son est découpé en morceaux de quelques secondes qui se recouvrent ; chaque morceau passe dans une
 *  transformée de Fourier à court terme, puis quatre masques doux se partagent chaque case temps-fréquence :
 *  - batterie : ce qui est bref et large en fréquence (séparation harmonique / percussive, filtres médians) ;
 *  - basse : ce qui tient dans le temps, sous ~200 Hz ;
 *  - voix : ce qui tient dans le temps, au-dessus de la basse, et sonne au centre de l'image stéréo ;
 *  - autres : le reste (ce qui tient dans le temps, hors du centre).
 *  Les quatre masques font 1 en chaque case : la somme des pistes redonne exactement le son d'origine.
 *  Code pur, sans DOM : il tourne dans un Worker (voir `worker.ts`) ou, à défaut, sur le fil principal. */

export const STEMS = ['vocals', 'drums', 'bass', 'other'] as const;
export type StemName = typeof STEMS[number];

export interface SepOptions {
  /** taille de la fenêtre d'analyse (puissance de 2) ; 4096 par défaut à 44,1/48 kHz */
  n?: number;
  /** durée d'un morceau et de son recouvrement, en secondes */
  chunkSec?: number; overlapSec?: number;
}

/** Résultat : pour chaque piste, un tableau par canal (même nombre de canaux et même longueur que la source). */
export type SepOut = Record<StemName, Float32Array[]>;

// ---------- Transformée de Fourier (radix 2, en place) ----------
const fftCache = new Map<number, { cos: Float32Array; sin: Float32Array; rev: Uint32Array }>();
function tables(n: number) {
  let t = fftCache.get(n);
  if (!t) {
    const cos = new Float32Array(n / 2), sin = new Float32Array(n / 2), rev = new Uint32Array(n), bits = Math.log2(n);
    for (let i = 0; i < n / 2; i++) { cos[i] = Math.cos(2 * Math.PI * i / n); sin[i] = Math.sin(2 * Math.PI * i / n); }
    for (let i = 0; i < n; i++) { let r = 0; for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b); rev[i] = r; }
    t = { cos, sin, rev }; fftCache.set(n, t);
  }
  return t;
}
/** FFT complexe en place ; `inv` = transformée inverse (non normalisée). */
export function fft(re: Float32Array, im: Float32Array, inv = false) {
  const n = re.length, { cos, sin, rev } = tables(n), sg = inv ? 1 : -1;
  for (let i = 0; i < n; i++) { const j = rev[i]; if (j > i) { let x = re[i]; re[i] = re[j]; re[j] = x; x = im[i]; im[i] = im[j]; im[j] = x; } }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1, step = n / size;
    for (let i = 0; i < n; i += size) {
      for (let j = 0, k = 0; j < half; j++, k += step) {
        const wr = cos[k], wi = sg * sin[k], a = i + j, b = a + half;
        const tr = re[b] * wr - im[b] * wi, ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
      }
    }
  }
}

/** Médiane d'un petit tableau (modifié sur place). */
function median(a: Float32Array, len: number) {
  const k = len >> 1; let lo = 0, hi = len - 1;
  while (lo < hi) {
    const p = a[(lo + hi) >> 1]; let i = lo, j = hi;
    while (i <= j) { while (a[i] < p) i++; while (a[j] > p) j--; if (i <= j) { const x = a[i]; a[i] = a[j]; a[j] = x; i++; j--; } }
    if (k <= j) hi = j; else if (k >= i) lo = i; else break;
  }
  return a[k];
}

const smooth = (x: number) => x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x);

/** Sépare un morceau (canaux `ch`, de `from` à `to` échantillons) ; ajoute le résultat pondéré par `w(i)` dans `out`. */
function chunk(ch: Float32Array[], sr: number, n: number, from: number, to: number, out: SepOut, w: (i: number) => number) {
  const hop = n / 4, bins = n / 2 + 1, len = to - from, nc = ch.length;
  const frames = Math.ceil((len + n) / hop) + 1, pad = n;   // marge d'une fenêtre de chaque côté
  const win = new Float32Array(n); for (let i = 0; i < n; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / n);
  // Spectres de chaque canal : [canal][trame * bins + case]
  const SR = ch.map(() => new Float32Array(frames * bins)), SI = ch.map(() => new Float32Array(frames * bins));
  const re = new Float32Array(n), im = new Float32Array(n);
  for (let c = 0; c < nc; c++) {
    const x = ch[c];
    for (let f = 0; f < frames; f++) {
      const s0 = from - pad + f * hop;
      for (let i = 0; i < n; i++) { const k = s0 + i; re[i] = k >= 0 && k < x.length ? x[k] * win[i] : 0; im[i] = 0; }
      fft(re, im);
      SR[c].set(re.subarray(0, bins), f * bins); SI[c].set(im.subarray(0, bins), f * bins);
    }
  }
  // Amplitude du mélange
  const A = new Float32Array(frames * bins);
  for (let i = 0; i < A.length; i++) { let p = 0; for (let c = 0; c < nc; c++) p += SR[c][i] ** 2 + SI[c][i] ** 2; A[i] = Math.sqrt(p); }
  // Séparation harmonique / percussive : médiane dans le temps (tenu) et en fréquence (bref)
  const KT = 8, KF = 8, buf = new Float32Array(2 * Math.max(KT, KF) + 1);
  const mP = new Float32Array(frames * bins);
  for (let f = 0; f < frames; f++) for (let b = 0; b < bins; b++) {
    let m = 0; for (let g = Math.max(0, f - KT); g <= Math.min(frames - 1, f + KT); g++) buf[m++] = A[g * bins + b];
    const H = median(buf, m);
    m = 0; for (let k = Math.max(0, b - KF); k <= Math.min(bins - 1, b + KF); k++) buf[m++] = A[f * bins + k];
    const P = median(buf, m), h2 = H * H, p2 = P * P;
    mP[f * bins + b] = h2 + p2 > 1e-20 ? p2 / (h2 + p2) : 0;
  }
  // Centre de l'image stéréo : corrélation gauche/droite, lissée sur quelques trames
  const mC = new Float32Array(frames * bins);
  if (nc >= 2) {
    const num = new Float32Array(frames * bins), den = new Float32Array(frames * bins);
    for (let i = 0; i < num.length; i++) {
      num[i] = 2 * (SR[0][i] * SR[1][i] + SI[0][i] * SI[1][i]);
      den[i] = SR[0][i] ** 2 + SI[0][i] ** 2 + SR[1][i] ** 2 + SI[1][i] ** 2;
    }
    const KS = 2;
    for (let f = 0; f < frames; f++) for (let b = 0; b < bins; b++) {
      let a = 0, d = 1e-20;
      for (let g = Math.max(0, f - KS); g <= Math.min(frames - 1, f + KS); g++) { a += num[g * bins + b]; d += den[g * bins + b]; }
      mC[f * bins + b] = smooth((a / d - 0.55) / 0.4);
    }
  } else mC.fill(1);   // son mono : tout est « au centre »
  // Bande de la basse (montée douce entre 120 et 250 Hz)
  const bass = new Float32Array(bins);
  for (let b = 0; b < bins; b++) bass[b] = 1 - smooth((b * sr / n - 120) / 130);
  // Masques et resynthèse (addition-recouvrement), canal par canal
  const tmpR = new Float32Array(n), tmpI = new Float32Array(n), norm = 1 / 1.5;   // Hann² à 75 % de recouvrement : somme = 1,5
  const acc = STEMS.map(() => ch.map(() => new Float32Array(len)));
  for (let c = 0; c < nc; c++) for (let f = 0; f < frames; f++) {
    const s0 = -pad + f * hop;
    if (s0 + n <= 0 || s0 >= len) continue;
    for (let si = 0; si < 3; si++) {   // « autres » = reste, calculé à la fin
      for (let b = 0; b < bins; b++) {
        const i = f * bins + b, p = mP[i], hm = 1 - p;
        const m = si === 1 ? p : si === 2 ? hm * bass[b] : hm * (1 - bass[b]) * mC[i];
        tmpR[b] = SR[c][i] * m; tmpI[b] = SI[c][i] * m;
      }
      for (let b = 1; b < n / 2; b++) { tmpR[n - b] = tmpR[b]; tmpI[n - b] = -tmpI[b]; }
      fft(tmpR, tmpI, true);
      const o = acc[si][c];
      for (let i = 0; i < n; i++) { const k = s0 + i; if (k >= 0 && k < len) o[k] += tmpR[i] * win[i] * norm / n; }
    }
  }
  for (let c = 0; c < nc; c++) {
    const x = ch[c];
    for (let i = 0; i < len; i++) {
      const wi = w(i), v = acc[0][c][i], d = acc[1][c][i], bs = acc[2][c][i], k = from + i;
      out.vocals[c][k] += v * wi; out.drums[c][k] += d * wi; out.bass[c][k] += bs * wi;
      out.other[c][k] += (x[k] - v - d - bs) * wi;
    }
  }
}

/** Sépare un son en quatre pistes. `progress` reçoit 0..1 après chaque morceau ; `cancelled()` interrompt (lève une erreur).
 *  `pause` est appelée entre deux morceaux (sur le fil principal, elle rend la main à la page). */
export async function separate(ch: Float32Array[], sr: number, opts: SepOptions = {}, progress?: (f: number) => void, cancelled?: () => boolean, pause?: () => Promise<void>): Promise<SepOut> {
  const n = opts.n ?? (sr > 60000 ? 8192 : 4096), len = ch[0]?.length ?? 0;
  const C = Math.round((opts.chunkSec ?? 8) * sr), O = Math.min(Math.round((opts.overlapSec ?? 1) * sr), C >> 1);
  const out = Object.fromEntries(STEMS.map(s => [s, ch.map(() => new Float32Array(len))])) as SepOut;
  if (!len) return out;
  // Morceaux de longueur C, décalés de C - O ; dans le recouvrement, fondu linéaire (les poids font 1).
  const starts: number[] = []; for (let s = 0; ; s += C - O) { starts.push(s); if (s + C >= len) break; }
  for (let j = 0; j < starts.length; j++) {
    if (cancelled?.()) throw new DOMException('annulé', 'AbortError');
    const a = starts[j], b = Math.min(len, a + C), first = j === 0, last = j === starts.length - 1;
    chunk(ch, sr, n, a, b, out, i => {
      if (!first && i < O) return (i + 0.5) / O;
      if (!last && i >= b - a - O) return (b - a - i - 0.5) / O;
      return 1;
    });
    progress?.((j + 1) / starts.length);
    if (pause) await pause();
  }
  return out;
}

/** Mémoire de travail estimée (octets) pour séparer un son : pistes de sortie + un morceau en cours. */
export const memoryNeeded = (len: number, nc: number, sr: number) => len * nc * 4 * 5 + sr * 9 * 4 * 24;
