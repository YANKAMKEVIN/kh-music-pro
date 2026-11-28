// Cœur du moteur : contexte audio, mixage, transport (lecture, arrêt, programmation des pas) et mode Live.
// La classe Engine (engine.ts) l'étend avec le jeu en direct, l'enregistrement, l'entrée audio et les vumètres.
import { bankReady, ensureBanks, loadBank, setDecoder, usedBanks } from './banks';
import { Mix, scheduleLive, scheduleStep, swingT, Voice, warmWarp } from './graph';
import { buffers, S } from '../store';
import { NativeIO } from './native-io';
import { BAR, BEAT, contentEnd, durAt, liveQuant, Project, stepDur } from '../types';

/** Avance de programmation : les pas sont confiés au moteur audio jusqu'à 120 ms à l'avance. */
export const LOOKAHEAD = 0.12;
export type RecMode = 'normal' | 'loop' | 'punch';
export type RecDone = (buf: AudioBuffer | null, startStep: number, offsetSec: number, mode: RecMode) => void;

export class EngineCore {
  ctx = new AudioContext({ latencyHint: 'interactive' });
  mix = new Mix(this.ctx, true);
  playing = false;
  recording: false | 'audio' | 'midi' = false;
  recTrack = '';
  /** Enregistrement audio : normal, en boucle (une prise par tour) ou limité à la zone de boucle (punch). */
  recMode: RecMode = 'normal';
  mode: 'arr' | 'live' = 'arr';
  pos = 0;                 // tête de lecture de l'arrangement, à l'arrêt (en pas)
  /** Mode Live : clip actif et clip en attente par piste. */
  liveActive = new Map<string, { clipId: string; since: number }>();
  liveQueued = new Map<string, string | null>();
  /**
   * Mode Live (suite, 21/11/2026) : prise d'un clip à la volée sur une piste. `from` = pas de départ (null tant qu'elle attend
   * la mesure), `clipId` = clip vide créé au départ (onLiveRec), rempli par le jeu, puis lancé en boucle à la fin de la prise.
   */
  liveRec: { trackId: string; bars: number; from: number | null; clipId: string | null } | null = null;
  onLiveRec: (phase: 'start' | 'end' | 'cancel' | 'stop', r: { trackId: string; bars: number; from: number | null; clipId: string | null }) => string | null = () => null;
  onLive: () => void = () => { };
  onRecEnd: (kind: 'audio' | 'midi') => void = () => { };
  onStop: () => void = () => { };
  /** Appelé pour chaque pas programmé de l'arrangement (arpégiateur). */
  onStep: (s: number, t: number) => void = () => { };

  protected playFrom = 0;
  protected nextStep = 0;
  protected nextTime = 0;
  protected t0 = 0;
  /** Durée du décompte de la lecture en cours (0 = aucun) : ne sert qu'à l'afficher. */
  protected pre = 0;
  /** Décompte en cours : temps restants avant le départ (4 au premier clic, puis 3, 2, 1 ; valeur continue), 0 hors décompte. */
  countLeft(): number {
    if (!this.playing || this.pre <= 0) return 0;
    return Math.max(0, Math.min(4, (this.t0 - this.ctx.currentTime) / (this.pre / 4)));
  }
  /** Instant de départ de la lecture en cours : distingue une prise de la suivante. */
  get runStart() { return this.t0; }
  protected seg = true;
  protected marks: { t: number; s: number }[] = [];
  protected timer = 0;
  protected levels = new Map<string, number>();
  protected scratch = new Float32Array(2048);
  protected voices = new Map<string, Voice>();
  protected liveSrc = new Map<string, AudioBufferSourceNode[]>();
  protected workletReady?: Promise<void>;
  /** Touches tenues pendant le chargement de leur instrument (vidé à l'arrêt). */
  protected pendingOn = new Map<string, object>();
  /** Entrée audio ouverte (micro ou carte son) : gain, vumètre et écoute de contrôle. */
  inp?: { stream?: MediaStream; src: AudioNode; gain: GainNode; mon: GainNode; analyser: AnalyserNode; device: string };
  /** Moteur audio natif (version bureau macOS) : entrée et sortie de la carte son prises par Core Audio. */
  native?: NativeIO;
  /** Fin de chaîne : ce qui doit être entendu (le natif, ou la sortie de Web Audio). */
  get out(): AudioNode { return this.native?.sink ?? this.ctx.destination; }
  protected cap?: { temp: boolean; node: AudioWorkletNode; chunks: Float32Array[][]; first: number; startStep: number; done: RecDone; inLat: number; mode: RecMode };

  /** Signalé quand des sons d'instruments réels sont en cours de chargement, puis chargés ou en échec. */
  onBanks: (state: 'loading' | 'ready' | 'failed') => void = () => { };
  constructor() { setDecoder(this.ctx); }

  sync() { this.mix.sync(S.project); warmWarp(S.project, buffers); }
  /** Indicateur de charge (V17) : pas programmés et pas programmés en retard depuis le début de la lecture. */
  perf = { steps: 0, late: 0 };
  /** Décrochages du son signalés par le navigateur (Chromium récent : playoutStats / playbackStats), ou null si inconnus. */
  underruns(): number | null {
    const c = this.ctx as unknown as { playoutStats?: { underrunEvents?: number }; playbackStats?: { underrunEvents?: number } };
    const st = c.playbackStats ?? c.playoutStats;
    return typeof st?.underrunEvents === 'number' ? st.underrunEvents : null;
  }


  /** Charge les instruments réels utilisés par le projet (sans attendre) ; prévient l'interface. */
  async prepare(p: Project = S.project): Promise<boolean> {
    const need = usedBanks(p).filter(id => !bankReady(id));
    if (!need.length) return true;
    this.onBanks('loading');
    const failed = await ensureBanks(p);
    this.onBanks(failed.length ? 'failed' : 'ready');
    return !failed.length;
  }
  loadBank(id: string): Promise<boolean> { if (bankReady(id)) return Promise.resolve(true); this.onBanks('loading'); return loadBank(id).then(() => { this.onBanks('ready'); return true; }, () => { this.onBanks('failed'); return false; }); }

  // ---------- Transport ----------
  protected async start(preroll: number) {
    this.perf = { steps: 0, late: 0 };
    await this.ctx.resume();
    await this.prepare(); // les vrais instruments doivent être en mémoire avant le premier temps
    // Le bégaiement garde en mémoire les derniers instants joués : il doit écouter dès le début de la lecture.
    this.mix.initStutter().catch(() => { });
    this.mix.autoOn = this.mode === 'arr';
    this.sync();
    this.playing = true;
    this.t0 = this.nextTime = this.ctx.currentTime + 0.06 + preroll;
    this.pre = preroll;
    this.seg = true; this.marks = [];
    if (preroll > 0) { const n = Math.max(1, Math.round(BAR / BEAT)), beat = preroll / n; for (let i = 0; i < n; i++) this.click(this.t0 - preroll + i * beat, i === 0); }   // un clic par temps de la mesure (3 en 3/4, 2 en 6/8)
    this.timer = window.setInterval(() => this.tick(), 25);
    this.tick();
  }

  async play(preroll = 0) {
    if (this.playing) return;
    this.mode = 'arr'; this.playFrom = this.pos; this.nextStep = Math.floor(this.pos);
    this.mix.liveCtl = this.recording === 'midi' ? this.recTrack : '';
    await this.start(preroll);
  }

  /** Arrêt. À l'arrêt, un second appel ramène au début. */
  stop() {
    this.onStop();
    this.pendingOn.clear();
    for (const v of this.voices.values()) v.release(this.ctx.currentTime);
    this.voices.clear();
    if (!this.playing) { this.pos = 0; return; }
    this.playing = false; clearInterval(this.timer);
    this.mix.stopAll(); this.voices.clear(); this.mix.clearAuto(S.project);
    this.mix.liveCtl = '';
    if (this.mode === 'live') { const r = this.liveRec; this.liveRec = null; if (r?.clipId) this.onLiveRec('stop', r); this.liveActive.clear(); this.liveQueued.clear(); this.liveSrc.clear(); this.mode = 'arr'; this.onLive(); }
    else this.pos = this.playFrom;
    const kind = this.recording;
    if (kind) { this.recording = false; if (kind === 'audio') this.finishCapture(); this.onRecEnd(kind); }
  }

  toggle() { this.playing ? this.stop() : this.play(); }

  seek(step: number) {
    const was = this.playing && !this.recording && this.mode === 'arr';
    if (this.playing) this.stop();
    this.pos = Math.max(0, step);
    if (was) this.play();
  }

  currentStep(): number {
    if (!this.playing) return this.pos;
    const now = this.ctx.currentTime, m = this.marks;
    while (m.length > 1 && m[1].t <= now) m.shift();
    if (!m.length || now < m[0].t) return m.length ? m[0].s : (this.mode === 'live' ? 0 : this.pos);
    return m[0].s + Math.min(1, (now - m[0].t) / (this.mode === 'live' ? stepDur(S.project.bpm) : durAt(S.project, m[0].s)));
  }

  protected tick() {
    const p = S.project, dur = stepDur(p.bpm);
    if (this.mode === 'live') {
      while (this.nextTime < this.ctx.currentTime + LOOKAHEAD) {
        const s = this.nextStep, t = this.nextTime;
        // Prise à la volée : elle part sur une mesure (la piste se tait), et à sa fin le clip enregistré tourne en boucle.
        const r = this.liveRec;
        if (r && r.from === null && s % BAR === 0) {
          for (const src of this.liveSrc.get(r.trackId) ?? []) { try { src.stop(t); } catch { /* fini */ } }
          this.liveSrc.delete(r.trackId); this.liveActive.delete(r.trackId); this.liveQueued.delete(r.trackId);
          r.from = s; r.clipId = this.onLiveRec('start', r);
          if (!r.clipId) this.liveRec = null;
          setTimeout(() => this.onLive(), Math.max(0, (t - this.ctx.currentTime) * 1000));
        } else if (r && r.from !== null && r.clipId && s >= r.from + r.bars * BAR) {
          const id = r.clipId, from = r.from + r.bars * BAR;
          this.liveRec = null; this.liveQueued.delete(r.trackId);
          this.liveActive.set(r.trackId, { clipId: id, since: from });
          // Les dernières notes jouées arrivent encore pendant l'avance de programmation : le projet est enregistré à l'heure de la fin.
          setTimeout(() => { this.onLiveRec('end', r); this.onLive(); }, Math.max(0, (t - this.ctx.currentTime) * 1000) + 30);
        }
        if (s % liveQuant(p.liveQ) === 0 && this.liveQueued.size) {
          for (const [tid, cid] of this.liveQueued) {
            for (const src of this.liveSrc.get(tid) ?? []) { try { src.stop(t); } catch { /* fini */ } }
            this.liveSrc.delete(tid);
            if (cid) this.liveActive.set(tid, { clipId: cid, since: s }); else this.liveActive.delete(tid);
          }
          this.liveQueued.clear();
          setTimeout(() => this.onLive(), Math.max(0, (t - this.ctx.currentTime) * 1000));
        }
        scheduleLive(this.mix, p, buffers, s, swingT(p, s, t), this.liveActive, (tid, src) => {
          const l = this.liveSrc.get(tid) ?? []; l.push(src); this.liveSrc.set(tid, l.slice(-4));
        });
        if (p.metronome && s % BEAT === 0) this.click(t, s % BAR === 0);
        this.marks.push({ t, s }); this.nextStep++; this.nextTime += dur;
      }
      return;
    }
    const ls = p.loopStart * BAR, le = ls + p.loopLen * BAR;
    const looping = p.loop && (this.recording !== 'audio' || this.recMode === 'loop');
    // Punch : la prise s'arrête d'elle-même juste après la fin de la zone (deux pas de marge, pour ne pas perdre la toute fin
    // du son à cause du délai d'entrée de la carte son).
    if (this.recording === 'audio' && this.recMode === 'punch' && this.currentStep() >= le + 2) { this.stop(); return; }
    const end = Math.max(contentEnd(p), BAR);
    if (!this.recording && !(looping && this.nextStep <= le) && this.currentStep() >= end) { this.stop(); this.pos = 0; return; }
    while (this.nextTime < this.ctx.currentTime + LOOKAHEAD) {
      // Indicateur de charge (V17) : un pas programmé après son heure = l'interface a pris du retard (note jouée en retard).
      if (this.nextTime < this.ctx.currentTime) this.perf.late++;
      this.perf.steps++;
      if (looping && this.nextStep === le) { this.nextStep = ls; this.seg = true; }
      const limit = looping && this.nextStep < le ? le : null;
      this.mix.applyAuto(p, this.nextStep, this.nextTime); this.onStep(this.nextStep, this.nextTime);
      scheduleStep(this.mix, p, buffers, this.nextStep, swingT(p, this.nextStep, this.nextTime), this.seg, limit);
      if (p.metronome && this.nextStep % BEAT === 0) this.click(this.nextTime, this.nextStep % BAR === 0);
      this.marks.push({ t: this.nextTime, s: this.nextStep });
      this.nextTime += durAt(p, this.nextStep); this.nextStep++; this.seg = false; // le tempo peut changer d'un pas à l'autre
    }
  }

  protected click(t: number, accent: boolean) {
    const o = this.mix.reg(this.ctx.createOscillator()), g = this.ctx.createGain();
    o.frequency.value = accent ? 1600 : 1000;
    g.gain.setValueAtTime(0.25, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
    o.connect(g).connect(this.out); o.start(t); o.stop(t + 0.05);
  }

  // ---------- Mode Live ----------
  /** Lance (ou arrête, avec `null`) un clip sur sa piste à la prochaine mesure. */
  async launch(trackId: string, clipId: string | null) {
    if (this.playing && this.mode === 'arr') this.stop();
    if (!this.playing) {
      if (!clipId) return;
      this.mode = 'live'; this.nextStep = 0;
      this.liveQueued.set(trackId, clipId);
      await this.start(0);
    } else this.liveQueued.set(trackId, clipId);
    this.onLive();
  }

  /** Mode Live : enregistre un clip de `bars` mesures sur la piste, à partir de la prochaine mesure ; un second appel abandonne la prise. */
  async recordLive(trackId: string, bars: number) {
    if (this.playing && this.mode === 'arr') this.stop();
    const cur = this.liveRec;
    if (cur) { this.liveRec = null; if (cur.clipId) this.onLiveRec('cancel', cur); if (cur.trackId === trackId) { this.onLive(); return; } }
    this.liveRec = { trackId, bars: Math.max(1, Math.round(bars)), from: null, clipId: null };
    if (!this.playing) { this.mode = 'live'; this.nextStep = 0; await this.start(0); }
    this.onLive();
  }
  /** Position (en pas, dans le clip) d'une note jouée maintenant sur la piste, si une prise à la volée y est en cours. */
  liveRecPos(trackId: string): { clipId: string; local: number } | null {
    const r = this.liveRec;
    if (!r || r.trackId !== trackId || r.from === null || !r.clipId || !this.playing || this.mode !== 'live') return null;
    const local = this.currentStep() - r.from;
    // Une note jouée jusqu'à une double-croche avant le départ compte pour le premier temps (on joue souvent un peu en avance).
    return local >= -1 && local < r.bars * BAR ? { clipId: r.clipId, local: Math.max(0, local) } : null;
  }

  async launchScene(i: number) {
    const p = S.project;
    const picks = p.tracks.map(tr => [tr.id, [...tr.clips].sort((a, b) => a.start - b.start)[i]?.id ?? null] as const);
    if (!picks.some(([, c]) => c)) return;
    if (this.playing && this.mode === 'arr') this.stop();
    for (const [tid, cid] of picks) if (cid || this.liveActive.has(tid)) this.liveQueued.set(tid, cid);
    if (!this.playing) { this.mode = 'live'; this.nextStep = 0; await this.start(0); }
    this.onLive();
  }

  /** Fin d'une prise audio, à l'arrêt du transport : complétée par Engine. */
  protected finishCapture(): void { /* rien à finir sans entrée audio */ }
}
