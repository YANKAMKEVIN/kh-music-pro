/** V20 — Worker de Basic Pitch : le réseau tourne hors du fil de la page. */
import { BpFiles, BpOpts, bpBackend, bpMaps, bpNotes } from './core';

let stopped = false;
self.onmessage = async (e: MessageEvent<{ type: 'run'; x: Float32Array; files: BpFiles; opts: BpOpts } | { type: 'stop' }>) => {
  const m = e.data;
  if (m.type === 'stop') { stopped = true; return; }
  stopped = false;
  try {
    const maps = await bpMaps(m.x, m.files, f => postMessage({ type: 'progress', f }), () => stopped);
    postMessage({ type: 'done', notes: bpNotes(maps, m.opts), backend: bpBackend() });
  } catch (err) { postMessage({ type: 'error', msg: String((err as Error)?.message || err) }); }
};
