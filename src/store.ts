import { Clip, Project, Track, demoProject, migrate, uid } from './types';

export const S = {
  project: demoProject() as Project,
  pid: '',    // identifiant du projet courant dans la bibliothèque du navigateur
  kbShow: typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches, // clavier à l'écran
  selTrack: '',
  selClip: '',
  tab: 'editor' as 'editor' | 'mixer' | 'live',
  drumView: 'seq' as 'seq' | 'pads',
  inputDevice: '', inputGain: 1, inputMonitor: false, // entrée audio
  stretch: { clip: '', pct: 100, semis: 0 },          // étirement en attente pour le clip audio ouvert
  synthOpen: false, // réglages détaillés de l'instrument dépliés dans le piano roll
  px: 11,     // pixels par pas dans l'arrangement
  snap: 4,    // grille magnétique, en pas
};

export const buffers = new Map<string, AudioBuffer>();

type Fn = () => void;
const subs: Fn[] = [];
export const onChange = (f: Fn) => { subs.push(f); };
export const emit = () => subs.forEach(f => f());

/** Changement de sélection : mise à jour légère, sans reconstruire l'arrangement. */
const selSubs: Fn[] = [];
export const onSelect = (f: Fn) => { selSubs.push(f); };
export function select(track: string, clip: string) {
  if (S.selTrack === track && S.selClip === clip) return;
  S.selTrack = track; S.selClip = clip; selSubs.forEach(f => f());
}

// ---------- Annuler / rétablir ----------
let hist: string[] = [], hi = -1;
export function resetHistory() { hist = [JSON.stringify(S.project)]; hi = 0; }
export function commit() {
  hist = hist.slice(0, hi + 1); hist.push(JSON.stringify(S.project));
  if (hist.length > 150) hist.shift();
  hi = hist.length - 1; autosave(); emit();
}
function travel(d: number) {
  if (hi + d < 0 || hi + d >= hist.length) return;
  hi += d; S.project = JSON.parse(hist[hi]); autosave(); emit();
}
export const undo = () => travel(-1);
export const redo = () => travel(1);

export const findTrack = (id: string): Track | undefined => S.project.tracks.find(t => t.id === id);
export function findClip(id: string): { track: Track; clip: Clip } | null {
  for (const track of S.project.tracks) { const clip = track.clips.find(c => c.id === id); if (clip) return { track, clip }; }
  return null;
}

// ---------- Persistance locale (IndexedDB) ----------
function db(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open('khmusicpro', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction('kv', mode), r = fn(t.objectStore('kv'));
    t.oncomplete = () => res(r.result); t.onerror = () => rej(t.error);
  });
}
const idbSet = (k: string, v: unknown) => tx('readwrite', s => s.put(v, k));
const idbGet = <T>(k: string) => tx<T>('readonly', s => s.get(k));
export const idbClear = () => tx('readwrite', s => s.clear());
const idbDel = (k: string) => tx('readwrite', s => s.delete(k));

interface RawBuf { sr: number; ch: Float32Array[] }
const toRaw = (b: AudioBuffer): RawBuf => ({ sr: b.sampleRate, ch: Array.from({ length: b.numberOfChannels }, (_, i) => b.getChannelData(i).slice()) });
function fromRaw(r: RawBuf): AudioBuffer {
  const b = new AudioBuffer({ length: r.ch[0].length, numberOfChannels: r.ch.length, sampleRate: r.sr });
  r.ch.forEach((d, i) => b.getChannelData(i).set(d));
  return b;
}

/** Tous les sons référencés par un projet : clips audio, pads et samplers. */
export function usedBuffers(p: Project): Set<string> {
  const used = new Set<string>();
  for (const t of p.tracks) {
    for (const c of t.clips) if (c.bufferId) used.add(c.bufferId);
    for (const pad of t.pads ?? []) if (pad) used.add(pad.bufferId);
    if (t.synth?.bufferId) used.add(t.synth.bufferId);
  }
  return used;
}

export function addBuffer(id: string, b: AudioBuffer) {
  buffers.set(id, b);
  idbSet('buf:' + id, toRaw(b)).catch(() => { /* stockage indisponible */ });
}

// ---------- Bibliothèque : plusieurs projets gardés dans le navigateur ----------
export interface LibEntry { id: string; name: string; updated: number }
export let library: LibEntry[] = [];

let saveTimer = 0;
function autosave() {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => { saveNow().catch(() => { /* stockage indisponible */ }); }, 500);
}
async function saveNow() {
  clearTimeout(saveTimer);
  if (!S.pid) S.pid = uid();
  const id = S.pid, e = library.find(x => x.id === id), now = Date.now();
  if (e) { e.name = S.project.name; e.updated = now; } else library.push({ id, name: S.project.name, updated: now });
  await idbSet('proj:' + id, JSON.stringify(S.project)); await idbSet('lib', library); await idbSet('current', id);
}
async function loadBuffers(p: Project) {
  for (const id of usedBuffers(p)) if (!buffers.has(id)) {
    const raw = await idbGet<RawBuf>('buf:' + id);
    if (raw) buffers.set(id, fromRaw(raw));
  }
}

export async function loadAutosave(): Promise<boolean> {
  try {
    library = (await idbGet<LibEntry[]>('lib')) ?? [];
    let id = await idbGet<string>('current'), json = id ? await idbGet<string>('proj:' + id) : undefined;
    if (!json) { json = await idbGet<string>('project'); id = uid(); } // sauvegarde d'une version antérieure
    S.pid = id || uid();
    if (!json) return false;
    const p: Project = migrate(JSON.parse(json));
    await loadBuffers(p);
    S.project = p;
    return true;
  } catch { S.pid ||= uid(); return false; }
}

function install(p: Project, id: string) {
  S.project = p; S.pid = id; S.selTrack = ''; S.selClip = '';
  resetHistory(); autosave(); emit();
}
/** Démarre un nouveau projet ; le précédent reste dans la bibliothèque. */
export function startProject(p: Project) {
  saveNow().catch(() => { });
  install(p, uid());
}
export async function openProject(id: string) {
  await saveNow().catch(() => { });
  const json = await idbGet<string>('proj:' + id);
  if (!json) throw new Error('missing');
  const p: Project = migrate(JSON.parse(json));
  await loadBuffers(p); install(p, id);
}
export async function duplicateProject(id: string) {
  if (id === S.pid) await saveNow();
  const json = await idbGet<string>('proj:' + id), src = library.find(x => x.id === id);
  if (!json || !src) return;
  const p: Project = JSON.parse(json), nid = uid(); p.name = src.name + ' 2';
  library.push({ id: nid, name: p.name, updated: Date.now() });
  await idbSet('proj:' + nid, JSON.stringify(p)); await idbSet('lib', library);
}
export async function deleteProject(id: string) {
  if (id === S.pid) return;
  library = library.filter(x => x.id !== id);
  await idbDel('proj:' + id); await idbSet('lib', library);
}

// ---------- Fichier projet (.khm) ----------
function b64(f: Float32Array): string {
  const u = new Uint8Array(f.buffer, f.byteOffset, f.byteLength); let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
}
function unb64(s: string): Float32Array {
  const bin = atob(s), u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return new Float32Array(u.buffer);
}

export function serializeProject(): string {
  const used = usedBuffers(S.project);
  const bufs: Record<string, { sr: number; ch: string[] }> = {};
  for (const id of used) { const b = buffers.get(id); if (b) { const r = toRaw(b); bufs[id] = { sr: r.sr, ch: r.ch.map(b64) }; } }
  return JSON.stringify({ format: 'kh-music-pro', version: 1, project: S.project, buffers: bufs });
}

export function loadProjectFile(text: string) {
  const data = JSON.parse(text);
  if (data.format !== 'kh-music-pro' || !data.project?.tracks) throw new Error('invalid');
  for (const [id, r] of Object.entries<{ sr: number; ch: string[] }>(data.buffers ?? {})) {
    addBuffer(id, fromRaw({ sr: r.sr, ch: r.ch.map(unb64) }));
  }
  saveNow().catch(() => { });
  install(migrate(data.project), uid());
}
