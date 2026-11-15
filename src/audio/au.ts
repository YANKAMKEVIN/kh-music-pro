/**
 * Plugins Audio Unit du Mac (version bureau macOS, quand le module natif est présent).
 *
 * Le plugin tourne dans un fil natif ; un AudioWorklet lui passe chaque bloc par une mémoire partagée et
 * attend la réponse dans le même bloc. Vu du mixeur, c'est un nœud comme un plugin web : même place
 * dans la chaîne d'effets, même chemin pour l'écoute et l'export.
 * Un effet Audio Unit se note `url: 'aufx:lpas:appl'` (type, sous-type, fabricant) ; `p` donne ses paramètres
 * par adresse (`{ '0': 1000 }`).
 */
import type { WamInstance } from './wam';

/** Un réglage d'Audio Unit : adresse, nom, bornes, valeur par défaut et actuelle, unité (code Core Audio). */
export interface AuParam { address: number; name: string; min: number; max: number; def: number; value: number; unit: number }
export interface AuDesc { type: string; subtype: string; manufacturer: string; name: string }

/**
 * Le pont exposé par la version bureau (electron/native-preload.cjs). La mémoire partagée ne pouvant pas traverser le pont,
 * on la confie d'abord par `shareSab`, et les fonctions reçoivent ensuite sa clé.
 */
export interface Bridge {
  forced?: boolean;
  forget(key: string): void;
  open(key: string, type: string, sub: string, man: string, sr: number, ch: number, max: number): number;
  setParam(id: number, address: number, value: number): void;
  params(id: number): AuParam[];
  info(id: number): { name: string; latency: number; tail: number };
  close(id: number): void;
  list(): AuDesc[];
}

export const auBridge = (): Bridge | null => (window as unknown as { khNative?: Bridge }).khNative ?? null;

let keys = 0;
/** Confie une mémoire partagée au pont (par window.postMessage) ; renvoie la clé à passer à ses fonctions. */
export function shareSab(sab: SharedArrayBuffer): Promise<string> {
  const key = `kh${++keys}-${Math.random().toString(36).slice(2)}`;
  return new Promise((ok, ko) => {
    const done = (e: MessageEvent) => { if (e.source === window && e.data?.khSabOk === key) { clearTimeout(t); removeEventListener('message', done); ok(key); } };
    const t = setTimeout(() => { removeEventListener('message', done); ko(new Error('native bridge did not take the shared memory')); }, 2000);
    addEventListener('message', done);
    window.postMessage({ khSab: sab, key }, '*');
  });
}

/** Plugins d'effet du Mac (vide hors de la version bureau macOS), triés par nom. Le nom commence par le fabricant (« Apple: AUDelay »). */
export function auList(): AuDesc[] {
  try { return (auBridge()?.list() ?? []).filter(d => d.type === 'aufx').sort((a, b) => a.name.localeCompare(b.name)); } catch { return []; }
}
/** Nom à afficher : sans le préfixe du fabricant ni le « AU » d'Apple (« Apple: AUDelay » → « Delay »). */
export const auName = (name: string) => name.replace(/^[^:]*:\s*/, '').replace(/^AU(?=[A-Z])/, '');

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

export type AuInstance = WamInstance & {
  auId: number; stats(): Promise<{ miss: number; n: number; spin: number }>; info: { name: string; latency: number; tail: number };
  /** Réglages du plugin, lus à sa création. */
  params: AuParam[];
  /** Applique les réglages du projet (`p`, par adresse) qui ont changé depuis la dernière fois. */
  apply(p: Record<string, number>): void;
};

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
  const key = await shareSab(sab);
  let id: number;
  try { id = br.open(key, type, sub, man, ctx.sampleRate, CH, MAX); } catch (e) { br.forget(key); throw e; }
  const sent: Record<string, number> = {};
  const apply = (p: Record<string, number>) => { for (const [k, v] of Object.entries(p)) if (sent[k] !== v && Number.isFinite(v)) { sent[k] = v; br.setParam(id, Number(k), v); } };
  apply(params);
  const node = new AudioWorkletNode(ctx, 'kh-au', {
    numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [CH], channelCount: CH, channelCountMode: 'explicit', processorOptions: { sab },
  }) as AudioWorkletNode & { destroy?: () => void };
  let closed = false;
  node.destroy = () => { if (closed) return; closed = true; node.port.postMessage('stop'); setTimeout(() => { br.close(id); br.forget(key); }, 50); };
  const info = br.info(id);
  let list: AuParam[] = [];
  try { list = br.params(id) ?? []; } catch { /* plugin sans liste de réglages */ }
  return {
    audioNode: node, auId: id, info, descriptor: { name: info.name, vendor: man }, params: list, apply,
    stats: () => new Promise(r => { node.port.onmessage = e => r(e.data); node.port.postMessage('stats'); }),
  };
}
