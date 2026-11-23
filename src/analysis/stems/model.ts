/** V20 — Fichiers du modèle HTDemucs : téléchargés une fois depuis le site lui-même (`public/models/htdemucs/`), gardés dans
 *  le Cache Storage du navigateur pour marcher hors ligne, vérifiés par leur empreinte SHA-256. Aucun appel à un autre site.
 *  Tourne dans un Worker comme sur le fil principal. */

export const MODEL_CACHE = 'kh-models-v1';
export interface Manifest { name: string; size: number; sha256: string; parts: string[] }

/** Erreur avec un code que l'interface sait expliquer : `offline` (pas de réseau et pas en cache), `corrupt` (empreinte fausse). */
export class ModelError extends Error { constructor(public code: 'offline' | 'corrupt', msg: string) { super(msg); } }

const canCache = (url: string) => typeof caches !== 'undefined' && /^https?:/.test(url);

async function fetchBytes(url: string, onBytes: (n: number) => void): Promise<Uint8Array> {
  let res: Response;
  try { res = await fetch(url, { cache: 'no-cache' }); }
  catch (e) { throw new ModelError('offline', String((e as Error)?.message || e)); }
  if (!res.ok) throw new ModelError('offline', `HTTP ${res.status}`);
  const len = Number(res.headers.get('Content-Length')) || 0;
  if (!res.body) { const b = new Uint8Array(await res.arrayBuffer()); onBytes(b.length); return b; }
  const rd = res.body.getReader(), chunks: Uint8Array[] = []; let got = 0;
  try {
    for (;;) { const { done, value } = await rd.read(); if (done) break; chunks.push(value); got += value.length; onBytes(value.length); }
  } catch (e) { throw new ModelError('offline', String((e as Error)?.message || e)); }
  if (len && got !== len) throw new ModelError('offline', `${got}/${len}`);
  const out = new Uint8Array(got); let o = 0; for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

/** Garde un fichier dans le cache ; si l'appareil refuse (espace plein, navigation privée), le modèle sert quand même cette fois. */
async function keep(c: Cache, url: string, res: Response) {
  try { await c.put(url, res); keepFailed = false; } catch { keepFailed = true; }
}
/** Le dernier enregistrement dans le cache a-t-il été refusé ? (QA, message éventuel) */
export let keepFailed = false;

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');

/** Le modèle est-il déjà gardé dans l'appareil ? */
export async function modelCached(base: string) {
  if (!canCache(base)) return false;
  try {
    const c = await caches.open(MODEL_CACHE), hit = await c.match(base + 'manifest.json');
    const m = (hit ? await hit.json() : await (await fetch(base + 'manifest.json', { cache: 'no-cache' })).json()) as Manifest;
    for (const p of m.parts) if (!await c.match(base + p)) return false;
    return true;
  } catch { return false; }
}

/** Charge le modèle entier (octets). `progress(octets reçus, total, depuisLeCache)`. */
export async function loadModel(base: string, progress: (got: number, total: number, cached: boolean) => void): Promise<Uint8Array> {
  const cache = canCache(base) ? await caches.open(MODEL_CACHE) : null;
  let man: Manifest;
  const mUrl = base + 'manifest.json';
  try { const r = await fetch(mUrl, { cache: 'no-cache' }); if (!r.ok) throw new Error('HTTP ' + r.status); man = await r.json(); if (cache) await keep(cache, mUrl, new Response(JSON.stringify(man))); }
  catch (e) {
    const hit = cache && await cache.match(mUrl);
    if (!hit) throw new ModelError('offline', String((e as Error)?.message || e));
    man = await hit.json();
  }
  const all = new Uint8Array(man.size); let off = 0, got = 0, fromCache = true;
  for (const p of man.parts) {
    const url = base + p;
    const hit = cache && await cache.match(url);
    let b: Uint8Array;
    if (hit) { b = new Uint8Array(await hit.arrayBuffer()); got += b.length; progress(got, man.size, true); }
    else {
      fromCache = false;
      b = await fetchBytes(url, n => { got += n; progress(got, man.size, false); });
      if (cache) await keep(cache, url, new Response(b as Uint8Array<ArrayBuffer>, { headers: { 'Content-Type': 'application/octet-stream' } }));
    }
    if (off + b.length > man.size) throw new ModelError('corrupt', 'taille');
    all.set(b, off); off += b.length;
  }
  const sum = typeof crypto !== 'undefined' && crypto.subtle ? hex(await crypto.subtle.digest('SHA-256', all)) : man.sha256;
  if (off !== man.size || sum !== man.sha256) {
    if (cache) for (const p of man.parts) await cache.delete(base + p);   // fichier abîmé : on l'oublie, il sera retéléchargé
    throw new ModelError('corrupt', `${off} octets, empreinte ${sum.slice(0, 12)}`);
  }
  void fromCache;
  return all;
}

/** Oublie le modèle gardé (QA, ou place à libérer). */
export async function forgetModel() { if (typeof caches !== 'undefined') await caches.delete(MODEL_CACHE); }
