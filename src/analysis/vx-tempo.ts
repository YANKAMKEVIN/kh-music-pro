/** V20 — analyse « Tempo et tonalité » : tempo, premier temps, tonalité ; boutons pour les appliquer au morceau (annulables). */
import { addTexts, t } from '../i18n';
import { S, commit, undo } from '../store';
import { h, toast } from '../ui/dom';
import { registerAnalyzer } from './registry';
import type { Ctx } from './types';
import { vxRun } from './vx-run';

addTexts({
  'vx.tempo.title': ['Tempo et tonalité', 'Tempo and key', 'Tempo y tonalidad'],
  'vx.tempo.help': ['Trouve le tempo (BPM), le premier temps et la tonalité du son.', 'Finds the tempo (BPM), the first beat and the key of the sound.', 'Encuentra el tempo (BPM), el primer tiempo y la tonalidad del sonido.'],
  'vx.tempo.bpm': ['Tempo : {0} BPM', 'Tempo: {0} BPM', 'Tempo: {0} BPM'],
  'vx.tempo.none': ['Pas de tempo net (pas assez d\'attaques régulières).', 'No clear tempo (not enough regular beats).', 'Sin tempo claro (no hay suficientes golpes regulares).'],
  'vx.tempo.first': ['Premier temps : {0} s', 'First beat: {0} s', 'Primer tiempo: {0} s'],
  'vx.key': ['Tonalité : {0} (confiance {1} %)', 'Key: {0} ({1} % confidence)', 'Tonalidad: {0} (confianza {1} %)'],
  'vx.key.none': ['Tonalité incertaine.', 'Key unclear.', 'Tonalidad incierta.'],
  'vx.notes': ['Do,Do#,Ré,Mi♭,Mi,Fa,Fa#,Sol,La♭,La,Si♭,Si', 'C,C#,D,E♭,E,F,F#,G,A♭,A,B♭,B', 'Do,Do#,Re,Mi♭,Mi,Fa,Fa#,Sol,La♭,La,Si♭,Si'],
  'vx.major': ['{0} majeur', '{0} major', '{0} mayor'],
  'vx.minor': ['{0} mineur', '{0} minor', '{0} menor'],
  'vx.applyTempo': ['Appliquer le tempo au morceau', 'Apply tempo to the song', 'Aplicar el tempo a la canción'],
  'vx.applyKey': ['Appliquer la tonalité au morceau', 'Apply key to the song', 'Aplicar la tonalidad a la canción'],
  'vx.appliedTempo': ['Tempo du morceau : {0} BPM.', 'Song tempo: {0} BPM.', 'Tempo de la canción: {0} BPM.'],
  'vx.appliedKey': ['Tonalité du morceau : {0}.', 'Song key: {0}.', 'Tonalidad de la canción: {0}.'],
  'vx.undo': ['Annuler', 'Undo', 'Deshacer'],
});

/** Nom d'une tonalité dans la langue de l'interface (« La mineur »). */
export const keyName = (k: { tonic: number; mode: 'major' | 'minor' }) => t(k.mode === 'major' ? 'vx.major' : 'vx.minor', t('vx.notes').split(',')[k.tonic]);
const fmt = (v: number, d = 1) => v.toLocaleString(document.documentElement.lang || 'fr', { maximumFractionDigits: d });

interface TempoRes { tempo: { bpm: number; offset: number; score: number } | null; key: { tonic: number; mode: 'major' | 'minor'; score: number } | null }

export function applyTempo(ctx: Ctx) {
  const bpm = ctx.result.bpm;
  if (!bpm) return;
  S.project.bpm = Math.max(40, Math.min(240, Math.round(bpm * 100) / 100));
  commit();
  toast(t('vx.appliedTempo', fmt(S.project.bpm, 2)), 'info', { action: { label: t('vx.undo'), fn: undo } });
}
export function applyKey(ctx: Ctx) {
  const k = ctx.result.key;
  if (!k) return;
  S.project.key = k.tonic; S.project.scale = k.mode;
  commit();
  toast(t('vx.appliedKey', keyName(k)), 'info', { action: { label: t('vx.undo'), fn: undo } });
}

registerAnalyzer({
  id: 'vx-tempo',
  order: 20,
  title: () => t('vx.tempo.title'),
  help: () => t('vx.tempo.help'),
  async run(ctx, progress, signal) {
    const r = await vxRun<TempoRes>('tempo', ctx.source!.buffer, progress, signal);
    if (r.tempo) { ctx.result.bpm = r.tempo.bpm; ctx.result.beatOffset = r.tempo.offset; }
    else { delete ctx.result.bpm; delete ctx.result.beatOffset; }
    if (r.key && r.key.score >= 0.3) ctx.result.key = r.key; else delete ctx.result.key;
  },
  view(ctx) {
    const { bpm, beatOffset, key } = ctx.result;
    return h('div', { class: 'vx-view', data: { role: 'vx-tempo' } },
      h('p', { data: { role: 'bpm' } }, bpm ? t('vx.tempo.bpm', fmt(bpm)) + ' · ' + t('vx.tempo.first', fmt(beatOffset || 0, 2)) : t('vx.tempo.none')),
      h('p', { data: { role: 'key' } }, key ? t('vx.key', keyName(key), Math.round(key.score * 100)) : t('vx.key.none')),
      h('div', { class: 'fxfoot' },
        bpm ? h('button', { class: 'pill', id: 'vxApplyTempo', onclick: () => applyTempo(ctx) }, t('vx.applyTempo')) : '',
        key ? h('button', { class: 'pill', id: 'vxApplyKey', onclick: () => applyKey(ctx) }, t('vx.applyKey')) : ''));
  },
});
