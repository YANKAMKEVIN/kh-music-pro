/** V20 — analyse « Tempo et tonalité » : tempo, premier temps, tonalité ; boutons pour les appliquer au morceau (annulables). */
import { addTexts, t } from '../i18n';
import { S, commit, undo } from '../store';
import { h, toast } from '../ui/dom';
import { registerAnalyzer } from './registry';
import type { Ctx } from './types';
import { vxRun } from './vx-run';
import { clock } from '../ui/library';

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
  'vx.tempo.steady': ['Tempo régulier tout du long.', 'Steady tempo throughout.', 'Tempo regular de principio a fin.'],
  'vx.tempo.moves': ['Le tempo change en cours de morceau :', 'The tempo changes during the song:', 'El tempo cambia durante la canción:'],
  'vx.tempo.at': ['à {0} → {1} BPM', 'at {0} → {1} BPM', 'en {0} → {1} BPM'],
  'vx.tempo.more': ['… et {0} autres changements', '… and {0} more changes', '… y {0} cambios más'],
  'vx.tempo.follow': ['Les parties ajoutées suivent ces changements, temps par temps.', 'Added parts follow these changes, beat by beat.', 'Las partes añadidas siguen estos cambios, tiempo a tiempo.'],
  'vx.appliedTempos': ['Tempo du morceau : {0} BPM, avec {1} changements de tempo.', 'Song tempo: {0} BPM, with {1} tempo changes.', 'Tempo de la canción: {0} BPM, con {1} cambios de tempo.'],
});

/** Nom d'une tonalité dans la langue de l'interface (« La mineur »). */
export const keyName = (k: { tonic: number; mode: 'major' | 'minor' }) => t(k.mode === 'major' ? 'vx.major' : 'vx.minor', t('vx.notes').split(',')[k.tonic]);
const fmt = (v: number, d = 1) => v.toLocaleString(document.documentElement.lang || 'fr', { maximumFractionDigits: d });

interface TempoRes { tempo: { bpm: number; offset: number; score: number } | null; key: { tonic: number; mode: 'major' | 'minor'; score: number } | null; beats?: number[]; secs?: { beat: number; bpm: number }[] }

/** Tronçons de tempo à partir du premier temps (`beat` compté depuis lui). Vide sans temps suivis. */
export function sectionsOf(ctx: Ctx): { beat: number; t: number; bpm: number }[] {
  const B = ctx.result.beats, secs = ctx.result.tempoSecs, k0 = ctx.result.beat0 ?? 0;
  if (!B || !secs?.length) return [];
  const out: { beat: number; t: number; bpm: number }[] = [];
  secs.forEach((x, q) => {
    if ((secs[q + 1]?.beat ?? Infinity) <= k0) return;
    const k = Math.max(k0, x.beat);
    out.push({ beat: k - k0, t: B[k], bpm: x.bpm });
  });
  return out;
}
/** Changements à montrer : on regroupe les tronçons voisins à moins de 2 % l'un de l'autre, et on ignore ceux de moins de 8 temps. */
export function tempoChanges(ctx: Ctx): { t: number; bpm: number }[] {
  const secs = sectionsOf(ctx), out: { t: number; bpm: number; beat: number }[] = [];
  secs.forEach((x, i) => {
    const len = (secs[i + 1]?.beat ?? Infinity) - x.beat;
    if (len < 8 && i) return;
    const last = out[out.length - 1];
    if (last && Math.abs(x.bpm / last.bpm - 1) < 0.02) return;
    out.push({ t: x.t, bpm: x.bpm, beat: x.beat });
  });
  return out;
}

export function applyTempo(ctx: Ctx) {
  const bpm = ctx.result.bpm;
  if (!bpm) return;
  const lim = (b: number, d = 100) => Math.max(40, Math.min(240, Math.round(b * d) / d));
  const secs = sectionsOf(ctx);
  if (secs.length > 1) {
    // une marque de tempo par section, posée sur son temps (un temps = 4 pas) : la grille suit le morceau
    S.project.bpm = lim(secs[0].bpm);
    S.project.tempos = secs.slice(1).map(x => ({ s: x.beat * 4, bpm: lim(x.bpm) }));
    commit();
    toast(t('vx.appliedTempos', fmt(S.project.bpm, 1), S.project.tempos.length), 'info', { action: { label: t('vx.undo'), fn: undo } });
    return;
  }
  S.project.bpm = lim(bpm);
  S.project.tempos = [];
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
    delete ctx.result.beats; delete ctx.result.beat0; delete ctx.result.tempoSecs;
    if (r.tempo) {
      ctx.result.bpm = r.tempo.bpm; ctx.result.beatOffset = r.tempo.offset;
      const B = r.beats ?? [];
      if (B.length >= 8) {
        // premier temps = le temps suivi le plus proche de celui trouvé par le tempo global
        let k0 = 0; for (let k = 1; k < B.length; k++) if (Math.abs(B[k] - r.tempo.offset) < Math.abs(B[k0] - r.tempo.offset)) k0 = k;
        ctx.result.beats = B; ctx.result.beat0 = k0; ctx.result.beatOffset = B[k0]; ctx.result.tempoSecs = r.secs;
        // tempo montré : celui des temps suivis (médiane), sauf s'il confirme le tempo global à 3 % près
        const iv = B.slice(1).map((b, i) => b - B[i]).sort((a, b) => a - b), med = 60 / iv[iv.length >> 1];
        if (Math.abs(med / r.tempo.bpm - 1) > 0.03) ctx.result.bpm = Math.round(med * 10) / 10;
      }
    }
    else { delete ctx.result.bpm; delete ctx.result.beatOffset; }
    if (r.key && r.key.score >= 0.3) ctx.result.key = r.key; else delete ctx.result.key;
  },
  view(ctx) {
    const { bpm, beatOffset, key } = ctx.result;
    return h('div', { class: 'vx-view', data: { role: 'vx-tempo' } },
      h('p', { data: { role: 'bpm' } }, bpm ? t('vx.tempo.bpm', fmt(bpm)) + ' · ' + t('vx.tempo.first', fmt(beatOffset || 0, 2)) : t('vx.tempo.none')),
      tempoView(ctx),
      h('p', { data: { role: 'key' } }, key ? t('vx.key', keyName(key), Math.round(key.score * 100)) : t('vx.key.none')),
      h('div', { class: 'fxfoot' },
        bpm ? h('button', { class: 'pill', id: 'vxApplyTempo', onclick: () => applyTempo(ctx) }, t('vx.applyTempo')) : '',
        key ? h('button', { class: 'pill', id: 'vxApplyKey', onclick: () => applyKey(ctx) }, t('vx.applyKey')) : ''));
  },
});

function tempoView(ctx: Ctx): HTMLElement | '' {
  if (!ctx.result.beats) return '';
  const ch = tempoChanges(ctx);
  if (ch.length < 2) return h('p', { class: 'tip', data: { role: 'tempo-steady' } }, t('vx.tempo.steady'));
  const shown = ch.slice(1, 7);
  return h('div', { data: { role: 'tempo-map' } },
    h('p', {}, t('vx.tempo.moves')),
    h('ul', {}, ...shown.map(c => h('li', {}, t('vx.tempo.at', clock(c.t), fmt(c.bpm, 0))))),
    ch.length > 7 ? h('p', { class: 'tip' }, t('vx.tempo.more', ch.length - 7)) : '',
    h('p', { class: 'tip' }, t('vx.tempo.follow')));
}
