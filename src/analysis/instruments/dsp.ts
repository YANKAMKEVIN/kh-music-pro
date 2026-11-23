/** V20 — Familles d'instruments : séparation légère avant le classement.
 *  YAMNet reconnaît mal un instrument noyé dans un mélange (surtout sous la batterie) :
 *  on lui donne aussi la partie « tenue » du son (sans les frappes) et la bande grave (pour la basse). */

/** FFT complexe en place, taille puissance de 2. */
function fft(re: Float32Array, im: Float32Array, inv = false) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let b = n >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = (inv ? 2 : -2) * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const p = i + k, q = p + len / 2, tr = re[q] * cr - im[q] * ci, ti = re[q] * ci + im[q] * cr;
        re[q] = re[p] - tr; im[q] = im[p] - ti; re[p] += tr; im[p] += ti;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}

/** Médiane de `buf[0..n)` (modifie `buf`). */
function median(buf: Float32Array, n: number): number {
  let lo = 0, hi = n - 1; const k = n >> 1;
  while (lo < hi) {
    const piv = buf[(lo + hi) >> 1]; let i = lo, j = hi;
    while (i <= j) { while (buf[i] < piv) i++; while (buf[j] > piv) j--; if (i <= j) { const t = buf[i]; buf[i] = buf[j]; buf[j] = t; i++; j--; } }
    if (k <= j) hi = j; else if (k >= i) lo = i; else break;
  }
  return buf[k];
}

/**
 * Séparation tenu / frappé (filtres médians sur le spectrogramme, Fitzgerald 2010).
 * Renvoie la partie tenue (instruments et voix, sans l'essentiel de la batterie).
 * `stop()` vrai : abandon ; `progress` 0..1.
 */
export function harmonic(x: Float32Array, progress: (f: number) => void = () => {}, stop: () => boolean = () => false): Float32Array {
  const N = 1024, H = 256, B = N / 2 + 1, L = 17, half = L >> 1;
  const frames = Math.max(1, Math.ceil(x.length / H) + 1);
  const win = new Float32Array(N); for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);
  const sre = new Float32Array(frames * B), sim = new Float32Array(frames * B), mag = new Float32Array(frames * B);
  const re = new Float32Array(N), im = new Float32Array(N);
  for (let f = 0; f < frames; f++) {
    const s = f * H - N / 2;
    for (let i = 0; i < N; i++) { const k = s + i; re[i] = k >= 0 && k < x.length ? x[k] * win[i] : 0; im[i] = 0; }
    fft(re, im);
    for (let b = 0; b < B; b++) { const o = f * B + b; sre[o] = re[b]; sim[o] = im[b]; mag[o] = Math.hypot(re[b], im[b]); }
  }
  progress(0.3); if (stop()) throw new Error('stopped');
  const tmp = new Float32Array(L), out = new Float32Array(x.length), norm = new Float32Array(x.length + N);
  for (let f = 0; f < frames; f++) {
    for (let b = 0; b < B; b++) {
      let n = 0; for (let g = Math.max(0, f - half); g <= Math.min(frames - 1, f + half); g++) tmp[n++] = mag[g * B + b];
      const hm = median(tmp, n);
      n = 0; for (let c = Math.max(0, b - half); c <= Math.min(B - 1, b + half); c++) tmp[n++] = mag[f * B + c];
      const pm = median(tmp, n);
      const h2 = hm * hm, p2 = pm * pm, m = h2 + p2 > 1e-20 ? h2 / (h2 + p2) : 0;
      const o = f * B + b; re[b] = sre[o] * m; im[b] = sim[o] * m;
      if (b > 0 && b < B - 1) { re[N - b] = re[b]; im[N - b] = -im[b]; }
    }
    fft(re, im, true);
    const s = f * H - N / 2;
    for (let i = 0; i < N; i++) { const k = s + i; if (k >= 0 && k < x.length) { out[k] += re[i] / N * win[i]; norm[k] += win[i] * win[i]; } }
    if ((f & 255) === 0) { progress(0.3 + 0.7 * f / frames); if (stop()) throw new Error('stopped'); }
  }
  for (let i = 0; i < out.length; i++) if (norm[i] > 1e-3) out[i] /= norm[i];
  progress(1);
  return out;
}

/** Passe-bas (deux filtres du 2e ordre en cascade, ~24 dB/octave). */
export function lowpass(x: Float32Array, fc: number, sr: number): Float32Array {
  let y = x;
  for (let pass = 0; pass < 2; pass++) {
    const w = 2 * Math.PI * fc / sr, q = Math.SQRT1_2, al = Math.sin(w) / (2 * q), c = Math.cos(w), a0 = 1 + al;
    const b0 = (1 - c) / 2 / a0, b1 = (1 - c) / a0, b2 = b0, a1 = -2 * c / a0, a2 = (1 - al) / a0;
    const o = new Float32Array(y.length); let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < y.length; i++) { const v = y[i], r = b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = v; y2 = y1; y1 = r; o[i] = r; }
    y = o;
  }
  return y;
}

/** Passe-haut (même construction que `lowpass`). */
export function highpass(x: Float32Array, fc: number, sr: number): Float32Array {
  const lo = lowpass(x, fc, sr), o = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) o[i] = x[i] - lo[i];
  return o;
}

/** Ramène un signal à un niveau RMS cible (gain limité : un signal presque muet reste muet). */
export function level(x: Float32Array, target = 0.08, maxGain = 8): Float32Array {
  let q = 0; for (let i = 0; i < x.length; i++) q += x[i] * x[i];
  const r = Math.sqrt(q / Math.max(1, x.length));
  if (r < 1e-6) return x;
  const g = Math.min(maxGain, target / r);
  const o = new Float32Array(x.length); for (let i = 0; i < x.length; i++) o[i] = Math.max(-1, Math.min(1, x[i] * g));
  return o;
}
