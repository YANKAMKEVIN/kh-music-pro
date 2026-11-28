import { engine, renderOffline } from './audio/engine';
import { t } from './i18n';
import { allNotesOff } from './input';
import { addBuffer, commit, emit, findClip, findTrack, S, undo } from './store';
import { BAR, bpmAt, durAt, newTrack, stepDur, timeOf, Track, TrackType, uid } from './types';
import { ask, toast } from './ui/dom';
import { addAudioClip, clearZone } from './actions/clips';
export * from './actions/export';
export * from './actions/notes';
export * from './actions/fx';
export * from './actions/clips';
export * from './actions/project-files';

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
  S.project.tracks = S.project.tracks.filter(x => x.id !== id);
  if (S.selTrack === id) { S.selTrack = ''; S.selClip = ''; }
  commit();
  // Pas de question avant : la piste part tout de suite, et le message propose de la ramener (comme Ctrl+Z).
  const after = JSON.stringify(S.project);
  toast(t('toast.trackDeleted', tr.name), 'info', { action: { label: t('dlg.undo'), fn: () => { if (JSON.stringify(S.project) === after) undo(); else toast(t('toast.undoLate')); } } });
}
/**
 * Geler une piste (V17) : son rendu (instrument, égaliseur, effets, automation) devient un clip audio sur une nouvelle piste
 * juste en dessous, qui reprend le volume, le panoramique, les envois et la sortie ; la piste d'origine est coupée et gardée.
 * Le rendu passe par le même chemin que l'export. Utile pour alléger un gros projet, ou pour retravailler le son en audio.
 */
export async function freezeTrack(id: string) {
  const tr = findTrack(id), p = S.project;
  if (!tr || tr.type === 'audio' || tr.frozen || !tr.clips.length) return;
  toast(t('frz.working', tr.name));
  const copy: Track = JSON.parse(JSON.stringify(tr)), moved: NonNullable<Track['auto']> = {};
  // Le rendu s'arrête avant le fader : volume, panoramique, envois, sortie et sidechain restent réglables sur la piste audio.
  Object.assign(copy, { vol: 1, pan: 0, rev: 0, dly: 0, out: '', duck: 0, mute: false, solo: false, sends: [] }); delete copy.sc;
  for (const k of ['vol', 'pan', 'rev', 'dly'] as const) if (copy.auto?.[k]) { moved[k] = copy.auto[k]; delete copy.auto[k]; }
  let buf: AudioBuffer;
  // Le rendu s'arrête aussi avant le général : la piste gelée repasse ensuite par son volume, sa chaîne et son limiteur,
  // qui ne s'appliquent donc qu'une fois (avant, un morceau gelé sonnait plus bas, 0,9 dB avec le général à 90 %).
  try { buf = await renderOffline({ ...p, tracks: [copy], loop: false }, false, { stem: true }); }
  catch { return toast(t('frz.fail'), 'error'); }
  if (!S.project.tracks.includes(tr)) return;            // piste supprimée pendant le rendu
  const bid = uid(); addBuffer(bid, buf);
  let len = 0; while (timeOf(S.project, len) < buf.duration && len < 100000) len++;
  const at: Track = newTrack('audio', p.tracks.filter(x => x.type === 'audio').length + 1);
  Object.assign(at, { name: `${tr.name} ❄`, color: tr.color, vol: tr.vol, pan: tr.pan, rev: tr.rev, dly: tr.dly, out: tr.out, duck: tr.duck, sc: tr.sc, sends: tr.sends ? JSON.parse(JSON.stringify(tr.sends)) : undefined, frozenFrom: tr.id, auto: Object.keys(moved).length ? moved : undefined });
  // Les pistes que celle-ci faisait pomper suivent désormais sa version audio (la piste gelée ne joue plus).
  for (const x of p.tracks) if (x.sc === tr.id) x.sc = at.id;
  at.clips = [{ id: uid(), name: `${tr.name} ❄`, start: 0, len: Math.max(1, len), offset: 0, bufferId: bid, gain: 1 }];
  tr.frozen = true; tr.mute = true;
  p.tracks.splice(p.tracks.indexOf(tr) + 1, 0, at);
  S.selTrack = at.id; S.selClip = at.clips[0].id;
  commit(); toast(t('frz.done', tr.name));
}
/** Dégeler : la piste audio du gel disparaît, la piste d'origine revient telle qu'elle était. */
export function unfreezeTrack(id: string) {
  const tr = findTrack(id); if (!tr?.frozen) return;
  const gone = S.project.tracks.filter(x => x.frozenFrom === tr.id).map(x => x.id);
  S.project.tracks = S.project.tracks.filter(x => x.frozenFrom !== tr.id);
  for (const x of S.project.tracks) if (x.sc && gone.includes(x.sc)) x.sc = tr.id;
  tr.frozen = false; tr.mute = false; S.selTrack = tr.id; S.selClip = tr.clips[0]?.id ?? '';
  commit(); toast(t('frz.undone', tr.name));
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
/** Demande un tempo (40 à 240) ; renvoie null si la saisie est annulée ou invalide. */
async function askTempo(current: number): Promise<number | null> {
  const v = Math.round(parseFloat(((await ask(t('tempo.ask'), String(current), { mode: 'decimal' })) ?? '').replace(',', '.')) * 100) / 100;
  if (!v) return null;
  if (v < 40 || v > 240) { toast(t('tempo.range'), 'error'); return null; }
  return v;
}
/** Place un changement de tempo au début de la mesure où se trouve la tête de lecture. */
export async function addTempo() {
  const s = Math.round(engine.currentStep() / BAR) * BAR;
  if (s <= 0) return toast(t('tempo.start'));
  const v = await askTempo(bpmAt(S.project, s));
  if (!v) return;
  const p = S.project;   // relu après la question (annulation ou autre projet entre-temps)
  p.tempos = [...p.tempos.filter(m => m.s !== s), { s, bpm: v }].sort((a, b) => a.s - b.s); commit();
}
export async function editTempo(s: number) {
  const cur = S.project.tempos.find(x => x.s === s), v = cur && await askTempo(cur.bpm);
  const m = S.project.tempos.find(x => x.s === s);
  if (m && v) { m.bpm = v; commit(); }
}
/** Renomme le repère posé au pas `s`. */
export async function renameMarker(s: number) {
  const cur = S.project.markers.find(x => x.s === s), n = cur && (await ask(t('mark.rename'), cur.name))?.trim();
  const m = S.project.markers.find(x => x.s === s);
  if (m && n) { m.name = n.slice(0, 24); commit(); }
}
/** Renomme le projet (menu Projet, utile sur téléphone où le champ du nom est masqué). */
export async function renameProject() {
  const n = (await ask(t('top.pname'), S.project.name))?.trim();
  if (n) { S.project.name = n; commit(); }
}
export function removeTempo(s: number) { S.project.tempos = S.project.tempos.filter(m => m.s !== s); commit(); }
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
export async function toggleRecord() {
  if (engine.recording) { engine.stop(); return; }
  const sel = findTrack(S.selTrack), p = S.project;
  const preroll = p.countIn ? BAR * durAt(p, engine.pos) : 0;
  if (sel && sel.type !== 'audio') {
    await engine.recordMidi(sel.id, preroll);
    toast(t(sel.type === 'drums' ? 'toast.recPads' : 'toast.recNotes'));
    return;
  }
  // Punch : seule la zone de boucle est enregistrée. Boucle : une prise par tour. Sinon : une prise continue.
  const mode = p.punch ? 'punch' : p.loop ? 'loop' : 'normal';
  try {
    await engine.recordAudio((buf, start, off, m) => {
      if (!buf) return toast(t('toast.recEmpty'), 'error');
      const name = t('clip.take') + ' ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const dur = stepDur(p.bpm), ls = p.loopStart * BAR, L = p.loopLen * BAR, Lsec = L * dur;
      if (m === 'loop') {
        const avail = buf.duration - off, full = Math.floor(avail / Lsec + 1e-3), n = full + (avail - full * Lsec > Lsec / 2 ? 1 : 0);
        if (n >= 1) {
          const takes = Array.from({ length: n }, (_, k) => off + k * Lsec), pick = Math.max(0, full - 1);
          addAudioClip(buf, name, sel?.id, ls, takes[pick], { len: L, takes, take: pick }, tr => clearZone(tr, ls, ls + L));
          return toast(t('toast.takes', n));
        }
      }
      if (m === 'punch') {
        const o = off + (ls - start) * dur;
        if (o >= buf.duration - 0.05) return toast(t('toast.punchMissed'), 'error');
        addAudioClip(buf, name, sel?.id, ls, o, { len: Math.max(1, Math.min(L, Math.round((buf.duration - o) / dur))) }, tr => clearZone(tr, ls, ls + L));
        return toast(t('toast.punched'));
      }
      addAudioClip(buf, name, sel?.id, m === 'loop' ? ls : start, off);
      toast(t('toast.recDone'));
    }, preroll, mode);
    toast(t(mode === 'punch' ? 'toast.recPunch' : mode === 'loop' ? 'toast.recLoop' : 'toast.recAudio'));
  } catch { toast(t('toast.noMic'), 'error'); }
}
engine.onRecEnd = kind => { allNotesOff(); if (kind === 'midi') setTimeout(commit, 350); };
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
