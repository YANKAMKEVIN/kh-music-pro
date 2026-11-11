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
  inp.oninput = () => { const v = +inp.value; set(v); out.textContent = fmt(v); engine.sync(); };
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
