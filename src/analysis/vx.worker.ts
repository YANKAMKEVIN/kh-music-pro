/** V20 — Worker du chant, du tempo et de la tonalité : le calcul tourne hors du fil de la page. */
import { runJob, type VxJob } from './vx-dsp';

self.onmessage = (e: MessageEvent<{ job: VxJob; x: Float32Array; sr: number }>) => {
  const { job, x, sr } = e.data;
  try { const res = runJob(job, x, sr, p => self.postMessage({ p })); self.postMessage({ res }); }
  catch (err) { self.postMessage({ err: String((err as Error)?.message || err) }); }
};
