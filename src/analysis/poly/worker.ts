/** V20 — basse et piano → notes : le calcul tourne ici, hors du fil de l'interface. */
import { transcribeBass, transcribePiano, type PolyParams } from './core';

export interface PolyJob { kind: 'bass' | 'piano'; hi: Float32Array | null; lo: Float32Array; params: PolyParams; keepFrom?: number }

/** le Worker vu depuis l'intérieur (sans charger les types « webworker », qui gêneraient ceux de la page) */
const me = self as unknown as { postMessage(m: unknown): void; onmessage: ((e: MessageEvent<PolyJob>) => void) | null };

me.onmessage = (e: MessageEvent<PolyJob>) => {
  const j = e.data;
  let last = 0;
  const progress = (f: number) => { const now = Date.now(); if (now - last > 80) { last = now; me.postMessage({ progress: f }); } };
  try {
    const notes = j.kind === 'bass' ? transcribeBass(j.lo, j.params, progress) : transcribePiano(j.hi!, j.lo, j.params, progress, j.keepFrom);
    me.postMessage({ notes });
  } catch (err) { me.postMessage({ error: String((err as Error)?.message || err) }); }
};
