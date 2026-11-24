/** V20 — HTDemucs dans un Worker : charge le modèle (cache ou site), ouvre une session ONNX Runtime (WebGPU si possible,
 *  sinon WebAssembly), sépare segment par segment. La session reste ouverte entre deux séparations.
 *  Messages reçus : { l, r, base, ep: 'auto' | 'wasm', maxSec }.
 *  Messages envoyés : { phase: 'download', got, total, cached } · { phase: 'load' } · { phase: 'run', f, ep }
 *  · { out, ep, sec } · { error, code } (code : offline, corrupt, slow, model). */
import * as ort from 'onnxruntime-web/webgpu';
// Moteur WebAssembly d'ONNX Runtime : servi par le site lui-même (Vite le copie dans la version construite).
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url';
import { STEMS6 } from './separate';
import { DM, demucsSeparate } from './demucs';
import { ModelError, loadModel } from './model';

const me = self as unknown as { onmessage: (e: MessageEvent) => void; postMessage(m: unknown, transfer?: Transferable[]): void };
let session: ort.InferenceSession | null = null, sessionEp = '';

class Slow extends Error { constructor(public est: number) { super('slow'); } }

/** Vraie carte graphique ? Une carte émulée par logiciel (« fallback », SwiftShader) est bien plus lente que le processeur. */
async function realGpu() {
  type Ad = { isFallbackAdapter?: boolean; info?: { isFallbackAdapter?: boolean; architecture?: string } };
  const g = (navigator as unknown as { gpu?: { requestAdapter(o?: object): Promise<Ad | null> } }).gpu;
  if (!g) return false;
  const a = await g.requestAdapter({ powerPreference: 'high-performance' }).catch(() => null);
  return !!a && !(a.info?.isFallbackAdapter ?? a.isFallbackAdapter) && a.info?.architecture !== 'swiftshader';
}

async function open(base: string, want: string) {
  if (session && (want === 'auto' || sessionEp === want)) return;
  ort.env.wasm.wasmPaths = { wasm: new URL(wasmUrl, self.location.href).href };
  ort.env.logLevel = 'error';
  const bytes = await loadModel(base, (got, total, cached) => me.postMessage({ phase: 'download', got, total, cached }));
  me.postMessage({ phase: 'load' });
  const gpu = want === 'auto' && await realGpu();
  if (gpu) {
    try { session = await ort.InferenceSession.create(bytes, { executionProviders: ['webgpu'], graphOptimizationLevel: 'all' }); sessionEp = 'webgpu'; return; }
    catch { /* carte graphique refusée : on passe au processeur */ }
  }
  session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all'}); sessionEp = 'wasm';
}

me.onmessage = async (e: MessageEvent<{ l: Float32Array; r: Float32Array; base: string; ep: string; maxSec: number }>) => {
  const { l, r, base, ep, maxSec } = e.data;
  try {
    await open(base, ep);
    const s = session!, t0 = performance.now();
    const segs = Math.max(1, Math.ceil(Math.max(0, l.length - DM.SEG) / Math.floor(DM.SEG * (1 - DM.OVERLAP))) + 1);
    let seen = 0;
    const out = await demucsSeparate(l, r, async mix => {
      const res = await s.run({ mix: new ort.Tensor('float32', mix, [1, 2, DM.SEG]) });
      const freq = await res.freq.getData() as Float32Array, time = await res.time.getData() as Float32Array;
      res.freq.dispose(); res.time.dispose();
      // Trop lent pour cet appareil : on s'arrête après le premier segment (estimation sur le nombre de segments)
      if (++seen === 1 && segs > 1) { const est = (performance.now() - t0) / 1000 * segs; if (est > maxSec) throw new Slow(est); }
      return { freq, time };
    }, f => me.postMessage({ phase: 'run', f, ep: sessionEp }));
    me.postMessage({ out, ep: sessionEp, sec: (performance.now() - t0) / 1000 }, STEMS6.flatMap(k => out[k].map(a => a.buffer as ArrayBuffer)));
  } catch (err) {
    if (err instanceof Slow) me.postMessage({ error: 'slow', code: 'slow', est: err.est, ep: sessionEp });
    else if (err instanceof ModelError) me.postMessage({ error: err.message, code: err.code });
    else { session = null; me.postMessage({ error: String((err as Error)?.message || err), code: 'model' }); }
  }
};
