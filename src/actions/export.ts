// Exports (WAV, MP3, pistes séparées, MIDI) : plage, avancement, annulation, et analyse du mixage.
import { analyze, encodeMp3, encodeWav, lastRender, renderOffline, renderProgress, RenderRange } from '../audio/engine';
import { t } from '../i18n';
import { commit, S } from '../store';
import { exportMidi, importMidi, zip } from '../files';
import { BAR, contentEnd } from '../types';
import { toast } from '../ui/dom';

export function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.hidden = true;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
const ascii = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9_-]+/g, '_') || 'x';
export const safeName = () => (S.project.name || 'project').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9_-]+/g, '_') || 'project';
/** Plage et fréquence de l'export choisies dans les options (V19). Le MIDI exporte toujours tout le morceau. */
export function exportRange(p = S.project): RenderRange {
  const e = p.exp, r: RenderRange = { tail: e.tail, rate: e.rate };
  if (e.range === 'loop') { r.from = p.loopStart * BAR; r.to = (p.loopStart + p.loopLen) * BAR; }
  else if (e.range === 'bars') { const a = Math.max(1, Math.round(e.from)), b = Math.max(a, Math.round(e.to)); r.from = (a - 1) * BAR; r.to = b * BAR; }
  return r;
}
/** Suffixe du nom de fichier : la plage exportée, pour ne pas confondre un extrait avec le morceau entier. */
function rangeName(): string {
  const e = S.project.exp, p = S.project;
  return e.range === 'loop' ? `_m${p.loopStart + 1}-${p.loopStart + p.loopLen}` : e.range === 'bars' ? `_m${Math.round(e.from)}-${Math.max(Math.round(e.from), Math.round(e.to))}` : '';
}
// ---------- Export : avancement et annulation ----------
/** Export en cours : part faite (0..1), texte court (« Piste 3 sur 12 », « Encodage… ») ; la barre du haut s'abonne par `onChange`. */
export const exportJob = { busy: false, pct: 0, label: '', onChange: () => { /* branché par ui/top.ts */ } };
let cancelJob: (() => void) | null = null;
/** Abandonne l'export en cours : rien n'est téléchargé. Le calcul déjà lancé se termine en arrière-plan et son résultat est jeté. */
export function cancelExport() { cancelJob?.(); }
/** Part faite d'un export en plusieurs rendus : `i` rendus finis sur `n`, plus la part `cur` (0..1) du rendu en cours. */
export const jobPct = (i: number, n: number, cur: number) => Math.max(0, Math.min(1, (i + Math.max(0, Math.min(1, cur))) / Math.max(1, n)));
/**
 * Mène un export : un seul à la fois, avancement suivi pendant le calcul, annulation possible à tout moment.
 * `work` reçoit `step(i, n, label)` pour annoncer le rendu qu'il commence, et `guard(promesse)` qui rend la main dès l'annulation.
 */
async function runExport(work: (step: (i: number, n: number, label?: string) => void, guard: <T>(p: Promise<T>) => Promise<T>) => Promise<void>, fail: (e: Error) => string) {
  if (exportJob.busy) return toast(t('exp.busy'));
  let i = 0, n = 1, half = false, stop!: (e: Error) => void;
  const cancelled = new Promise<never>((_, rej) => { stop = rej; }); cancelled.catch(() => { });
  cancelJob = () => stop(new Error('cancel'));
  const say = (m: string) => toast(m, 'info', { sticky: true, action: { label: t('exp.cancel'), fn: cancelExport } });
  Object.assign(exportJob, { busy: true, pct: 0, label: '' }); exportJob.onChange(); say(t('toast.rendering'));
  const timer = window.setInterval(() => {
    exportJob.pct = jobPct(i, n, renderProgress() ?? (exportJob.pct * n - i)); exportJob.onChange();
    // Une seule annonce en cours de route (mi-parcours) : la zone de statut ne doit pas parler sans arrêt.
    if (!half && n === 1 && exportJob.pct >= 0.5 && exportJob.pct < 0.95) { half = true; say(t('exp.half')); }
  }, 150);
  try {
    await work((a, b, label = '') => { i = a; n = b; exportJob.label = label; exportJob.pct = jobPct(a, b, 0); exportJob.onChange(); if (label) say(label); }, p => Promise.race([p, cancelled]));
  } catch (e) {
    if ((e as Error).message === 'cancel') toast(t('exp.cancelled')); else toast(fail(e as Error), 'error');
  } finally { clearInterval(timer); cancelJob = null; Object.assign(exportJob, { busy: false, pct: 0, label: '' }); exportJob.onChange(); }
}
const exportError = (e: Error) => e.message === 'empty' ? t('toast.emptyProject') : e.message === 'bank' ? t('toast.bankExportFail') : t('toast.exportFail');
export function exportMp3() {
  return runExport(async (step, guard) => {
    const buf = await guard(renderOffline(S.project, true, exportRange()));
    step(1, 1, t('exp.encoding'));
    download(await guard(encodeMp3(buf)), safeName() + rangeName() + '.mp3');
    toast(t('toast.mp3Exported'));
  }, exportError);
}
export function exportWav() {
  return runExport(async (_step, guard) => {
    download(encodeWav(await guard(renderOffline(S.project, true, exportRange())), S.project.exp.bits), safeName() + rangeName() + '.wav');
    toast(lastRender.wamFailed ? t('toast.exportedNoWam', lastRender.wamFailed) : t('toast.exported'), lastRender.wamFailed ? 'error' : 'info');
  }, exportError);
}
/** Une piste = un fichier WAV, tous de la même durée, réunis dans une archive ZIP. */
export async function exportStems() {
  const p = S.project;
  if (!contentEnd(p)) return toast(t('toast.emptyProject'), 'error');
  return runExport(async (step, guard) => {
    const files: { name: string; data: Uint8Array }[] = [];
    const list = p.tracks.filter(tr => tr.clips.length && !tr.mute);
    for (const [i, tr] of list.entries()) {
      step(i, list.length, t('toast.stem', i + 1, list.length));
      const solo: typeof p = { ...p, tracks: p.tracks.map(x => ({ ...x, solo: false, mute: x.id !== tr.id })) };
      const wav = encodeWav(await guard(renderOffline(solo, false, exportRange())), p.exp.bits);
      files.push({ name: `${String(i + 1).padStart(2, '0')}_${ascii(tr.name)}.wav`, data: new Uint8Array(await wav.arrayBuffer()) });
    }
    download(zip(files), safeName() + rangeName() + '_stems.zip');
    toast(t('toast.stemsDone', files.length));
  }, () => t('toast.exportFail'));
}
export function exportMidiFile() {
  const p = S.project;
  if (!p.tracks.some(tr => tr.type !== 'audio' && tr.clips.length)) return toast(t('toast.noNotes'), 'error');
  download(new Blob([exportMidi(p) as BlobPart], { type: 'audio/midi' }), safeName() + '.mid');
  toast(t('toast.midiExported'));
}
export async function importMidiFile(f: File) {
  try {
    const p = S.project, empty = !contentEnd(p), r = importMidi(await f.arrayBuffer(), empty);
    if (r.bpm && empty) { p.bpm = r.bpm; p.tempos = r.tempos; }
    // Projet vide : il prend aussi la signature du fichier (6/8, 3/4…), comme le tempo.
    if (r.sig && empty) { p.sig = r.sig.sig; p.den = r.sig.den; }
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
