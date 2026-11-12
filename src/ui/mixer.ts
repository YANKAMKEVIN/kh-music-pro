import { addBus, analyzeMix, applyMixPreset, deleteBus } from '../actions';
import { engine } from '../audio/engine';
import { t } from '../i18n';
import { clearMidiMap, ccOf, learn } from '../input';
import { S, commit, emit, select } from '../store';
import { MIX_PRESETS, Track } from '../types';
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

/** Marque un réglage comme assignable à un contrôleur MIDI et affiche le bouton qui lui est relié. */
function tag<T extends HTMLElement>(el: T, target: string): T {
  el.dataset.map = target;
  const cc = ccOf(target);
  if (cc !== undefined) el.dataset.cc = 'CC ' + cc;
  if (learn.target === target) el.classList.add('armed');
  return el;
}

export const filterFmt = (v: number) => Math.abs(v) < 0.02 ? '—' : (v < 0 ? 'LP ' : 'HP ') + Math.round(Math.abs(v) * 100);

function strip(tr: Track, i: number, bus = false) {
  const f = fader(`${t('mix.volume')} – ${tr.name}`, tr.vol, v => tr.vol = v);
  const tog = (key: 'mute' | 'solo' | 'comp', txt: string) => h('button', {
    class: `mini ${key} ${tr[key] ? 'on' : ''}`, title: t('mix.' + key), 'aria-pressed': String(tr[key]), data: { tog: key }, onclick: () => { tr[key] = !tr[key]; commit(); },
  }, txt);
  const preset = h('select', { class: 'mpreset', 'aria-label': `${t('mp.title')} – ${tr.name}`, title: t('mp.tip'), data: { role: 'mixpreset' } },
    h('option', { value: '' }, t('mp.title') + '…'), ...Object.keys(MIX_PRESETS).map(k => h('option', { value: k }, t('mp.' + k))));
  preset.onchange = () => { if (preset.value) applyMixPreset(tr, preset.value); };
  // Sortie de la piste : le général, ou un bus qui regroupe plusieurs pistes.
  const out = !bus && S.project.buses.length > 0 && h('select', { class: 'mpreset', 'aria-label': `${t('bus.out')} – ${tr.name}`, title: t('bus.outTip'), data: { role: 'out' } },
    h('option', { value: '', selected: !tr.out }, '→ ' + t('mix.master')), ...S.project.buses.map(b => h('option', { value: b.id, selected: tr.out === b.id }, '→ ' + b.name)));
  if (out) out.onchange = () => { tr.out = out.value; commit(); };
  const bname = bus && h('input', { class: 'tname', value: tr.name, 'aria-label': t('bus.name'), spellcheck: false });
  if (bname) { bname.onchange = () => { tr.name = bname.value.trim() || tr.name; commit(); }; bname.onkeydown = e => { e.stopPropagation(); if (e.key === 'Enter') bname.blur(); }; }
  const hz = (v: number) => (v >= 1000 ? (v / 1000).toFixed(1) + ' kHz' : Math.round(v) + ' Hz');
  const panFmt = (v: number) => v === 0 ? t('mix.center') : (v < 0 ? t('mix.left') : t('mix.right')) + ' ' + Math.round(Math.abs(v) * 100);
  const T = (el: HTMLElement, key: string) => (bus ? el : tag(el, `${i}:${key}`)); // l'assignation MIDI vise les pistes, pas les bus
  return h('div', { class: 'strip' + (bus ? ' bus' : S.selTrack === tr.id ? ' sel' : ''), data: { id: tr.id }, style: `--c:${tr.color}`, onpointerdown: () => { if (!bus) select(tr.id, S.selTrack === tr.id ? S.selClip : ''); } },
    bus ? h('div', { class: 'shead' }, h('span', { class: 'sname' }, '🔀'), bname, preset,
      h('button', { class: 'mini del', data: { act: 'busdel' }, title: t('bus.del'), 'aria-label': `${t('bus.del')} – ${tr.name}`, onclick: () => deleteBus(tr.id) }, '✕'))
      : h('div', { class: 'shead' }, h('div', { class: 'sname', title: tr.name }, `${ICON[tr.type]} ${tr.name}`), out, preset),
    h('canvas', { class: 'eqc', width: 280, height: 46, data: { eq: tr.id }, role: 'img', 'aria-label': `${t('mix.eqCurve')} – ${tr.name}`, title: t('mix.eqCurve') }),
    h('div', { class: 'sbody' },
      h('div', { class: 'scol' },
        h('span', { class: 'sect' }, t('mix.eq')),
        slider(t('mix.high'), -15, 15, 0.5, tr.eqHigh, v => tr.eqHigh = v, db),
        slider(t('mix.mid'), -15, 15, 0.5, tr.eqMid, v => tr.eqMid = v, db),
        slider(t('mix.midF'), 200, 8000, 10, tr.eqMidF, v => tr.eqMidF = v, hz),
        slider(t('mix.low'), -15, 15, 0.5, tr.eqLow, v => tr.eqLow = v, db),
        h('span', { class: 'sect' }, t('mix.fx')),
        T(slider(t('mix.filter'), -1, 1, 0.01, tr.filter, v => tr.filter = Math.abs(v) < 0.03 ? 0 : v, filterFmt), 'filter'),
        T(slider(t('mix.drive'), 0, 1, 0.01, tr.drive, v => tr.drive = v, pct), 'drive'),
        T(slider(t('mix.reverb'), 0, 1, 0.01, tr.rev, v => tr.rev = v, pct), 'rev'),
        T(slider(t('mix.echo'), 0, 1, 0.01, tr.dly, v => tr.dly = v, pct), 'dly'),
        T(slider(t('mix.duck'), 0, 1, 0.01, tr.duck, v => tr.duck = v, pct), 'duck'),
        T(slider(t('mix.chorus'), 0, 1, 0.01, tr.chorus, v => tr.chorus = v, pct), 'chorus'),
        T(slider(t('mix.trem'), 0, 1, 0.01, tr.trem, v => tr.trem = v, pct), 'trem'),
        T(slider(t('mix.crush'), 0, 1, 0.01, tr.crush, v => tr.crush = v, pct), 'crush'),
        T(slider(t('mix.pan'), -1, 1, 0.01, tr.pan, v => tr.pan = v, panFmt), 'pan'),
        tog('comp', t('mix.comp')),
        tr.comp && slider(t('mix.compThr'), -60, 0, 1, tr.compThr, v => tr.compThr = v, v => v + ' dB'),
        tr.comp && slider(t('mix.compRatio'), 1, 20, 0.5, tr.compRatio, v => tr.compRatio = v, v => v + ':1'),
        tr.comp && h('span', { class: 'gr', data: { gr: tr.id }, title: t('mix.grTip') }, '')),
      h('div', { class: 'fcol' },
        h('div', { class: 'fwrap' }, h('div', { class: 'meter' }, h('div', { class: 'mfill', data: { id: tr.id } })), bus ? f.inp : tag(f.inp, `${i}:vol`)),
        f.out,
        h('div', { class: 'srow' }, tog('mute', 'M'), !bus && tog('solo', 'S')))));
}

let lastResult = '';

export function renderMixer(): HTMLElement {
  const p = S.project;
  const target = h('select', { 'aria-label': t('mix.target'), title: t('mix.targetTip'), data: { role: 'target' } }, ...[0, -14, -9, -23].map(v => h('option', { value: String(v), selected: p.target === v }, t('mix.target' + v))));
  target.onchange = () => { p.target = +target.value; commit(); };
  const result = h('span', { class: 'lufs', role: 'status' }, lastResult);
  const m = fader(t('mix.master'), p.master, v => p.master = v);
  const root = h('div', { class: 'mixer' + (learn.on ? ' learning' : '') },
    h('div', { class: 'mtools' },
      h('button', { class: 'pill' + (learn.on ? ' on' : ''), data: { act: 'learn' }, 'aria-pressed': String(learn.on), title: t('learn.tip'), onclick: () => { learn.on = !learn.on; learn.target = ''; emit(); } }, '🎛 ' + t('learn.title')),
      learn.on && h('p', { class: 'tip' }, t(learn.target ? 'learn.move' : 'learn.pick')),
      Object.keys(learn.map).length > 0 && h('button', { class: 'pill', data: { act: 'learnclear' }, onclick: clearMidiMap }, t('learn.clear')),
      h('button', { class: 'pill', data: { act: 'busadd' }, title: t('bus.addTip'), onclick: addBus }, '＋ ' + t('bus.add')),
      h('canvas', { class: 'spec', width: 150, height: 70, role: 'img', 'aria-label': t('mix.spectrum'), title: t('mix.spectrum') })),
    ...p.tracks.map((tr, i) => strip(tr, i)), ...p.buses.map((b, i) => strip(b, i, true)),
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
        h('div', { class: 'fwrap' }, h('div', { class: 'meter' }, h('div', { class: 'mfill', data: { id: 'master' } })), tag(m.inp, 'm:master')),
        m.out, h('p', { class: 'tip' }, t('mix.limiter'))))));
  // En mode assignation, un clic sur un réglage le désigne au lieu de le modifier.
  root.addEventListener('pointerdown', e => {
    if (!learn.on) return;
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-map]');
    if (!el) return;
    e.preventDefault(); e.stopPropagation(); learn.target = el.dataset.map!; emit();
  }, true);
  return root;
}

learn.onChange = emit;

function drawSpectrum() {
  const cv = document.querySelector<HTMLCanvasElement>('.spec'), sp = cv && engine.spectrum();
  if (!cv || !sp) return;
  const g = cv.getContext('2d')!, W = cv.width, H = cv.height, N = 30;
  g.clearRect(0, 0, W, H);
  // Bandes réparties de façon logarithmique, comme l'oreille.
  for (let b = 0; b < N; b++) {
    const i0 = Math.floor(Math.pow(sp.length, b / N)), i1 = Math.max(i0 + 1, Math.floor(Math.pow(sp.length, (b + 1) / N)));
    let m = 0; for (let i = i0; i < i1 && i < sp.length; i++) m = Math.max(m, sp[i]);
    const hh = (m / 255) * H;
    g.fillStyle = `hsl(${190 + b * 4}, 85%, 62%)`; g.fillRect(b * W / N + 1, H - hh, W / N - 2, hh);
  }
}

const EQF = Float32Array.from({ length: 70 }, (_, i) => 30 * Math.pow(600, i / 69)); // 30 Hz à 18 kHz, échelle logarithmique
function drawEq() {
  document.querySelectorAll<HTMLCanvasElement>('.eqc').forEach(cv => {
    const curve = engine.mix.eqCurve(cv.dataset.eq!, EQF);
    if (!curve) return;
    const g = cv.getContext('2d')!, W = cv.width, H = cv.height, y = (dbv: number) => H / 2 - Math.max(-18, Math.min(18, dbv)) / 18 * (H / 2 - 2);
    g.clearRect(0, 0, W, H);
    g.strokeStyle = 'rgba(255,255,255,.18)'; g.lineWidth = 1; g.beginPath(); g.moveTo(0, H / 2); g.lineTo(W, H / 2); g.stroke();
    g.strokeStyle = getComputedStyle(cv).color; g.lineWidth = 2; g.beginPath();
    curve.forEach((v, i) => { const x = i / (curve.length - 1) * W; if (i) g.lineTo(x, y(v)); else g.moveTo(x, y(v)); });
    g.stroke();
  });
  document.querySelectorAll<HTMLElement>('.gr').forEach(el => { const r = engine.reduction(el.dataset.gr!); el.textContent = r < -0.2 ? t('mix.gr', r.toFixed(1)) : t('mix.gr', '0'); });
}

export function updateMeters() {
  drawSpectrum(); drawEq();
  document.querySelectorAll<HTMLElement>('.mfill').forEach(el => {
    el.style.transform = `scaleY(${engine.level(el.dataset.id!).toFixed(3)})`;
  });
}
