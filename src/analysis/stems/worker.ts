/** V20 — Séparation des pistes hors du fil principal. Reçoit { ch, sr }, renvoie { progress } puis { out } (tableaux transférés). */
import { STEMS, separate } from './separate';

// Pas de `/// <reference lib="webworker" />` : il changerait les types de tout le projet.
const me = self as unknown as { onmessage: (e: MessageEvent) => void; postMessage(m: unknown, transfer?: Transferable[]): void };

me.onmessage = async (e: MessageEvent<{ ch: Float32Array[]; sr: number; chunkSec?: number }>) => {
  try {
    const { ch, sr, chunkSec } = e.data;
    const out = await separate(ch, sr, { chunkSec }, f => me.postMessage({ progress: f }));
    me.postMessage({ out }, STEMS.flatMap(s => out[s].map(a => a.buffer as ArrayBuffer)));
  } catch (err) { me.postMessage({ error: String((err as Error)?.message || err) }); }
};
