/* Empreinte sonore de référence (V17) : mesure un export WAV et le compare à une empreinte enregistrée dans qa/empreintes/.
 *
 * Ce qui est mesuré, sur le fichier tel qu'il sort de l'application :
 *  - durée, crête, volume perçu (LUFS intégré, pondération K de la norme BS.1770) ;
 *  - enveloppe : niveau par tranche de 250 ms, pour voir une piste qui disparaît ou un passage qui change ;
 *  - spectre : énergie relative par octave (31 Hz à 16 kHz), pour voir un timbre qui change (filtre, son absent) ;
 *  - défauts : clics (rupture brutale de la forme d'onde), coupures (trou de 10 ms au milieu du son),
 *    saturation (échantillons à pleine échelle) et valeurs invalides.
 *
 * Mise à jour volontaire des références : KH_EMPREINTE=maj (par exemple après un changement de son voulu et écouté).
 * Une empreinte absente fait échouer le cas, sauf en mode mise à jour : on ne crée jamais une référence sans le vouloir. */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, 'empreintes');
const UPDATE = process.env.KH_EMPREINTE === 'maj';

/** Lit un WAV PCM 16 bits (celui de l'export) : fréquence et canaux en flottants. */
function readWav(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error('fichier WAV invalide');
  let o = 12, sr = 0, nch = 0, bits = 0, data = null;
  while (o + 8 <= buf.length) {
    const id = buf.toString('ascii', o, o + 4), len = buf.readUInt32LE(o + 4);
    if (id === 'fmt ') { nch = buf.readUInt16LE(o + 10); sr = buf.readUInt32LE(o + 12); bits = buf.readUInt16LE(o + 22); }
    if (id === 'data') { data = buf.subarray(o + 8, o + 8 + len); break; }
    o += 8 + len + (len & 1);
  }
  if (!data || bits !== 16) throw new Error('WAV 16 bits attendu');
  const n = Math.floor(data.length / (2 * nch)), ch = Array.from({ length: nch }, () => new Float32Array(n));
  for (let i = 0; i < n; i++) for (let c = 0; c < nch; c++) ch[c][i] = data.readInt16LE((i * nch + c) * 2) / 32768;
  return { sr, ch };
}

const db = x => 20 * Math.log10(Math.max(1e-9, x));

/** Biquad (forme directe I) appliqué sur place. */
function biquad(d, [b0, b1, b2, a1, a2]) {
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < d.length; i++) { const x = d[i], y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = x; y2 = y1; y1 = y; d[i] = y; }
}
/** Volume perçu intégré (BS.1770-4 : pondération K, blocs de 400 ms, portes absolue et relative). */
function lufs({ sr, ch }) {
  // Filtres de la norme recalculés pour la fréquence du fichier (formules de pyloudnorm).
  const shelf = (() => { const G = 3.99984385397, Q = 0.7071752369554193, fc = 1681.974450955533, K = Math.tan(Math.PI * fc / sr), Vh = Math.pow(10, G / 20), Vb = Math.pow(Vh, 0.4996667741545416);
    const a0 = 1 + K / Q + K * K; return [(Vh + Vb * K / Q + K * K) / a0, 2 * (K * K - Vh) / a0, (Vh - Vb * K / Q + K * K) / a0, 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0]; })();
  const hp = (() => { const Q = 0.5003270373253953, fc = 38.13547087613982, K = Math.tan(Math.PI * fc / sr), a0 = 1 + K / Q + K * K;
    return [1, -2, 1, 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0]; })();
  const w = ch.map(c => { const d = Float32Array.from(c); biquad(d, shelf); biquad(d, hp); return d; });
  const blk = Math.round(0.4 * sr), hop = Math.round(0.1 * sr), z = [];
  for (let s = 0; s + blk <= w[0].length; s += hop) { let e = 0; for (const d of w) { let q = 0; for (let i = s; i < s + blk; i++) q += d[i] * d[i]; e += q / blk; } z.push(e); }
  const L = e => -0.691 + 10 * Math.log10(Math.max(1e-12, e));
  const abs = z.filter(e => L(e) > -70); if (!abs.length) return -99;
  const rel = L(abs.reduce((a, b) => a + b, 0) / abs.length) - 10, g = abs.filter(e => L(e) > rel);
  return +L(g.reduce((a, b) => a + b, 0) / g.length).toFixed(2);
}

/** FFT réelle en place (radix 2), renvoie la puissance par case. */
function power(frame) {
  const n = frame.length, re = Float64Array.from(frame), im = new Float64Array(n);
  for (let i = 1, j = 0; i < n; i++) { let b = n >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; } }
  for (let len = 2; len <= n; len <<= 1) {
    const a = -2 * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) { let cr = 1, ci = 0; for (let k = 0; k < len / 2; k++) {
      const p = i + k, q = p + len / 2, tr = re[q] * cr - im[q] * ci, ti = re[q] * ci + im[q] * cr;
      re[q] = re[p] - tr; im[q] = im[p] - ti; re[p] += tr; im[p] += ti; const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t; } }
  }
  const out = new Float64Array(n / 2); for (let k = 0; k < n / 2; k++) out[k] = re[k] * re[k] + im[k] * im[k]; return out;
}
const BANDS = [31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

/** Mesure complète d'un enregistrement { sr, ch }. */
function fingerprint(audio) {
  const { sr, ch } = audio, n = ch[0].length;
  const mono = new Float32Array(n); for (const c of ch) for (let i = 0; i < n; i++) mono[i] += c[i] / ch.length;
  let peak = 0, clip = 0, bad = 0;
  for (const c of ch) for (let i = 0; i < n; i++) { const v = c[i]; if (!Number.isFinite(v)) { bad++; continue; } const a = Math.abs(v); if (a > peak) peak = a; if (a >= 0.999) clip++; }
  // Enveloppe (250 ms) et tranches fines (10 ms) pour les coupures.
  const rmsWin = W => { const out = []; for (let s = 0; s < n; s += W) { let q = 0; const e = Math.min(n, s + W); for (let i = s; i < e; i++) q += mono[i] * mono[i]; out.push(Math.sqrt(q / Math.max(1, e - s))); } return out; };
  const env = rmsWin(Math.round(sr / 4)).map(v => +db(v).toFixed(1));
  const fine = rmsWin(Math.round(sr / 100)).map(db);
  // Coupure : une tranche de 10 ms plus de 30 dB sous ses voisines à 50 ms, alors que le son est bien présent autour (> -40 dB).
  const drops = [];
  for (let w = 5; w < fine.length - 5; w++) {
    const a = fine[w - 5], b = fine[w + 5];
    if (a > -40 && b > -40 && fine[w] < Math.min(a, b) - 30 && !(drops.length && w - drops[drops.length - 1] < 10)) drops.push(w);
  }
  // Clic : saut de la dérivée seconde très au-dessus de son niveau habituel dans les 20 ms autour (les attaques naturelles montent progressivement).
  const B = Math.round(sr / 50), nb = Math.ceil(n / B), bm = new Float64Array(nb), e2 = new Float32Array(n);
  for (let i = 2; i < n; i++) e2[i] = Math.abs(mono[i] - 2 * mono[i - 1] + mono[i - 2]);
  for (let i = 0; i < n; i++) bm[Math.floor(i / B)] += e2[i] / B;
  const clicks = [];
  for (let i = 2; i < n; i++) {
    if (e2[i] < 0.08) continue;
    const k = Math.floor(i / B), ref = Math.max(bm[Math.max(0, k - 1)], bm[Math.min(nb - 1, k + 1)], 1e-6);
    if (e2[i] > 25 * ref && !(clicks.length && i - clicks[clicks.length - 1] < sr / 200)) clicks.push(i);
  }
  // Spectre moyen par octave, en dB relatifs à l'énergie totale (le niveau global est mesuré à part).
  const N = 4096, win = Float32Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1)));
  const acc = new Float64Array(N / 2); let frames = 0;
  for (let s = 0; s + N <= n; s += N) { const f = new Float32Array(N); for (let i = 0; i < N; i++) f[i] = mono[s + i] * win[i]; const p = power(f); for (let k = 0; k < N / 2; k++) acc[k] += p[k]; frames++; }
  const total = acc.reduce((a, b) => a + b, 0) || 1e-12, bands = {};
  let cen = 0; for (let k = 0; k < N / 2; k++) cen += acc[k] * k * sr / N;
  for (const f of BANDS) { let e = 0; const lo = f / Math.SQRT2, hi = f * Math.SQRT2; for (let k = 1; k < N / 2; k++) { const fk = k * sr / N; if (fk >= lo && fk < hi) e += acc[k]; } bands[f] = +(10 * Math.log10(Math.max(1e-12, e / total))).toFixed(2); }
  return {
    dur: +(n / sr).toFixed(3), sr, peakDb: +db(peak).toFixed(2), lufs: lufs(audio), centroid: Math.round(cen / total),
    bands, env, clicks: clicks.map(i => +(i / sr).toFixed(3)), drops: drops.map(w => +(w / 100).toFixed(2)), clip, bad, frames,
  };
}

/** Écarts entre une mesure et sa référence ; liste vide = conforme. `tol` : tolérances (dB) à desserrer au besoin. */
function compare(ref, cur, tol = {}) {
  const T = { dur: 0.05, peak: 1, lufs: 1, envMean: 1, envMax: 6, band: 2, ...tol }, out = [];
  if (cur.bad) out.push(`${cur.bad} valeur(s) invalide(s)`);
  if (cur.clip > ref.clip) out.push(`saturation : ${cur.clip} échantillon(s) à pleine échelle (référence ${ref.clip})`);
  // Clics et coupures : tout événement absent de la référence (à 20 ms / 50 ms près) est un défaut nouveau.
  // (Une attaque très franche, caisse claire ou craquement de vinyle voulu, figure déjà dans la référence.)
  const fresh = (a, b, w) => a.filter(t => !b.some(r => Math.abs(r - t) < w));
  const nc = fresh(cur.clicks, ref.clicks, 0.02), nd = fresh(cur.drops, ref.drops, 0.05);
  if (nc.length) out.push(`clics : ${nc.length} nouveau(x) vers ${nc.slice(0, 5).join(', ')} s (référence ${ref.clicks.length})`);
  if (nd.length) out.push(`coupures : ${nd.length} nouvelle(s) vers ${nd.slice(0, 5).join(', ')} s (référence ${ref.drops.length})`);
  if (Math.abs(cur.dur - ref.dur) > T.dur) out.push(`durée ${cur.dur} s (référence ${ref.dur} s)`);
  if (Math.abs(cur.peakDb - ref.peakDb) > T.peak) out.push(`crête ${cur.peakDb} dB (référence ${ref.peakDb} dB)`);
  if (Math.abs(cur.lufs - ref.lufs) > T.lufs) out.push(`volume perçu ${cur.lufs} LUFS (référence ${ref.lufs} LUFS)`);
  // Enveloppe : seulement là où il y a du son, d'un côté ou de l'autre.
  const m = Math.min(ref.env.length, cur.env.length); let sum = 0, k = 0, worst = 0, at = 0;
  for (let i = 0; i < m; i++) { if (ref.env[i] < -50 && cur.env[i] < -50) continue; const d = Math.abs(ref.env[i] - cur.env[i]); sum += d; k++; if (d > worst) { worst = d; at = i; } }
  if (k && sum / k > T.envMean) out.push(`enveloppe : écart moyen ${(sum / k).toFixed(2)} dB`);
  if (worst > T.envMax) out.push(`enveloppe : écart de ${worst.toFixed(1)} dB à ${(at / 4).toFixed(2)} s (${ref.env[at]} → ${cur.env[at]} dB)`);
  for (const f of BANDS) { const r = ref.bands[f], c = cur.bands[f]; if ((r > -40 || c > -40) && Math.abs(r - c) > T.band) out.push(`octave ${f} Hz : ${c} dB (référence ${r} dB)`); }
  return out;
}

/** Défauts absolus, indépendants de toute référence. */
function defects(fp) {
  const out = [];
  if (fp.bad) out.push(`${fp.bad} valeur(s) invalide(s)`);
  if (fp.clip) out.push(`${fp.clip} échantillon(s) saturé(s)`);
  if (fp.peakDb > -0.1) out.push(`crête ${fp.peakDb} dB`);
  return out;
}

/** Compare à la référence `name` (ou l'enregistre en mode mise à jour). Renvoie { fp, problems, updated }. */
function check(name, audio, tol) {
  const fp = fingerprint(audio), file = path.join(DIR, name + '.json');
  if (UPDATE) { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(file, JSON.stringify(fp) + '\n'); return { fp, problems: defects(fp), updated: true }; }
  if (!fs.existsSync(file)) return { fp, problems: [`empreinte de référence absente (${path.relative(process.cwd(), file)}) : la créer avec KH_EMPREINTE=maj après écoute`], updated: false };
  const ref = JSON.parse(fs.readFileSync(file, 'utf8'));
  return { fp, ref, problems: [...defects(fp), ...compare(ref, fp, tol)], updated: false };
}

module.exports = { readWav, fingerprint, compare, defects, check, lufs, UPDATE, DIR };
