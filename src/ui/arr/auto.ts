// Lignes d'automation sous les pistes de l'arrangement.
import { t } from '../../i18n';
import { commit, revert, S } from '../../store';
import { autoMeta, AutoParam, FX, fxAutomatable, fxToNorm, insKey, parseInsKey, parseSetKey, Pt, setKey, setToNorm, Track } from '../../types';
import { auName, auToNorm } from '../../audio/au';
import { liveWams, wamKey } from '../../audio/wam';
import { clamp, followDrag, h } from '../dom';

// ---------- Automation ----------
const AH = 64, PADY = 8, NS = 'http://www.w3.org/2000/svg';
const autoY = (prm: string, v: number) => { const m = autoMeta(prm).min; return PADY + (1 - (v - m) / (1 - m)) * (AH - 2 * PADY); };
const autoV = (prm: string, y: number) => { const m = autoMeta(prm).min; return Math.round(clamp(m + (1 - (y - PADY) / (AH - 2 * PADY)) * (1 - m), m, 1) * 1000) / 1000; };
const PARAMS: AutoParam[] = ['vol', 'pan', 'filter', 'rev', 'dly', 'chorus'];
/**
 * Réglages automatisables des effets de la piste (V17) : effets intégrés (sauf la taille de la réverb) et plugins du Mac
 * chargés (leur liste de réglages vient du plugin). Chaque entrée : clé, nom de l'effet, nom du réglage, valeur actuelle (0..1).
 */
function insParams(tr: Track): { key: string; fx: string; label: string; cur: number }[] {
  const out: { key: string; fx: string; label: string; cur: number }[] = [];
  tr.inserts?.forEach((ins, n) => {
    if (FX[ins.type]?.length) {
      const fx = `${n + 1}. ${t('fxn.' + ins.type)}`;
      for (const [k] of FX[ins.type]) if (fxAutomatable(ins.type, k)) out.push({ key: insKey(ins.id, k), fx, label: t('fxp.' + k), cur: fxToNorm(ins.type, k, ins.p[k]) });
    } else if (ins.type === 'au') {
      const inst = liveWams.get(wamKey(tr.id, ins.id)) as { params?: import('../../audio/au').AuParam[] } | undefined, fx = `${n + 1}. 🍎 ${auName(ins.name || '')}`;
      for (const p of inst?.params ?? []) out.push({ key: insKey(ins.id, String(p.address)), fx, label: p.name, cur: auToNorm(p, ins.p[String(p.address)] ?? p.value) });
    }
  });
  return out;
}
/**
 * Tranche fixe et instrument (suite, 21/11/2026) : égaliseur et seuil du compresseur ; coupure et résonance du filtre
 * pour un instrument joué par l'application (pas un instrument du Mac, qui a ses propres réglages).
 */
function setParams(tr: Track): { key: string; fx: string; label: string; cur: number }[] {
  // Tranche en chaîne d'effets : pas de tranche fixe, ses réglages s'automatisent dans le groupe de chaque effet.
  const labels = { eqLow: 'mix.low', eqMid: 'mix.mid', eqMidF: 'mix.midF', eqHigh: 'mix.high', compThr: 'mix.compThr', compRatio: 'mix.compRatio' } as const;
  const strip = t('auto.strip'), out = (tr.strip === 'chaine' ? [] : ['eqLow', 'eqMid', 'eqMidF', 'eqHigh', 'compThr', 'compRatio'] as const).map(k => ({
    key: setKey(k), fx: strip, label: t(labels[k]), cur: setToNorm(k, tr[k]),
  }));
  const sp = tr.type === 'synth' ? tr.synth : undefined;
  if (sp && sp.engine !== 'au') for (const k of ['cutoff', 'reso'] as const) out.push({ key: setKey(k), fx: t('auto.inst'), label: t('syn.' + k), cur: setToNorm(k, sp[k]) });
  return out;
}
export function ahead(tr: Track) {
  const prm = tr.autoShow ?? 'vol', extra = [...setParams(tr), ...insParams(tr)], groups = new Map<string, typeof extra>();
  for (const e of extra) groups.set(e.fx, [...(groups.get(e.fx) ?? []), e]);
  const dot = (k: string) => (tr.auto?.[k]?.length ? ' •' : '');
  // Un réglage d'effet dont l'effet a disparu (ou un plugin du Mac pas encore chargé) reste affiché tel quel.
  const orphan = (parseInsKey(prm) || parseSetKey(prm)) && !extra.some(e => e.key === prm);
  const sel = h('select', { 'aria-label': `${t('auto.param')} – ${tr.name}`, title: t('auto.param'), data: { role: 'autoparam' } },
    h('optgroup', { label: t('auto.track') }, ...PARAMS.filter(k => tr.strip !== 'chaine' || (k !== 'filter' && k !== 'chorus')).map(k => h('option', { value: k, selected: prm === k }, t('auto.' + k) + dot(k)))),
    ...[...groups].map(([fx, l]) => h('optgroup', { label: fx }, ...l.map(e => h('option', { value: e.key, selected: prm === e.key }, e.label + dot(e.key))))),
    ...(orphan ? [h('option', { value: prm, selected: true }, t('auto.unavailable'))] : []));
  sel.onchange = () => { tr.autoShow = sel.value; commit(); };
  return h('div', { class: 'ahead', style: `--c:${tr.color}` }, h('span', { class: 'albl' }, t('auto.title')), sel,
    h('button', { class: 'mini', title: t('auto.clear'), 'aria-label': `${t('auto.clear')} – ${tr.name}`, data: { act: 'autoclear' }, disabled: !tr.auto?.[prm]?.length, onclick: () => { delete tr.auto![prm]; commit(); } }, '⌫'));
}
export function alane(tr: Track, total: number) {
  const prm = tr.autoShow || 'vol', px = S.px, W = total * px;
  // Valeur de départ d'une courbe vide : le réglage actuel (effet), ou la valeur par défaut (piste).
  const def = [...setParams(tr), ...insParams(tr)].find(e => e.key === prm)?.cur ?? autoMeta(prm).def;
  const el = h('div', { class: 'alane', data: { auto: tr.id }, style: `--c:${tr.color}` });
  const svg = document.createElementNS(NS, 'svg'), line = document.createElementNS(NS, 'polyline');
  svg.setAttribute('width', String(W)); svg.setAttribute('height', String(AH)); svg.append(line); el.append(svg);
  const hint = h('div', { class: 'hint ahint' }, t('auto.hint'));
  const draw = () => {
    const l = tr.auto?.[prm] ?? [], y0 = autoY(prm, l.length ? l[0].v : def);
    const xy = [[0, y0], ...l.map(p => [p.s * px, autoY(prm, p.v)]), [W, l.length ? autoY(prm, l[l.length - 1].v) : y0]];
    line.setAttribute('points', xy.map(a => a.join(',')).join(' '));
    el.classList.toggle('none', !l.length);
    el.querySelectorAll('.apt').forEach(e => e.remove());
    l.forEach((p, i) => el.append(h('div', { class: 'apt', data: { i: String(i) }, style: `left:${p.s * px}px;top:${autoY(prm, p.v)}px`, title: String(Math.round(p.v * 100)) })));
    hint.style.display = l.length ? 'none' : '';
  };
  el.append(hint); draw();
  const remove = (pt: Pt) => { const l = tr.auto![prm]!; l.splice(l.indexOf(pt), 1); if (!l.length) delete tr.auto![prm]; commit(); };
  el.oncontextmenu = e => e.preventDefault();
  el.ondblclick = e => { const hit = (e.target as HTMLElement).closest<HTMLElement>('.apt'); if (hit) remove(tr.auto![prm]![+hit.dataset.i!]); };
  el.onpointerdown = e => {
    if (e.button !== 0 && e.button !== 2) return;
    e.preventDefault();
    const r = el.getBoundingClientRect(), hit = (e.target as HTMLElement).closest<HTMLElement>('.apt');
    tr.auto ??= {};
    const list = tr.auto[prm] ??= [];
    let pt: Pt, changed = false;
    if (hit) { pt = list[+hit.dataset.i!]; if (e.button === 2) return remove(pt); }
    else {
      if (e.button !== 0) return;
      pt = { s: Math.max(0, Math.round((e.clientX - r.left) / px)), v: autoV(prm, e.clientY - r.top) };
      const same = list.findIndex(x => x.s === pt.s);
      if (same >= 0) list.splice(same, 1);
      list.push(pt); list.sort((a, b) => a.s - b.s); changed = true; draw();
    }
    const mv = (ev: PointerEvent) => {
      const i = list.indexOf(pt), lo = i > 0 ? list[i - 1].s + 1 : 0, hi = i < list.length - 1 ? list[i + 1].s - 1 : 1e6;
      const s = clamp(Math.round((ev.clientX - r.left) / px), lo, hi), v = autoV(prm, ev.clientY - r.top);
      if (s !== pt.s || v !== pt.v) { pt.s = s; pt.v = v; changed = true; draw(); }
    };
    followDrag(e, mv, () => { if (changed) commit(); }, revert);
  };
  return el;
}
