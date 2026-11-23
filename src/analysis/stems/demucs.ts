/** V20 — Séparation par HTDemucs (Meta, licence MIT) : préparation du son et reconstruction des pistes autour du modèle.
 *
 *  Le modèle (ONNX, `public/models/htdemucs/`) reçoit un segment stéréo de 7,8 s à 44,1 kHz et son spectre, et rend pour
 *  chaque piste une branche « fréquences » (spectre) et une branche « temps » (forme d'onde) qu'on additionne.
 *  Transformées d'après le pré- et post-traitement de demucs (dépôt facebookresearch/demucs) tel que repris par
 *  timcsy/demucs-web (MIT). Code pur, sans DOM : l'inférence est fournie par l'appelant (`Infer`). */
import { fft, STEMS } from './separate';
import type { SepOut } from './separate';

export const DM = { SR: 44100, N: 4096, HOP: 1024, SEG: 343980, BINS: 2048, FRAMES: 336, OVERLAP: 0.25 } as const;
/** Ordre des pistes rendu par le modèle. */
export const DM_ORDER = ['drums', 'bass', 'other', 'vocals'] as const;

/** Inférence : `mix` [2 × SEG], `mag` [4 × BINS × FRAMES] → `freq` [4 pistes × 4 × BINS × FRAMES], `time` [4 pistes × 2 × SEG]. */
export type Infer = (mix: Float32Array, mag: Float32Array) => Promise<{ freq: Float32Array; time: Float32Array }>;

const hann = (() => { const w = new Float32Array(DM.N); for (let i = 0; i < DM.N; i++) w[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / DM.N)); return w; })();

/** Remplissage miroir (comme `F.pad(..., mode='reflect')`). */
function reflect(x: Float32Array, l: number, r: number) {
  const n = x.length, o = new Float32Array(l + n + r);
  for (let i = 0; i < l; i++) o[i] = x[Math.min(l - i, n - 1)];
  o.set(x, l);
  for (let i = 0; i < r; i++) o[l + n + i] = x[Math.max(0, n - 2 - i)];
  return o;
}

const PAD = (DM.HOP >> 1) * 3, LE = Math.ceil(DM.SEG / DM.HOP);

/** Spectre d'un canal comme le calcule demucs (`_spec`) : rangé [case × trame] dans `re`/`im` à partir de `off`. */
function spec(x: Float32Array, re: Float32Array, im: Float32Array, off: number) {
  const p = reflect(reflect(x, PAD, PAD + LE * DM.HOP - DM.SEG), DM.N / 2, DM.N / 2);
  const fr = new Float32Array(DM.N), fi = new Float32Array(DM.N), sc = 1 / Math.sqrt(DM.N);
  for (let f = 0; f < DM.FRAMES; f++) {
    const s0 = (f + 2) * DM.HOP;
    for (let i = 0; i < DM.N; i++) { fr[i] = p[s0 + i] * hann[i]; fi[i] = 0; }
    fft(fr, fi);
    for (let b = 0; b < DM.BINS; b++) { re[off + b * DM.FRAMES + f] = fr[b] * sc; im[off + b * DM.FRAMES + f] = fi[b] * sc; }
  }
}

/** Entrées du modèle pour un segment stéréo de longueur SEG. */
export function prepare(l: Float32Array, r: Float32Array) {
  const mix = new Float32Array(2 * DM.SEG); mix.set(l, 0); mix.set(r, DM.SEG);
  const S = DM.BINS * DM.FRAMES, mag = new Float32Array(4 * S);
  // [L.re, L.im, R.re, R.im] ; on écrit re et im dans deux vues du même tableau
  spec(l, mag.subarray(0, S), mag.subarray(S, 2 * S), 0);
  spec(r, mag.subarray(2 * S, 3 * S), mag.subarray(3 * S, 4 * S), 0);
  return { mix, mag };
}

/** Spectre de la branche « fréquences » (piste t, canal c) → forme d'onde de longueur SEG (`_ispec`). */
function ispec(freq: Float32Array, t: number, c: number, out: Float32Array) {
  const S = DM.BINS * DM.FRAMES, base = (t * 4 + 2 * c) * S, frames = DM.FRAMES + 4, len = (frames - 1) * DM.HOP + DM.N;
  const acc = new Float32Array(len), wsum = new Float32Array(len), re = new Float32Array(DM.N), im = new Float32Array(DM.N), sc = Math.sqrt(DM.N);
  for (let g = 0; g < frames; g++) {
    const f = g - 2;
    re.fill(0); im.fill(0);
    if (f >= 0 && f < DM.FRAMES) {
      for (let b = 0; b < DM.BINS; b++) { re[b] = freq[base + b * DM.FRAMES + f]; im[b] = freq[base + S + b * DM.FRAMES + f]; }
      for (let b = 1; b < DM.BINS; b++) { re[DM.N - b] = re[b]; im[DM.N - b] = -im[b]; }   // case de Nyquist (2048) nulle
      fft(re, im, true);
    }
    const s0 = g * DM.HOP;
    for (let i = 0; i < DM.N; i++) { acc[s0 + i] += re[i] / DM.N * hann[i] * sc; wsum[s0 + i] += hann[i] * hann[i]; }
  }
  const o0 = DM.N / 2 + PAD;
  for (let i = 0; i < DM.SEG; i++) { const w = wsum[o0 + i]; out[i] = w > 1e-8 ? acc[o0 + i] / w : 0; }
}

/** Sépare un son stéréo à 44,1 kHz, segment par segment (recouvrement de 25 %, fondus). Rend les pistes dans l'ordre de `STEMS`. */
export async function demucsSeparate(l: Float32Array, r: Float32Array, infer: Infer, progress?: (f: number) => void, cancelled?: () => boolean): Promise<SepOut> {
  const n = l.length, stride = Math.floor(DM.SEG * (1 - DM.OVERLAP)), fade = stride >> 1;
  const out = Object.fromEntries(STEMS.map(s => [s, [new Float32Array(n), new Float32Array(n)]])) as SepOut;
  const wsum = new Float32Array(n);
  const starts: number[] = []; for (let s = 0; ; s += stride) { starts.push(s); if (s + DM.SEG >= n) break; }
  const tmp = new Float32Array(DM.SEG);
  for (let j = 0; j < starts.length; j++) {
    if (cancelled?.()) throw new DOMException('annulé', 'AbortError');
    const a = starts[j], m = Math.min(DM.SEG, n - a), first = j === 0, last = j === starts.length - 1;
    const sl = new Float32Array(DM.SEG), sr = new Float32Array(DM.SEG);
    sl.set(l.subarray(a, a + m)); sr.set(r.subarray(a, a + m));
    const { mix, mag } = prepare(sl, sr);
    const { freq, time } = await infer(mix, mag);
    for (let t = 0; t < 4; t++) {
      const dst = out[DM_ORDER[t]];
      for (let c = 0; c < 2; c++) {
        ispec(freq, t, c, tmp);
        const tb = (t * 2 + c) * DM.SEG, d = dst[c];
        for (let i = 0; i < m; i++) {
          const w = Math.max(1e-3, Math.min(first ? 1 : (i + 1) / fade, last ? 1 : (m - i) / fade, 1));
          d[a + i] += (tmp[i] + time[tb + i]) * w;
          if (t === 0 && c === 0) wsum[a + i] += w;
        }
      }
    }
    progress?.((j + 1) / starts.length);
  }
  for (const s of STEMS) for (const d of out[s]) for (let i = 0; i < n; i++) d[i] /= wsum[i] || 1;
  return out;
}
