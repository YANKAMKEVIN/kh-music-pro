// Clips : retouches du son, copier-coller, découpe, prises et comping, import de fichiers audio.
import { engine } from '../audio/engine';
import { t } from '../i18n';
import { addBuffer, buffers, commit, findClip, findTrack, S } from '../store';
import { stretchBuffer } from '../audio/stretch';
import { tuneBuffer } from '../audio/tune';
import { bpmAt, Clip, compSet, compSlice, emptyDrums, inScale, newTrack, NPADS, srcStep, stepDur, Track, TrackType, uid } from '../types';
import { toast } from '../ui/dom';

/** Remplace le son d'un clip audio par une version transformée (l'original reste disponible pour l'annulation). */
function rewriteClip(fn: (src: Float32Array, dst: Float32Array) => void, after?: (clip: Clip, buf: AudioBuffer) => void) {
  const f = findClip(S.selClip), buf = f?.clip.bufferId ? buffers.get(f.clip.bufferId) : undefined;
  if (!f || !buf) return;
  const out = new AudioBuffer({ length: buf.length, numberOfChannels: buf.numberOfChannels, sampleRate: buf.sampleRate });
  for (let c = 0; c < buf.numberOfChannels; c++) fn(buf.getChannelData(c), out.getChannelData(c));
  const id = uid(); addBuffer(id, out); f.clip.bufferId = id;
  after?.(f.clip, out); commit();
}
export function reverseClip() {
  rewriteClip((a, b) => { for (let i = 0, n = a.length; i < n; i++) b[i] = a[n - 1 - i]; }, (clip, buf) => {
    const lenSec = clip.len * srcStep(S.project, clip);
    clip.offset = Math.max(0, buf.duration - clip.offset - lenSec); delete clip.takes; delete clip.take; delete clip.comp;
    [clip.fadeIn, clip.fadeOut] = [clip.fadeOut ?? 0, clip.fadeIn ?? 0];
  });
}
/** Amène la crête du son à -0,3 dB. */
export function normalizeClip() {
  const f = findClip(S.selClip), buf = f?.clip.bufferId ? buffers.get(f.clip.bufferId) : undefined;
  if (!f || !buf) return;
  let pk = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) pk = Math.max(pk, Math.abs(d[i])); }
  if (pk < 1e-5) return toast(t('toast.silent'), 'error');
  const k = 0.966 / pk;
  rewriteClip((a, b) => { for (let i = 0; i < a.length; i++) b[i] = a[i] * k; }, clip => { clip.gain = 1; });
  toast(t('toast.normalized', (20 * Math.log10(k)).toFixed(1)));
}
/**
 * Le clip audio suit le tempo du morceau (V17) : en l'activant, on considère qu'il tombe juste au tempo actuel
 * (à l'endroit du clip). Sa longueur en mesures ne change pas.
 */
export function toggleWarp() {
  const f = findClip(S.selClip);
  if (!f || f.track.type !== 'audio') return;
  const c = f.clip;
  if (c.warp) c.warp = false;
  else { c.warp = true; c.srcBpm ??= bpmAt(S.project, c.start); }
  commit(); toast(t(c.warp ? 'warp.on' : 'warp.off', Math.round(c.srcBpm ?? S.project.bpm)));
}
/** Tempo d'origine du son (une boucle à 90 BPM dans un morceau à 120) : la longueur en pas suit, bornée à la fin du son. */
export function setWarpBpm(v: number) {
  const f = findClip(S.selClip), buf = f?.clip.bufferId ? buffers.get(f.clip.bufferId) : undefined;
  if (!f || !buf || !(v >= 20 && v <= 400)) return;
  const c = f.clip, old = c.srcBpm ?? bpmAt(S.project, c.start);
  c.warp = true; c.srcBpm = Math.round(v * 100) / 100;
  c.len = Math.max(1, Math.min(Math.round(c.len * c.srcBpm / old), Math.ceil((buf.duration - c.offset) / (15 / c.srcBpm) - 1e-6)));
  c.fadeIn = Math.min(c.fadeIn ?? 0, c.len); c.fadeOut = Math.min(c.fadeOut ?? 0, c.len);
  commit();
}
/** Étire le son du clip (`pct` % de sa durée) et le transpose de `semis` demi-tons, l'un sans toucher à l'autre. */
export function stretchClip(pct: number, semis: number) {
  const f = findClip(S.selClip), buf = f?.clip.bufferId ? buffers.get(f.clip.bufferId) : undefined;
  if (!f || !buf || (pct === 100 && !semis)) return;
  const r = pct / 100, clip = f.clip, id = uid(), out = stretchBuffer(buf, r, semis);
  addBuffer(id, out); clip.bufferId = id;
  clip.offset *= r; if (clip.takes) clip.takes = clip.takes.map(x => x * r); clip.len = Math.max(1, Math.min(Math.round(clip.len * r), Math.ceil((out.duration - clip.offset) / stepDur(S.project.bpm))));
  clip.fadeIn = Math.round((clip.fadeIn ?? 0) * r); clip.fadeOut = Math.round((clip.fadeOut ?? 0) * r);
  if (clip.comp) { clip.comp = clip.comp.map(x => ({ s: Math.round(x.s * r), take: x.take })); compSlice(clip, 0, clip.len); }
  if (clip.xfade) clip.xfade = Math.round(clip.xfade * r);
  S.stretch = { clip: '', pct: 100, semis: 0 };
  commit(); toast(t('toast.stretched'));
}
/**
 * Découpe le son du clip en tranches, les charge sur les pads d'une nouvelle piste batterie
 * et écrit le motif qui rejoue la boucle d'origine. `mode` : nombre de tranches égales, ou 0 pour suivre les attaques.
 */
export function chopClip(mode: number) {
  const f = findClip(S.selClip), buf = f?.clip.bufferId ? buffers.get(f.clip.bufferId) : undefined;
  if (!f || !buf) return;
  const clip = f.clip, sr = buf.sampleRate, dur = stepDur(S.project.bpm);
  const a = Math.floor(clip.offset * sr), b = Math.min(buf.length, Math.floor((clip.offset + clip.len * dur) * sr)), n = b - a;
  if (n < sr * 0.05) return toast(t('toast.tooShort'), 'error');
  let cuts: number[];
  if (mode > 0) cuts = Array.from({ length: mode }, (_, i) => Math.round(i * n / mode));
  else {
    // Attaques : hausses brusques d'énergie, au moins 60 ms entre deux, les plus fortes d'abord.
    const hop = 256, d = buf.getChannelData(0), env: number[] = [];
    for (let i = a; i + hop <= b; i += hop) { let e = 0; for (let j = 0; j < hop; j++) e += d[i + j] * d[i + j]; env.push(Math.sqrt(e / hop)); }
    const max = Math.max(...env, 1e-9), cand: { i: number; r: number }[] = [];
    for (let i = 2; i < env.length; i++) { const r = env[i] - Math.max(env[i - 1], env[i - 2]); if (r > max * 0.12) cand.push({ i, r }); }
    cand.sort((x, y) => y.r - x.r);
    const gap = Math.ceil(0.06 * sr / hop), picked: number[] = [0];
    for (const c of cand) { if (picked.length >= NPADS) break; if (picked.every(p => Math.abs(p - c.i) >= gap)) picked.push(c.i); }
    cuts = picked.sort((x, y) => x - y).map(i => Math.max(0, i * hop - 64));
  }
  const tr = newTrack('drums', S.project.tracks.filter(x => x.type === 'drums').length + 1);
  tr.name = (clip.name + ' ' + t('chop.suffix')).slice(0, 40);
  const patLen = Math.max(1, Math.min(128, clip.len)), pat: Clip = { id: uid(), name: clip.name, start: clip.start, len: clip.len, offset: 0, patLen, drums: emptyDrums(patLen) };
  cuts.forEach((c0, i) => {
    const c1 = cuts[i + 1] ?? n, len = Math.max(1, c1 - c0), id = uid(), fade = Math.min(96, len >> 1);
    const out = new AudioBuffer({ length: len, numberOfChannels: buf.numberOfChannels, sampleRate: sr });
    for (let ch = 0; ch < buf.numberOfChannels; ch++) {
      const o = out.getChannelData(ch); o.set(buf.getChannelData(ch).subarray(a + c0, a + c0 + len));
      for (let k = 0; k < fade; k++) { o[k] *= k / fade; o[len - 1 - k] *= k / fade; }
    }
    addBuffer(id, out); tr.pads![i] = { bufferId: id, name: `${t('chop.slice')} ${i + 1}` };
    const step = Math.min(patLen - 1, Math.round(c0 / sr / dur));
    if (!pat.drums![i][step]) pat.drums![i][step] = 1;
  });
  tr.clips.push(pat); S.project.tracks.push(tr); f.track.mute = true;
  S.selTrack = tr.id; S.selClip = pat.id; S.drumView = 'pads';
  commit(); toast(t('toast.chopped', cuts.length));
}
// Copier / coller de clips dans l'arrangement
let clipCopy: { clip: Clip; type: TrackType } | null = null;
export function copyClip(): boolean {
  const f = findClip(S.selClip);
  if (!f) return false;
  clipCopy = { clip: JSON.parse(JSON.stringify(f.clip)), type: f.track.type }; toast(t('toast.clipCopied'));
  return true;
}
export function pasteClip(): boolean {
  if (!clipCopy) return false;
  const sel = findTrack(S.selTrack), tr = sel?.type === clipCopy.type ? sel : S.project.tracks.find(x => x.type === clipCopy!.type);
  if (!tr) { toast(t('toast.noTrackFor'), 'error'); return true; }
  const c: Clip = JSON.parse(JSON.stringify(clipCopy.clip));
  c.id = uid(); c.start = Math.round(engine.currentStep() / S.snap) * S.snap;
  tr.clips.push(c); S.selTrack = tr.id; S.selClip = c.id; commit();
  return true;
}
export function transposeClip(semis: number) {
  const f = findClip(S.selClip);
  if (!f?.clip.notes?.length) return;
  if (f.clip.notes.some(n => n.p + semis < 24 || n.p + semis > 96)) return toast(t('toast.range'), 'error');
  for (const n of f.clip.notes) n.p += semis;
  commit();
}
/** Clips sélectionnés : le clip courant et ceux ajoutés par Maj+clic. */
export function selectedClips(): { track: Track; clip: Clip }[] {
  const ids = new Set([S.selClip, ...S.selMore]);
  return S.project.tracks.flatMap(track => track.clips.filter(c => ids.has(c.id)).map(clip => ({ track, clip })));
}
export function deleteClip() {
  const sel = selectedClips();
  if (!sel.length) return;
  for (const { track, clip } of sel) track.clips = track.clips.filter(c => c !== clip);
  S.selClip = ''; S.selMore.clear(); commit();
}
export function duplicateClip() {
  const sel = selectedClips();
  if (!sel.length) return;
  // Les copies se placent juste après la fin du groupe sélectionné.
  const shift = Math.max(...sel.map(x => x.clip.start + x.clip.len)) - Math.min(...sel.map(x => x.clip.start));
  S.selMore.clear();
  for (const { track, clip } of sel) {
    const c: Clip = JSON.parse(JSON.stringify(clip));
    c.id = uid(); c.start = clip.start + shift; track.clips.push(c);
    if (clip.id === S.selClip) S.selClip = c.id; else S.selMore.add(c.id);
  }
  commit();
}
/** Décale le motif de batterie d'un pas (il boucle sur lui-même). */
export function shiftPattern(d: -1 | 1) {
  const c = findClip(S.selClip)?.clip;
  if (!c?.drums) return;
  c.drums = c.drums.map(row => { const n = row.length; return row.map((_, i) => row[((i - d) % n + n) % n]); }); commit();
}
/** Double la longueur du motif en le recopiant, pour pouvoir varier la seconde moitié. */
export function doublePattern() {
  const c = findClip(S.selClip)?.clip;
  if (!c?.drums) return;
  if (c.patLen! * 2 > 128) return toast(t('toast.patMax'), 'error');
  c.drums = c.drums.map(row => [...row, ...row]); c.patLen = c.patLen! * 2; c.len = Math.max(c.len, c.patLen);
  commit();
}
/** Décale le point de lecture d'un clip audio dans son son (toutes ses prises suivent). */
function shiftAudio(c: Clip, sec: number) { c.offset += sec; if (c.takes) c.takes = c.takes.map(x => x + sec); }
/** Libère la zone [a, b[ d'une piste audio : les clips qui la recouvrent sont rognés, coupés en deux ou supprimés. */
export function clearZone(tr: Track, a: number, b: number) {
  const dur = stepDur(S.project.bpm), out: Clip[] = [];
  for (const c of tr.clips) {
    const end = c.start + c.len;
    if (end <= a || c.start >= b) { out.push(c); continue; }
    if (c.start < a) { const left: Clip = JSON.parse(JSON.stringify(c)); left.id = c.id; left.len = a - c.start; left.fadeOut = 0; compSlice(left, 0, left.len); out.push(left); }
    if (end > b) { const right: Clip = JSON.parse(JSON.stringify(c)); right.id = c.start < a ? uid() : c.id; shiftAudio(right, (b - c.start) * dur); right.start = b; right.len = end - b; right.fadeIn = 0; delete right.xfade; compSlice(right, b - c.start, c.len); out.push(right); }
  }
  tr.clips = out;
}
/** Choisit la prise jouée par un clip enregistré en boucle. */
export function chooseTake(i: number) {
  const c = findClip(S.selClip)?.clip;
  if (!c?.takes || i < 0 || i >= c.takes.length) return;
  c.take = i; c.offset = c.takes[i]; delete c.comp; commit();
}
/** Comping (V19) : la prise `i` est jouée sur la portion [a, b[ du clip ouvert (en pas depuis son début). */
export function compTake(i: number, a: number, b: number) {
  const c = findClip(S.selClip)?.clip;
  if (!c?.takes || i < 0 || i >= c.takes.length) return;
  compSet(c, Math.max(0, a), Math.min(c.len, b), i); commit();
}
/** Fondu enchaîné (V19) entre le clip ouvert et le clip audio qui finit juste où il commence, en pas (0 = aucun). */
export function setXfade(steps: number) {
  const c = findClip(S.selClip)?.clip;
  if (!c) return;
  if (steps > 0) c.xfade = steps; else delete c.xfade;
}
/** Clip audio de la même piste qui se termine exactement là où commence le clip `c`. */
export function leftNeighbour(tr: Track, c: Clip) { return tr.clips.find(x => x !== c && Math.abs(x.start + x.len - c.start) < 1e-6); }
/** Ramène le son du clip vers les notes de la gamme du projet (toutes les notes si la gamme est libre). */
export function tuneClip(amount: number) {
  const f = findClip(S.selClip), buf = f?.clip.bufferId ? buffers.get(f.clip.bufferId) : undefined;
  if (!f || !buf || amount <= 0) return;
  const p = S.project, r = tuneBuffer(buf, amount, m => inScale(p, m));
  if (r.voiced < 0.02) return toast(t('toast.noPitch'), 'error');
  const id = uid(); addBuffer(id, r.out); f.clip.bufferId = id;
  commit(); toast(t('toast.tuned', Math.round(r.meanCents)));
}
export function splitClip() { splitClipAt(Math.round(engine.currentStep())); }
/** Scinde le clip sélectionné au pas `at` (la tête de lecture pour Ctrl+E, l'endroit visé pour « Scinder ici »). */
export function splitClipAt(at: number) {
  const f = findClip(S.selClip);
  if (!f) return toast(t('toast.selectClip'));
  const { clip, track } = f;
  if (at <= clip.start || at >= clip.start + clip.len) return toast(t('toast.playheadInside'));
  const right: Clip = JSON.parse(JSON.stringify(clip));
  right.id = uid(); right.start = at; right.len = clip.start + clip.len - at;
  if (track.type === 'audio') shiftAudio(right, (at - clip.start) * srcStep(S.project, clip));
  else right.offset = (clip.offset + at - clip.start) % clip.patLen!;
  // Comping : chaque moitié garde les portions qui la concernent ; la moitié droite n'a pas de fondu enchaîné à elle.
  delete right.xfade; compSlice(right, at - clip.start, clip.len);
  clip.len = at - clip.start; compSlice(clip, 0, clip.len);
  track.clips.push(right); commit();
}
export function addAudioClip(buf: AudioBuffer, name: string, trackId?: string, start?: number, offset = 0, extra: Partial<Clip> = {}, prepare?: (tr: Track) => void) {
  const id = uid(); addBuffer(id, buf);
  let tr = trackId ? findTrack(trackId) : findTrack(S.selTrack);
  if (!tr || tr.type !== 'audio') tr = S.project.tracks.find(x => x.type === 'audio' && !x.clips.length);
  if (!tr) { tr = newTrack('audio', S.project.tracks.filter(x => x.type === 'audio').length + 1); S.project.tracks.push(tr); }
  const st = start ?? Math.round(engine.currentStep());
  const clip: Clip = {
    id: uid(), name, start: st, offset, bufferId: id, gain: 1,
    len: Math.max(1, Math.ceil((buf.duration - offset) / stepDur(S.project.bpm))), ...extra,
  };
  prepare?.(tr);
  tr.clips.push(clip); S.selTrack = tr.id; S.selClip = clip.id;
  commit();
}
const isAudio = (f: File) => f.type.startsWith('audio/') || /\.(wav|mp3|ogg|flac|m4a|aac|aiff?)$/i.test(f.name);
export const audioFiles = (list?: FileList | null) => [...(list ?? [])].filter(isAudio);
const baseName = (f: File) => f.name.replace(/\.[^.]+$/, '');
export async function importFiles(files: Iterable<File>, trackId?: string, start?: number) {
  for (const f of files) {
    try {
      addAudioClip(await engine.decode(await f.arrayBuffer()), baseName(f), trackId, start);
      toast(t('toast.imported', f.name));
    } catch { toast(t('toast.badAudio', f.name), 'error'); }
  }
}
/** Charge un fichier comme sample (pad ou sampler) et renvoie son identifiant. */
export async function loadSample(f: File): Promise<{ id: string; name: string } | null> {
  try {
    const id = uid(); addBuffer(id, await engine.decode(await f.arrayBuffer()));
    return { id, name: baseName(f) };
  } catch { toast(t('toast.badAudio', f.name), 'error'); return null; }
}
// Sélecteurs de fichiers partagés
let onAudio: ((files: File[]) => void) | null = null;
export function pickFiles(cb: (files: File[]) => void, multiple = false) {
  const inp = document.getElementById('fAudio') as HTMLInputElement;
  onAudio = cb; inp.multiple = multiple; inp.click();
}
export function filesPicked(inp: HTMLInputElement) {
  const files = [...(inp.files ?? [])]; inp.value = '';
  if (files.length) onAudio?.(files);
  onAudio = null;
}
export const pickAudio = (trackId?: string, start?: number) => pickFiles(fs => importFiles(fs, trackId, start), true);
