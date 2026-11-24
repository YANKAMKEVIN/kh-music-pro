/** V20 — notes par le modèle Basic Pitch : chargement du modèle (une fois), son ramené à 22 050 Hz mono, calcul dans un Worker. */
import type { FoundNote } from '../types';
import { BP_SR, BpFiles, BpOpts } from './core';

const base = () => new URL('models/', document.baseURI).href;
function bytes(url: string, type: XMLHttpRequestResponseType = 'arraybuffer'): Promise<any> {
  return new Promise((ok, ko) => {
    const x = new XMLHttpRequest(); x.open('GET', url); x.responseType = type; x.timeout = 120000;
    x.onload = () => (x.status === 200 || (x.status === 0 && x.response) ? ok(x.response) : ko(new Error('http ' + x.status)));
    x.onerror = x.ontimeout = () => ko(new Error('network')); x.send();
  });
}
let files: Promise<BpFiles> | null = null;
const modelFiles = () => files ??= (async () => {
  const b = base(), json = await bytes(b + 'basic-pitch/model.json', 'json') as { weightsManifest: { paths: string[] }[] };
  if (!json?.weightsManifest) throw new Error('model');
  const weights = await Promise.all(json.weightsManifest.flatMap(g => g.paths).map(p => bytes(b + 'basic-pitch/' + p)));
  const opt = (p: string) => bytes(b + 'tfjs/' + p).catch(() => null);
  return { json, weights, wasm: await opt('tfjs-backend-wasm.wasm'), wasmSimd: await opt('tfjs-backend-wasm-simd.wasm') };
})().catch(e => { files = null; throw e; });

async function toMono22k(b: AudioBuffer): Promise<Float32Array> {
  const off = new OfflineAudioContext(1, Math.max(1, Math.ceil(b.duration * BP_SR)), BP_SR);
  const src = off.createBufferSource(); src.buffer = b; src.connect(off.destination); src.start();
  return (await off.startRendering()).getChannelData(0).slice();
}

/** Dernier calcul (QA) : moteur utilisé, durée. `off` (QA) : faire comme si le modèle manquait. */
export const bpLast = { backend: '', ms: 0, off: false };

/** Notes d'un son par le modèle. Rejette si le modèle ou le Worker manquent : l'appelant se replie alors sur son propre calcul. */
export async function bpTranscribe(buf: AudioBuffer, opts: BpOpts, progress: (f: number) => void, signal: AbortSignal): Promise<FoundNote[]> {
  if (bpLast.off) throw new Error('model off');
  const t0 = performance.now(), [f, x] = await Promise.all([modelFiles(), toMono22k(buf)]);
  if (signal.aborted) throw new DOMException('aborted', 'AbortError');
  progress(0.05);
  return new Promise((ok, ko) => {
    const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    const end = () => { signal.removeEventListener('abort', abort); w.terminate(); };
    const abort = () => { end(); ko(new DOMException('aborted', 'AbortError')); };
    signal.addEventListener('abort', abort);
    w.onerror = e => { end(); ko(new Error(String(e.message || 'worker'))); };
    w.onmessage = e => {
      const m = e.data;
      if (m.type === 'progress') progress(0.05 + 0.95 * m.f);
      else if (m.type === 'done') { end(); bpLast.backend = m.backend; bpLast.ms = Math.round(performance.now() - t0); ok(m.notes); }
      else if (m.type === 'error') { end(); ko(new Error(m.msg)); }
    };
    w.postMessage({ type: 'run', x, files: f, opts }, [x.buffer]);
  });
}
