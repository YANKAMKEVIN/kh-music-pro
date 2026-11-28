import { describe, expect, it } from 'vitest';
import { compSet, compSlice, normComp, takeAt, type Clip } from '../../src/types';

const takes = (): Clip => ({ id: 'c', name: 'prises', start: 0, len: 16, offset: 0, takes: [0, 10, 20], take: 2 });

describe('comping (prises multiples)', () => {
  it('sans comping, la prise jouée est la prise choisie', () => {
    const c = takes();
    expect(takeAt(c, 0)).toBe(2);
    expect(takeAt(c, 15)).toBe(2);
  });

  it('compSet garde une prise sur une portion et reprend la précédente après', () => {
    const c = takes();
    compSet(c, 4, 8, 0);
    expect(c.comp).toEqual([{ s: 0, take: 2 }, { s: 4, take: 0 }, { s: 8, take: 2 }]);
    expect(takeAt(c, 3.9)).toBe(2);
    expect(takeAt(c, 4)).toBe(0);
    expect(takeAt(c, 8)).toBe(2);
  });

  it('une portion qui recouvre tout le clip fait disparaître le comping', () => {
    const c = takes();
    compSet(c, 4, 8, 0);
    compSet(c, 0, 16, 1);
    expect(c.comp).toBeUndefined();
    expect(c.take).toBe(1);
    expect(c.offset).toBe(10);
  });

  it('normComp fusionne les portions voisines de la même prise et écarte les prises inconnues', () => {
    const c = takes();
    c.comp = [{ s: 8, take: 1 }, { s: 0, take: 1 }, { s: 4, take: 1 }, { s: 12, take: 7 }, { s: 20, take: 0 }];
    normComp(c);
    expect(c.comp).toBeUndefined();
    expect(c.take).toBe(1);
  });

  it('normComp ramène la première portion au début et met l\'offset de sa prise', () => {
    const c = takes();
    c.comp = [{ s: 2, take: 0 }, { s: 6, take: 1 }];
    normComp(c);
    expect(c.comp).toEqual([{ s: 0, take: 0 }, { s: 6, take: 1 }]);
    expect(c.take).toBe(0);
    expect(c.offset).toBe(0);
  });

  it('un clip sans prises perd son comping', () => {
    const c: Clip = { id: 'x', name: 'x', start: 0, len: 8, offset: 0, comp: [{ s: 0, take: 0 }, { s: 4, take: 1 }] };
    normComp(c);
    expect(c.comp).toBeUndefined();
  });

  it('compSlice garde la partie coupée, ramenée au début', () => {
    const c = takes();
    compSet(c, 4, 8, 0);
    c.len = 8;
    compSlice(c, 6, 14);
    expect(c.comp).toEqual([{ s: 0, take: 0 }, { s: 2, take: 2 }]);
  });
});
