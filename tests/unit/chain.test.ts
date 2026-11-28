import { describe, expect, it } from 'vitest';
import { canRevert, chainToStrip, stripGet, stripSet, stripToChain, stripIns } from '../../src/chain';
import { insKey, newInsert, newTrack, setKey } from '../../src/types';

const stripFields = ['filter', 'drive', 'crush', 'chorus', 'trem', 'eqLow', 'eqMid', 'eqHigh', 'eqMidF', 'comp', 'compThr', 'compRatio'] as const;

describe('chaînes d\'effets / tranche fixe', () => {
  it('une tranche neutre devient une chaîne avec juste le filtre', () => {
    const tr = newTrack('synth', 1);
    expect(stripToChain(tr)).toBe(true);
    expect(tr.strip).toBe('chaine');
    expect(tr.inserts.map(i => i.type)).toEqual(['filter']);
    expect(stripToChain(tr)).toBe(false);
  });

  it('les réglages passent dans les effets, dans l\'ordre du son, avant les effets ajoutés', () => {
    const tr = newTrack('synth', 1);
    Object.assign(tr, { drive: 0.4, crush: 0.2, eqLow: 3, comp: true, compThr: -30, filter: -0.5 });
    tr.inserts = [newInsert('delay')];
    stripToChain(tr);
    expect(tr.inserts.map(i => i.type)).toEqual(['filter', 'drive', 'lofi', 'eq3', 'comp', 'delay']);
    expect(stripGet(tr, 'drive')).toBe(0.4);
    expect(stripGet(tr, 'compThr')).toBe(-30);
    expect(stripGet(tr, 'comp')).toBe(true);
    expect(stripGet(tr, 'trem')).toBeUndefined();
    expect(tr.drive).toBe(0);   // champs de la tranche remis au neutre
  });

  it('aller-retour tranche → chaîne → tranche sans perte de réglage ni de courbe', () => {
    const tr = newTrack('synth', 1);
    Object.assign(tr, { drive: 0.4, chorus: 0.3, eqMid: -2, eqMidF: 2500, compThr: -18, filter: 0.25 });
    tr.auto = { filter: [{ s: 0, v: -1 }, { s: 16, v: 1 }], [setKey('eqLow')]: [{ s: 0, v: 0.2 }] };
    tr.autoShow = 'filter';
    const before = Object.fromEntries(stripFields.map(f => [f, tr[f]]));
    stripToChain(tr);
    const f = stripIns(tr, 'filter')!;
    expect(tr.auto[insKey(f.id, 'v')]).toEqual([{ s: 0, v: 0 }, { s: 16, v: 1 }]);
    expect(tr.autoShow).toBe(insKey(f.id, 'v'));
    expect(canRevert(tr)).toBe(true);
    expect(chainToStrip(tr)).toBe(true);
    expect(Object.fromEntries(stripFields.map(k => [k, tr[k]]))).toEqual(before);
    expect(tr.auto.filter).toEqual([{ s: 0, v: -1 }, { s: 16, v: 1 }]);
    expect(tr.auto[setKey('eqLow')]).toEqual([{ s: 0, v: 0.2 }]);
    expect(tr.autoShow).toBe('filter');
    expect(tr.inserts).toEqual([]);
  });

  it('pas de retour possible si les étages sont dans le désordre', () => {
    const tr = newTrack('synth', 1); tr.drive = 0.5; tr.eqLow = 2;
    stripToChain(tr);
    tr.inserts.reverse();
    expect(canRevert(tr)).toBe(false);
    expect(chainToStrip(tr)).toBe(false);
  });

  it('stripSet crée l\'étage manquant seulement si demandé et non neutre', () => {
    const tr = newTrack('synth', 1); stripToChain(tr);
    expect(stripSet(tr, 'drive', 0.3)).toBe(false);
    expect(stripSet(tr, 'drive', 0, true)).toBe(false);
    expect(stripSet(tr, 'drive', 0.3, true)).toBe(true);
    expect(tr.inserts.map(i => i.type)).toEqual(['filter', 'drive']);
    expect(stripGet(tr, 'drive')).toBe(0.3);
  });

  it('stripSet en tranche fixe écrit directement le champ', () => {
    const tr = newTrack('synth', 1);
    expect(stripSet(tr, 'eqHigh', 4)).toBe(true);
    expect(tr.eqHigh).toBe(4);
  });
});
