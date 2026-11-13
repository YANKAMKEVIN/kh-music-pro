/**
 * Entrée et sortie de la carte son par le natif (prototype V14b, version bureau macOS lancée avec KH_NATIVE=1).
 *
 * Web Audio ne fait plus que calculer : le contexte n'a plus de sortie (setSinkId « none »), et un AudioWorklet en fin de
 * chaîne écrit le mixage dans un tampon circulaire partagé, que le module natif envoie à la carte son. Le micro arrive
 * par le même chemin en sens inverse : le natif l'écrit dans un second tampon, qu'un AudioWorklet relit comme une source.
 * Le natif cale les deux horloges (celle, logicielle, de Web Audio et celle de la carte son) en gardant chaque tampon
 * à un niveau cible par un très léger rééchantillonnage. Le mixage reste entièrement dans Web Audio.
 */
import { auBridge } from './au';

export interface IoOptions {
  /** Partie du nom de l'appareil de sortie ('' = celui du système). */
  output?: string;
  /** Partie du nom de l'appareil d'entrée ('' = celui du système, null = pas d'entrée). */
  input?: string | null;
  /** Tampon de la carte son, en échantillons. */
  buffer?: number;
  /** Niveaux cibles des deux tampons partagés, en échantillons. */
  outTarget?: number;
  inTarget?: number;
  /** Gain appliqué en sortie par le natif (1e-5 = -100 dB, pour les longues tenues sans rien faire entendre). */
  gain?: number;
  /**
   * Ce qui cadence le calcul de Web Audio. 'output' (par défaut) : la sortie choisie elle-même, ouverte aussi par Chromium
   * mais sans rien y faire entendre ; les deux côtés suivent alors la même horloge. 'none' : contexte sans sortie
   * (setSinkId « none »), cadencé par une horloge logicielle de Chromium, irrégulière (essais de l'étape 5).
   */
  clock?: 'output' | 'none';
}
export interface IoInfo { output: string; input: string | null; inChannels: number; outDeclared: number; inDeclared: number; outRate: number; inRate?: number; buffer: number }
export interface IoStats {
  outCalls: number; outFrames: number; outUnderruns: number; outStarts: number; overloads: number; gaps: number; maxGapMs: number;
  outLevel: number; outMin: number; outMax: number; outTarget: number; outPpm: number;
  inCalls: number; inFrames: number; inOverflows: number; inLevel: number; inMin: number; inMax: number; inTarget: number; inPpm: number;
  armed: number; tripMs: number; floor: number;
  /** Compteurs des worklets : blocs écrits, débordements du tampon de sortie, blocs lus, manques d'entrée. */
  outBlocks: number; outDropped: number; inBlocks: number; inMissed: number;
}
interface IoBridge {
  ioStart(sab: SharedArrayBuffer, o: IoOptions & { sampleRate: number }): IoInfo;
  ioStop(): void;
  ioStats(): Omit<IoStats, 'outBlocks' | 'outDropped' | 'inBlocks' | 'inMissed'> | null;
  ioArm(threshold: number): void;
  ioResetStats(): void;
  ioGain(g: number): void;
  ioDevices(): { name: string; inputs: number; outputs: number }[];
}

export const ioBridge = (): IoBridge | null => {
  const b = auBridge() as unknown as Partial<IoBridge> | null;
  return b && typeof b.ioStart === 'function' ? b as IoBridge : null;
};

const N = 8192, HDR = 32;
/**
 * Niveaux cibles des tampons partagés (essais de l'étape 5). Le niveau oscille d'un bloc de Web Audio (128) ; en sortie,
 * selon l'ordre dans lequel les fils de Chromium et du natif se réveillent à chaque cycle de la carte son, il peut perdre
 * un bloc de plus. 384 en sortie garde une marge dans les deux cas ; 256 suffit en entrée.
 */
const OUT_TARGET = 384, IN_TARGET = 256;
// En-tête partagé (Int32) : voir native/kh-au-bridge/src/io.mm.
const WORKLET = `const N=${N},M=N-1;
class KhOut extends AudioWorkletProcessor{
constructor(o){super();const s=o.processorOptions.sab;this.h=new Int32Array(s,0,${HDR});this.r=[new Float32Array(s,${HDR * 4},N),new Float32Array(s,${HDR * 4 + 4 * N},N)];this.alive=true;this.port.onmessage=e=>{if(e.data==='stop')this.alive=false}}
process(ins){const a=ins[0],h=this.h,w=h[0];
if(((w-Atomics.load(h,1))|0)>N-256){Atomics.add(h,5,1);return this.alive}
const f=a[0]?a[0].length:128,i=w&M;
for(let c=0;c<2;c++){const x=a[c]||a[0],r=this.r[c];if(!x){for(let k=0;k<f;k++)r[(i+k)&M]=0}else if(i+f<=N)r.set(x,i);else for(let k=0;k<f;k++)r[(i+k)&M]=x[k]}
Atomics.store(h,0,(w+f)|0);h[8]++;return this.alive}}
class KhIn extends AudioWorkletProcessor{
constructor(o){super();const s=o.processorOptions.sab;this.h=new Int32Array(s,0,${HDR});this.r=[new Float32Array(s,${HDR * 4 + 8 * N},N),new Float32Array(s,${HDR * 4 + 12 * N},N)];this.on=false;this.alive=true;this.port.onmessage=e=>{if(e.data==='stop')this.alive=false}}
process(ins,outs){const b=outs[0],h=this.h,f=b[0].length,w=Atomics.load(h,2),t=h[4];let r=h[3],av=(w-r)|0;
if(av>N/2){r=(w-t)|0;av=t}
if(!this.on){if(av>=t)this.on=true;else{h[3]=r;return this.alive}}
if(av<f){h[6]++;this.on=false;return this.alive}
for(let c=0;c<b.length;c++){const src=this.r[Math.min(c,(h[10]||1)-1)],o=b[c];for(let k=0;k<f;k++)o[k]=src[(r+k)&M]}
Atomics.store(h,3,(r+f)|0);h[9]++;return this.alive}}
registerProcessor('kh-out',KhOut);registerProcessor('kh-in',KhIn)`;

export class NativeIO {
  readonly sab = new SharedArrayBuffer(HDR * 4 + 16 * N);
  readonly h = new Int32Array(this.sab, 0, HDR);
  /** Fin de chaîne : tout ce qui doit être entendu se branche ici, à la place de ctx.destination. */
  sink!: AudioWorkletNode;
  info!: IoInfo;
  opts: IoOptions = {};
  private constructor(public ctx: AudioContext, private br: IoBridge) { this.h[7] = N; }

  static async start(ctx: AudioContext, opts: IoOptions = {}): Promise<NativeIO> {
    const br = ioBridge();
    if (!br) throw new Error('native audio i/o unavailable');
    if (typeof SharedArrayBuffer === 'undefined') throw new Error('SharedArrayBuffer unavailable');
    const io = new NativeIO(ctx, br);
    await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' })));
    io.sink = new AudioWorkletNode(ctx, 'kh-out', { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 2, channelCountMode: 'explicit', processorOptions: { sab: io.sab } });
    await io.configure({ output: '', input: '', ...opts });
    return io;
  }

  /** Sortie du navigateur qui cadence Web Audio (partie de son libellé), ou null sans sortie. */
  clock: string | null | undefined;
  private keep?: ConstantSourceNode;
  private async setClock(clock: string | null) {
    if (clock === this.clock) return;
    const c = this.ctx as unknown as { setSinkId(o: string | { type: 'none' }): Promise<void> };
    if (clock === null) { this.keep?.stop(); this.keep = undefined; await c.setSinkId({ type: 'none' }); }
    else {
      let id = '';
      if (clock) try { id = (await navigator.mediaDevices.enumerateDevices()).find(d => d.kind === 'audiooutput' && d.deviceId !== 'default' && d.deviceId !== 'communications' && d.label.toLowerCase().includes(clock.toLowerCase()))?.deviceId ?? ''; } catch { /* liste indisponible */ }
      await c.setSinkId(id);
      // Un signal infime (-180 dB) : sinon Chromium, voyant du silence, repasse sur son horloge logicielle au bout de quelques secondes.
      if (!this.keep) { this.keep = new ConstantSourceNode(this.ctx, { offset: 1e-9 }); this.keep.connect(this.ctx.destination); this.keep.start(); }
    }
    this.clock = clock;
  }

  /** Change les réglages (appareils, niveaux cibles...) et redémarre le natif ; les tampons partagés continuent, le natif s'y recale. */
  async configure(opts: IoOptions = {}): Promise<IoInfo> {
    this.opts = { ...this.opts, ...opts };
    await this.setClock(this.opts.clock === 'none' ? null : this.opts.output ?? '');
    return this.restart();
  }
  restart(): IoInfo {
    const { clock: _, ...o } = this.opts;
    this.info = this.br.ioStart(this.sab, { sampleRate: this.ctx.sampleRate, buffer: 128, outTarget: OUT_TARGET, inTarget: IN_TARGET, ...o });
    return this.info;
  }

  /** Une source qui joue ce que capte l'entrée de la carte son (null s'il n'y en a pas). */
  source(): AudioWorkletNode | null {
    const ch = this.info.inChannels;
    if (!ch) return null;
    return new AudioWorkletNode(this.ctx, 'kh-in', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [ch], processorOptions: { sab: this.sab } });
  }

  /** Latences du chemin natif, en secondes : sortie (tampon partagé + carte son), entrée (carte son + tampon partagé). */
  latency(): { output: number; input: number } {
    const sr = this.ctx.sampleRate, o = this.opts;
    return { output: (o.outTarget ?? OUT_TARGET) / sr + this.info.outDeclared, input: this.info.inChannels ? (o.inTarget ?? IN_TARGET) / sr + this.info.inDeclared : 0 };
  }

  stats(): IoStats {
    const s = this.br.ioStats()!, h = this.h;
    return { ...s, outBlocks: h[8], outDropped: h[5], inBlocks: h[9], inMissed: h[6] };
  }
  resetStats() { this.br.ioResetStats(); this.h[5] = 0; this.h[6] = 0; }
  arm(threshold: number) { this.br.ioArm(threshold); }
  gain(g: number) { this.opts.gain = g; this.br.ioGain(g); }
  devices() { return this.br.ioDevices(); }
  stop() { this.br.ioStop(); }
}

/** Nom d'appareil natif correspondant à un identifiant du navigateur (son libellé, sans la parenthèse finale). */
export async function nativeName(deviceId: string, kind: 'audioinput' | 'audiooutput'): Promise<string> {
  if (!deviceId || deviceId === 'default') return '';
  try {
    const d = (await navigator.mediaDevices.enumerateDevices()).find(x => x.kind === kind && x.deviceId === deviceId);
    return d?.label.replace(/\s*\([^)]*\)\s*$/, '').trim() ?? '';
  } catch { return ''; }
}
