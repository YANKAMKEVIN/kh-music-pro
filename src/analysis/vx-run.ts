/** V20 — lance un calcul du chant, du tempo ou de la tonalité dans un Worker (annulable, avec avancement).
 *  Si le navigateur refuse le Worker, le calcul tourne dans la page (plus lent à rendre la main, même résultat). */
import { runJob, type VxJob } from './vx-dsp';
import VxWorker from './vx.worker?worker&inline';

/** Son mono (moyenne des canaux). */
export function mono(b: AudioBuffer): Float32Array {
  const x = new Float32Array(b.length);
  for (let c = 0; c < b.numberOfChannels; c++) { const d = b.getChannelData(c); for (let i = 0; i < x.length; i++) x[i] += d[i] / b.numberOfChannels; }
  return x;
}

export function vxRun<T>(job: VxJob, b: AudioBuffer, progress: (f: number) => void, signal: AbortSignal): Promise<T> {
  const x = mono(b), sr = b.sampleRate;
  return new Promise<T>((ok, ko) => {
    const abort = () => ko(new DOMException('annulé', 'AbortError'));
    if (signal.aborted) return abort();
    let w: Worker;
    try { w = new VxWorker(); }
    catch { setTimeout(() => { if (signal.aborted) return abort(); try { ok(runJob(job, x, sr, progress) as T); } catch (e) { ko(e); } }); return; }
    const end = () => { w.terminate(); signal.removeEventListener('abort', onAbort); };
    const onAbort = () => { end(); abort(); };
    signal.addEventListener('abort', onAbort);
    w.onmessage = (e: MessageEvent<{ p?: number; res?: T; err?: string }>) => {
      const m = e.data;
      if (m.p !== undefined) progress(m.p);
      else if (m.err !== undefined) { end(); ko(new Error(m.err)); }
      else { end(); ok(m.res as T); }
    };
    w.onerror = e => { e.preventDefault(); end(); ko(new Error(e.message || 'Worker')); };
    w.postMessage({ job, x, sr }, [x.buffer]);
  });
}
