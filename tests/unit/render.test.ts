// Export : encodage WAV (16 et 24 bits) et répartition des pistes en rendus parallèles.
// Le rendu hors-ligne lui-même (OfflineAudioContext) n'existe pas hors navigateur : la QA (qa/run.cjs) le mesure dans Chromium.
import { describe, expect, it } from 'vitest';
import { installFakeAudio } from './fake-audio';
import { blankProject, newBus, newTrack } from '../../src/types';

// Le faux Web Audio doit être en place avant de charger le moteur (d'où l'import dynamique).
installFakeAudio();
const { encodeWav, renderGroups } = await import('../../src/audio/render');
const buf = (chs: number[][], sr = 44100) => ({ numberOfChannels: chs.length, length: chs[0].length, sampleRate: sr, duration: chs[0].length / sr, getChannelData: (c: number) => Float32Array.from(chs[c]) }) as unknown as AudioBuffer;

describe('encodage WAV', () => {
  it('en-tête RIFF correct et échantillons 16 bits entrelacés, bornés à ±1', async () => {
    const b = encodeWav(buf([[0, 1, -1, 2], [0.5, -0.5, 0, -3]]));
    const v = new DataView(await b.arrayBuffer());
    const str = (o: number, n: number) => String.fromCharCode(...new Uint8Array(v.buffer, o, n));
    expect(str(0, 4)).toBe('RIFF'); expect(str(8, 8)).toBe('WAVEfmt '); expect(str(36, 4)).toBe('data');
    expect(v.getUint16(22, true)).toBe(2); expect(v.getUint32(24, true)).toBe(44100); expect(v.getUint16(34, true)).toBe(16);
    expect(v.getUint32(40, true)).toBe(4 * 2 * 2); expect(b.size).toBe(44 + 16);
    const s = (i: number) => v.getInt16(44 + i * 2, true);
    expect([s(0), s(1), s(2), s(3), s(4), s(5), s(6), s(7)]).toEqual([0, 16383, 32767, -16384, -32768, 0, 32767, -32768]);
  });
  it('24 bits à 48 kHz : trois octets par échantillon', async () => {
    const b = encodeWav(buf([[1, -1]], 48000), 24);
    const v = new DataView(await b.arrayBuffer());
    expect(v.getUint16(34, true)).toBe(24); expect(v.getUint32(24, true)).toBe(48000); expect(v.getUint32(28, true)).toBe(48000 * 3);
    const s24 = (o: number) => (v.getUint8(o) | (v.getUint8(o + 1) << 8) | (v.getInt8(o + 2) << 16));
    expect(s24(44)).toBe(0x7fffff); expect(s24(47)).toBe(-0x800000);
  });
});

describe('rendus parallèles', () => {
  const big = (n: number) => { const p = blankProject(); p.tracks = Array.from({ length: n }, (_, i) => newTrack('synth', i + 1)); return p; };
  it('petit projet ou machine à deux cœurs : un seul rendu', () => {
    expect(renderGroups(big(6), 8)).toBeNull();
    expect(renderGroups(big(20), 2)).toBeNull();
  });
  it('gros projet : pistes réparties sur au plus 4 rendus, aucune perdue ni doublée', () => {
    const p = big(20), g = renderGroups(p, 8)!;
    expect(g.length).toBe(4);
    const ids = g.flatMap(x => x.tracks.map(t => t.id));
    expect(ids.sort()).toEqual(p.tracks.map(t => t.id).sort());
  });
  it('une piste reste avec le bus où elle sort, et avec la source de son sidechain', () => {
    const p = big(16), bus = newBus(1); p.buses = [bus];
    p.tracks[0].out = bus.id; p.tracks[1].out = bus.id;
    p.tracks[2].duck = 0.5; p.tracks[2].sc = p.tracks[3].id;
    const g = renderGroups(p, 8)!;
    const home = (id: string) => g.findIndex(x => x.tracks.some(t => t.id === id));
    expect(home(p.tracks[0].id)).toBe(home(p.tracks[1].id));
    expect(g[home(p.tracks[0].id)].buses.map(b => b.id)).toEqual([bus.id]);
    expect(home(p.tracks[2].id)).toBe(home(p.tracks[3].id));
  });
  it('une piste en solo impose un seul rendu', () => {
    const p = big(16); p.tracks[4].solo = true;
    expect(renderGroups(p, 8)).toBeNull();
  });
});
