/** V20 — notes par Basic Pitch (Spotify, Apache 2.0) : un petit réseau qui donne, 86 fois par seconde et pour chacune des
 *  88 touches du piano, la probabilité qu'une note sonne (`frames`) et qu'elle commence (`onsets`).
 *  La création des notes à partir de ces cartes reprend la méthode publiée avec le modèle (`outputToNotesPoly`), réécrite. */
import * as tf from '@tensorflow/tfjs-core';
import '@tensorflow/tfjs-backend-cpu';
import { setWasmPaths } from '@tensorflow/tfjs-backend-wasm';
import { GraphModel, loadGraphModel } from '@tensorflow/tfjs-converter';

export interface BpFiles { json: unknown; weights: ArrayBuffer[]; wasm: ArrayBuffer | null; wasmSimd: ArrayBuffer | null }
export interface BpNote { t: number; d: number; midi: number; vel: number }
export interface BpOpts { onset?: number; frame?: number; minLen?: number; lo?: number; hi?: number; mono?: boolean }

export const BP_SR = 22050;
const HOP = 256, FPS = Math.floor(BP_SR / HOP), WIN = BP_SR * 2 - HOP, OVER = 30, OVER_S = OVER * HOP, STEP = WIN - OVER_S, KEYS = 88, MIDI0 = 21;
const WIN_FRAMES = FPS * 2, WIN_OFFSET = (HOP / BP_SR) * (WIN_FRAMES - WIN / HOP) + 0.0018;
/** instant (s) d'une trame du modèle, avec la correction de recollage des fenêtres publiée avec le modèle */
const timeOf = (f: number) => f * HOP / BP_SR - WIN_OFFSET * Math.floor(f / WIN_FRAMES);

let model: GraphModel | null = null, backend = '';
export const bpBackend = () => backend;

async function setup(files: BpFiles) {
  if (model) return;
  const j = files.json as { modelTopology: object; weightsManifest: { weights: tf.io.WeightsManifestEntry[] }[]; format?: string; generatedBy?: string; convertedBy?: string };
  const total = files.weights.reduce((a, b) => a + b.byteLength, 0), all = new Uint8Array(total);
  let o = 0; for (const b of files.weights) { all.set(new Uint8Array(b), o); o += b.byteLength; }
  const handler = tf.io.fromMemory({ modelTopology: j.modelTopology, weightSpecs: j.weightsManifest.flatMap(g => g.weights), weightData: all.buffer, format: j.format, generatedBy: j.generatedBy, convertedBy: j.convertedBy });
  const load = async () => { model = await loadGraphModel(handler); tf.tidy(() => { model!.execute(tf.zeros([1, WIN, 1]), ['Identity_1', 'Identity_2']); }); };
  const tryWasm = async () => {
    if (!files.wasm || typeof WebAssembly !== 'object') return false;
    try {
      tf.env().set('WASM_HAS_MULTITHREAD_SUPPORT', false);
      const url = (b: ArrayBuffer | null) => b ? URL.createObjectURL(new Blob([b], { type: 'application/wasm' })) : '';
      const plain = url(files.wasm);
      setWasmPaths({ 'tfjs-backend-wasm.wasm': plain, 'tfjs-backend-wasm-simd.wasm': url(files.wasmSimd) || plain, 'tfjs-backend-wasm-threaded-simd.wasm': plain });
      if (!(await tf.setBackend('wasm'))) return false;
      await tf.ready(); await load(); return true;
    } catch { model = null; return false; }
  };
  if (!(await tryWasm())) { await tf.setBackend('cpu'); await tf.ready(); await load(); }
  backend = tf.getBackend();
}

/** Cartes du modèle pour un son mono à 22 050 Hz : `n` trames × 88 touches. */
export async function bpMaps(x: Float32Array, files: BpFiles, progress: (f: number) => void, stop: () => boolean): Promise<{ frames: Float32Array; onsets: Float32Array; n: number }> {
  await setup(files);
  const n = Math.floor(x.length * FPS / BP_SR), frames = new Float32Array(n * KEYS), onsets = new Float32Array(n * KEYS);
  const pad = new Float32Array(x.length + OVER_S / 2 + WIN); pad.set(x, OVER_S / 2);
  const nWin = Math.max(1, Math.ceil((x.length + OVER_S / 2) / STEP));
  let at = 0;
  for (let w = 0; w < nWin && at < n; w++) {
    if (stop()) throw new Error('stopped');
    const seg = pad.subarray(w * STEP, w * STEP + WIN);
    const [fr, on] = tf.tidy(() => model!.execute(tf.tensor3d(seg, [1, WIN, 1]), ['Identity_1', 'Identity_2']) as tf.Tensor3D[]);
    const fd = await fr.data(), od = await on.data(), rows = fr.shape[1]; fr.dispose(); on.dispose();
    const a = OVER / 2, keep = Math.min(rows - OVER, n - at);
    frames.set(fd.subarray(a * KEYS, (a + keep) * KEYS), at * KEYS);
    onsets.set(od.subarray(a * KEYS, (a + keep) * KEYS), at * KEYS);
    at += keep;
    progress((w + 1) / nWin);
    if (w % 4 === 3) await new Promise(r => setTimeout(r, 0));
  }
  return { frames, onsets, n: at };
}

/** Cartes → notes. `mono` : une seule note à la fois (voix, basse) — à chaque instant, la note la plus forte l'emporte. */
export function bpNotes(m: { frames: Float32Array; onsets: Float32Array; n: number }, o: BpOpts = {}): BpNote[] {
  const { n } = m, onT = o.onset ?? 0.5, frT = o.frame ?? 0.3, minLen = o.minLen ?? 5, TOL = 11;
  const lo = Math.max(0, (o.lo ?? MIDI0) - MIDI0), hi = Math.min(KEYS - 1, (o.hi ?? MIDI0 + KEYS - 1) - MIDI0);
  const F = m.frames, E = Float32Array.from(F), at = (i: number, k: number) => i * KEYS + k;
  // débuts déduits : là où la note se met à sonner d'un coup, même sans « début » net (jeu lié)
  let onMax = 0, dMax = 0;
  const D = new Float32Array(n * KEYS);
  for (let i = 0; i < n; i++) for (let k = lo; k <= hi; k++) {
    onMax = Math.max(onMax, m.onsets[at(i, k)]);
    if (i >= 2) { const v = Math.max(0, Math.min(F[at(i, k)] - F[at(i - 1, k)], F[at(i, k)] - F[at(i - 2, k)])); D[at(i, k)] = v; dMax = Math.max(dMax, v); }
  }
  const O = new Float32Array(n * KEYS);
  for (let i = 0; i < n; i++) for (let k = lo; k <= hi; k++) O[at(i, k)] = Math.max(m.onsets[at(i, k)], dMax ? onMax * D[at(i, k)] / dMax : 0);
  const starts: [number, number][] = [];
  for (let i = 1; i < n - 1; i++) for (let k = lo; k <= hi; k++) { const v = O[at(i, k)]; if (v >= onT && v > O[at(i - 1, k)] && v > O[at(i + 1, k)]) starts.push([i, k]); }
  const out: { a: number; b: number; k: number; amp: number }[] = [];
  const clear = (i: number, k: number) => { E[at(i, k)] = 0; if (k < KEYS - 1) E[at(i, k + 1)] = 0; if (k > 0) E[at(i, k - 1)] = 0; };
  const amp = (a: number, b: number, k: number) => { let s = 0; for (let i = a; i < b; i++) s += F[at(i, k)]; return s / Math.max(1, b - a); };
  for (let q = starts.length - 1; q >= 0; q--) {
    const [a, k] = starts[q]; let i = a + 1, miss = 0;
    while (i < n - 1 && miss < TOL) { if (E[at(i, k)] < frT) miss++; else miss = 0; i++; }
    i -= miss;
    if (i - a <= minLen) continue;
    for (let j = a; j < i; j++) clear(j, k);
    out.push({ a, b: i, k, amp: amp(a, i, k) });
  }
  // notes restées sans début (attaque douce) : on part du point le plus fort et on s'étend des deux côtés
  const rest: [number, number, number][] = [];
  for (let i = 0; i < n; i++) for (let k = lo; k <= hi; k++) { const v = E[at(i, k)]; if (v > frT) rest.push([v, i, k]); }
  rest.sort((u, v) => v[0] - u[0]);
  for (const [, im, k] of rest) {
    if (E[at(im, k)] <= frT) continue;
    E[at(im, k)] = 0;
    let i = im + 1, miss = 0;
    while (i < n - 1 && miss < TOL) { if (E[at(i, k)] < frT) miss++; else miss = 0; clear(i, k); i++; }
    const b = i - 1 - miss;
    i = im - 1; miss = 0;
    while (i > 0 && miss < TOL) { if (E[at(i, k)] < frT) miss++; else miss = 0; clear(i, k); i--; }
    const a = i + 1 + miss;
    if (b - a > minLen) out.push({ a, b, k, amp: amp(a, b, k) });
  }
  let ev = out;
  if (o.mono) {
    // une note à la fois : la plus forte garde sa place, les autres sont coupées autour d'elle
    const owner = new Int32Array(n).fill(-1), order = out.map((_, i) => i).sort((u, v) => out[v].amp * (out[v].b - out[v].a) - out[u].amp * (out[u].b - out[u].a));
    for (const id of order) for (let i = out[id].a; i < out[id].b; i++) if (owner[i] < 0) owner[i] = id;
    ev = [];
    for (let i = 0; i < n;) {
      const id = owner[i]; let j = i; while (j < n && owner[j] === id) j++;
      if (id >= 0 && j - i > minLen) ev.push({ a: i, b: j, k: out[id].k, amp: out[id].amp });
      i = j;
    }
  }
  return ev.sort((u, v) => u.a - v.a || u.k - v.k).map(e => ({ t: Math.max(0, timeOf(e.a)), d: Math.max(0.03, timeOf(e.b) - timeOf(e.a)), midi: e.k + MIDI0, vel: Math.max(0.05, Math.min(1, e.amp * 1.4)) }));
}
