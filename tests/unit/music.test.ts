import { describe, expect, it } from 'vitest';
import { GM_DRUMS, NPADS, SCALES, blankProject, chordOf, inScale, snapToScale } from '../../src/types';
import { detectPitch, noteOf } from '../../src/audio/pitch';

const cMajor = () => { const p = blankProject(); p.key = 0; p.scale = 'major'; return p; };

describe('gammes et accords', () => {
  it('inScale reconnaît les notes de do majeur dans toutes les octaves', () => {
    const p = cMajor();
    for (const n of [60, 62, 64, 65, 67, 69, 71, 72, 48, 36]) expect(inScale(p, n)).toBe(true);
    for (const n of [61, 63, 66, 68, 70]) expect(inScale(p, n)).toBe(false);
  });

  it('sans gamme (« off »), toutes les notes sont permises', () => {
    const p = blankProject(); p.scale = 'off';
    for (let n = 0; n < 128; n++) expect(inScale(p, n)).toBe(true);
  });

  it('la tonalité décale la gamme (la mineur = do majeur)', () => {
    const p = blankProject(); p.key = 9; p.scale = 'minor';
    for (let n = 48; n < 72; n++) expect(inScale(p, n)).toBe(inScale(cMajor(), n));
  });

  it('snapToScale ramène vers la note de la gamme la plus proche, vers le bas en cas d\'égalité', () => {
    const p = cMajor();
    expect(snapToScale(p, 61)).toBe(60);
    expect(snapToScale(p, 66)).toBe(65);
    expect(snapToScale(p, 64)).toBe(64);
  });

  it('chordOf empile des tierces dans la gamme', () => {
    const p = cMajor();
    expect(chordOf(p, 60, 3)).toEqual([60, 64, 67]);   // do majeur
    expect(chordOf(p, 62, 3)).toEqual([62, 65, 69]);   // ré mineur
    expect(chordOf(p, 67, 4)).toEqual([67, 71, 74, 77]); // sol 7
  });

  it('chordOf en pentatonique utilise la gamme parente à 7 notes', () => {
    const p = blankProject(); p.key = 0; p.scale = 'pentaMaj';
    expect(SCALES.pentaMaj.parent).toBe('major');
    expect(chordOf(p, 60, 3)).toEqual([60, 64, 67]);
  });

  it('chordOf ne dépasse jamais la note MIDI 127', () => {
    expect(chordOf(cMajor(), 124, 4).every(n => n <= 127)).toBe(true);
  });

  it('une note GM par pad de batterie', () => {
    expect(GM_DRUMS).toHaveLength(NPADS);
    expect(new Set(GM_DRUMS).size).toBe(NPADS);
  });
});

describe('accordeur', () => {
  it('noteOf : la 440 Hz est la note 69, juste', () => {
    expect(noteOf(440)).toEqual({ midi: 69, cents: 0 });
    expect(noteOf(261.6256).midi).toBe(60);
    expect(noteOf(446).cents).toBeGreaterThan(20);
  });

  it('detectPitch retrouve la fréquence d\'une sinusoïde', () => {
    const sr = 44100, x = new Float32Array(4096);
    for (const hz of [110, 220, 440, 659.25]) {
      for (let i = 0; i < x.length; i++) x[i] = 0.5 * Math.sin(2 * Math.PI * hz * i / sr);
      expect(Math.abs(detectPitch(x, sr) - hz) / hz).toBeLessThan(0.01);
    }
  });

  it('detectPitch renvoie 0 pour du silence', () => {
    expect(detectPitch(new Float32Array(2048), 44100)).toBe(0);
  });
});
