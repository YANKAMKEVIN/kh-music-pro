import { describe, expect, it, vi } from 'vitest';
import { fr } from '../../src/i18n/fr';
import { en } from '../../src/i18n/en';
import { es } from '../../src/i18n/es';
import { hasKey, lang, setLang, t } from '../../src/i18n';

const langs = { fr, en, es } as Record<string, Record<string, string>>;
const holes = (s: string) => [...s.matchAll(/\{(\d)\}/g)].map(m => m[1]).sort().join(',');

describe('textes en trois langues', () => {
  it('les trois langues ont exactement les mêmes clés, dans le même ordre', () => {
    expect(Object.keys(en)).toEqual(Object.keys(fr));
    expect(Object.keys(es)).toEqual(Object.keys(fr));
    expect(Object.keys(fr).length).toBeGreaterThan(800);
  });
  it('aucun texte vide', () => {
    for (const [l, d] of Object.entries(langs)) for (const [k, v] of Object.entries(d)) expect(v.trim(), `${l} ${k}`).not.toBe('');
  });
  it('les emplacements {0}, {1}… sont les mêmes dans chaque langue', () => {
    const bad = Object.keys(fr).filter(k => holes(en[k as keyof typeof en]) !== holes(fr[k as keyof typeof fr]) || holes(es[k as keyof typeof es]) !== holes(fr[k as keyof typeof fr]));
    expect(bad).toEqual([]);
  });
});

describe('t() et changement de langue', () => {
  it('remplit les emplacements et suit la langue choisie', () => {
    const before = lang();
    setLang('en'); expect(t('type.drums')).toBe('Drums');
    setLang('es'); expect(t('type.drums')).toBe('Batería');
    setLang('fr'); expect(t('type.drums')).toBe('Batterie');
    expect(t('sounds.count', 3, 10)).toBe('3 sons sur 10');
    expect(document.documentElement.lang).toBe('fr');
    setLang(before);
  });
  it('une clé inconnue est renvoyée telle quelle et signalée', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(hasKey('nope.absent')).toBe(false);
    expect(t('nope.absent')).toBe('nope.absent');
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});
