import { engine } from '../audio/engine';
import { t } from '../i18n';
import { h } from './dom';

// ---------- Vumètres : niveau, crête retenue une seconde, témoin de saturation ----------
/** Niveau affiché à partir duquel le signal atteint 0 dB (échelle de `engine.level` : −54 dB → 0, +3 dB → 1). */
export const CLIP_AT = 54 / 57 - 1e-4;
/** Crêtes retenues et témoins de saturation allumés, par piste (ou « master ») : gardés d'un redessin à l'autre. */
const held = new Map<string, { v: number; t: number }>();
export const clipped = new Set<string>();

/** Crête retenue : la plus haute valeur vue reste affichée `ms` millisecondes, puis laisse la place au niveau du moment. */
export function peakHold(prev: { v: number; t: number } | undefined, v: number, now: number, ms = 1000): { v: number; t: number } {
  return !prev || v >= prev.v || now - prev.t > ms ? { v, t: now } : prev;
}

/**
 * Un vumètre : barre de niveau, trait de la crête retenue, et témoin rouge de saturation qui reste allumé jusqu'au clic
 * (sur le témoin, ou n'importe où sur le vumètre). `name` : nom de la piste, pour les lecteurs d'écran.
 */
export function meter(id: string, name: string, cls = ''): HTMLElement {
  const clear = (e: Event) => { e.stopPropagation(); clipped.delete(id); el.classList.remove('clip'); led.hidden = true; };
  const led = h('button', { class: 'mclip', title: t('mix.clip', name), 'aria-label': t('mix.clip', name), hidden: !clipped.has(id), onclick: clear });
  const el = h('div', { class: 'meter ' + cls + (clipped.has(id) ? ' clip' : ''), data: { meter: id }, onclick: clear },
    h('div', { class: 'mfill', data: { id } }), h('i', { class: 'mpeak' }), led);
  return el;
}

/** Met à jour tous les vumètres affichés. Chaque piste n'est mesurée qu'une fois par image, même si deux vumètres la montrent. */
export function updateLevels() {
  const now = performance.now(), seen = new Map<string, number>();
  document.querySelectorAll<HTMLElement>('.mfill').forEach(el => {
    const id = el.dataset.id!;
    let v = seen.get(id);
    if (v === undefined) {
      v = engine.level(id); seen.set(id, v);
      held.set(id, peakHold(held.get(id), v, now));
      if (v >= CLIP_AT) clipped.add(id);
    }
    el.style.transform = `scaleY(${v.toFixed(3)})`;
    const box = el.parentElement!, pk = box.querySelector<HTMLElement>('.mpeak');
    if (!pk) return;
    const p = held.get(id)!.v;
    pk.style.bottom = `calc(${(p * 100).toFixed(1)}% - 2px)`; pk.style.opacity = p > 0.02 ? '1' : '0';
    if (clipped.has(id) && !box.classList.contains('clip')) { box.classList.add('clip'); box.querySelector<HTMLElement>('.mclip')!.hidden = false; }
  });
}
