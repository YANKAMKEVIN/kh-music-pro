import { describe, expect, it, afterEach } from 'vitest';
import { BAR, BEAT, GRIDS, barSteps, beatSteps, blankProject, bpmAt, durAt, liveQuant, setBar, setRes, snapTo, srcStep, stepDur, timeOf, type Clip } from '../../src/types';

describe('signatures rythmiques', () => {
  afterEach(() => setBar(16, 4));

  it('une mesure x/4 compte 4x pas, une mesure x/8 en compte 2x', () => {
    expect(barSteps(4)).toBe(16);
    expect(barSteps(3)).toBe(12);
    expect(barSteps(7, 4)).toBe(28);
    expect(barSteps(6, 8)).toBe(12);
    expect(barSteps(5, 8)).toBe(10);
    expect(barSteps(12, 8)).toBe(24);
  });

  it('le temps est une noire en x/4, une noire pointée en 6/8, 9/8, 12/8, une croche en 5/8 et 7/8', () => {
    expect(beatSteps(4, 4)).toBe(4);
    expect(beatSteps(6, 8)).toBe(6);
    expect(beatSteps(9, 8)).toBe(6);
    expect(beatSteps(12, 8)).toBe(6);
    expect(beatSteps(5, 8)).toBe(2);
    expect(beatSteps(7, 8)).toBe(2);
    expect(beatSteps(3, 8)).toBe(2);
  });

  it('setBar change la mesure et le temps du projet ouvert, que suit le calage Live', () => {
    setBar(barSteps(6, 8), beatSteps(6, 8));
    expect(BAR).toBe(12);
    expect(BEAT).toBe(6);
    expect(liveQuant(0)).toBe(12);   // à la mesure
    expect(liveQuant(4)).toBe(6);    // au temps
    expect(liveQuant(1)).toBe(1);    // au pas
  });
});

describe('tempo et temps écoulé', () => {
  it('stepDur : une double-croche à 120 BPM dure 0,125 s', () => {
    expect(stepDur(120)).toBeCloseTo(0.125);
    expect(stepDur(60)).toBeCloseTo(0.25);
  });

  it('sans changement de tempo, le temps est proportionnel au nombre de pas', () => {
    const p = blankProject(); p.bpm = 120;
    expect(timeOf(p, 0)).toBe(0);
    expect(timeOf(p, 16)).toBeCloseTo(2);   // une mesure de 4/4 à 120 = 2 s
    expect(durAt(p, 5)).toBeCloseTo(0.125);
    expect(bpmAt(p, 1000)).toBe(120);
  });

  it('les changements de tempo s\'appliquent à partir de leur position', () => {
    const p = blankProject(); p.bpm = 120; p.tempos = [{ s: 16, bpm: 60 }, { s: 32, bpm: 240 }];
    expect(bpmAt(p, 0)).toBe(120);
    expect(bpmAt(p, 15.9)).toBe(120);
    expect(bpmAt(p, 16)).toBe(60);
    expect(bpmAt(p, 40)).toBe(240);
    expect(timeOf(p, 16)).toBeCloseTo(2);
    expect(timeOf(p, 32)).toBeCloseTo(2 + 4);       // une mesure à 60 = 4 s
    expect(timeOf(p, 48)).toBeCloseTo(2 + 4 + 1);   // une mesure à 240 = 1 s
    expect(durAt(p, 20)).toBeCloseTo(0.25);
  });

  it('timeOf est croissant', () => {
    const p = blankProject(); p.tempos = [{ s: 8, bpm: 90 }, { s: 20, bpm: 170 }];
    let prev = -1;
    for (let s = 0; s < 64; s += 0.5) { const t = timeOf(p, s); expect(t).toBeGreaterThan(prev); prev = t; }
  });

  it('un clip audio calé sur le tempo garde la durée de pas de son tempo d\'origine', () => {
    const p = blankProject(); p.bpm = 100;
    const c: Clip = { id: 'a', name: 'a', start: 0, len: 16, offset: 0 };
    expect(srcStep(p, c)).toBeCloseTo(0.15);
    c.warp = true; c.srcBpm = 150;
    expect(srcStep(p, c)).toBeCloseTo(0.1);
  });
});

describe('grilles et aimantation', () => {
  it('snapTo aimante sur la grille sans erreur d\'arrondi', () => {
    expect(snapTo(3.4, 1)).toBe(3);
    expect(snapTo(3.6, 1)).toBe(4);
    expect(snapTo(1.3, GRIDS['32'])).toBe(1.5);
    expect(snapTo(1, GRIDS['16t'])).toBeCloseTo(4 / 3, 3);
    // 300 triolets de suite tombent juste
    expect(snapTo(300 * GRIDS['16t'], GRIDS['16t'])).toBe(200);
  });

  it('setRes garde chaque coup de batterie au plus près de sa place', () => {
    const c: Clip = { id: 'd', name: 'd', start: 0, len: 4, offset: 0, patLen: 4, drums: [[1, 0, 0.5, 0]] };
    setRes(c, 2);
    expect(c.res).toBe(2);
    expect(c.drums![0]).toEqual([1, 0, 0, 0, 0.5, 0, 0, 0]);
    setRes(c, 1);
    expect(c.res).toBeUndefined();
    expect(c.drums![0]).toEqual([1, 0, 0.5, 0]);
  });

  it('setRes ne touche pas un clip d\'instrument', () => {
    const c: Clip = { id: 'n', name: 'n', start: 0, len: 4, offset: 0, notes: [] };
    setRes(c, 2);
    expect(c.res).toBeUndefined();
  });
});
