/** Comping (V19) : portions d'un clip à prises multiples, chacune lue dans sa prise. */
import type { Clip, CompSeg } from '../types';

/** Joint entre deux portions d'un comping : fondu enchaîné très court (secondes), pour qu'aucun clic ne s'entende. */
export const COMP_XFADE = 0.012;
/** Remet un comping en ordre : portions triées, fusionnées quand elles se suivent dans la même prise ; une seule prise = plus de comping. */
export function normComp(c: Clip) {
  if (!c.comp || !c.takes?.length) { delete c.comp; return; }
  const list = c.comp.filter(x => x.s < c.len - 1e-9 && x.take >= 0 && x.take < c.takes!.length).sort((a, b) => a.s - b.s);
  const out: CompSeg[] = [];
  for (const x of list) { if (out.length && Math.abs(out[out.length - 1].s - x.s) < 1e-9) out.pop(); if (!out.length || out[out.length - 1].take !== x.take) out.push({ s: x.s, take: x.take }); }
  if (out.length) out[0].s = 0;
  if (out.length <= 1) { if (out.length) { c.take = out[0].take; c.offset = c.takes[c.take]; } delete c.comp; return; }
  c.comp = out; c.take = out[0].take; c.offset = c.takes[c.take];
}
/** Prise jouée à la position `x` (pas depuis le début du clip). */
export const takeAt = (c: Clip, x: number) => { let k = c.take ?? 0; for (const seg of c.comp ?? []) { if (seg.s <= x + 1e-9) k = seg.take; else break; } return k; };
/** Choisit la prise `take` pour la portion [a, b[ du clip (comping). */
export function compSet(c: Clip, a: number, b: number, take: number) {
  if (!c.takes || b <= a) return;
  const base = c.comp ?? [{ s: 0, take: c.take ?? 0 }], after = takeAt(c, b);
  c.comp = [...base.filter(x => x.s < a - 1e-9 || x.s > b + 1e-9), { s: Math.max(0, a), take }, ...(b < c.len - 1e-9 ? [{ s: b, take: after }] : [])];
  normComp(c);
}
/** Ne garde du comping que la partie [a, b[ du clip, ramenée au début (clip coupé ou rogné). */
export function compSlice(c: Clip, a: number, b: number) {
  if (!c.comp) return;
  const k0 = takeAt(c, a);
  c.comp = [{ s: 0, take: k0 }, ...c.comp.filter(x => x.s > a + 1e-9 && x.s < b - 1e-9).map(x => ({ s: x.s - a, take: x.take }))];
  normComp(c);
}
