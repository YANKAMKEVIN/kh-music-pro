/** Instruments dont une portion tenue peut être prolongée, sans répéter l'attaque. */
export const SUSTAIN_BANKS = new Set(['drawbar', 'church', 'strings', 'cello', 'violin', 'contrabass', 'choir', 'air', 'cinema', 'synthchoir']);
export interface SustainLoop { start: number; end: number }

/** Prépare une boucle avec raccord de phase et fondu croisé, une seule fois au chargement.
 * Le tampon original reste intact : un ancien projet ou le mode sans maintien garde son son.
 */
export function sustainSample(buf: AudioBuffer, midi: number, onset: number): { buf: AudioBuffer; loop: SustainLoop } | null {
  const sr = buf.sampleRate, n = buf.length, channels = Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i));
  const start = Math.round((onset + 0.6) * sr), fade = Math.round(0.04 * sr);
  const nominal = Math.min(n - fade - 1, Math.round((onset + 2.2) * sr));
  if (nominal - start < sr * 0.5) return null;
  const period = sr / (440 * Math.pow(2, (midi - 69) / 12));
  const radius = Math.ceil(Math.min(sr * 0.05, period * 2));
  let end = nominal, best = -Infinity;
  // Rechercher une fenêtre finale proche de celle qui sera fondue au début de la boucle.
  for (let candidate = nominal - radius; candidate <= Math.min(n - 1, nominal + radius); candidate += 2) {
    let dot = 0, a2 = 0, b2 = 0;
    for (const d of channels) for (let i = 0; i < fade; i += 4) {
      const a = d[candidate - fade + i], b = d[start + i];
      dot += a * b; a2 += a * a; b2 += b * b;
    }
    const score = dot / Math.sqrt(Math.max(1e-20, a2 * b2));
    if (a2 > 1e-10 && b2 > 1e-10 && score > best) { best = score; end = candidate; }
  }
  if (!Number.isFinite(best)) return null;
  const out = new AudioBuffer({ length: n, numberOfChannels: channels.length, sampleRate: sr });
  channels.forEach((src, c) => {
    const dst = out.getChannelData(c); dst.set(src);
    for (let i = 0; i < fade; i++) {
      const w = i / (fade - 1);
      dst[end - fade + i] = src[end - fade + i] * (1 - w) + src[start + i] * w;
    }
  });
  // Le dernier échantillon fondu précède exactement le premier qui sera relu.
  return { buf: out, loop: { start: (start + fade) / sr, end: end / sr } };
}
