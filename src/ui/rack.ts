import { addInsert, addWam, moveInsert, removeInsert, saveWamStates } from '../actions';
import { liveWams, wamKey } from '../audio/wam';
import { engine } from '../audio/engine';
import { t } from '../i18n';
import { S, commit } from '../store';
import { FX, Insert, Track } from '../types';
import { h, slider, toast } from './dom';

const dlg = () => document.getElementById('fx') as HTMLDialogElement;
let current = '';
const find = (): Track | undefined => [...S.project.tracks, ...S.project.buses].find(x => x.id === current);

const fmt = (type: string, key: string, v: number) =>
  key === 'mix' || key === 'depth' || key === 'fb' ? Math.round(v * 100) + ' %'
    : key === 'gain' ? (v > 0 ? '+' : '') + v.toFixed(1) + ' dB'
      : key === 'freq' ? (v >= 1000 ? (v / 1000).toFixed(1) + ' kHz' : Math.round(v) + ' Hz')
        : key === 'rate' ? v.toFixed(2) + ' Hz' : key === 'size' ? v.toFixed(1) + ' s' : type === 'delay' && key === 'time' ? v + '/16' : v.toFixed(1);

function card(tr: Track, ins: Insert, i: number) {
  const name = ins.type === 'wam' ? (ins.name || t('fx.wam')) : t('fxn.' + ins.type);
  const btn = (act: string, label: string, tip: string, fn: () => void, off = false) => h('button', { class: 'mini', data: { act }, title: tip, 'aria-label': `${tip} – ${name}`, disabled: off, onclick: fn }, label);
  const body = h('div', { class: 'fxbody' }, ...(FX[ins.type] ?? []).map(([k, min, max, step]) => slider(t('fxp.' + k), min, max, step, ins.p[k], v => { ins.p[k] = v; }, v => fmt(ins.type, k, v))));
  if (ins.type === 'wam') {
    // L'interface du plugin est fournie par le plugin lui-même, dès qu'il est chargé.
    const inst = liveWams.get(wamKey(tr.id, ins.id));
    if (!inst) body.append(h('p', { class: 'tip', data: { wam: 'loading' } }, t('wam.loading')));
    else if (inst.createGui) inst.createGui().then(gui => { gui.dataset.wam = 'gui'; body.append(gui); }, () => body.append(h('p', { class: 'tip' }, t('wam.noGui'))));
    else body.append(h('p', { class: 'tip' }, t('wam.noGui')));
  }
  return h('div', { class: 'fxcard' + (ins.on ? '' : ' off'), data: { ins: ins.id } },
    h('div', { class: 'fxhead' },
      h('button', { class: 'mini' + (ins.on ? ' on solo' : ''), data: { act: 'fxon' }, 'aria-pressed': String(ins.on), title: t('fx.on'), 'aria-label': `${t('fx.on')} – ${name}`, onclick: () => { ins.on = !ins.on; commit(); } }, ins.on ? 'ON' : 'OFF'),
      h('strong', {}, `${i + 1}. ${name}`),
      btn('fxup', '▲', t('fx.up'), () => moveInsert(tr.id, ins.id, -1), i === 0), btn('fxdown', '▼', t('fx.down'), () => moveInsert(tr.id, ins.id, 1), i === tr.inserts.length - 1),
      btn('fxdel', '✕', t('fx.del'), () => removeInsert(tr.id, ins.id))),
    body);
}

function render() {
  const tr = find(), d = dlg();
  if (!tr) { if (d.open) d.close(); return; }
  const add = h('select', { 'aria-label': t('fx.add'), data: { role: 'fxadd' } }, h('option', { value: '' }, '＋ ' + t('fx.add') + '…'),
    ...Object.keys(FX).filter(k => k !== 'wam').map(k => h('option', { value: k }, t('fxn.' + k))),
    h('optgroup', { label: t('fx.wam') }, h('option', { value: 'wam:wam/kh-tape/index.js' }, 'KH Tape Echo'), h('option', { value: 'wam:?' }, t('wam.url'))));
  add.onchange = () => {
    const v = add.value; add.value = '';
    if (v.startsWith('wam:')) addWam(tr.id, v === 'wam:?' ? null : v.slice(4), v === 'wam:?' ? undefined : 'KH Tape Echo'); else if (v) addInsert(tr.id, v);
  };
  d.replaceChildren(
    h('h2', {}, `🧩 ${t('fx.title')} — ${tr.name}`),
    h('p', { class: 'tip' }, t('fx.help')),
    tr.inserts.length ? h('div', { class: 'fxlist' }, ...tr.inserts.map((ins, i) => card(tr, ins, i))) : h('p', { class: 'tip', data: { empty: '1' } }, t('fx.none')),
    h('div', { class: 'fxfoot' }, add, h('form', { method: 'dialog' }, h('button', { class: 'pill accent' }, t('lib.close')))));
}

/** Ouvre la chaîne d'effets d'une tranche (piste ou bus). */
export function showRack(trackId: string) {
  current = trackId; render();
  const d = dlg();
  d.onclose = () => { saveWamStates(); current = ''; };
  if (!d.open) d.showModal();
}
/** À appeler quand le projet change : met à jour la fenêtre si elle est ouverte. */
export function refreshRack() { if (dlg().open && current) render(); }
engine.mix.onWam = (_tid, _iid, ok) => { if (!ok) toast(t('wam.failed'), 'error'); refreshRack(); };
