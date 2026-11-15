import { addAu, addInsert, addWam, moveInsert, removeInsert, saveWamStates } from '../actions';
import { AuInstance, AuParam, auBridge, auFromPos, auList, auLog, auName, auToPos } from '../audio/au';
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

/** Valeur d'un réglage d'Audio Unit, selon son unité (codes Core Audio). */
function auFmt(pr: AuParam, v: number): string {
  const n = (x: number, d = 1) => (Math.abs(x) >= 100 ? Math.round(x).toString() : x.toFixed(d));
  switch (pr.unit) {
    case 2: return v >= 0.5 ? 'ON' : 'OFF';
    case 1: case 11: case 12: return String(Math.round(v));
    case 3: return n(v) + ' %';
    case 4: return n(v, 2) + ' s';
    case 24: return n(v) + ' ms';
    case 8: case 7: return v >= 1000 ? (v / 1000).toFixed(2) + ' kHz' : n(v) + ' Hz';
    case 9: case 20: return n(v) + ' ct';
    case 10: return n(v) + ' st';
    case 13: return (v > 0 ? '+' : '') + n(v) + ' dB';
    case 15: return n(v) + '°';
    case 25: return n(v, 2) + ':1';
    case 22: return n(v) + ' BPM';
    default: return n(v, 2);
  }
}
/** Réglages d'un plugin du Mac : un curseur par réglage, lu dans le plugin une fois chargé. */
function auBody(tr: Track, ins: Insert, body: HTMLElement) {
  if (!auBridge()) { body.append(h('p', { class: 'tip', data: { au: 'unavailable' } }, t('au.unavailable'))); return; }
  const inst = liveWams.get(wamKey(tr.id, ins.id)) as AuInstance | undefined;
  if (!inst) { body.append(h('p', { class: 'tip', data: { wam: 'loading' } }, t('wam.loading'))); return; }
  if (!inst.params.length) { body.append(h('p', { class: 'tip', data: { au: 'noparams' } }, t('au.noParams'))); return; }
  const grid = h('div', { class: 'aupar', data: { au: 'params' } }, ...inst.params.map(pr => {
    const k = String(pr.address), whole = pr.unit === 1 || pr.unit === 2 || pr.unit === 11 || pr.unit === 12;
    const step = whole ? 1 : (pr.max - pr.min) / 1000 || 0.001, val = ins.p[k] ?? pr.value;
    // Fréquences : curseur logarithmique (la course est en position 0 à 1, la valeur reste en Hz dans le projet).
    const sl = auLog(pr)
      ? slider(pr.name, 0, 1, 0.001, auToPos(pr, val), x => { ins.p[k] = auFromPos(pr, x); }, x => auFmt(pr, auFromPos(pr, x)))
      : slider(pr.name, pr.min, pr.max, step, val, v => { ins.p[k] = v; }, v => auFmt(pr, v));
    sl.dataset.addr = k; sl.dataset.scale = auLog(pr) ? 'log' : 'lin';
    return sl;
  }));
  const reset = h('button', { class: 'pill', data: { act: 'aureset' }, onclick: () => { ins.p = Object.fromEntries(inst.params.map(pr => [String(pr.address), pr.def])); commit(); } }, '↺ ' + t('au.reset'));
  body.append(grid, reset);
}

function card(tr: Track, ins: Insert, i: number) {
  const name = ins.type === 'wam' ? (ins.name || t('fx.wam')) : ins.type === 'au' ? '🍎 ' + (ins.name || t('au.plugin')) : t('fxn.' + ins.type);
  const btn = (act: string, label: string, tip: string, fn: () => void, off = false) => h('button', { class: 'mini', data: { act }, title: tip, 'aria-label': `${tip} – ${name}`, disabled: off, onclick: fn }, label);
  const body = h('div', { class: 'fxbody' }, ...(FX[ins.type] ?? []).map(([k, min, max, step]) => slider(t('fxp.' + k), min, max, step, ins.p[k], v => { ins.p[k] = v; }, v => fmt(ins.type, k, v))));
  if (ins.type === 'wam') {
    // L'interface du plugin est fournie par le plugin lui-même, dès qu'il est chargé.
    const inst = liveWams.get(wamKey(tr.id, ins.id));
    if (!inst) body.append(h('p', { class: 'tip', data: { wam: 'loading' } }, t('wam.loading')));
    else if (inst.createGui) inst.createGui().then(gui => { gui.dataset.wam = 'gui'; body.append(gui); }, () => body.append(h('p', { class: 'tip' }, t('wam.noGui'))));
    else body.append(h('p', { class: 'tip' }, t('wam.noGui')));
  }
  if (ins.type === 'au') auBody(tr, ins, body);
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
  const macs = auList();
  const add = h('select', { 'aria-label': t('fx.add'), data: { role: 'fxadd' } }, h('option', { value: '' }, '＋ ' + t('fx.add') + '…'),
    ...Object.keys(FX).filter(k => k !== 'wam').map(k => h('option', { value: k }, t('fxn.' + k))),
    h('optgroup', { label: t('fx.wam') }, h('option', { value: 'wam:wam/kh-tape/index.js' }, 'KH Tape Echo'), h('option', { value: 'wam:?' }, t('wam.url'))),
    // Plugins Audio Unit installés sur le Mac (version bureau macOS seulement).
    ...macs.length ? [h('optgroup', { label: '🍎 ' + t('au.group'), data: { role: 'aulist' } }, ...macs.map(d => h('option', { value: `au:${d.type}:${d.subtype}:${d.manufacturer}` }, auName(d.name))))] : []);
  add.onchange = () => {
    const v = add.value; add.value = '';
    if (v.startsWith('au:')) { const d = macs.find(x => `au:${x.type}:${x.subtype}:${x.manufacturer}` === v); if (d) addAu(tr.id, v.slice(3), auName(d.name)); }
    else if (v.startsWith('wam:')) addWam(tr.id, v === 'wam:?' ? null : v.slice(4), v === 'wam:?' ? undefined : 'KH Tape Echo'); else if (v) addInsert(tr.id, v);
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
  // L'événement de fermeture arrive en différé : s'il suit une réouverture immédiate, la fenêtre est de nouveau ouverte, on l'ignore.
  d.onclose = () => { if (d.open) return; saveWamStates(); current = ''; };
  if (!d.open) d.showModal();
}
/** À appeler quand le projet change : met à jour la fenêtre si elle est ouverte. */
export function refreshRack() { if (dlg().open && current) render(); }
engine.mix.onWam = (tid, iid, ok) => {
  const au = [...S.project.tracks, ...S.project.buses].find(x => x.id === tid)?.inserts.find(i => i.id === iid)?.type === 'au';
  if (!ok) toast(t(au ? 'au.failed' : 'wam.failed'), 'error');
  refreshRack();
};
