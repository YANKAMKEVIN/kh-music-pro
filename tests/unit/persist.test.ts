import { describe, expect, it } from 'vitest';
import { FILE_FORMAT, FILE_VERSION, PROJECT_SCHEMA, ProjectError, fileEnvelope, parseProject, parseProjectFile, upgradeProject } from '../../src/persist';
import { blankProject, demoProject, migrate, newPatternClip } from '../../src/types';

const code = (f: () => unknown) => { try { f(); } catch (e) { return e instanceof ProjectError ? e.code : 'autre'; } return 'aucune'; };

describe('relecture d\'un projet enregistré', () => {
  it('un nouveau projet porte le schéma courant', () => {
    expect(blankProject().schema).toBe(PROJECT_SCHEMA);
  });

  it('aller-retour sans perte', () => {
    const p = demoProject();
    expect(parseProject(JSON.stringify(p))).toEqual(JSON.parse(JSON.stringify(p)));
  });

  it('un projet sans numéro (anciennes versions) est migré et numéroté', () => {
    const old = JSON.parse(JSON.stringify(blankProject()));
    delete old.schema; delete old.tempos; delete old.exp; delete old.den;
    const p = parseProject(JSON.stringify(old));
    expect(p.schema).toBe(PROJECT_SCHEMA);
    expect(p.tempos).toEqual([]);
    expect(p.den).toBe(4);
    expect(p.exp.bits).toBe(16);
  });

  it('JSON abîmé, vide ou absent : erreur « corrupt »', () => {
    expect(code(() => parseProject('{"name": "x", "tracks": ['))).toBe('corrupt');
    expect(code(() => parseProject(''))).toBe('corrupt');
    expect(code(() => parseProject(undefined))).toBe('corrupt');
    expect(code(() => parseProject(null))).toBe('corrupt');
  });

  it('pas un projet : erreur « invalid »', () => {
    for (const j of ['null', '42', '"texte"', '[]', '{}', '{"tracks": 3}', '{"tracks": [], "schema": "deux"}', '{"tracks": [], "schema": -1}'])
      expect(code(() => parseProject(j)), j).toBe('invalid');
  });

  it('projet d\'une version plus récente : erreur « newer », rien n\'est deviné', () => {
    const p = { ...blankProject(), schema: PROJECT_SCHEMA + 1 };
    expect(code(() => parseProject(JSON.stringify(p)))).toBe('newer');
  });

  it('les pistes et clips abîmés sont écartés, le reste est gardé', () => {
    const p = JSON.parse(JSON.stringify(blankProject()));
    const good = newPatternClip('synth', 0, 'ok'); good.notes = [{ p: 60, s: 0, l: 1, v: 1 }, { p: null, s: 0, l: 1, v: 1 } as never];
    p.tracks[1].clips = [good, { id: 'x', start: 'a', len: 4 }, null, { id: 'y', start: 0, len: -2 }];
    p.tracks.push(null, { id: 'z', type: 'video', clips: [] }, { type: 'synth' }, 'texte');
    p.tracks[0].clips = 'pas une liste';
    p.tracks[2].inserts = [{ id: 'i', type: 'delay', p: { time: 3 } }, { type: 'reverb' }];
    const out = parseProject(JSON.stringify(p));
    expect(out.tracks.map(t => t.type)).toEqual(['drums', 'synth', 'audio']);
    expect(out.tracks[0].clips).toEqual([]);
    expect(out.tracks[1].clips).toHaveLength(1);
    expect(out.tracks[1].clips[0].notes).toEqual([{ p: 60, s: 0, l: 1, v: 1 }]);
    expect(out.tracks[2].inserts.map(i => i.type)).toEqual(['delay']);
  });

  it('un tempo absurde est remplacé, les changements de tempo invalides écartés', () => {
    const p = JSON.parse(JSON.stringify(blankProject()));
    p.bpm = 'vite'; p.tempos = [{ s: 16, bpm: 90 }, { s: 'x', bpm: 80 }, { s: 32, bpm: 0 }];
    const out = parseProject(JSON.stringify(p));
    expect(out.bpm).toBe(120);
    expect(out.tempos).toEqual([{ s: 16, bpm: 90 }]);
  });

  it('un instrument sans réglages reçoit ceux par défaut', () => {
    const p = JSON.parse(JSON.stringify(blankProject()));
    delete p.tracks[1].synth;
    const out = parseProject(JSON.stringify(p));
    expect(out.tracks[1].synth?.preset).toBe('lead');
    expect(out.tracks[1].synth?.engine).toBe('sub');
  });

  it('upgradeProject donne le même résultat que migrate sur un projet sain', () => {
    const a = JSON.parse(JSON.stringify(demoProject()));
    expect(upgradeProject(structuredClone(a))).toEqual({ ...migrate(structuredClone(a)), schema: PROJECT_SCHEMA });
  });
});

describe('fichier projet .khm', () => {
  it('aller-retour de l\'enveloppe avec ses sons', () => {
    const p = demoProject();
    const text = fileEnvelope(p, { s1: { sr: 44100, ch: ['AAAA', 'AAAA'] } });
    const data = JSON.parse(text);
    expect(data.format).toBe(FILE_FORMAT);
    expect(data.version).toBe(FILE_VERSION);
    const back = parseProjectFile(text);
    expect(back.project.tracks).toEqual(JSON.parse(JSON.stringify(p.tracks)));
    expect(back.buffers).toEqual({ s1: { sr: 44100, ch: ['AAAA', 'AAAA'] } });
  });

  it('les sons abîmés sont écartés', () => {
    const text = JSON.stringify({ format: FILE_FORMAT, version: 1, project: blankProject(), buffers: { a: { sr: 0, ch: ['x'] }, b: { sr: 44100, ch: [] }, c: 'non', d: { sr: 48000, ch: ['QUJD'] } } });
    expect(Object.keys(parseProjectFile(text).buffers)).toEqual(['d']);
  });

  it('refuse un fichier abîmé, étranger ou trop récent', () => {
    expect(code(() => parseProjectFile('{'))).toBe('corrupt');
    expect(code(() => parseProjectFile(JSON.stringify({ format: 'autre', project: blankProject() })))).toBe('invalid');
    expect(code(() => parseProjectFile(JSON.stringify({ format: FILE_FORMAT, version: 1 })))).toBe('invalid');
    expect(code(() => parseProjectFile(JSON.stringify({ format: FILE_FORMAT, version: FILE_VERSION + 1, project: blankProject() })))).toBe('newer');
  });

  it('un fichier de la version 1 sans numéro de schéma s\'ouvre', () => {
    const p = JSON.parse(JSON.stringify(blankProject())); delete p.schema;
    const back = parseProjectFile(JSON.stringify({ format: FILE_FORMAT, version: 1, project: p, buffers: {} }));
    expect(back.project.schema).toBe(PROJECT_SCHEMA);
  });
});
