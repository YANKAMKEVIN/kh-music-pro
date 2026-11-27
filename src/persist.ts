/**
 * Lecture sûre des projets enregistrés : sauvegarde automatique du navigateur, versions, fichiers .khm.
 *
 * Chaque projet porte un numéro de schéma (`schema`). À la lecture :
 *  1. le texte est relu (JSON illisible → erreur « corrupt ») ;
 *  2. la forme générale est vérifiée (pas un projet → « invalid » ; schéma plus récent que l'application → « newer ») ;
 *  3. les étapes de migration s'appliquent une à une, du schéma du projet jusqu'au schéma courant ;
 *  4. les éléments abîmés sont écartés sans perdre le reste (une piste sans liste de clips, une note sans hauteur…) ;
 *  5. `migrate` complète les champs ajoutés au fil des versions (valeurs par défaut).
 * Rien ici ne touche au stockage : les fonctions sont pures et testées (tests/unit/persist.test.ts).
 */
import { PROJECT_SCHEMA, migrate, type Project } from './types';

/** Schéma courant des projets (défini avec le modèle). 0 = projet enregistré avant la numérotation (jusqu'à la 0.19.4). */
export { PROJECT_SCHEMA };
/** Fichier projet (.khm) : identifiant et version de l'enveloppe (projet + sons). */
export const FILE_FORMAT = 'kh-music-pro';
export const FILE_VERSION = 1;

export type ProjectErrorCode = 'corrupt' | 'invalid' | 'newer';
/** Projet impossible à relire : texte abîmé, pas un projet, ou projet créé par une version plus récente. */
export class ProjectError extends Error {
  constructor(readonly code: ProjectErrorCode) { super(code); this.name = 'ProjectError'; }
}

type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const TRACK_TYPES = new Set(['drums', 'synth', 'audio']);

/**
 * Étapes de migration : `STEPS[n]` fait passer un projet du schéma n au schéma n + 1.
 * L'étape 0 → 1 ne change pas la structure : `migrate` (appelé ensuite pour tous) complète déjà les anciens projets.
 * Une évolution future du format ajoute ici son étape et incrémente PROJECT_SCHEMA.
 */
const STEPS: Record<number, (p: Raw) => void> = {
  0: () => { /* numérotation des schémas : rien à transformer */ },
};

/** Écarte ce qui est abîmé dans un clip ; renvoie faux si le clip est inutilisable. */
function cleanClip(c: unknown): boolean {
  if (!isObj(c) || !finite(c.start) || !finite(c.len) || c.len <= 0) return false;
  if (typeof c.id !== 'string') return false;
  if (typeof c.name !== 'string') c.name = '';
  if (!finite(c.offset)) c.offset = 0;
  if (c.notes !== undefined) c.notes = Array.isArray(c.notes) ? c.notes.filter(n => isObj(n) && finite(n.p) && finite(n.s) && finite(n.l) && finite(n.v)) : [];
  if (c.drums !== undefined && !(Array.isArray(c.drums) && c.drums.every(Array.isArray))) delete c.drums;
  return true;
}

/** Écarte ce qui est abîmé dans une piste ; renvoie faux si la piste est inutilisable. */
function cleanTrack(t: unknown): boolean {
  if (!isObj(t) || typeof t.id !== 'string' || !TRACK_TYPES.has(t.type as string)) return false;
  if (typeof t.name !== 'string') t.name = '';
  t.clips = Array.isArray(t.clips) ? t.clips.filter(cleanClip) : [];
  if (!Array.isArray(t.inserts)) t.inserts = [];
  else t.inserts = t.inserts.filter(i => isObj(i) && typeof i.id === 'string' && typeof i.type === 'string' && isObj(i.p));
  if (t.type === 'synth' && !isObj(t.synth)) t.synth = { preset: 'lead' };
  return true;
}

/** Vérifie, migre et complète un projet déjà relu depuis le JSON. */
export function upgradeProject(raw: unknown): Project {
  if (!isObj(raw) || !Array.isArray(raw.tracks)) throw new ProjectError('invalid');
  const from = raw.schema === undefined ? 0 : raw.schema;
  if (!finite(from) || from < 0 || !Number.isInteger(from)) throw new ProjectError('invalid');
  if (from > PROJECT_SCHEMA) throw new ProjectError('newer');
  for (let v = from; v < PROJECT_SCHEMA; v++) STEPS[v]?.(raw);
  if (typeof raw.name !== 'string') raw.name = '';
  if (!finite(raw.bpm) || raw.bpm <= 0) raw.bpm = 120;
  raw.tracks = raw.tracks.filter(cleanTrack);
  if (raw.buses !== undefined) raw.buses = Array.isArray(raw.buses) ? raw.buses.filter(cleanTrack) : [];
  if (raw.tempos !== undefined) raw.tempos = Array.isArray(raw.tempos) ? raw.tempos.filter(m => isObj(m) && finite(m.s) && finite(m.bpm) && m.bpm > 0) : [];
  if (raw.markers !== undefined && !Array.isArray(raw.markers)) raw.markers = [];
  const p = migrate(raw as unknown as Project);
  p.schema = PROJECT_SCHEMA;
  return p;
}

/** Relit un projet enregistré (texte JSON). Lève une ProjectError s'il est illisible. */
export function parseProject(json: string | null | undefined): Project {
  if (typeof json !== 'string' || !json) throw new ProjectError('corrupt');
  let raw: unknown;
  try { raw = JSON.parse(json); } catch { throw new ProjectError('corrupt'); }
  return upgradeProject(raw);
}

/** Son d'un fichier .khm : fréquence et canaux encodés en base64 (Float32). */
export interface FileBuffer { sr: number; ch: string[] }

/** Relit un fichier projet .khm : projet migré et sons encodés (les sons abîmés sont écartés). */
export function parseProjectFile(text: string): { project: Project; buffers: Record<string, FileBuffer> } {
  let data: unknown;
  try { data = JSON.parse(text); } catch { throw new ProjectError('corrupt'); }
  if (!isObj(data) || data.format !== FILE_FORMAT) throw new ProjectError('invalid');
  if (finite(data.version) && data.version > FILE_VERSION) throw new ProjectError('newer');
  const project = upgradeProject(data.project);
  const buffers: Record<string, FileBuffer> = {};
  if (isObj(data.buffers)) for (const [id, b] of Object.entries(data.buffers)) {
    if (isObj(b) && finite(b.sr) && b.sr > 0 && Array.isArray(b.ch) && b.ch.length && b.ch.every(c => typeof c === 'string')) buffers[id] = { sr: b.sr, ch: b.ch as string[] };
  }
  return { project, buffers };
}

/** Enveloppe d'un fichier .khm (le projet est enregistré avec son numéro de schéma). */
export function fileEnvelope(project: Project, buffers: Record<string, FileBuffer>): string {
  return JSON.stringify({ format: FILE_FORMAT, version: FILE_VERSION, project: { ...project, schema: PROJECT_SCHEMA }, buffers });
}
