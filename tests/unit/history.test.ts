import { beforeEach, describe, expect, it } from 'vitest';
import { S, commit, findClip, findTrack, onChange, redo, resetHistory, revert, undo, usedBuffers } from '../../src/store';
import { blankProject, newPatternClip } from '../../src/types';

// IndexedDB n'existe pas ici : la sauvegarde automatique échoue en silence, l'historique doit marcher quand même.
beforeEach(() => { S.project = blankProject(); resetHistory(); });

describe('annuler / rétablir', () => {
  it('annule puis rétablit un changement', () => {
    S.project.bpm = 90; commit();
    S.project.bpm = 140; commit();
    undo(); expect(S.project.bpm).toBe(90);
    undo(); expect(S.project.bpm).toBe(120);
    undo(); expect(S.project.bpm).toBe(120);   // rien avant le début
    redo(); expect(S.project.bpm).toBe(90);
    redo(); expect(S.project.bpm).toBe(140);
    redo(); expect(S.project.bpm).toBe(140);   // rien après la fin
  });

  it('un nouveau changement après une annulation efface la suite', () => {
    S.project.bpm = 90; commit();
    undo();
    S.project.bpm = 100; commit();
    redo();
    expect(S.project.bpm).toBe(100);
  });

  it('l\'état restauré est une copie : le modifier ne touche pas l\'historique', () => {
    S.project.name = 'A'; commit();
    S.project.name = 'B'; commit();
    undo();
    S.project.name = 'modifié sans commit';
    redo(); undo();
    expect(S.project.name).toBe('A');
  });

  it('revert abandonne les changements non validés', () => {
    S.project.bpm = 77;
    revert();
    expect(S.project.bpm).toBe(120);
  });

  it('l\'historique garde au plus 150 états', () => {
    for (let i = 1; i <= 200; i++) { S.project.bpm = i; commit(); }
    for (let i = 0; i < 400; i++) undo();
    expect(S.project.bpm).toBe(200 - 149);
  });

  it('chaque validation prévient les vues', () => {
    let n = 0; onChange(() => n++);
    commit(); undo(); redo();
    expect(n).toBe(3);
  });
});

describe('recherche dans le projet', () => {
  it('findTrack et findClip retrouvent piste et clip par identifiant', () => {
    const tr = S.project.tracks[1], c = newPatternClip('synth', 0, 'x'); tr.clips.push(c);
    expect(findTrack(tr.id)).toBe(tr);
    expect(findClip(c.id)).toEqual({ track: tr, clip: c });
    expect(findClip('rien')).toBeNull();
  });

  it('usedBuffers liste les sons des clips audio, des pads et du sampler', () => {
    const p = blankProject();
    p.tracks[0].pads![3] = { bufferId: 'pad', name: 'p' };
    p.tracks[1].synth!.bufferId = 'smp';
    p.tracks[2].clips.push({ id: 'c', name: 'c', start: 0, len: 4, offset: 0, bufferId: 'clip' });
    expect([...usedBuffers(p)].sort()).toEqual(['clip', 'pad', 'smp']);
  });
});
