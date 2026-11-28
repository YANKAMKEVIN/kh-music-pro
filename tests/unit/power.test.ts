// Perf mobile : mise en veille du moteur quand l'onglet est caché, densité plafonnée des canvas.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HIDDEN_DELAY, canSleep, initPowerSaving } from '../../src/audio/power';
import { MAX_DPR, canvasRatio } from '../../src/ui/canvas';

const idle = { playing: false, recording: false, inputOpen: false, native: false, running: true };

describe('veille du moteur audio', () => {
  it('jamais pendant une lecture, un enregistrement, une entrée ouverte ou avec le moteur natif', () => {
    expect(canSleep(idle)).toBe(true);
    expect(canSleep({ ...idle, playing: true })).toBe(false);
    expect(canSleep({ ...idle, recording: true })).toBe(false);
    expect(canSleep({ ...idle, inputOpen: true })).toBe(false);
    expect(canSleep({ ...idle, native: true })).toBe(false);
    expect(canSleep({ ...idle, running: false })).toBe(false);
  });

  let vis: DocumentVisibilityState = 'visible', stop = () => { };
  const setVis = (v: DocumentVisibilityState) => { vis = v; document.dispatchEvent(new Event('visibilitychange')); };
  const fake = () => {
    const e = { ctx: { state: 'running', suspend: vi.fn(async () => { e.ctx.state = 'suspended'; }), resume: vi.fn(async () => { e.ctx.state = 'running'; }) }, playing: false, recording: false as false | string, inp: undefined as unknown, native: undefined };
    return e;
  };
  beforeEach(() => { vi.useFakeTimers(); vis = 'visible'; Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => vis }); });
  afterEach(() => { stop(); vi.useRealTimers(); });

  it('onglet caché et rien ne joue : veille après le délai, réveil au retour', async () => {
    const e = fake(); stop = initPowerSaving(e);
    setVis('hidden');
    vi.advanceTimersByTime(HIDDEN_DELAY - 1);
    expect(e.ctx.suspend).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(e.ctx.suspend).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    setVis('visible');
    expect(e.ctx.resume).toHaveBeenCalledTimes(1);
  });

  it('un aller-retour rapide ne coupe rien', () => {
    const e = fake(); stop = initPowerSaving(e);
    setVis('hidden'); vi.advanceTimersByTime(5000); setVis('visible');
    vi.advanceTimersByTime(HIDDEN_DELAY * 2);
    expect(e.ctx.suspend).not.toHaveBeenCalled();
    expect(e.ctx.resume).not.toHaveBeenCalled();
  });

  it('une lecture volontaire continue onglet caché', () => {
    const e = fake(); e.playing = true; stop = initPowerSaving(e);
    setVis('hidden'); vi.advanceTimersByTime(HIDDEN_DELAY * 3);
    expect(e.ctx.suspend).not.toHaveBeenCalled();
  });

  it('l\'écoute de l\'entrée (micro, accordeur) continue aussi', () => {
    const e = fake(); e.inp = {}; stop = initPowerSaving(e);
    setVis('hidden'); vi.advanceTimersByTime(HIDDEN_DELAY * 3);
    expect(e.ctx.suspend).not.toHaveBeenCalled();
  });

  it('au retour, un moteur qui n\'a pas été mis en veille par nous n\'est pas relancé', () => {
    const e = fake(); e.ctx.state = 'suspended'; stop = initPowerSaving(e);
    setVis('hidden'); vi.advanceTimersByTime(HIDDEN_DELAY); setVis('visible');
    expect(e.ctx.resume).not.toHaveBeenCalled();
  });
});

describe('densité des canvas', () => {
  it('suit l\'écran jusqu\'à 2×, jamais au-delà', () => {
    expect(canvasRatio(300, 50, 1)).toBe(1);
    expect(canvasRatio(300, 50, 1.5)).toBe(1.5);
    expect(canvasRatio(300, 50, 3)).toBe(MAX_DPR);
    expect(canvasRatio(300, 50, 0.5)).toBe(1);
  });
  it('un très grand canvas reste sous le budget de pixels', () => {
    const r = canvasRatio(3000, 600, 3);
    expect(r).toBeLessThan(MAX_DPR);
    expect(3000 * r * 600 * r).toBeLessThanOrEqual(4_000_001);
    expect(canvasRatio(20000, 4000, 2)).toBe(1);
  });
});
