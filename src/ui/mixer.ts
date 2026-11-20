import { addBus, addSend, analyzeMix, applyMixPreset, deleteBus, removeSend } from '../actions';
import { engine, measureLoad } from '../audio/engine';
import { t } from '../i18n';
import { clearMidiMap, ccOf, learn } from '../input';
import { S, commit, emit, select } from '../store';
import { MIX_PRESETS, Project, Track, blankProject, newTrack } from '../types';
import { ICON } from './arr';
import { showRack } from './rack';
import { meter, updateLevels } from './meters';
import { db, h, pct, resettable, slider } from './dom';

/** Valeurs d'origine d'une tranche et du général : là où reviennent les curseurs sur un double-clic. */
let dTrack: Track | undefined, dProj: Project | undefined;
const defTrack = () => dTrack ??= newTrack('audio', 1), defProj = () => dProj ??= blankProject();

function fader(label: string, value: number, set: (v: number) => void, def: number) {
  const inp = h('input', { type: 'range', class: 'vert', min: '0', max: '1.25', step: '0.01', 'aria-label': label, title: label });
  inp.value = String(value);
  const out = h('span', { class: 'val' }, pct(value));
  const apply = (v: number) => { set(v); out.textContent = pct(v); engine.sync(); };
  inp.oninput = () => apply(+inp.value);
  inp.onchange = () => commit();
  resettable(inp, def, apply, commit, t('sl.resetTip'));
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

// ---------- Sections repliables des tranches ----------
export const SECTS = ['eq', 'fx', 'send', 'dyn'] as const;
export type Sect = typeof SECTS[number];
/** Sections ouvertes ou repliées, pour tout le mixeur ; gardé d'une séance à l'autre sur cet appareil. */
export const sectOpen: Record<Sect, boolean> = (() => {
  const d: Record<Sect, boolean> = { eq: true, fx: true, send: true, dyn: true };
  try { const v = JSON.parse(localStorage.getItem('kh-mix-sect') || '{}'); for (const k of SECTS) if (typeof v[k] === 'boolean') d[k] = v[k]; } catch { /* stockage désactivé */ }
  return d;
})();
/** Sections d'une tranche qui contiennent un réglage actif (un point les signale, pour ne rien oublier dans une section repliée). */
export function stripActive(tr: Track): Record<Sect, boolean> {
  return {
    eq: !!(tr.eqHigh || tr.eqMid || tr.eqLow),
    fx: !!(tr.filter || tr.drive || tr.rev || tr.dly || tr.chorus || tr.trem || tr.crush || tr.inserts.some(i => i.on !== false)),
    send: !!tr.sends?.length,
    dyn: !!(tr.comp || tr.duck),
  };
}
function sect(key: Sect, active: boolean, ...kids: (Node | false | null | undefined)[]) {
  const d = h('details', { class: 'msec' + (active ? ' act' : ''), data: { sect: key } });
  d.open = sectOpen[key];
  d.append(h('summary', { title: t('mix.sectTip') }, h('span', { class: 'sect' }, t('mix.sect.' + key)), active && h('i', { class: 'sdot', role: 'img', title: t('mix.sectOn'), 'aria-label': t('mix.sectOn') })),
    h('div', { class: 'mbody' }, ...kids));
  // Replier une section la replie sur toutes les tranches : le mixeur garde des lignes alignées.
  d.addEventListener('toggle', () => {
    if (d.open === sectOpen[key]) return;
    sectOpen[key] = d.open;
    try { localStorage.setItem('kh-mix-sect', JSON.stringify(sectOpen)); } catch { /* stockage désactivé */ }
    document.querySelectorAll<HTMLDetailsElement>(`details.msec[data-sect=${key}]`).forEach(x => { x.open = d.open; });
  });
  return d;
}

export const filterFmt = (v: number) => Math.abs(v) < 0.02 ? '—' : (v < 0 ? 'LP ' : 'HP ') + Math.round(Math.abs(v) * 100);

function strip(tr: Track, i: number, bus = false) {
  const f = fader(`${t('mix.volume')} – ${tr.name}`, tr.vol, v => tr.vol = v, defTrack().vol);
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
  const act = stripActive(tr), D = defTrack();
  return h('div', { class: 'strip' + (bus ? ' bus' : S.selTrack === tr.id ? ' sel' : ''), data: { id: tr.id }, style: `--c:${tr.color}`, onpointerdown: () => { if (!bus) select(tr.id, S.selTrack === tr.id ? S.selClip : ''); } },
    bus ? h('div', { class: 'shead' }, h('span', { class: 'sname' }, '🔀'), bname, preset,
      h('button', { class: 'mini del', data: { act: 'busdel' }, title: t('bus.del'), 'aria-label': `${t('bus.del')} – ${tr.name}`, onclick: () => deleteBus(tr.id) }, '✕'))
      : h('div', { class: 'shead' }, h('div', { class: 'sname', title: tr.name }, `${ICON[tr.type]} ${tr.name}`), out, preset),
    h('canvas', { class: 'eqc', width: 280, height: 46, data: { eq: tr.id }, role: 'img', 'aria-label': `${t('mix.eqCurve')} – ${tr.name}`, title: t('mix.eqCurve') }),
    h('div', { class: 'sbody' },
      h('div', { class: 'scol' },
        sect('eq', act.eq,
          slider(t('mix.high'), -15, 15, 0.5, tr.eqHigh, v => tr.eqHigh = v, db, '', false, D.eqHigh),
          slider(t('mix.mid'), -15, 15, 0.5, tr.eqMid, v => tr.eqMid = v, db, '', false, D.eqMid),
          slider(t('mix.midF'), 200, 8000, 10, tr.eqMidF, v => tr.eqMidF = v, hz, '', false, D.eqMidF),
          slider(t('mix.low'), -15, 15, 0.5, tr.eqLow, v => tr.eqLow = v, db, '', false, D.eqLow)),
        sect('fx', act.fx,
          T(slider(t('mix.filter'), -1, 1, 0.01, tr.filter, v => tr.filter = Math.abs(v) < 0.03 ? 0 : v, filterFmt, '', false, D.filter), 'filter'),
          T(slider(t('mix.drive'), 0, 1, 0.01, tr.drive, v => tr.drive = v, pct, '', false, D.drive), 'drive'),
          T(slider(t('mix.reverb'), 0, 1, 0.01, tr.rev, v => tr.rev = v, pct, '', false, D.rev), 'rev'),
          T(slider(t('mix.echo'), 0, 1, 0.01, tr.dly, v => tr.dly = v, pct, '', false, D.dly), 'dly'),
          T(slider(t('mix.chorus'), 0, 1, 0.01, tr.chorus, v => tr.chorus = v, pct, '', false, D.chorus), 'chorus'),
          T(slider(t('mix.trem'), 0, 1, 0.01, tr.trem, v => tr.trem = v, pct, '', false, D.trem), 'trem'),
          T(slider(t('mix.crush'), 0, 1, 0.01, tr.crush, v => tr.crush = v, pct, '', false, D.crush), 'crush'),
          h('button', { class: 'mini rackb' + (tr.inserts.length ? ' has' : ''), data: { act: 'rack' }, title: t('fx.open'), onclick: () => showRack(tr.id) }, `🧩 ${t('fx.title')}${tr.inserts.length ? ` (${tr.inserts.length})` : ''}`)),
        !bus && sect('send', act.send, sends(tr)),
        sect('dyn', act.dyn,
          tog('comp', t('mix.comp')),
          tr.comp && slider(t('mix.compThr'), -60, 0, 1, tr.compThr, v => tr.compThr = v, v => v + ' dB', '', false, D.compThr),
          tr.comp && slider(t('mix.compRatio'), 1, 20, 0.5, tr.compRatio, v => tr.compRatio = v, v => v + ':1', '', false, D.compRatio),
          tr.comp && h('span', { class: 'gr', data: { gr: tr.id }, title: t('mix.grTip') }, ''),
          T(slider(t('mix.duck'), 0, 1, 0.01, tr.duck, v => tr.duck = v, pct, '', false, D.duck), 'duck'),
          !bus && scSource(tr))),
      h('div', { class: 'fcol' },
        // Le panoramique reste sous la main, au-dessus du fader, avec le volume, le muet et le solo.
        T(slider(t('mix.pan'), -1, 1, 0.01, tr.pan, v => tr.pan = v, panFmt, 'panc', false, D.pan), 'pan'),
        h('div', { class: 'fwrap' }, meter(tr.id, tr.name), bus ? f.inp : tag(f.inp, `${i}:vol`)),
        f.out,
        h('div', { class: 'srow' }, tog('mute', 'M'), !bus && tog('solo', 'S')))));
}

// ---------- Sidechain et envois libres (V19) ----------
/** Source du sidechain : le kick du séquenceur (comme avant) ou n'importe quelle autre piste. */
function scSource(tr: Track) {
  const sel = h('select', { class: 'mpreset', 'aria-label': `${t('sc.src')} – ${tr.name}`, title: t('sc.srcTip'), data: { role: 'scsrc' } },
    h('option', { value: '', selected: !tr.sc }, '⚡ ' + t('sc.kick')),
    ...S.project.tracks.filter(x => x !== tr && !x.frozen).map(x => h('option', { value: x.id, selected: tr.sc === x.id }, '⚡ ' + x.name)));
  sel.onchange = () => { if (sel.value) tr.sc = sel.value; else delete tr.sc; commit(); };
  return sel;
}
/** Envois de la piste vers les bus : bus, niveau, avant ou après le volume. */
function sends(tr: Track) {
  const rows = (tr.sends ?? []).map((sd, j) => {
    const bus = h('select', { class: 'mpreset', 'aria-label': `${t('send.bus')} ${j + 1} – ${tr.name}`, data: { role: 'sendbus' } }, ...S.project.buses.map(b => h('option', { value: b.id, selected: sd.bus === b.id }, '→ ' + b.name)));
    bus.onchange = () => { sd.bus = bus.value; commit(); };
    const pre = h('button', { class: 'mini' + (sd.pre ? ' on' : ''), data: { act: 'sendpre' }, 'aria-pressed': String(sd.pre), title: t('send.preTip'), 'aria-label': `${t('send.pre')} – ${t('send.bus')} ${j + 1}`, onclick: () => { sd.pre = !sd.pre; commit(); } }, sd.pre ? t('send.pre') : t('send.post'));
    const del = h('button', { class: 'mini del', data: { act: 'senddel' }, title: t('send.del'), 'aria-label': `${t('send.del')} ${j + 1} – ${tr.name}`, onclick: () => removeSend(tr, sd.id) }, '✕');
    return h('div', { class: 'send', data: { send: sd.id } }, h('div', { class: 'srow' }, bus, pre, del), slider(`${t('send.level')} ${j + 1}`, 0, 1, 0.01, sd.amt, v => { sd.amt = v; }, pct, 'sendl', false, 0.5));
  });
  return h('div', { class: 'sends' }, ...rows,
    h('button', { class: 'mini', data: { act: 'sendadd' }, title: t('send.addTip'), onclick: () => addSend(tr) }, '＋ ' + t('send.add')));
}

let lastResult = '';

export function renderMixer(): HTMLElement {
  const p = S.project;
  const target = h('select', { 'aria-label': t('mix.target'), title: t('mix.targetTip'), data: { role: 'target' } }, ...[0, -14, -9, -23].map(v => h('option', { value: String(v), selected: p.target === v }, t('mix.target' + v))));
  target.onchange = () => { p.target = +target.value; commit(); };
  const result = h('span', { class: 'lufs', role: 'status' }, lastResult);
  const m = fader(t('mix.master'), p.master, v => p.master = v, defProj().master), DP = defProj();
  const root = h('div', { class: 'mixer' + (learn.on ? ' learning' : '') },
    h('div', { class: 'mtools' },
      h('button', { class: 'pill' + (learn.on ? ' on' : ''), data: { act: 'learn' }, 'aria-pressed': String(learn.on), title: t('learn.tip'), onclick: () => { learn.on = !learn.on; learn.target = ''; emit(); } }, '🎛 ' + t('learn.title')),
      learn.on && h('p', { class: 'tip' }, t(learn.target ? 'learn.move' : 'learn.pick')),
      Object.keys(learn.map).length > 0 && h('button', { class: 'pill', data: { act: 'learnclear' }, onclick: clearMidiMap }, t('learn.clear')),
      h('button', { class: 'pill', data: { act: 'busadd' }, title: t('bus.addTip'), onclick: addBus }, '＋ ' + t('bus.add')),
      loadBtn(),
      h('canvas', { class: 'spec', width: 150, height: 70, role: 'img', 'aria-label': t('mix.spectrum'), title: t('mix.spectrum') })),
    ...p.tracks.map((tr, i) => strip(tr, i)), ...p.buses.map((b, i) => strip(b, i, true)),
    h('div', { class: 'strip master', style: '--c:#fff' },
      h('div', { class: 'sname' }, '🔊 ' + t('mix.master')),
      h('div', { class: 'sbody' },
        h('div', { class: 'scol' },
          h('span', { class: 'sect' }, t('mix.reverb')),
          slider(t('mix.revSize'), 0.4, 6, 0.1, p.revSize, v => p.revSize = v, v => v.toFixed(1) + ' s', '', false, DP.revSize),
          h('span', { class: 'sect' }, t('mix.echo')),
          slider(t('mix.dlyTime'), 1, 8, 1, p.dlySteps, v => p.dlySteps = v, v => v + '/16', '', false, DP.dlySteps),
          slider(t('mix.dlyFb'), 0, 0.85, 0.01, p.dlyFb, v => p.dlyFb = v, pct, '', false, DP.dlyFb),
          h('span', { class: 'sect' }, t('mix.eq')),
          slider(t('mix.high'), -12, 12, 0.5, p.mHigh, v => p.mHigh = v, db, '', false, DP.mHigh),
          slider(t('mix.mid'), -12, 12, 0.5, p.mMid, v => p.mMid = v, db, '', false, DP.mMid),
          slider(t('mix.low'), -12, 12, 0.5, p.mLow, v => p.mLow = v, db, '', false, DP.mLow),
          slider(t('mix.width'), 0, 2, 0.01, p.width, v => p.width = Math.abs(v - 1) < 0.04 ? 1 : v, pct, '', false, DP.width),
          h('span', { class: 'sect' }, t('mix.export')), target,
          h('button', { class: 'mini', data: { act: 'analyze' }, title: t('mix.analyzeTip'), onclick: async () => { lastResult = await analyzeMix(); result.textContent = lastResult; } }, '📊 ' + t('mix.analyze')), result),
        h('div', { class: 'fcol' },
        h('div', { class: 'fwrap' }, meter('master', t('mix.master')), tag(m.inp, 'm:master')),
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
  drawSpectrum(); drawEq(); updateLevels();
}

// ---------- Indicateur de charge (V17) ----------
let lastLoad = '', lastLevel = '';
/** Mesure la charge de calcul du mixage (4 s à partir de la tête de lecture) et l'affiche, avec les retards de la dernière lecture. */
function loadBtn() {
  const out = h('span', { class: 'loadres ' + lastLevel, role: 'status', data: { role: 'load' } }, lastLoad);
  const b = h('button', { class: 'pill', data: { act: 'load' }, title: t('load.tip') }, '⚡ ' + t('load.title'));
  b.onclick = async () => {
    b.disabled = true; out.textContent = t('load.measuring');
    try {
      const r = await measureLoad(S.project, Math.floor(engine.pos), 4), pct = Math.round(r.ratio * 100), u = engine.underruns();
      lastLevel = r.ratio < 0.4 ? 'ok' : r.ratio < 0.7 ? 'warn' : 'high';
      lastLoad = t('load.result', pct, r.tracks, r.inserts) + ' ' + t('load.' + lastLevel) +
        (engine.perf.steps ? ' ' + t('load.late', engine.perf.late, engine.perf.steps) : '') + (u !== null ? ' ' + t('load.underruns', u) : '');
    } catch { lastLoad = t('toast.emptyProject'); lastLevel = ''; }
    out.className = 'loadres ' + lastLevel; out.textContent = lastLoad; b.disabled = false;
  };
  return h('span', { class: 'loadbox' }, b, out);
}
