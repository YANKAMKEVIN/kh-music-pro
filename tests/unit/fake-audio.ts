// Faux Web Audio minimal pour tester la logique du moteur sans navigateur (happy-dom n'a pas d'AudioContext).
// Chaque nœud est un Proxy : toute méthode inconnue est acceptée, chaque paramètre audio garde sa valeur.
// On ne vérifie pas le son produit (la QA navigateur le mesure) : seulement ce que le moteur programme, et quand.

export interface Started { kind: string; at: number; freq?: number }

class FakeParam {
  value: number;
  events: { type: string; v: number; t: number }[] = [];
  constructor(v = 0) { this.value = v; }
  setValueAtTime(v: number, t: number) { this.events.push({ type: 'set', v, t }); return this; }
  linearRampToValueAtTime(v: number, t: number) { this.events.push({ type: 'lin', v, t }); return this; }
  exponentialRampToValueAtTime(v: number, t: number) { this.events.push({ type: 'exp', v, t }); return this; }
  setTargetAtTime(v: number, t: number) { this.value = v; this.events.push({ type: 'target', v, t }); return this; }
  setValueCurveAtTime() { return this; }
  cancelScheduledValues() { return this; }
  cancelAndHoldAtTime() { return this; }
}

const PARAMS = new Set(['gain', 'frequency', 'detune', 'Q', 'pan', 'delayTime', 'threshold', 'knee', 'ratio', 'attack', 'release', 'playbackRate', 'offset']);

function fakeBuffer(channels: number, length: number, sampleRate: number) {
  const data = Array.from({ length: channels }, () => new Float32Array(length));
  return { numberOfChannels: channels, length, sampleRate, duration: length / sampleRate, getChannelData: (c: number) => data[c], copyToChannel() { /* rien */ }, copyFromChannel() { /* rien */ } };
}

export class FakeAudioContext {
  static last?: FakeAudioContext;
  currentTime = 0;
  sampleRate = 44100;
  baseLatency = 0.005;
  outputLatency = 0.01;
  state = 'running';
  started: Started[] = [];
  destination: unknown;
  audioWorklet = { addModule: () => Promise.resolve() };
  listener = {};
  constructor() { FakeAudioContext.last = this; this.destination = this.node('destination'); }
  resume() { return Promise.resolve(); }
  suspend() { return Promise.resolve(); }
  close() { return Promise.resolve(); }
  decodeAudioData() { return Promise.resolve(fakeBuffer(2, 4410, this.sampleRate)); }
  createBuffer(c: number, len: number, sr: number) { return fakeBuffer(c, len, sr); }
  createPeriodicWave() { return {}; }
  /** Nœud factice : connect renvoie sa cible (chaînage), start/stop sont relevés pour les sources. */
  node(kind: string): Record<string, unknown> {
    const ctx = this, store: Record<string | symbol, unknown> = { kind, channelCount: 2, numberOfInputs: 1, numberOfOutputs: 1 };
    const proxy: Record<string, unknown> = new Proxy(store, {
      get(target, prop) {
        if (prop in target) return target[prop];
        if (typeof prop === 'string' && PARAMS.has(prop)) return (target[prop] = new FakeParam(prop === 'gain' ? 1 : 0));
        if (prop === 'connect') return (dst: unknown) => dst;
        if (prop === 'start') return (at = 0) => { ctx.started.push({ kind, at, freq: (target.frequency as FakeParam | undefined)?.value }); };
        if (prop === 'port') return (target.port = { postMessage() { /* rien */ }, onmessage: null });
        if (prop === 'parameters') return (target.parameters = new Map([['amt', new FakeParam()]]));
        if (prop === 'frequencyBinCount') return 128;
        if (prop === 'then') return undefined;   // n'est pas une promesse
        return () => undefined;
      },
      set(target, prop, v) { target[prop] = v; return true; },
    });
    return proxy;
  }
  createGain() { return this.node('gain'); }
  createOscillator() { return this.node('osc'); }
  createBiquadFilter() { return this.node('biquad'); }
  createDynamicsCompressor() { return this.node('comp'); }
  createWaveShaper() { return this.node('shaper'); }
  createStereoPanner() { return this.node('pan'); }
  createDelay() { return this.node('delay'); }
  createConvolver() { return this.node('conv'); }
  createAnalyser() { const n = this.node('analyser'); n.fftSize = 2048; n.getFloatTimeDomainData = (b: Float32Array) => b.fill(0); n.getByteFrequencyData = (b: Uint8Array) => b.fill(0); return n; }
  createChannelSplitter() { return this.node('split'); }
  createChannelMerger() { return this.node('merge'); }
  createBufferSource() { return this.node('buffer'); }
  createConstantSource() { return this.node('const'); }
  createMediaStreamSource() { return this.node('stream'); }
}

/** Installe le faux contexte dans l'environnement global (avant d'importer le moteur). */
export function installFakeAudio() {
  const g = globalThis as Record<string, unknown>;
  g.AudioContext = FakeAudioContext;
  g.OfflineAudioContext = FakeAudioContext;
  g.AudioWorkletNode = class { constructor(ctx: FakeAudioContext) { return ctx.node('worklet'); } };
  g.AudioBuffer = class { constructor(o: { numberOfChannels: number; length: number; sampleRate: number }) { return fakeBuffer(o.numberOfChannels, o.length, o.sampleRate); } };
}
