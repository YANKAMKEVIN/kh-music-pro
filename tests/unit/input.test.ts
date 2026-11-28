// Jeu en direct : clavier d'ordinateur (disposition des touches) et clavier maître MIDI (messages reçus).
// Le moteur tourne sur un faux Web Audio ; on observe ce qu'il reçoit (notes, pads, contrôles) et ce qui est écrit dans les clips.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { installFakeAudio } from './fake-audio';
import { PADS, PIANO, padOf, pianoNote } from '../../src/keymap';

installFakeAudio();
type Input = typeof import('../../src/input');
let input: Input, engine: typeof import('../../src/audio/engine')['engine'], S: typeof import('../../src/store')['S'];
let types: typeof import('../../src/types');
const on = vi.fn(), off = vi.fn(), pad = vi.fn(), ctl = vi.fn(), sync = vi.fn();

beforeAll(async () => {
  vi.stubGlobal('fetch', () => Promise.reject(new Error('hors ligne')));
  input = await import('../../src/input');
  ({ engine } = await import('../../src/audio/engine'));
  ({ S } = await import('../../src/store'));
  types = await import('../../src/types');
  engine.noteOn = on; engine.noteOff = off; engine.pad = pad; engine.ctl = ctl; engine.sync = sync;
});

const synth = () => S.project.tracks.find(t => t.type === 'synth')!;
const drums = () => S.project.tracks.find(t => t.type === 'drums')!;
beforeEach(() => {
  S.project = types.blankProject();
  S.selTrack = synth().id;
  Object.assign(input.kb, { octave: 0, chord: 1, arp: 'off', arpRate: 2, repeat: 0 });
  input.learn.on = false; input.learn.target = ''; input.learn.map = {};
  for (const f of [on, off, pad, ctl, sync]) f.mockClear();
});
afterEach(() => input.allNotesOff());

describe('clavier d\'ordinateur', () => {
  it('rangée du milieu = touches blanches depuis Do central, rangée du haut = touches noires', () => {
    expect(pianoNote('KeyA', 0)).toBe(60);
    expect(pianoNote('KeyW', 0)).toBe(61);
    expect(pianoNote('KeyD', 0)).toBe(64);
    expect(pianoNote('KeyK', 0)).toBe(72);
    expect(pianoNote('KeyL', 0)).toBe(74);
    expect(pianoNote('KeyQ', 0)).toBeNull();
  });
  it('l\'octave décale de 12 demi-tons', () => {
    expect(pianoNote('KeyA', -1)).toBe(48);
    expect(pianoNote('KeyA', 2)).toBe(84);
  });
  it('les seize pads : chiffres 1 à 8 puis rangée du milieu', () => {
    expect(PADS).toHaveLength(16);
    expect(padOf('Digit1')).toBe(0);
    expect(padOf('KeyA')).toBe(8);
    expect(padOf('KeyK')).toBe(15);
    expect(padOf('KeyZ')).toBe(-1);
    // Les touches blanches du piano sont aussi des pads : chaque touche ne sert qu'à un instrument à la fois.
    expect(Object.keys(PIANO).filter(k => PADS.includes(k)).length).toBeGreaterThan(0);
  });
});

describe('notes jouées', () => {
  it('une touche enfoncée puis relâchée joue et arrête la note sur la piste choisie', () => {
    input.noteOn(60, 0.5);
    expect(on).toHaveBeenCalledWith(synth(), 60, 0.5);
    input.noteOn(60, 0.5);   // déjà tenue : pas de seconde attaque
    expect(on).toHaveBeenCalledTimes(1);
    input.noteOff(60);
    expect(off).toHaveBeenCalledWith(synth(), 60);
  });
  it('accord à un doigt : une touche joue un accord de trois notes', () => {
    input.kb.chord = 3;
    input.noteOn(60);
    expect(on).toHaveBeenCalledTimes(3);
    expect(on.mock.calls.map(c => c[1])).toEqual(types.chordOf(S.project, 60, 3));
    input.noteOff(60);
    expect(off).toHaveBeenCalledTimes(3);
  });
  it('sur une piste de batterie, les notes 36 à 51 frappent les pads', () => {
    S.selTrack = drums().id;
    input.noteOn(38, 1);
    expect(pad).toHaveBeenCalledWith(drums(), 2, 1);
    expect(on).not.toHaveBeenCalled();
  });
  it('notes hors limites ou non numériques ignorées', () => {
    input.noteOn(Number.NaN); input.noteOn(200);
    expect(on).not.toHaveBeenCalled();
  });
  it('tout couper relâche toutes les notes tenues', () => {
    input.noteOn(60); input.noteOn(62); input.noteOn(64);
    input.allNotesOff();
    expect(off).toHaveBeenCalledTimes(3);
  });
});

describe('clavier maître MIDI', () => {
  it('note on / note off (et note on de vélocité 0) sur n\'importe quel canal', () => {
    input.onMidi([0x93, 60, 127]);
    expect(on).toHaveBeenCalledWith(synth(), 60, 1);
    input.onMidi([0x93, 60, 0]);
    expect(off).toHaveBeenCalledWith(synth(), 60);
    input.onMidi([0x90, 62, 64]); input.onMidi([0x80, 62, 0]);
    expect(off).toHaveBeenCalledTimes(2);
  });
  it('pédale de maintien : la note relâchée tient jusqu\'au relâchement de la pédale', () => {
    input.onMidi([0xb0, 64, 127]);
    input.onMidi([0x90, 60, 100]);
    input.onMidi([0x80, 60, 0]);
    expect(off).not.toHaveBeenCalled();
    input.onMidi([0xb0, 64, 0]);
    expect(off).toHaveBeenCalledWith(synth(), 60);
  });
  it('la pédale est propre à chaque canal', () => {
    input.onMidi([0xb1, 64, 127]);
    input.onMidi([0x90, 60, 100]); input.onMidi([0x80, 60, 0]);
    expect(off).toHaveBeenCalledTimes(1);
  });
  it('pitch bend : centre = 0, extrêmes = -1 et +1', () => {
    input.onMidi([0xe0, 0, 64]); expect(ctl).toHaveBeenLastCalledWith(synth(), 'pb', 0);
    input.onMidi([0xe0, 0, 0]); expect(ctl).toHaveBeenLastCalledWith(synth(), 'pb', -1);
    input.onMidi([0xe0, 127, 127]); expect(ctl).toHaveBeenLastCalledWith(synth(), 'pb', 1);
  });
  it('molette de modulation (CC1) et aftertouch de canal ou polyphonique', () => {
    input.onMidi([0xb0, 1, 127]); expect(ctl).toHaveBeenLastCalledWith(synth(), 'mod', 1);
    input.onMidi([0xd0, 64]); expect(ctl).toHaveBeenLastCalledWith(synth(), 'at', Math.round(64 / 127 * 1000) / 1000);
    input.onMidi([0xa0, 60, 127]); expect(ctl).toHaveBeenLastCalledWith(synth(), 'at', 1);
  });
  it('CC120 / CC123 (tout couper) relâche les notes tenues', () => {
    input.onMidi([0x90, 60, 100]); input.onMidi([0x90, 64, 100]);
    input.onMidi([0xb0, 123, 0]);
    expect(off).toHaveBeenCalledTimes(2);
  });
  it('messages abîmés ignorés sans erreur', () => {
    expect(() => { input.onMidi([0x90]); input.onMidi([0x90, 300, 1]); input.onMidi([0x90, 1.5, 1]); input.onMidi([]); }).not.toThrow();
    expect(on).not.toHaveBeenCalled();
  });
});

describe('assignation des boutons d\'un contrôleur', () => {
  it('apprend un CC puis pilote le volume de la piste dans sa plage', () => {
    vi.useFakeTimers();
    input.learn.on = true; input.learn.target = '1:vol';
    input.onMidi([0xb0, 20, 0]);
    expect(input.learn.map['20']).toBe('1:vol');
    expect(input.ccOf('1:vol')).toBe('20');
    input.learn.on = false;
    input.onMidi([0xb0, 20, 127]);
    expect(S.project.tracks[1].vol).toBe(1.25);
    input.onMidi([0xb0, 20, 0]);
    expect(S.project.tracks[1].vol).toBe(0);
    vi.useRealTimers();
  });
  it('un pan assigné revient exactement au centre près du milieu', () => {
    input.learn.map = { '21': 'm:filter' };
    input.onMidi([0xb0, 21, 64]);
    expect(S.project.filter).toBe(0);
  });
  it('la molette assignée à un réglage ne module plus le son', () => {
    input.learn.map = { '1': 'm:master' };
    input.onMidi([0xb0, 1, 127]);
    expect(ctl).not.toHaveBeenCalled();
    expect(S.project.master).toBe(1.25);
  });
  it('effacer les assignations', () => {
    input.learn.map = { '20': '1:vol' };
    input.clearMidiMap();
    expect(input.learn.map).toEqual({});
  });
});
