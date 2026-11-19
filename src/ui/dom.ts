import { engine } from '../audio/engine';
import { t } from '../i18n';
import { commit } from '../store';

type Kid = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, any> = {}, ...kids: Kid[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k === 'data') Object.assign(el.dataset, v);
    else if (k.startsWith('on') || k in el) (el as any)[k] = v;
    else el.setAttribute(k, v);
  }
  for (const c of kids) if (c) el.append(c);
  return el;
}

export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/**
 * Rend un curseur « rappelable » : double-clic, double toucher ou touche Suppr le ramènent à sa valeur d'origine `def`
 * (un petit repère la marque sur la piste du curseur) ; Maj + glissé donne un réglage cinq fois plus fin.
 * `apply` applique une valeur en direct, `done` la valide (annulable).
 */
export function resettable(inp: HTMLInputElement, def: number, apply: (v: number) => void, done: () => void, tip = '') {
  const min = +inp.min, max = +inp.max, step = +inp.step || 1;
  if (!(max > min) || !(def >= min && def <= max)) return;
  inp.dataset.def = String(def); inp.classList.add('hasdef'); inp.style.setProperty('--def', ((def - min) / (max - min)).toFixed(4));
  if (tip) inp.title = inp.title ? `${inp.title} — ${tip}` : tip;
  const reset = () => { if (+inp.value === def) return; inp.value = String(def); apply(def); done(); };
  inp.addEventListener('dblclick', e => { e.preventDefault(); reset(); });
  // Suppr sur le curseur le remet à zéro, sans supprimer le clip sélectionné derrière lui.
  inp.addEventListener('keydown', e => { if (e.key === 'Delete') { e.preventDefault(); e.stopPropagation(); reset(); } });
  inp.addEventListener('pointerdown', e => {
    if (!e.shiftKey || e.button !== 0) return;
    e.preventDefault(); inp.focus({ preventScroll: true });
    const v0 = +inp.value, vert = inp.classList.contains('vert'), r = inp.getBoundingClientRect(), len = Math.max(1, vert ? r.height : r.width);
    let changed = false;
    followDrag(e, ev => {
      const d = vert ? e.clientY - ev.clientY : ev.clientX - e.clientX;
      const v = +clamp(Math.round((v0 + d / len * (max - min) * 0.2) / step) * step, min, max).toFixed(6);
      if (v !== +inp.value) { inp.value = String(v); apply(+inp.value); changed = true; }
    }, () => { if (changed) done(); });
  });
}

/**
 * Curseur étiqueté : mise à jour audio en direct, validation (annulable) au relâchement.
 * `def` : valeur d'origine, à laquelle un double-clic ou Suppr le ramène (voir `resettable`).
 */
export function slider(label: string, min: number, max: number, step: number, value: number,
  set: (v: number) => void, fmt: (v: number) => string = v => String(v), cls = '', transient = false, def?: number) {
  const out = h('span', { class: 'val' }, fmt(value));
  const inp = h('input', { type: 'range', min: String(min), max: String(max), step: String(step), 'aria-label': label });
  inp.value = String(value);
  // Valeur lue par les lecteurs d'écran : celle affichée (unité comprise), pas la position brute du curseur.
  inp.setAttribute('aria-valuetext', fmt(value));
  const apply = (v: number) => { set(v); out.textContent = fmt(v); inp.setAttribute('aria-valuetext', out.textContent); engine.sync(); };
  inp.oninput = () => apply(+inp.value);
  if (!transient) inp.onchange = () => commit(); // `transient` : réglage d'interface, hors projet et hors annulation
  if (def !== undefined) resettable(inp, def, apply, () => { if (!transient) commit(); }, t('sl.resetTip'));
  return h('label', { class: 'sl ' + cls }, h('span', { class: 'lb' }, label), inp, out);
}

let toastTimer = 0;
/**
 * Message bref en bas de l'écran (zone de statut annoncée par les lecteurs d'écran).
 * `sticky` : reste affiché jusqu'au message suivant (travail long) ; `action` : bouton dans le message (« Annuler »).
 */
export function toast(msg: string, kind: 'info' | 'error' = 'info', opt: { sticky?: boolean; action?: { label: string; fn: () => void } } = {}) {
  const el = document.getElementById('toast')!;
  el.replaceChildren(msg);
  if (opt.action) { const a = opt.action; el.append(h('button', { class: 'pill tact', data: { act: 'toastact' }, onclick: () => { el.className = ''; a.fn(); } }, a.label)); }
  el.className = 'show ' + kind + (opt.action ? ' act' : '');
  clearTimeout(toastTimer);
  if (!opt.sticky) toastTimer = window.setTimeout(() => { el.className = ''; }, kind === 'error' ? 5000 : opt.action ? 7000 : 2600);
}

export const pct = (v: number) => Math.round(v * 100) + ' %';
export const db = (v: number) => (v > 0 ? '+' : '') + v.toFixed(1) + ' dB';

/**
 * Suit un glissé commencé par `e` (V17) : seul le pointeur qui l'a commencé le fait avancer (un deuxième doigt posé ailleurs
 * ne le déplace pas et ne le termine pas). Fin normale au relâchement ; `cancel` si le système annule le geste (pointercancel :
 * appel entrant, geste du système, doigt parti en défilement). Souris : si le bouton est déjà relâché quand elle bouge
 * (relâché hors de la fenêtre, changement d'application), le glissé se termine normalement au lieu de rester accroché.
 */
export function followDrag(e: PointerEvent, move: (ev: PointerEvent) => void, end: (ev: PointerEvent) => void, cancel: (ev: PointerEvent) => void = end): () => void {
  const id = e.pointerId;
  const stop = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', fin); removeEventListener('pointercancel', fin); };
  const fin = (ev: PointerEvent) => { if (ev.pointerId !== id) return; stop(); (ev.type === 'pointercancel' ? cancel : end)(ev); };
  const mv = (ev: PointerEvent) => {
    if (ev.pointerId !== id) return;
    if (ev.pointerType === 'mouse' && ev.buttons === 0) { stop(); end(ev); return; }
    move(ev);
  };
  addEventListener('pointermove', mv); addEventListener('pointerup', fin); addEventListener('pointercancel', fin);
  return stop;
}

/** Ligne d'un menu contextuel : libellé, raccourci affiché à droite, action. `null` dans la liste = trait de séparation. */
export interface MenuItem { id: string; label: string; key?: string; fn: () => void; danger?: boolean; disabled?: boolean }
/**
 * Menu contextuel posé près du point (x, y), dans le style des menus ⋯ des pistes. Flèches, Début et Fin passent d'une ligne à
 * l'autre, Entrée choisit, Échap ou un clic ailleurs referme. Tant qu'il est ouvert, les raccourcis de l'application sont
 * suspendus (Suppr ne supprime pas le clip derrière le menu). `back` retrouve l'élément qui reprend le focus à la fermeture.
 */
export function popMenu(x: number, y: number, items: (MenuItem | null)[], label: string, back?: () => HTMLElement | null) {
  document.querySelector<HTMLElement & { khClose?: () => void }>('.menu-list.ctx')?.khClose?.();
  const el: HTMLDivElement & { khClose?: () => void } = h('div', { class: 'menu-list ctx', role: 'menu', 'aria-label': label });
  const close = (refocus = true) => {
    if (!el.isConnected) return;
    el.remove(); removeEventListener('keydown', key, true); document.removeEventListener('pointerdown', away, true);
    removeEventListener('scroll', gone, true); removeEventListener('resize', gone); removeEventListener('blur', gone);
    if (refocus) back?.()?.focus({ preventScroll: true });
  };
  const gone = () => close(false);
  const away = (e: Event) => { if (!el.contains(e.target as Node)) close(false); };
  const btns = () => [...el.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
  const key = (e: KeyboardEvent) => {
    e.stopPropagation();
    const l = btns(), i = l.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); l[(i + 1) % l.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); l[(i - 1 + l.length) % l.length]?.focus(); }
    else if (e.key === 'Home') { e.preventDefault(); l[0]?.focus(); }
    else if (e.key === 'End') { e.preventDefault(); l[l.length - 1]?.focus(); }
  };
  for (const it of items) el.append(it
    ? h('button', { role: 'menuitem', class: it.danger ? 'danger' : '', disabled: !!it.disabled, data: { ctx: it.id }, onclick: () => { close(); it.fn(); } }, h('span', {}, it.label), it.key ? h('kbd', {}, it.key) : null)
    : h('hr', {}));
  el.khClose = gone;
  el.oncontextmenu = e => e.preventDefault();
  document.body.append(el);
  el.style.left = Math.round(Math.max(8, Math.min(x, innerWidth - el.offsetWidth - 8))) + 'px';
  el.style.top = Math.round(y + el.offsetHeight > innerHeight - 8 ? Math.max(8, y - el.offsetHeight) : y) + 'px';
  addEventListener('keydown', key, true); document.addEventListener('pointerdown', away, true);
  addEventListener('resize', gone); addEventListener('blur', gone);
  // Un défilement emporte ce que le menu désigne : on le referme. Écouté un instant plus tard seulement, car l'ouverture
  // peut elle-même redessiner l'éditeur (clip nouvellement sélectionné), qui retrouve alors sa position de défilement.
  setTimeout(() => { if (el.isConnected) addEventListener('scroll', gone, true); }, 300);
  btns()[0]?.focus({ preventScroll: true });
  return el;
}
