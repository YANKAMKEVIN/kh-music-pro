/** V20 — Batterie → motif : repérage des coups dans le son (traitement du signal, sans modèle appris).
 *
 *  Méthode : spectrogramme en bandes d'un tiers d'octave, puis factorisation en matrices non négatives (NMF, divergence de
 *  Kullback-Leibler) avec quatre gabarits de départ (grosse caisse, caisse claire, métal = charleston et cymbales, toms),
 *  que l'algorithme ajuste au son. Chaque gabarit donne une courbe d'activation ; ses pics sont les coups.
 *  Le métal est ensuite départagé par la durée de résonance (charleston fermé, ouvert, cymbale), les toms par leur hauteur.
 *
 *  Tout est dans UNE fonction sans dépendance : elle est recopiée telle quelle dans un Worker (`detectDrums.toString()`),
 *  ce qui marche aussi dans la version bureau (pages en file://). */

export type DrumClass = 'kick' | 'snare' | 'hat' | 'tom';
export interface DrumHit {
  /** début du coup, en secondes */
  t: number;
  cls: DrumClass;
  /** force relative 0..1 (1 = les coups les plus forts de cet instrument) */
  vel: number;
  /** vitesse d'extinction mesurée juste après le coup, en dB par seconde (métal) */
  decay?: number;
  /** hauteur dominante des fûts graves, en Hz (grosse caisse ou tom) */
  pitch?: number;
  /** coup de métal tombé en même temps qu'une grosse caisse ou une caisse claire (extinction moins sûre) */
  shared?: boolean;
}
/** `debug` : forces de référence, présence, nombre de pics candidats et fuites mesurées, par instrument (QA, réglages). */
export interface DrumScan { hits: DrumHit[]; hop: number; sr: number; frames: number; debug?: { refs: number[]; present: boolean[]; cand: number[]; leak: number[][] } }

export function detectDrums(x: Float32Array, sr: number, report?: (f: number) => void): DrumScan {
  const KICK_MAX_HZ = 100, GHOST_HAT = 0.5, SNARE_HOLD = 0.5, KICK_HAT_SNARE = 0.6;   // au-dessus, un fût grave est un tom (mesuré par la QA, cas DR)
  const N = 2048, HOP = 256, half = N / 2;
  // silence ajouté avant et après : un coup au tout début du son a lui aussi une montée
  const PAD = N, xs = new Float32Array(x.length + 2 * PAD); xs.set(x, PAD); x = xs;
  const frames = Math.max(0, Math.floor((x.length - N) / HOP) + 1);
  if (frames < 8) return { hits: [], hop: HOP, sr, frames };

  // ---- bandes d'un tiers d'octave (moyenne des amplitudes des raies, pour qu'un bruit blanc soit plat) ----
  const binHz = sr / N, top = Math.min(16000, sr * 0.45);
  const bands: { a: number; b: number; fc: number }[] = [];
  for (let lo = 30; lo < top; lo *= Math.pow(2, 1 / 3)) {
    const hi = Math.min(top, lo * Math.pow(2, 1 / 3));
    const a = Math.max(1, Math.round(lo / binHz)), b = Math.max(a + 1, Math.round(hi / binHz));
    if (bands.length && a < bands[bands.length - 1].b) { const L = bands[bands.length - 1]; L.b = Math.max(L.b, b); L.fc = Math.sqrt(L.fc * hi); continue; }
    bands.push({ a, b, fc: Math.sqrt(lo * hi) });
  }
  const B = bands.length;

  // ---- FFT (radix 2, en place) ----
  const win = new Float32Array(N); for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);
  const rev = new Uint32Array(N); for (let i = 0, j = 0; i < N; i++) { rev[i] = j; let m = N >> 1; while (m >= 1 && (j & m)) { j ^= m; m >>= 1; } j |= m; }
  const cs = new Float32Array(half), sn = new Float32Array(half);
  for (let i = 0; i < half; i++) { cs[i] = Math.cos(-2 * Math.PI * i / N); sn[i] = Math.sin(-2 * Math.PI * i / N); }
  const re = new Float32Array(N), im = new Float32Array(N);
  const V = new Float32Array(B * frames);   // V[b * frames + t]
  for (let f = 0; f < frames; f++) {
    const o = f * HOP;
    for (let i = 0; i < N; i++) { re[rev[i]] = x[o + i] * win[i]; im[rev[i]] = 0; }
    for (let size = 2; size <= N; size <<= 1) {
      const h2 = size >> 1, step = N / size;
      for (let s = 0; s < N; s += size) for (let k = 0; k < h2; k++) {
        const wr = cs[k * step], wi = sn[k * step], p = s + k, q = p + h2;
        const tr = re[q] * wr - im[q] * wi, ti = re[q] * wi + im[q] * wr;
        re[q] = re[p] - tr; im[q] = im[p] - ti; re[p] += tr; im[p] += ti;
      }
    }
    for (let b = 0; b < B; b++) {
      let s = 0; const { a, b: e } = bands[b];
      for (let k = a; k < e; k++) s += Math.sqrt(re[k] * re[k] + im[k] * im[k]);
      V[b * frames + f] = s / (e - a);
    }
    if (report && (f & 1023) === 0) report(0.35 * f / frames);
  }
  // ---- blanchiment : chaque bande ramenée à son niveau habituel (sinon les basses, très concentrées, écrasent le charleston) ----
  const Vraw = V.slice(), lvl = new Float32Array(B);
  for (let b = 0; b < B; b++) { const v = Array.from(V.subarray(b * frames, (b + 1) * frames)).sort((p, q) => p - q); lvl[b] = v[Math.floor(v.length * 0.95)]; }
  const lmax = Math.max(...lvl, 1e-12);
  for (let b = 0; b < B; b++) { const d = Math.max(lvl[b], 0.004 * lmax); for (let t = 0; t < frames; t++) V[b * frames + t] = V[b * frames + t] / d + 1e-6; }

  // ---- gabarits de départ (zéro = interdit : les mises à jour multiplicatives gardent ces zéros) ----
  // 0 = fûts graves (grosse caisse et toms, départagés ensuite par leur hauteur), 1 = caisse claire et clap, 2 = métal.
  // 3 = attaque (clic de grosse caisse, bois) : absorbe ce clic pour qu'avec un charleston il ne passe pas pour une caisse claire ; non restituée.
  const K = 4;
  const g = (fc: number, c: number, w: number) => Math.exp(-0.5 * Math.pow(Math.log2(fc / c) / w, 2));
  const W = new Float32Array(B * K);   // W[b * K + k]
  for (let b = 0; b < B; b++) {
    const fc = bands[b].fc;
    W[b * K + 0] = fc < 800 ? g(fc, 90, 1.5) + 0.03 : fc < 4000 ? 0.05 : 0;
    W[b * K + 1] = fc < 90 ? 0 : fc < 500 ? 0.5 * g(fc, 220, 0.6) + 0.05 : fc < 800 ? 0.4 : fc < 6000 ? 1 : 0.6;
    W[b * K + 2] = fc < 500 ? 0 : fc < 2000 ? 0.08 : fc < 4000 ? 0.2 : 1;
    W[b * K + 3] = fc < 150 || fc > 2000 ? 0 : g(fc, 500, 0.9);
  }
  const normW = () => { for (let k = 0; k < K; k++) { let s = 0; for (let b = 0; b < B; b++) s += W[b * K + k]; for (let b = 0; b < B; b++) W[b * K + k] /= s; } };
  normW();
  const W0 = W.slice();

  // ---- NMF (divergence KL) ----
  const H = new Float32Array(K * frames);   // H[k * frames + t]
  const R = new Float32Array(B * frames);
  const fps = sr / HOP, hits: DrumHit[] = [];
  type Pk = { f: number; p: number; t: number; k: number; mn: number };
  const Hk = (k: number, f: number) => H[k * frames + f];
  /** Une passe : activations (et, si `learn`, adaptation des gabarits), pics retenus par instrument. */
  const pass = (learn: boolean) => {
    for (let k = 0; k < K; k++) for (let t = 0; t < frames; t++) { let s = 0; for (let b = 0; b < B; b++) s += W[b * K + k] * V[b * frames + t]; H[k * frames + t] = s + 1e-6; }
    const ratio = () => { for (let b = 0; b < B; b++) for (let t = 0; t < frames; t++) { let s = 1e-9; for (let k = 0; k < K; k++) s += W[b * K + k] * H[k * frames + t]; R[b * frames + t] = V[b * frames + t] / s; } };
    const ITER = learn ? 60 : 40;
    for (let it = 0; it < ITER; it++) {
      // H ← H · (Wᵀ R) / (Wᵀ 1) ; colonnes de W de somme 1
      ratio();
      for (let k = 0; k < K; k++) for (let t = 0; t < frames; t++) {
        let s = 0; for (let b = 0; b < B; b++) s += W[b * K + k] * R[b * frames + t];
        H[k * frames + t] *= s;
      }
      if (learn && it >= 15 && it < 50) {
        // W s'adapte au timbre réel du kit, ramené en partie vers le gabarit pour que les rôles ne s'échangent pas.
        ratio();
        for (let k = 0; k < K; k++) {
          let hs = 1e-9; for (let t = 0; t < frames; t++) hs += H[k * frames + t];
          for (let b = 0; b < B; b++) { if (!W0[b * K + k]) continue; let s = 0; for (let t = 0; t < frames; t++) s += R[b * frames + t] * H[k * frames + t]; W[b * K + k] *= s / hs; }
        }
        normW();
        // la caisse claire est tenue plus près de son gabarit : rare face au charleston, elle dériverait vers lui
        for (let i = 0; i < W.length; i++) { const a = i % K === 1 ? SNARE_HOLD : 0.15; W[i] = (1 - a) * W[i] + a * W0[i]; }
        normW();
      }
      if (report) report(0.35 + (learn ? 0.35 : 0.2) * (it + 1) / ITER + (learn ? 0 : 0.35));
    }

    // ---- pics des activations ----
    const peaks: Pk[][] = [];
    for (let k = 0; k < K; k++) {
      const h = H.subarray(k * frames, (k + 1) * frames), out: Pk[] = [];
      for (let t = 2; t < frames - 2; t++) {
        if (!(h[t] >= h[t - 1] && h[t] > h[t + 1] && h[t] >= h[t - 2] && h[t] >= h[t + 2])) continue;
        let lo = t, mn = h[t];
        for (let j = t - 1; j >= Math.max(0, t - 14); j--) { if (h[j] < mn) { mn = h[j]; lo = j; } if (h[j] > h[t]) break; }
        const p = h[t] - mn;
        if (p <= 0) continue;
        // instant du coup : passage à mi-hauteur de la montée (fenêtre centrée)
        let c = t; const mid = mn + p / 2;
        while (c > lo && h[c - 1] >= mid) c--;
        const fr = c > lo ? (mid - h[c - 1]) / Math.max(1e-12, h[c] - h[c - 1]) : 0;
        out.push({ f: t, p, t: ((c - 1 + fr) * HOP + N / 2 - PAD) / sr, k, mn });
      }
      peaks.push(out);
    }
    // force de référence : parmi les pics nets (plus du quart du plus fort), celui du premier quart (les coups appuyés)
    const refOf = (ps: Pk[]) => { const v = ps.map(x => x.p).sort((a, b) => b - a); if (!v.length) return 0; const strong = v.filter(p => p > 0.25 * v[0]); return strong[Math.floor(strong.length * 0.25)]; };
    const refs = peaks.map(refOf);
    // un instrument absent : ses « pics » ne dépassent pas nettement son niveau habituel
    const present = refs.map((ref, k) => { const v = Array.from(H.subarray(k * frames, (k + 1) * frames)).sort((a, b) => a - b); return ref > 4 * v[v.length >> 1]; });
    const minGap = Math.round(0.045 * fps);
    const kept: Pk[][] = peaks.map((ps, k) => {
      const ref = refs[k];
      if (!present[k]) return [];
      let q = ps.filter(x => x.p >= 0.1 * ref);
      // deux pics trop proches : on garde le plus fort
      q = q.filter((x, i) => !q.some((y, j) => j !== i && Math.abs(y.f - x.f) <= minGap && (y.p > x.p || (y.p === x.p && j < i))));
      return q;
    });
    // Fuites : un son réel déborde un peu sur les autres gabarits (le médium d'un charleston acoustique sur la caisse claire,
    // le clic d'une grosse caisse…). On mesure ce débordement sur les coups de la source qui ne tombent pas avec un vrai coup
    // de la cible, puis on le retranche de chaque pic de la cible. Une ghost note réelle, elle, dépasse la fuite attendue.
    const leak: number[][] = [0, 1, 2].map(k => [0, 1, 2, 3].map(c => {
      // seule la caisse claire est corrigée : les aigus d'une caisse claire ne se distinguent pas d'un vrai charleston joué
      // avec elle, ni le grave d'une caisse claire d'une grosse caisse jouée avec elle
      if (k !== 1 || c === k) return 0;
      const q: number[] = [];
      for (const y of kept[c]) {
        // coups nets de la source, sans vrai coup de la cible ni troisième instrument en même temps
        if (y.p < 0.5 * refs[c] || kept[k].some(x => Math.abs(x.t - y.t) <= 0.025 && x.p >= 0.85 * refs[k])) continue;
        if ([0, 1, 2, 3].some(o => o !== k && o !== c && kept[o].some(x => Math.abs(x.t - y.t) <= 0.025 && x.p >= 0.3 * refs[o]))) continue;
        let m = 0; for (let f = Math.max(0, y.f - 3); f <= Math.min(frames - 1, y.f + 3); f++) m = Math.max(m, Hk(k, f));
        q.push(m / Math.max(1e-9, Hk(c, y.f)));
      }
      q.sort((a, b) => a - b);
      return q.length >= 3 ? Math.min(3, q[q.length >> 1]) : 0;
    }));
    for (let k = 0; k < 3; k++) kept[k] = kept[k].filter(x => {
      let e = 0;
      for (let c = 0; c < 4; c++) if (leak[k][c]) { let m = 0; for (let f = Math.max(0, x.f - 3); f <= Math.min(frames - 1, x.f + 3); f++) m = Math.max(m, Hk(c, f)); e += leak[k][c] * m; }
      if (Hk(k, x.f) - x.mn - e < 0.12 * refs[k]) return false;
      // caisse claire moyenne pile sur une grosse caisse ET un charleston : clic + aigus, pas une caisse claire
      if (k === 1 && x.p < KICK_HAT_SNARE * refs[1] && [0, 2].every(c => kept[c].some(y => Math.abs(y.t - x.t) <= 0.025))) return false;
      return true;
    });
    return { kept, refs, leak, present, cand: peaks.map(ps => ps.length) };
  };
  let { kept, refs, leak, present, cand } = pass(true);
  // Seconde passe : gabarit du métal appris sur les coups de métal du morceau joués sans grosse caisse (médian des montées
  // d'énergie par bande). Un charleston enregistré a souvent beaucoup de médium que le gabarit de départ ne prévoit pas.
  {
    const own: number[][] = [];
    for (const y of kept[2]) {
      if (y.p < 0.5 * refs[2] || kept[0].some(x => Math.abs(x.t - y.t) <= 0.025)) continue;
      let lo = y.f; while (lo > 0 && y.f - lo < 14 && Hk(2, lo - 1) < Hk(2, lo)) lo--;
      own.push(bands.map((_, b) => Math.max(0, V[b * frames + y.f] - V[b * frames + lo])));
    }
    if (own.length >= 4) {
      for (let b = 0; b < B; b++) { if (!W0[b * K + 2]) continue; const v = own.map(r => r[b]).sort((p, q) => p - q); W[b * K + 2] = v[v.length >> 1] + 0.02; }
      normW();
      ({ kept, refs, leak, present, cand } = pass(false));
    }
  }
  const all = kept.flat().map(x => x.f).sort((a, b) => a - b);
  const nextAny = (f: number) => { for (const x of all) if (x > f + 1) return x; return frames; };
  // hauteur dominante des fûts graves, 60 à 120 ms après le coup (la grosse caisse est déjà descendue sous 100 Hz, un tom non)
  const lowB: number[] = []; for (let b = 0; b < B; b++) if (bands[b].fc > 35 && bands[b].fc < 700) lowB.push(b);
  const pitchAt = (f: number) => {
    const a = Math.min(frames - 1, f + Math.round(0.06 * fps)), e = Math.min(frames - 1, Math.max(a, Math.min(f + Math.round(0.12 * fps), nextAny(f) - 2)));
    const sum = lowB.map(b => { let s = 0; for (let t = a; t <= e; t++) s += Vraw[b * frames + t]; return s; });
    let m = 0; for (let i = 1; i < sum.length; i++) if (sum[i] > sum[m]) m = i;
    const lg = (i: number) => Math.log2(bands[lowB[i]].fc);
    let x = lg(m);
    if (m > 0 && m < sum.length - 1) { const l = sum[m - 1], c = sum[m], r = sum[m + 1], d = l - 2 * c + r; if (d < 0) x += 0.5 * (l - r) / d * (lg(m + 1) - lg(m)); }
    return Math.pow(2, x);
  };
  for (let k = 0; k < 3; k++) {
    const h = H.subarray(k * frames, (k + 1) * frames), ref = refs[k];
    for (const pk of kept[k]) {
      const hit: DrumHit = { t: Math.max(0, pk.t), cls: k === 0 ? 'kick' : k === 1 ? 'snare' : 'hat', vel: Math.min(1, pk.p / ref) };
      if (k === 0) {
        hit.pitch = pitchAt(pk.f);
        if (hit.pitch > KICK_MAX_HZ) {
          // un fût grave aigu en même temps qu'une caisse claire : c'est le corps de la caisse claire, pas un tom
          if (kept[1].some(x => Math.abs(x.t - pk.t) <= 0.03)) continue;
          hit.cls = 'tom';
        }
      }
      if (k === 2) {
        // coup de métal faible sur une caisse claire faible (ghost note) : ce sont les aigus de la caisse claire
        if (hit.vel < GHOST_HAT && kept[1].some(x => Math.abs(x.t - pk.t) <= 0.025 && x.p < 0.6 * refs[1])) continue;
        // extinction mesurée avant le coup suivant (de n'importe quel instrument), fenêtre comprise
        const dt = Math.max(2, Math.min(Math.round(0.1 * fps), nextAny(pk.f) - pk.f - Math.round(0.03 * fps)));
        const r = Math.max(1e-6, (h[Math.min(frames - 1, pk.f + dt)] - pk.mn) / Math.max(1e-9, h[pk.f] - pk.mn));
        hit.decay = Math.min(1000, -20 * Math.log10(r) / (dt / fps));
        // un coup de métal en même temps qu'une caisse claire : son extinction est celle de la caisse claire, on la tient pour fermée sauf si elle sonne longtemps
        if (kept[0].concat(kept[1]).some(x => Math.abs(x.t - pk.t) <= 0.025)) hit.shared = true;
      }
      hits.push(hit);
    }
  }
  // Toms : une attaque sans grosse caisse ni caisse claire, dont le fût sonne encore au-dessus de la grosse caisse
  // (un tom électronique pur n'a que du grave-médium, la composante « attaque » le prend souvent pour elle).
  for (const pk of kept[3]) {
    if (kept[0].concat(kept[1]).some(x => Math.abs(x.t - pk.t) <= 0.035) || hits.some(h => h.cls === 'tom' && Math.abs(h.t - pk.t) <= 0.045)) continue;
    const pitch = pitchAt(pk.f);
    if (pitch <= KICK_MAX_HZ || pk.p < 0.3 * refs[3]) continue;
    hits.push({ t: Math.max(0, pk.t), cls: 'tom', vel: Math.min(1, pk.p / refs[3]), pitch });
  }
  report?.(1);
  hits.sort((a, b) => a.t - b.t);
  const debug = { refs, present, cand, leak };
  return { hits, hop: HOP, sr, frames, debug };
}
