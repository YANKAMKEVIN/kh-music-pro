// V20 — Séparation des pistes : mélanges fabriqués dont on connaît chaque source (voix, batterie, basse, autres).
// Fonctions autonomes (sans dépendance) : la QA les envoie telles quelles dans la page avec `toString()`.

/** Fabrique un mélange stéréo. Renvoie { sr, mix: [L, R], src: { vocals: [L, R], drums, bass, other } }.
 *  opts : { dur (s), bpm, voice (0..1, volume de la voix), drums, bass, other, mono (tout au centre), seed,
 *           voicePan (-1..1), noVibrato } */
function stemsMix(sr, opts) {
  const o = Object.assign({ dur: 8, bpm: 120, voice: 1, drums: 1, bass: 1, other: 1, mono: false, seed: 7, voicePan: 0, noVibrato: false }, opts || {});
  const n = Math.round(o.dur * sr), beat = 60 / o.bpm;
  let seed = o.seed >>> 0;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 * 2 - 1; };
  const mk = () => [new Float32Array(n), new Float32Array(n)];
  const src = { vocals: mk(), drums: mk(), bass: mk(), other: mk() };
  const pan = (p) => o.mono ? [0.5, 0.5] : [Math.cos((p + 1) * Math.PI / 4) ** 2, Math.sin((p + 1) * Math.PI / 4) ** 2];
  const put = (dst, i, v, g) => { dst[0][i] += v * g[0] * 2; dst[1][i] += v * g[1] * 2; };   // centre : 1 et 1
  // --- Voix : mélodie, vibrato, voyelle « a » (formants 700, 1200, 2600 Hz), petites respirations entre les notes
  if (o.voice) {
    const mel = [57, 60, 62, 64, 62, 60, 59, 57, 64, 65, 67, 65, 64, 62, 60, 59], g = pan(o.voicePan);
    const form = f => Math.exp(-(((f - 700) / 130) ** 2)) + 0.6 * Math.exp(-(((f - 1200) / 150) ** 2)) + 0.35 * Math.exp(-(((f - 2600) / 220) ** 2)) + 0.02;
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr, k = Math.floor(t / (2 * beat)), tin = t - k * 2 * beat, note = mel[k % mel.length];
      const env = Math.min(1, tin / 0.04) * Math.min(1, Math.max(0, (2 * beat - 0.12 - tin) / 0.05));
      const f0 = 440 * 2 ** ((note - 69) / 12) * (1 + (o.noVibrato ? 0 : 0.012 * Math.sin(2 * Math.PI * 5.5 * t)));
      ph += f0 / sr; let v = 0;
      for (let h = 1; h * f0 < 5000; h++) v += form(h * f0) * Math.sin(2 * Math.PI * h * ph) / Math.sqrt(h);
      put(src.vocals, i, 0.18 * o.voice * env * v, g);
    }
  }
  // --- Batterie : grosse caisse (temps 1 et 3), caisse claire (2 et 4), charleston en croches, un peu à droite
  if (o.drums) {
    for (let b = 0; b * beat < o.dur; b++) {
      const hit = (t0, len, f) => { for (let i = Math.round(t0 * sr), e = Math.min(n, i + Math.round(len * sr)), j = 0; i < e; i++, j++) f(i, j / sr); };
      if (b % 2 === 0) { let ph = 0; hit(b * beat, 0.3, (i, t) => { ph += (45 + 90 * Math.exp(-t * 30)) / sr; put(src.drums, i, 0.9 * o.drums * Math.exp(-t * 12) * Math.sin(2 * Math.PI * ph), pan(0)); }); }
      else hit(b * beat, 0.2, (i, t) => put(src.drums, i, o.drums * Math.exp(-t * 22) * (0.5 * rnd() + 0.3 * Math.sin(2 * Math.PI * 185 * t)), pan(0)));
      for (const half of [0, 0.5]) { let prev = 0; hit((b + half) * beat, 0.06, (i, t) => { const w = rnd(), hp = w - prev; prev = w; put(src.drums, i, 0.25 * o.drums * Math.exp(-t * 70) * hp, pan(0.3)); }); }
    }
  }
  // --- Basse : une note par temps, quatre harmoniques, au centre
  if (o.bass) {
    const line = [33, 33, 40, 40, 38, 38, 36, 35], g = pan(0); let ph = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr, k = Math.floor(t / beat), tin = t - k * beat, f = 440 * 2 ** ((line[k % line.length] - 69) / 12);
      ph += f / sr; const env = Math.min(1, tin / 0.01) * Math.min(1, Math.max(0, (beat - 0.02 - tin) / 0.02)) * (0.7 + 0.3 * Math.exp(-tin * 4));
      const v = Math.sin(2 * Math.PI * ph) + 0.5 * Math.sin(4 * Math.PI * ph) + 0.25 * Math.sin(6 * Math.PI * ph) + 0.12 * Math.sin(8 * Math.PI * ph);
      put(src.bass, i, 0.35 * o.bass * env * v, g);
    }
  }
  // --- Autres : nappe d'accords à gauche, arpège pincé à droite (hors du centre)
  if (o.other) {
    const chords = [[57, 60, 64], [53, 57, 60], [55, 59, 62], [52, 55, 59]], gl = pan(-0.75), gr = pan(0.75);
    const phs = [0, 0, 0];
    for (let i = 0; i < n; i++) {
      const t = i / sr, c = chords[Math.floor(t / (4 * beat)) % chords.length]; let v = 0;
      c.forEach((m, j) => { phs[j] += 440 * 2 ** ((m - 69) / 12) * 1.003 / sr; for (let h = 1; h <= 5; h++) v += Math.sin(2 * Math.PI * h * phs[j]) / (h * h); });
      put(src.other, i, 0.06 * o.other * v, gl);
      const k = Math.floor(t / (beat / 2)), tin = t - k * beat / 2, m = c[k % 3] + 12, f = 440 * 2 ** ((m - 69) / 12);
      put(src.other, i, 0.12 * o.other * Math.exp(-tin * 9) * (Math.sin(2 * Math.PI * f * tin) + 0.3 * Math.sin(4 * Math.PI * f * tin)), gr);
    }
  }
  const mix = [new Float32Array(n), new Float32Array(n)];
  for (const k in src) for (let c = 0; c < 2; c++) for (let i = 0; i < n; i++) mix[c][i] += src[k][c][i];
  return { sr, mix, src };
}

/** Mesures d'une piste estimée `e` face à sa source `s` (tableaux par canal) et au mélange `m` :
 *  sdr = rapport source / erreur (dB) ; base = le même rapport si l'on rendait le mélange entier ; gain = sdr - base ;
 *  corr = corrélation de l'estimation avec la source. Ignore la première et la dernière demi-seconde. */
function stemScore(s, e, m, sr) {
  let ss = 0, ee = 0, mm = 0, se = 0, e2 = 0;
  const a = Math.round(0.5 * sr);
  for (let c = 0; c < s.length; c++) for (let i = a; i < s[c].length - a; i++) {
    const x = s[c][i], y = e[c][i];
    ss += x * x; ee += (x - y) ** 2; mm += (x - m[c][i]) ** 2; se += x * y; e2 += y * y;
  }
  const db = v => 10 * Math.log10(v);
  const sdr = db(ss / (ee + 1e-12)), base = db(ss / (mm + 1e-12));
  return { sdr: +sdr.toFixed(2), base: +base.toFixed(2), gain: +(sdr - base).toFixed(2), corr: +(se / Math.sqrt(ss * e2 + 1e-24)).toFixed(3) };
}

module.exports = { stemsMix, stemScore };
