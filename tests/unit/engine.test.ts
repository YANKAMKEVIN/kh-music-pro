// Moteur : transport, décompte, boucle, fin du morceau et mode Live, avec un faux Web Audio (tests/unit/fake-audio.ts).
// On fait avancer l'horloge audio à la main et on appelle la programmation des pas comme le ferait la minuterie.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeAudioContext, installFakeAudio } from './fake-audio';
import type { Project } from '../../src/types';

installFakeAudio();
type Eng = typeof import('../../src/audio/engine')['engine'];
let engine: Eng, S: typeof import('../../src/store')['S'], blankProject: () => Project, BAR: number;
let ctx: FakeAudioContext;
const tick = () => (engine as unknown as { tick(): void }).tick();
/** Avance l'horloge audio de `sec` secondes par pas de 25 ms (le rythme de la minuterie). */
const run = (sec: number) => { for (let t = 0; t < sec; t += 0.025) { ctx.currentTime += 0.025; tick(); } };

beforeAll(async () => {
  vi.stubGlobal('fetch', () => Promise.reject(new Error('hors ligne')));
  ({ engine } = await import('../../src/audio/engine'));
  ({ S } = await import('../../src/store'));
  ({ blankProject, BAR } = await import('../../src/types'));
  ctx = FakeAudioContext.last!;
});

beforeEach(() => {
  engine.stop(); engine.stop();
  vi.useFakeTimers();
  const p = blankProject();
  // Un seul instrument synthétique, sans banque de sons à charger.
  p.tracks = p.tracks.filter(t => t.type === 'synth');
  p.tracks[0].synth!.engine = 'sub';
  p.tracks[0].clips = [{ id: 'c1', name: 'c', start: 0, offset: 0, len: BAR * 2, patLen: BAR * 2, notes: [{ p: 60, s: 0, l: 2, v: 0.8 }, { p: 64, s: 8, l: 2, v: 0.8 }] }];
  S.project = p;
  engine.mode = 'arr'; engine.pos = 0;
  ctx.started = [];
});

describe('transport', () => {
  it('la lecture programme les pas à l\'avance (120 ms) et la position suit l\'horloge', async () => {
    const steps: number[] = [];
    engine.onStep = s => steps.push(s);
    await engine.play();
    expect(engine.playing).toBe(true);
    // 120 BPM : une double-croche = 0,125 s ; départ 60 ms après l'appel ; avance de 120 ms : seul le premier pas est programmé.
    expect(steps).toEqual([0]);
    run(1);
    // À 1 s : tous les pas qui tombent avant 1,12 s (0,06 + 0,125 × k) sont programmés, soit les pas 0 à 8.
    expect(steps).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(engine.currentStep()).toBeCloseTo((1 - 0.06) / 0.125, 0);
    expect(engine.perf.steps).toBe(steps.length);
    engine.onStep = () => { };
  });

  it('arrêt : retour au point de départ, puis au début au second arrêt', async () => {
    engine.pos = 16;
    await engine.play(); run(0.5);
    engine.stop();
    expect(engine.playing).toBe(false);
    expect(engine.pos).toBe(16);
    engine.stop();
    expect(engine.pos).toBe(0);
  });

  it('le morceau s\'arrête de lui-même après la fin du contenu', async () => {
    await engine.play();
    run(5);   // 2 mesures = 4 s à 120 BPM
    expect(engine.playing).toBe(false);
    expect(engine.pos).toBe(0);
  });

  it('en boucle, la programmation revient au début de la zone', async () => {
    S.project.loop = true; S.project.loopStart = 0; S.project.loopLen = 1;
    const steps: number[] = [];
    engine.onStep = s => steps.push(s);
    await engine.play(); run(2.5);
    expect(engine.playing).toBe(true);
    expect(Math.max(...steps)).toBe(BAR - 1);
    expect(steps.slice(BAR, BAR + 3)).toEqual([0, 1, 2]);
    engine.onStep = () => { };
  });

  it('le tempo peut changer d\'un pas à l\'autre (carte des tempos)', async () => {
    S.project.tempos = [{ s: 4, bpm: 60 }];
    const times: number[] = [];
    engine.onStep = (_s, t) => times.push(t);
    await engine.play(); run(1.5);
    expect(times[1] - times[0]).toBeCloseTo(0.125);
    expect(times[5] - times[4]).toBeCloseTo(0.25);
    engine.onStep = () => { };
  });
});

describe('décompte et métronome', () => {
  it('le décompte joue un clic par temps (4 en 4/4, accent sur le premier) et décroît de 4 à 0', async () => {
    await engine.play(2);
    const clicks = ctx.started.filter(x => x.kind === 'osc' && (x.freq === 1600 || x.freq === 1000));
    expect(clicks.length).toBe(4);
    expect(clicks.map(c => c.freq)).toEqual([1600, 1000, 1000, 1000]);
    expect(engine.countLeft()).toBeCloseTo(4, 0);
    ctx.currentTime += 1; expect(engine.countLeft()).toBeCloseTo(2, 0);
    ctx.currentTime += 1.2; expect(engine.countLeft()).toBe(0);
  });

  it('en 6/8, le décompte compte deux temps', async () => {
    // Comme renderAll (main.ts) : la mesure et le temps suivent la signature du projet.
    const { setBar, barSteps, beatSteps } = await import('../../src/types');
    S.project.sig = 6; S.project.den = 8;
    setBar(barSteps(6, 8), beatSteps(6, 8));
    await engine.play(1);
    expect(ctx.started.filter(x => x.kind === 'osc' && (x.freq === 1600 || x.freq === 1000)).length).toBe(2);
    setBar(barSteps(4, 4), beatSteps(4, 4));
  });

  it('le métronome clique sur chaque temps, accentué en début de mesure', async () => {
    S.project.metronome = true;
    await engine.play(); run(2);
    const clicks = ctx.started.filter(x => x.kind === 'osc' && (x.freq === 1600 || x.freq === 1000));
    expect(clicks.length).toBeGreaterThanOrEqual(4);
    expect(clicks[0].freq).toBe(1600);
    expect(clicks[1].freq).toBe(1000);
  });
});

describe('mode Live', () => {
  it('un clip lancé démarre, un clip mis en attente part au prochain temps de quantification', async () => {
    S.project.liveQ = 0;
    await engine.launch(S.project.tracks[0].id, 'c1');
    expect(engine.mode).toBe('live');
    expect(engine.liveActive.get(S.project.tracks[0].id)?.clipId).toBe('c1');
    await engine.launch(S.project.tracks[0].id, null);
    expect(engine.liveQueued.size).toBe(1);
    run(2.2);
    expect(engine.liveActive.size).toBe(0);
    engine.stop();
    expect(engine.mode).toBe('arr');
  });

  it('une prise à la volée attend la mesure, puis tourne en boucle à sa fin', async () => {
    const phases: string[] = [];
    engine.onLiveRec = (phase) => { phases.push(phase); return phase === 'start' ? 'neuf' : null; };
    await engine.recordLive(S.project.tracks[0].id, 1);
    expect(engine.liveRec?.from).toBe(0);
    expect(phases).toEqual(['start']);
    run(2.3);
    expect(engine.liveRec).toBeNull();
    expect(engine.liveActive.get(S.project.tracks[0].id)?.clipId).toBe('neuf');
    vi.advanceTimersByTime(200);
    expect(phases).toContain('end');
    engine.onLiveRec = () => null;
  });
});
