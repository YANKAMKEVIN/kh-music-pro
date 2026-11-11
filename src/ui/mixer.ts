import { analyzeMix } from '../actions';
import { engine } from '../audio/engine';
import { t } from '../i18n';
import { S, commit, select } from '../store';
import { Track } from '../types';
import { ICON } from './arr';
import { db, h, pct, slider } from './dom';

function fader(label: string, value: number, set: (v: number) => void) {
  const inp = h('input', { type: 'range', class: 'vert', min: '0', max: '1.25', step: '0.01', 'aria-label': label, title: label });
  inp.value = String(value);
  const out = h('span', { class: 'val' }, pct(value));
  inp.oninput = () => { set(+inp.value); out.textContent = pct(+inp.value); engine.sync(); };
  inp.onchange = () => commit();
  return { inp, out };
}

export const filterFmt = (v: number) => Math.abs(v) < 0.02 ? '—' : (v < 0 ? 'LP ' : 'HP ') + Math.round(Math.abs(v) * 100);

function strip(tr: Track) {
  const f = fader(`${t('mix.volume')} – ${tr.name}`, tr.vol, v => tr.vol = v);
  const tog = (key: 'mute' | 'solo' | 'comp', txt: string) => h('button', {
    class: `mini ${key} ${tr[key] ? 'on' : ''}`, title: t('mix.' + key), 'aria-pressed': String(tr[key]), data: { tog: key }, onclick: () => { tr[key] = !tr[key]; commit(); },
  }, txt);
  const panFmt = (v: number) => v === 0 ? t('mix.center') : (v < 0 ? t('mix.left') : t('mix.right')) + ' ' + Math.round(Math.abs(v) * 100);
  return h('div', { class: 'strip' + (S.selTrack === tr.id ? ' sel' : ''), data: { id: tr.id }, style: `--c:${tr.color}`, onpointerdown: () => select(tr.id, S.selTrack === tr.id ? S.selClip : '') },
    h('div', { class: 'sname', title: tr.name }, `${ICON[tr.type]} ${tr.name}`),
    h('div', { class: 'sbody' },
      h('div', { class: 'scol' },
        h('span', { class: 'sect' }, t('mix.eq')),
        slider(t('mix.high'), -15, 15, 0.5, tr.eqHigh, v => tr.eqHigh = v, db),
        slider(t('mix.mid'), -15, 15, 0.5, tr.eqMid, v => tr.eqMid = v, db),
        slider(t('mix.low'), -15, 15, 0.5, tr.eqLow, v => tr.eqLow = v, db),
        h('span', { class: 'sect' }, t('mix.fx')),
        slider(t('mix.filter'), -1, 1, 0.01, tr.filter, v => tr.filter = Math.abs(v) < 0.03 ? 0 : v, filterFmt),
        slider(t('mix.drive'), 0, 1, 0.01, tr.drive, v => tr.drive = v, pct),
        slider(t('mix.reverb'), 0, 1, 0.01, tr.rev, v => tr.rev = v, pct),
        slider(t('mix.echo'), 0, 1, 0.01, tr.dly, v => tr.dly = v, pct),
        slider(t('mix.duck'), 0, 1, 0.01, tr.duck, v => tr.duck = v, pct),
        slider(t('mix.pan'), -1, 1, 0.01, tr.pan, v => tr.pan = v, panFmt),
        tog('comp', t('mix.comp'))),
      h('div', { class: 'fcol' },
        h('div', { class: 'fwrap' }, h('div', { class: 'meter' }, h('div', { class: 'mfill', data: { id: tr.id } })), f.inp),
        f.out,
        h('div', { class: 'srow' }, tog('mute', 'M'), tog('solo', 'S')))));
}

let lastResult = '';

export function renderMixer(): HTMLElement {
  const p = S.project;
  const target = h('select', { 'aria-label': t('mix.target'), title: t('mix.targetTip'), data: { role: 'target' } }, ...[0, -14, -9, -23].map(v => h('option', { value: String(v), selected: p.target === v }, t('mix.target' + v))));
  target.onchange = () => { p.target = +target.value; commit(); };
  const result = h('span', { class: 'lufs', role: 'status' }, lastResult);
  const m = fader(t('mix.master'), p.master, v => p.master = v);
  return h('div', { class: 'mixer' },
    ...p.tracks.map(strip),
    h('div', { class: 'strip master', style: '--c:#fff' },
      h('div', { class: 'sname' }, '🔊 ' + t('mix.master')),
      h('div', { class: 'sbody' },
        h('div', { class: 'scol' },
          h('span', { class: 'sect' }, t('mix.reverb')),
          slider(t('mix.revSize'), 0.4, 6, 0.1, p.revSize, v => p.revSize = v, v => v.toFixed(1) + ' s'),
          h('span', { class: 'sect' }, t('mix.echo')),
          slider(t('mix.dlyTime'), 1, 8, 1, p.dlySteps, v => p.dlySteps = v, v => v + '/16'),
          slider(t('mix.dlyFb'), 0, 0.85, 0.01, p.dlyFb, v => p.dlyFb = v, pct),
          h('span', { class: 'sect' }, t('mix.eq')),
          slider(t('mix.high'), -12, 12, 0.5, p.mHigh, v => p.mHigh = v, db),
          slider(t('mix.mid'), -12, 12, 0.5, p.mMid, v => p.mMid = v, db),
          slider(t('mix.low'), -12, 12, 0.5, p.mLow, v => p.mLow = v, db),
          slider(t('mix.width'), 0, 2, 0.01, p.width, v => p.width = Math.abs(v - 1) < 0.04 ? 1 : v, pct),
          h('span', { class: 'sect' }, t('mix.export')), target,
          h('button', { class: 'mini', data: { act: 'analyze' }, title: t('mix.analyzeTip'), onclick: async () => { lastResult = await analyzeMix(); result.textContent = lastResult; } }, '📊 ' + t('mix.analyze')), result),
        h('div', { class: 'fcol' },
        h('div', { class: 'fwrap' }, h('div', { class: 'meter' }, h('div', { class: 'mfill', data: { id: 'master' } })), m.inp),
        m.out, h('p', { class: 'tip' }, t('mix.limiter'))))));
}

export function updateMeters() {
  document.querySelectorAll<HTMLElement>('.mfill').forEach(el => {
    el.style.transform = `scaleY(${engine.level(el.dataset.id!).toFixed(3)})`;
  });
}
