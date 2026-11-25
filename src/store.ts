import { Clip, Project, Track, contentEnd, demoProject, migrate, timeOf, uid } from './types';

export const S = {
  project: demoProject() as Project,
  pid: '',    // identifiant du projet courant dans la bibliothèque du navigateur
  kbShow: typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches, // clavier à l'écran
  selTrack: '',
  selClip: '',
  grid: '16',   // grille du piano roll et de l'enregistrement des notes (clé de GRIDS)
  selMore: new Set<string>(), // clips ajoutés à la sélection par Maj+clic
  padEdit: -1,                // pad dont les réglages sont affichés
  tab: 'editor' as 'editor' | 'mixer' | 'live',
  drumView: 'seq' as 'seq' | 'pads',
  inputDevice: '', inputGain: 1, inputMonitor: false, // entrée audio
  outputDevice: '',                                   // sortie audio choisie ('' = celle du système)
  recOffsetMs: (() => { try { return +(localStorage.getItem('kh-rec-offset') || 0) || 0; } catch { return 0; } })(), // recalage des prises (ms)
  tuneAmt: 1,                                         // force de la correction de justesse
  stretch: { clip: '', pct: 100, semis: 0 },          // étirement en attente pour le clip audio ouvert
  synthOpen: false, // réglages détaillés de l'instrument dépliés dans le piano roll
  quant: { str: 1, swing: 0, hum: 0.5 }, // V19 : force et swing de la quantification, force de l'humanisation (réglages de séance)
  ctlShow: false, ctlKind: 'pb' as 'pb' | 'mod' | 'at', // V19 : ligne des contrôles joués sous le piano roll, et contrôle affiché
  px: 11,     // pixels par pas dans l'arrangement
  epx: 28,    // pixels par pas dans le piano roll (zoom à la molette)
  snap: 4,    // grille magnétique, en pas
  file: { path: '', name: '' }, // version bureau : fichier .khm lié au projet ouvert ('' = aucun)
};

// ---------- Version bureau : fichier .khm lié à chaque projet de la bibliothèque (V17) ----------
/** Fichier du disque lié au projet `pid` (enregistré ou ouvert depuis ce fichier). */
export function fileOf(pid: string): { path: string; name: string } {
  try { const v = JSON.parse(localStorage.getItem('kh-file:' + pid) || 'null'); if (v && typeof v.path === 'string') return { path: v.path, name: String(v.name || '') }; } catch { /* ignore */ }
  return { path: '', name: '' };
}
export function linkFile(f: { path: string; name: string }) {
  S.file = { path: f.path, name: f.name };
  document.title = (f.path ? f.name : S.project.name) + ' — KH Music Pro';
  try { localStorage.setItem('kh-file:' + S.pid, JSON.stringify(S.file)); } catch { /* stockage désactivé */ }
}
/** Projet de la bibliothèque déjà lié à ce fichier (pour ne pas créer un doublon à chaque ouverture). */
export function pidOfFile(path: string): string {
  try { for (const k of Object.keys(localStorage)) if (k.startsWith('kh-file:') && fileOf(k.slice(8)).path === path) return k.slice(8); } catch { /* ignore */ }
  return '';
}
/** Changements non enregistrés dans le fichier lié (version bureau : point dans le bouton de fermeture du Mac). */
export const fileState = { dirty: false };
const desk = () => (window as unknown as { khFiles?: { edited(on: boolean): void } }).khFiles;
export function setDirty(on: boolean) {
  if (fileState.dirty === on) return;
  fileState.dirty = on; desk()?.edited(on && !!S.file.path);
}

export const buffers = new Map<string, AudioBuffer>();

type Fn = () => void;
const subs: Fn[] = [];
export const onChange = (f: Fn) => { subs.push(f); };
export const emit = () => subs.forEach(f => f());

/** Changement de sélection : mise à jour légère, sans reconstruire l'arrangement. */
const selSubs: Fn[] = [];
export const onSelect = (f: Fn) => { selSubs.push(f); };
export function select(track: string, clip: string) {
  if (S.selTrack === track && S.selClip === clip && !S.selMore.size) return;
  S.selMore.clear();
  S.selTrack = track; S.selClip = clip; selSubs.forEach(f => f());
}

// ---------- Annuler / rétablir ----------
let hist: string[] = [], hi = -1;
export function resetHistory() { hist = [JSON.stringify(S.project)]; hi = 0; }
export function commit() {
  hist = hist.slice(0, hi + 1); hist.push(JSON.stringify(S.project));
  if (hist.length > 150) hist.shift();
  hi = hist.length - 1; setDirty(true); autosave(); emit();
}
function travel(d: number) {
  if (hi + d < 0 || hi + d >= hist.length) return;
  hi += d; S.project = JSON.parse(hist[hi]); autosave(); emit();
}
export const undo = () => travel(-1);
/** Retouche qui complète la dernière action (réglage calculé juste après un ajout) : si rien n'a changé depuis cette action,
 *  elle est fondue dedans (un seul Ctrl+Z annule les deux) ; sinon elle devient une action à part. */
export function amend(fn: () => void) {
  const same = hi === hist.length - 1 && JSON.stringify(S.project) === hist[hi];
  fn();
  if (!same) { commit(); return; }
  hist[hi] = JSON.stringify(S.project); autosave(); emit();
}
/** Abandonne les modifications en cours non validées (glissé annulé par le système) : retour au dernier état enregistré dans l'historique. */
export function revert() { if (hi >= 0 && JSON.stringify(S.project) !== hist[hi]) { S.project = JSON.parse(hist[hi]); emit(); } }
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
    // Espace plein : la transaction est abandonnée à la validation, sans « error » ; sans ceci la promesse ne finirait jamais.
    t.onabort = () => rej(t.error ?? new DOMException('Transaction abandonnée', 'AbortError'));
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
  idbSet('buf:' + id, toRaw(b)).then(saveOk, saveFailed);
}

// ---------- Sauvegarde impossible : on le dit, au lieu de s'arrêter en silence ----------
/** Appelé quand l'enregistrement dans l'appareil échoue (`full` : espace plein) ou refonctionne après un échec. */
export const saveHealth = { failing: false, full: false, onChange: (_failing: boolean, _full: boolean) => { /* branché par main.ts */ } };
function saveFailed(e: unknown) {
  const full = (e as { name?: string } | null)?.name === 'QuotaExceededError';
  if (saveHealth.failing && saveHealth.full === full) return;
  saveHealth.failing = true; saveHealth.full = full; saveHealth.onChange(true, full);
}
function saveOk() {
  if (!saveHealth.failing) return;
  saveHealth.failing = false; saveHealth.full = false; saveHealth.onChange(false, false);
}

// ---------- Bibliothèque : plusieurs projets gardés dans le navigateur ----------
export interface LibEntry { id: string; name: string; updated: number }
export let library: LibEntry[] = [];

let saveTimer = 0;
function autosave() {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => { saveNow().catch(() => { /* stockage indisponible */ }); }, 500);
}
export async function saveNow() {
  clearTimeout(saveTimer);
  if (!S.pid) S.pid = uid();
  const id = S.pid, e = library.find(x => x.id === id), now = Date.now();
  if (e) { e.name = S.project.name; e.updated = now; } else library.push({ id, name: S.project.name, updated: now });
  const json = JSON.stringify(S.project);
  try { await idbSet('proj:' + id, json); await idbSet('lib', library); await idbSet('current', id); } catch (e) { saveFailed(e); throw e; }
  saved.at = now; saveOk();
  if (now - versioning.last >= versioning.every) await snapshot('auto', json);
}

// ---------- Versions du projet (V17) : instantanés gardés dans le navigateur, pour revenir en arrière même après fermeture ----------
/** Un instantané : date, nom du projet à ce moment, nombre de pistes, et pourquoi il a été pris. */
export interface Version { t: number; name: string; tracks: number; why: 'auto' | 'open' | 'restore' | 'crash' | 'manual' }
/** Un instantané au plus toutes les `every` ms d'édition (2 minutes) ; `keep` derniers gardés, plus un par jour au-delà (`days`). */
export const versioning = { every: 120000, keep: 20, days: 10, last: 0 };
/** Date de la dernière sauvegarde automatique réussie (0 = jamais dans cette session). */
export const saved = { at: 0 };
let lastSnap = '';
export const listVersions = async (pid = S.pid) => (await idbGet<Version[]>('vers:' + pid)) ?? [];
/** Prend un instantané du projet courant (rien si identique au précédent). */
export async function snapshot(why: Version['why'], json = JSON.stringify(S.project)): Promise<boolean> {
  if (!S.pid) S.pid = uid();
  const pid = S.pid, list = await listVersions(pid);
  versioning.last = Date.now();
  if (!lastSnap && list.length) lastSnap = (await idbGet<string>(`ver:${pid}:${list[list.length - 1].t}`)) ?? '';
  if (json === lastSnap) return false;
  const t = Math.max(Date.now(), (list[list.length - 1]?.t ?? 0) + 1), p = S.project;
  await idbSet(`ver:${pid}:${t}`, json);
  list.push({ t, name: p.name, tracks: p.tracks.length, why });
  // Éclaircissement : les `keep` plus récents, puis le plus récent de chaque jour, sur `days` jours au plus.
  const recent = list.slice(-versioning.keep), older = list.slice(0, -versioning.keep), day = (x: Version) => new Date(x.t).toDateString(), kept: Version[] = [];
  for (let i = older.length - 1; i >= 0 && kept.length < versioning.days; i--) if (!kept.some(k => day(k) === day(older[i])) && !recent.some(r => day(r) === day(older[i]))) kept.unshift(older[i]);
  const next = [...kept, ...recent];
  for (const v of list) if (!next.includes(v)) await idbDel(`ver:${pid}:${v.t}`);
  await idbSet('vers:' + pid, next);
  lastSnap = json;
  return true;
}
/** Plantage reconnu après coup (seconde vérification) : la version d'ouverture déjà prise devient « récupérée » (sinon une nouvelle version l'est). */
export async function markRecovered(): Promise<void> {
  const list = await listVersions(), last = list[list.length - 1];
  if (!last) { await snapshot('crash'); return; }
  // Si l'état n'a pas changé depuis la dernière version, c'est elle qu'on a rouverte : on la marque.
  if ((last.why === 'open' || !(await snapshot('crash')))) { last.why = 'crash'; await idbSet('vers:' + S.pid, list); }
}
/** Revient à un instantané : l'état actuel est d'abord gardé comme version, et Annuler ramène à l'état d'avant. */
export async function restoreVersion(t: number): Promise<void> {
  const json = await idbGet<string>(`ver:${S.pid}:${t}`);
  if (!json) throw new Error('missing');
  await snapshot('restore');
  const p: Project = migrate(JSON.parse(json));
  await loadBuffers(p);
  S.project = p;
  if (!findTrack(S.selTrack)) { S.selTrack = p.tracks[0]?.id ?? ''; S.selClip = p.tracks[0]?.clips[0]?.id ?? ''; }
  commit();
}

// ---------- Fermeture inattendue (V17) ----------
// Chaque onglet ouvert laisse une trace (localStorage) qu'il efface en se fermant normalement, et garde un verrou
// (Web Locks) tant qu'il vit : le système le libère si l'onglet ou l'application meurt. Au démarrage, une trace dont le
// verrou n'est plus tenu = une session précédente qui s'est arrêtée net (plantage, ordinateur éteint, application tuée).
// Sans Web Locks, une trace sans battement depuis plus de 15 s compte comme telle. Le projet a déjà été rouvert depuis
// la sauvegarde automatique : on le dit au musicien, et la version d'ouverture est marquée « récupérée ».
export const crash = { found: false, name: '', at: 0 };
const TAB = uid();
function beat() { try { localStorage.setItem('kh-open:' + TAB, JSON.stringify({ t: Date.now(), pid: S.pid })); } catch { /* stockage désactivé */ } }
export async function watchSession(onLate?: () => void) {
  const locks = (navigator as Navigator & { locks?: LockManager }).locks;
  const heldNow = async (): Promise<Set<string> | null> => { try { return locks ? new Set(((await locks.query()).held ?? []).map(l => l.name ?? '')) : null; } catch { return null; } };
  const read = (k: string) => { try { return JSON.parse(localStorage.getItem(k) || '{}'); } catch { return {}; } };
  const held = await heldNow(), doubtful: string[] = [];
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith('kh-open:')) {
      const v = read(k), dead = held ? !held.has('kh-tab:' + k.slice(8)) : Date.now() - (v.t || 0) > 15000;
      if (dead) { crash.found = true; localStorage.removeItem(k); }
      else doubtful.push(k);   // verrou encore tenu : autre onglet vivant, ou onglet planté que le système n'a pas fini de libérer
    }
  } catch { /* stockage désactivé */ }
  // Seconde vérification 8 s plus tard : le verrou d'un onglet planté a alors été libéré par le système.
  if (doubtful.length && !crash.found) setTimeout(async () => {
    const h2 = await heldNow(); let late = false;
    for (const k of doubtful) {
      const v = read(k); if (!v.t) continue;
      // Avec Web Locks, seul le verrou compte (un onglet caché ralentit ses battements) ; sans, le battement.
      if (h2 ? !h2.has('kh-tab:' + k.slice(8)) : Date.now() - v.t > 7500) { late = true; try { localStorage.removeItem(k); } catch { /* ignore */ } }
    }
    if (late && !crash.found) { crash.found = true; onLate?.(); }
  }, 8000);
  try { locks?.request('kh-tab:' + TAB, () => new Promise(() => { /* tenu jusqu'à la fin de l'onglet */ })); } catch { /* ignore */ }
  beat(); setInterval(beat, 5000);
  const flush = () => { saveNow().catch(() => { }); };
  addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
  addEventListener('pagehide', () => { flush(); try { localStorage.removeItem('kh-open:' + TAB); } catch { /* ignore */ } });
  addEventListener('pageshow', e => { if (e.persisted) beat(); });
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
    S.pid = id || uid(); S.file = fileOf(S.pid);
    if (!json) return false;
    let p: Project;
    try { p = migrate(JSON.parse(json)); }
    catch {
      // Sauvegarde illisible : on repart de la version précédente la plus récente qui se relit.
      const list = await listVersions(S.pid); let ok: Project | null = null;
      for (let i = list.length - 1; i >= 0 && !ok; i--) { try { ok = migrate(JSON.parse((await idbGet<string>(`ver:${S.pid}:${list[i].t}`)) ?? '')); } catch { /* suivante */ } }
      if (!ok) return false;
      p = ok; crash.found = true;
    }
    await loadBuffers(p);
    S.project = p;
    crash.name = p.name; crash.at = library.find(x => x.id === S.pid)?.updated ?? 0;
    return true;
  } catch { S.pid ||= uid(); return false; }
}

function install(p: Project, id: string) {
  S.project = p; S.pid = id; S.selTrack = ''; S.selClip = ''; lastSnap = ''; versioning.last = Date.now();
  S.file = fileOf(id); setDirty(false);
  resetHistory(); autosave(); emit();
}
/** Remplace le projet ouvert, sans en créer un autre dans la bibliothèque (accueil du premier lancement : la démo n'a pas encore servi). */
export function replaceProject(p: Project) { install(p, S.pid || uid()); }
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
  await snapshot('open').catch(() => { });
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
  for (const v of await listVersions(id)) await idbDel(`ver:${id}:${v.t}`);
  await idbDel('vers:' + id); await idbDel('proj:' + id); await idbSet('lib', library);
}

// ---------- Aperçu des projets de la bibliothèque ----------
/** Ce qu'on montre d'un projet sans l'ouvrir : tempo, nombre de pistes, durée, et ses clips piste par piste (miniature). */
export interface ProjInfo { bpm: number; tracks: number; sec: number; end: number; rows: { color: string; clips: [number, number][] }[] }
export function projectInfo(p: Project): ProjInfo {
  const end = contentEnd(p);
  return { bpm: p.bpm, tracks: p.tracks.length, sec: end ? timeOf(p, end) : 0, end, rows: p.tracks.map(t => ({ color: t.color, clips: t.clips.map(c => [c.start, c.len] as [number, number]) })) };
}
const infoCache = new Map<string, { updated: number; info: ProjInfo }>();
/** Aperçu du projet `id` de la bibliothèque (relu dans l'appareil, gardé en mémoire tant que le projet ne change pas). */
export async function libraryInfo(id: string): Promise<ProjInfo | null> {
  if (id === S.pid) return projectInfo(S.project);
  const e = library.find(x => x.id === id), hit = infoCache.get(id);
  if (e && hit && hit.updated === e.updated) return hit.info;
  try {
    const json = await idbGet<string>('proj:' + id);
    if (!json) return null;
    const info = projectInfo(migrate(JSON.parse(json)));
    if (e) infoCache.set(id, { updated: e.updated, info });
    return info;
  } catch { return null; }
}
/** Renomme un projet de la bibliothèque, ouvert ou non. */
export async function renameLibProject(id: string, name: string) {
  const n = name.trim(); if (!n) return;
  if (id === S.pid) { S.project.name = n; commit(); await saveNow().catch(() => { }); return; }
  const json = await idbGet<string>('proj:' + id), e = library.find(x => x.id === id);
  if (!json || !e) return;
  const p: Project = JSON.parse(json); p.name = n; e.name = n;
  await idbSet('proj:' + id, JSON.stringify(p)); await idbSet('lib', library);
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

/** Charge un fichier .khm ; `pid` : projet de la bibliothèque à réutiliser (même fichier rouvert). */
export function loadProjectFile(text: string, pid = '') {
  const data = JSON.parse(text);
  if (data.format !== 'kh-music-pro' || !data.project?.tracks) throw new Error('invalid');
  for (const [id, r] of Object.entries<{ sr: number; ch: string[] }>(data.buffers ?? {})) {
    addBuffer(id, fromRaw({ sr: r.sr, ch: r.ch.map(unb64) }));
  }
  saveNow().catch(() => { });
  if (pid && !library.some(x => x.id === pid)) pid = '';
  install(migrate(data.project), pid || uid());
  snapshot('open').catch(() => { });
}
