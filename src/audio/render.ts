// Export : rendu hors-ligne (en parallèle par groupes de pistes), mesure de charge, analyse, encodage WAV et MP3.
import { ensureBanks } from './banks';
import { gainLimit, lufs, peakOf } from './loudness';
import { Mix, scheduleStep, swingT } from './graph';
import { buffers } from '../store';
import { contentEnd, Project, timeOf } from '../types';

// ---------- Export : rendu hors-ligne + encodage WAV ----------
/** Ce que le dernier rendu n'a pas pu inclure. */
/** `parts` : nombre de rendus menés en parallèle pour le dernier export (1 = d'un seul tenant). */
export const lastRender = { wamFailed: 0, pdc: 0, parts: 1 };
/** Rendus hors-ligne en cours : ne sert qu'à afficher l'avancement d'un export, le calcul n'en dépend pas. */
const rendering = new Set<OfflineAudioContext>();
async function tracked(off: OfflineAudioContext): Promise<AudioBuffer> {
  rendering.add(off);
  try { return await off.startRendering(); } finally { rendering.delete(off); }
}
/** Avancement du rendu en cours, de 0 à 1 (null si rien ne se calcule). Avec des rendus parallèles, le plus en retard donne le ton. */
export function renderProgress(): number | null {
  if (!rendering.size) return null;
  let m = 1;
  for (const c of rendering) m = Math.min(m, c.currentTime * c.sampleRate / c.length);
  return Math.max(0, Math.min(1, m));
}
/** Rend une partie du projet (toutes ses pistes, ou un groupe d'entre elles) jusqu'au pas `end`.
 *  `stem` : la sortie s'arrête au volume général, avant sa chaîne (filtre, égaliseur, largeur, limiteur), appliquée ensuite une seule fois. */
async function renderPart(p: Project, end: number, stem: boolean, sr = 44100, limit: number | null = null) {
  const off = new OfflineAudioContext(2, Math.ceil((timeOf(p, end) + 2.5) * sr), sr);
  const mix = new Mix(off, false); mix.autoOn = true;
  if (p.tracks.some(t => t.sc && t.duck > 0)) await mix.initEnv();   // sidechain : le suiveur d'enveloppe doit exister avant le graphe
  mix.sync(p);
  if (stem) mix.stemOut();
  const wamFailed = await mix.loadWams(p); // plugins web : recréés pour ce rendu
  for (let s = 0; s < end; s++) mix.applyAuto(p, s, timeOf(p, s));
  for (let s = 0; s < end; s++) scheduleStep(mix, p, buffers, s, swingT(p, s, timeOf(p, s)), s === 0, limit);
  // Automation des plugins du Mac : le rendu s'arrête à chaque changement le temps de l'envoyer au plugin.
  for (const [q, fns] of mix.auEvents) {
    if (q <= 0) { fns.forEach(f => f()); continue; }
    off.suspend(q * 128 / sr).then(() => { fns.forEach(f => f()); off.resume(); });
  }
  await mix.flushInsts();   // instruments du Mac : toutes leurs notes sont arrivées avant le calcul
  const out = await tracked(off);
  mix.active.clear(); mix.disposePlugins();
  return { out, wamFailed, pdc: mix.pdcMax };
}
/**
 * Groupes de pistes rendus en parallèle (un fil de calcul par groupe) pour un gros projet, ou null pour un rendu d'un seul tenant.
 * Le mixage est linéaire jusqu'au volume général : la somme des groupes est le même son. Restent ensemble ce qui interagit :
 * un bus et ses pistes ; les kicks et les pistes qu'ils font « pomper » (sidechain). Pas de découpage avec un plugin du Mac
 * (sa latence est compensée sur tout le projet) ni avec une piste en solo.
 */
export function renderGroups(p: Project, cores = navigator.hardwareConcurrency || 2): Project[] | null {
  const n = Math.min(4, cores - 1);
  if (p.tracks.length < 12 || n < 2) return null;
  if ([...p.tracks, ...p.buses].some(t => t.solo || t.synth?.engine === 'au' || (t.inserts ?? []).some(i => i.type === 'au'))) return null;
  // Ce qui doit rester dans le même rendu est réuni (union de groupes) : une piste et le bus où elle sort ou envoie (V19),
  // une piste et la source de son sidechain (V19), les kicks du séquenceur et les pistes qu'ils font pomper.
  const busIds = new Set(p.buses.map(b => b.id)), ids = new Set(p.tracks.map(t => t.id)), up = new Map<string, string>();
  const root = (x: string): string => { let r = x; while (up.has(r)) r = up.get(r)!; return r; };
  const join = (a: string, b: string) => { const x = root(a), y = root(b); if (x !== y) up.set(x, y); };
  for (const t of p.tracks) {
    if (busIds.has(t.out)) join(t.id, 'bus:' + t.out);
    for (const sd of t.sends ?? []) if (busIds.has(sd.bus)) join(t.id, 'bus:' + sd.bus);
    if (t.duck > 0 && t.sc && ids.has(t.sc)) join(t.id, t.sc);
    if (t.duck > 0 && !t.sc) { join(t.id, 'kick'); for (const d of p.tracks) if (d.type === 'drums') join(d.id, 'kick'); }
  }
  const units = new Map<string, Project['tracks']>();
  for (const t of p.tracks) { const u = root(t.id); if (!units.has(u)) units.set(u, []); units.get(u)!.push(t); }
  if (units.size < 2) return null;
  // Répartition par coût estimé (une piste, plus ses effets ; une réverb compte davantage), du plus lourd au plus léger.
  const cost = (ts: Project['tracks']) => ts.reduce((a, t) => a + 1 + (t.inserts ?? []).reduce((b, i) => b + (i.type === 'reverb' ? 4 : 1), 0), 0);
  const bins = Array.from({ length: Math.min(n, units.size) }, () => ({ w: 0, tracks: [] as Project['tracks'] }));
  for (const ts of [...units.values()].sort((a, b) => cost(b) - cost(a))) { const b = bins.reduce((x, y) => (y.w < x.w ? y : x)); b.tracks.push(...ts); b.w += cost(ts); }
  return bins.map(b => ({ ...p, tracks: b.tracks, buses: p.buses.filter(x => b.tracks.some(t => t.out === x.id || t.sends?.some(sd => sd.bus === x.id))) }));
}
/** Rendu parallèle des gros projets (désactivable pour la QA et les comparaisons). */
export const renderOpts = { parallel: true };
/** Plage d'un export (V19) : du pas `from` au pas `to`, queue de son de 2,5 s après la fin ou non, fréquence d'échantillonnage.
 *  `stem` : le son sort avant le général (ni son volume, ni sa chaîne, ni son limiteur), pour le gel d'une piste qui y repassera. */
export interface RenderRange { from?: number; to?: number; tail?: boolean; rate?: number; stem?: boolean }
export async function renderOffline(p: Project, normalize = true, range: RenderRange = {}): Promise<AudioBuffer> {
  const full = contentEnd(p), from = Math.max(0, range.from ?? 0), end = Math.max(from, range.to ?? full);
  if (!full || end <= from) throw new Error('empty');
  const failed = await ensureBanks(p);
  if (failed.length) throw new Error('bank');
  // Une plage qui finit avant la fin du morceau coupe les notes et les sons à sa fin (comme la fin d'une boucle) ; il ne reste
  // après que les queues (relâchement, réverb, écho). Tout ce qui précède la plage est rendu, puis retiré : le début sonne
  // exactement comme dans le morceau (notes tenues, réverb en cours).
  const sr = range.rate ?? 44100, limit = end < full ? end : null, groups = renderOpts.parallel && !range.stem ? renderGroups(p) : null;
  let out: AudioBuffer, pdc = 0;
  if (!groups) {
    // Sortie avant le général : volume à 1 et sortie prise au volume, avant sa chaîne (filtre, égaliseur, largeur, limiteur).
    const r = range.stem ? await renderPart({ ...p, master: 1 }, end, true, sr, limit) : await renderPart(p, end, false, sr, limit);
    out = r.out; pdc = r.pdc; lastRender.wamFailed = r.wamFailed;
  } else {
    // Gros projet (V18) : chaque groupe dans son propre rendu, en même temps, puis la somme passe une fois par la chaîne du général.
    const parts = await Promise.all(groups.map(g => renderPart(g, end, true, sr, limit)));
    lastRender.wamFailed = parts.reduce((a, r) => a + r.wamFailed, 0);
    const len = parts[0].out.length, sum = new AudioBuffer({ numberOfChannels: 2, length: len, sampleRate: sr });
    for (let c = 0; c < 2; c++) { const d = sum.getChannelData(c); for (const r of parts) { const x = r.out.getChannelData(c); for (let i = 0; i < len; i++) d[i] += x[i]; } }
    const off = new OfflineAudioContext(2, len, sr), mix = new Mix(off, false);
    mix.sync({ ...p, tracks: [], buses: [] });
    const src = off.createBufferSource(); src.buffer = sum; mix.masterChainIn(src); src.start(0);
    out = await tracked(off);
  }
  lastRender.parts = groups?.length ?? 1;
  // Compensation de latence des plugins : tout le mixage sort en retard de `pdcMax` ; on le ramène au début du fichier,
  // pour que l'export (et les pistes séparées) reste calé sur la grille.
  const shift = Math.round(pdc * sr);
  if (shift > 0) for (let c = 0; c < out.numberOfChannels; c++) { const d = out.getChannelData(c); d.copyWithin(0, shift); d.fill(0, d.length - shift); }
  lastRender.pdc = pdc;
  const i0 = Math.round(timeOf(p, from) * sr), i1 = Math.min(out.length, Math.round((timeOf(p, end) + (range.tail === false ? 0 : 2.5)) * sr));
  if (i0 > 0 || i1 < out.length) {
    const cut = new AudioBuffer({ numberOfChannels: out.numberOfChannels, length: Math.max(1, i1 - i0), sampleRate: sr });
    for (let c = 0; c < out.numberOfChannels; c++) cut.copyToChannel(out.getChannelData(c).subarray(i0, i1), c);
    out = cut;
  }
  if (!normalize) return out;
  if (p.target < 0) {
    // Export au niveau d'une plateforme : on vise le volume perçu demandé, crêtes retenues par un limiteur.
    // Le limiteur retient les crêtes, donc un seul passage peut rester sous la cible : on s'en approche en trois passes au plus.
    for (let pass = 0; pass < 3; pass++) {
      const l = lufs(out);
      if (!Number.isFinite(l) || Math.abs(p.target - l) < 0.3) break;
      gainLimit(out, Math.min(8, Math.pow(10, (p.target - l) / 20)));
    }
    if (peakOf(out) > 0.966) gainLimit(out, 1); // déjà au bon volume : il reste à retenir les crêtes
  } else {
    // Simple protection : si une crête dépasse -0,3 dB, on ramène l'ensemble en dessous.
    const pk = peakOf(out);
    if (pk > 0.966) gainLimit(out, 0.966 / pk);
  }
  return out;
}
/**
 * Charge de calcul du mixage (V17) : le moteur calcule `sec` secondes du morceau à partir du pas `from`, aussi vite que possible,
 * avec le même graphe que l'écoute. Rapport = temps de calcul / durée du son : 0,25 veut dire qu'un quart du temps réel
 * d'un cœur du processeur suffit ; au-delà de 0,7 environ, l'écoute risque de craquer.
 */
export async function measureLoad(p: Project, from = 0, sec = 4): Promise<{ ratio: number; ms: number; sec: number; tracks: number; inserts: number }> {
  await ensureBanks(p);
  const sr = 44100, end = Math.max(contentEnd(p), from + 1), off = new OfflineAudioContext(2, Math.ceil(sec * sr), sr);
  const mix = new Mix(off, false); mix.autoOn = true;
  if (p.tracks.some(t => t.sc && t.duck > 0)) await mix.initEnv();
  mix.sync(p);
  await mix.loadWams(p);
  const t0 = timeOf(p, from);
  for (let s = from; s < end && timeOf(p, s) - t0 < sec; s++) { const t = timeOf(p, s) - t0; mix.applyAuto(p, s, t); scheduleStep(mix, p, buffers, s, swingT(p, s, t + t0) - t0, s === from, null); }
  await mix.flushInsts();
  const a = performance.now(); await off.startRendering(); const ms = performance.now() - a;
  mix.active.clear(); mix.disposePlugins();
  return { ratio: ms / 1000 / sec, ms, sec, tracks: p.tracks.length, inserts: p.tracks.reduce((n, t) => n + (t.inserts?.filter(i => i.on).length ?? 0), 0) };
}
/** Volume perçu et crête du morceau tel qu'il sera exporté. */
export async function analyze(p: Project): Promise<{ lufs: number; peakDb: number }> {
  const b = await renderOffline(p);
  return { lufs: lufs(b), peakDb: 20 * Math.log10(Math.max(1e-9, peakOf(b))) };
}
/** Encode en MP3 (192 kbit/s). L'encodeur n'est chargé qu'à la première utilisation. */
export async function encodeMp3(b: AudioBuffer): Promise<Blob> {
  const { Mp3Encoder } = await import('@breezystack/lamejs');
  const ch = Math.min(2, b.numberOfChannels), BLK = 1152 * 20;
  const encode = (gain: number) => {
    const enc = new Mp3Encoder(ch, b.sampleRate, 192), parts: BlobPart[] = [];
    const pcm = Array.from({ length: ch }, (_, c) => { const d = b.getChannelData(c), o = new Int16Array(d.length); for (let i = 0; i < d.length; i++) { const x = Math.max(-1, Math.min(1, d[i] * gain)); o[i] = x < 0 ? x * 0x8000 : x * 0x7fff; } return o; });
    for (let i = 0; i < b.length; i += BLK) {
      const out = enc.encodeBuffer(pcm[0].subarray(i, i + BLK), ch > 1 ? pcm[1].subarray(i, i + BLK) : undefined);
      if (out.length) parts.push(new Uint8Array(out) as BlobPart);
    }
    const end = enc.flush(); if (end.length) parts.push(new Uint8Array(end) as BlobPart);
    return new Blob(parts, { type: 'audio/mpeg' });
  };
  // L'encodage avec pertes peut créer de nouvelles crêtes. Vérifier le fichier
  // décodé (les deux canaux), puis réduire seulement si nécessaire. Le rendu
  // WAV et le tampon du projet restent inchangés ; trois essais au plus.
  const check = new OfflineAudioContext(ch, 1, b.sampleRate);
  let gain = 1;
  for (let attempt = 0; attempt < 3; attempt++) {
    const blob = encode(gain), peak = peakOf(await check.decodeAudioData(await blob.arrayBuffer()));
    // Marge de -1 dB de vraie crête (0,89) : un lecteur qui rééchantillonne (44,1 → 48 kHz) fait remonter les crêtes.
    if (Number.isFinite(peak) && peak <= 0.89) return blob;
    if (!Number.isFinite(peak)) break;
    gain *= 0.87 / peak;
  }
  throw new Error('mp3 peak');
}
/** WAV PCM en 16 ou 24 bits (V19), à la fréquence du rendu. */
export function encodeWav(b: AudioBuffer, bits: 16 | 24 = 16): Blob {
  const ch = b.numberOfChannels, n = b.length, B = bits / 8, v = new DataView(new ArrayBuffer(44 + n * ch * B));
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * ch * B, true); str(8, 'WAVEfmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true);
  v.setUint32(24, b.sampleRate, true); v.setUint32(28, b.sampleRate * ch * B, true);
  v.setUint16(32, ch * B, true); v.setUint16(34, bits, true); str(36, 'data'); v.setUint32(40, n * ch * B, true);
  const data = Array.from({ length: ch }, (_, i) => b.getChannelData(i));
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) {
    const x = Math.max(-1, Math.min(1, data[c][i]));
    if (bits === 16) { v.setInt16(o, x < 0 ? x * 0x8000 : x * 0x7fff, true); o += 2; }
    else { const q = Math.round(x < 0 ? x * 0x800000 : x * 0x7fffff); v.setUint8(o, q & 255); v.setUint8(o + 1, (q >> 8) & 255); v.setUint8(o + 2, (q >> 16) & 255); o += 3; }
  }
  return new Blob([v], { type: 'audio/wav' });
}
