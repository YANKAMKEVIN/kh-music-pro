import { describe, expect, it } from 'vitest';
import {
  CATS, COLORS, MIX_PRESETS, NPADS, PRESETS, TEMPLATES, blankProject, contentEnd, defaultExport, demoProject, emptyDrums,
  makeSynth, migrate, newBus, newPatternClip, newTrack, templateProject, uid, type Project,
} from '../../src/types';

describe('pistes et clips', () => {
  it('newTrack crée une piste batterie avec ses 16 pads et un kit', () => {
    const t = newTrack('drums', 1);
    expect(t.type).toBe('drums');
    expect(t.pads).toHaveLength(NPADS);
    expect(t.kit).toBe('electro');
    expect(t.synth).toBeUndefined();
    expect(t.name).toBe('Batterie 1');
    expect(t.strip).toBe('fixe');
  });

  it('newTrack crée un instrument avec le préréglage demandé', () => {
    const t = newTrack('synth', 2, 'bass');
    expect(t.synth?.preset).toBe('bass');
    expect(t.synth?.cutoff).toBe(PRESETS.bass.p.cutoff);
    expect(COLORS).toContain(t.color);
  });

  it('newBus est une piste audio sans sortie vers un autre bus', () => {
    const b = newBus(3);
    expect(b.name).toBe('Bus 3');
    expect(b.out).toBe('');
    expect(b.clips).toEqual([]);
  });

  it('newPatternClip : grille de batterie vide ou liste de notes vide, une mesure', () => {
    const d = newPatternClip('drums', 16, 'Beat');
    expect(d.start).toBe(16);
    expect(d.len).toBe(16);
    expect(d.drums).toHaveLength(NPADS);
    expect(d.drums!.every(r => r.length === 16 && r.every(v => v === 0))).toBe(true);
    const n = newPatternClip('synth', 0, 'Mélodie');
    expect(n.notes).toEqual([]);
    expect(n.drums).toBeUndefined();
  });

  it('emptyDrums crée des lignes indépendantes', () => {
    const g = emptyDrums(4); g[0][0] = 1;
    expect(g[1][0]).toBe(0);
  });

  it('uid produit des identifiants distincts', () => {
    const s = new Set(Array.from({ length: 500 }, uid));
    expect(s.size).toBe(500);
  });
});

describe('préréglages d\'instruments', () => {
  it('chaque préréglage appartient à une catégorie connue', () => {
    for (const [id, { cat }] of Object.entries(PRESETS)) expect(CATS, id).toContain(cat);
  });

  it('chaque préréglage a une enveloppe complète et valide', () => {
    for (const [id, { p }] of Object.entries(PRESETS)) {
      for (const k of ['a', 'd', 's', 'r', 'cutoff'] as const) expect(Number.isFinite(p[k]), `${id}.${k}`).toBe(true);
      expect(p.s, id).toBeGreaterThanOrEqual(0);
      expect(p.s, id).toBeLessThanOrEqual(1);
    }
  });

  it('les instruments échantillonnés utilisent le moteur « multi » avec une banque', () => {
    for (const [id, { p }] of Object.entries(PRESETS)) if (id.startsWith('r_')) { expect(p.engine).toBe('multi'); expect(p.bank).toBeTruthy(); }
  });

  it('makeSynth retombe sur « lead » pour un préréglage inconnu, en gardant son nom', () => {
    const s = makeSynth('n-existe-pas');
    expect(s.preset).toBe('n-existe-pas');
    expect(s.cutoff).toBe(PRESETS.lead.p.cutoff);
  });

  it('les préréglages de mixage ne touchent que des champs de piste', () => {
    const t = newTrack('audio', 1);
    for (const preset of Object.values(MIX_PRESETS)) for (const k of Object.keys(preset)) expect(k in t, k).toBe(true);
  });
});

describe('projets', () => {
  it('blankProject : 120 BPM en 4/4, trois pistes, réglages d\'export par défaut', () => {
    const p = blankProject();
    expect(p.bpm).toBe(120);
    expect([p.sig, p.den]).toEqual([4, 4]);
    expect(p.tracks.map(t => t.type)).toEqual(['drums', 'synth', 'audio']);
    expect(p.exp).toEqual(defaultExport());
    expect(contentEnd(p)).toBe(0);
  });

  it('contentEnd donne la fin du dernier clip', () => {
    const p = blankProject();
    const c = newPatternClip('drums', 32, 'x'); c.len = 20; p.tracks[0].clips.push(c);
    expect(contentEnd(p)).toBe(52);
  });

  it('la démo contient de la musique et se relit telle quelle après migration', () => {
    const p = demoProject();
    expect(p.tracks.length).toBe(5);
    expect(contentEnd(p)).toBe(128);
    const copy = migrate(JSON.parse(JSON.stringify(p)));
    expect(copy).toEqual(JSON.parse(JSON.stringify(p)));
  });

  it.each(TEMPLATES)('le modèle « %s » produit un projet cohérent', tpl => {
    const p = templateProject(tpl);
    expect(p.tracks.length).toBeGreaterThanOrEqual(3);
    expect(p.bpm).toBeGreaterThanOrEqual(40);
    expect(p.bpm).toBeLessThanOrEqual(240);
    for (const t of p.tracks) for (const c of t.clips) {
      expect(c.len).toBeGreaterThan(0);
      if (c.drums) expect(c.drums.every(r => r.length === c.patLen)).toBe(true);
      for (const n of c.notes ?? []) { expect(n.p).toBeGreaterThanOrEqual(0); expect(n.p).toBeLessThanOrEqual(127); }
    }
    if (tpl !== 'empty') expect(contentEnd(p)).toBeGreaterThan(0);
  });
});

describe('migration des anciens projets', () => {
  /** Projet tel qu'enregistré par une toute première version : beaucoup de champs absents. */
  const ancient = (): Project => JSON.parse(JSON.stringify({
    name: 'Vieux', bpm: 95, loop: false, loopStart: 0, loopLen: 4, metronome: false, master: 0.9,
    tracks: [
      { id: 'd', name: 'Batterie', type: 'drums', color: '#fff', vol: 1, pan: 0, mute: false, solo: false, eqLow: 0, eqMid: 0, eqHigh: 0, comp: false, rev: 0, dly: 0,
        clips: [{ id: 'c', name: 'Beat', start: 0, len: 16, offset: 0, patLen: 16, drums: [[1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]] }] },
      { id: 's', name: 'Lead', type: 'synth', color: '#0ff', vol: 1, pan: 0, mute: false, solo: false, eqLow: 0, eqMid: 0, eqHigh: 0, comp: false, rev: 0, dly: 0, out: 'bus-disparu',
        synth: { preset: 'Basse', cutoff: 777 }, clips: [] },
    ],
  }));

  it('complète les champs du projet', () => {
    const p = migrate(ancient());
    expect(p.swing).toBe(0);
    expect(p.countIn).toBe(false);
    expect(p.markers).toEqual([]);
    expect(p.buses).toEqual([]);
    expect(p.tempos).toEqual([]);
    expect([p.sig, p.den]).toEqual([4, 4]);
    expect(p.exp).toEqual(defaultExport());
  });

  it('complète les pistes et remet la sortie sur le général si le bus n\'existe plus', () => {
    const p = migrate(ancient());
    const [d, s] = p.tracks;
    expect(d.pads).toHaveLength(NPADS);
    expect(d.kit).toBe('electro');
    expect(d.clips[0].drums).toHaveLength(NPADS);
    expect(d.strip).toBe('fixe');
    expect(s.out).toBe('');
    expect(s.inserts).toEqual([]);
    expect(s.compRatio).toBe(4);
  });

  it('renomme les anciens préréglages et garde les réglages personnalisés', () => {
    const s = migrate(ancient()).tracks[1].synth!;
    expect(s.preset).toBe('bass');
    expect(s.cutoff).toBe(777);
    expect(s.engine).toBe('sub');
  });

  it('un dénominateur inconnu redevient 4, et les réglages d\'export partiels sont complétés', () => {
    const p = ancient() as Project & { den: number };
    (p as unknown as { den: number }).den = 7;
    p.exp = { bits: 24 } as Project['exp'];
    const m = migrate(p);
    expect(m.den).toBe(4);
    expect(m.exp.bits).toBe(24);
    expect(m.exp.rate).toBe(44100);
  });

  it('est idempotente', () => {
    const once = migrate(ancient()), twice = migrate(JSON.parse(JSON.stringify(once)));
    expect(twice).toEqual(once);
  });
});
