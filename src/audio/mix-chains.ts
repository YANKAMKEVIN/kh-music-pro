/** Graphe de mixage, deuxième couche : chaînes d'effets des tranches, plugins et compensation de leur latence. */
import { WamInstance, liveWams, wamKey } from './wam';
import { AuInstance, AuInstrument, auBridge, createAuInstrument } from './au';
import { Project, Track, fxAutomatable, parseInsKey } from '../types';
import { createPlugin, InsNode, isPlugin, liveInstOf, MixNodes, TrackNodes } from './mix-nodes';

export abstract class MixChains extends MixNodes {
  /** Branche un instrument du Mac prêt sur la tranche (défini par Mix). */
  protected abstract attachInst(n: TrackNodes, au: AuInstrument): void;

  /** Branche un plugin web chargé à la place du passage direct. */
  protected attachWam(node: InsNode, inst: WamInstance) {
    node.wam = inst;
    try { node.in.disconnect(node.out); } catch { /* déjà débranché */ }
    node.in.connect(inst.audioNode); inst.audioNode.connect(node.out);
  }

  /** Met la chaîne d'effets d'une tranche en accord avec le projet : ordre, effets actifs, réglages. */
  protected syncInserts(t: Track, n: TrackNodes, p: Project) {
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
  protected lastProject?: Project;
  /** Retard ajouté à tout le mixage par la compensation (latence du chemin le plus long), en secondes. */
  pdcMax = 0;
  /** Latence déclarée par les plugins actifs d'une tranche (plugins du Mac ; les plugins web n'en déclarent pas). */
  protected stripLatency(t: Track, n: TrackNodes): number {
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
  protected compensate(p: Project) {
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
}

/** Réglages automatisés d'un effet de la piste (clés de réglage, ou adresses d'Audio Unit). */
export function autoKeysOf(tr: Track, insId: string): Set<string> {
  const out = new Set<string>(), ins = tr.inserts?.find(i => i.id === insId);
  for (const [key, pts] of Object.entries(tr.auto ?? {})) {
    const k = parseInsKey(key);
    if (k && k.id === insId && pts?.length && ins && (ins.type === 'au' || fxAutomatable(ins.type, k.k))) out.add(k.k);
  }
  return out;
}
