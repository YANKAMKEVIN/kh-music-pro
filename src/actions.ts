import { encodeWav, engine, renderOffline } from './audio/engine';
import { t } from './i18n';
import { allNotesOff } from './input';
import { S, addBuffer, buffers, commit, findClip, findTrack, idbClear, loadProjectFile, resetHistory, serializeProject } from './store';
import { exportMidi, importMidi, zip } from './files';
import { BAR, Clip, Track, TrackType, blankProject, contentEnd, newTrack, stepDur, uid } from './types';
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

export function saveFile() {
  download(new Blob([serializeProject()], { type: 'application/json' }), safeName() + '.khm');
  toast(t('toast.saved'));
}

export async function openFile(f: File) {
  try { engine.stop(); loadProjectFile(await f.text()); toast(t('toast.opened')); }
  catch { toast(t('toast.badProject'), 'error'); }
}

export function newProject() {
  if (!confirm(t('confirm.new'))) return;
  engine.stop(); engine.pos = 0;
  buffers.clear(); idbClear().catch(() => { });
  S.project = blankProject(); S.selTrack = S.project.tracks[0].id; S.selClip = '';
  resetHistory(); commit();
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
