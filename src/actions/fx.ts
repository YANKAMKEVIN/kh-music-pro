// Chaîne d'effets, plugins (Audio Unit, web), bus, envois et conversion des tranches fixes.
import { liveWams, wamKey, wamUrl } from '../audio/wam';
import { t } from '../i18n';
import { commit, S } from '../store';
import { addStripFx, chainToStrip, STRIP_MAP, StripField, stripSet, stripToChain } from '../chain';
import { fxCount, isStripFx, MIX_PRESETS, newBus, newInsert, Track, uid } from '../types';
import { ask, confirmBox, toast } from '../ui/dom';

// ---------- Chaîne d'effets ----------
const strip = (id: string) => [...S.project.tracks, ...S.project.buses].find(x => x.id === id);
export function addInsert(trackId: string, type: string) {
  const tr = strip(trackId);
  if (!tr) return;
  // Étages de tranche (filtre, saturation…) : hors de la limite de huit, un de chaque au plus ; ils se placent dans l'ordre du son.
  if (isStripFx(type)) {
    if (tr.inserts.some(i => i.type === type)) return toast(t('fx.oneStrip', t('fxn.' + type)), 'error');
    addStripFx(tr, type); commit(); return;
  }
  if (fxCount(tr) >= 8) return toast(t('fx.max'), 'error');
  tr.inserts.push(newInsert(type)); commit();
}
export function removeInsert(trackId: string, id: string) {
  const tr = strip(trackId); if (!tr) return;
  tr.inserts = tr.inserts.filter(i => i.id !== id);
  // Ses courbes d'automation partent avec lui (Annuler les ramène).
  for (const k of Object.keys(tr.auto ?? {})) if (k.startsWith(`ins:${id}:`)) delete tr.auto![k];
  if (tr.autoShow?.startsWith(`ins:${id}:`)) tr.autoShow = 'vol';
  commit();
}
/** Déplace un effet à la place `to` de la chaîne (glisser-déposer). */
export function moveInsertTo(trackId: string, id: string, to: number) {
  const l = strip(trackId)?.inserts, i = l?.findIndex(x => x.id === id) ?? -1;
  if (!l || i < 0) return;
  const j = Math.max(0, Math.min(l.length - 1, to));
  if (i === j) return;
  const [x] = l.splice(i, 1); l.splice(j, 0, x); commit();
}
export function moveInsert(trackId: string, id: string, dir: -1 | 1) {
  const l = strip(trackId)?.inserts, i = l?.findIndex(x => x.id === id) ?? -1, j = i + dir;
  if (!l || i < 0 || j < 0 || j >= l.length) return;
  [l[i], l[j]] = [l[j], l[i]]; commit();
}
/** Ajoute un plugin Audio Unit du Mac (version bureau macOS) : `id` = « type:sous-type:fabricant » (« aufx:dely:appl »). */
export function addAu(trackId: string, id: string, name: string) {
  const tr = strip(trackId);
  if (!tr) return;
  if (fxCount(tr) >= 8) return toast(t('fx.max'), 'error');
  if (!/^\w{4}:[^:]{4}:[^:]{4}$/.test(id)) return;
  const ins = newInsert('au'); ins.url = id; ins.name = name;
  tr.inserts.push(ins); commit();
}
/** Origines dont les plugins web ont été acceptés par l'utilisateur. */
const trusted = (): string[] => { try { return JSON.parse(localStorage.getItem('kh-wam-trust') || '[]'); } catch { return []; } };
/**
 * Ajoute un plugin web. Un plugin est du code exécuté dans l'application : s'il vient d'un autre site,
 * l'utilisateur doit l'accepter explicitement (une fois par site).
 */
export async function addWam(trackId: string, url: string | null, name?: string) {
  if (!strip(trackId)) return;
  if (fxCount(strip(trackId)!) >= 8) return toast(t('fx.max'), 'error');
  const raw = url ?? (await ask(t('wam.ask'), 'https://', { mode: 'url' }))?.trim();
  if (!raw) return;
  let full: URL;
  try { full = new URL(wamUrl(raw)); } catch { return toast(t('wam.badUrl'), 'error'); }
  if (!/^(https?|file):$/.test(full.protocol)) return toast(t('wam.badUrl'), 'error');
  if (full.origin !== location.origin) {
    const list = trusted();
    if (!list.includes(full.origin)) {
      if (!await confirmBox(t('wam.trust', full.host), t('wam.accept'), { danger: true })) return;
      try { localStorage.setItem('kh-wam-trust', JSON.stringify([...list, full.origin])); } catch { /* stockage désactivé */ }
    }
  }
  // La question a pu rester ouverte un moment : la piste est relue (elle a pu être supprimée, ou remplie entre-temps).
  const tr = strip(trackId);
  if (!tr) return;
  if (fxCount(tr) >= 8) return toast(t('fx.max'), 'error');
  const ins = newInsert('wam'); ins.url = raw; ins.name = name ?? (full.pathname.split('/').filter(Boolean).slice(-2, -1)[0] || full.host);
  tr.inserts.push(ins); commit();
}
/** Recopie dans le projet les réglages internes des plugins web, pour qu'ils soient enregistrés avec lui. */
export async function saveWamStates() {
  let changed = false;
  for (const tr of [...S.project.tracks, ...S.project.buses]) for (const ins of tr.inserts) {
    const inst = ins.type === 'wam' ? liveWams.get(wamKey(tr.id, ins.id)) : undefined;
    if (!inst?.audioNode.getState) continue;
    try { const st = await inst.audioNode.getState(); if (JSON.stringify(st) !== JSON.stringify(ins.state)) { ins.state = st; changed = true; } } catch { /* plugin sans état */ }
  }
  if (changed) commit();
}
export function addBus() {
  const p = S.project, b = newBus(p.buses.length + 1);
  while (p.buses.some(x => x.name === b.name)) b.name += '′';
  p.buses.push(b); commit();
  return b;
}
export function deleteBus(id: string) {
  const p = S.project;
  p.buses = p.buses.filter(b => b.id !== id);
  for (const tr of p.tracks) { if (tr.out === id) tr.out = ''; if (tr.sends) tr.sends = tr.sends.filter(sd => sd.bus !== id); } // les pistes qui y sortaient reviennent au général ; leurs envois vers ce bus disparaissent
  commit();
}
/** Envoi libre (V19) : nouvel envoi de la piste vers le premier bus (créé s'il n'en existe aucun), après le volume. */
export function addSend(tr: Track) {
  let bus = S.project.buses[0];
  if (!bus) { bus = newBus(1); S.project.buses.push(bus); }
  (tr.sends ??= []).push({ id: uid(), bus: bus.id, amt: 0.5, pre: false }); commit();
}
export function removeSend(tr: Track, id: string) { tr.sends = (tr.sends ?? []).filter(sd => sd.id !== id); if (!tr.sends.length) delete tr.sends; commit(); }
export function applyMixPreset(tr: Track, key: string) {
  const p = MIX_PRESETS[key];
  if (!p) return;
  // Tranche en chaîne : les réglages de tranche du préréglage vont aux effets de la chaîne (créés au besoin) ; réverb et écho restent des envois.
  if (tr.strip === 'chaine') {
    for (const [k, v] of Object.entries(p)) if (k in STRIP_MAP) stripSet(tr, k as StripField, v as number | boolean, true); else (tr as unknown as Record<string, unknown>)[k] = v;
  } else Object.assign(tr, p);
  commit(); toast(t('toast.presetApplied', t('mp.' + key), tr.name));
}
// ---------- Chaînes d'effets qui remplacent la tranche fixe (21/11/2026) ----------
/** Convertit la tranche fixe d'une piste (ou d'un bus) en effets en tête de chaîne : même son, une seule entrée d'annulation. */
export function convertStrip(trackId: string) {
  const tr = strip(trackId);
  if (!tr || !stripToChain(tr)) return;
  commit(); toast(t('chain.done', tr.name));
}
/** Convertit toutes les tranches du projet (pistes et bus). */
export function convertAllStrips() {
  const n = [...S.project.tracks, ...S.project.buses].filter(tr => stripToChain(tr)).length;
  if (!n) return toast(t('chain.none'));
  commit(); toast(t('chain.doneAll', n));
}
/** Revient à la tranche fixe, quand la tête de chaîne le permet sans changer le son. */
export function revertStrip(trackId: string) {
  const tr = strip(trackId);
  if (!tr) return;
  if (!chainToStrip(tr)) return toast(t('chain.cantRevert'), 'error');
  commit(); toast(t('chain.reverted', tr.name));
}
