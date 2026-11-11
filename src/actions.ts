import { analyze, encodeMp3, encodeWav, engine, renderOffline } from './audio/engine';
import { t } from './i18n';
import { allNotesOff } from './input';
import { S, addBuffer, buffers, commit, emit, findClip, findTrack, loadProjectFile, serializeProject } from './store';
import { stretchBuffer } from './audio/stretch';
import { exportMidi, importMidi, zip } from './files';
import { BAR, Clip, NPADS, Track, TrackType, emptyDrums, blankProject, contentEnd, newTrack, stepDur, uid } from './types';
import { toast } from './ui/dom';

function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.hidden = true;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
const ascii = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9_-]+/g, '_') || 'x';
const safeName = () => (S.project.name || 'project').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9_-]+/g, '_') || 'project';

export function addTrack(type: TrackType) {
  const n = S.project.tracks.filter(x => x.type === type).length + 1;
  const tr = newTrack(type, n);
  S.project.tracks.push(tr); S.selTrack = tr.id; S.selClip = '';
  commit();
  return tr;
}

export function deleteTrack(id: string) {
  const tr = findTrack(id);
  if (!tr) return;
  if (tr.clips.length && !confirm(t('confirm.delTrack', tr.name, tr.clips.length))) return;
  S.project.tracks = S.project.tracks.filter(x => x.id !== id);
  if (S.selTrack === id) { S.selTrack = ''; S.selClip = ''; }
  commit();
}

export function duplicateTrack(id: string) {
  const tr = findTrack(id), ts = S.project.tracks;
  if (!tr) return;
  const copy: Track = JSON.parse(JSON.stringify(tr));
  copy.id = uid(); copy.name = tr.name + ' 2'; copy.solo = false;
  for (const c of copy.clips) c.id = uid();
  ts.splice(ts.indexOf(tr) + 1, 0, copy); S.selTrack = copy.id; S.selClip = '';
  commit();
}

export function moveTrack(id: string, dir: -1 | 1) {
  const ts = S.project.tracks, i = ts.findIndex(x => x.id === id), j = i + dir;
  if (i < 0 || j < 0 || j >= ts.length) return;
  [ts[i], ts[j]] = [ts[j], ts[i]]; commit();
}

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
    const lenSec = clip.len * stepDur(S.project.bpm);
    clip.offset = Math.max(0, buf.duration - clip.offset - lenSec);
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

/** Étire le son du clip (`pct` % de sa durée) et le transpose de `semis` demi-tons, l'un sans toucher à l'autre. */
export function stretchClip(pct: number, semis: number) {
  const f = findClip(S.selClip), buf = f?.clip.bufferId ? buffers.get(f.clip.bufferId) : undefined;
  if (!f || !buf || (pct === 100 && !semis)) return;
  const r = pct / 100, clip = f.clip, id = uid(), out = stretchBuffer(buf, r, semis);
  addBuffer(id, out); clip.bufferId = id;
  clip.offset *= r; clip.len = Math.max(1, Math.min(Math.round(clip.len * r), Math.ceil((out.duration - clip.offset) / stepDur(S.project.bpm))));
  clip.fadeIn = Math.round((clip.fadeIn ?? 0) * r); clip.fadeOut = Math.round((clip.fadeOut ?? 0) * r);
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

export async function exportMp3() {
  try {
    toast(t('toast.rendering'));
    download(await encodeMp3(await renderOffline(S.project)), safeName() + '.mp3');
    toast(t('toast.mp3Exported'));
  } catch (e) { toast((e as Error).message === 'empty' ? t('toast.emptyProject') : t('toast.exportFail'), 'error'); }
}

export function addMarker() {
  const p = S.project, s = Math.round(engine.currentStep() / BAR) * BAR;
  if (p.markers.some(m => m.s === s)) return toast(t('toast.markerExists'));
  p.markers.push({ s, name: t('mark.name', p.markers.length + 1) }); p.markers.sort((a, b) => a.s - b.s); commit();
}

/** Ouvre (ou ferme) l'entrée audio pour régler le niveau et s'écouter avant d'enregistrer. */
export async function toggleInput(on: boolean) {
  if (!on) { engine.closeInput(); emit(); return; }
  try { await engine.openInput(S.inputDevice); engine.setInput(S.inputGain, S.inputMonitor); await listInputs(); }
  catch { toast(t('toast.noMic'), 'error'); }
  emit();
}
export let inputs: { id: string; label: string }[] = [];
export async function listInputs() {
  const all = await navigator.mediaDevices.enumerateDevices();
  inputs = all.filter(d => d.kind === 'audioinput' && d.deviceId).map((d, i) => ({ id: d.deviceId, label: d.label || `${t('in.device')} ${i + 1}` }));
}
export async function chooseInput(id: string) {
  S.inputDevice = id;
  if (engine.inp) await toggleInput(true); else emit();
}

export function transposeClip(semis: number) {
  const f = findClip(S.selClip);
  if (!f?.clip.notes?.length) return;
  if (f.clip.notes.some(n => n.p + semis < 24 || n.p + semis > 96)) return toast(t('toast.range'), 'error');
  for (const n of f.clip.notes) n.p += semis;
  commit();
}

export function deleteClip() {
  const f = findClip(S.selClip);
  if (!f) return;
  f.track.clips = f.track.clips.filter(c => c !== f.clip);
  S.selClip = ''; commit();
}

export function duplicateClip() {
  const f = findClip(S.selClip);
  if (!f) return;
  const c: Clip = JSON.parse(JSON.stringify(f.clip));
  c.id = uid(); c.start = f.clip.start + f.clip.len;
  f.track.clips.push(c); S.selClip = c.id; commit();
}

export function splitClip() {
  const f = findClip(S.selClip);
  if (!f) return toast(t('toast.selectClip'));
  const { clip, track } = f, at = Math.round(engine.currentStep());
  if (at <= clip.start || at >= clip.start + clip.len) return toast(t('toast.playheadInside'));
  const right: Clip = JSON.parse(JSON.stringify(clip));
  right.id = uid(); right.start = at; right.len = clip.start + clip.len - at;
  right.offset = track.type === 'audio'
    ? clip.offset + (at - clip.start) * stepDur(S.project.bpm)
    : (clip.offset + at - clip.start) % clip.patLen!;
  clip.len = at - clip.start;
  track.clips.push(right); commit();
}

export function addAudioClip(buf: AudioBuffer, name: string, trackId?: string, start?: number, offset = 0) {
  const id = uid(); addBuffer(id, buf);
  let tr = trackId ? findTrack(trackId) : findTrack(S.selTrack);
  if (!tr || tr.type !== 'audio') tr = S.project.tracks.find(x => x.type === 'audio' && !x.clips.length);
  if (!tr) { tr = newTrack('audio', S.project.tracks.filter(x => x.type === 'audio').length + 1); S.project.tracks.push(tr); }
  const st = start ?? Math.round(engine.currentStep());
  const clip: Clip = {
    id: uid(), name, start: st, offset, bufferId: id, gain: 1,
    len: Math.max(1, Math.ceil((buf.duration - offset) / stepDur(S.project.bpm))),
  };
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

export async function toggleRecord() {
  if (engine.recording) { engine.stop(); return; }
  const sel = findTrack(S.selTrack), p = S.project;
  const preroll = p.countIn ? 16 * stepDur(p.bpm) : 0;
  if (sel && sel.type !== 'audio') {
    await engine.recordMidi(sel.id, preroll);
    toast(t(sel.type === 'drums' ? 'toast.recPads' : 'toast.recNotes'));
    return;
  }
  try {
    await engine.recordAudio((buf, start, off) => {
      if (!buf) return toast(t('toast.recEmpty'), 'error');
      addAudioClip(buf, t('clip.take') + ' ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }), sel?.id, start, off);
      toast(t('toast.recDone'));
    }, preroll);
    toast(t('toast.recAudio'));
  } catch { toast(t('toast.noMic'), 'error'); }
}
engine.onRecEnd = kind => { allNotesOff(); if (kind === 'midi') setTimeout(commit, 350); };

export async function exportWav() {
  try {
    toast(t('toast.rendering'));
    download(encodeWav(await renderOffline(S.project)), safeName() + '.wav');
    toast(t('toast.exported'));
  } catch (e) { toast((e as Error).message === 'empty' ? t('toast.emptyProject') : t('toast.exportFail'), 'error'); }
}

/** Une piste = un fichier WAV, tous de la même durée, réunis dans une archive ZIP. */
export async function exportStems() {
  const p = S.project;
  if (!contentEnd(p)) return toast(t('toast.emptyProject'), 'error');
  try {
    const files: { name: string; data: Uint8Array }[] = [];
    const list = p.tracks.filter(tr => tr.clips.length && !tr.mute);
    for (const [i, tr] of list.entries()) {
      toast(t('toast.stem', i + 1, list.length));
      const solo: typeof p = { ...p, tracks: p.tracks.map(x => ({ ...x, solo: false, mute: x.id !== tr.id })) };
      const wav = encodeWav(await renderOffline(solo, false));
      files.push({ name: `${String(i + 1).padStart(2, '0')}_${ascii(tr.name)}.wav`, data: new Uint8Array(await wav.arrayBuffer()) });
    }
    download(zip(files), safeName() + '_stems.zip');
    toast(t('toast.stemsDone', files.length));
  } catch { toast(t('toast.exportFail'), 'error'); }
}

export function exportMidiFile() {
  const p = S.project;
  if (!p.tracks.some(tr => tr.type !== 'audio' && tr.clips.length)) return toast(t('toast.noNotes'), 'error');
  download(new Blob([exportMidi(p) as BlobPart], { type: 'audio/midi' }), safeName() + '.mid');
  toast(t('toast.midiExported'));
}

export async function importMidiFile(f: File) {
  try {
    const r = importMidi(await f.arrayBuffer()), p = S.project;
    if (r.bpm && !contentEnd(p)) p.bpm = r.bpm;
    p.tracks.push(...r.tracks); S.selTrack = r.tracks[0].id; S.selClip = r.tracks[0].clips[0].id;
    commit(); toast(t('toast.midiImported', r.tracks.length));
  } catch { toast(t('toast.badMidi'), 'error'); }
}

/** Mesure le volume perçu et la crête du morceau tel qu'il sera exporté. */
export async function analyzeMix(): Promise<string> {
  try {
    toast(t('toast.rendering'));
    const r = await analyze(S.project), txt = t('mix.result', Number.isFinite(r.lufs) ? r.lufs.toFixed(1) : '−∞', r.peakDb.toFixed(1));
    toast(txt); return txt;
  } catch { toast(t('toast.emptyProject'), 'error'); return ''; }
}

export function saveFile() {
  download(new Blob([serializeProject()], { type: 'application/json' }), safeName() + '.khm');
  toast(t('toast.saved'));
}

export async function openFile(f: File) {
  try { engine.stop(); loadProjectFile(await f.text()); toast(t('toast.opened')); }
  catch { toast(t('toast.badProject'), 'error'); }
}

export function setLoopToClip() {
  const f = findClip(S.selClip);
  if (!f) return;
  S.project.loop = true;
  S.project.loopStart = Math.floor(f.clip.start / BAR);
  S.project.loopLen = Math.max(1, Math.ceil((f.clip.start + f.clip.len) / BAR) - S.project.loopStart);
  commit();
}

const taps: number[] = [];
export function tapTempo() {
  const now = performance.now();
  if (taps.length && now - taps[taps.length - 1] > 2000) taps.length = 0;
  taps.push(now);
  if (taps.length < 2) return;
  if (taps.length > 6) taps.shift();
  const avg = (taps[taps.length - 1] - taps[0]) / (taps.length - 1);
  S.project.bpm = Math.max(40, Math.min(240, Math.round(60000 / avg)));
  commit();
}
