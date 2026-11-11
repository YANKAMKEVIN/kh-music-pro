/**
 * Étirement temporel sans changement de hauteur (WSOLA) et transposition sans changement de durée.
 * Le son est découpé en grains qui se recouvrent ; chaque grain est recalé sur la forme d'onde
 * précédente pour éviter les à-coups.
 */
function wsola(ch: Float32Array[], ratio: number, sr: number): Float32Array[] {
  const n = ch[0].length, outLen = Math.max(1, Math.round(n * ratio));
  if (Math.abs(ratio - 1) < 1e-4) return ch.map(c => c.slice());
  const hs = Math.round(sr * 0.03), win = hs * 2, ha = hs / ratio, tol = Math.round(sr * 0.012);
  const w = new Float32Array(win);
  for (let i = 0; i < win; i++) w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / win);
  const ref = ch[0], out = ch.map(() => new Float32Array(outLen + win));
  const at = (i: number) => (i >= 0 && i < n ? ref[i] : 0);
  let prev = 0;
  for (let k = 0; k * hs < outLen; k++) {
    let start = Math.round(k * ha);
    if (k > 0) {
      // Cherche, autour de la position idéale, le grain qui prolonge le mieux le précédent.
      const want = prev + hs; let best = -Infinity, bd = 0;
      for (let d = -tol; d <= tol; d += 2) {
        let c = 0;
        for (let i = 0; i < hs; i += 4) c += at(start + d + i) * at(want + i);
        if (c > best) { best = c; bd = d; }
      }
      start += bd;
    }
    const o = k * hs;
    for (let c = 0; c < ch.length; c++) {
      const src = ch[c], dst = out[c];
      for (let i = 0; i < win; i++) { const j = start + i; if (j >= 0 && j < n) dst[o + i] += src[j] * w[i]; }
    }
    prev = start;
  }
  return out.map(c => c.subarray(0, outLen));
}

/** Rééchantillonnage linéaire : `speed` > 1 raccourcit et monte la hauteur. */
function resample(c: Float32Array, speed: number): Float32Array {
  const len = Math.max(1, Math.round(c.length / speed)), out = new Float32Array(len);
  for (let i = 0; i < len; i++) { const x = i * speed, j = Math.floor(x), f = x - j; out[i] = (c[j] ?? 0) * (1 - f) + (c[j + 1] ?? c[j] ?? 0) * f; }
  return out;
}

/**
 * @param ratio durée finale / durée d'origine (2 = deux fois plus long)
 * @param semis transposition en demi-tons, sans effet sur la durée
 */
export function stretchBuffer(buf: AudioBuffer, ratio: number, semis: number): AudioBuffer {
  const r = Math.pow(2, semis / 12);
  let ch: Float32Array[] = Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i));
  ch = wsola(ch, ratio * r, buf.sampleRate);
  if (semis) ch = ch.map(c => resample(c, r));
  const out = new AudioBuffer({ length: ch[0].length, numberOfChannels: ch.length, sampleRate: buf.sampleRate });
  ch.forEach((c, i) => out.getChannelData(i).set(c));
  return out;
}
