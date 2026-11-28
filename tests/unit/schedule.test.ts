import { describe, expect, it } from 'vitest';
import { audioPieces, swingT } from '../../src/audio/schedule';
import { touchCutoff, touchSoftness } from '../../src/audio/voices';
import { COMP_XFADE, blankProject, makeSynth, timeOf, type Clip } from '../../src/types';

const audioClip = (over: Partial<Clip>): Clip => ({ id: 'a', name: 'a', start: 0, len: 16, offset: 0, bufferId: 'b', ...over });

describe('swing', () => {
  it('retarde seulement les double-croches impaires, de la moitié du swing', () => {
    const p = blankProject(); p.bpm = 120; p.swing = 0.5;
    expect(swingT(p, 0, 1)).toBe(1);
    expect(swingT(p, 2, 1)).toBe(1);
    expect(swingT(p, 1, 1)).toBeCloseTo(1 + 0.5 * 0.125 * 0.5);
    p.swing = 0;
    expect(swingT(p, 3, 1)).toBe(1);
  });
});

describe('morceaux de clips audio (comping, fondus enchaînés)', () => {
  it('sans comping ni fondu, les clips sont joués tels quels', () => {
    const p = blankProject(), tr = p.tracks[2];
    tr.clips = [audioClip({})];
    expect(audioPieces(p, tr)).toBe(tr.clips);
  });

  it('un clip à comping devient une portion par prise, avec un fondu très court aux joints', () => {
    const p = blankProject(); p.bpm = 120;
    const tr = p.tracks[2];
    tr.clips = [audioClip({ takes: [0, 10], take: 0, comp: [{ s: 0, take: 0 }, { s: 8, take: 1 }], fadeIn: 1, fadeOut: 2 })];
    const out = audioPieces(p, tr);
    expect(out.map(x => [x.id, x.start, x.len])).toEqual([['a#0', 0, 8], ['a#1', 8, 8]]);
    expect(out[1].offset).toBeCloseTo(10 + timeOf(p, 8));   // prise 2, lue là où on en est dans le clip
    expect(out[0].fadeIn).toBe(1); expect(out[0].fadeOut).toBe(0);
    expect(out[1].fadeIn).toBe(0); expect(out[1].fadeOut).toBe(2);
    expect(out[1].xIn).toBe(COMP_XFADE);
    expect(out[0].xOut).toBe(COMP_XFADE);
  });

  it('un fondu enchaîné choisi s\'applique entre deux clips qui se touchent', () => {
    const p = blankProject(); p.bpm = 120;
    const tr = p.tracks[2];
    tr.clips = [audioClip({ id: 'g', len: 8 }), audioClip({ id: 'd', start: 8, len: 8, xfade: 2 })];
    const out = audioPieces(p, tr);
    expect(out[1].xIn).toBeCloseTo(0.25);   // 2 pas à 120 BPM
    expect(out[0].xOut).toBeCloseTo(0.25);
  });

  it('pas de fondu si les clips ne se touchent pas', () => {
    const p = blankProject(), tr = p.tracks[2];
    tr.clips = [audioClip({ id: 'g', len: 8 }), audioClip({ id: 'd', start: 10, len: 8, xfade: 2 })];
    const out = audioPieces(p, tr);
    expect(out[1].xIn).toBeUndefined();
    expect(out[0].xOut).toBeUndefined();
  });
});

describe('nuances du toucher', () => {
  it('jouer fort ou sans nuances : aucune douceur', () => {
    const s = makeSynth('r_piano');
    expect(touchSoftness(s, 1)).toBe(0);
    expect(touchSoftness({ ...s, touch: 0 }, 0.2)).toBe(0);
  });

  it('jouer doucement : douceur proportionnelle, timbre plus sombre mais jamais sous 3 fois la note', () => {
    const s = makeSynth('r_piano');
    const soft = touchSoftness(s, 0.2);
    expect(soft).toBeCloseTo(s.touch * 0.8);
    expect(touchCutoff(0, 440)).toBe(18000);
    expect(touchCutoff(soft, 440)).toBeLessThan(18000);
    expect(touchCutoff(1, 440)).toBeGreaterThanOrEqual(3 * 440);
  });
});
