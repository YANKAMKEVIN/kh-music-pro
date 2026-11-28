import { describe, expect, it } from 'vitest';
import { exportMidi, flatten, flattenCtl, importMidi, zip } from '../../src/files';
import { GM_DRUMS, blankProject, newPatternClip, newTrack, type Project } from '../../src/types';

const buf = (u: Uint8Array) => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;

function song(): Project {
  const p = blankProject(); p.name = 'Essai'; p.bpm = 100;
  const [dr, syn] = p.tracks;
  const beat = newPatternClip('drums', 0, 'Beat');
  beat.drums![0][0] = 1; beat.drums![2][4] = 0.5; beat.drums![0][8] = 1;
  dr.clips.push(beat);
  const mel = newPatternClip('synth', 0, 'Mélodie');
  mel.notes = [{ p: 60, s: 0, l: 2, v: 0.8 }, { p: 64, s: 4, l: 1.5, v: 0.6 }, { p: 67, s: 8 + 1 / 3, l: 2 / 3, v: 1 }];
  mel.ctl = { pb: [{ s: 0, v: 0 }, { s: 4, v: 0.5 }], mod: [{ s: 2, v: 1 }] };
  syn.clips.push(mel);
  return p;
}

describe('dépliage des clips', () => {
  it('flatten répète un motif sur toute la longueur du clip', () => {
    const tr = newTrack('synth', 1);
    const c = newPatternClip('synth', 16, 'm'); c.patLen = 4; c.len = 12; c.notes = [{ p: 60, s: 1, l: 1, v: 1 }];
    tr.clips.push(c);
    expect(flatten(tr).map(n => n.s)).toEqual([17, 21, 25]);
  });

  it('flatten coupe une note qui dépasse la fin du clip', () => {
    const tr = newTrack('synth', 1);
    const c = newPatternClip('synth', 0, 'm'); c.len = 4; c.patLen = 16; c.notes = [{ p: 60, s: 2, l: 8, v: 1 }];
    tr.clips.push(c);
    expect(flatten(tr)).toEqual([{ p: 60, s: 2, l: 2, v: 1 }]);
  });

  it('flatten applique l\'octave de l\'instrument et convertit la batterie en notes GM', () => {
    const p = song(); p.tracks[1].synth!.octave = 1;
    expect(flatten(p.tracks[1])[0].p).toBe(72);
    const drums = flatten(p.tracks[0]);
    expect(drums.map(n => [n.p, n.s])).toEqual([[GM_DRUMS[0], 0], [GM_DRUMS[2], 4], [GM_DRUMS[0], 8]]);
  });

  it('flattenCtl revient au repos à la fin de chaque clip', () => {
    const out = flattenCtl(song().tracks[1]);
    expect(out.filter(e => e.k === 'pb').at(-1)).toEqual({ k: 'pb', s: 16, v: 0 });
    expect(out.filter(e => e.k === 'mod').at(-1)).toEqual({ k: 'mod', s: 16, v: 0 });
  });
});

describe('export et import MIDI', () => {
  it('le fichier commence par un en-tête MThd de format 1', () => {
    const m = exportMidi(song());
    expect(String.fromCharCode(...m.slice(0, 4))).toBe('MThd');
    expect(m[9]).toBe(1);
  });

  it('aller-retour : tempo, notes, triolets et vélocités sont conservés', () => {
    const p = song(), back = importMidi(buf(exportMidi(p)));
    expect(back.bpm).toBe(100);
    const syn = back.tracks.find(t => t.type === 'synth')!;
    const notes = syn.clips[0].notes!;
    expect(notes.map(n => n.p)).toEqual([60, 64, 67]);
    expect(notes.map(n => n.s)).toEqual([0, 4, 8 + 1 / 3].map(s => Math.round(s * 24) / 24));
    expect(notes[1].l).toBeCloseTo(1.5, 1);
    expect(notes[0].v).toBeCloseTo(0.8, 1);
    expect(syn.name).toBe(p.tracks[1].name);
  });

  it('aller-retour : la batterie retrouve ses pads', () => {
    const back = importMidi(buf(exportMidi(song())));
    const dr = back.tracks.find(t => t.type === 'drums')!;
    const g = dr.clips[0].drums!;
    expect(g[0][0]).toBe(1);
    expect(g[0][8]).toBe(1);
    expect(g[2][4]).toBeCloseTo(0.5, 1);
  });

  it('aller-retour : pitch bend et molette sont relus dans le clip', () => {
    const back = importMidi(buf(exportMidi(song())));
    const ctl = back.tracks.find(t => t.type === 'synth')!.clips[0].ctl!;
    expect(ctl.pb!.find(x => x.s === 4)!.v).toBeCloseTo(0.5, 2);
    expect(ctl.mod!.find(x => x.s === 2)!.v).toBe(1);
  });

  it('aller-retour : changements de tempo et signature 6/8', () => {
    const p = song(); p.tempos = [{ s: 32, bpm: 140 }]; p.sig = 6; p.den = 8;
    const back = importMidi(buf(exportMidi(p)), true);
    expect(back.tempos).toEqual([{ s: 32, bpm: 140 }]);
    expect(back.sig).toEqual({ sig: 6, den: 8 });
  });

  it('les pistes audio ne sont pas exportées', () => {
    const p = song();
    const back = importMidi(buf(exportMidi(p)));
    expect(back.tracks.every(t => t.type !== 'audio')).toBe(true);
    expect(back.tracks).toHaveLength(2);
  });

  it('refuse un fichier qui n\'est pas du MIDI, ou un MIDI sans note', () => {
    expect(() => importMidi(new TextEncoder().encode('pas du tout un midi').buffer as ArrayBuffer)).toThrow('invalid');
    const empty = blankProject(); empty.tracks = [];
    expect(() => importMidi(buf(exportMidi(empty)))).toThrow('empty');
  });
});

describe('archive ZIP', () => {
  it('produit une archive lisible : signatures et CRC32 corrects', async () => {
    const data = new TextEncoder().encode('hello');
    const b = zip([{ name: 'a.txt', data }]);
    const u = new Uint8Array(await b.arrayBuffer()), v = new DataView(u.buffer);
    expect(v.getUint32(0, true)).toBe(0x04034b50);
    expect(v.getUint32(14, true)).toBe(0x3610a686);   // CRC32 de « hello »
    expect(v.getUint32(u.length - 22, true)).toBe(0x06054b50);
    expect(v.getUint16(u.length - 22 + 10, true)).toBe(1);
    expect(new TextDecoder().decode(u.slice(30, 35))).toBe('a.txt');
  });
});
