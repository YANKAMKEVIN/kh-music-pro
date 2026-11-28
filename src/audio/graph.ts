/** Graphe de mixage : tranches (pistes et bus), effets, plugins, envois et général. Même code pour l'écoute et l'export. */
import { WamInstance, createWam, liveWams, wamKey } from './wam';
import { AuInstance, AuInstrument, auBridge, auFromNorm, createAu, createAuInstrument } from './au';

/** Plugin d'une chaîne d'effets : web (WAM) ou, dans la version bureau native, Audio Unit. */
const isPlugin = (i: Insert) => (i.type === 'wam' || i.type === 'au') && !!i.url;
const createPlugin = (ctx: BaseAudioContext, i: Insert, state?: unknown) =>
  i.type === 'au' ? createAu(ctx, i.url!, i.p) : createWam(ctx, i.url!, state);
import { AT_CENTS, AT_GAIN, CTL_KINDS, CTL_REST, Clip, CtlKind, FX, Insert, MOD_CENTS, Project, Pt, Track, autoAt, ctlAt, durAt, fxAutomatable, fxFromNorm, parseInsKey, setFromNorm, setKey, stepDur as sd } from '../types';

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

/** Instrument du Mac qui joue à l'écoute pour une piste (branché par le moteur) : l'export reprend son état. */
export let liveInstOf: ((trackId: string) => AuInstrument | undefined) | undefined;
export const setLiveInstOf = (f: typeof liveInstOf) => { liveInstOf = f; };

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
  private envLoading?: Promise<void>;
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
  private buildInsert(type: string): InsNode {
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
  private buildStripFx(type: string, input: GainNode, out: GainNode): InsNode | null {
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

  /** Branche un plugin web chargé à la place du passage direct. */
  private attachWam(node: InsNode, inst: WamInstance) {
    node.wam = inst;
    try { node.in.disconnect(node.out); } catch { /* déjà débranché */ }
    node.in.connect(inst.audioNode); inst.audioNode.connect(node.out);
  }

  /** Met la chaîne d'effets d'une tranche en accord avec le projet : ordre, effets actifs, réglages. */
  private syncInserts(t: Track, n: TrackNodes, p: Project) {
    // Piste gelée : sa chaîne d'effets est débranchée (rien n'y passe, et un phaser ou un plugin y calculerait pour rien).
    const list = t.inserts ?? [], active = t.frozen ? [] : list.filter(i => i.on), sig = active.map(i => i.id + i.type).join('|');
    for (const [id, node] of n.ins) if (!list.some(i => i.id === id)) { node.out.disconnect(); node.wam?.audioNode.destroy?.(); n.ins.delete(id); liveWams.delete(wamKey(t.id, id)); }
    for (const i of list) {
      let node = n.ins.get(i.id);
      if (!node) { node = this.buildInsert(i.type); n.ins.set(i.id, node); }
      // Plugin du Mac hors de la version bureau macOS : le son passe tel quel, sans essayer de le charger.
      if (isPlugin(i) && !t.frozen && !node.wam && !node.loading && this.live && (i.type !== 'au' || auBridge())) {
        node.loading = true;
        const made = node;
        // L'effet a pu être retiré (ou la piste supprimée) pendant le chargement : on libère alors le plugin, sans rien signaler.
        const gone = () => this.tracks.get(t.id)?.ins.get(i.id) !== made;
        createPlugin(this.ctx, i, i.state).then(inst => {
          if (gone()) { inst.audioNode.destroy?.(); return; }
          this.attachWam(made, inst); liveWams.set(wamKey(t.id, i.id), inst);
          if (this.lastProject) this.compensate(this.lastProject);
          this.onWam?.(t.id, i.id, true);
        }, () => { if (!gone()) this.onWam?.(t.id, i.id, false); }).finally(() => { made.loading = false; });
      }
      // Pendant la lecture, les réglages automatisés sont pilotés par leur courbe (applyAuto), pas par la valeur fixe.
      const keys = autoKeysOf(t, i.id), auto = this.autoOn ? keys : null;
      if (!auto?.size) node.set(i, p, (prm, v) => this.set(prm, v), keys);
      if (i.type === 'au' && node.wam) (node.wam as AuInstance).apply(auto?.size ? Object.fromEntries(Object.entries(i.p).filter(([k]) => !auto.has(k))) : i.p);
    }
    if (n.insSig === sig) return;
    n.insIn.disconnect(); for (const node of n.ins.values()) node.out.disconnect();
    active.reduce<AudioNode>((a, i) => { const node = n.ins.get(i.id)!; a.connect(node.in); return node.out; }, n.insIn).connect(n.insOut);
    n.insSig = sig;
  }
  private lastProject?: Project;
  /** Retard ajouté à tout le mixage par la compensation (latence du chemin le plus long), en secondes. */
  pdcMax = 0;
  /** Latence déclarée par les plugins actifs d'une tranche (plugins du Mac ; les plugins web n'en déclarent pas). */
  private stripLatency(t: Track, n: TrackNodes): number {
    let l = 0;
    for (const i of t.inserts ?? []) if (i.on && i.type === 'au') l += (n.ins.get(i.id)?.wam as AuInstance | undefined)?.info.latency ?? 0;
    return l + (n.inst?.au?.info.latency ?? 0);
  }
  /**
   * Compensation de la latence des plugins (comme dans les logiciels de studio) : un plugin qui déclare une latence
   * (AUPeakLimiter : 2 ms) retarde sa tranche ; les autres tranches sont retardées d'autant pour que tout reste calé.
   * Pistes envoyées vers un bus : calées entre elles à l'entrée du bus, puis le bus est calé avec le reste.
   * Une piste coupée (muet) compte toujours : couper une piste ne décale pas les autres. Écoute et export identiques.
   */
  private compensate(p: Project) {
    const busIds = new Set(p.buses.map(b => b.id)), lat = new Map<string, number>(), busIn = new Map<string, number>();
    for (const t of [...p.buses, ...p.tracks]) { const n = this.tracks.get(t.id); if (n) lat.set(t.id, this.stripLatency(t, n)); }
    for (const b of p.buses) busIn.set(b.id, 0);
    for (const t of p.tracks) if (busIds.has(t.out)) busIn.set(t.out, Math.max(busIn.get(t.out)!, lat.get(t.id) ?? 0));
    let max = 0;
    for (const t of p.tracks) if (!busIds.has(t.out)) max = Math.max(max, lat.get(t.id) ?? 0);
    for (const b of p.buses) max = Math.max(max, busIn.get(b.id)! + (lat.get(b.id) ?? 0));
    const put = (id: string, d: number) => { const n = this.tracks.get(id); if (n && Math.abs(n.pdc.delayTime.value - d) > 1e-7) n.pdc.delayTime.value = Math.max(0, Math.min(1, d)); };
    for (const t of p.tracks) put(t.id, busIds.has(t.out) ? busIn.get(t.out)! - (lat.get(t.id) ?? 0) : max - (lat.get(t.id) ?? 0));
    for (const b of p.buses) put(b.id, max - busIn.get(b.id)! - (lat.get(b.id) ?? 0));
    this.pdcMax = max;
  }

  /** Prévenu quand un plugin web a fini de se charger (ou a échoué). */
  onWam?: (trackId: string, insertId: string, ok: boolean) => void;

  /** Rendu hors-ligne : crée les plugins web sur ce contexte, avec l'état de ceux en service. Renvoie le nombre d'échecs. */
  /** Après un rendu hors-ligne : libère les plugins créés pour lui (les Audio Units ont un fil natif à arrêter). */
  disposePlugins() {
    for (const n of this.tracks.values()) { for (const node of n.ins.values()) node.wam?.audioNode.destroy?.(); n.inst?.au?.audioNode.destroy?.(); }
  }
  /** Rendu hors-ligne : tous les évènements des instruments du Mac sont arrivés avant le calcul. */
  async flushInsts() { await Promise.all([...this.tracks.values()].map(n => n.inst?.au?.flush())); }

  async loadWams(p: Project): Promise<number> {
    let failed = 0;
    for (const t of [...p.buses, ...p.tracks]) for (const i of t.inserts ?? []) {
      const node = this.tracks.get(t.id)?.ins.get(i.id);
      if (!isPlugin(i) || !i.on || !node) continue;
      try {
        const live = liveWams.get(wamKey(t.id, i.id)), state = live?.audioNode.getState ? await live.audioNode.getState() : i.state;
        this.attachWam(node, await createPlugin(this.ctx, i, state));
      } catch { failed++; }
    }
    // Instruments du Mac (V19) : recréés pour ce rendu, avec l'état de celui qui joue à l'écoute (sinon celui du projet).
    for (const t of p.tracks) {
      const n = this.tracks.get(t.id), sp = t.synth;
      if (!n || t.frozen || sp?.engine !== 'au' || !sp.auUrl) continue;
      try {
        const live = liveInstOf?.(t.id), state = live?.getState() || sp.auState || '';
        this.attachInst(n, await createAuInstrument(this.ctx, sp.auUrl, state, sp.bend ?? 2)); n.inst!.url = sp.auUrl;
      } catch { failed++; }
    }
    this.compensate(p);   // les plugins du rendu sont chargés : leurs latences sont connues
    return failed;
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
      const au = this.autoOn ? t.auto : undefined;
      if (!au?.[setKey('eqMidF')]?.length) this.set(n.mid.frequency, t.eqMidF);
      if (!au?.[setKey('compThr')]?.length) this.set(n.comp.threshold, t.compThr);
      if (!au?.[setKey('compRatio')]?.length) this.set(n.comp.ratio, t.compRatio);
      if (!au?.[setKey('compThr')]?.length && !au?.[setKey('compRatio')]?.length) this.set(n.makeup.gain, Math.pow(10, -t.compThr * (1 - 1 / t.compRatio) * 0.2 / 20));
      // Égaliseur et seuil automatisés (suite) : pendant la lecture, leur courbe les pilote (applyAuto).
      if (!au?.[setKey('eqLow')]?.length) this.set(n.low.gain, t.eqLow);
      if (!au?.[setKey('eqMid')]?.length) this.set(n.mid.gain, t.eqMid);
      if (!au?.[setKey('eqHigh')]?.length) this.set(n.high.gain, t.eqHigh);
      if (!au?.filter?.length) { const [lp, hp] = djFreqs(t.filter); this.set(n.lp.frequency, lp); this.set(n.hp.frequency, hp); }
      const swept = !!t.auto?.filter?.length;
      this.set(n.lp.Q, swept || t.filter < 0 ? SWEEP_Q : REST_Q); this.set(n.hp.Q, swept || t.filter > 0 ? SWEEP_Q : REST_Q);
      n.duckAmt = t.sc ? 0 : t.duck;   // une piste qui suit une autre source ne pompe plus sur le kick du séquenceur
      // Le signal est amplifié avant la réduction puis ramené à son niveau : l'effet reste audible sur un son faible.
      if (n.crushVal !== t.crush) { n.crush.curve = t.crush > 0 ? crushCurve(t.crush) : null; n.crushIn.gain.value = t.crush > 0 ? 3 : 1; n.crushOut.gain.value = t.crush > 0 ? 1 / 3 : 1; n.crushVal = t.crush; }
      if (!au?.chorus?.length) this.set(n.chWet.gain, t.chorus * 0.8);
      this.set(n.trem.gain, 1 - t.trem / 2); this.set(n.tremDepth.gain, t.trem / 2); this.set(n.tremLfo.frequency, p.bpm / 30);
      if (n.driveVal !== t.drive) { n.shaper.curve = t.drive > 0 ? driveCurve(t.drive) : null; n.driveVal = t.drive; }
      // Performance (V17) : une branche au neutre est débranchée (40 pistes vides coûtaient 39 % d'un cœur) ; le son ne change pas.
      const chorusOn = t.chorus > 0 || !!au?.chorus?.length;
      if (n.chorusOn !== chorusOn) {
        for (const v of n.chVoices) { if (chorusOn) { n.crushOut.connect(v.d); v.lfo.connect(v.depth); } else if (n.chorusOn !== undefined) { n.crushOut.disconnect(v.d); v.lfo.disconnect(); } }
        n.chorusOn = chorusOn;
      }
      const tremOn = t.trem > 0;
      if (n.tremOn !== tremOn) { if (tremOn) n.tremLfo.connect(n.tremDepth); else if (n.tremOn !== undefined) n.tremLfo.disconnect(); n.tremOn = tremOn; }
      const eqOn = !!(t.eqLow || t.eqMid || t.eqHigh) || ['eqLow', 'eqMid', 'eqHigh'].some(k => t.auto?.[setKey(k)]?.length), sig = `${eqOn}|${t.comp}`;
      if (n.eqSig !== sig) {
        const dest = t.comp ? n.comp : n.insIn;
        n.trem.disconnect(); n.high.disconnect();
        if (eqOn) { n.trem.connect(n.low); n.high.connect(dest); } else n.trem.connect(dest);
        n.eqSig = sig; n.compOn = t.comp;
      }
      // Chaîne d'effets (21/11/2026) : la tranche fixe est débranchée, l'entrée de la piste va droit à la chaîne.
      const chainOn = t.strip === 'chaine';
      if (n.chainOn !== chainOn) {
        if (chainOn) { n.input.disconnect(n.lp); n.input.connect(n.insIn); }
        else if (n.chainOn !== undefined) { n.input.disconnect(n.insIn); n.input.connect(n.lp); }
        n.chainOn = chainOn;
      }
      this.syncInserts(t, n, p);
      if (t.type === 'synth' && !t.frozen) this.ctlNodes(n).range = t.synth?.bend ?? 2;
      this.syncInst(t, n);
      const audible = !t.mute && (isBus || !anySolo || t.solo);
      this.set(n.fader.gain, audible ? t.vol : 0);
      if (!au?.pan?.length) this.set(n.pan.pan, t.pan);
      if (!au?.rev?.length) this.set(n.revSend.gain, t.rev);
      if (!au?.dly?.length) this.set(n.dlySend.gain, t.dly);
    }
    this.syncRouting(p, anySolo);
    this.lastProject = p;
    this.compensate(p);
    for (const [id, n] of this.tracks) if (!p.tracks.some(t => t.id === id) && !busIds.has(id)) {
      n.pan.disconnect(); n.revSend.disconnect(); n.dlySend.disconnect(); n.pdc.disconnect(); n.pdc.connect(n.fader); this.tracks.delete(id);
      n.sc?.node.disconnect(); for (const e of n.sends.values()) e.g.disconnect(); this.dropInst(n);
      // Piste supprimée (ou autre projet ouvert) : ses plugins sont libérés (un Audio Unit a un fil natif à arrêter).
      for (const [iid, node] of n.ins) { node.out.disconnect(); node.wam?.audioNode.destroy?.(); liveWams.delete(wamKey(id, iid)); }
    }
  }

  /**
   * Sidechain et envois libres (V19), une fois toutes les tranches créées. Sidechain : le son de la source est pris avant son
   * volume (comme le réglage par défaut d'Ableton) : une source coupée fait toujours pomper (astuce du « kick fantôme »).
   * Les sources et les envois partent toujours d'une piste, jamais d'un bus : aucune boucle n'est possible dans le graphe.
   */
  private syncRouting(p: Project, anySolo: boolean) {
    const ids = new Set(p.tracks.map(t => t.id)), busIds = new Set(p.buses.map(b => b.id));
    let needEnv = false;
    for (const t of p.tracks) {
      const n = this.tracks.get(t.id)!, src = t.sc && t.sc !== t.id && ids.has(t.sc) && t.duck > 0 ? t.sc : '';
      if (src) needEnv = true;
      if (n.sc && (n.sc.src !== src || !src)) { n.sc.node.disconnect(); this.tracks.get(n.sc.src)?.pdc.disconnect(n.sc.node); n.sc = undefined; }
      if (src && !n.sc && this.envReady) {
        const node = new AudioWorkletNode(this.ctx, 'kh-env', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
        this.tracks.get(src)!.pdc.connect(node); node.connect(n.duck.gain); n.sc = { node, src };
      }
      if (n.sc) this.set(n.sc.node.parameters.get('amt')!, t.duck);
      // Envois : un nœud par envoi, du point choisi (avant ou après le volume) vers l'entrée du bus.
      const want = new Set<string>();
      for (const sd of t.sends ?? []) {
        if (!busIds.has(sd.bus)) continue;
        const key = `${sd.bus}|${sd.pre}`, bus = this.tracks.get(sd.bus)!;
        let e = n.sends.get(sd.id);
        if (e && e.key !== key) { e.g.disconnect(); n.sends.delete(sd.id); e = undefined; }
        if (!e) { const g = this.ctx.createGain(); g.gain.value = 0; (sd.pre ? n.pdc : n.pan).connect(g); g.connect(bus.input); e = { g, key }; n.sends.set(sd.id, e); }
        const audible = !t.mute && (!anySolo || t.solo);
        this.set(e.g.gain, audible ? sd.amt : 0); want.add(sd.id);
      }
      for (const [id, e] of n.sends) if (!want.has(id)) { e.g.disconnect(); n.sends.delete(id); }
    }
    if (needEnv && !this.envReady) this.initEnv().then(() => { if (this.lastProject) this.sync(this.lastProject); }, () => { /* navigateur sans AudioWorklet : pas de sidechain */ });
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
      // Tranche fixe (suite) : égaliseur et seuil du compresseur.
      ramp(n.low.gain, a[setKey('eqLow')], v => setFromNorm('eqLow', v)); ramp(n.mid.gain, a[setKey('eqMid')], v => setFromNorm('eqMid', v));
      ramp(n.high.gain, a[setKey('eqHigh')], v => setFromNorm('eqHigh', v)); ramp(n.comp.threshold, a[setKey('compThr')], v => setFromNorm('compThr', v));
      // Suite 3 : fréquence du médium et taux du compresseur.
      ramp(n.mid.frequency, a[setKey('eqMidF')], v => setFromNorm('eqMidF', v)); ramp(n.comp.ratio, a[setKey('compRatio')], v => setFromNorm('compRatio', v));
      // Le gain de compensation suit le seuil et le taux (courbe ou réglage fixe), comme quand on tourne les boutons du mixeur.
      const thrPts = a[setKey('compThr')], ratPts = a[setKey('compRatio')];
      if (thrPts?.length || ratPts?.length) {
        const mk = (q: number) => { const thr = thrPts?.length ? setFromNorm('compThr', autoAt(thrPts, q)) : tr.compThr, rat = ratPts?.length ? setFromNorm('compRatio', autoAt(ratPts, q)) : tr.compRatio; return Math.pow(10, -thr * (1 - 1 / rat) * 0.2 / 20); };
        n.makeup.gain.setValueAtTime(mk(s), t); n.makeup.gain.linearRampToValueAtTime(mk(s + 1), t + d);
      }
      // Réglages des effets (V17) : effets intégrés par rampes sur leurs paramètres audio, plugins du Mac à l'instant du pas.
      for (const ins of tr.inserts ?? []) {
        const keys = autoKeysOf(tr, ins.id), node = n.ins.get(ins.id);
        if (!keys.size || !node || !ins.on) continue;
        if (ins.type === 'au') {
          const au = node.wam as AuInstance | undefined; if (!au) continue;
          const vals: Record<string, number> = {};
          for (const k of keys) { const prm = au.params.find(q => String(q.address) === k); if (prm) vals[k] = auFromNorm(prm, autoAt(a[`ins:${ins.id}:${k}`]!, s)); }
          const sig = JSON.stringify(vals), last = this.auLast.get(tr.id + ins.id);
          if (sig !== last) { this.auLast.set(tr.id + ins.id, sig); this.auAt(t, () => au.apply(vals)); }
        } else if (FX[ins.type]) {
          const at = (x: number) => ({ ...ins, p: { ...ins.p, ...Object.fromEntries([...keys].map(k => [k, fxFromNorm(ins.type, k, autoAt(a[`ins:${ins.id}:${k}`]!, x))])) } });
          node.set(at(s), p, (prm, v) => prm.setValueAtTime(v, t), keys);
          node.set(at(s + 1), p, (prm, v) => prm.linearRampToValueAtTime(v, t + d), keys);
        }
      }
    }
  }
  /** Plugins du Mac : dernière valeur envoyée par l'automation, et changements à appliquer pendant un rendu hors-ligne. */
  private auLast = new Map<string, string>();
  auEvents = new Map<number, (() => void)[]>();
  private auTimers = new Set<number>();
  /** Un Audio Unit ne connaît pas l'heure du son : la valeur lui est envoyée au bon instant (minuterie, ou pause du rendu hors-ligne). */
  private auAt(t: number, fn: () => void) {
    if (!this.live) { const q = Math.max(0, Math.round(t * this.ctx.sampleRate / 128)); const l = this.auEvents.get(q) ?? []; l.push(fn); this.auEvents.set(q, l); return; }
    const id = window.setTimeout(() => { this.auTimers.delete(id); fn(); }, Math.max(0, (t - this.ctx.currentTime) * 1000));
    this.auTimers.add(id);
  }

  /** Fin de lecture : annule les rampes en attente et rend la main aux réglages du mixeur. */
  clearAuto(p: Project) {
    this.autoOn = false;
    const now = this.ctx.currentTime;
    for (const n of this.tracks.values()) {
      for (const prm of [n.auto.gain, n.duck.gain, n.pan.pan, n.lp.frequency, n.hp.frequency, n.revSend.gain, n.dlySend.gain, n.chWet.gain, n.low.gain, n.mid.gain, n.mid.frequency, n.high.gain, n.comp.threshold, n.comp.ratio, n.makeup.gain]) prm.cancelScheduledValues(now);
      n.auto.gain.setTargetAtTime(1, now, 0.015); n.duck.gain.setTargetAtTime(1, now, 0.015);
      this.ctlRest(n, now, true);
    }
    // Réglages d'effets automatisés : rampes annulées, minuteries des plugins du Mac arrêtées ; sync remet les valeurs fixes.
    for (const id of this.auTimers) clearTimeout(id);
    this.auTimers.clear(); this.auLast.clear();
    for (const tr of p.tracks) for (const ins of tr.inserts ?? []) {
      const node = this.tracks.get(tr.id)?.ins.get(ins.id);
      const keys = autoKeysOf(tr, ins.id);
      if (!node || !keys.size) continue;
      node.set(ins, p, prm => prm.cancelScheduledValues(now), keys);
      // Plugin du Mac : un réglage jamais touché à la main n'est pas dans le projet ; on lui rend sa valeur d'origine.
      const au = ins.type === 'au' ? node.wam as AuInstance | undefined : undefined;
      if (au) au.apply(Object.fromEntries([...keys].map(k => [k, ins.p[k] ?? au.params.find(q => String(q.address) === k)?.value ?? NaN])));
    }
    this.sync(p);
  }

  /** Courbe de l'égaliseur et des filtres d'une tranche : gain en dB pour chaque fréquence demandée. */
  eqCurve(id: string, freqs: Float32Array): Float32Array | null {
    const n = this.tracks.get(id);
    if (!n) return null;
    const out = new Float32Array(freqs.length), mag = new Float32Array(freqs.length), ph = new Float32Array(freqs.length);
    // Chaîne : les filtres et égaliseurs allumés de la chaîne (les égaliseurs contournés, à plat, ne changent rien).
    const list = n.chainOn ? (this.lastProject && [...this.lastProject.tracks, ...this.lastProject.buses].find(t => t.id === id)?.inserts || []).filter(i => i.on).flatMap(i => n.ins.get(i.id)?.bq ?? []) : [n.lp, n.hp, n.low, n.mid, n.high];
    for (const f of list) { f.getFrequencyResponse(freqs as Float32Array<ArrayBuffer>, mag, ph); for (let i = 0; i < out.length; i++) out[i] += 20 * Math.log10(Math.max(1e-6, mag[i])); }
    return out;
  }
  /** Réduction de gain du compresseur d'une tranche (dB, négatif) : celui de la tranche fixe, ou le premier allumé de la chaîne. */
  reduction(id: string): number {
    const n = this.tracks.get(id);
    if (!n) return 0;
    if (!n.chainOn) return n.compOn ? n.comp.reduction : 0;
    const tr = this.lastProject && [...this.lastProject.tracks, ...this.lastProject.buses].find(t => t.id === id);
    const ins = tr?.inserts.find(i => i.type === 'comp' && i.on);
    return (ins && n.ins.get(ins.id)?.dyn?.reduction) || 0;
  }

  // ---------- Instruments du Mac (V19) ----------
  private dropInst(n: TrackNodes) {
    if (!n.inst) return;
    if (n.inst.au) { this.instFor.delete(n.input); n.inst.au.audioNode.disconnect(); n.inst.au.audioNode.destroy?.(); }
    n.inst = undefined;
  }
  /** Branche l'instrument d'une piste (« aumu:… ») ; à l'écoute il se crée en arrière-plan, pour un export par `loadWams`. */
  private syncInst(t: Track, n: TrackNodes) {
    const url = t.type === 'synth' && !t.frozen && t.synth?.engine === 'au' ? t.synth.auUrl ?? '' : '';
    if (n.inst && n.inst.url !== url) this.dropInst(n);
    if (!url || n.inst || !this.live || !auBridge()) return;
    const slot: NonNullable<TrackNodes['inst']> = n.inst = { url, loading: true };
    createAuInstrument(this.ctx, url, t.synth!.auState ?? '', t.synth!.bend ?? 2).then(au => {
      if (n.inst !== slot) { au.audioNode.destroy?.(); return; }
      this.attachInst(n, au); slot.loading = false; this.onInst?.(t.id, true);
    }, () => { if (n.inst === slot) slot.loading = false; this.onInst?.(t.id, false); });
  }
  private attachInst(n: TrackNodes, au: AuInstrument) {
    n.inst ??= { url: '' }; n.inst.au = au; au.audioNode.connect(n.input); this.instFor.set(n.input, au);
  }
  /** Instrument du Mac d'une piste, s'il est chargé. */
  instOf(trackId: string): AuInstrument | undefined { return this.tracks.get(trackId)?.inst?.au; }
  /** Message MIDI d'un contrôle joué, pour un instrument du Mac : pitch bend sur 14 bits, molette (CC1), pression de canal. */
  private ctlMidi(au: AuInstrument, k: CtlKind, v: number, at: number) {
    if (k === 'pb') { const x = Math.max(0, Math.min(16383, Math.round(8192 + v * (v < 0 ? 8192 : 8191)))); au.midi(0xe0, x & 127, x >> 7, at); }
    else if (k === 'mod') au.midi(0xb0, 1, Math.round(v * 127), at);
    else au.midi(0xd0, Math.round(v * 127), 0, at);
  }

  // ---------- Contrôles joués (V19) : pitch bend, modulation, aftertouch ----------
  /** Crée (une fois) les nœuds de contrôle d'une piste d'instrument. */
  private ctlNodes(n: TrackNodes): CtlNodes {
    if (n.ctl) return n.ctl;
    const c = this.ctx, pitch = c.createGain(), bend = c.createConstantSource(), lfo = c.createOscillator(), gMod = c.createGain(), gAt = c.createGain();
    bend.offset.value = 0; bend.connect(pitch); bend.start();
    lfo.frequency.value = 5.5; gMod.gain.value = 0; gAt.gain.value = 0;
    lfo.connect(gMod).connect(pitch); lfo.connect(gAt).connect(pitch); lfo.start();
    this.pitchFor.set(n.input, pitch);
    return (n.ctl = { pitch, bend, lfo, gMod, gAt, range: 2 });
  }
  /** Paramètres audio pilotés par un contrôle, avec la conversion de sa valeur (cents de hauteur, gain). */
  private ctlParams(n: TrackNodes, k: CtlKind): [AudioParam, (v: number) => number][] {
    const c = n.ctl!;
    if (k === 'pb') return [[c.bend.offset, v => v * c.range * 100]];
    if (k === 'mod') return [[c.gMod.gain, v => v * MOD_CENTS]];
    return [[c.gAt.gain, v => v * AT_CENTS], [n.input.gain, v => 1 + v * AT_GAIN]];
  }
  /** Jeu en direct : le contrôle prend sa nouvelle valeur tout de suite (lissée sur quelques millisecondes). */
  ctlLive(trackId: string, k: CtlKind, v: number) {
    const n = this.tracks.get(trackId);
    if (!n?.ctl) return;
    const now = this.ctx.currentTime;
    for (const [prm, map] of this.ctlParams(n, k)) { prm.cancelScheduledValues(now); prm.setTargetAtTime(map(v), now, 0.004); }
    if (n.inst?.au) this.ctlMidi(n.inst.au, k, v, 0);
  }
  /** Remet tous les contrôles d'une piste au repos (arrêt, fin de clip). */
  ctlRest(n: TrackNodes, at: number, cancel: boolean) {
    if (!n.ctl) return;
    for (const k of CTL_KINDS) for (const [prm, map] of this.ctlParams(n, k)) {
      if (cancel) prm.cancelScheduledValues(at);
      if (this.live && cancel) prm.setTargetAtTime(map(CTL_REST[k]), at, 0.01); else prm.setValueAtTime(map(CTL_REST[k]), at);
    }
  }
  /** Lecture d'un clip : programme les contrôles enregistrés qui tombent dans ce pas (même chemin à l'écoute et à l'export). */
  schedCtl(n: TrackNodes, c: Clip, local: number, t: number, dur: number, remain: number, first: boolean) {
    if (!n.ctl || !c.ctl) return;
    for (const k of CTL_KINDS) {
      const pts = c.ctl[k];
      if (!pts?.length) continue;
      const prms = this.ctlParams(n, k), au = n.inst?.au;
      const put = (v: number, at: number, ramp: boolean) => { if (au) { this.ctlMidi(au, k, v, at); return; } for (const [prm, map] of prms) ramp ? prm.linearRampToValueAtTime(map(v), at) : prm.setValueAtTime(map(v), at); };
      // Début du clip (ou reprise de la boucle du motif) : la valeur de ce point du motif, posée d'un coup.
      if (first || local < 1e-6) put(ctlAt(pts, local, k), t, false);
      pts.forEach((pt, i) => { const f = pt.s - local; if (f >= 0 && f < 1 && f < remain) put(pt.v, t + f * dur, i > 0 && !(first && f === 0)); });
      // Dernier pas du clip : retour au repos, pour qu'un bend ne reste pas accroché sur la suite.
      if (remain <= 1) put(CTL_REST[k], t + remain * dur, false);
    }
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
    for (const n of this.tracks.values()) if (n.inst?.au) { const au = n.inst.au; au.midi(0xb0, 123, 0, 0); au.midi(0xb0, 64, 0, 0); au.midi(0xe0, 0, 64, 0); au.midi(0xb0, 1, 0, 0); }
    for (const n of this.active) { try { n.stop(); } catch { /* déjà arrêté */ } }
    this.active.clear();
    this.openHats.clear(); this.sampleTurns.clear(); this.instrumentTurns = new WeakMap();
  }
}

// ---------- Séquenceur ----------

/** Réglages automatisés d'un effet de la piste (clés de réglage, ou adresses d'Audio Unit). */
export function autoKeysOf(tr: Track, insId: string): Set<string> {
  const out = new Set<string>(), ins = tr.inserts?.find(i => i.id === insId);
  for (const [key, pts] of Object.entries(tr.auto ?? {})) {
    const k = parseInsKey(key);
    if (k && k.id === insId && pts?.length && ins && (ins.type === 'au' || fxAutomatable(ins.type, k.k))) out.add(k.k);
  }
  return out;
}

// Voix et séquenceur rangés à part ; réexportés pour que les imports existants ne changent pas.
export * from './voices';
export * from './schedule';
