/** Détection de hauteur (méthode YIN simplifiée) pour l'accordeur. Renvoie la fréquence en Hz, ou 0 sans note nette. */
export function detectPitch(x: Float32Array, sr: number): number {
  let rms = 0;
  for (let i = 0; i < x.length; i++) rms += x[i] * x[i];
  if (Math.sqrt(rms / x.length) < 0.01) return 0;
  const W = x.length >> 1, lo = Math.floor(sr / 1200), hi = Math.min(W - 1, Math.floor(sr / 55)), d = new Float32Array(hi + 2);
  let sum = 0;
  for (let tau = 1; tau <= hi + 1; tau++) {
    let s = 0;
    for (let i = 0; i < W; i++) { const v = x[i] - x[i + tau]; s += v * v; }
    sum += s; d[tau] = sum ? s * tau / sum : 1; // différence normalisée cumulée
  }
  for (let tau = Math.max(2, lo); tau <= hi; tau++) {
    if (d[tau] < 0.12 && d[tau] <= d[tau + 1]) {
      // Affinage par interpolation parabolique autour du minimum.
      const a = d[tau - 1], b = d[tau], c = d[tau + 1], den = a - 2 * b + c;
      return sr / (tau + (den ? (a - c) / (2 * den) : 0));
    }
  }
  return 0;
}

/** Note la plus proche et écart en centièmes de demi-ton (la = 440 Hz). */
export function noteOf(hz: number): { midi: number; cents: number } {
  const m = 69 + 12 * Math.log2(hz / 440), midi = Math.round(m);
  return { midi, cents: Math.round((m - midi) * 100) };
}
