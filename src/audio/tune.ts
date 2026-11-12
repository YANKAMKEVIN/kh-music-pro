/**
 * Correction de justesse : chaque court instant du son est ramené vers la note la plus proche de la gamme,
 * sans changer la durée. Le son est relu par grains recalés les uns sur les autres (comme pour l'étirement),
 * chaque grain étant lu un peu plus vite ou un peu plus lentement selon la correction voulue.
 */
import { detectPitch } from './pitch';

/** @param amount 0..1 (1 = note exacte)  @param inScale dit si une note MIDI appartient à la gamme visée */
export function tuneBuffer(buf: AudioBuffer, amount: number, inScale: (midi: number) => boolean): { out: AudioBuffer; voiced: number; meanCents: number } {
  const sr = buf.sampleRate, n = buf.length, ref = buf.getChannelData(0);
  const hs = Math.round(sr * 0.015), win = hs * 2, tol = Math.round(sr * 0.01), frames = Math.ceil(n / hs) + 1, half = 1024;
  // 1. Hauteur de chaque instant, et rapport de lecture qui le ramène sur la gamme.
  const ratio = new Float32Array(frames).fill(1); let voiced = 0, sum = 0;
  const frame = new Float32Array(half * 2);
  for (let k = 0; k < frames; k++) {
    const c = k * hs;
    for (let i = 0; i < half * 2; i++) { const j = c - half + i; frame[i] = j >= 0 && j < n ? ref[j] : 0; }
    const hz = detectPitch(frame, sr);
    if (!hz) continue;
    const m = 69 + 12 * Math.log2(hz / 440); let target = Math.round(m);
    for (let d = 0; d < 7 && !inScale(target); d++) { const lo = Math.round(m) - d - 1, hi = Math.round(m) + d + 1; target = inScale(lo) && (!inScale(hi) || m - lo <= hi - m) ? lo : inScale(hi) ? hi : target; }
    const diff = target - m;
    if (Math.abs(diff) > 2) continue; // écart trop grand : sans doute une erreur de détection, on ne touche à rien
    ratio[k] = Math.pow(2, diff * amount / 12); voiced++; sum += Math.abs(diff) * 100;
  }
  // Lissage : la correction glisse d'une note à l'autre au lieu de sauter.
  for (let k = 1; k < frames; k++) ratio[k] = ratio[k - 1] * 0.45 + ratio[k] * 0.55;

  // 2. Resynthèse par grains qui se recouvrent.
  const w = new Float32Array(win);
  for (let i = 0; i < win; i++) w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / win);
  const out = new AudioBuffer({ length: n, numberOfChannels: buf.numberOfChannels, sampleRate: sr });
  const src = Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c)), dst = src.map(() => new Float32Array(n + win));
  const at = (i: number) => (i >= 0 && i < n ? ref[i] : 0);
  let prev = 0, prevR = 1;
  for (let k = 0; k * hs < n; k++) {
    let start = k * hs;
    if (k > 0 && (prevR !== 1 || ratio[k] !== 1 || prev !== start - hs)) {
      const want = prev + Math.round(hs * prevR); let best = -Infinity, bd = 0;
      for (let d = -tol; d <= tol; d += 2) { let c = 0; for (let i = 0; i < hs; i += 4) c += at(start + d + i) * at(want + i); if (c > best) { best = c; bd = d; } }
      start += bd;
    }
    const r = ratio[k], o = k * hs;
    for (let c = 0; c < src.length; c++) {
      const s = src[c], d = dst[c];
      for (let i = 0; i < win; i++) { const x = start + i * r, j = Math.floor(x), f = x - j; if (j >= 0 && j + 1 < n) d[o + i] += (s[j] * (1 - f) + s[j + 1] * f) * w[i]; }
    }
    prev = start; prevR = r;
  }
  dst.forEach((d, c) => out.getChannelData(c).set(d.subarray(0, n)));
  return { out, voiced: voiced / frames, meanCents: voiced ? sum / voiced : 0 };
}
