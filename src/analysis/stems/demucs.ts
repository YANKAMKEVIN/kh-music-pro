/** V20 — Séparation par HTDemucs à six pistes (Meta, licence MIT) : découpage du son et recollage des pistes autour du modèle.
 *
 *  Le modèle (ONNX, `public/models/htdemucs6/`, cœur de `htdemucs_6s`) reçoit un segment stéréo de 7,8 s à 44,1 kHz et rend,
 *  pour six pistes (batterie, basse, autres, voix, guitare, piano), une branche « fréquences » (spectre) et une branche
 *  « temps » (forme d'onde) qu'on additionne. Il calcule lui-même le spectre du segment ; la transformée inverse est
 *  faite ici (`ispec`, d'après `_ispec` de demucs), car celle du modèle d'origine ne tient pas dans la mémoire du navigateur.
 *  Comme dans demucs, le son est d'abord ramené à une moyenne nulle et un écart-type de 1 (sur tout le morceau), puis
 *  remis à son niveau. Code pur, sans DOM : l'inférence est fournie par l'appelant (`Infer`). */
import { fft, STEMS6 } from './separate';
import type { SepOut } from './separate';

export const DM = { SR: 44100, N: 4096, HOP: 1024, SEG: 343980, BINS: 2048, FRAMES: 336, OVERLAP: 0.25 } as const;
/** Ordre des pistes rendu par le modèle. */
export const DM_ORDER = ['drums', 'bass', 'other', 'vocals', 'guitar', 'piano'] as const;

/** Inférence : `mix` [2 × SEG] → `freq` [6 pistes × 4 × BINS × FRAMES], `time` [6 pistes × 2 × SEG]. */
export type Infer = (mix: Float32Array) => Promise<{ freq: Float32Array; time: Float32Array }>;

const hann = (() => { const w = new Float32Array(DM.N); for (let i = 0; i < DM.N; i++) w[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / DM.N)); return w; })();
const PAD = (DM.HOP >> 1) * 3;

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

/** Sépare un son stéréo à 44,1 kHz, segment par segment (recouvrement de 25 %, fondus). */
export async function demucsSeparate(l: Float32Array, r: Float32Array, infer: Infer, progress?: (f: number) => void, cancelled?: () => boolean): Promise<Required<SepOut>> {
  const n = l.length, stride = Math.floor(DM.SEG * (1 - DM.OVERLAP)), fade = stride >> 1;
  // niveau de référence : moyenne et écart-type du mélange mono
  let mean = 0; for (let i = 0; i < n; i++) mean += (l[i] + r[i]) / 2; mean /= n || 1;
  let dev = 0; for (let i = 0; i < n; i++) { const v = (l[i] + r[i]) / 2 - mean; dev += v * v; } dev = Math.sqrt(dev / (n || 1)) || 1;
  const out = Object.fromEntries(STEMS6.map(s => [s, [new Float32Array(n), new Float32Array(n)]])) as Required<SepOut>;
  const wsum = new Float32Array(n);
  const starts: number[] = []; for (let s = 0; ; s += stride) { starts.push(s); if (s + DM.SEG >= n) break; }
  for (let j = 0; j < starts.length; j++) {
    if (cancelled?.()) throw new DOMException('annulé', 'AbortError');
    const a = starts[j], m = Math.min(DM.SEG, n - a), first = j === 0, last = j === starts.length - 1;
    const mix = new Float32Array(2 * DM.SEG);
    for (let i = 0; i < m; i++) { mix[i] = (l[a + i] - mean) / dev; mix[DM.SEG + i] = (r[a + i] - mean) / dev; }
    const { freq, time } = await infer(mix), tmp = new Float32Array(DM.SEG);
    for (let i = 0; i < m; i++) wsum[a + i] += Math.max(1e-3, Math.min(first ? 1 : (i + 1) / fade, last ? 1 : (m - i) / fade, 1));
    for (let t = 0; t < DM_ORDER.length; t++) {
      const dst = out[DM_ORDER[t]];
      for (let c = 0; c < 2; c++) {
        ispec(freq, t, c, tmp);
        const tb = (t * 2 + c) * DM.SEG, d = dst[c];
        for (let i = 0; i < m; i++) {
          const w = Math.max(1e-3, Math.min(first ? 1 : (i + 1) / fade, last ? 1 : (m - i) / fade, 1));
          d[a + i] += ((tmp[i] + time[tb + i]) * dev + mean) * w;
        }
      }
    }
    progress?.((j + 1) / starts.length);
  }
  for (const s of STEMS6) for (const d of out[s]) for (let i = 0; i < n; i++) d[i] /= wsum[i] || 1;
  return out;
}
