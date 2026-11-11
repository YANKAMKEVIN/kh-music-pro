import { t } from '../i18n';
import { S, emit } from '../store';
import { clamp, h } from './dom';

/** Étapes de la visite : l'élément mis en lumière à chaque étape. */
const STEPS = ['.transport', '.corner', '.lanes', '#panel', '#tabs', '#bLoop', '#menu', '#bHelp'];

export function startTour() {
  document.querySelector('.tour')?.remove();
  if (S.tab !== 'editor') { S.tab = 'editor'; emit(); }
  let i = 0;
  const spot = h('div', { class: 'tspot' }), bub = h('div', { class: 'tbub', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('tour.start') });
  const root = h('div', { class: 'tour' }, spot, bub);
  const end = () => { root.remove(); removeEventListener('keydown', key, true); removeEventListener('resize', show); };
  const go = (d: number) => { i += d; if (i >= STEPS.length) end(); else show(); };
  function show() {
    const el = document.querySelector<HTMLElement>(STEPS[i]);
    if (!el) return go(1);
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const r = el.getBoundingClientRect(), pad = 6;
    const x = Math.max(4, r.left - pad), y = Math.max(4, r.top - pad), w = Math.min(innerWidth - x - 4, r.width + pad * 2), hh = Math.min(innerHeight - y - 4, r.height + pad * 2);
    spot.style.cssText = `left:${x}px;top:${y}px;width:${w}px;height:${hh}px`;
    const text = h('p', {}); text.innerHTML = t('tour.' + (i + 1));
    const last = i === STEPS.length - 1;
    const next = h('button', { class: 'pill accent', data: { act: 'tournext' }, onclick: () => go(1) }, t(last ? 'tour.done' : 'tour.next'));
    bub.replaceChildren(h('small', {}, `${i + 1} / ${STEPS.length}`), text, h('div', { class: 'trow' },
      h('button', { class: 'pill', data: { act: 'tourskip' }, onclick: end }, t('tour.skip')),
      i > 0 && h('button', { class: 'pill', data: { act: 'tourprev' }, onclick: () => go(-1) }, t('tour.prev')), next));
    // La bulle se place sous l'élément, ou au-dessus s'il n'y a pas la place.
    const bh = bub.offsetHeight, bw = bub.offsetWidth, below = y + hh + 12;
    bub.style.left = clamp(x, 12, innerWidth - bw - 12) + 'px';
    bub.style.top = (below + bh < innerHeight - 8 ? below : Math.max(8, y - bh - 12)) + 'px';
    next.focus();
  }
  function key(e: KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); end(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
    else if (e.key === 'ArrowLeft' && i > 0) { e.preventDefault(); go(-1); }
  }
  addEventListener('keydown', key, true); addEventListener('resize', show);
  document.body.append(root); show();
}
