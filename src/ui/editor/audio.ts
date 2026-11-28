// Entrée audio, éditeur de clip audio et comping.
import { fitCanvas } from '../canvas';
import { chooseInput, chooseTake, chopClip, compTake, inputs, leftNeighbour, normalizeClip, reverseClip, setWarpBpm, setXfade, stretchClip, toggleInput, toggleWarp, tuneClip } from '../../actions';
import { engine } from '../../audio/engine';
import { t } from '../../i18n';
import { emit, S } from '../../store';
import { Clip, srcStep, stepDur, Track } from '../../types';
import { drawAudio, drawFades, drawWave } from '../arr';
import { icon, typeIcon } from '../icons';
import { clamp, followDrag, h, pct, slider } from '../dom';
import { clipTools } from '../editor';

// ---------- Entrée audio ----------
export function inputPanel() {
  const on = !!engine.inp;
  const dev = h('select', { 'aria-label': t('in.device'), title: t('in.device'), data: { role: 'indev' } },
    h('option', { value: '' }, t('in.default')), ...inputs.map(d => h('option', { value: d.id, selected: S.inputDevice === d.id }, d.label)));
  dev.onchange = () => chooseInput(dev.value);
  return h('div', { class: 'ebar inbar' }, h('span', { class: 'sect' }, t('in.title')), h('label', { class: 'fld' }, t('in.device'), dev),
    h('button', { class: 'pill' + (on ? ' on' : ''), data: { act: 'inopen' }, 'aria-pressed': String(on), title: t('in.openTip'), onclick: () => toggleInput(!on) }, icon('audio', 15), ' ' + t(on ? 'in.on' : 'in.open')),
    h('div', { class: 'meter', title: t('in.level') }, h('div', { class: 'mfill', data: { id: 'input' } })),
    on && h('div', { class: 'tuner', role: 'status', title: t('tuner.tip'), 'aria-label': t('tuner.title') }, h('span', { class: 'tnote' }, '—'), h('span', { class: 'tbar' }, h('i', {})), h('span', { class: 'tcents' }, '')),
    slider(t('in.gain'), 0, 4, 0.01, S.inputGain, v => { S.inputGain = v; engine.setInput(v, S.inputMonitor); }, pct, '', true, 1),
    h('button', { class: 'pill' + (S.inputMonitor ? ' on' : ''), data: { act: 'inmon' }, disabled: !on, 'aria-pressed': String(S.inputMonitor), title: t('in.monTip'), onclick: () => { S.inputMonitor = !S.inputMonitor; engine.setInput(S.inputGain, S.inputMonitor); emit(); } }, icon('headphones', 15), ' ' + t('in.monitor')));
}
// ---------- Clip audio ----------
export function audioEditor(tr: Track, c: Clip) {
  const cv = h('canvas', { class: 'bigwave' });
  queueMicrotask(() => {
    const w = cv.clientWidth || 800, hgt = cv.clientHeight || 120;
    const g = fitCanvas(cv, w, hgt); g.fillStyle = tr.color;
    if (c.bufferId) { drawAudio(g, c, w, hgt); g.fillStyle = '#fff'; drawFades(g, c, w, hgt); }
  });
  const sec = (v: number) => (v * stepDur(S.project.bpm)).toFixed(2) + ' s', half = Math.max(1, Math.floor(c.len / 2));
  const act = (key: string, icon: string, fn: () => void) => h('button', { title: t('tip.' + key), data: { act: key }, onclick: fn }, `${icon} ${t('act.' + key)}`);
  const chopMode = h('select', { 'aria-label': t('chop.mode'), title: t('chop.mode'), data: { role: 'chopmode' } }, ...[[16, t('chop.n', 16)], [8, t('chop.n', 8)], [0, t('chop.auto')]].map(([v, l]) => h('option', { value: String(v) }, String(l))));
  if (S.stretch.clip !== c.id) S.stretch = { clip: c.id, pct: 100, semis: 0 };
  const st = S.stretch;
  const bpm = h('input', { type: 'number', min: '40', max: '240', placeholder: '—', 'aria-label': t('st.bpm'), title: t('st.bpmTip'), data: { role: 'srcbpm' } });
  bpm.onchange = () => { const v = +bpm.value; if (v >= 20 && v <= 400) { st.pct = clamp(Math.round(v / S.project.bpm * 100), 50, 200); emit(); } };
  return h('div', { class: 'editor' },
    h('div', { class: 'ebar' }, h('strong', {}, typeIcon('audio'), ' ' + tr.name), clipTools(c),
      slider(t('clip.gain'), 0, 2, 0.01, c.gain ?? 1, v => c.gain = v, pct, '', false, 1),
      slider(t('clip.fadeIn'), 0, half, 1, Math.min(c.fadeIn ?? 0, half), v => c.fadeIn = v, sec, '', false, 0),
      slider(t('clip.fadeOut'), 0, half, 1, Math.min(c.fadeOut ?? 0, half), v => c.fadeOut = v, sec, '', false, 0),
      act('reverse', '⇄', reverseClip), act('normalize', '📈', normalizeClip),
      // V17 : le clip suit le tempo du morceau (étirement sans changer la hauteur), à partir de son tempo d'origine.
      h('button', { class: 'pill switch' + (c.warp ? ' on' : ''), role: 'switch', 'aria-checked': String(!!c.warp), title: t('warp.tip'), data: { act: 'warp' }, onclick: toggleWarp }, '🎚 ' + t('warp.label')),
      c.warp && h('label', { class: 'fld mini-in' }, t('warp.ref'), (() => {
        const i = h('input', { type: 'number', min: '20', max: '400', step: '0.01', value: String(c.srcBpm ?? S.project.bpm), 'aria-label': t('warp.ref'), title: t('warp.refTip'), data: { role: 'warpbpm' } });
        i.onchange = () => setWarpBpm(+i.value); return i;
      })()),
      (c.takes?.length ?? 0) > 1 && h('div', { class: 'segs', role: 'group', 'aria-label': t('take.title'), title: t('take.tip') },
        ...c.takes!.map((_, i) => h('button', { class: 'seg' + (c.take === i && !c.comp ? ' on' : ''), data: { take: String(i) }, 'aria-pressed': String(c.take === i && !c.comp), onclick: () => chooseTake(i) }, `${t('clip.take')} ${i + 1}`))),
      // Fondu enchaîné (V19) : seulement quand un autre clip audio finit juste où celui-ci commence.
      leftNeighbour(tr, c) && slider(t('xf.label'), 0, Math.max(1, Math.min(8, c.len)), 0.25, Math.min(c.xfade ?? 0, 8), v => setXfade(v), v => v ? sec(v) : t('xf.none'), 'xf')),
    (c.takes?.length ?? 0) > 1 && compPanel(c),
    h('div', { class: 'ebar' }, h('span', { class: 'sect' }, t('st.title')),
      slider(t('st.length'), 50, 200, 1, st.pct, v => { st.pct = v; }, v => v + ' %', '', true, 100),
      h('label', { class: 'fld mini-in' }, t('st.bpm'), bpm),
      slider(t('st.pitch'), -12, 12, 1, st.semis, v => { st.semis = v; }, v => (v > 0 ? '+' : '') + v + ' st', '', true, 0),
      act('stretch', '⏱', () => stretchClip(st.pct, st.semis)),
      h('span', { class: 'sect' }, t('tune.title')),
      slider(t('tune.amount'), 0.1, 1, 0.05, S.tuneAmt, v => { S.tuneAmt = v; }, pct, '', true),
      act('tune', '🎤', () => tuneClip(S.tuneAmt)),
      h('span', { class: 'sect' }, t('chop.title')), chopMode,
      act('chop', '🔪', () => chopClip(+chopMode.value))),
    inputPanel(), cv, h('p', { class: 'tip pad-x' }, t('hint.audioClip')));
}
// ---------- Comping (V19) : la meilleure prise, portion par portion ----------
/** Position du curseur clavier dans les lignes de prises (pas depuis le début du clip). */
let compCur = 0;
function compPanel(c: Clip) {
  const g = Math.max(1, S.snap), st = srcStep(S.project, c), n = c.takes!.length;
  if (compCur >= c.len) compCur = 0;
  const row = (k: number) => {
    const cv = h('canvas', { class: 'cwave' });
    const lane = h('div', { class: 'ctake', tabIndex: 0, role: 'group', data: { lane: String(k) }, 'aria-label': t('comp.row', k + 1), title: t('comp.rowTip') }, cv);
    // Portions où cette prise est jouée, et curseur clavier.
    const segs = c.comp ?? [{ s: 0, take: c.take ?? 0 }];
    segs.forEach((sg, i) => { if (sg.take !== k) return; const b = i + 1 < segs.length ? segs[i + 1].s : c.len; lane.append(h('i', { class: 'cused', style: `left:${sg.s / c.len * 100}%;width:${(b - sg.s) / c.len * 100}%` })); });
    lane.append(h('b', { class: 'ccur', style: `left:${compCur / c.len * 100}%;width:${Math.min(g, c.len - compCur) / c.len * 100}%` }));
    queueMicrotask(() => {
      const w = cv.clientWidth || 600, hh = cv.clientHeight || 40; cv.width = w; cv.height = hh;
      const x = cv.getContext('2d')!; x.fillStyle = 'rgba(220,230,255,.55)';
      if (c.bufferId) drawWave(x, c.bufferId, c.takes![k], c.takes![k] + c.len * st, w, hh);
    });
    const cell = (ev: PointerEvent) => { const r = lane.getBoundingClientRect(); return clamp(Math.floor((ev.clientX - r.left) / r.width * c.len / g) * g, 0, Math.max(0, c.len - 1e-9)); };
    lane.onpointerdown = e => {
      e.preventDefault(); lane.focus();
      const s0 = cell(e); let s1 = s0;
      const box = h('i', { class: 'csel' }); lane.append(box);
      const show = () => { const lo = Math.min(s0, s1), hi = Math.min(c.len, Math.max(s0, s1) + g); box.style.cssText = `left:${lo / c.len * 100}%;width:${(hi - lo) / c.len * 100}%`; };
      show();
      followDrag(e, ev => { s1 = cell(ev); show(); }, () => { box.remove(); compCur = Math.min(s0, s1); compTake(k, Math.min(s0, s1), Math.max(s0, s1) + g); refocus(k); }, () => box.remove());
    };
    lane.onkeydown = e => {
      const move = (d: number) => { compCur = clamp(compCur + d, 0, Math.max(0, Math.ceil(c.len / g) - 1) * g); lane.querySelector<HTMLElement>('.ccur')!.style.left = compCur / c.len * 100 + '%'; };
      if (e.key === 'ArrowRight') move(g); else if (e.key === 'ArrowLeft') move(-g);
      else if (e.key === 'Home') move(-c.len); else if (e.key === 'End') move(c.len);
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') document.querySelector<HTMLElement>(`.ctake[data-lane="${clamp(k + (e.key === 'ArrowDown' ? 1 : -1), 0, n - 1)}"]`)?.focus();
      else if (e.key === 'Enter' || e.key === ' ') { compTake(k, compCur, compCur + g); refocus(k); }
      else return;
      e.preventDefault(); e.stopPropagation();
    };
    return h('div', { class: 'crow' }, h('span', { class: 'ctk' + (c.comp ? '' : c.take === k ? ' on' : ''), 'aria-hidden': 'true' }, `${t('clip.take')} ${k + 1}`), lane);
  };
  const refocus = (k: number) => queueMicrotask(() => document.querySelector<HTMLElement>(`.ctake[data-lane="${k}"]`)?.focus());
  return h('div', { class: 'comp', role: 'group', 'aria-label': t('comp.title') },
    h('div', { class: 'chead' }, h('span', { class: 'sect' }, t('comp.title')), h('span', { class: 'tip' }, t('comp.tip')),
      h('span', { class: 'cstat', role: 'status' }, c.comp ? t('comp.state', c.comp.length) : t('comp.single', (c.take ?? 0) + 1))),
    ...c.takes!.map((_, k) => row(k)));
}
