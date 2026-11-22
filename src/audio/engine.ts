import { ensureBanks, loadBank, setDecoder, usedBanks, bankReady, drumBank } from './banks';
import { gainLimit, lufs, peakOf } from './loudness';
import { detectPitch } from './pitch';
import { Mix, Voice, hitPad, playNote, scheduleLive, scheduleStep, setLiveInstOf, swingT, warmWarp } from './graph';
import { S, buffers } from '../store';
import { IoOptions, NativeIO, nativeName } from './native-io';
import { BAR, BEAT, CtlKind, liveQuant, Project, SynthParams, Track, contentEnd, durAt, stepDur, timeOf } from '../types';

const LOOKAHEAD = 0.12;
const WORKLET = `class KhRec extends AudioWorkletProcessor{process(i){const c=i[0];if(c&&c[0])this.port.postMessage({f:currentFrame,ch:c.map(x=>x.slice())});return true}}registerProcessor('kh-rec',KhRec)`;

export type RecMode = 'normal' | 'loop' | 'punch';
export type RecDone = (buf: AudioBuffer | null, startStep: number, offsetSec: number, mode: RecMode) => void;

class Engine {
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

  private playFrom = 0;
  private nextStep = 0;
  private nextTime = 0;
  private t0 = 0;
  /** Durée du décompte de la lecture en cours (0 = aucun) : ne sert qu'à l'afficher. */
  private pre = 0;
  /** Décompte en cours : temps restants avant le départ (4 au premier clic, puis 3, 2, 1 ; valeur continue), 0 hors décompte. */
  countLeft(): number {
    if (!this.playing || this.pre <= 0) return 0;
    return Math.max(0, Math.min(4, (this.t0 - this.ctx.currentTime) / (this.pre / 4)));
  }
  /** Instant de départ de la lecture en cours : distingue une prise de la suivante. */
  get runStart() { return this.t0; }
  private seg = true;
  private marks: { t: number; s: number }[] = [];
  private timer = 0;
  private levels = new Map<string, number>();
  private scratch = new Float32Array(2048);
  private voices = new Map<string, Voice>();
  private liveSrc = new Map<string, AudioBufferSourceNode[]>();
  private workletReady?: Promise<void>;
  /** Entrée audio ouverte (micro ou carte son) : gain, vumètre et écoute de contrôle. */
  inp?: { stream?: MediaStream; src: AudioNode; gain: GainNode; mon: GainNode; analyser: AnalyserNode; device: string };
  /** Moteur audio natif (version bureau macOS) : entrée et sortie de la carte son prises par Core Audio. */
  native?: NativeIO;
  /** Fin de chaîne : ce qui doit être entendu (le natif, ou la sortie de Web Audio). */
  get out(): AudioNode { return this.native?.sink ?? this.ctx.destination; }
  private cap?: { temp: boolean; node: AudioWorkletNode; chunks: Float32Array[][]; first: number; startStep: number; done: RecDone; inLat: number; mode: RecMode };

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

  /** Confie l'entrée et la sortie de la carte son au natif : Web Audio ne fait plus que le mixage. */
  async useNative(opts: IoOptions = {}): Promise<NativeIO> {
    if (this.native) { await this.native.configure(opts); return this.native; }
    const io = await NativeIO.start(this.ctx, opts);
    this.mix.limiter.disconnect(this.ctx.destination);
    this.mix.limiter.connect(io.sink);
    this.native = io;
    if (this.inp) { const d = this.inp.device; this.closeInput(); await this.openInput(d); }
    return io;
  }
  /** Rend l'entrée et la sortie au navigateur (réglage « moteur audio natif » désactivé, ou échec du natif). */
  async stopNative(): Promise<void> {
    const io = this.native;
    if (!io) return;
    const d = this.inp?.device;
    if (this.inp) this.closeInput();
    try { io.stop(); } catch { /* natif déjà arrêté */ }
    try { this.mix.limiter.disconnect(io.sink); } catch { /* déjà débranché */ }
    this.mix.limiter.connect(this.ctx.destination);
    this.native = undefined;
    await this.setOutput(S.outputDevice);
    if (d !== undefined) await this.openInput(d).catch(() => undefined);
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
  private async start(preroll: number) {
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

  private tick() {
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

  private click(t: number, accent: boolean) {
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

  // ---------- Jeu en direct ----------
  noteOn(track: Track, midi: number, vel = 0.8) {
    this.ctx.resume(); this.sync();
    const key = track.id + ':' + midi;
    // Instrument pas encore chargé : la touche reste en attente et sonne dès la fin du chargement, si elle est toujours tenue.
    if (track.synth?.engine === 'multi' && track.synth.bank && !bankReady(track.synth.bank)) {
      const bank = track.synth.bank, token = {};
      this.pendingOn.set(key, token);
      this.loadBank(bank).then(ok => {
        if (this.pendingOn.get(key) !== token) return;
        this.pendingOn.delete(key);
        if (ok && track.synth?.bank === bank && S.project.tracks.includes(track)) this.noteOn(track, midi, vel);
      });
      return;
    }
    this.pendingOn.delete(key);
    const n = this.mix.tracks.get(track.id);
    if (!n || !track.synth) return;
    this.voices.get(key)?.release(this.ctx.currentTime);
    const v = playNote(this.mix, n.input, track.synth, midi, this.ctx.currentTime + 0.003, null, vel, buffers);
    if (v) this.voices.set(key, v);
  }
  /** Contrôles joués en direct (V19) : dernière valeur reçue par piste (pitch bend, modulation, aftertouch). */
  ctlNow = new Map<string, Partial<Record<CtlKind, number>>>();
  ctl(track: Track, k: CtlKind, v: number) {
    if (track.type !== 'synth') return;
    this.ctx.resume();
    if (!this.mix.tracks.get(track.id)?.ctl) this.sync();
    this.mix.ctlLive(track.id, k, v);
    this.ctlNow.set(track.id, { ...this.ctlNow.get(track.id), [k]: v });
  }
  /** Touches tenues pendant le chargement de leur instrument. */
  private pendingOn = new Map<string, object>();
  noteOff(track: Track, midi: number) {
    const key = track.id + ':' + midi;
    this.pendingOn.delete(key);
    this.voices.get(key)?.release(this.ctx.currentTime); this.voices.delete(key);
  }
  previewNote(track: Track, midi: number, dur = 0.25) {
    this.ctx.resume(); this.sync();
    const n = this.mix.tracks.get(track.id);
    if (n && track.synth) playNote(this.mix, n.input, track.synth, midi, this.ctx.currentTime + 0.005, dur, 0.8, buffers);
  }
  private auditionToken = 0;
  private auditionGain?: GainNode;
  private auditionVoice?: Voice;
  private auditionTimer = 0;
  /** Préécoute indépendante de la piste : ne change ni le projet ni le transport. */
  async audition(sp: SynthParams, midi = 60): Promise<boolean> {
    this.stopAudition(); const token = this.auditionToken;
    await this.ctx.resume();
    if (sp.engine === 'multi' && sp.bank && !await this.loadBank(sp.bank)) return false;
    if (token !== this.auditionToken) return false;
    this.sync();
    const gain = this.ctx.createGain(); gain.gain.value = 0.65; gain.connect(this.mix.master);
    const voice = playNote(this.mix, gain, sp, midi, this.ctx.currentTime + 0.005, null, 0.8, buffers);
    if (!voice) { gain.disconnect(); return false; }
    this.auditionGain = gain; this.auditionVoice = voice;
    this.auditionTimer = window.setTimeout(() => this.stopAudition(), 1200);
    return true;
  }
  stopAudition() {
    this.auditionToken++; clearTimeout(this.auditionTimer);
    const gain = this.auditionGain; this.auditionGain = undefined;
    if (gain) {
      const now = this.ctx.currentTime; gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now); gain.gain.linearRampToValueAtTime(0, now + 0.02);
      this.auditionVoice?.release(now); window.setTimeout(() => gain.disconnect(), 60);
    }
    this.auditionVoice = undefined;
  }
  /** Note programmée à un instant précis (arpégiateur). */
  playAt(track: Track, midi: number, t: number, dur: number, vel = 0.8) {
    const n = this.mix.tracks.get(track.id);
    if (n && track.synth) playNote(this.mix, n.input, track.synth, midi, Math.max(t, this.ctx.currentTime), dur, vel, buffers);
  }
  /** Prochain pas que le séquenceur va programmer, et son instant (lecture de l'arrangement uniquement). */
  grid(): { s: number; t: number } | null {
    if (!this.playing || this.mode !== 'arr') return null;
    const p = S.project, le = (p.loopStart + p.loopLen) * BAR;
    return { s: p.loop && (this.recording !== 'audio' || this.recMode === 'loop') && this.nextStep === le ? p.loopStart * BAR : this.nextStep, t: this.nextTime };
  }
  /** Pad programmé à un instant précis (répétition de notes). */
  padAt(track: Track, row: number, t: number, vel = 1) {
    const n = this.mix.tracks.get(track.id);
    if (n) hitPad(this.mix, buffers, track, n.input, row, Math.max(t, this.ctx.currentTime), vel);
  }
  pad(track: Track, row: number, vel = 1) {
    this.ctx.resume(); this.sync();
    const bank = drumBank(track.kit);
    if (bank && !bankReady(bank)) { this.loadBank(bank); if (bank !== 'drums') return; }
    const n = this.mix.tracks.get(track.id);
    if (n) hitPad(this.mix, buffers, track, n.input, row, this.ctx.currentTime + 0.003, vel);
  }

  // ---------- Enregistrement ----------
  /** Enregistre ce qui est joué (notes, pads) : l'écriture dans le clip est faite par le module d'entrée. */
  async recordMidi(trackId: string, preroll: number) {
    if (this.playing) this.stop();
    this.recording = 'midi'; this.recTrack = trackId;
    await this.play(preroll);
  }

  /** Ouvre l'entrée audio choisie (ou celle par défaut) et la garde ouverte : vumètre, gain, écoute. */
  async openInput(device = ''): Promise<void> {
    if (this.inp && this.inp.device === device) return;
    const gainVal = this.inp?.gain.gain.value ?? S.inputGain, monVal = this.inp?.mon.gain.value ?? 0;
    this.closeInput();
    let stream: MediaStream | undefined, src: AudioNode;
    if (this.native) {
      // Le micro arrive par le natif : on lui indique l'appareil choisi (par son nom), puis on lit son tampon.
      const name = await nativeName(device, 'audioinput');
      this.native.input(name);
      const s = this.native.source();
      if (!s) throw new Error('no native input');
      src = s;
    } else {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: device ? { exact: device } : undefined, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      src = this.ctx.createMediaStreamSource(stream);
    }
    await this.ctx.resume();
    const gain = this.ctx.createGain(), mon = this.ctx.createGain(), analyser = this.ctx.createAnalyser();
    gain.gain.value = gainVal; mon.gain.value = monVal; analyser.fftSize = 2048;
    src.connect(gain); gain.connect(analyser); gain.connect(mon).connect(this.mix.master);
    this.inp = { stream, src, gain, mon, analyser, device };
  }
  closeInput() {
    const i = this.inp;
    if (!i) return;
    i.src.disconnect(); i.gain.disconnect(); i.mon.disconnect(); i.stream?.getTracks().forEach(t => t.stop());
    if (i.src instanceof AudioWorkletNode) i.src.port.postMessage('stop');
    this.inp = undefined;
    // Mode natif : on referme aussi le micro du côté de la carte son (sinon il reste capté, pastille orange allumée).
    if (this.native && !i.stream) try { this.native.input(null); } catch { /* natif arrêté */ }
  }
  setInput(gain: number, monitor: boolean) {
    if (!this.inp) return;
    this.inp.gain.gain.setTargetAtTime(gain, this.ctx.currentTime, 0.02); this.inp.mon.gain.setTargetAtTime(monitor ? 1 : 0, this.ctx.currentTime, 0.02);
  }

  /** Enregistre l'entrée audio, calée à l'échantillon près sur le transport. */
  async recordAudio(done: RecDone, preroll: number, mode: RecMode = 'normal') {
    const temp = !this.inp;
    await this.openInput(S.inputDevice);
    const inp = this.inp!;
    if (this.playing) this.stop();
    // En boucle, on part du début de la zone ; en punch, une mesure avant pour prendre son élan.
    const ls = S.project.loopStart * BAR;
    this.recMode = mode;
    if (mode === 'loop') this.pos = ls; else if (mode === 'punch') this.pos = Math.max(0, ls - BAR);
    await this.ctx.resume();
    this.workletReady ??= this.ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' })));
    await this.workletReady;
    const node = new AudioWorkletNode(this.ctx, 'kh-rec', { numberOfInputs: 1, numberOfOutputs: 0 });
    const inLat = this.latency().input;
    const cap = { temp, node, chunks: [] as Float32Array[][], first: -1, startStep: Math.floor(this.pos), done, inLat, mode };
    node.port.onmessage = e => { if (cap.first < 0) cap.first = e.data.f; cap.chunks.push(e.data.ch); };
    inp.gain.connect(node);
    this.cap = cap; this.recording = 'audio';
    await this.play(preroll);
  }

  private finishCapture() {
    const cap = this.cap;
    if (!cap) return;
    this.cap = undefined;
    try { this.inp?.gain.disconnect(cap.node); } catch { /* entrée déjà fermée */ }
    cap.node.port.onmessage = null;
    const inLat = cap.inLat;
    if (cap.temp) this.closeInput();
    const total = cap.chunks.reduce((n, c) => n + c[0].length, 0), sr = this.ctx.sampleRate;
    if (!total) { cap.done(null, cap.startStep, 0, cap.mode); return; }
    const nch = Math.min(2, cap.chunks[0].length);
    const buf = new AudioBuffer({ length: total, numberOfChannels: nch, sampleRate: sr });
    for (let c = 0; c < nch; c++) {
      const d = buf.getChannelData(c); let o = 0;
      for (const ch of cap.chunks) { d.set(ch[c] ?? ch[0], o); o += ch[0].length; }
    }
    // Décalage entre le début de la capture et l'instant où le premier temps a été entendu.
    // Compensation automatique (latences annoncées par le système), plus le décalage réglé ou mesuré par l'utilisateur.
    // Plus le retard de la compensation de latence des plugins : on entend le morceau d'autant plus tard.
    const outLat = (this.native ? this.native.latency().output : (this.ctx.outputLatency || 0)) + this.mix.pdcMax;
    const off = (this.t0 - cap.first / sr) + outLat + inLat + S.recOffsetMs / 1000;
    cap.done(buf, cap.startStep, Math.max(0, Math.min(off, buf.duration - 0.01)), cap.mode);
  }

  // ---------- Sortie audio et latence ----------
  /** Latences annoncées par le système, en secondes, et fréquence d'échantillonnage. */
  latency(): { output: number; input: number; rate: number } {
    if (this.native) { const l = this.native.latency(); return { output: l.output, input: this.inp ? l.input : 0, rate: this.ctx.sampleRate }; }
    const inLat = (this.inp?.stream?.getAudioTracks()[0]?.getSettings() as { latency?: number } | undefined)?.latency ?? 0;
    return { output: (this.ctx.baseLatency || 0) + (this.ctx.outputLatency || 0), input: inLat, rate: this.ctx.sampleRate };
  }
  canSetOutput() { return !!this.native || typeof (this.ctx as unknown as { setSinkId?: unknown }).setSinkId === 'function'; }
  async setOutput(id: string): Promise<boolean> {
    // En mode natif, Web Audio reste sans sortie : c'est le natif qui change d'appareil.
    if (this.native) { try { await this.native.configure({ output: await nativeName(id, 'audiooutput') }); return true; } catch { return false; } }
    try { await (this.ctx as unknown as { setSinkId(id: string): Promise<void> }).setSinkId(id); return true; } catch { return false; }
  }
  /**
   * Mesure le trajet complet haut-parleur → micro : un clic est joué, puis repéré dans ce que capte l'entrée.
   * Renvoie le délai en secondes, ou null si le clic n'a pas été entendu (casque, micro coupé, bruit ambiant).
   */
  async measureLatency(): Promise<number | null> {
    const temp = !this.inp;
    await this.openInput(S.inputDevice);
    const inp = this.inp!, sr = this.ctx.sampleRate;
    await this.ctx.resume();
    this.workletReady ??= this.ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' })));
    await this.workletReady;
    const node = new AudioWorkletNode(this.ctx, 'kh-rec', { numberOfInputs: 1, numberOfOutputs: 0 }), chunks: Float32Array[] = [];
    let first = -1;
    node.port.onmessage = e => { if (first < 0) first = e.data.f; chunks.push(e.data.ch[0]); };
    inp.gain.connect(node);
    const t0 = this.ctx.currentTime + 0.25, o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.frequency.value = 2000; g.gain.setValueAtTime(0.6, t0); g.gain.setValueAtTime(0, t0 + 0.006);
    g.gain.value = 0; o.connect(g).connect(this.out); o.start(t0 - 0.01); o.stop(t0 + 0.02);
    await new Promise(r => setTimeout(r, 900));
    try { inp.gain.disconnect(node); } catch { /* entrée fermée */ }
    node.port.onmessage = null;
    if (temp) this.closeInput();
    if (first < 0) return null;
    const total = chunks.reduce((n, c) => n + c.length, 0), d = new Float32Array(total); let k = 0;
    for (const c of chunks) { d.set(c, k); k += c.length; }
    // Bruit de fond avant le clic, puis premier instant qui le dépasse nettement après le clic.
    const i0 = Math.max(0, Math.round((t0 - first / sr) * sr)); let floor = 0;
    for (let i = 0; i < Math.min(i0, d.length); i++) floor = Math.max(floor, Math.abs(d[i]));
    const thr = Math.max(0.02, floor * 4);
    for (let i = i0; i < d.length; i++) if (Math.abs(d[i]) > thr) return (i - i0) / sr;
    return null;
  }

  // ---------- Effets de performance ----------
  /** Effet momentané sur le général : 'echo', 'reverb', 'stut8' (croche) ou 'stut16' (double-croche). */
  async fx(name: string, on: boolean) {
    const m = this.mix, now = this.ctx.currentTime;
    this.ctx.resume();
    if (name === 'echo' && m.fxEcho && m.fxDelay) { m.fxDelay.delayTime.setTargetAtTime(Math.min(1.9, 3 * stepDur(S.project.bpm)), now, 0.01); m.fxEcho.gain.setTargetAtTime(on ? 0.9 : 0, now, 0.01); }
    else if (name === 'reverb' && m.fxRev) m.fxRev.gain.setTargetAtTime(on ? 0.8 : 0, now, 0.02);
    else if (name.startsWith('stut')) {
      await m.initStutter();
      m.stutter?.port.postMessage({ len: on ? Math.round(stepDur(S.project.bpm) * (name === 'stut8' ? 2 : 1) * this.ctx.sampleRate) : 0 });
    }
    if (on) this.fxOn.add(name); else this.fxOn.delete(name);
  }
  fxOn = new Set<string>();

  /** Accordeur : hauteur de la note reçue sur l'entrée audio (Hz), 0 s'il n'y en a pas. */
  inputPitch(): number {
    const a = this.inp?.analyser;
    if (!a) return 0;
    const buf = this.scratch.subarray(0, a.fftSize);
    a.getFloatTimeDomainData(buf as Float32Array<ArrayBuffer>);
    // Trame abîmée : la fenêtre commence avant le son (ouverture de l'entrée, attaque d'une note), sa hauteur serait fausse
    // de quelques centièmes. On la saute : son début est nettement plus faible que sa fin.
    const q = buf.length >> 3; let head = 0, tail = 0;
    for (let i = 0; i < q; i++) { head += buf[i] * buf[i]; tail += buf[buf.length - 1 - i] * buf[buf.length - 1 - i]; }
    if (head < tail * 0.25) return 0;
    return detectPitch(buf, this.ctx.sampleRate);
  }

  /** Réduction de gain appliquée par le compresseur d'une tranche, en dB (0 = aucune). */
  reduction(id: string): number { return this.mix.reduction(id); }

  /** Spectre du général (amplitudes 0..255 par bande de fréquence). */
  spectrum(): Uint8Array | null {
    const a = this.mix.analyser;
    if (!a) return null;
    this.spec ??= new Uint8Array(a.frequencyBinCount);
    a.getByteFrequencyData(this.spec as Uint8Array<ArrayBuffer>);
    return this.spec;
  }
  private spec?: Uint8Array;

  // ---------- Vumètres ----------
  level(id: string): number {
    const a = id === 'master' ? this.mix.analyser : id === 'input' ? this.inp?.analyser : this.mix.tracks.get(id)?.analyser;
    if (!a) return 0;
    const buf = this.scratch.subarray(0, a.fftSize);
    a.getFloatTimeDomainData(buf);
    let pk = 0; for (let i = 0; i < buf.length; i++) pk = Math.max(pk, Math.abs(buf[i]));
    const v = pk > 0.0005 ? Math.max(0, Math.min(1, (20 * Math.log10(pk) + 54) / 57)) : 0;
    const out = Math.max(v, (this.levels.get(id) ?? 0) - 0.03);
    this.levels.set(id, out);
    return out;
  }

  decode(data: ArrayBuffer) { return this.ctx.decodeAudioData(data); }
}

export const engine = new Engine();
setLiveInstOf(id => engine.mix.instOf(id));

// ---------- Export : rendu hors-ligne + encodage WAV ----------
/** Ce que le dernier rendu n'a pas pu inclure. */
/** `parts` : nombre de rendus menés en parallèle pour le dernier export (1 = d'un seul tenant). */
export const lastRender = { wamFailed: 0, pdc: 0, parts: 1 };

/** Rendus hors-ligne en cours : ne sert qu'à afficher l'avancement d'un export, le calcul n'en dépend pas. */
const rendering = new Set<OfflineAudioContext>();
async function tracked(off: OfflineAudioContext): Promise<AudioBuffer> {
  rendering.add(off);
  try { return await off.startRendering(); } finally { rendering.delete(off); }
}
/** Avancement du rendu en cours, de 0 à 1 (null si rien ne se calcule). Avec des rendus parallèles, le plus en retard donne le ton. */
export function renderProgress(): number | null {
  if (!rendering.size) return null;
  let m = 1;
  for (const c of rendering) m = Math.min(m, c.currentTime * c.sampleRate / c.length);
  return Math.max(0, Math.min(1, m));
}

/** Rend une partie du projet (toutes ses pistes, ou un groupe d'entre elles) jusqu'au pas `end`.
 *  `stem` : la sortie s'arrête au volume général, avant sa chaîne (filtre, égaliseur, largeur, limiteur), appliquée ensuite une seule fois. */
async function renderPart(p: Project, end: number, stem: boolean, sr = 44100, limit: number | null = null) {
  const off = new OfflineAudioContext(2, Math.ceil((timeOf(p, end) + 2.5) * sr), sr);
  const mix = new Mix(off, false); mix.autoOn = true;
  if (p.tracks.some(t => t.sc && t.duck > 0)) await mix.initEnv();   // sidechain : le suiveur d'enveloppe doit exister avant le graphe
  mix.sync(p);
  if (stem) mix.stemOut();
  const wamFailed = await mix.loadWams(p); // plugins web : recréés pour ce rendu
  for (let s = 0; s < end; s++) mix.applyAuto(p, s, timeOf(p, s));
  for (let s = 0; s < end; s++) scheduleStep(mix, p, buffers, s, swingT(p, s, timeOf(p, s)), s === 0, limit);
  // Automation des plugins du Mac : le rendu s'arrête à chaque changement le temps de l'envoyer au plugin.
  for (const [q, fns] of mix.auEvents) {
    if (q <= 0) { fns.forEach(f => f()); continue; }
    off.suspend(q * 128 / sr).then(() => { fns.forEach(f => f()); off.resume(); });
  }
  await mix.flushInsts();   // instruments du Mac : toutes leurs notes sont arrivées avant le calcul
  const out = await tracked(off);
  mix.active.clear(); mix.disposePlugins();
  return { out, wamFailed, pdc: mix.pdcMax };
}

/**
 * Groupes de pistes rendus en parallèle (un fil de calcul par groupe) pour un gros projet, ou null pour un rendu d'un seul tenant.
 * Le mixage est linéaire jusqu'au volume général : la somme des groupes est le même son. Restent ensemble ce qui interagit :
 * un bus et ses pistes ; les kicks et les pistes qu'ils font « pomper » (sidechain). Pas de découpage avec un plugin du Mac
 * (sa latence est compensée sur tout le projet) ni avec une piste en solo.
 */
export function renderGroups(p: Project, cores = navigator.hardwareConcurrency || 2): Project[] | null {
  const n = Math.min(4, cores - 1);
  if (p.tracks.length < 12 || n < 2) return null;
  if ([...p.tracks, ...p.buses].some(t => t.solo || t.synth?.engine === 'au' || (t.inserts ?? []).some(i => i.type === 'au'))) return null;
  // Ce qui doit rester dans le même rendu est réuni (union de groupes) : une piste et le bus où elle sort ou envoie (V19),
  // une piste et la source de son sidechain (V19), les kicks du séquenceur et les pistes qu'ils font pomper.
  const busIds = new Set(p.buses.map(b => b.id)), ids = new Set(p.tracks.map(t => t.id)), up = new Map<string, string>();
  const root = (x: string): string => { let r = x; while (up.has(r)) r = up.get(r)!; return r; };
  const join = (a: string, b: string) => { const x = root(a), y = root(b); if (x !== y) up.set(x, y); };
  for (const t of p.tracks) {
    if (busIds.has(t.out)) join(t.id, 'bus:' + t.out);
    for (const sd of t.sends ?? []) if (busIds.has(sd.bus)) join(t.id, 'bus:' + sd.bus);
    if (t.duck > 0 && t.sc && ids.has(t.sc)) join(t.id, t.sc);
    if (t.duck > 0 && !t.sc) { join(t.id, 'kick'); for (const d of p.tracks) if (d.type === 'drums') join(d.id, 'kick'); }
  }
  const units = new Map<string, Project['tracks']>();
  for (const t of p.tracks) { const u = root(t.id); if (!units.has(u)) units.set(u, []); units.get(u)!.push(t); }
  if (units.size < 2) return null;
  // Répartition par coût estimé (une piste, plus ses effets ; une réverb compte davantage), du plus lourd au plus léger.
  const cost = (ts: Project['tracks']) => ts.reduce((a, t) => a + 1 + (t.inserts ?? []).reduce((b, i) => b + (i.type === 'reverb' ? 4 : 1), 0), 0);
  const bins = Array.from({ length: Math.min(n, units.size) }, () => ({ w: 0, tracks: [] as Project['tracks'] }));
  for (const ts of [...units.values()].sort((a, b) => cost(b) - cost(a))) { const b = bins.reduce((x, y) => (y.w < x.w ? y : x)); b.tracks.push(...ts); b.w += cost(ts); }
  return bins.map(b => ({ ...p, tracks: b.tracks, buses: p.buses.filter(x => b.tracks.some(t => t.out === x.id || t.sends?.some(sd => sd.bus === x.id))) }));
}

/** Rendu parallèle des gros projets (désactivable pour la QA et les comparaisons). */
export const renderOpts = { parallel: true };

/** Plage d'un export (V19) : du pas `from` au pas `to`, queue de son de 2,5 s après la fin ou non, fréquence d'échantillonnage.
 *  `stem` : le son sort avant le général (ni son volume, ni sa chaîne, ni son limiteur), pour le gel d'une piste qui y repassera. */
export interface RenderRange { from?: number; to?: number; tail?: boolean; rate?: number; stem?: boolean }
export async function renderOffline(p: Project, normalize = true, range: RenderRange = {}): Promise<AudioBuffer> {
  const full = contentEnd(p), from = Math.max(0, range.from ?? 0), end = Math.max(from, range.to ?? full);
  if (!full || end <= from) throw new Error('empty');
  const failed = await ensureBanks(p);
  if (failed.length) throw new Error('bank');
  // Une plage qui finit avant la fin du morceau coupe les notes et les sons à sa fin (comme la fin d'une boucle) ; il ne reste
  // après que les queues (relâchement, réverb, écho). Tout ce qui précède la plage est rendu, puis retiré : le début sonne
  // exactement comme dans le morceau (notes tenues, réverb en cours).
  const sr = range.rate ?? 44100, limit = end < full ? end : null, groups = renderOpts.parallel && !range.stem ? renderGroups(p) : null;
  let out: AudioBuffer, pdc = 0;
  if (!groups) {
    // Sortie avant le général : volume à 1 et sortie prise au volume, avant sa chaîne (filtre, égaliseur, largeur, limiteur).
    const r = range.stem ? await renderPart({ ...p, master: 1 }, end, true, sr, limit) : await renderPart(p, end, false, sr, limit);
    out = r.out; pdc = r.pdc; lastRender.wamFailed = r.wamFailed;
  } else {
    // Gros projet (V18) : chaque groupe dans son propre rendu, en même temps, puis la somme passe une fois par la chaîne du général.
    const parts = await Promise.all(groups.map(g => renderPart(g, end, true, sr, limit)));
    lastRender.wamFailed = parts.reduce((a, r) => a + r.wamFailed, 0);
    const len = parts[0].out.length, sum = new AudioBuffer({ numberOfChannels: 2, length: len, sampleRate: sr });
    for (let c = 0; c < 2; c++) { const d = sum.getChannelData(c); for (const r of parts) { const x = r.out.getChannelData(c); for (let i = 0; i < len; i++) d[i] += x[i]; } }
    const off = new OfflineAudioContext(2, len, sr), mix = new Mix(off, false);
    mix.sync({ ...p, tracks: [], buses: [] });
    const src = off.createBufferSource(); src.buffer = sum; mix.masterChainIn(src); src.start(0);
    out = await tracked(off);
  }
  lastRender.parts = groups?.length ?? 1;
  // Compensation de latence des plugins : tout le mixage sort en retard de `pdcMax` ; on le ramène au début du fichier,
  // pour que l'export (et les pistes séparées) reste calé sur la grille.
  const shift = Math.round(pdc * sr);
  if (shift > 0) for (let c = 0; c < out.numberOfChannels; c++) { const d = out.getChannelData(c); d.copyWithin(0, shift); d.fill(0, d.length - shift); }
  lastRender.pdc = pdc;
  const i0 = Math.round(timeOf(p, from) * sr), i1 = Math.min(out.length, Math.round((timeOf(p, end) + (range.tail === false ? 0 : 2.5)) * sr));
  if (i0 > 0 || i1 < out.length) {
    const cut = new AudioBuffer({ numberOfChannels: out.numberOfChannels, length: Math.max(1, i1 - i0), sampleRate: sr });
    for (let c = 0; c < out.numberOfChannels; c++) cut.copyToChannel(out.getChannelData(c).subarray(i0, i1), c);
    out = cut;
  }
  if (!normalize) return out;
  if (p.target < 0) {
    // Export au niveau d'une plateforme : on vise le volume perçu demandé, crêtes retenues par un limiteur.
    // Le limiteur retient les crêtes, donc un seul passage peut rester sous la cible : on s'en approche en trois passes au plus.
    for (let pass = 0; pass < 3; pass++) {
      const l = lufs(out);
      if (!Number.isFinite(l) || Math.abs(p.target - l) < 0.3) break;
      gainLimit(out, Math.min(8, Math.pow(10, (p.target - l) / 20)));
    }
    if (peakOf(out) > 0.966) gainLimit(out, 1); // déjà au bon volume : il reste à retenir les crêtes
  } else {
    // Simple protection : si une crête dépasse -0,3 dB, on ramène l'ensemble en dessous.
    const pk = peakOf(out);
    if (pk > 0.966) gainLimit(out, 0.966 / pk);
  }
  return out;
}

/**
 * Charge de calcul du mixage (V17) : le moteur calcule `sec` secondes du morceau à partir du pas `from`, aussi vite que possible,
 * avec le même graphe que l'écoute. Rapport = temps de calcul / durée du son : 0,25 veut dire qu'un quart du temps réel
 * d'un cœur du processeur suffit ; au-delà de 0,7 environ, l'écoute risque de craquer.
 */
export async function measureLoad(p: Project, from = 0, sec = 4): Promise<{ ratio: number; ms: number; sec: number; tracks: number; inserts: number }> {
  await ensureBanks(p);
  const sr = 44100, end = Math.max(contentEnd(p), from + 1), off = new OfflineAudioContext(2, Math.ceil(sec * sr), sr);
  const mix = new Mix(off, false); mix.autoOn = true;
  if (p.tracks.some(t => t.sc && t.duck > 0)) await mix.initEnv();
  mix.sync(p);
  await mix.loadWams(p);
  const t0 = timeOf(p, from);
  for (let s = from; s < end && timeOf(p, s) - t0 < sec; s++) { const t = timeOf(p, s) - t0; mix.applyAuto(p, s, t); scheduleStep(mix, p, buffers, s, swingT(p, s, t + t0) - t0, s === from, null); }
  await mix.flushInsts();
  const a = performance.now(); await off.startRendering(); const ms = performance.now() - a;
  mix.active.clear(); mix.disposePlugins();
  return { ratio: ms / 1000 / sec, ms, sec, tracks: p.tracks.length, inserts: p.tracks.reduce((n, t) => n + (t.inserts?.filter(i => i.on).length ?? 0), 0) };
}

/** Volume perçu et crête du morceau tel qu'il sera exporté. */
export async function analyze(p: Project): Promise<{ lufs: number; peakDb: number }> {
  const b = await renderOffline(p);
  return { lufs: lufs(b), peakDb: 20 * Math.log10(Math.max(1e-9, peakOf(b))) };
}

/** Encode en MP3 (192 kbit/s). L'encodeur n'est chargé qu'à la première utilisation. */
export async function encodeMp3(b: AudioBuffer): Promise<Blob> {
  const { Mp3Encoder } = await import('@breezystack/lamejs');
  const ch = Math.min(2, b.numberOfChannels), BLK = 1152 * 20;
  const encode = (gain: number) => {
    const enc = new Mp3Encoder(ch, b.sampleRate, 192), parts: BlobPart[] = [];
    const pcm = Array.from({ length: ch }, (_, c) => { const d = b.getChannelData(c), o = new Int16Array(d.length); for (let i = 0; i < d.length; i++) { const x = Math.max(-1, Math.min(1, d[i] * gain)); o[i] = x < 0 ? x * 0x8000 : x * 0x7fff; } return o; });
    for (let i = 0; i < b.length; i += BLK) {
      const out = enc.encodeBuffer(pcm[0].subarray(i, i + BLK), ch > 1 ? pcm[1].subarray(i, i + BLK) : undefined);
      if (out.length) parts.push(new Uint8Array(out) as BlobPart);
    }
    const end = enc.flush(); if (end.length) parts.push(new Uint8Array(end) as BlobPart);
    return new Blob(parts, { type: 'audio/mpeg' });
  };
  // L'encodage avec pertes peut créer de nouvelles crêtes. Vérifier le fichier
  // décodé (les deux canaux), puis réduire seulement si nécessaire. Le rendu
  // WAV et le tampon du projet restent inchangés ; trois essais au plus.
  const check = new OfflineAudioContext(ch, 1, b.sampleRate);
  let gain = 1;
  for (let attempt = 0; attempt < 3; attempt++) {
    const blob = encode(gain), peak = peakOf(await check.decodeAudioData(await blob.arrayBuffer()));
    // Marge de -1 dB de vraie crête (0,89) : un lecteur qui rééchantillonne (44,1 → 48 kHz) fait remonter les crêtes.
    if (Number.isFinite(peak) && peak <= 0.89) return blob;
    if (!Number.isFinite(peak)) break;
    gain *= 0.87 / peak;
  }
  throw new Error('mp3 peak');
}

/** WAV PCM en 16 ou 24 bits (V19), à la fréquence du rendu. */
export function encodeWav(b: AudioBuffer, bits: 16 | 24 = 16): Blob {
  const ch = b.numberOfChannels, n = b.length, B = bits / 8, v = new DataView(new ArrayBuffer(44 + n * ch * B));
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * ch * B, true); str(8, 'WAVEfmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true);
  v.setUint32(24, b.sampleRate, true); v.setUint32(28, b.sampleRate * ch * B, true);
  v.setUint16(32, ch * B, true); v.setUint16(34, bits, true); str(36, 'data'); v.setUint32(40, n * ch * B, true);
  const data = Array.from({ length: ch }, (_, i) => b.getChannelData(i));
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) {
    const x = Math.max(-1, Math.min(1, data[c][i]));
    if (bits === 16) { v.setInt16(o, x < 0 ? x * 0x8000 : x * 0x7fff, true); o += 2; }
    else { const q = Math.round(x < 0 ? x * 0x800000 : x * 0x7fffff); v.setUint8(o, q & 255); v.setUint8(o + 1, (q >> 8) & 255); v.setUint8(o + 2, (q >> 16) & 255); o += 3; }
  }
  return new Blob([v], { type: 'audio/wav' });
}
