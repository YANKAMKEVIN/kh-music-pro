/** V20 — basse et piano → notes : deux analyses (« Basse → notes », « Piano → notes ») inscrites dans la fenêtre « Du son à la séquence ».
 *  Le calcul (voir `core.ts`) tourne dans un Worker ; ici : préparation du son, réglages, résumé. */
import { addTexts, t } from '../../i18n';
import { BAR } from '../../types';
import { S } from '../../store';
import { h, slider } from '../../ui/dom';
import { noteName } from '../../ui/editor';
import { registerAnalyzer } from '../registry';
import type { Analyzer, Ctx, Part } from '../types';
import { DEFAULTS, SR_HI, SR_LO, chordAt, range, transcribeBass, transcribePiano, type PolyNote, type PolyParams } from './core';
import PolyWorker from './worker?worker&inline';
import type { PolyJob } from './worker';

addTexts({
  'po.bass': ['Basse → notes', 'Bass → notes', 'Bajo → notas'],
  'po.bassHelp': ['Retrouve la ligne de basse, une note à la fois (de Mi1 à Sol4). Utilise la piste de basse séparée si elle existe.', 'Finds the bass line, one note at a time (E1 to G4). Uses the separated bass track if there is one.', 'Encuentra la línea de bajo, una nota a la vez (de Mi1 a Sol4). Usa la pista de bajo separada si existe.'],
  'po.piano': ['Piano → notes', 'Piano → notes', 'Piano → notas'],
  'po.pianoHelp': ['Retrouve les notes et les accords du piano ou des claviers. Utilise la piste « autres instruments » séparée si elle existe.', 'Finds the notes and chords of the piano or keyboards. Uses the separated “other instruments” track if there is one.', 'Encuentra las notas y acordes del piano o teclados. Usa la pista «otros instrumentos» separada si existe.'],
  'po.bassPart': ['Basse', 'Bass', 'Bajo'],
  'po.pianoPart': ['Piano', 'Piano', 'Piano'],
  'po.found': ['{0} notes, de {1} à {2}', '{0} notes, from {1} to {2}', '{0} notas, de {1} a {2}'],
  'po.none': ['Aucune note trouvée : monte la sensibilité puis relance.', 'No notes found: raise the sensitivity and run again.', 'No se encontraron notas: sube la sensibilidad y vuelve a iniciar.'],
  'po.chords': ['Accords par mesure', 'Chords by bar', 'Acordes por compás'],
  'po.bar': ['Mesure {0} : {1}', 'Bar {0}: {1}', 'Compás {0}: {1}'],
  'po.more': ['… et {0} mesures de plus', '… and {0} more bars', '… y {0} compases más'],
  'po.sens': ['Sensibilité', 'Sensitivity', 'Sensibilidad'],
  'po.minDur': ['Note la plus courte', 'Shortest note', 'Nota más corta'],
  'po.rerun': ['Change un réglage puis appuie sur Lancer pour refaire l\'analyse.', 'Change a setting, then press Run to analyse again.', 'Cambia un ajuste y pulsa Iniciar para analizar de nuevo.'],
  'po.whole': ['Pas de piste séparée : analyse du son entier (moins précis).', 'No separated track: analysing the whole sound (less accurate).', 'Sin pista separada: análisis del sonido completo (menos preciso).'],
});

type Kind = 'bass' | 'piano';
/** Réglages de chaque analyse, gardés tant que la page est ouverte. */
export const settings: Record<Kind, PolyParams> = { bass: { ...DEFAULTS }, piano: { ...DEFAULTS } };
/** Dernière analyse : le son venait-il d'une piste séparée, et le calcul a-t-il tourné dans un Worker (QA). */
export const lastRun: Record<Kind, { stem: boolean; worker: boolean; ms: number } | null> = { bass: null, piano: null };

/** Son mono au taux voulu (rééchantillonnage du navigateur), passe-bas en option. */
async function prepare(buf: AudioBuffer, sr: number, lowpass = 0): Promise<Float32Array> {
  const len = Math.max(1, Math.ceil(buf.duration * sr));
  const oc = new OfflineAudioContext(1, len, sr);
  const src = oc.createBufferSource(); src.buffer = buf;
  let node: AudioNode = src;
  if (lowpass) for (let i = 0; i < 2; i++) { const f = oc.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lowpass; f.Q.value = 0.7; node.connect(f); node = f; }
  node.connect(oc.destination); src.start();
  return (await oc.startRendering()).getChannelData(0);
}

function work(job: PolyJob, progress: (f: number) => void, signal: AbortSignal, kind: Kind): Promise<PolyNote[]> {
  return new Promise((ok, ko) => {
    let w: Worker;
    try { w = new PolyWorker(); }
    catch {
      // pas de Worker possible ici : calcul sur place (l'interface se fige le temps du calcul)
      lastRun[kind]!.worker = false;
      try { ok(job.kind === 'bass' ? transcribeBass(job.lo, job.params, progress) : transcribePiano(job.hi!, job.lo, job.params, progress, job.keepFrom)); }
      catch (e) { ko(e); }
      return;
    }
    const stop = () => { w.terminate(); ko(new DOMException('annulé', 'AbortError')); };
    signal.addEventListener('abort', stop, { once: true });
    w.onmessage = (e: MessageEvent<{ progress?: number; notes?: PolyNote[]; error?: string }>) => {
      const d = e.data;
      if (d.progress !== undefined) { progress(d.progress); return; }
      signal.removeEventListener('abort', stop); w.terminate();
      if (d.error) ko(new Error(d.error)); else ok(d.notes || []);
    };
    w.onerror = e => { signal.removeEventListener('abort', stop); w.terminate(); ko(new Error(e.message || 'worker')); };
    w.postMessage(job, [job.lo.buffer, ...(job.hi ? [job.hi.buffer] : [])]);
  });
}

const stemOf = (k: Kind) => k === 'bass' ? 'bass' as const : 'other' as const;

async function run(kind: Kind, ctx: Ctx, progress: (f: number) => void, signal: AbortSignal) {
  const t0 = performance.now();
  const stem = !!ctx.result.stems?.[stemOf(kind)];
  const buf = ctx.input(stemOf(kind));
  lastRun[kind] = { stem, worker: true, ms: 0 };
  progress(0.02);
  const lo = await prepare(buf, SR_LO, kind === 'bass' ? 600 : 2400);
  const hi = kind === 'piano' ? await prepare(buf, SR_HI) : null;
  if (signal.aborted) throw new DOMException('annulé', 'AbortError');
  progress(0.08);
  // sans piste séparée, le grave du mélange appartient à la basse : le piano commence au la 2
  const job: PolyJob = { kind, lo, hi, params: { ...settings[kind] }, keepFrom: stem ? 33 : 45 };
  const notes = await work(job, f => progress(0.08 + 0.92 * f), signal, kind);
  const part: Part = kind === 'bass'
    ? { id: 'bass', kind: 'bass', name: t('po.bassPart'), notes, preset: 'r_ebass' }
    : { id: 'piano', kind: 'piano', name: t('po.pianoPart'), notes, preset: 'r_piano' };
  ctx.result.parts = ctx.result.parts.filter(p => p.id !== part.id);
  ctx.result.parts.push(part);
  lastRun[kind]!.ms = Math.round(performance.now() - t0);
}

/** Nom d'accord dans la langue choisie : « La m », « Do 7 » / « Am », « C7 ». */
export function chordName(c: { root: number; q: string }) {
  const r = noteName(60 + c.root).replace(/-?\d+$/, '');
  return /^[A-G]/.test(r) ? r + c.q : r + (c.q ? ' ' + c.q : '');
}

/** Accords de chaque mesure, calés sur le tempo trouvé (ou celui du morceau). */
export function chordsByBar(ctx: Ctx, notes: PolyNote[]) {
  const bpm = ctx.result.bpm || S.project.bpm, off = ctx.result.beatOffset || 0, bar = BAR * 15 / bpm;
  const end = notes.reduce((e, n) => Math.max(e, n.t + n.d), 0);
  const out: string[] = [];
  for (let i = 0; off + i * bar < end; i++) { const c = chordAt(notes, off + i * bar, off + (i + 1) * bar); out.push(c ? chordName(c) : '–'); }
  return out;
}

function view(kind: Kind, ctx: Ctx): HTMLElement | null {
  const part = ctx.result.parts.find(p => p.id === kind);
  const s = settings[kind];
  const box = h('div', { class: 'po-view', data: { po: kind } });
  if (part) {
    const r = range(part.notes);
    box.append(h('p', { role: 'status', data: { role: 'summary' } }, r ? t('po.found', part.notes.length, noteName(r[0]), noteName(r[1])) : t('po.none')));
    if (lastRun[kind] && !lastRun[kind]!.stem) box.append(h('p', { class: 'tip' }, t('po.whole')));
    if (kind === 'piano' && part.notes.length) {
      const bars = chordsByBar(ctx, part.notes), MAX = 16;
      box.append(h('h4', { style: 'margin:8px 0 4px' }, t('po.chords')),
        h('ol', { class: 'po-chords', 'aria-label': t('po.chords'), style: 'display:flex;flex-wrap:wrap;gap:6px;list-style:none;padding:0;margin:0' },
          ...bars.slice(0, MAX).map((c, i) => h('li', { 'aria-label': t('po.bar', i + 1, c), style: 'border:1px solid var(--line);border-radius:8px;padding:4px 8px;min-width:44px;text-align:center' },
            h('small', { 'aria-hidden': 'true', style: 'opacity:.6;margin-right:4px' }, String(i + 1)), c))),
        bars.length > MAX ? h('p', { class: 'tip' }, t('po.more', bars.length - MAX)) : '');
    }
  }
  box.append(
    h('div', { class: 'fxfoot' },
      slider(t('po.sens'), 0, 100, 5, Math.round(s.sens * 100), v => { s.sens = v / 100; }, v => v + ' %', 'po-sens', true, 50),
      slider(t('po.minDur'), 30, 300, 10, Math.round(s.minDur * 1000), v => { s.minDur = v / 1000; }, v => v + ' ms', 'po-min', true, 60)),
    h('p', { class: 'tip' }, t('po.rerun')));
  return box;
}

function make(kind: Kind, order: number) {
  const a: Analyzer = {
    id: kind === 'bass' ? 'bass-notes' : 'piano-notes', order,
    title: () => t(kind === 'bass' ? 'po.bass' : 'po.piano'),
    help: () => t(kind === 'bass' ? 'po.bassHelp' : 'po.pianoHelp'),
    run: (ctx, progress, signal) => run(kind, ctx, progress, signal),
    view: ctx => view(kind, ctx),
  };
  /** pour la QA : réglages, dernière analyse, accords par mesure */
  return Object.assign(a, { kind, po: { settings: settings[kind], lastRun: () => lastRun[kind], chordsByBar, chordName, chordAt } });
}

export const bassAnalyzer = make('bass', 40), pianoAnalyzer = make('piano', 41);
registerAnalyzer(bassAnalyzer);
registerAnalyzer(pianoAnalyzer);
