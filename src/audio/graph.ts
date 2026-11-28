/** Graphe de mixage : tranches (pistes et bus), effets, plugins, envois et général. Même code pour l'écoute et l'export. */
import { liveWams, wamKey } from './wam';
import { AuInstance, AuInstrument, auBridge, auFromNorm, createAuInstrument } from './au';
import { AT_CENTS, AT_GAIN, CTL_KINDS, CTL_REST, Clip, CtlKind, FX, MOD_CENTS, Project, Pt, Track, autoAt, ctlAt, durAt, fxFromNorm, setFromNorm, setKey, stepDur as sd } from '../types';
import { CtlNodes, djFreqs, REST_Q, SWEEP_Q, TrackNodes, crushCurve, driveCurve } from './mix-nodes';
import { autoKeysOf, MixChains } from './mix-chains';
export * from './mix-nodes';
export * from './mix-chains';

/** Graphe de mixage. Le même code sert au temps réel et au rendu hors-ligne (export). */
export class Mix extends MixChains {
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
  protected attachInst(n: TrackNodes, au: AuInstrument) {
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

// Voix et séquenceur rangés à part ; réexportés pour que les imports existants ne changent pas.
export * from './voices';
export * from './schedule';
