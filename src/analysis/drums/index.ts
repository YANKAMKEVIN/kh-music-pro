/** V20 — Batterie → motif : l'analyse, ses textes et son résumé dans la fenêtre « Du son à la séquence ». */
import { addTexts, t } from '../../i18n';
import { S } from '../../store';
import { BAR, KITS, Track } from '../../types';
import { h, toast } from '../../ui/dom';
import { registerAnalyzer } from '../registry';
import type { Analyzer, Ctx, FoundNote } from '../types';
import { DrumScan, detectDrums } from './dsp';
import { Grid, addDrumTrack, findLoop, fitGrid, toGridRows, toNotesGM } from './pattern';

addTexts({
  'dr.title': ['Batterie → motif', 'Drums → pattern', 'Batería → patrón'],
  'dr.help': ['Repère les coups de batterie (grosse caisse, caisse claire, charleston, cymbales, toms) et en fait une piste de batterie calée sur le tempo.', 'Finds the drum hits (kick, snare, hi-hat, cymbals, toms) and turns them into a drum track locked to the tempo.', 'Detecta los golpes de batería (bombo, caja, charles, platillos, toms) y los convierte en una pista de batería ajustada al tempo.'],
  'dr.part': ['Batterie', 'Drums', 'Batería'],
  'dr.found': ['{0} coups : {1}', '{0} hits: {1}', '{0} golpes: {1}'],
  'dr.none': ['Aucun coup de batterie trouvé.', 'No drum hits found.', 'No se encontraron golpes de batería.'],
  'dr.kick': ['grosse caisse {0}', 'kick {0}', 'bombo {0}'],
  'dr.snare': ['caisse claire {0}', 'snare {0}', 'caja {0}'],
  'dr.hatC': ['charleston fermé {0}', 'closed hi-hat {0}', 'charles cerrado {0}'],
  'dr.hatO': ['charleston ouvert {0}', 'open hi-hat {0}', 'charles abierto {0}'],
  'dr.cym': ['cymbale {0}', 'cymbal {0}', 'platillo {0}'],
  'dr.tom': ['toms {0}', 'toms {0}', 'toms {0}'],
  'dr.tempo': ['Tempo {0} BPM · {1} mesures', 'Tempo {0} BPM · {1} bars', 'Tempo {0} BPM · {1} compases'],
  'dr.swing': ['Swing trouvé : {0} %', 'Swing found: {0}%', 'Swing detectado: {0} %'],
  'dr.loop': ['Repérer la mesure qui se répète (motif en boucle)', 'Find the repeating bar (looped pattern)', 'Detectar el compás que se repite (patrón en bucle)'],
  'dr.loopInfo': ['Motif de {0} mesure(s), présent dans {1} % du morceau', '{0}-bar pattern, heard in {1}% of the song', 'Patrón de {0} compás(es), presente en el {1} % de la canción'],
  'dr.useSwing': ['Appliquer ce swing au morceau', 'Apply this swing to the song', 'Aplicar este swing a la canción'],
  'dr.kit': ['Kit', 'Kit', 'Kit'],
  'dr.add': ['Ajouter en piste de batterie', 'Add as a drum track', 'Añadir como pista de batería'],
  'dr.added': ['Piste de batterie « {0} » ajoutée.', 'Drum track “{0}” added.', 'Pista de batería «{0}» añadida.'],
});

/** Repérage dans un Worker (code de `detectDrums` recopié dans un blob) ; repli sur le fil principal si le Worker est refusé. */
function scan(x: Float32Array, sr: number, progress: (f: number) => void, signal: AbortSignal): Promise<DrumScan> {
  return new Promise((ok, ko) => {
    if (signal.aborted) return ko(new Error('aborted'));
    let w: Worker | null = null, url = '';
    try {
      url = URL.createObjectURL(new Blob([`const detect = (${detectDrums.toString()});\nonmessage = e => { const r = detect(e.data.x, e.data.sr, f => postMessage({ f })); postMessage({ r }); };`], { type: 'text/javascript' }));
      w = new Worker(url);
    } catch { w = null; }
    const done = () => { w?.terminate(); if (url) URL.revokeObjectURL(url); };
    signal.addEventListener('abort', () => { done(); ko(new Error('aborted')); }, { once: true });
    const local = () => { try { ok(detectDrums(x, sr, progress)); } catch (e) { ko(e); } };
    if (!w) return void setTimeout(local, 0);
    w.onmessage = e => { if (e.data.f !== undefined) progress(e.data.f); else { done(); ok(e.data.r); } };
    w.onerror = ev => { ev.preventDefault(); done(); if (!signal.aborted) local(); };
    w.postMessage({ x, sr }, [x.buffer]);
  });
}

/** Ce que la dernière analyse a trouvé (gardé pour le résumé, le bouton d'ajout et la QA). */
interface Found { notes: FoundNote[]; grid: Grid; bars: number; loop: ReturnType<typeof findLoop>; scan: DrumScan }
let found: Found | null = null, foundFor: Ctx['source'] = null;
const ui = { loop: false, swing: true, kit: 'acoustic' };

const mono = (b: AudioBuffer) => {
  const n = b.numberOfChannels, out = new Float32Array(b.length);
  for (let c = 0; c < n; c++) { const d = b.getChannelData(c); for (let i = 0; i < out.length; i++) out[i] += d[i] / n; }
  return out;
};

function summary(notes: FoundNote[]) {
  const n = (f: (m: number) => boolean) => notes.filter(x => f(x.midi)).length;
  const parts: [string, number][] = [['dr.kick', n(m => m === 36)], ['dr.snare', n(m => m === 38)], ['dr.hatC', n(m => m === 42)], ['dr.hatO', n(m => m === 46)], ['dr.cym', n(m => m === 49)], ['dr.tom', n(m => m === 45 || m === 47 || m === 50)]];
  return parts.filter(([, c]) => c).map(([k, c]) => t(k, c)).join(' · ');
}

/** Ajoute la batterie trouvée au morceau, avec les choix de la fenêtre (sert aussi à la QA). */
export function addFoundDrums(opts: Partial<typeof ui> = {}): Track | null {
  if (!found) return null;
  const o = { ...ui, ...opts };
  const tr = addDrumTrack(found.notes, found.grid, { loop: o.loop, swing: o.swing, kit: o.kit, name: t('dr.part') });
  toast(t('dr.added', tr.name));
  return tr;
}

const drums: Analyzer & { last: () => Found | null; add: typeof addFoundDrums; grid: typeof toGridRows } = {
  id: 'drums', order: 40,
  title: () => t('dr.title'),
  help: () => t('dr.help'),
  async run(ctx, progress, signal) {
    const buf = ctx.input('drums');
    const sc = await scan(mono(buf), buf.sampleRate, f => progress(0.95 * f), signal);
    const notes = toNotesGM(sc.hits);
    const bpm = ctx.result.bpm || S.project.bpm;
    const grid = fitGrid(notes, bpm, ctx.result.bpm ? ctx.result.beatOffset : undefined);
    const { rows, len } = toGridRows(notes, grid);
    found = { notes, grid, bars: len / BAR, loop: findLoop(rows, len), scan: sc }; foundFor = ctx.source;
    ctx.result.parts = ctx.result.parts.filter(p => p.id !== 'drums');
    if (notes.length) ctx.result.parts.push({ id: 'drums', kind: 'drums', name: t('dr.part'), notes });
    progress(1);
  },
  view(ctx) {
    if (!found || foundFor !== ctx.source) return null;
    const f = found;
    if (!f.notes.length) return h('p', { class: 'tip', role: 'status', id: 'drSum' }, t('dr.none'));
    const loop = h('input', { type: 'checkbox', checked: ui.loop, data: { role: 'drloop' }, onchange: () => { ui.loop = loop.checked; info.hidden = !ui.loop; } }) as HTMLInputElement;
    const info = h('p', { class: 'tip', id: 'drLoopInfo', hidden: !ui.loop }, t('dr.loopInfo', f.loop.bars, Math.round(f.loop.share * 100)));
    const sw = h('input', { type: 'checkbox', checked: ui.swing, data: { role: 'drswing' }, onchange: () => { ui.swing = sw.checked; } }) as HTMLInputElement;
    const kit = h('select', { 'aria-label': t('dr.kit'), data: { role: 'drkit' }, onchange: () => { ui.kit = kit.value; } }, ...Object.keys(KITS).map(k => h('option', { value: k, selected: ui.kit === k }, t('kit.' + k)))) as HTMLSelectElement;
    return h('div', { class: 'dr-view' },
      h('p', { class: 'tip', role: 'status', id: 'drSum' }, t('dr.found', f.notes.length, summary(f.notes))),
      h('p', { class: 'tip' }, t('dr.tempo', Math.round(f.grid.bpm * 10) / 10, f.bars)),
      f.grid.swing > 0 && h('label', { class: 'tip' }, sw, ' ', t('dr.swing', Math.round(f.grid.swing * 100)), ' — ', t('dr.useSwing')),
      h('label', { class: 'tip' }, loop, ' ', t('dr.loop')), info,
      h('div', { class: 'fxfoot' }, h('label', {}, t('dr.kit') + ' ', kit),
        h('button', { class: 'pill accent', id: 'drAdd', onclick: () => addFoundDrums() }, t('dr.add'))));
  },
  last: () => found,
  add: addFoundDrums,
  grid: toGridRows,
};

registerAnalyzer(drums);
