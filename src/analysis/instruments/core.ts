/** V20 — Familles d'instruments : YAMNet sur tout le morceau, fenêtre par fenêtre.
 *  Tourne dans un Worker (worker.ts) ou, à défaut, sur le fil principal. */
import * as tf from '@tensorflow/tfjs-core';
import '@tensorflow/tfjs-backend-cpu';
import { setWasmPaths } from '@tensorflow/tfjs-backend-wasm';
import { GraphModel, loadGraphModel } from '@tensorflow/tfjs-converter';
import { FAMILIES, FrameData, USED, envelopeFlux } from './families';
import { harmonic, highpass, level, lowpass } from './dsp';

/** Fichiers du modèle, déjà lus par la page (fonctionne aussi depuis file:// dans la version bureau). */
export interface ModelFiles { json: unknown; weights: ArrayBuffer[]; wasm: ArrayBuffer | null; wasmSimd: ArrayBuffer | null }

export const SR = 16000, WIN = 15360, HOP = 7680;
/** fenêtres calculées par appel du modèle (≈ 10 s de son) */
const CHUNK = 20;

let model: GraphModel | null = null, backend = '';

async function setup(files: ModelFiles) {
  if (model) return;
  // Moteur WebAssembly si possible (bien plus rapide), sinon JavaScript pur.
  if (files.wasm && typeof WebAssembly === 'object') {
    try {
      tf.env().set('WASM_HAS_MULTITHREAD_SUPPORT', false);
      const url = (b: ArrayBuffer | null) => b ? URL.createObjectURL(new Blob([b], { type: 'application/wasm' })) : '';
      const plain = url(files.wasm);
      setWasmPaths({ 'tfjs-backend-wasm.wasm': plain, 'tfjs-backend-wasm-simd.wasm': url(files.wasmSimd) || plain, 'tfjs-backend-wasm-threaded-simd.wasm': plain });
      if (!(await tf.setBackend('wasm'))) throw new Error('wasm');
    } catch { await tf.setBackend('cpu'); }
  } else await tf.setBackend('cpu');
  await tf.ready();
  const j = files.json as { modelTopology: object; weightsManifest: { weights: tf.io.WeightsManifestEntry[] }[]; format?: string; generatedBy?: string; convertedBy?: string };
  const total = files.weights.reduce((a, b) => a + b.byteLength, 0), all = new Uint8Array(total);
  let o = 0; for (const b of files.weights) { all.set(new Uint8Array(b), o); o += b.byteLength; }
  const handler = tf.io.fromMemory({ modelTopology: j.modelTopology, weightSpecs: j.weightsManifest.flatMap(g => g.weights), weightData: all.buffer, format: j.format, generatedBy: j.generatedBy, convertedBy: j.convertedBy });
  const load = async () => { model = await loadGraphModel(handler); tf.tidy(() => { model!.execute(tf.zeros([WIN])); }); };
  try { await load(); }
  catch (e) { if (tf.getBackend() === 'cpu') throw e; model = null; await tf.setBackend('cpu'); await load(); }  // opération absente du moteur wasm : repli
  backend = tf.getBackend();
}

export type StemName = 'vocals' | 'drums' | 'bass' | 'other';
/** Sons à classer, mono à 16 kHz : le morceau entier et, si l'analyse « pistes séparées » les a produites, ses pistes. */
export interface Inputs { full: Float32Array; stems?: Partial<Record<StemName, Float32Array>>; opts?: Partial<typeof SPLIT> }
/** Bandes de la séparation légère (Hz), mesurées sur les sons de l'appli : instruments au-dessus de `tonalLo` (et sous `tonalHi`, 0 = sans limite), basse sous `bassHi`. */
export const SPLIT = { tonalLo: 120, tonalHi: 0, bassHi: 300 };
interface Pass { name: string; wave: Float32Array; fams: string[] | null }

const ALL_BUT = (...no: string[]) => FAMILIES.map(f => f.id).filter(id => !no.includes(id));

/** Classe un son fenêtre par fenêtre : n × USED.length probabilités, plus la moyenne des 521 classes. */
async function classify(wave: Float32Array, n: number, progress: (f: number) => void, stop: () => boolean) {
  const W = USED.length, scores = new Float32Array(n * W), mean = new Float32Array(521);
  for (let f0 = 0; f0 < n; f0 += CHUNK) {
    if (stop()) throw new Error('stopped');
    const m = Math.min(CHUNK, n - f0), s = f0 * HOP, len = (m - 1) * HOP + WIN;
    const part = new Float32Array(len); part.set(wave.subarray(s, Math.min(wave.length, s + len)));
    const [out, sum] = tf.tidy(() => { const raw = model!.execute(tf.tensor1d(part), 'Identity:0') as tf.Tensor2D, all = tf.slice(raw, [0, 0], [Math.min(m, raw.shape[0]), -1]); return [tf.gather(all, USED, 1), tf.sum(all, 0)]; });
    const v = await out.data(), rows = out.shape[0], sv = await sum.data(); out.dispose(); sum.dispose();
    for (let c = 0; c < 521; c++) mean[c] += sv[c] / n;
    for (let r = 0; r < Math.min(m, rows); r++) scores.set(v.subarray(r * W, (r + 1) * W), (f0 + r) * W);
    progress(Math.min(1, (f0 + m) / n));
    await new Promise(r => setTimeout(r, 0));   // laisse passer l'annulation
  }
  return { scores, mean };
}

/** Analyse complète. `progress` 0..1 ; `stop()` vrai = arrêter. */
export async function runYamnet(inp: Inputs, files: ModelFiles, progress: (f: number) => void, stop: () => boolean): Promise<FrameData & { backend: string; means: Record<string, Float32Array> }> {
  progress(0.01);
  await setup(files);
  progress(0.05);
  const full = inp.full, st = inp.stems || {};
  const n = Math.max(1, Math.floor((full.length - WIN) / HOP) + 1);
  const passes: Pass[] = [{ name: 'full', wave: full, fams: null }];
  let tonal: Float32Array;
  if (Object.keys(st).length) {
    // pistes séparées : chacune ne parle que de ce qu'elle contient
    if (st.vocals) passes.push({ name: 'vocals', wave: level(st.vocals), fams: ['voice'] });
    if (st.drums) passes.push({ name: 'drums', wave: level(st.drums), fams: ['drums'] });
    if (st.bass) passes.push({ name: 'bass', wave: level(st.bass), fams: ['bass'] }, { name: 'bass-low', wave: level(lowpass(st.bass, (inp.opts?.bassHi ?? SPLIT.bassHi), SR)), fams: ['bass'] });
    if (st.other) passes.push({ name: 'other', wave: level(st.other), fams: ALL_BUT('drums') });
    tonal = st.other || full;
    progress(0.3);
  } else {
    const harm = harmonic(full, f => progress(0.05 + 0.25 * f), stop);
    const o = { ...SPLIT, ...inp.opts };
    passes.push({ name: 'harmonic', wave: level(((x: Float32Array) => o.tonalHi ? lowpass(x, o.tonalHi, SR) : x)(highpass(harm, o.tonalLo, SR))), fams: ALL_BUT('drums') });
    passes.push({ name: 'low', wave: level(lowpass(harm, o.bassHi, SR)), fams: ['bass'] });
    const perc = new Float32Array(full.length); for (let i = 0; i < full.length; i++) perc[i] = full[i] - harm[i];
    passes.push({ name: 'percussive', wave: level(perc), fams: ['drums'] });
    tonal = harm;
  }
  const W = USED.length, scores = new Float32Array(n * W), rms = new Float32Array(n), flux = new Float32Array(n), means: Record<string, Float32Array> = {};
  for (let i = 0; i < n; i++) {
    const s = i * HOP; let q = 0; const e = Math.min(full.length, s + WIN);
    for (let k = s; k < e; k++) q += full[k] * full[k];
    rms[i] = Math.sqrt(q / WIN); flux[i] = envelopeFlux(tonal, s, WIN);
  }
  const famsOf = USED.map(c => FAMILIES.filter(f => c in f.classes).map(f => f.id).concat(c === 135 ? ['aguitar', 'eguitar'] : []));
  for (let p = 0; p < passes.length; p++) {
    const ps = passes[p], ok = USED.map((_, j) => !ps.fams || famsOf[j].some(id => ps.fams!.includes(id)));
    const r = await classify(ps.wave, n, f => progress(0.3 + 0.7 * (p + f) / passes.length), stop);
    means[ps.name] = r.mean;
    for (let i = 0; i < n; i++) for (let j = 0; j < W; j++) if (ok[j]) { const o = i * W + j; if (r.scores[o] > scores[o]) scores[o] = r.scores[o]; }
  }
  progress(1);
  return { n, scores, rms, flux, backend, means };
}
