/** Instruments dont une portion tenue peut être prolongée, sans répéter l'attaque. */
export const SUSTAIN_BANKS = new Set(['drawbar', 'church', 'strings', 'cello', 'violin', 'contrabass', 'choir', 'air', 'cinema', 'synthchoir']);
export interface SustainLoop { start: number; end: number }

/** Deux sons imparfaitement en phase s'additionnent mal pendant un fondu : le niveau creuse ou gonfle,
 * et ce défaut reviendrait à chaque tour de boucle comme une pulsation. On ramène donc chaque tranche
 * de 5 ms du fondu au niveau attendu (passage progressif d'un niveau à l'autre), avec un gain lissé.
 */
function levelFade(src: Float32Array[], out: AudioBuffer, start: number, end: number, fade: number, sr: number, q: number) {
  const blk = Math.max(16, Math.round(sr * 0.005)), nb = Math.max(1, Math.floor(fade / blk)), gains: number[] = [];
  for (let b = 0; b < nb; b++) {
    let pe = 0, ps = 0, pm = 0;
    const w = (b + 0.5) / nb;
    for (let c = 0; c < src.length; c++) {
      const s = src[c], d = out.getChannelData(c);
      for (let i = b * blk; i < (b + 1) * blk; i++) { const e = s[end - fade + i] * q, st = s[start + i], m = d[end - fade + i]; pe += e * e; ps += st * st; pm += m * m; }
    }
    const want = Math.sqrt((1 - w) * pe + w * ps);
    gains.push(pm > 1e-12 ? Math.min(2.5, Math.max(0.4, want / Math.sqrt(pm))) : 1);
  }
  // Interpolation entre les centres des tranches ; gain 1 aux deux bords du fondu pour rester continu.
  const at = (i: number) => {
    const x = i / blk - 0.5;
    if (x <= 0) return 1 + (gains[0] - 1) * Math.max(0, (x + 0.5) * 2);
    if (x >= nb - 1) return gains[nb - 1] + (1 - gains[nb - 1]) * Math.min(1, (x - (nb - 1)) * 2);
    const k = Math.floor(x), f = x - k; return gains[k] * (1 - f) + gains[k + 1] * f;
  };
  for (let c = 0; c < out.numberOfChannels; c++) {
    const d = out.getChannelData(c);
    for (let i = 0; i < fade; i++) d[end - fade + i] *= at(i);
  }
}

/** Prépare une boucle avec raccord de phase et fondu croisé, une seule fois au chargement.
 * Le tampon original reste intact : un ancien projet ou le mode sans maintien garde son son.
 */
export function sustainSample(buf: AudioBuffer, midi: number, onset: number): { buf: AudioBuffer; loop: SustainLoop } | null {
  const sr = buf.sampleRate, n = buf.length, channels = Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i));
  const start = Math.round((onset + 0.6) * sr), fade = Math.round(0.1 * sr);
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
  // Un son qui s'éteint lentement est plus faible en fin de boucle qu'au début : sans correction,
  // chaque tour ferait une petite marche de niveau. Le corps de la boucle reçoit donc un gain qui
  // glisse progressivement de 1 jusqu'au rapport des deux niveaux.
  // Niveaux mesurés sur un quart de seconde : assez long pour ignorer le vibrato et les fluctuations d'un ensemble.
  const span = Math.min(Math.round(0.25 * sr), Math.floor((end - start) / 3));
  const rmsAt = (a: number) => { let e = 0; for (const d of channels) for (let i = a; i < a + span; i++) e += d[i] * d[i]; return Math.sqrt(e / (span * channels.length)); };
  const pe = rmsAt(end - span), ps = rmsAt(start), q = pe > 1e-9 ? Math.min(2, Math.max(0.5, ps / pe)) : 1;
  const b0 = start + fade, b1 = end - fade, gainAt = (i: number) => (i <= b0 ? 1 : Math.pow(q, (i - b0) / Math.max(1, b1 - b0)));
  const out = new AudioBuffer({ length: n, numberOfChannels: channels.length, sampleRate: sr });
  channels.forEach((src, c) => {
    const dst = out.getChannelData(c); dst.set(src);
    for (let i = b0; i < b1; i++) dst[i] = src[i] * gainAt(i);
    for (let i = 0; i < fade; i++) {
      const w = i / (fade - 1);
      dst[end - fade + i] = src[end - fade + i] * q * (1 - w) + src[start + i] * w;
    }
  });
  levelFade(channels, out, start, end, fade, sr, q);
  // Le dernier échantillon fondu précède exactement le premier qui sera relu.
  return { buf: out, loop: { start: (start + fade) / sr, end: end / sr } };
}
