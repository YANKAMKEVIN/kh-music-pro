/** Graphe de mixage, première couche : nœuds du général, des tranches et des effets (construction). */
import { WamInstance, createWam } from './wam';
import { AuInstrument, createAu } from './au';
import { Insert, Project, stepDur as sd } from '../types';

/** Plugin d'une chaîne d'effets : web (WAM) ou, dans la version bureau native, Audio Unit. */
export const isPlugin = (i: Insert) => (i.type === 'wam' || i.type === 'au') && !!i.url;
export const createPlugin = (ctx: BaseAudioContext, i: Insert, state?: unknown) =>
  i.type === 'au' ? createAu(ctx, i.url!, i.p) : createWam(ctx, i.url!, state);

export interface TrackNodes {
  input: GainNode; lp: BiquadFilterNode; hp: BiquadFilterNode; shaper: WaveShaperNode;
  low: BiquadFilterNode; mid: BiquadFilterNode; high: BiquadFilterNode;
  comp: DynamicsCompressorNode; makeup: GainNode; fader: GainNode; auto: GainNode; duck: GainNode; pan: StereoPannerNode;
  revSend: GainNode; dlySend: GainNode; analyser?: AnalyserNode; compOn?: boolean; driveVal?: number; duckAmt: number;
  /** V17 (performance) : voix du chorus, et état des branches allumées seulement quand elles servent. */
  chVoices: { d: DelayNode; lfo: OscillatorNode; depth: GainNode }[]; chorusOn?: boolean; tremOn?: boolean; eqSig?: string;
  outId?: string;
  /** Chaînes d'effets : vrai quand la tranche fixe est débranchée (l'entrée va droit à la chaîne). */
  chainOn?: boolean;
  insIn: GainNode; insOut: GainNode; ins: Map<string, InsNode>; insSig?: string;
  /** Compensation de latence : retard ajouté après la chaîne d'effets, pour rester calé sur la tranche la plus en retard. */
  pdc: DelayNode;
  crush: WaveShaperNode; crushIn: GainNode; crushOut: GainNode; crushVal?: number; chWet: GainNode; trem: GainNode; tremDepth: GainNode; tremLfo: OscillatorNode;
  /** Contrôles joués (V19), pistes d'instrument : hauteur commune à toutes les voix (pitch bend + vibrato), plage du bend en demi-tons. */
  ctl?: CtlNodes;
  /** Sidechain (V19) : suiveur d'enveloppe branché sur la piste source, qui baisse le volume de celle-ci. */
  sc?: { node: AudioWorkletNode; src: string };
  /** Envois libres (V19) vers les bus. */
  sends: Map<string, { g: GainNode; key: string }>;
  /** Instrument du Mac (V19) joué par cette piste ; `url` = celui demandé (le chargement est asynchrone). */
  inst?: { url: string; au?: AuInstrument; loading?: boolean };
}
/** `pitch` est branché sur le désaccord (detune) de chaque voix de la piste : le pitch bend et le vibrato bougent toutes les notes tenues. */
export interface CtlNodes { pitch: GainNode; bend: ConstantSourceNode; lfo: OscillatorNode; gMod: GainNode; gAt: GainNode; range: number }
/** Un effet de la chaîne : on y entre par `in`, on en sort par `out` ; `set` applique ses réglages. */
export interface InsNode {
  in: GainNode; out: GainNode;
  /** `auto` : réglages de l'effet qui ont une courbe (certains étages en dépendent : résonance du filtre, branches allumées). */
  set(i: Insert, p: Project, set: (prm: AudioParam, v: number) => void, auto?: Set<string>): void;
  wam?: WamInstance; loading?: boolean;
  /** Étages de tranche en chaîne : filtres affichés dans la courbe d'égaliseur du mixeur, compresseur dont on lit la réduction. */
  bq?: BiquadFilterNode[]; dyn?: DynamicsCompressorNode;
}
export interface Voice { release(at: number): void }
export type Buffers = Map<string, AudioBuffer>;

/** Filtre « DJ » bipolaire : négatif = passe-bas, positif = passe-haut. */
export const djFreqs = (v: number): [number, number] => [v < 0 ? 20000 * Math.pow(2, v * 8) : 20000, v > 0 ? 20 * Math.pow(2, v * 9.5) : 10];
/**
 * Résonance des filtres (en dB, comme l'attend le navigateur). Au repos : aucune, pour que le filtre ne colore pas le son
 * — une légère bosse dans le grave s'ajoutait sinon à chaque étage traversé. En action : un peu de résonance, pour le caractère.
 */
export const REST_Q = -3.01, SWEEP_Q = 3;

/** Lo-fi : réduit le nombre de niveaux du signal (de 32 à 3 paliers par demi-onde). */
export function crushCurve(amount: number) {
  const L = 3 + 29 * Math.pow(1 - amount, 2), n = 4096, c = new Float32Array(n);
  for (let i = 0; i < n; i++) c[i] = Math.round((i / (n - 1) * 2 - 1) * L) / L;
  return c;
}

export function driveCurve(amount: number) {
  const k = 1 + amount * 24, n = 1024, c = new Float32Array(n), norm = Math.tanh(k);
  for (let i = 0; i < n; i++) c[i] = Math.tanh(k * (i / (n - 1) * 2 - 1)) / norm;
  return c;
}

/** Instrument du Mac qui joue à l'écoute pour une piste (branché par le moteur) : l'export reprend son état. */
export let liveInstOf: ((trackId: string) => AuInstrument | undefined) | undefined;
export const setLiveInstOf = (f: typeof liveInstOf) => { liveInstOf = f; };

/** Construction des nœuds : général, bus d'effets, tranches, effets de la chaîne. Complétée par MixChains puis Mix (graph.ts). */
export class MixNodes {
  tracks = new Map<string, TrackNodes>();
  master: GainNode; mlp: BiquadFilterNode; mhp: BiquadFilterNode; limiter: DynamicsCompressorNode; analyser?: AnalyserNode;
  revBus: GainNode; dlyBus: GainNode; delay: DelayNode; noise: AudioBuffer;
  conv: ConvolverNode; fb: GainNode; revSize = 0;
  meq: BiquadFilterNode[]; wDirect: GainNode[]; wCross: GainNode[];
  /** Effets de performance (temps réel) : envois momentanés du général vers un écho et une réverb, bégaiement. */
  fxEcho?: GainNode; fxRev?: GainNode; fxDelay?: DelayNode; stutter?: AudioWorkletNode; protected out: AudioNode;
  /** Vrai pendant la lecture de l'arrangement : les paramètres automatisés ne sont plus pilotés par `sync`. */
  autoOn = false;
  /**
   * Piste dont les contrôles joués (pitch bend, molette, aftertouch) sont en train d'être enregistrés : le geste en direct prime,
   * le clip enregistré ne rejoue pas ses contrôles (ni leur retour au repos en fin de clip) par-dessus pendant la prise.
   */
  liveCtl = '';
  active = new Set<AudioScheduledSourceNode>();
  /** Repetitions are isolated per render and track; preview cannot alter export. */
  sampleTurns = new Map<string, number>();
  instrumentTurns = new WeakMap<AudioNode, Map<number, number>>();
  openHats = new Map<string, { src: AudioBufferSourceNode; gain: GainNode }>();
  /** Entrée d'une piste d'instrument → son réglage de hauteur commun (pitch bend, vibrato), pour les voix qui y jouent. */
  pitchFor = new WeakMap<AudioNode, AudioNode>();
  /** Entrée d'une piste → l'instrument du Mac qui y joue (V19). */
  instFor = new WeakMap<AudioNode, AuInstrument>();
  /** Prévenu quand un instrument du Mac est prêt (ou a échoué). */
  onInst?: (trackId: string, ok: boolean) => void;

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

  /** Rendu par groupes (export d'un gros projet) : le volume général sort directement, sans sa chaîne. */
  stemOut() { this.master.disconnect(this.mlp); this.master.connect(this.ctx.destination); }
  /** Branche une source à l'entrée de la chaîne du général (après son volume, déjà appliqué dans les groupes). */
  masterChainIn(src: AudioNode) { src.connect(this.mlp); }

  /** Suiveur d'enveloppe du sidechain (V19) : chargé une fois par contexte, à l'écoute comme pour chaque rendu d'export. */
  envReady = false;
  protected envLoading?: Promise<void>;
  initEnv(): Promise<void> {
    // Attaque 3 ms, maintien 15 ms, relâchement 60 ms (constante de temps : le volume revient en 0,2 s environ) ; baisse complète quand la source dépasse -13 dB environ.
    const code = `class KhEnv extends AudioWorkletProcessor{static get parameterDescriptors(){return[{name:'amt',defaultValue:0,minValue:0,maxValue:1,automationRate:'k-rate'}]}
constructor(){super();this.e=0;this.h=0;this.a=1-Math.exp(-1/(sampleRate*0.003));this.r=1-Math.exp(-1/(sampleRate*0.06));this.H=Math.round(sampleRate*0.015)}
process(i,o,P){const x=i[0]||[],y=o[0][0],n=y.length,amt=P.amt[0];for(let k=0;k<n;k++){let v=0;for(let c=0;c<x.length;c++){const s=Math.abs(x[c][k]);if(s>v)v=s}
if(v>=this.e){this.e+=this.a*(v-this.e);this.h=this.H}else if(this.h>0)this.h--;else this.e+=this.r*(v-this.e);
y[k]=-amt*Math.min(1,Math.max(0,(this.e-0.02)/0.2))}return true}}registerProcessor('kh-env',KhEnv)`;
    return (this.envLoading ??= this.ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([code], { type: 'text/javascript' }))).then(() => { this.envReady = true; }));
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

  /** Construit un effet de la chaîne. */
  protected buildInsert(type: string): InsNode {
    const c = this.ctx, input = c.createGain(), out = c.createGain();
    const lfo = (hz: number) => { const o = c.createOscillator(); o.frequency.value = hz; o.start(); return o; };
    if (type === 'delay') {
      const d = c.createDelay(2), fb = c.createGain(), wet = c.createGain(), lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 5000;
      input.connect(out); input.connect(d).connect(lp).connect(wet).connect(out); lp.connect(fb).connect(d);
      return { in: input, out, set: (i, p, set) => { set(d.delayTime, Math.min(1.9, i.p.time * sd(p.bpm))); set(fb.gain, i.p.fb); set(wet.gain, i.p.mix); } };
    }
    if (type === 'reverb') {
      const conv = c.createConvolver(), wet = c.createGain(), dry = c.createGain(); let size = 0;
      input.connect(dry).connect(out); input.connect(conv).connect(wet).connect(out);
      return { in: input, out, set: (i, _p, set) => { if (size !== i.p.size) { conv.buffer = this.impulse(i.p.size); size = i.p.size; } set(wet.gain, i.p.mix); set(dry.gain, 1 - i.p.mix * 0.5); } };
    }
    if (type === 'phaser') {
      // Modulation lente : recalculée par bloc de 128 échantillons (k-rate) au lieu de chaque échantillon, inaudible, bien moins coûteux.
      const stages = [0, 1, 2, 3].map(() => { const f = c.createBiquadFilter(); f.type = 'allpass'; f.frequency.value = 900; f.Q.value = 0.6; f.frequency.automationRate = 'k-rate'; return f; });
      const wet = c.createGain(), o = lfo(0.5), depth = c.createGain();
      input.connect(out); stages.reduce<AudioNode>((a, f) => a.connect(f), input).connect(wet).connect(out);
      o.connect(depth); for (const f of stages) depth.connect(f.frequency);
      return { in: input, out, set: (i, _p, set) => { set(o.frequency, i.p.rate); set(depth.gain, 700 * i.p.depth); set(wet.gain, i.p.mix); } };
    }
    if (type === 'autopan') {
      const pan = c.createStereoPanner(), o = lfo(1), depth = c.createGain(); pan.pan.automationRate = 'k-rate';
      input.connect(pan).connect(out); o.connect(depth).connect(pan.pan);
      return { in: input, out, set: (i, _p, set) => { set(o.frequency, i.p.rate); set(depth.gain, i.p.depth); } };
    }
    if (type === 'eq') {
      const f = c.createBiquadFilter(); f.type = 'peaking'; input.connect(f).connect(out);
      return { in: input, out, set: (i, _p, set) => { set(f.frequency, i.p.freq); set(f.gain, i.p.gain); set(f.Q, i.p.q); } };
    }
    if (type === 'gain') { input.connect(out); return { in: input, out, set: (i, _p, set) => { set(out.gain, Math.pow(10, i.p.gain / 20)); } }; }
    const strip = this.buildStripFx(type, input, out);
    if (strip) return strip;
    input.connect(out); // plugin web : le son passe tel quel tant que le plugin n'est pas chargé
    return { in: input, out, set: () => { } };
  }

  /**
   * Étages de la tranche fixe devenus effets (chaînes d'effets, 21/11/2026) : mêmes nœuds, mêmes réglages et mêmes
   * branchements que dans `makeTrack` et `sync`, pour qu'une tranche convertie sonne exactement pareil.
   */
  protected buildStripFx(type: string, input: GainNode, out: GainNode): InsNode | null {
    const c = this.ctx;
    if (type === 'filter') {
      const lp = c.createBiquadFilter(), hp = c.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 20000; hp.type = 'highpass'; hp.frequency.value = 20;
      lp.Q.value = REST_Q; hp.Q.value = REST_Q; hp.frequency.value = 10;
      input.connect(lp).connect(hp).connect(out);
      return { in: input, out, bq: [lp, hp], set: (i, _p, set, auto) => {
        const v = i.p.v, [fl, fh] = djFreqs(v), swept = !!auto?.has('v');
        set(lp.frequency, fl); set(hp.frequency, fh);
        set(lp.Q, swept || v < 0 ? SWEEP_Q : REST_Q); set(hp.Q, swept || v > 0 ? SWEEP_Q : REST_Q);
      } };
    }
    if (type === 'drive') {
      const sh = c.createWaveShaper(); sh.oversample = '2x'; let val: number | undefined;
      input.connect(sh).connect(out);
      return { in: input, out, set: i => { if (val !== i.p.amt) { sh.curve = i.p.amt > 0 ? driveCurve(i.p.amt) : null; val = i.p.amt; } } };
    }
    if (type === 'lofi') {
      // Comme dans la tranche : le signal est amplifié avant la réduction puis ramené à son niveau.
      const cin = c.createGain(), cr = c.createWaveShaper(), cout = c.createGain(); let val: number | undefined;
      input.connect(cin).connect(cr).connect(cout).connect(out);
      return { in: input, out, set: i => { const a = i.p.amt; if (val !== a) { cr.curve = a > 0 ? crushCurve(a) : null; cin.gain.value = a > 0 ? 3 : 1; cout.gain.value = a > 0 ? 1 / 3 : 1; val = a; } } };
    }
    if (type === 'chorus') {
      const wet = c.createGain(), voices: { d: DelayNode; lfo: OscillatorNode; depth: GainNode }[] = []; let on: boolean | undefined;
      wet.gain.value = 0; input.connect(out);
      for (const [ms, hz] of [[17, 0.7], [26, 1.1]]) {
        const d = c.createDelay(0.1), lfo = c.createOscillator(), depth = c.createGain();
        d.delayTime.value = ms / 1000; lfo.frequency.value = hz; depth.gain.value = 0.0035;
        depth.connect(d.delayTime); lfo.start(); d.connect(wet); voices.push({ d, lfo, depth });
      }
      wet.connect(out);
      return { in: input, out, set: (i, _p, set, auto) => {
        set(wet.gain, i.p.mix * 0.8);
        const want = i.p.mix > 0 || !!auto?.has('mix');   // voix branchées seulement quand le chorus sert
        if (on !== want) { for (const v of voices) { if (want) { input.connect(v.d); v.lfo.connect(v.depth); } else if (on !== undefined) { input.disconnect(v.d); v.lfo.disconnect(); } } on = want; }
      } };
    }
    if (type === 'trem') {
      const g = c.createGain(), depth = c.createGain(), lfo = c.createOscillator(); let on: boolean | undefined;
      depth.gain.value = 0; depth.connect(g.gain); lfo.start();
      input.connect(g).connect(out);
      return { in: input, out, set: (i, p, set, auto) => {
        const dp = i.p.depth;
        set(g.gain, 1 - dp / 2); set(depth.gain, dp / 2); set(lfo.frequency, p.bpm / 30);
        const want = dp > 0 || !!auto?.has('depth');
        if (on !== want) { if (want) lfo.connect(depth); else if (on !== undefined) lfo.disconnect(); on = want; }
      } };
    }
    if (type === 'eq3') {
      const low = c.createBiquadFilter(), mid = c.createBiquadFilter(), high = c.createBiquadFilter(); let on: boolean | undefined;
      low.type = 'lowshelf'; low.frequency.value = 200; mid.type = 'peaking'; mid.frequency.value = 1000; mid.Q.value = 0.9; high.type = 'highshelf'; high.frequency.value = 5000;
      low.connect(mid).connect(high);
      return { in: input, out, bq: [low, mid, high], set: (i, _p, set, auto) => {
        set(mid.frequency, i.p.freq); set(low.gain, i.p.low); set(mid.gain, i.p.mid); set(high.gain, i.p.high);
        // À plat, l'égaliseur est contourné (comme dans la tranche) : rien n'est calculé et le son passe tel quel.
        const want = !!(i.p.low || i.p.mid || i.p.high) || ['low', 'mid', 'high'].some(k => auto?.has(k));
        if (on !== want) { input.disconnect(); high.disconnect(); if (want) { input.connect(low); high.connect(out); } else input.connect(out); on = want; }
      } };
    }
    if (type === 'comp') {
      const cp = c.createDynamicsCompressor(), mk = c.createGain();
      cp.threshold.value = -24; cp.ratio.value = 4; cp.attack.value = 0.005; cp.release.value = 0.2; mk.gain.value = 1.5;
      input.connect(cp).connect(mk).connect(out);
      return { in: input, out, dyn: cp, set: (i, _p, set) => {
        // Le gain de compensation suit le seuil et le taux, comme au mixeur.
        set(cp.threshold, i.p.thr); set(cp.ratio, i.p.ratio); set(mk.gain, Math.pow(10, -i.p.thr * (1 - 1 / i.p.ratio) * 0.2 / 20));
      } };
    }
    return null;
  }


  protected impulse(sec: number) {
    const sr = this.ctx.sampleRate, len = Math.floor(sr * sec), b = this.ctx.createBuffer(2, len, sr);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
    }
    return b;
  }

  protected set(p: AudioParam, v: number) {
    if (this.live) p.setTargetAtTime(v, this.ctx.currentTime, 0.015); else p.value = v;
  }

  protected makeTrack(): TrackNodes {
    const c = this.ctx;
    const n: TrackNodes = {
      input: c.createGain(), lp: c.createBiquadFilter(), hp: c.createBiquadFilter(), shaper: c.createWaveShaper(),
      low: c.createBiquadFilter(), mid: c.createBiquadFilter(), high: c.createBiquadFilter(),
      comp: c.createDynamicsCompressor(), makeup: c.createGain(), fader: c.createGain(), auto: c.createGain(), duck: c.createGain(), pan: c.createStereoPanner(),
      insIn: c.createGain(), insOut: c.createGain(), ins: new Map(), pdc: c.createDelay(1),
      revSend: c.createGain(), dlySend: c.createGain(), duckAmt: 0, chVoices: [], sends: new Map(),
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
      depth.connect(d.delayTime); lfo.start(); d.connect(n.chWet);
      n.chVoices.push({ d, lfo, depth });   // branchées par sync seulement si le chorus sert (sinon elles calculent pour rien)
    }
    n.chWet.connect(n.trem);
    n.tremDepth.gain.value = 0; n.tremDepth.connect(n.trem.gain); n.tremLfo.start();
    n.low.connect(n.mid).connect(n.high);   // l'égaliseur est inséré par sync seulement s'il n'est pas à plat
    // Après l'égaliseur et le compresseur : la chaîne d'effets ajoutés, puis le fader.
    n.comp.connect(n.makeup).connect(n.insIn); n.insIn.connect(n.insOut); n.insOut.connect(n.pdc).connect(n.fader);
    n.fader.connect(n.auto).connect(n.duck).connect(n.pan); // la sortie (général ou bus) est branchée par sync
    n.pan.connect(n.revSend).connect(this.revBus);
    n.pan.connect(n.dlySend).connect(this.dlyBus);
    if (this.live) { n.analyser = c.createAnalyser(); n.analyser.fftSize = 256; n.duck.connect(n.analyser); }
    return n;
  }

}
