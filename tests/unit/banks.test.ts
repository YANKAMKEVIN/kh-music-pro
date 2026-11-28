import { describe, expect, it } from 'vitest';
import { EXPRESSIVE } from '../../src/audio/expressive-manifest';
import { BANKS, drumBank, recordedDynamics, usedBanks } from '../../src/audio/banks';
import { PRESETS, blankProject, makeSynth } from '../../src/types';

describe('manifeste des banques expressives', () => {
  it('544 échantillons répartis dans les cinq banques', () => {
    const counts = Object.fromEntries(Object.entries(EXPRESSIVE).map(([k, b]) => [k, b.samples.length]));
    expect(counts).toEqual({ salamander: 120, studio_drums: 115, wurli: 47, fashionbass: 190, percussion: 72 });
  });

  it('chaque fichier est rangé dans le dossier de sa banque, sans doublon', () => {
    for (const [bank, def] of Object.entries(EXPRESSIVE)) {
      const files = def.samples.map(s => s.file);
      expect(new Set(files).size).toBe(files.length);
      for (const f of files) expect(f.startsWith(bank + '/')).toBe(true);
    }
  });

  it('les seuils de vélocité sont croissants et finissent à 1', () => {
    for (const def of Object.values(EXPRESSIVE)) if (def.velocityEnds) {
      expect([...def.velocityEnds].sort((a, b) => a - b)).toEqual(def.velocityEnds);
      expect(def.velocityEnds.at(-1)).toBe(1);
    }
  });

  it('les batteries couvrent les 16 pads', () => {
    for (const def of Object.values(EXPRESSIVE)) if (def.kind === 'drums') expect([...new Set(def.samples.map(s => s.key))].sort((a, b) => a - b)).toEqual([...Array(16).keys()]);
  });
});

describe('choix des banques', () => {
  it('chaque préréglage échantillonné pointe vers une banque existante', () => {
    for (const { p } of Object.values(PRESETS)) if (p.engine === 'multi') expect(BANKS[p.bank!] || EXPRESSIVE[p.bank!], p.bank).toBeTruthy();
  });

  it('drumBank : le kit choisit la banque de batterie', () => {
    expect(drumBank('acoustic')).toBe('drums');
    expect(drumBank('studio')).toBe('studio_drums');
    expect(drumBank('percussion')).toBe('percussion');
    expect(drumBank('electro')).toBeUndefined();
  });

  it('recordedDynamics : vrai seulement pour les instruments expressifs', () => {
    expect(recordedDynamics('salamander')).toBe(true);
    expect(recordedDynamics('studio_drums')).toBe(false);
    expect(recordedDynamics('piano')).toBe(false);
    expect(recordedDynamics(undefined)).toBe(false);
  });

  it('usedBanks liste les banques à charger pour un projet', () => {
    const p = blankProject();
    expect(usedBanks(p)).toEqual([]);
    p.tracks[0].kit = 'studio';
    p.tracks[1].synth = makeSynth('r_piano');
    expect(usedBanks(p).sort()).toEqual(['piano', 'studio_drums']);
  });
});
