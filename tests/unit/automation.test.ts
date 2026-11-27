import { describe, expect, it } from 'vitest';
import {
  AUTO, CTL_REST, FX, SET_AUTO, autoAt, autoMeta, ctlAt, fxAutomatable, fxCount, fxFromNorm, fxToNorm, insKey, isStripFx,
  newInsert, newTrack, parseInsKey, parseSetKey, setAutoKeys, setFromNorm, setKey, setToNorm, synthAt,
} from '../../src/types';

describe('courbes d\'automation', () => {
  const pts = [{ s: 0, v: 0 }, { s: 8, v: 1 }, { s: 16, v: 0.5 }];

  it('autoAt interpole linéairement entre les points', () => {
    expect(autoAt(pts, 0)).toBe(0);
    expect(autoAt(pts, 4)).toBeCloseTo(0.5);
    expect(autoAt(pts, 8)).toBe(1);
    expect(autoAt(pts, 12)).toBeCloseTo(0.75);
  });

  it('autoAt tient la première valeur avant et la dernière après la courbe', () => {
    expect(autoAt([{ s: 4, v: 0.3 }, { s: 8, v: 0.9 }], 0)).toBe(0.3);
    expect(autoAt(pts, 100)).toBe(0.5);
    expect(autoAt([{ s: 2, v: 0.7 }], 50)).toBe(0.7);
  });

  it('ctlAt renvoie la valeur de repos avant le premier point ou sans courbe', () => {
    expect(ctlAt(undefined, 3, 'pb')).toBe(CTL_REST.pb);
    expect(ctlAt([], 3, 'mod')).toBe(CTL_REST.mod);
    expect(ctlAt([{ s: 4, v: 1 }], 2, 'pb')).toBe(0);
    expect(ctlAt([{ s: 4, v: 1 }], 4, 'pb')).toBe(1);
  });

  it('autoMeta donne les bornes des réglages de piste, 0..1 sinon', () => {
    expect(autoMeta('pan')).toEqual(AUTO.pan);
    expect(autoMeta('ins:abc:mix')).toEqual({ min: 0, def: 0.5 });
  });
});

describe('réglages d\'effets normalisés', () => {
  it('fxFromNorm et fxToNorm sont réciproques pour chaque réglage d\'effet', () => {
    for (const [type, defs] of Object.entries(FX)) for (const [k, min, max] of defs) {
      for (const v of [0, 0.25, 0.5, 1]) {
        const x = fxFromNorm(type, k, v);
        expect(x).toBeGreaterThanOrEqual(min - 1e-9);
        expect(x).toBeLessThanOrEqual(max + 1e-9);
        if (!(type === 'delay' && k === 'time')) expect(fxToNorm(type, k, x)).toBeCloseTo(v, 6);
      }
    }
  });

  it('les fréquences sont sur une échelle logarithmique', () => {
    // eq : 40 Hz à 12 kHz, le milieu de la course est la moyenne géométrique
    expect(fxFromNorm('eq', 'freq', 0.5)).toBeCloseTo(Math.sqrt(40 * 12000), 3);
    // gain : linéaire
    expect(fxFromNorm('gain', 'gain', 0.5)).toBeCloseTo(0);
  });

  it('le temps d\'écho reste calé sur la grille (pas entiers)', () => {
    expect(Number.isInteger(fxFromNorm('delay', 'time', 0.37))).toBe(true);
  });

  it('fxToNorm borne entre 0 et 1, et un réglage inconnu ne casse rien', () => {
    expect(fxToNorm('gain', 'gain', 1000)).toBe(1);
    expect(fxToNorm('gain', 'gain', -1000)).toBe(0);
    expect(fxToNorm('inconnu', 'x', 3)).toBe(0);
    expect(fxFromNorm('inconnu', 'x', 0.3)).toBe(0.3);
  });

  it('la taille de réverb, la saturation et le lo-fi ne sont pas automatisables', () => {
    expect(fxAutomatable('reverb', 'size')).toBe(false);
    expect(fxAutomatable('reverb', 'mix')).toBe(true);
    expect(fxAutomatable('drive', 'amt')).toBe(false);
    expect(fxAutomatable('lofi', 'amt')).toBe(false);
    expect(fxAutomatable('delay', 'fb')).toBe(true);
    expect(fxAutomatable('delay', 'nope')).toBe(false);
  });

  it('insKey et parseInsKey font l\'aller-retour, y compris pour une adresse d\'Audio Unit', () => {
    expect(parseInsKey(insKey('abc', 'mix'))).toEqual({ id: 'abc', k: 'mix' });
    expect(parseInsKey(insKey('abc', '12:34'))).toEqual({ id: 'abc', k: '12:34' });
    expect(parseInsKey('vol')).toBeNull();
  });

  it('newInsert prend les valeurs par défaut de l\'effet', () => {
    const i = newInsert('delay');
    expect(i.on).toBe(true);
    expect(i.p).toEqual({ time: 3, fb: 0.35, mix: 0.3 });
    expect(newInsert('wam').p).toEqual({});
  });

  it('les étages de la tranche fixe ne comptent pas dans la limite d\'effets', () => {
    const tr = newTrack('synth', 1);
    tr.inserts = [newInsert('eq3'), newInsert('delay'), newInsert('comp'), newInsert('reverb')];
    expect(isStripFx('eq3')).toBe(true);
    expect(isStripFx('delay')).toBe(false);
    expect(fxCount(tr)).toBe(2);
  });
});

describe('automation de la tranche fixe et de l\'instrument', () => {
  it('setFromNorm / setToNorm sont réciproques', () => {
    for (const k of Object.keys(SET_AUTO)) for (const v of [0, 0.3, 1]) expect(setToNorm(k, setFromNorm(k, v))).toBeCloseTo(v, 6);
  });

  it('parseSetKey ne reconnaît que les réglages automatisables', () => {
    expect(parseSetKey(setKey('eqLow'))).toBe('eqLow');
    expect(parseSetKey('set:inconnu')).toBeNull();
    expect(parseSetKey('vol')).toBeNull();
  });

  it('synthAt lit la coupure sur sa courbe sans modifier les réglages de la piste', () => {
    const tr = newTrack('synth', 1, 'lead');
    const before = tr.synth!.cutoff;
    expect(synthAt(tr, 0)).toBe(tr.synth);   // pas de courbe : même objet
    tr.auto = { [setKey('cutoff')]: [{ s: 0, v: 0 }, { s: 16, v: 1 }] };
    expect(synthAt(tr, 0).cutoff).toBeCloseTo(80);
    expect(synthAt(tr, 16).cutoff).toBeCloseTo(12000);
    expect(tr.synth!.cutoff).toBe(before);
    expect(setAutoKeys(tr)).toEqual(['cutoff']);
  });
});
