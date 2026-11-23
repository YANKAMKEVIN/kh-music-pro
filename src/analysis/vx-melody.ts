/** V20 — analyse « Chant → notes » : suivi de la hauteur chantée, découpé en notes, prêt à devenir une piste. */
import { addTexts, t } from '../i18n';
import { h } from '../ui/dom';
import { registerAnalyzer } from './registry';
import type { FoundNote } from './types';
import { vxRun } from './vx-run';

addTexts({
  'vx.mel.title': ['Chant → notes', 'Vocals → notes', 'Voz → notas'],
  'vx.mel.help': ['Suit la voix (une note à la fois) et l\'écrit en notes : vibrato et glissés lissés, vélocité selon la force du chant.', 'Follows the voice (one note at a time) and writes it as notes: vibrato and slides smoothed, velocity from how loud it is sung.', 'Sigue la voz (una nota a la vez) y la escribe en notas: vibrato y glissandos suavizados, velocidad según la fuerza del canto.'],
  'vx.mel.part': ['Chant', 'Vocals', 'Voz'],
  'vx.mel.found': ['{0} notes, de {1} à {2}', '{0} notes, from {1} to {2}', '{0} notas, de {1} a {2}'],
  'vx.mel.none': ['Aucune note chantée nette.', 'No clear sung note.', 'Ninguna nota cantada clara.'],
  'vx.mel.tuning': ['Justesse du chanteur : {0} centièmes de demi-ton par rapport au la 440.', 'Singer tuning: {0} cents from A 440.', 'Afinación del cantante: {0} cents respecto al La 440.'],
  'vx.mel.fromStem': ['D\'après la voix séparée.', 'From the separated vocals.', 'A partir de la voz separada.'],
  'vx.mel.fromMix': ['D\'après le son entier : avec un accompagnement, lancez d\'abord la séparation des pistes.', 'From the whole sound: with backing music, run track separation first.', 'A partir del sonido completo: con acompañamiento, separe primero las pistas.'],
});

const NAMES = () => t('vx.notes').split(',');
const nn = (m: number) => NAMES()[m % 12] + (Math.floor(m / 12) - 1);
let info: { tuning: number; stem: boolean } = { tuning: 0, stem: false };

registerAnalyzer({
  id: 'vx-melody',
  order: 30,
  title: () => t('vx.mel.title'),
  help: () => t('vx.mel.help'),
  async run(ctx, progress, signal) {
    const stem = !!ctx.result.stems?.vocals;
    const r = await vxRun<{ notes: FoundNote[]; tuning: number }>('melody', ctx.input('vocals'), progress, signal);
    info = { tuning: r.tuning, stem };
    const parts = ctx.result.parts.filter(p => p.id !== 'vx-melody');
    if (r.notes.length) parts.push({ id: 'vx-melody', kind: 'melody', name: t('vx.mel.part'), notes: r.notes, preset: 'flute' });
    ctx.result.parts = parts;
  },
  view(ctx) {
    const p = ctx.result.parts.find(x => x.id === 'vx-melody');
    const lo = p ? Math.min(...p.notes.map(n => n.midi)) : 0, hi = p ? Math.max(...p.notes.map(n => n.midi)) : 0;
    return h('div', { class: 'vx-view', data: { role: 'vx-melody' } },
      h('p', { data: { role: 'found' } }, p ? t('vx.mel.found', p.notes.length, nn(lo), nn(hi)) : t('vx.mel.none')),
      p && Math.abs(info.tuning) >= 0.05 ? h('p', { class: 'tip' }, t('vx.mel.tuning', (info.tuning > 0 ? '+' : '') + Math.round(info.tuning * 100))) : '',
      h('p', { class: 'tip', data: { role: 'src' } }, t(info.stem ? 'vx.mel.fromStem' : 'vx.mel.fromMix')));
  },
});
