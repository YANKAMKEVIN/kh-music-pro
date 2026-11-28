// Formes d'onde des clips audio (crêtes en cache), fondus et aperçu des clips.
import { buffers, S } from '../../store';
import { Clip, srcStep, Track } from '../../types';

// ---------- Formes d'onde ----------
const BLK = 256, peakCache = new Map<string, Float32Array>();
function peaks(id: string) {
  let p = peakCache.get(id);
  if (p) return p;
  const b = buffers.get(id);
  if (!b) return null;
  const a = b.getChannelData(0), c = b.numberOfChannels > 1 ? b.getChannelData(1) : a;
  p = new Float32Array(Math.ceil(b.length / BLK));
  for (let i = 0; i < b.length; i++) { const v = Math.max(Math.abs(a[i]), Math.abs(c[i])), k = (i / BLK) | 0; if (v > p[k]) p[k] = v; }
  peakCache.set(id, p);
  return p;
}
export function drawWave(g: CanvasRenderingContext2D, id: string, from: number, to: number, w: number, hgt: number) {
  const p = peaks(id), b = buffers.get(id);
  if (!p || !b) return;
  const perSec = b.sampleRate / BLK, mid = hgt / 2;
  for (let x = 0; x < w; x++) {
    const i0 = Math.floor((from + (to - from) * x / w) * perSec), i1 = Math.max(i0 + 1, Math.floor((from + (to - from) * (x + 1) / w) * perSec));
    let m = 0;
    for (let i = i0; i < i1 && i < p.length; i++) if (p[i] > m) m = p[i];
    const y = Math.max(0.5, m * mid * 0.95);
    g.fillRect(x, mid - y, 1, y * 2);
  }
}
export function drawPreview(cv: HTMLCanvasElement, tr: Track, c: Clip, wCss: number, hgt: number) {
  const w = Math.min(Math.max(1, Math.round(wCss)), 6000);
  cv.width = w; cv.height = hgt;
  const g = cv.getContext('2d')!;
  g.fillStyle = 'rgba(4,8,20,.72)';
  const sw = w / c.len;
  if (tr.type === 'drums') {
    const rh = hgt / c.drums!.length;
    for (let s = 0; s < c.len; s++) {
      const l = (s + c.offset) % c.patLen!;
      const res = c.res ?? 1, i0 = Math.ceil(l * res - 1e-6), i1 = Math.ceil((l + 1) * res - 1e-6);
      c.drums!.forEach((row, r) => { for (let i = i0; i < i1 && i < row.length; i++) if (row[i]) g.fillRect((s + i / res - l) * sw + 0.5, r * rh, Math.max(1.5, sw / res - 1), Math.max(2, rh - 0.5)); });
    }
  } else if (tr.type === 'synth') {
    const ns = c.notes!;
    if (!ns.length) return;
    let lo = Infinity, hi = -Infinity;
    for (const n of ns) { lo = Math.min(lo, n.p); hi = Math.max(hi, n.p); }
    const span = Math.max(12, hi - lo + 1), nh = Math.max(2, hgt / span - 1);
    for (let k = -1; k * c.patLen! < c.len + c.offset; k++) for (const n of ns) {
      const x = n.s - c.offset + k * c.patLen!;
      if (x + n.l <= 0 || x >= c.len) continue;
      g.fillRect(x * sw, (hi - n.p + (span - (hi - lo + 1)) / 2) * (hgt / span), Math.max(2, n.l * sw - 1), nh);
    }
  } else if (c.bufferId) {
    drawAudio(g, c, w, hgt);
    drawFades(g, c, w, hgt);
  }
}
/** Forme d'onde d'un clip audio ; avec un comping, chaque portion est lue dans sa prise, séparée par un trait. */
export function drawAudio(g: CanvasRenderingContext2D, c: Clip, w: number, hgt: number) {
  const st = srcStep(S.project, c);
  if (!c.comp?.length || !c.takes) { drawWave(g, c.bufferId!, c.offset, c.offset + c.len * st, w, hgt); return; }
  const sw = w / c.len;
  c.comp.forEach((seg, i) => {
    const a = seg.s, b = i + 1 < c.comp!.length ? c.comp![i + 1].s : c.len, x0 = Math.round(a * sw), x1 = Math.round(b * sw), o = (c.takes![seg.take] ?? c.offset) + a * st;
    g.save(); g.translate(x0, 0); drawWave(g, c.bufferId!, o, o + (b - a) * st, Math.max(1, x1 - x0), hgt); g.restore();
    if (i) { g.save(); g.fillStyle = 'rgba(255,255,255,.7)'; g.fillRect(x0, 0, 1, hgt); g.restore(); }
  });
}
/** Dessine les fondus d'un clip audio sous forme de coins clairs. */
export function drawFades(g: CanvasRenderingContext2D, c: Clip, w: number, hgt: number) {
  const sw = w / c.len, tri = (x0: number, x1: number) => { g.beginPath(); g.moveTo(x0, 0); g.lineTo(x1, 0); g.lineTo(x0, hgt); g.closePath(); g.fill(); };
  g.save(); g.fillStyle = 'rgba(255,255,255,.5)';
  if (c.fadeIn) tri(0, c.fadeIn * sw);
  if (c.fadeOut) tri(w, w - c.fadeOut * sw);
  // Fondu enchaîné avec le clip précédent : un X sur la zone où les deux sons se mêlent.
  if (c.xfade) { const x = Math.min(w, c.xfade * sw); g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(0, 0); g.lineTo(x, hgt); g.moveTo(0, hgt); g.lineTo(x, 0); g.stroke(); }
  g.restore();
}
