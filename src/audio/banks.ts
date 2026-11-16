/**
 * Banques de sons échantillonnés (vrais instruments), chargées à la demande depuis public/banks.
 * Chaque instrument est enregistré tous les trois demi-tons ; les notes intermédiaires sont transposées.
 */
import type { Project } from '../types';
import { SUSTAIN_BANKS, SustainLoop, sustainSample } from './sustain';
import { noteLoudness } from './loudness';
import { EXPRESSIVE, ExpressiveEntry } from './expressive-manifest';

export interface Sample { buf: AudioBuffer; off: number; gain: number; audible: boolean; held?: { buf: AudioBuffer; loop: SustainLoop } } // off = silence initial à sauter (s), gain = mise à niveau
/** Identifiant de banque → dossier des fichiers. */
export const BANKS: Record<string, string> = {
  piano: 'acoustic_grand_piano', nylon: 'acoustic_guitar_nylon', eguitar: 'electric_guitar_clean', ebass: 'electric_bass_finger', abass: 'acoustic_bass',
  honky: 'honkytonk_piano',
  epiano: 'electric_piano_1',
  clavinet: 'clavinet',
  drawbar: 'drawbar_organ',
  church: 'church_organ',
  steel: 'acoustic_guitar_steel',
  overdrive: 'overdriven_guitar',
  slap: 'slap_bass_1',
  violin: 'violin',
  contrabass: 'contrabass',
  trumpet: 'trumpet',
  trombone: 'trombone',
  marimba: 'marimba',
  vibes: 'vibraphone',
  steelpan: 'steel_drums',
  air: 'pad_7_halo',
  cinema: 'fx_2_soundtrack',
  synthchoir: 'synth_choir',
  strings: 'string_ensemble_1', cello: 'cello', brass: 'brass_section', sax: 'tenor_sax', flute: 'flute', choir: 'choir_aahs', drums: 'drums',
};
const NOTES = Array.from({ length: 25 }, (_, i) => 24 + i * 3), PADS = Array.from({ length: 16 }, (_, i) => i);

const loaded = new Map<string, Map<number, Sample>>(), pending = new Map<string, Promise<void>>();
let decoder: BaseAudioContext | null = null;
export const setDecoder = (ctx: BaseAudioContext) => { decoder = ctx; };
type Layered = Map<number, Sample[][]>;
const expressiveLoaded = new Map<string, Layered>();
export const bankReady = (id: string) => loaded.has(id) || expressiveLoaded.has(id);
/** Oublie un instrument chargé (vérifications : rejouer le tout premier chargement). */
export const forgetBank = (id: string) => { loaded.delete(id); expressiveLoaded.delete(id); };

/** New kits have their own IDs: old projects keep the original acoustic kit. */
export const drumBank = (kit?: string): string | undefined => kit === 'acoustic' ? 'drums' : kit === 'studio' ? 'studio_drums' : undefined;

/** Lecture d'un fichier embarqué. XMLHttpRequest fonctionne aussi dans la version bureau (fichiers locaux). */
function fetchBytes(url: string): Promise<ArrayBuffer> {
  return new Promise((res, rej) => {
    const x = new XMLHttpRequest(); x.open('GET', url); x.responseType = 'arraybuffer';
    x.timeout = 30000; x.ontimeout = () => rej(new Error('sample timeout'));
    x.onload = () => (x.status === 200 || (x.status === 0 && x.response?.byteLength) ? res(x.response) : rej(new Error('http ' + x.status)));
    x.onerror = () => rej(new Error('network')); x.send();
  });
}

/** Bounded parallel decoding; a failed bank is never published partially. */
async function loadExpressive(id: string) {
  const entries = EXPRESSIVE[id].samples, map: Layered = new Map();
  let next = 0, failed: unknown;
  const context = decoder!;
  const worker = async () => {
    while (next < entries.length && !failed) {
      const e: ExpressiveEntry = entries[next++];
      try {
        const buf = await context.decodeAudioData(await fetchBytes('banks/' + e.file));
        if (e.off >= buf.duration) throw new Error('invalid sample offset');
        const layers = map.get(e.key) ?? []; map.set(e.key, layers);
        (layers[e.layer] ??= [])[e.rr] = { buf, off: e.off, gain: e.gain, audible: true };
      } catch (error) { failed = error; }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  if (failed) throw failed;
  expressiveLoaded.set(id, map);
}

/** Velocity chooses an actual recording. Repeat selection belongs to each Mix. */
export function expressiveSample(id: string, key: number, vel = 0.8, turn = 0): { s: Sample; rate: number } | null {
  const map = expressiveLoaded.get(id);
  if (!map?.size) return null;
  let base = key;
  if (EXPRESSIVE[id].kind === 'instrument') {
    base = [...map.keys()].reduce((a, b) => Math.abs(b - key) < Math.abs(a - key) ? b : a);
  }
  const layers = map.get(base);
  if (!layers?.length) return null;
  const v = Number.isFinite(vel) ? Math.max(0, Math.min(1, vel)) : 0;
  const choices = layers[Math.min(layers.length - 1, Math.floor(v * layers.length))];
  const s = choices?.[Math.max(0, Math.floor(turn)) % choices.length];
  return s ? { s, rate: EXPRESSIVE[id].kind === 'instrument' ? Math.pow(2, (key - base) / 12) : 1 } : null;
}

async function load(id: string) {
  const dir = BANKS[id], keys = id === 'drums' ? PADS : NOTES, map = new Map<number, Sample>();
  await Promise.all(keys.map(async k => {
    const buf = await decoder!.decodeAudioData(await fetchBytes(`banks/${dir}/${k}.mp3`));
    // Le MP3 ajoute un court silence au début : on le repère pour que la note parte à l'instant voulu.
    const d = buf.getChannelData(0); let i = 0, pk = 0;
    for (let c = 0; c < buf.numberOfChannels; c++) { const ch = buf.getChannelData(c); for (let j = 0; j < ch.length; j++) pk = Math.max(pk, Math.abs(ch[j])); }
    const thr = Math.max(0.004, pk * 0.02);
    while (i < d.length && Math.abs(d[i]) < thr) i++;
    const off = Math.max(0, i - 32) / buf.sampleRate, audible = pk > 1e-5;
    const held = audible && SUSTAIN_BANKS.has(id) ? sustainSample(buf, k, off) ?? undefined : undefined;
    map.set(k, { buf, off, gain: pk, audible, held });
  }));
  // Les enregistrements d'origine sont à des niveaux très différents d'un instrument à l'autre,
  // et parfois d'une note à sa voisine : on égalise d'abord les registres, puis on ramène la note
  // la plus forte de la banque à pleine échelle.
  const level = id === 'drums' ? new Map<number, number>() : registerGains(map);
  const top = Math.max(1e-4, ...[...map.entries()].map(([k, x]) => x.gain * (level.get(k) ?? 1)));
  for (const [k, x] of map) x.gain = 0.9 * (level.get(k) ?? 1) / top;
  loaded.set(id, map);
}

/** Écart toléré entre le volume d'une note et la tendance de son instrument (dB). */
export const REGISTER_MAX_FIX = 9;
/**
 * Gain de mise à niveau par note. Le volume perçu de chaque enregistrement est comparé à la tendance
 * de l'instrument (droite de régression sur la hauteur) ; cette tendance est elle-même adoucie de moitié.
 * Résultat : plus de note qui saute par rapport à ses voisines, et des registres plus égaux, tout en
 * gardant le caractère de l'instrument (un grave plus rond, un aigu plus léger).
 */
export function registerGains(map: Map<number, Sample>): Map<number, number> {
  const pts = [...map.entries()].filter(([, x]) => x.audible).map(([k, x]) => [k, noteLoudness(x.buf, x.off)] as const).filter(([, l]) => Number.isFinite(l));
  const out = new Map<number, number>();
  if (pts.length < 3) return out;
  const n = pts.length, mx = pts.reduce((a, [k]) => a + k, 0) / n, my = pts.reduce((a, [, l]) => a + l, 0) / n;
  const slope = pts.reduce((a, [k, l]) => a + (k - mx) * (l - my), 0) / Math.max(1e-9, pts.reduce((a, [k]) => a + (k - mx) ** 2, 0));
  for (const [k, l] of pts) {
    const want = my + 0.5 * slope * (k - mx), fix = Math.max(-REGISTER_MAX_FIX, Math.min(REGISTER_MAX_FIX, want - l));
    out.set(k, Math.pow(10, fix / 20));
  }
  return out;
}

/** Charge une banque (une seule fois). Rejette si les fichiers sont inaccessibles. */
export function loadBank(id: string): Promise<void> {
  if ((!BANKS[id] && !EXPRESSIVE[id]) || !decoder) return Promise.reject(new Error('unknown bank'));
  if (bankReady(id)) return Promise.resolve();
  let p = pending.get(id);
  if (!p) { p = (EXPRESSIVE[id] ? loadExpressive(id) : load(id)).finally(() => pending.delete(id)); pending.set(id, p); }
  return p;
}

export function usedBanks(p: Project): string[] {
  const ids = new Set<string>();
  for (const t of p.tracks) {
    if (t.synth?.engine === 'multi' && t.synth.bank) ids.add(t.synth.bank);
    const bank = t.type === 'drums' ? drumBank(t.kit) : undefined;
    if (bank) ids.add(bank);
  }
  return [...ids].filter(id => BANKS[id] || EXPRESSIVE[id]);
}
/** Charge tout ce que le projet utilise ; renvoie les banques qui n'ont pas pu être chargées. */
export async function ensureBanks(p: Project): Promise<string[]> {
  const failed: string[] = [];
  await Promise.all(usedBanks(p).map(id => loadBank(id).catch(() => { failed.push(id); })));
  return failed;
}

/** Échantillon à jouer pour une note : le plus proche, et le rapport de vitesse qui donne la bonne hauteur. */
export function sampleFor(id: string, midi: number, vel = 0.8): { s: Sample; rate: number } | null {
  if (EXPRESSIVE[id]) return expressiveSample(id, midi, vel);
  const map = loaded.get(id);
  if (!map) return null;
  let base = Math.max(24, Math.min(96, 24 + Math.round((midi - 24) / 3) * 3));
  if (!map.get(base)?.audible) {
    const available = [...map.keys()].filter(k => map.get(k)!.audible);
    if (!available.length) return null;
    base = available.reduce((a, b) => Math.abs(b - midi) < Math.abs(a - midi) ? b : a);
  }
  const s = map.get(base);
  return s ? { s, rate: Math.pow(2, (midi - base) / 12) } : null;
}
export const drumSample = (row: number): Sample | undefined => loaded.get('drums')?.get(row);
