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
export interface AuParam { address: number; name: string; min: number; max: number; def: number; value: number; unit: number; flags?: number;
  /** Réglage à choix : nom de chaque valeur (de min à max), s'il les fournit. */
  values?: string[] }
/** Drapeau Core Audio kAudioUnitParameterFlag_DisplayLogarithmic. */
const LOG_FLAG = 1 << 22;
/**
 * Réglage à parcourir sur une échelle logarithmique : fréquences (Hz) et réglages que le plugin déclare logarithmiques,
 * quand la plage le permet (minimum positif, au moins un facteur 20). Un curseur linéaire de 10 Hz à 22 kHz rendrait
 * tout le grave et le médium inaccessibles (moins de 5 % de la course sous 1 kHz).
 */
export const auLog = (p: AuParam) => p.min > 0 && p.max / p.min >= 20 && (p.unit === 8 || ((p.flags ?? 0) & LOG_FLAG) !== 0);
/** Position (0 à 1) sur le curseur logarithmique, et valeur correspondante (4 chiffres significatifs). */
export const auToPos = (p: AuParam, v: number) => Math.min(1, Math.max(0, Math.log(Math.max(v, p.min) / p.min) / Math.log(p.max / p.min)));
export const auFromPos = (p: AuParam, x: number) => Math.min(p.max, Math.max(p.min, Number((p.min * Math.pow(p.max / p.min, x)).toPrecision(4))));
/** Valeur d'un réglage d'Audio Unit pour une position d'automation 0..1 (logarithmique pour les fréquences, entière pour les choix). */
export function auFromNorm(p: AuParam, v: number): number {
  const x = auLog(p) ? auFromPos(p, v) : p.min + v * (p.max - p.min);
  return p.unit === 1 || p.unit === 2 || p.values?.length ? Math.round(x) : x;
}
export const auToNorm = (p: AuParam, x: number) => (auLog(p) ? auToPos(p, x) : p.max > p.min ? Math.min(1, Math.max(0, (x - p.min) / (p.max - p.min))) : 0);
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
  presets?(id: number): { number: number; name: string }[];
  setPreset?(id: number, n: number): boolean;
  info(id: number): { name: string; latency: number; tail: number };
  close(id: number): void;
  list(): AuDesc[];
  /** Fenêtre graphique du plugin (V17) : vue Cocoa du plugin, ou vue générique d'Apple. Absent d'un module natif plus ancien. */
  uiOpen?(id: number): { generic: boolean; width: number; height: number } | null;
  uiClose?(id: number): void;
  uiIsOpen?(id: number): boolean;
  uiPump?(): void;
  /** État complet du plugin, en base64 (V19, instruments) ; absent d'un module natif plus ancien. */
  getState?(id: number): string;
  setState?(id: number, b64: string): boolean;
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
/** Instruments du Mac (V19) : Audio Units de type « aumu » (DLSMusicDevice, AUSampler, et ceux qu'on installe). */
export function auInstruments(): AuDesc[] {
  try { return (auBridge()?.list() ?? []).filter(d => d.type === 'aumu').sort((a, b) => a.name.localeCompare(b.name)); } catch { return []; }
}
/** Nom à afficher : sans le préfixe du fabricant ni le « AU » d'Apple (« Apple: AUDelay » → « Delay »). */
export const auName = (name: string) => name.replace(/^[^:]*:\s*/, '').replace(/^AU(?=[A-Z])/, '');

const MAX = 128, CH = 2, EVMAX = 256;
// Instrument (V19) : la page envoie les évènements MIDI datés à l'échantillon près ({ ev: [[échantillon, message], ...] }) ;
// à chaque bloc, le worklet range ceux qui y tombent (ou sont en retard) dans la mémoire partagée avant de demander le calcul.
const WORKLET = `class KhAU extends AudioWorkletProcessor{
constructor(o){super();const s=o.processorOptions.sab;this.h=new Int32Array(s,0,16);this.i=new Float32Array(s,64,${CH * MAX});this.o=new Float32Array(s,64+${4 * CH * MAX},${CH * MAX});
this.inst=!!o.processorOptions.inst;if(this.inst)this.e=new Int32Array(s,64+${8 * CH * MAX},${2 * EVMAX});this.q=[];
this.seq=0;this.miss=0;this.n=0;this.spin=0;this.alive=true;
this.port.onmessage=e=>{const d=e.data;if(d==='stop')this.alive=false;else if(d&&d.ev){for(const x of d.ev)this.q.push(x);this.q.sort((a,b)=>a[0]-b[0]);if(d.ack)this.port.postMessage({ack:d.ack})}else this.port.postMessage({miss:this.miss,n:this.n,spin:this.spin})}}
process(ins,outs){const a=ins[0],b=outs[0],f=b[0].length;
for(let c=0;c<${CH};c++){const x=a[c]||a[0];if(x)this.i.set(x,c*${MAX});else this.i.fill(0,c*${MAX},c*${MAX}+f)}
if(this.inst){let k=0;const end=currentFrame+f;while(k<this.q.length&&k<${EVMAX}&&this.q[k][0]<end){this.e[2*k]=Math.max(0,this.q[k][0]-currentFrame);this.e[2*k+1]=this.q[k][1];k++}this.q.splice(0,k);this.h[3]=k}
this.h[2]=f;const s=++this.seq;Atomics.store(this.h,0,s);this.n++;
let k=0;const t=Date.now();
while(Atomics.load(this.h,1)!==s){if(++k%256===0&&Date.now()-t>3)break}
if(k>this.spin)this.spin=k;
if(Atomics.load(this.h,1)!==s){this.miss++;for(let c=0;c<b.length;c++){if(this.inst)b[c].fill(0);else b[c].set(this.i.subarray(c*${MAX},c*${MAX}+f))}}
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
  /** Préréglages d'usine du plugin (vide s'il n'en a pas). */
  presets: { number: number; name: string }[];
  /** Charge un préréglage d'usine ; renvoie les réglages qui en résultent (null en cas de refus). */
  preset(n: number): AuParam[] | null;
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
  let presets: { number: number; name: string }[] = [];
  try { presets = br.presets?.(id) ?? []; } catch { /* plugin sans préréglages */ }
  const preset = (n: number) => {
    if (!br.setPreset?.(id, n)) return null;
    const after = br.params(id) ?? [];
    for (const p of after) sent[String(p.address)] = p.value;   // déjà dans le plugin : inutile de les renvoyer
    return after;
  };
  return {
    audioNode: node, auId: id, info, descriptor: { name: info.name, vendor: man }, params: list, apply, presets, preset,
    stats: () => new Promise(r => { node.port.onmessage = e => r(e.data); node.port.postMessage('stats'); }),
  };
}

// ---------- Instruments du Mac (V19) ----------
export type AuInstrument = AuInstance & {
  /** Envoie un message MIDI (statut, donnée 1, donnée 2) qui sonnera à l'instant `t` (secondes du contexte ; dans le passé = tout de suite). */
  midi(st: number, d1: number, d2: number, t: number): void;
  /** Rendu hors-ligne : s'assure que tous les évènements envoyés sont arrivés au worklet avant de lancer le calcul. */
  flush(): Promise<void>;
  /** État complet du plugin (base64, '' s'il ne le donne pas), et rechargement d'un état. */
  getState(): string;
  setState(b64: string): boolean;
};
/** Crée l'instrument `url` (« aumu:dls :appl ») sur ce contexte ; `state` = état complet gardé dans le projet ; `bend` = plage du pitch bend (demi-tons). */
export async function createAuInstrument(ctx: BaseAudioContext, url: string, state = '', bend = 2): Promise<AuInstrument> {
  const br = auBridge();
  if (!br) throw new Error('native bridge unavailable');
  if (typeof SharedArrayBuffer === 'undefined') throw new Error('SharedArrayBuffer unavailable');
  const [type, sub, man] = url.split(':');
  let l = loaded.get(ctx);
  if (!l) { l = ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }))); loaded.set(ctx, l); }
  await l;
  const sab = new SharedArrayBuffer(64 + 8 * CH * MAX + 8 * EVMAX);
  const key = await shareSab(sab);
  let id: number;
  try { id = br.open(key, type, sub, man, ctx.sampleRate, CH, MAX); } catch (e) { br.forget(key); throw e; }
  if (state) { try { br.setState?.(id, state); } catch { /* état illisible : le plugin garde ses réglages d'origine */ } }
  const node = new AudioWorkletNode(ctx, 'kh-au', {
    numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [CH], channelCount: CH, channelCountMode: 'explicit', processorOptions: { sab, inst: true },
  }) as AudioWorkletNode & { destroy?: () => void };
  let closed = false;
  node.destroy = () => { if (closed) return; closed = true; node.port.postMessage('stop'); setTimeout(() => { br.close(id); br.forget(key); }, 50); };
  // Les évènements d'un même instant de la page partent ensemble (un message par tâche, pas un par note).
  let batch: [number, number][] = [], acks = 0;
  const waiting = new Map<number, () => void>();
  const send = () => { if (batch.length) { node.port.postMessage({ ev: batch }); batch = []; } };
  node.port.onmessage = e => { const w = waiting.get(e.data?.ack); if (w) { waiting.delete(e.data.ack); w(); } };
  const midi = (st: number, d1: number, d2: number, t: number) => {
    if (closed) return;
    if (!batch.length) queueMicrotask(send);
    batch.push([Math.max(0, Math.round(t * ctx.sampleRate)), (st & 255) | ((d1 & 127) << 8) | ((d2 & 127) << 16)]);
  };
  // Plage du pitch bend (RPN 0), pour que le bend joue comme sur les instruments intégrés.
  for (const [cc, v] of [[101, 0], [100, 0], [6, Math.round(bend)], [38, 0], [101, 127], [100, 127]]) midi(0xb0, cc, v, 0);
  const info = br.info(id);
  let list: AuParam[] = [];
  try { list = br.params(id) ?? []; } catch { /* plugin sans liste de réglages */ }
  return {
    audioNode: node, auId: id, info, descriptor: { name: info.name, vendor: man }, params: list, presets: [], preset: () => null,
    apply: (p: Record<string, number>) => { for (const [k, v] of Object.entries(p)) if (Number.isFinite(v)) br.setParam(id, Number(k), v); },
    stats: () => new Promise(r => { const prev = node.port.onmessage; node.port.onmessage = e => { if (e.data?.n !== undefined) { node.port.onmessage = prev; r(e.data); } else prev?.call(node.port, e); }; node.port.postMessage('stats'); }),
    midi,
    flush: () => new Promise<void>(ok => { const a = ++acks; waiting.set(a, ok); node.port.postMessage({ ev: batch, ack: a }); batch = []; }),
    getState: () => { try { return br.getState?.(id) ?? ''; } catch { return ''; } },
    setState: (b64: string) => { try { return !!br.setState?.(id, b64); } catch { return false; } },
  };
}
