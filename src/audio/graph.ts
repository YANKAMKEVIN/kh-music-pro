import { drumSample, sampleFor } from './banks';
import { Clip, KITS, Project, Pt, SynthParams, Track, autoAt, durAt, stepDur as sd, timeOf } from '../types';

export interface TrackNodes {
  input: GainNode; lp: BiquadFilterNode; hp: BiquadFilterNode; shaper: WaveShaperNode;
  low: BiquadFilterNode; mid: BiquadFilterNode; high: BiquadFilterNode;
  comp: DynamicsCompressorNode; makeup: GainNode; fader: GainNode; auto: GainNode; duck: GainNode; pan: StereoPannerNode;
  revSend: GainNode; dlySend: GainNode; analyser?: AnalyserNode; compOn?: boolean; driveVal?: number; duckAmt: number;
  outId?: string;
  crush: WaveShaperNode; crushIn: GainNode; crushOut: GainNode; crushVal?: number; chWet: GainNode; trem: GainNode; tremDepth: GainNode; tremLfo: OscillatorNode;
}
export interface Voice { release(at: number): void }
type Buffers = Map<string, AudioBuffer>;

/** Filtre « DJ » bipolaire : négatif = passe-bas, positif = passe-haut. */
const djFreqs = (v: number): [number, number] => [v < 0 ? 20000 * Math.pow(2, v * 8) : 20000, v > 0 ? 20 * Math.pow(2, v * 9.5) : 10];
/**
 * Résonance des filtres (en dB, comme l'attend le navigateur). Au repos : aucune, pour que le filtre ne colore pas le son
 * — une légère bosse dans le grave s'ajoutait sinon à chaque étage traversé. En action : un peu de résonance, pour le caractère.
 */
const REST_Q = -3.01, SWEEP_Q = 3;

/** Lo-fi : réduit le nombre de niveaux du signal (de 32 à 3 paliers par demi-onde). */
function crushCurve(amount: number) {
  const L = 3 + 29 * Math.pow(1 - amount, 2), n = 4096, c = new Float32Array(n);
  for (let i = 0; i < n; i++) c[i] = Math.round((i / (n - 1) * 2 - 1) * L) / L;
  return c;
}

function driveCurve(amount: number) {
  const k = 1 + amount * 24, n = 1024, c = new Float32Array(n), norm = Math.tanh(k);
  for (let i = 0; i < n; i++) c[i] = Math.tanh(k * (i / (n - 1) * 2 - 1)) / norm;
  return c;
}

/** Graphe de mixage. Le même code sert au temps réel et au rendu hors-ligne (export). */
export class Mix {
  tracks = new Map<string, TrackNodes>();
  master: GainNode; mlp: BiquadFilterNode; mhp: BiquadFilterNode; limiter: DynamicsCompressorNode; analyser?: AnalyserNode;
  revBus: GainNode; dlyBus: GainNode; delay: DelayNode; noise: AudioBuffer;
  conv: ConvolverNode; fb: GainNode; revSize = 0;
  meq: BiquadFilterNode[]; wDirect: GainNode[]; wCross: GainNode[];
  /** Effets de performance (temps réel) : envois momentanés du général vers un écho et une réverb, bégaiement. */
  fxEcho?: GainNode; fxRev?: GainNode; fxDelay?: DelayNode; stutter?: AudioWorkletNode; private out: AudioNode;
  /** Vrai pendant la lecture de l'arrangement : les paramètres automatisés ne sont plus pilotés par `sync`. */
  autoOn = false;
  active = new Set<AudioScheduledSourceNode>();

  constructor(public ctx: BaseAudioContext, public live: boolean) {
    this.master = ctx.createGain();
    this.mlp = ctx.createBiquadFilter(); this.mlp.type = 'lowpass'; this.mlp.frequency.value = 20000; this.mlp.Q.value = 1.2;
    this.mhp = ctx.createBiquadFilter(); this.mhp.type = 'highpass'; this.mhp.frequency.value = 20; this.mhp.Q.value = 1.2;
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -2; this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20; this.limiter.attack.value = 0.002; this.limiter.release.value = 0.1;
    // Égaliseur du général, puis largeur stéréo (mélange croisé des deux canaux).
    this.meq = [['lowshelf', 120], ['peaking', 1200], ['highshelf', 7000]].map(([type, f]) => { const b = ctx.createBiquadFilter(); b.type = type as BiquadFilterType; b.frequency.value = f as number; b.Q.value = 0.8; return b; });
    const split = ctx.createChannelSplitter(2), merge = ctx.createChannelMerger(2), stereo = ctx.createGain();
    stereo.channelCount = 2; stereo.channelCountMode = 'explicit';
    this.wDirect = [ctx.createGain(), ctx.createGain()]; this.wCross = [ctx.createGain(), ctx.createGain()];
    for (const g of this.wCross) g.gain.value = 0;
    this.master.connect(this.mlp).connect(this.mhp).connect(this.meq[0]).connect(this.meq[1]).connect(this.meq[2]).connect(stereo).connect(split);
    for (const c of [0, 1]) { split.connect(this.wDirect[c], c).connect(merge, 0, c); split.connect(this.wCross[c], c).connect(merge, 0, 1 - c); }
    merge.connect(this.limiter).connect(ctx.destination);
    this.out = merge;
    if (live) {
      this.fxEcho = ctx.createGain(); this.fxEcho.gain.value = 0;
      const d = this.fxDelay = ctx.createDelay(2), dfb = ctx.createGain(), dlp = ctx.createBiquadFilter(); dfb.gain.value = 0.55; dlp.type = 'lowpass'; dlp.frequency.value = 4000;
      this.master.connect(this.fxEcho).connect(d).connect(dlp); dlp.connect(dfb).connect(d); dlp.connect(this.limiter);
      this.fxRev = ctx.createGain(); this.fxRev.gain.value = 0;
      const wash = ctx.createConvolver(); wash.buffer = this.impulse(4.5);
      this.master.connect(this.fxRev).connect(wash).connect(this.limiter);
    }
    if (live) { this.analyser = ctx.createAnalyser(); this.analyser.fftSize = 512; this.limiter.connect(this.analyser); }

    this.revBus = ctx.createGain();
    const conv = this.conv = ctx.createConvolver();
    this.revBus.connect(conv).connect(this.master);

    this.dlyBus = ctx.createGain();
    this.delay = ctx.createDelay(2);
    const fb = this.fb = ctx.createGain(); fb.gain.value = 0.38;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3500;
    this.dlyBus.connect(this.delay).connect(lp); lp.connect(fb).connect(this.delay); lp.connect(this.master);

    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const n = this.noise.getChannelData(0);
    for (let i = 0; i < n.length; i++) n[i] = Math.random() * 2 - 1;
  }

  /** Insère le bégaiement (boucle des derniers instants) juste avant le limiteur. */
  async initStutter() {
    if (this.stutter || !this.live) return;
    const code = `class KhStut extends AudioWorkletProcessor{constructor(){super();this.n=sampleRate*4|0;this.b=[new Float32Array(this.n),new Float32Array(this.n)];this.w=0;this.len=0;this.s=0;this.p=0;this.port.onmessage=e=>{this.len=Math.min(this.n-1,e.data.len|0);this.s=(this.w-this.len+this.n)%this.n;this.p=0}}
process(i,o){const a=i[0],out=o[0],N=out[0].length;for(let k=0;k<N;k++){if(this.len>0){const j=(this.s+this.p)%this.n,e=Math.min(1,this.p/48,(this.len-this.p)/48);for(let c=0;c<out.length;c++)out[c][k]=this.b[c%2][j]*e;this.p=(this.p+1)%this.len}else{for(let c=0;c<out.length;c++){const v=a[c]?a[c][k]:(a[0]?a[0][k]:0);this.b[c%2][this.w]=v;out[c][k]=v}this.w=(this.w+1)%this.n}}return true}}registerProcessor('kh-stut',KhStut)`;
    await (this.ctx as AudioContext).audioWorklet.addModule(URL.createObjectURL(new Blob([code], { type: 'text/javascript' })));
    if (this.stutter) return;
    const node = this.stutter = new AudioWorkletNode(this.ctx, 'kh-stut', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
    this.out.disconnect(this.limiter); this.out.connect(node).connect(this.limiter);
  }

  private impulse(sec: number) {
    const sr = this.ctx.sampleRate, len = Math.floor(sr * sec), b = this.ctx.createBuffer(2, len, sr);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
    }
    return b;
  }

  private set(p: AudioParam, v: number) {
    if (this.live) p.setTargetAtTime(v, this.ctx.currentTime, 0.015); else p.value = v;
  }

  private makeTrack(): TrackNodes {
    const c = this.ctx;
    const n: TrackNodes = {
      input: c.createGain(), lp: c.createBiquadFilter(), hp: c.createBiquadFilter(), shaper: c.createWaveShaper(),
      low: c.createBiquadFilter(), mid: c.createBiquadFilter(), high: c.createBiquadFilter(),
      comp: c.createDynamicsCompressor(), makeup: c.createGain(), fader: c.createGain(), auto: c.createGain(), duck: c.createGain(), pan: c.createStereoPanner(),
      revSend: c.createGain(), dlySend: c.createGain(), duckAmt: 0,
      crush: c.createWaveShaper(), crushIn: c.createGain(), crushOut: c.createGain(), chWet: c.createGain(), trem: c.createGain(), tremDepth: c.createGain(), tremLfo: c.createOscillator(),
    };
    n.lp.type = 'lowpass'; n.lp.frequency.value = 20000; n.hp.type = 'highpass'; n.hp.frequency.value = 20;
    n.lp.Q.value = REST_Q; n.hp.Q.value = REST_Q; n.hp.frequency.value = 10;
    n.shaper.oversample = '2x';
    n.low.type = 'lowshelf'; n.low.frequency.value = 200;
    n.mid.type = 'peaking'; n.mid.frequency.value = 1000; n.mid.Q.value = 0.9;
    n.high.type = 'highshelf'; n.high.frequency.value = 5000;
    n.comp.threshold.value = -24; n.comp.ratio.value = 4; n.comp.attack.value = 0.005; n.comp.release.value = 0.2;
    n.makeup.gain.value = 1.5; n.fader.gain.value = 0; n.revSend.gain.value = 0; n.dlySend.gain.value = 0;
    // Modulation : lo-fi, puis chorus (deux voix retardées qui ondulent), puis trémolo.
    n.input.connect(n.lp).connect(n.hp).connect(n.shaper).connect(n.crushIn).connect(n.crush).connect(n.crushOut).connect(n.trem);
    n.chWet.gain.value = 0;
    for (const [ms, hz] of [[17, 0.7], [26, 1.1]]) {
      const d = c.createDelay(0.1), lfo = c.createOscillator(), depth = c.createGain();
      d.delayTime.value = ms / 1000; lfo.frequency.value = hz; depth.gain.value = 0.0035;
      lfo.connect(depth).connect(d.delayTime); lfo.start();
      n.crushOut.connect(d).connect(n.chWet);
    }
    n.chWet.connect(n.trem);
    n.tremDepth.gain.value = 0; n.tremLfo.connect(n.tremDepth).connect(n.trem.gain); n.tremLfo.start();
    n.trem.connect(n.low).connect(n.mid).connect(n.high);
    n.comp.connect(n.makeup).connect(n.fader);
    n.fader.connect(n.auto).connect(n.duck).connect(n.pan); // la sortie (général ou bus) est branchée par sync
    n.pan.connect(n.revSend).connect(this.revBus);
    n.pan.connect(n.dlySend).connect(this.dlyBus);
    if (this.live) { n.analyser = c.createAnalyser(); n.analyser.fftSize = 256; n.duck.connect(n.analyser); }
    return n;
  }

  sync(p: Project) {
    this.set(this.master.gain, p.master);
    this.set(this.delay.delayTime, Math.min(1.9, p.dlySteps * sd(p.bpm)));
    this.set(this.fb.gain, p.dlyFb);
    if (this.revSize !== p.revSize) { this.conv.buffer = this.impulse(p.revSize); this.revSize = p.revSize; }
    const [mlp, mhp] = djFreqs(p.filter);
    this.set(this.mlp.frequency, mlp); this.set(this.mhp.frequency, mhp);
    this.set(this.mlp.Q, p.filter < 0 ? SWEEP_Q : REST_Q); this.set(this.mhp.Q, p.filter > 0 ? SWEEP_Q : REST_Q);
    this.set(this.meq[0].gain, p.mLow); this.set(this.meq[1].gain, p.mMid); this.set(this.meq[2].gain, p.mHigh);
    for (const c of [0, 1]) { this.set(this.wDirect[c].gain, (1 + p.width) / 2); this.set(this.wCross[c].gain, (1 - p.width) / 2); }
    const anySolo = p.tracks.some(t => t.solo), busIds = new Set(p.buses.map(b => b.id));
    // Les bus d'abord : les pistes qui y sont envoyées doivent trouver leur entrée.
    for (const t of [...p.buses, ...p.tracks]) {
      let n = this.tracks.get(t.id);
      if (!n) { n = this.makeTrack(); this.tracks.set(t.id, n); }
      const isBus = busIds.has(t.id), outId = !isBus && busIds.has(t.out) ? t.out : '';
      if (n.outId !== outId) {
        if (n.outId !== undefined) n.pan.disconnect(n.outId ? this.tracks.get(n.outId)?.input ?? this.master : this.master);
        n.pan.connect(outId ? this.tracks.get(outId)!.input : this.master); n.outId = outId;
      }
      this.set(n.mid.frequency, t.eqMidF); this.set(n.comp.threshold, t.compThr); this.set(n.comp.ratio, t.compRatio);
      this.set(n.makeup.gain, Math.pow(10, -t.compThr * (1 - 1 / t.compRatio) * 0.2 / 20));
      this.set(n.low.gain, t.eqLow); this.set(n.mid.gain, t.eqMid); this.set(n.high.gain, t.eqHigh);
      const au = this.autoOn ? t.auto : undefined;
      if (!au?.filter?.length) { const [lp, hp] = djFreqs(t.filter); this.set(n.lp.frequency, lp); this.set(n.hp.frequency, hp); }
      const swept = !!t.auto?.filter?.length;
      this.set(n.lp.Q, swept || t.filter < 0 ? SWEEP_Q : REST_Q); this.set(n.hp.Q, swept || t.filter > 0 ? SWEEP_Q : REST_Q);
      n.duckAmt = t.duck;
      // Le signal est amplifié avant la réduction puis ramené à son niveau : l'effet reste audible sur un son faible.
      if (n.crushVal !== t.crush) { n.crush.curve = t.crush > 0 ? crushCurve(t.crush) : null; n.crushIn.gain.value = t.crush > 0 ? 3 : 1; n.crushOut.gain.value = t.crush > 0 ? 1 / 3 : 1; n.crushVal = t.crush; }
      if (!au?.chorus?.length) this.set(n.chWet.gain, t.chorus * 0.8);
      this.set(n.trem.gain, 1 - t.trem / 2); this.set(n.tremDepth.gain, t.trem / 2); this.set(n.tremLfo.frequency, p.bpm / 30);
      if (n.driveVal !== t.drive) { n.shaper.curve = t.drive > 0 ? driveCurve(t.drive) : null; n.driveVal = t.drive; }
      if (n.compOn !== t.comp) { n.high.disconnect(); n.high.connect(t.comp ? n.comp : n.fader); n.compOn = t.comp; }
      const audible = !t.mute && (isBus || !anySolo || t.solo);
      this.set(n.fader.gain, audible ? t.vol : 0);
      if (!au?.pan?.length) this.set(n.pan.pan, t.pan);
      if (!au?.rev?.length) this.set(n.revSend.gain, t.rev);
      if (!au?.dly?.length) this.set(n.dlySend.gain, t.dly);
    }
    for (const [id, n] of this.tracks) if (!p.tracks.some(t => t.id === id) && !busIds.has(id)) {
      n.pan.disconnect(); n.revSend.disconnect(); n.dlySend.disconnect(); this.tracks.delete(id);
    }
  }

  /** Automation : programme la rampe du pas `s` (instant `t`) vers le pas suivant. */
  applyAuto(p: Project, s: number, t: number) {
    const d = durAt(p, s);
    for (const tr of p.tracks) {
      const a = tr.auto, n = this.tracks.get(tr.id);
      if (!a || !n) continue;
      const ramp = (prm: AudioParam, pts: Pt[] | undefined, map: (v: number) => number) => {
        if (!pts?.length) return;
        prm.setValueAtTime(map(autoAt(pts, s)), t); prm.linearRampToValueAtTime(map(autoAt(pts, s + 1)), t + d);
      };
      ramp(n.auto.gain, a.vol, v => v); ramp(n.pan.pan, a.pan, v => v);
      ramp(n.lp.frequency, a.filter, v => djFreqs(v)[0]); ramp(n.hp.frequency, a.filter, v => djFreqs(v)[1]);
      ramp(n.revSend.gain, a.rev, v => v); ramp(n.dlySend.gain, a.dly, v => v); ramp(n.chWet.gain, a.chorus, v => v * 0.8);
    }
  }

  /** Fin de lecture : annule les rampes en attente et rend la main aux réglages du mixeur. */
  clearAuto(p: Project) {
    this.autoOn = false;
    const now = this.ctx.currentTime;
    for (const n of this.tracks.values()) {
      for (const prm of [n.auto.gain, n.duck.gain, n.pan.pan, n.lp.frequency, n.hp.frequency, n.revSend.gain, n.dlySend.gain, n.chWet.gain]) prm.cancelScheduledValues(now);
      n.auto.gain.setTargetAtTime(1, now, 0.015); n.duck.gain.setTargetAtTime(1, now, 0.015);
    }
    this.sync(p);
  }

  /** Courbe de l'égaliseur et des filtres d'une tranche : gain en dB pour chaque fréquence demandée. */
  eqCurve(id: string, freqs: Float32Array): Float32Array | null {
    const n = this.tracks.get(id);
    if (!n) return null;
    const out = new Float32Array(freqs.length), mag = new Float32Array(freqs.length), ph = new Float32Array(freqs.length);
    for (const f of [n.lp, n.hp, n.low, n.mid, n.high]) { f.getFrequencyResponse(freqs as Float32Array<ArrayBuffer>, mag, ph); for (let i = 0; i < out.length; i++) out[i] += 20 * Math.log10(Math.max(1e-6, mag[i])); }
    return out;
  }

  /** Sidechain : chaque coup de kick fait « pomper » les pistes qui le demandent. */
  kick(t: number) {
    for (const n of this.tracks.values()) if (n.duckAmt > 0) {
      n.duck.gain.setTargetAtTime(1 - n.duckAmt, t, 0.004); n.duck.gain.setTargetAtTime(1, t + 0.05, 0.09);
    }
  }

  /**
   * Garde une référence sur chaque source. En temps réel, elle est libérée à la fin du son ;
   * en rendu hors-ligne, elle est conservée jusqu'au bout, sinon le ramasse-miettes peut
   * supprimer des voix avant qu'elles aient joué.
   */
  reg<T extends AudioScheduledSourceNode>(n: T): T {
    this.active.add(n);
    if (this.live) n.onended = () => this.active.delete(n);
    return n;
  }

  stopAll() {
    for (const n of this.active) { try { n.stop(); } catch { /* déjà arrêté */ } }
    this.active.clear();
  }
}

// ---------- Boîte à rythmes (16 sons synthétisés, modulés par le kit) ----------

function env(ctx: BaseAudioContext, t: number, peak: number, decay: number) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(peak, t); g.gain.exponentialRampToValueAtTime(0.001, t + decay);
  return g;
}
function osc(mix: Mix, type: OscillatorType, t: number, dur: number, f0: number, f1?: number, ft = 0.1) {
  const o = mix.reg(mix.ctx.createOscillator()); o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + ft);
  o.start(t); o.stop(t + dur + 0.02);
  return o;
}
function noise(mix: Mix, t: number, dur: number, type: BiquadFilterType, freq: number, q = 1) {
  const s = mix.reg(mix.ctx.createBufferSource()); s.buffer = mix.noise; s.loop = true;
  const f = mix.ctx.createBiquadFilter(); f.type = type; f.frequency.value = Math.min(freq, 20000); f.Q.value = q;
  s.connect(f); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
  return f;
}

export function playDrum(mix: Mix, dest: AudioNode, row: number, t: number, vel = 1, kit = 'electro', semis = 0) {
  const c = mix.ctx, K = KITS[kit] ?? KITS.electro, T = K.tune * Math.pow(2, semis / 12), D = K.dec;
  const tone = (type: OscillatorType, f0: number, f1: number, ft: number, dur: number, g: number) =>
    osc(mix, type, t, dur * D, f0 * T, f1 * T, ft).connect(env(c, t, vel * g, dur * D)).connect(dest);
  const nz = (type: BiquadFilterType, f: number, dur: number, g: number, q = 1) =>
    noise(mix, t, dur * D, type, f * T, q).connect(env(c, t, vel * g, dur * D)).connect(dest);
  switch (row) {
    case 0: tone('sine', 160, 42, 0.13, 0.45, 1); tone('triangle', 900, 200, 0.02, 0.03, 0.35); break;       // kick
    case 1: nz('highpass', 1400, 0.2, 0.7); tone('triangle', 220, 140, 0.08, 0.12, 0.6); break;             // snare
    case 2: { // clap
      const f = noise(mix, t, 0.3, 'bandpass', 1300 * T, 1.2), g = c.createGain();
      g.gain.setValueAtTime(0, t);
      for (const o of [0, 0.011, 0.022]) { g.gain.setValueAtTime(vel * 0.9, t + o); g.gain.exponentialRampToValueAtTime(0.08, t + o + 0.01); }
      g.gain.setValueAtTime(vel * 0.9, t + 0.033); g.gain.exponentialRampToValueAtTime(0.001, t + 0.033 + 0.25 * D);
      f.connect(g).connect(dest); break;
    }
    case 3: nz('highpass', 7500, 0.055, 0.45); break;                                                       // charley fermé
    case 4: nz('highpass', 7000, 0.33, 0.4); break;                                                         // charley ouvert
    case 5: tone('sine', 210, 95, 0.2, 0.33, 0.8); break;                                                   // tom basse
    case 6: { // rim
      const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1700 * T; f.Q.value = 3;
      osc(mix, 'square', t, 0.04, 820 * T).connect(f).connect(env(c, t, vel * 0.7, 0.04)).connect(dest); break;
    }
    case 7: { // cloche
      const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 800 * T; f.Q.value = 2;
      const g = env(c, t, vel * 0.4, 0.25 * D);
      osc(mix, 'square', t, 0.25 * D, 540 * T).connect(f); osc(mix, 'square', t, 0.25 * D, 800 * T).connect(f);
      f.connect(g).connect(dest); break;
    }
    case 8: tone('sine', 125, 40, 0.22, 1.0, 1); break;                                                     // kick 808
    case 9: nz('bandpass', 2600, 0.13, 0.9, 0.8); tone('triangle', 280, 190, 0.05, 0.08, 0.5); break;       // snare sèche
    case 10: tone('sine', 300, 150, 0.18, 0.28, 0.8); break;                                                // tom médium
    case 11: tone('sine', 420, 220, 0.15, 0.24, 0.75); break;                                               // tom aigu
    case 12: nz('bandpass', 6200, 0.09, 0.5, 1.6); break;                                                   // shaker
    case 13: nz('highpass', 4500, 1.3, 0.4); nz('bandpass', 9000, 0.6, 0.25, 0.7); break;                   // crash
    case 14: nz('highpass', 8500, 0.5, 0.25); tone('square', 5200, 5200, 0.1, 0.3, 0.04); break;            // ride
    default: tone('sine', 340, 250, 0.06, 0.2, 0.8);                                                         // conga
  }
}

/** Déclenche un pad : sample chargé par l'utilisateur, sinon son synthétisé. */
export function hitPad(mix: Mix, buffers: Buffers, tr: Track, dest: AudioNode, row: number, t: number, vel = 1) {
  const pad = tr.pads?.[row], buf = pad ? buffers.get(pad.bufferId) : undefined, fx = tr.padFx?.[row];
  if (row === 0 || row === 8) mix.kick(t);
  // Réglages du pad : volume, hauteur, panoramique.
  let out = dest;
  if (fx?.pan) { const pn = mix.ctx.createStereoPanner(); pn.pan.value = fx.pan; pn.connect(dest); out = pn; }
  const v = vel * (fx?.vol ?? 1), semis = fx?.tune ?? 0;
  // Sans sample personnel : la batterie acoustique si elle est choisie et chargée, sinon le son synthétisé.
  const real = !buf && tr.kit === 'acoustic' ? drumSample(row) : undefined;
  if (!buf && !real) return playDrum(mix, out, row, t, v, tr.kit, semis);
  const s = mix.reg(mix.ctx.createBufferSource()), g = mix.ctx.createGain();
  s.buffer = buf ?? real!.buf; g.gain.value = v * (real ? 0.9 * real.gain : 1); s.playbackRate.value = Math.pow(2, semis / 12);
  s.connect(g).connect(out); s.start(t, real?.off ?? 0);
}

// ---------- Instruments mélodiques ----------

const ksCache = new Map<string, AudioBuffer>();
/** Corde pincée (Karplus-Strong), pré-calculée par note. */
function pluckBuffer(ctx: BaseAudioContext, freq: number, damp: number): AudioBuffer {
  const sr = ctx.sampleRate, key = `${Math.round(freq * 10)}|${damp.toFixed(2)}|${sr}`;
  let b = ksCache.get(key);
  if (b) return b;
  if (ksCache.size > 300) ksCache.clear();
  const N = Math.max(2, Math.round(sr / freq)), len = Math.floor(sr * Math.min(4, 1.2 + 220 / freq));
  b = ctx.createBuffer(1, len, sr);
  const d = b.getChannelData(0), bl = 0.08 + damp * 0.42, g = 0.9985 - damp * 0.004;
  let prev = 0;
  for (let i = 0; i < N; i++) { const x = Math.random() * 2 - 1; prev = prev + (x - prev) * (1 - damp * 0.7); d[i] = prev; }
  for (let i = N; i < len; i++) { const j = i - N; d[i] = g * ((1 - bl) * d[j] + bl * d[j > 0 ? j - 1 : 0]); }
  ksCache.set(key, b);
  return b;
}

/**
 * Joue une note. `dur` en secondes pour une note programmée ; `null` pour une note tenue
 * (jeu en direct) : la voix renvoyée doit alors être relâchée avec `release()`.
 */
export function playNote(mix: Mix, dest: AudioNode, p: SynthParams, midi: number, t: number, dur: number | null, vel = 0.8, buffers?: Buffers): Voice | undefined {
  const c = mix.ctx;
  const freq = 440 * Math.pow(2, (midi - 69) / 12 + p.octave);
  const vca = c.createGain(), filt = c.createBiquadFilter();
  const srcs: AudioScheduledSourceNode[] = [];
  let level = 0.15, startOff = 0;

  if (p.engine === 'fm') {
    const car = mix.reg(c.createOscillator()), mod = mix.reg(c.createOscillator()), mg = c.createGain();
    car.frequency.value = freq; mod.frequency.value = freq * p.ratio;
    const idx = p.fmAmt * freq;
    mg.gain.setValueAtTime(idx, t); mg.gain.setTargetAtTime(idx * 0.15, t, Math.max(0.01, p.fmDecay));
    mod.connect(mg).connect(car.frequency); car.connect(filt);
    srcs.push(car, mod); level = 0.2;
  } else if (p.engine === 'pluck') {
    const s = mix.reg(c.createBufferSource()); s.buffer = pluckBuffer(c, freq, p.damp);
    s.connect(filt); srcs.push(s); level = 0.5;
  } else if (p.engine === 'multi') {
    // Vrai instrument : l'échantillon le plus proche, transposé jusqu'à la note demandée.
    const m = p.bank ? sampleFor(p.bank, midi + p.octave * 12) : null;
    if (!m) return;
    const s = mix.reg(c.createBufferSource()); s.buffer = m.s.buf; s.playbackRate.value = m.rate;
    s.connect(filt); srcs.push(s); level = 0.5 * m.s.gain; startOff = m.s.off;
  } else if (p.engine === 'sampler') {
    const buf = p.bufferId ? buffers?.get(p.bufferId) : undefined;
    if (!buf) return;
    const s = mix.reg(c.createBufferSource()); s.buffer = buf;
    s.playbackRate.value = Math.pow(2, (midi - p.root) / 12 + p.octave);
    s.connect(filt); srcs.push(s); level = 0.9;
  } else {
    const mk = (type: OscillatorType, detune: number, gain: number) => {
      const o = mix.reg(c.createOscillator()), g = c.createGain();
      o.type = type; o.detune.value = detune; g.gain.value = gain;
      if (p.pitchEnv) { o.frequency.setValueAtTime(freq * Math.pow(2, p.pitchEnv / 12), t); o.frequency.exponentialRampToValueAtTime(freq, t + 0.07); }
      else o.frequency.value = freq;
      o.connect(g).connect(filt); srcs.push(o);
    };
    mk(p.wave, 0, 1);
    if (p.mix2 > 0) mk(p.wave2, p.detune, p.mix2);
  }

  filt.type = 'lowpass'; filt.Q.value = p.reso;
  filt.frequency.setValueAtTime(Math.min(18000, p.cutoff + p.envAmt * 9000), t);
  filt.frequency.setTargetAtTime(p.cutoff, t + p.a, Math.max(0.01, p.d / 3));

  const peak = vel * level, sus = peak * p.s, a = Math.max(0.002, p.a), dk = Math.max(0.01, p.d / 3), rk = Math.max(0.01, p.r / 3);
  const g = vca.gain;
  g.setValueAtTime(0, t);
  filt.connect(vca).connect(dest);
  for (const s of srcs) { if (startOff && s instanceof AudioBufferSourceNode) s.start(t, startOff); else s.start(t); }
  const tail = p.r * 2 + 0.1;

  if (dur === null) {
    g.linearRampToValueAtTime(peak, t + a); g.setTargetAtTime(sus, t + a, dk);
    return {
      release(at: number) {
        if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(at); else g.cancelScheduledValues(at);
        g.setTargetAtTime(0, at, rk);
        for (const s of srcs) { try { s.stop(at + tail); } catch { /* déjà arrêté */ } }
      },
    };
  }
  const tR = t + dur;
  if (dur <= a) g.linearRampToValueAtTime(peak * dur / a, tR);
  else {
    g.linearRampToValueAtTime(peak, t + a); g.setTargetAtTime(sus, t + a, dk);
    g.setValueAtTime(sus + (peak - sus) * Math.exp(-(dur - a) / dk), tR);
  }
  g.setTargetAtTime(0, tR, rk);
  for (const s of srcs) s.stop(tR + tail);
}

// ---------- Séquenceur ----------

/** Décalage de swing : les double-croches impaires sont retardées. */
export const swingT = (p: Project, s: number, t: number) => t + (s % 2 ? p.swing * durAt(p, s) * 0.5 : 0);

/**
 * Programme ce qui démarre dans un clip. `rel` = pas écoulés depuis le début du clip,
 * `remain` = pas restants avant sa fin (ou avant une coupure de boucle).
 */
function fireClip(mix: Mix, p: Project, buffers: Buffers, tr: Track, n: TrackNodes, c: Clip,
  rel: number, remain: number, t: number, startAudio: boolean, onSrc?: (trackId: string, src: AudioBufferSourceNode) => void,
  /** Durée du pas courant, et temps réel écoulé depuis le début du clip / restant jusqu'à sa fin (le tempo peut changer en route). */
  dur = sd(p.bpm), elapsedSec = rel * dur, remainSec = remain * dur) {
  if (tr.type === 'audio') {
    if (!startAudio) return;
    const buf = c.bufferId ? buffers.get(c.bufferId) : undefined, off = c.offset + elapsedSec;
    if (!buf || off >= buf.duration || remain <= 0) return;
    const src = mix.reg(mix.ctx.createBufferSource()), g = mix.ctx.createGain();
    src.buffer = buf;
    // Fondus : gain en fonction de la position dans le clip (en pas).
    const full = c.gain ?? 1, fi = Math.min(c.fadeIn ?? 0, c.len), fo = Math.min(c.fadeOut ?? 0, c.len - fi), endRel = rel + remain;
    const gAt = (x: number) => full * Math.max(0, Math.min(1, fi > 0 ? x / fi : 1, fo > 0 ? (c.len - x) / fo : 1));
    g.gain.setValueAtTime(gAt(rel), t);
    if (fi > rel) g.gain.linearRampToValueAtTime(gAt(Math.min(fi, endRel)), t + (Math.min(fi, endRel) - rel) * dur);
    if (fo > 0 && endRel > c.len - fo) {
      const x0 = Math.max(rel, c.len - fo);
      g.gain.setValueAtTime(gAt(x0), t + (x0 - rel) * dur); g.gain.linearRampToValueAtTime(gAt(endRel), t + remain * dur);
    }
    src.connect(g).connect(n.input);
    src.start(t, Math.max(0, off), remainSec);
    onSrc?.(tr.id, src);
    return;
  }
  const local = (rel + c.offset) % c.patLen!;
  if (tr.type === 'drums') {
    // Les cases qui tombent dans ce pas : une seule à la double-croche, plusieurs avec une grille plus fine.
    const res = c.res ?? 1, i0 = Math.ceil(local * res - 1e-6), i1 = Math.ceil((local + 1) * res - 1e-6);
    c.drums!.forEach((row, r) => { for (let i = i0; i < i1 && i < row.length; i++) if (row[i]) hitPad(mix, buffers, tr, n.input, r, t + (i / res - local) * dur, row[i]); });
  } else if (tr.synth) {
    // Une note démarre dans ce pas, éventuellement avec un décalage (triolet, triple-croche, placement libre).
    for (const nt of c.notes!) {
      const f = nt.s - local;
      if (f >= 0 && f < 1) playNote(mix, n.input, tr.synth, nt.p, t + f * dur, Math.max(0.02, Math.min(nt.l, remain - f) * dur * 0.98), nt.v, buffers);
    }
  }
}

/** Arrangement : programme tout ce qui démarre au pas `s`. */
export function scheduleStep(mix: Mix, p: Project, buffers: Buffers, s: number, t: number, segStart: boolean, endLimit: number | null) {
  for (const tr of p.tracks) {
    const n = mix.tracks.get(tr.id);
    if (!n) continue;
    for (const c of tr.clips) {
      if (s < c.start || s >= c.start + c.len) continue;
      const remain = Math.min(c.start + c.len, endLimit ?? Infinity) - s;
      fireClip(mix, p, buffers, tr, n, c, s - c.start, remain, t, s === c.start || segStart, undefined,
        durAt(p, s), timeOf(p, s) - timeOf(p, c.start), timeOf(p, s + remain) - timeOf(p, s));
    }
  }
}

/** Mode Live : chaque piste boucle son clip actif. */
export function scheduleLive(mix: Mix, p: Project, buffers: Buffers, s: number, t: number,
  active: Map<string, { clipId: string; since: number }>, onSrc: (trackId: string, src: AudioBufferSourceNode) => void) {
  for (const tr of p.tracks) {
    const a = active.get(tr.id), n = mix.tracks.get(tr.id), c = a && tr.clips.find(x => x.id === a.clipId);
    if (!a || !n || !c) continue;
    const rel = (s - a.since) % c.len;
    fireClip(mix, p, buffers, tr, n, c, rel, c.len - rel, t, rel === 0, onSrc);
  }
}
