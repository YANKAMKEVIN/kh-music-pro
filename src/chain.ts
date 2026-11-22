/**
 * Chaînes d'effets qui remplacent la tranche fixe (21/11/2026).
 *
 * Une tranche (piste ou bus) est soit « fixe » (comme avant : filtre, saturation, lo-fi, chorus, trémolo, égaliseur,
 * compresseur câblés dans cet ordre, puis la chaîne d'effets ajoutés), soit « chaîne » : la tranche fixe est débranchée
 * et ces sept étages deviennent des effets de la chaîne, que l'on peut retirer, réordonner, automatiser.
 *
 * La conversion recopie les réglages et les courbes de la tranche fixe dans des effets placés en tête de chaîne, dans
 * l'ordre du son : le rendu est le même, à l'échantillon près (cas de QA CE01). Le retour à la tranche fixe est possible
 * tant que la tête de chaîne garde cette forme (un effet de chaque étage au plus, dans l'ordre, sans effet ordinaire au milieu).
 */
import { FX, Insert, Pt, STRIP_FX, StripFx, Track, insKey, isStripFx, newInsert, parseInsKey, setKey } from './types';

/** Valeurs neutres des réglages de la tranche fixe (une tranche convertie les remet à ces valeurs, inutilisées). */
const NEUTRAL = { filter: 0, drive: 0, crush: 0, chorus: 0, trem: 0, eqLow: 0, eqMid: 0, eqHigh: 0, eqMidF: 1000, comp: false, compThr: -24, compRatio: 4 };

/** Réglage de la tranche fixe → effet de la chaîne et son réglage (`on` : l'effet est allumé). */
export const STRIP_MAP = {
  filter: ['filter', 'v'], drive: ['drive', 'amt'], crush: ['lofi', 'amt'], chorus: ['chorus', 'mix'], trem: ['trem', 'depth'],
  eqLow: ['eq3', 'low'], eqMid: ['eq3', 'mid'], eqMidF: ['eq3', 'freq'], eqHigh: ['eq3', 'high'],
  comp: ['comp', 'on'], compThr: ['comp', 'thr'], compRatio: ['comp', 'ratio'],
} as const satisfies Record<keyof typeof NEUTRAL, readonly [StripFx, string]>;
export type StripField = keyof typeof STRIP_MAP;

/** Courbes de la tranche fixe renommées par la conversion : clé de la piste → [effet, réglage, conversion de la valeur]. */
const CURVES: [string, StripFx, string, (v: number) => number, (v: number) => number][] = [
  // Le filtre de piste se dessine de -1 à 1 ; un réglage d'effet de 0 à 1 sur sa plage (ici aussi -1 à 1).
  ['filter', 'filter', 'v', v => (v + 1) / 2, v => v * 2 - 1],
  ['chorus', 'chorus', 'mix', v => v, v => v],
  [setKey('eqLow'), 'eq3', 'low', v => v, v => v], [setKey('eqMid'), 'eq3', 'mid', v => v, v => v], [setKey('eqHigh'), 'eq3', 'high', v => v, v => v],
  [setKey('compThr'), 'comp', 'thr', v => v, v => v],
  // Suite 3 : mêmes plages des deux côtés, la courbe passe telle quelle.
  [setKey('eqMidF'), 'eq3', 'freq', v => v, v => v], [setKey('compRatio'), 'comp', 'ratio', v => v, v => v],
];

const mapPts = (pts: Pt[], f: (v: number) => number) => pts.map(p => ({ s: p.s, v: f(p.v) }));
const has = (tr: Track, k: string) => !!tr.auto?.[k]?.length;

/** Premier effet d'un étage dans la chaîne (celui que pilotent le mixeur et l'assignation MIDI). */
export const stripIns = (tr: Track, type: StripFx): Insert | undefined => tr.inserts.find(i => i.type === type);

/**
 * Convertit la tranche fixe en effets en tête de chaîne. Seuls les étages qui changent le son (ou qui ont une courbe)
 * deviennent des effets ; le filtre, toujours traversé dans la tranche fixe (même au repos, il coupe l'extrême aigu
 * avec une pente douce), est toujours repris pour que le son ne change pas. Renvoie faux si la tranche est déjà une chaîne.
 */
export function stripToChain(tr: Track): boolean {
  if (tr.strip === 'chaine') return false;
  const mk = (type: StripFx, p: Record<string, number>) => { const i = newInsert(type); Object.assign(i.p, p); return i; };
  const head: Insert[] = [mk('filter', { v: tr.filter })];
  if (tr.drive > 0) head.push(mk('drive', { amt: tr.drive }));
  if (tr.crush > 0) head.push(mk('lofi', { amt: tr.crush }));
  if (tr.chorus > 0 || has(tr, 'chorus')) head.push(mk('chorus', { mix: tr.chorus }));
  if (tr.trem > 0) head.push(mk('trem', { depth: tr.trem }));
  if (tr.eqLow || tr.eqMid || tr.eqHigh || ['eqLow', 'eqMid', 'eqMidF', 'eqHigh'].some(k => has(tr, setKey(k)))) head.push(mk('eq3', { low: tr.eqLow, mid: tr.eqMid, freq: tr.eqMidF, high: tr.eqHigh }));
  // Compresseur éteint mais réglé ou automatisé : il devient un effet éteint (rien n'est perdu, le son ne change pas).
  if (tr.comp || has(tr, setKey('compThr')) || has(tr, setKey('compRatio')) || tr.compThr !== NEUTRAL.compThr || tr.compRatio !== NEUTRAL.compRatio) { const c = mk('comp', { thr: tr.compThr, ratio: tr.compRatio }); c.on = tr.comp; head.push(c); }
  const auto = tr.auto;
  for (const [key, type, k, to] of CURVES) {
    const pts = auto?.[key]; if (!pts) continue;
    const ins = head.find(i => i.type === type);
    delete auto![key];
    if (ins && pts.length) auto![insKey(ins.id, k)] = mapPts(pts, to);
    if (tr.autoShow === key) tr.autoShow = ins ? insKey(ins.id, k) : 'vol';
  }
  tr.inserts = [...head, ...tr.inserts];
  Object.assign(tr, NEUTRAL);
  tr.strip = 'chaine';
  return true;
}

/**
 * Peut-on revenir à la tranche fixe sans changer le son ? Il faut que les étages soient en tête de chaîne, un de chaque
 * au plus, dans l'ordre du son, allumés (sauf le compresseur, qui a son interrupteur dans la tranche), et que leurs courbes
 * existent aussi dans la tranche fixe (pas de courbe sur la fréquence du médium, le trémolo ou le taux du compresseur).
 */
export function canRevert(tr: Track): boolean {
  if (tr.strip !== 'chaine') return false;
  let last = -1, inHead = true;
  for (const i of tr.inserts) {
    if (!isStripFx(i.type)) { inHead = false; continue; }
    const at = STRIP_FX.indexOf(i.type);
    if (!inHead || at <= last || (!i.on && i.type !== 'comp')) return false;
    last = at;
  }
  const ok = new Set(CURVES.map(([, type, k]) => type + ':' + k));
  for (const [key, pts] of Object.entries(tr.auto ?? {})) {
    const pk = parseInsKey(key), ins = pk && pts?.length ? tr.inserts.find(i => i.id === pk.id) : undefined;
    if (ins && isStripFx(ins.type) && !ok.has(ins.type + ':' + pk!.k)) return false;
  }
  return true;
}

/** Revient à la tranche fixe (voir canRevert). Un étage absent reprend sa valeur neutre. Renvoie faux si c'est impossible. */
export function chainToStrip(tr: Track): boolean {
  if (!canRevert(tr)) return false;
  const head = tr.inserts.filter(i => isStripFx(i.type));
  const fields: Record<string, number | boolean> = { ...NEUTRAL };
  for (const [field, [type, k]] of Object.entries(STRIP_MAP)) {
    const ins = head.find(i => i.type === type);
    if (ins) fields[field] = k === 'on' ? ins.on : ins.p[k];
  }
  const auto = tr.auto;
  for (const [key, type, k, , back] of CURVES) {
    const ins = head.find(i => i.type === type), ik = ins && insKey(ins.id, k), pts = ik ? auto?.[ik] : undefined;
    if (!ik || !auto) continue;
    if (pts?.length) auto[key] = mapPts(pts, back);
    delete auto[ik];
    if (tr.autoShow === ik) tr.autoShow = key;
  }
  for (const ins of head) if (tr.autoShow?.startsWith(`ins:${ins.id}:`)) tr.autoShow = 'vol';
  Object.assign(tr, fields);
  tr.inserts = tr.inserts.filter(i => !isStripFx(i.type));
  tr.strip = 'fixe';
  return true;
}

// ---------- Réglages de tranche lus et écrits quel que soit le mode (mixeur, assignation MIDI, préréglages) ----------

/** Valeur d'un réglage de tranche : le champ de la piste (tranche fixe) ou le réglage de l'effet (chaîne ; undefined s'il n'y en a pas). */
export function stripGet(tr: Track, field: StripField): number | boolean | undefined {
  if (tr.strip !== 'chaine') return tr[field];
  const [type, k] = STRIP_MAP[field], ins = stripIns(tr, type);
  return ins ? (k === 'on' ? ins.on : ins.p[k]) : undefined;
}

/** Place un nouvel étage dans la chaîne : après les étages qui le précèdent dans l'ordre du son, avant ceux qui le suivent. */
export function addStripFx(tr: Track, type: StripFx): Insert {
  const ins = newInsert(type), rank = STRIP_FX.indexOf(type);
  let at = tr.inserts.findIndex(i => !isStripFx(i.type) || STRIP_FX.indexOf(i.type) > rank);
  if (at < 0) at = tr.inserts.length;
  tr.inserts.splice(at, 0, ins);
  return ins;
}

/**
 * Écrit un réglage de tranche. En mode chaîne, l'effet correspondant est réglé ; s'il n'existe pas, il est créé quand
 * `create` est vrai et que la valeur n'est pas neutre (préréglages de mixage), sinon rien ne change. Renvoie vrai si écrit.
 */
export function stripSet(tr: Track, field: StripField, v: number | boolean, create = false): boolean {
  if (tr.strip !== 'chaine') { (tr as unknown as Record<string, number | boolean>)[field] = v; return true; }
  const [type, k] = STRIP_MAP[field];
  let ins = stripIns(tr, type);
  if (!ins) {
    if (!create || v === NEUTRAL[field] || (k === 'on' && !v)) return false;
    ins = addStripFx(tr, type);
    if (type === 'drive' || type === 'lofi' || type === 'chorus' || type === 'trem') ins.p[FX[type][0][0]] = 0;
  }
  if (k === 'on') ins.on = !!v; else ins.p[k] = v as number;
  return true;
}
