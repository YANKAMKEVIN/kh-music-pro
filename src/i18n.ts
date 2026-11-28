import { fr } from './i18n/fr';
import { en } from './i18n/en';
import { es } from './i18n/es';

export type Lang = 'fr' | 'en' | 'es';
export const LANGS: [Lang, string][] = [['fr', 'Français'], ['en', 'English'], ['es', 'Español']];

function detect(): Lang {
  try { const s = localStorage.getItem('kh-lang'); if (s === 'fr' || s === 'en' || s === 'es') return s; } catch { /* stockage désactivé */ }
  const n = (navigator.language || 'en').slice(0, 2);
  return n === 'fr' || n === 'es' ? n : 'en';
}
let cur: Lang = detect();
document.documentElement.lang = cur;

export const lang = () => cur;
export function setLang(l: Lang) {
  cur = l; document.documentElement.lang = l;
  try { localStorage.setItem('kh-lang', l); } catch { /* stockage désactivé */ }
}

export const hasKey = (key: string) => key in fr;

export function t(key: string, ...a: (string | number)[]): string {
  if (!hasKey(key)) { console.error('i18n: missing key', key); return key; }
  return (D[cur] as Record<string, string>)[key].replace(/\{(\d)\}/g, (_, i) => String(a[+i]));
}

/** Textes par langue (src/i18n/fr.ts, en.ts, es.ts). */
const D: Record<Lang, Record<string, string>> = { fr, en, es };
