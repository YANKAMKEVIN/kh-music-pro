import { engine } from '../audio/engine';
import { analyzers, dropTestAnalyzers } from '../analysis';
import { addPartAsTrack, warpNotes } from '../analysis/build';
import type { Ctx, Result } from '../analysis/types';
import { addTexts, t } from '../i18n';
import { S } from '../store';
import { h, toast } from './dom';
import { clock } from './library';

addTexts({
  'an.menu': ['Du son à la séquence…', 'From audio to sequence…', 'Del audio a la secuencia…'],
  'an.title': ['Du son à la séquence', 'From audio to sequence', 'Del audio a la secuencia'],
  'an.intro': ['Charge un son (MP3, WAV…) : KH Music Pro retrouve le chant, les notes, le tempo et les instruments, et les ajoute au morceau.', 'Load a sound (MP3, WAV…): KH Music Pro finds the vocal line, notes, tempo and instruments, and adds them to the song.', 'Carga un sonido (MP3, WAV…): KH Music Pro encuentra la voz, las notas, el tempo y los instrumentos, y los añade a la canción.'],
  'an.pick': ['Choisir un son…', 'Choose a sound…', 'Elegir un sonido…'],
  'an.none': ['Aucun son chargé.', 'No sound loaded.', 'Ningún sonido cargado.'],
  'an.loaded': ['{0} · {1}', '{0} · {1}', '{0} · {1}'],
  'an.badFile': ['Ce fichier n\'est pas un son lisible.', 'This file is not a readable sound.', 'Este archivo no es un sonido legible.'],
  'an.run': ['Lancer', 'Run', 'Iniciar'],
  'an.cancel': ['Annuler', 'Cancel', 'Cancelar'],
  'an.done': ['Terminé', 'Done', 'Terminado'],
  'an.failed': ['L\'analyse a échoué : {0}', 'Analysis failed: {0}', 'El análisis falló: {0}'],
  'an.noAnalyzer': ['Aucune analyse disponible pour l\'instant.', 'No analysis available yet.', 'Ningún análisis disponible por ahora.'],
  'an.parts': ['Parties trouvées', 'Parts found', 'Partes encontradas'],
  'an.addPart': ['Ajouter au morceau', 'Add to song', 'Añadir a la canción'],
  'an.partInfo': ['{0} notes', '{0} notes', '{0} notas'],
  'an.added': ['« {0} » ajoutée au morceau.', '“{0}” added to the song.', '«{0}» añadida a la canción.'],
  'an.personal': ['Pour un usage personnel : publier une reprise demande les droits du morceau.', 'For personal use: publishing a cover requires the song\'s rights.', 'Para uso personal: publicar una versión requiere los derechos de la canción.'],
});

/** État de l'analyse en cours : le son chargé et ce qui a été trouvé. Gardé tant que la page est ouverte. */
export const AN: Ctx = {
  source: null,
  result: { parts: [] },
  input(stem) { const b = stem && AN.result.stems?.[stem]; return b || AN.source!.buffer; },
};
const running = new Map<string, AbortController>();
const progress = new Map<string, number>();

/** Charge un son déjà décodé (sert aussi à la QA). Efface les résultats précédents. */
export function loadSource(name: string, buffer: AudioBuffer) {
  for (const c of running.values()) c.abort();
  running.clear(); progress.clear();
  AN.source = { name, buffer }; AN.result = { parts: [] } as Result;
  render();
}

/** Oublie le son et les résultats (QA). */
export function resetAnalysis() { for (const c of running.values()) c.abort(); running.clear(); progress.clear(); AN.source = null; AN.result = { parts: [] }; dropTestAnalyzers(); dlg()?.remove(); }

export async function loadFile(f: File) {
  try { loadSource(f.name, await engine.decode(await f.arrayBuffer())); }
  catch { toast(t('an.badFile'), 'error'); }
}

/** Lance une analyse par son identifiant ; renvoie quand elle est finie (sert aussi à la QA). */
export async function runAnalyzer(id: string) {
  const a = analyzers().find(x => x.id === id);
  if (!a || !AN.source || running.has(id)) return;
  const ctl = new AbortController(); running.set(id, ctl); progress.set(id, 0); render();
  try { await a.run(AN, f => { progress.set(id, f); paintProgress(id); }, ctl.signal); progress.set(id, 1); }
  catch (e) { progress.delete(id); if (!ctl.signal.aborted) toast(t('an.failed', String((e as Error)?.message || e)), 'error'); }
  finally { running.delete(id); render(); }
}

export function addPart(id: string) {
  const part = AN.result.parts.find(p => p.id === id);
  if (!part) return null;
  const tr = addPartAsTrack({ ...part, notes: warpNotes(AN.result, part.notes) }, AN.result.bpm || S.project.bpm, { fromSec: AN.result.beatOffset || 0 });
  toast(t('an.added', part.name));
  return tr;
}

const dlg = () => document.getElementById('analyze') as HTMLDialogElement | null;

function paintProgress(id: string) {
  const bar = dlg()?.querySelector<HTMLElement>(`[data-an="${id}"] .xprog`);
  if (!bar) return;
  const f = progress.get(id) ?? 0;
  bar.setAttribute('aria-valuenow', String(Math.round(f * 100)));
  bar.style.setProperty('--p', String(f));
  (bar.firstElementChild as HTMLElement).textContent = Math.round(f * 100) + ' %';
}

function render() {
  const d = dlg();
  if (!d) return;
  const file = h('input', { type: 'file', accept: 'audio/*,.mp3,.wav,.ogg,.m4a,.flac,.aac', hidden: true, onchange: () => { const f = file.files?.[0]; if (f) loadFile(f); file.value = ''; } }) as HTMLInputElement;
  const src = AN.source;
  const list = analyzers();
  const rows = list.map(a => {
    const busy = running.has(a.id), off = a.unavailable?.() || null;
    return h('section', { class: 'an-row', data: { an: a.id } },
      h('h3', {}, a.title()),
      h('p', { class: 'tip' }, a.help()),
      a.options?.(AN) || '',
      h('div', { class: 'fxfoot' },
        busy ? h('button', { class: 'pill', onclick: () => running.get(a.id)?.abort() }, '✕ ' + t('an.cancel'))
          : h('button', { class: 'pill accent', disabled: !src || !!off, data: { role: 'run' }, onclick: () => runAnalyzer(a.id) }, t('an.run')),
        busy && h('div', { class: 'xprog', role: 'progressbar', 'aria-label': a.title(), 'aria-valuemin': '0', 'aria-valuemax': '100' }, h('span', {})),
        !busy && progress.get(a.id) === 1 && h('span', { class: 'lufs', role: 'status' }, '✓ ' + t('an.done'))),
      off && h('p', { class: 'tip err' }, off),
      src && progress.get(a.id) === 1 && a.view?.(AN) || '');
  });
  const parts = AN.result.parts;
  d.replaceChildren(
    h('h2', { id: 'anT' }, '🎧 ' + t('an.title')),
    h('p', { class: 'tip' }, t('an.intro')),
    h('div', { class: 'fxfoot' }, file, h('button', { id: 'anPick', class: 'pill accent', onclick: () => file.click() }, t('an.pick')),
      h('span', { id: 'anSrc', role: 'status' }, src ? t('an.loaded', src.name, clock(src.buffer.duration)) : t('an.none'))),
    ...(list.length ? rows : [h('p', { class: 'tip' }, t('an.noAnalyzer'))]),
    parts.length ? h('section', { class: 'an-parts', id: 'anParts' },
      h('h3', {}, t('an.parts')),
      ...parts.map(p => h('div', { class: 'fxfoot', data: { part: p.id } },
        h('span', {}, `${p.name} · ${t('an.partInfo', p.notes.length)}`),
        h('button', { class: 'pill', onclick: () => addPart(p.id) }, t('an.addPart'))))) : '',
    h('p', { class: 'tip' }, t('an.personal')),
    h('form', { method: 'dialog' }, h('button', { class: 'pill' }, t('lib.close'))));
  for (const id of running.keys()) paintProgress(id);
}

export function showAnalyze() {
  let d = dlg();
  if (!d) { d = h('dialog', { id: 'analyze', class: 'analyze', 'aria-labelledby': 'anT' }); document.body.append(d); }
  render();
  if (!d.open) d.showModal();
}
