import { engine } from '../audio/engine';
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

/** Curseur étiqueté : mise à jour audio en direct, validation (annulable) au relâchement. */
export function slider(label: string, min: number, max: number, step: number, value: number,
  set: (v: number) => void, fmt: (v: number) => string = v => String(v), cls = '', transient = false) {
  const out = h('span', { class: 'val' }, fmt(value));
  const inp = h('input', { type: 'range', min: String(min), max: String(max), step: String(step), 'aria-label': label });
  inp.value = String(value);
  // Valeur lue par les lecteurs d'écran : celle affichée (unité comprise), pas la position brute du curseur.
  inp.setAttribute('aria-valuetext', fmt(value));
  inp.oninput = () => { const v = +inp.value; set(v); out.textContent = fmt(v); inp.setAttribute('aria-valuetext', out.textContent); engine.sync(); };
  if (!transient) inp.onchange = () => commit(); // `transient` : réglage d'interface, hors projet et hors annulation
  return h('label', { class: 'sl ' + cls }, h('span', { class: 'lb' }, label), inp, out);
}

let toastTimer = 0;
export function toast(msg: string, kind: 'info' | 'error' = 'info') {
  const el = document.getElementById('toast')!;
  el.textContent = msg; el.className = 'show ' + kind;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { el.className = ''; }, kind === 'error' ? 5000 : 2600);
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
