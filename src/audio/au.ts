/**
 * Plugins Audio Unit (prototype V14b, version bureau macOS lancée avec KH_NATIVE=1).
 *
 * Le plugin tourne dans un fil natif ; un AudioWorklet lui passe chaque bloc par une mémoire partagée et
 * attend la réponse dans le même bloc. Vu du mixeur, c'est un nœud comme un plugin web : même place
 * dans la chaîne d'effets, même chemin pour l'écoute et l'export.
 * Un effet Audio Unit se note `url: 'aufx:lpas:appl'` (type, sous-type, fabricant) ; `p` donne ses paramètres
 * par adresse (`{ '0': 1000 }`).
 */
import type { WamInstance } from './wam';

interface Bridge {
  open(sab: SharedArrayBuffer, type: string, sub: string, man: string, sr: number, ch: number, max: number): number;
  setParam(id: number, address: number, value: number): void;
  info(id: number): { name: string; latency: number; tail: number };
  close(id: number): void;
  list(): { type: string; subtype: string; manufacturer: string; name: string }[];
}

export const auBridge = (): Bridge | null => (window as unknown as { khNative?: Bridge }).khNative ?? null;

const MAX = 128, CH = 2;
const WORKLET = `class KhAU extends AudioWorkletProcessor{
constructor(o){super();const s=o.processorOptions.sab;this.h=new Int32Array(s,0,16);this.i=new Float32Array(s,64,${CH * MAX});this.o=new Float32Array(s,64+${4 * CH * MAX},${CH * MAX});
this.seq=0;this.miss=0;this.n=0;this.spin=0;this.alive=true;
this.port.onmessage=e=>{if(e.data==='stop')this.alive=false;else this.port.postMessage({miss:this.miss,n:this.n,spin:this.spin})}}
process(ins,outs){const a=ins[0],b=outs[0],f=b[0].length;
for(let c=0;c<${CH};c++){const x=a[c]||a[0];if(x)this.i.set(x,c*${MAX});else this.i.fill(0,c*${MAX},c*${MAX}+f)}
this.h[2]=f;const s=++this.seq;Atomics.store(this.h,0,s);this.n++;
let k=0;const t=Date.now();
while(Atomics.load(this.h,1)!==s){if(++k%256===0&&Date.now()-t>3)break}
if(k>this.spin)this.spin=k;
if(Atomics.load(this.h,1)!==s){this.miss++;for(let c=0;c<b.length;c++)b[c].set(this.i.subarray(c*${MAX},c*${MAX}+f))}
else for(let c=0;c<b.length;c++)b[c].set(this.o.subarray(c*${MAX},c*${MAX}+f));
return this.alive}}
registerProcessor('kh-au',KhAU)`;

const loaded = new WeakMap<BaseAudioContext, Promise<void>>();

export type AuInstance = WamInstance & { auId: number; stats(): Promise<{ miss: number; n: number; spin: number }>; info: { name: string; latency: number; tail: number } };

/** Crée le plugin désigné par `url` (« aufx:lpas:appl ») sur ce contexte, temps réel ou rendu hors-ligne. */
export async function createAu(ctx: BaseAudioContext, url: string, params: Record<string, number> = {}): Promise<AuInstance> {
  const br = auBridge();
  if (!br) throw new Error('native bridge unavailable');
  if (typeof SharedArrayBuffer === 'undefined') throw new Error('SharedArrayBuffer unavailable');
  const [type, sub, man] = url.split(':');
  let l = loaded.get(ctx);
  if (!l) { l = ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }))); loaded.set(ctx, l); }
  await l;
  const sab = new SharedArrayBuffer(64 + 8 * CH * MAX);
  const id = br.open(sab, type, sub, man, ctx.sampleRate, CH, MAX);
  for (const [k, v] of Object.entries(params)) br.setParam(id, Number(k), v);
  const node = new AudioWorkletNode(ctx, 'kh-au', {
    numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [CH], channelCount: CH, channelCountMode: 'explicit', processorOptions: { sab },
  }) as AudioWorkletNode & { destroy?: () => void };
  let closed = false;
  node.destroy = () => { if (closed) return; closed = true; node.port.postMessage('stop'); setTimeout(() => br.close(id), 50); };
  const info = br.info(id);
  return {
    audioNode: node, auId: id, info, descriptor: { name: info.name, vendor: man },
    stats: () => new Promise(r => { node.port.onmessage = e => r(e.data); node.port.postMessage('stats'); }),
  };
}
