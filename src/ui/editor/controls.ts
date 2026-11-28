// Clavier et molettes à l'écran, ligne des contrôles joués (pitch bend, modulation) sous le piano roll.
import { engine } from '../../audio/engine';
import { t } from '../../i18n';
import { ctlIn, kb, noteOff, noteOn } from '../../input';
import { commit, emit, revert, S } from '../../store';
import { Clip, CTL_REST, CtlKind } from '../../types';
import { clamp, followDrag, h } from '../dom';
import { isBlack, noteName } from './names';
import { okbDown, SW } from '../editor';

// ---------- Clavier à l'écran ----------
export function screenKeys() {
  // Deux octaves sur grand écran, une seule sur téléphone pour garder des touches assez larges pour le doigt.
  const base = 48 + kb.octave * 12, N = innerWidth < 760 ? 13 : 25, whites: number[] = [];
  for (let m = base; m < base + N; m++) if (!isBlack(m)) whites.push(m);
  const el = h('div', { class: 'okb-keys', style: `--nw:${N === 13 ? 8 : 15}` });
  whites.forEach(m => el.append(h('div', { class: 'wk', data: { m: String(m) } }, m % 12 === 0 ? noteName(m) : '')));
  for (let m = base; m < base + N; m++) if (isBlack(m)) {
    const i = whites.findIndex(w => w > m);
    el.append(h('div', { class: 'bk', data: { m: String(m) }, style: `left:calc(${i} * 100% / ${whites.length} - 100% / ${whites.length} * .3)` }));
  }
  // Plusieurs doigts, et glissé d'une touche à l'autre. Les doigts posés sont gardés hors de l'élément,
  // et suivis sur la fenêtre : un redessin pendant l'appui (enregistrement, bouton MIDI…) ne bloque plus de note.
  const at = (e: PointerEvent) => { const k = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>('.okb [data-m]'); return k ? +k.dataset.m! : null; };
  const mark = (m: number, on: boolean) => document.querySelector(`.okb [data-m="${m}"]`)?.classList.toggle('on', on);
  const set = (id: number, m: number | null) => {
    const cur = okbDown.get(id);
    if (cur === m || (cur === undefined && m === null)) return;
    if (cur !== undefined) { noteOff(cur); mark(cur, false); okbDown.delete(id); }
    if (m !== null && ![...okbDown.values()].includes(m)) { noteOn(m, 0.8); mark(m, true); okbDown.set(id, m); }
  };
  for (const m of okbDown.values()) el.querySelector(`[data-m="${m}"]`)?.classList.add('on');
  el.onpointerdown = e => {
    e.preventDefault(); const id = e.pointerId; set(id, at(e));
    const move = (u: PointerEvent) => { if (u.pointerId === id && okbDown.has(id)) set(id, at(u)); };
    const up = (u: PointerEvent) => { if (u.pointerId !== id) return; set(id, null); removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up); };
    addEventListener('pointermove', move); addEventListener('pointerup', up); addEventListener('pointercancel', up);
  };
  const oct = (d: number, label: string) => h('button', { class: 'pill', data: { act: d < 0 ? 'octdown' : 'octup' }, 'aria-label': t('help.k.octave') + ' ' + label, title: t('help.k.octave'), onclick: () => { kb.octave = clamp(kb.octave + d, -3, 3); emit(); } }, label);
  return h('div', { class: 'okb', role: 'group', 'aria-label': t('okb.title') }, h('div', { class: 'wheels' }, wheel('pb'), wheel('mod')), oct(-1, '−'), el, oct(1, '+'));
}
// ---------- Molettes à l'écran (V19) : pitch bend (revient au centre au relâchement) et modulation (reste où on la laisse) ----------
let bendHeld = 0;
const ctlFmt = (k: CtlKind, v: number) => k === 'pb' ? (v > 0 ? '+' : '') + Math.round(v * 100) + ' %' : Math.round(v * 100) + ' %';
function wheel(k: 'pb' | 'mod') {
  // Sur téléphone, les molettes sont couchées au-dessus du clavier, pour laisser aux touches toute la largeur.
  const lo = k === 'pb' ? -1 : 0, v0 = k === 'pb' ? bendHeld : engine.ctlNow.get(S.selTrack)?.mod ?? 0, flat = innerWidth < 760;
  const el = h('div', { class: 'wheel ' + k + (flat ? ' flat' : ''), role: 'slider', tabIndex: 0, 'aria-label': t('ctl.' + k), title: t('ctl.' + k + 'Tip'), 'aria-orientation': flat ? 'horizontal' : 'vertical',
    'aria-valuemin': String(lo), 'aria-valuemax': '1', 'aria-valuenow': v0.toFixed(2), 'aria-valuetext': ctlFmt(k, v0), data: { ctl: k }, style: `--v:${(v0 - lo) / (1 - lo)}` },
    h('i', {}), h('span', { class: 'wl', 'aria-hidden': 'true' }, k === 'pb' ? '↕' : '〰'));
  // Le glissé est suivi sur la fenêtre et l'affichage retrouvé par sélecteur : un redessin pendant le geste ne l'interrompt pas.
  const set = (v: number) => {
    v = Math.round(clamp(v, lo, 1) * 100) / 100;
    if (k === 'pb') bendHeld = v;
    ctlIn(k, v);
    for (const w of document.querySelectorAll<HTMLElement>(`.wheel[data-ctl=${k}]`)) { w.style.setProperty('--v', String((v - lo) / (1 - lo))); w.setAttribute('aria-valuenow', v.toFixed(2)); w.setAttribute('aria-valuetext', ctlFmt(k, v)); }
  };
  const back = () => { if (k === 'pb') set(0); };
  el.onpointerdown = e => {
    e.preventDefault(); el.focus();
    const r = el.getBoundingClientRect(), at = (ev: PointerEvent) => lo + (1 - lo) * (flat ? (ev.clientX - r.left) / r.width : (r.bottom - ev.clientY) / r.height);
    set(at(e)); followDrag(e, ev => set(at(ev)), back, back);
  };
  const cur = () => +(document.querySelector(`.wheel[data-ctl=${k}]`)?.getAttribute('aria-valuenow') ?? 0);
  el.onkeydown = e => {
    const d = { ArrowUp: 0.1, ArrowRight: 0.1, ArrowDown: -0.1, ArrowLeft: -0.1 }[e.key];
    if (d !== undefined) set(cur() + d); else if (e.key === 'Home') set(lo); else if (e.key === 'End') set(1); else return;
    e.preventDefault(); e.stopPropagation();
  };
  // Pitch bend au clavier : comme une vraie molette, il revient au centre quand on lâche la touche.
  el.onkeyup = e => { if (/^Arrow|Home|End/.test(e.key)) back(); };
  el.onblur = back;
  return el;
}
// ---------- Ligne des contrôles joués sous le piano roll (V19) ----------
/** Hauteur (0 en haut, 1 en bas) d'une valeur de contrôle dans la ligne. */
const ctlY = (k: CtlKind, v: number) => k === 'pb' ? (1 - v) / 2 : 1 - v;
export function ctlLane(c: Clip, W: number) {
  const k = S.ctlKind, H = 48, pts = () => c.ctl?.[k] ?? [];
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', String(W)); svg.setAttribute('height', String(H)); svg.setAttribute('class', 'ctl-svg');
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline'); svg.append(line);
  const draw = () => {
    const list = pts(), rest = CTL_REST[k], xy: string[] = [`0,${ctlY(k, rest) * H}`];
    for (const p of list) { if (!xy.length || xy.length === 1) xy.push(`${p.s * SW},${ctlY(k, rest) * H}`); xy.push(`${p.s * SW},${ctlY(k, p.v) * H}`); }
    xy.push(`${W},${ctlY(k, list.length ? list[list.length - 1].v : rest) * H}`);
    line.setAttribute('points', xy.join(' '));
  };
  draw();
  const lane = h('div', { class: 'vel ctl-lane', style: `width:${W}px;--sw:${SW}px`, role: 'img', 'aria-label': `${t('ctl.' + k)} : ${t('ctl.points', pts().length)}`, data: { kind: k } });
  lane.append(svg);
  // Dessin à main levée : la courbe tracée remplace l'ancienne sur la zone parcourue.
  lane.onpointerdown = e => {
    e.preventDefault();
    const r = lane.getBoundingClientRect(); let last = -1, changed = false;
    const apply = (ev: PointerEvent) => {
      const s = clamp(Math.round((ev.clientX - r.left) / SW * 8) / 8, 0, c.patLen! - 1 / 8), y = clamp((ev.clientY - r.top) / r.height, 0, 1);
      const v = Math.round((k === 'pb' ? 1 - 2 * y : 1 - y) * 100) / 100;
      const a = last < 0 ? s : Math.min(last, s), b = last < 0 ? s : Math.max(last, s);
      const ctl = c.ctl ??= {}, list = (ctl[k] ?? []).filter(p => p.s < a - 1e-6 || p.s > b + 1e-6 || (p.s === last && last !== s));
      list.push({ s, v }); list.sort((x, y2) => x.s - y2.s); ctl[k] = list; last = s; changed = true; draw();
    };
    apply(e);
    followDrag(e, apply, () => { if (changed) commit(); }, revert);
  };
  const sel = h('select', { 'aria-label': t('ctl.kind'), title: t('ctl.kind'), data: { role: 'ctlkind' } }, ...(['pb', 'mod', 'at'] as const).map(x => h('option', { value: x, selected: x === k }, t('ctl.short.' + x))));
  sel.onchange = () => { S.ctlKind = sel.value as CtlKind; emit(); };
  const clear = h('button', { class: 'mini', data: { act: 'ctlclear' }, title: t('ctl.clear'), 'aria-label': t('ctl.clear'), disabled: !pts().length, onclick: () => { if (c.ctl) { delete c.ctl[k]; if (!Object.keys(c.ctl).length) delete c.ctl; } commit(); } }, '✕');
  return h('div', { class: 'vel-row ctl-row' }, h('div', { class: 'vel-lbl ctl-lbl' }, sel, clear), lane);
}
