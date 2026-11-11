/** Mesure du volume perçu (LUFS intégré, ITU-R BS.1770) et limiteur de crêtes pour l'export. */

type Coef = [number, number, number, number, number]; // b0, b1, b2, a1, a2
/** Les deux filtres de la pondération K, recalculés pour la fréquence d'échantillonnage. */
function kWeighting(sr: number): Coef[] {
  const shelf = (): Coef => {
    const f0 = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196;
    const K = Math.tan(Math.PI * f0 / sr), Vh = Math.pow(10, G / 20), Vb = Math.pow(Vh, 0.4996667741545416), a0 = 1 + K / Q + K * K;
    return [(Vh + Vb * K / Q + K * K) / a0, 2 * (K * K - Vh) / a0, (Vh - Vb * K / Q + K * K) / a0, 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0];
  };
  const hp = (): Coef => {
    const f0 = 38.13547087602444, Q = 0.5003270373238773, K = Math.tan(Math.PI * f0 / sr), a0 = 1 + K / Q + K * K;
    return [1, -2, 1, 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0];
  };
  return [shelf(), hp()];
}
function biquad(x: Float32Array, [b0, b1, b2, a1, a2]: Coef): Float32Array {
  const y = new Float32Array(x.length); let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) { const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v; }
  return y;
}

/** Volume intégré en LUFS (blocs de 400 ms, double seuil). Renvoie -Infinity pour du silence. */
export function lufs(buf: AudioBuffer): number {
  const sr = buf.sampleRate, k = kWeighting(sr), blk = Math.round(sr * 0.4), hop = Math.round(sr * 0.1);
  const ch = Array.from({ length: buf.numberOfChannels }, (_, i) => biquad(biquad(buf.getChannelData(i), k[0]), k[1]));
  const pow: number[] = [];
  for (let o = 0; o + blk <= buf.length; o += hop) {
    let p = 0;
    for (const c of ch) { let e = 0; for (let i = o; i < o + blk; i++) e += c[i] * c[i]; p += e / blk; }
    pow.push(p);
  }
  const L = (p: number) => -0.691 + 10 * Math.log10(p), mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
  const abs = pow.filter(p => p > 0 && L(p) > -70);
  if (!abs.length) return -Infinity;
  const rel = L(mean(abs)) - 10, kept = abs.filter(p => L(p) > rel);
  return kept.length ? L(mean(kept)) : -Infinity;
}

export function peakOf(buf: AudioBuffer): number {
  let pk = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (v > pk) pk = v; } }
  return pk;
}

/** Applique un gain puis retient les crêtes sous `ceil` (anticipation de 5 ms, relâchement de 120 ms). */
export function gainLimit(buf: AudioBuffer, gain: number, ceil = 0.966) {
  const n = buf.length, sr = buf.sampleRate, look = Math.round(sr * 0.005), rel = Math.exp(-1 / (sr * 0.12));
  const ch = Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i));
  // Réduction nécessaire à chaque instant, étalée en avance sur la crête puis relâchée lentement.
  const g = new Float32Array(n).fill(1);
  for (let i = 0; i < n; i++) { let pk = 0; for (const c of ch) pk = Math.max(pk, Math.abs(c[i] * gain)); if (pk > ceil) g[i] = ceil / pk; }
  for (let i = n - 2; i >= 0; i--) { const next = g[i + 1] + (1 - g[i + 1]) / look; if (next < g[i]) g[i] = next; }
  for (let i = 1; i < n; i++) { const prev = 1 - (1 - g[i - 1]) * rel; if (prev < g[i]) g[i] = prev; }
  for (const c of ch) for (let i = 0; i < n; i++) c[i] *= gain * g[i];
}
