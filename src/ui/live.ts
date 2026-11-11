import { tapTempo } from '../actions';
import { engine } from '../audio/engine';
import { t } from '../i18n';
import { S, commit } from '../store';
import { ICON } from './arr';
import { h, slider } from './dom';
import { filterFmt } from './mixer';

/** Vue Live : chaque colonne est une piste, chaque ligne une scène. */
export function renderLive(): HTMLElement {
  const p = S.project;
  const cols = p.tracks.map(tr => ({ tr, clips: [...tr.clips].sort((a, b) => a.start - b.start) }));
  const rows = Math.max(1, ...cols.map(c => c.clips.length));
  const grid = h('div', { class: 'lgrid', style: `grid-template-columns:76px repeat(${cols.length}, minmax(120px, 170px))` });
  grid.append(h('div', { class: 'lcorner' }, t('live.scene')));
  for (const { tr } of cols) grid.append(h('div', { class: 'lhead', style: `--c:${tr.color}`, title: tr.name },
    h('span', {}, `${ICON[tr.type]} ${tr.name}`),
    h('button', { class: 'mini mute' + (tr.mute ? ' on' : ''), data: { lmute: tr.id }, title: t('mix.mute'), 'aria-label': `${t('mix.mute')} – ${tr.name}`, 'aria-pressed': String(tr.mute), onclick: () => { tr.mute = !tr.mute; commit(); } }, 'M')));
  for (let i = 0; i < rows; i++) {
    grid.append(h('button', { class: 'lscene', data: { scene: String(i) }, title: t('live.launchScene', i + 1), onclick: () => engine.launchScene(i) }, `▶ ${i + 1}`));
    for (const { tr, clips } of cols) {
      const c = clips[i];
      grid.append(c
        ? h('button', { class: 'lcell', style: `--c:${tr.color}`, data: { track: tr.id, clip: c.id }, title: t('live.launch', c.name), onclick: () => engine.launch(tr.id, c.id) }, h('span', { class: 'lplay' }, '▶'), c.name)
        : h('div', { class: 'lcell none' }));
    }
  }
  grid.append(h('button', { class: 'lscene stopall', data: { act: 'stopall' }, title: t('live.stopAll'), onclick: () => engine.stop() }, '■'));
  for (const { tr } of cols) grid.append(h('button', { class: 'lstop', data: { stop: tr.id }, title: t('live.stop', tr.name), 'aria-label': t('live.stop', tr.name), onclick: () => engine.launch(tr.id, null) }, '■'));

  const filt = slider(t('live.filter'), -1, 1, 0.01, p.filter, v => p.filter = Math.abs(v) < 0.04 ? 0 : v, filterFmt, 'wide');
  // Effets momentanés : actifs tant que le bouton est maintenu.
  const fxBtn = (name: string) => {
    const b = h('button', { class: 'pill fx', data: { fx: name }, title: t('fx.tip') }, t('fx.' + name));
    const set = (on: boolean) => { engine.fx(name, on); b.classList.toggle('on', on); };
    b.onpointerdown = e => { e.preventDefault(); try { b.setPointerCapture(e.pointerId); } catch { /* pointeur synthétique */ } set(true); };
    b.onpointerup = b.onpointercancel = () => set(false);
    b.onkeydown = e => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); e.stopPropagation(); set(true); } };
    b.onkeyup = e => { if (e.key === ' ' || e.key === 'Enter') { e.stopPropagation(); set(false); } };
    return b;
  };
  const perf = h('div', { class: 'perf' },
    h('h3', {}, t('live.perf')), filt,
    h('div', { class: 'fxgrid' }, fxBtn('echo'), fxBtn('reverb'), fxBtn('stut8'), fxBtn('stut16')),
    h('button', { class: 'pill', data: { act: 'filter0' }, onclick: () => { p.filter = 0; commit(); } }, t('live.filterReset')),
    h('button', { class: 'pill big', data: { act: 'tap' }, onclick: tapTempo }, `${t('top.tap')} · ${p.bpm} BPM`),
    h('p', { class: 'tip' }, t('live.help')));
  queueMicrotask(refreshLive);
  return h('div', { class: 'live' }, h('div', { class: 'lscroll' }, cols.length ? grid : h('p', { class: 'bigtip' }, t('hint.noTracks'))), perf);
}

/** Met à jour l'état des cases (en lecture / en attente) sans reconstruire la grille. */
export function refreshLive() {
  document.querySelectorAll<HTMLElement>('.lcell[data-clip]').forEach(el => {
    const tid = el.dataset.track!, cid = el.dataset.clip!;
    el.classList.toggle('playing', engine.liveActive.get(tid)?.clipId === cid && engine.liveQueued.get(tid) === undefined);
    el.classList.toggle('queued', engine.liveQueued.get(tid) === cid);
    el.classList.toggle('ending', engine.liveActive.get(tid)?.clipId === cid && engine.liveQueued.has(tid) && engine.liveQueued.get(tid) !== cid);
  });
}
