/** V20 — Worker des familles d'instruments : le calcul de YAMNet hors du fil principal. */
import { Inputs, ModelFiles, runYamnet } from './core';

let stopped = false;
self.onmessage = async (e: MessageEvent<{ type: 'run'; inp: Inputs; files: ModelFiles } | { type: 'stop' }>) => {
  const m = e.data;
  if (m.type === 'stop') { stopped = true; return; }
  stopped = false;
  try {
    const r = await runYamnet(m.inp, m.files, f => postMessage({ type: 'progress', f }), () => stopped);
    postMessage({ type: 'done', r }, { transfer: [r.scores.buffer, r.rms.buffer, r.flux.buffer] });
  } catch (err) { postMessage({ type: 'error', msg: String((err as Error)?.message || err) }); }
};
postMessage({ type: 'ready' });
