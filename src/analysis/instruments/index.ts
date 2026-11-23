/** V20 — Familles d'instruments : quelles familles on entend (voix, piano, guitare, basse, batterie, cordes…),
 *  avec le son de KH Music Pro le plus proche et un bouton pour créer la piste. Modèle YAMNet (Apache 2.0). */
import { engine } from '../../audio/engine';
import { drumBank } from '../../audio/banks';
import { addTexts, t } from '../../i18n';
import { S, commit } from '../../store';
import { PRESETS, Track, newTrack } from '../../types';
import { h, toast } from '../../ui/dom';
import { registerAnalyzer } from '../registry';
import type { Analyzer, Ctx, FoundInstrument, Part } from '../types';
import type { Inputs, ModelFiles, StemName } from './core';
import { FamilyFound, FrameData, TUNE, summarize } from './families';

addTexts({
  'in.title': ['Familles d\'instruments', 'Instrument families', 'Familias de instrumentos'],
  'in.help': ['Repère les familles d\'instruments entendues (voix, piano, guitare, basse, batterie, cordes…) et propose le son de KH Music Pro le plus proche. Le modèle (16 Mo) se charge la première fois.', 'Spots the instrument families you can hear (voice, piano, guitar, bass, drums, strings…) and suggests the closest KH Music Pro sound. The model (16 MB) loads the first time.', 'Detecta las familias de instrumentos que se oyen (voz, piano, guitarra, bajo, batería, cuerdas…) y propone el sonido de KH Music Pro más parecido. El modelo (16 MB) se carga la primera vez.'],
  'in.familyOnly': ['Ce sont des familles, pas le modèle exact de l\'instrument : affinez le son à l\'oreille.', 'These are families, not the exact instrument model: fine-tune the sound by ear.', 'Son familias, no el modelo exacto del instrumento: ajusta el sonido de oído.'],
  'in.none': ['Aucune famille d\'instruments reconnue avec assez de certitude.', 'No instrument family recognised with enough certainty.', 'Ninguna familia de instrumentos reconocida con suficiente certeza.'],
  'in.conf': ['Confiance {0} %', 'Confidence {0}%', 'Confianza {0} %'],
  'in.presence': ['entendue sur {0} % du morceau', 'heard on {0}% of the song', 'se oye en el {0} % de la canción'],
  'in.closest': ['Son le plus proche : {0}', 'Closest sound: {0}', 'Sonido más parecido: {0}'],
  'in.create': ['Créer une piste', 'Create a track', 'Crear una pista'],
  'in.createLabel': ['Créer une piste {0} avec le son {1}', 'Create a {0} track with the {1} sound', 'Crear una pista {0} con el sonido {1}'],
  'in.created': ['Piste « {0} » créée avec le son {1}.', 'Track “{0}” created with the {1} sound.', 'Pista «{0}» creada con el sonido {1}.'],
  'in.modelFailed': ['Le modèle d\'analyse n\'a pas pu être chargé.', 'The analysis model could not be loaded.', 'No se pudo cargar el modelo de análisis.'],
  'in.fam.voice': ['Voix', 'Voice', 'Voz'],
  'in.fam.piano': ['Piano', 'Piano', 'Piano'],
  'in.fam.epiano': ['Piano électrique', 'Electric piano', 'Piano eléctrico'],
  'in.fam.organ': ['Orgue', 'Organ', 'Órgano'],
  'in.fam.aguitar': ['Guitare acoustique', 'Acoustic guitar', 'Guitarra acústica'],
  'in.fam.eguitar': ['Guitare électrique', 'Electric guitar', 'Guitarra eléctrica'],
  'in.fam.bass': ['Basse', 'Bass', 'Bajo'],
  'in.fam.drums': ['Batterie', 'Drums', 'Batería'],
  'in.fam.strings': ['Cordes', 'Strings', 'Cuerdas'],
  'in.fam.brass': ['Cuivres', 'Brass', 'Metales'],
  'in.fam.wind': ['Bois (flûte, saxophone…)', 'Woodwinds (flute, saxophone…)', 'Maderas (flauta, saxofón…)'],
  'in.fam.mallet': ['Percussions mélodiques (marimba, vibraphone…)', 'Mallets (marimba, vibraphone…)', 'Percusión melódica (marimba, vibráfono…)'],
  'in.fam.synthpad': ['Synthé (nappe)', 'Synth (pad)', 'Sintetizador (colchón)'],
  'in.fam.synthlead': ['Synthé (solo)', 'Synth (lead)', 'Sintetizador (solista)'],
});

type Found = FoundInstrument & { preset: string };

const famKey = (f: { family: string; preset: string }) => f.family === 'synth' ? (f.preset === 'pad' ? 'synthpad' : 'synthlead') : f.family;
export const familyName = (f: { family: string; preset: string }) => t('in.fam.' + famKey(f));
/** Nom du son conseillé (« Batterie · Acoustique expressive » pour un kit). */
export function soundName(preset: string) {
  const [a, kit] = preset.split(':');
  return a === 'drums' ? `${t('type.drums')} · ${t('kit.' + kit)}` : t('ins.' + preset);
}

// ---- Fichiers du modèle (lus par XMLHttpRequest : marche aussi depuis file:// dans la version bureau) ----
const base = () => new URL('models/', document.baseURI).href;
function bytes(url: string, type: XMLHttpRequestResponseType = 'arraybuffer'): Promise<any> {
  return new Promise((ok, ko) => {
    const x = new XMLHttpRequest(); x.open('GET', url); x.responseType = type; x.timeout = 120000;
    x.onload = () => (x.status === 200 || (x.status === 0 && x.response) ? ok(x.response) : ko(new Error('http ' + x.status)));
    x.onerror = x.ontimeout = () => ko(new Error('network')); x.send();
  });
}
let files: Promise<ModelFiles> | null = null;
function modelFiles(): Promise<ModelFiles> {
  return files ??= (async () => {
    const b = base(), json = await bytes(b + 'yamnet/model.json', 'json') as { weightsManifest: { paths: string[] }[] };
    const weights = await Promise.all(json.weightsManifest.flatMap(g => g.paths).map(p => bytes(b + 'yamnet/' + p)));
    const opt = (p: string) => bytes(b + 'tfjs/' + p).catch(() => null);
    return { json, weights, wasm: await opt('tfjs-backend-wasm.wasm'), wasmSimd: await opt('tfjs-backend-wasm-simd.wasm') };
  })().catch(e => { files = null; throw e; });
}

/** Son mono à 16 kHz (taux de YAMNet), par le rééchantillonnage du navigateur. */
async function to16k(b: AudioBuffer): Promise<Float32Array> {
  const len = Math.max(1, Math.ceil(b.duration * 16000)), off = new OfflineAudioContext(1, len, 16000);
  const src = off.createBufferSource(); src.buffer = b; src.connect(off.destination); src.start();
  return (await off.startRendering()).getChannelData(0).slice();
}

// ---- Calcul : Worker, sinon fil principal ----
let worker: Worker | null = null;
function inWorker(wave: Inputs, f: ModelFiles, progress: (x: number) => void, signal: AbortSignal): Promise<FrameData> {
  return new Promise((ok, ko) => {
    let w: Worker;
    try { w = worker ??= new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }); }
    catch { ko(new Error('noworker')); return; }
    let started = false;
    const end = () => { w.onmessage = null; w.onerror = null; signal.removeEventListener('abort', abort); };
    const abort = () => { end(); w.terminate(); worker = null; ko(new DOMException('aborted', 'AbortError')); };
    signal.addEventListener('abort', abort);
    w.onerror = e => { end(); w.terminate(); worker = null; ko(new Error(started ? String(e.message) : 'noworker')); };
    w.onmessage = e => {
      const m = e.data; started = true;
      if (m.type === 'progress') progress(m.f);
      else if (m.type === 'done') { end(); last.backend = m.r.backend + ' (worker)'; ok(m.r); }
      else if (m.type === 'error') { end(); ko(new Error(m.msg)); }
    };
    w.postMessage({ type: 'run', inp: wave, files: f });
  });
}
async function onMain(wave: Inputs, f: ModelFiles, progress: (x: number) => void, signal: AbortSignal): Promise<FrameData> {
  const { runYamnet } = await import('./core');
  const r = await runYamnet(wave, f, progress, () => signal.aborted);
  last.backend = r.backend + ' (main)';
  return r;
}

/** Dernières mesures (QA) : fenêtres de YAMNet et moteur utilisé. */
const last: { frames: (FrameData & { means?: Record<string, Float32Array> }) | null; backend: string; ms: number } = { frames: null, backend: '', ms: 0 };
/** QA : forcer le calcul sur le fil principal ; essayer d'autres bandes de séparation. */
let forceMain = false, split: Inputs['opts'];

async function run(ctx: Ctx, progress: (f: number) => void, signal: AbortSignal) {
  const t0 = performance.now();
  const stems = ctx.result.stems || {}, names = (['vocals', 'drums', 'bass', 'other'] as StemName[]).filter(k => stems[k]);
  const [f, full, ...parts] = await Promise.all([modelFiles().catch(() => { throw new Error(t('in.modelFailed')); }), to16k(ctx.source!.buffer), ...names.map(k => to16k(stems[k]!))]);
  const wave: Inputs = { full, stems: names.length ? Object.fromEntries(names.map((k, i) => [k, parts[i]])) : undefined, opts: split };
  if (signal.aborted) throw new DOMException('aborted', 'AbortError');
  let frames: FrameData;
  try { frames = forceMain ? await onMain(wave, f, progress, signal) : await inWorker(wave, f, progress, signal); }
  catch (e) { if ((e as Error).message !== 'noworker') throw e; frames = await onMain(wave, f, progress, signal); }
  if (signal.aborted) throw new DOMException('aborted', 'AbortError');
  last.frames = frames; last.ms = performance.now() - t0;
  ctx.result.instruments = summarize(frames).map(x => ({ family: x.family, label: familyName(x), score: x.score, presence: x.presence, preset: x.preset }) as Found);
  tagParts(ctx);
}

/** Donne aux parties trouvées par les autres analyses (basse, piano, mélodie) le son de la famille entendue, si elles n'en ont pas. */
export function tagParts(ctx: Ctx) {
  const found = (ctx.result.instruments || []) as Found[];
  if (!found.length) return;
  const best = (ids: string[]) => found.find(f => ids.includes(f.family) && !f.preset.startsWith('drums:'));
  const melodic = ['wind', 'brass', 'strings', 'eguitar', 'aguitar', 'synth', 'mallet', 'piano', 'epiano', 'organ'];
  for (const p of ctx.result.parts as Part[]) {
    if (p.preset) continue;
    const f = p.kind === 'bass' ? best(['bass'])
      : p.kind === 'piano' ? best(['piano', 'epiano', 'organ'])
      : p.kind === 'melody' && !found.some(x => x.family === 'voice') ? best(melodic) : undefined;
    if (f && PRESETS[f.preset]) p.preset = f.preset;
  }
}

/** Crée une piste avec le son conseillé pour une famille trouvée. Renvoie la piste. */
export function createTrack(ctx: Ctx, family: string): Track | null {
  const f = (ctx.result.instruments as Found[] | undefined)?.find(x => x.family === family);
  if (!f) return null;
  const [a, kit] = f.preset.split(':');
  const n = S.project.tracks.filter(x => x.type === (a === 'drums' ? 'drums' : 'synth')).length + 1;
  let tr: Track;
  if (a === 'drums') {
    tr = newTrack('drums', n); tr.kit = kit;
    const bank = drumBank(kit); if (bank) void engine.loadBank(bank);
  } else {
    tr = newTrack('synth', n, PRESETS[f.preset] ? f.preset : 'lead');
    if (tr.synth?.engine === 'multi' && tr.synth.bank) void engine.loadBank(tr.synth.bank);
  }
  tr.name = familyName(f);
  S.project.tracks.push(tr); S.selTrack = tr.id; S.selClip = '';
  commit();
  toast(t('in.created', tr.name, soundName(f.preset)));
  return tr;
}

const pct = (x: number) => Math.round(x * 100);
function view(ctx: Ctx): HTMLElement | null {
  const found = (ctx.result.instruments || []) as Found[];
  tagParts(ctx);   // parties ajoutées depuis par d'autres analyses
  if (!found.length) return h('p', { class: 'tip', id: 'inNone', role: 'status' }, t('in.none'));
  return h('div', { class: 'in-found', id: 'inFound' },
    h('p', { class: 'tip', id: 'inFamilyOnly' }, 'ℹ️ ' + t('in.familyOnly')),
    h('ul', { class: 'in-list', 'aria-label': t('in.title') }, ...found.map(f => {
      const name = familyName(f), sound = soundName(f.preset);
      return h('li', { class: 'in-item', data: { family: f.family, preset: f.preset } },
        h('div', { class: 'in-name' }, h('strong', {}, name),
          h('span', { class: 'in-meta' }, `${t('in.conf', pct(f.score))} · ${t('in.presence', pct(f.presence ?? 0))}`)),
        h('div', { class: 'in-bar', role: 'meter', 'aria-label': t('in.conf', pct(f.score)), 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(pct(f.score)) },
          h('span', { style: `width:${pct(f.score)}%` })),
        h('span', { class: 'in-sound' }, t('in.closest', sound)),
        h('button', { class: 'pill', data: { role: 'in-create' }, 'aria-label': t('in.createLabel', name, sound), onclick: () => createTrack(ctx, f.family) }, '＋ ' + t('in.create')));
    })));
}

// Mise en page de la liste (fichier à soi : pas de changement de la feuille de style commune).
if (typeof document !== 'undefined' && !document.getElementById('in-style')) {
  document.head.append(h('style', { id: 'in-style' }, `
#analyze .in-list { list-style: none; margin: 6px 0 0; padding: 0; display: grid; gap: 8px; }
#analyze .in-item { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 4px 12px; align-items: center; padding: 8px 10px; border: 1px solid var(--line); border-radius: 10px; background: rgba(0, 0, 0, .2); }
#analyze .in-name { display: flex; flex-wrap: wrap; gap: 2px 10px; align-items: baseline; }
#analyze .in-meta, #analyze .in-sound { font-size: 13px; opacity: .85; }
#analyze .in-bar { grid-column: 1; height: 6px; border-radius: 3px; background: rgba(255, 255, 255, .08); overflow: hidden; }
#analyze .in-bar span { display: block; height: 100%; background: var(--grad); }
#analyze .in-sound { grid-column: 1; }
#analyze .in-item button { grid-column: 2; grid-row: 1 / span 3; min-height: 44px; }
@media (max-width: 560px) { #analyze .in-item { grid-template-columns: 1fr; } #analyze .in-item button { grid-column: 1; grid-row: auto; } }
`));
}

export const instrumentsAnalyzer: Analyzer & { qa: object } = {
  id: 'instruments', order: 50,
  title: () => t('in.title'), help: () => t('in.help'),
  run, view,
  qa: { last, TUNE, summarize, createTrack, tagParts, soundName, familyName, setForceMain: (v: boolean) => { forceMain = v; }, setSplit: (o: Inputs['opts']) => { split = o; }, forgetModel: () => { files = null; worker?.terminate(); worker = null; } },
};
registerAnalyzer(instrumentsAnalyzer);

export type { FamilyFound };
