import { ensureBanks, loadBank, setDecoder, usedBanks, bankReady } from './banks';
import { gainLimit, lufs, peakOf } from './loudness';
import { detectPitch } from './pitch';
import { Mix, Voice, hitPad, playNote, scheduleLive, scheduleStep, swingT } from './graph';
import { S, buffers } from '../store';
import { BAR, Project, Track, contentEnd, durAt, stepDur, timeOf } from '../types';

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
  onLive: () => void = () => { };
  onRecEnd: (kind: 'audio' | 'midi') => void = () => { };
  /** Appelé pour chaque pas programmé de l'arrangement (arpégiateur). */
  onStep: (s: number, t: number) => void = () => { };

  private playFrom = 0;
  private nextStep = 0;
  private nextTime = 0;
  private t0 = 0;
  private seg = true;
  private marks: { t: number; s: number }[] = [];
  private timer = 0;
  private levels = new Map<string, number>();
  private scratch = new Float32Array(2048);
  private voices = new Map<string, Voice>();
  private liveSrc = new Map<string, AudioBufferSourceNode[]>();
  private workletReady?: Promise<void>;
  /** Entrée audio ouverte (micro ou carte son) : gain, vumètre et écoute de contrôle. */
  inp?: { stream: MediaStream; src: MediaStreamAudioSourceNode; gain: GainNode; mon: GainNode; analyser: AnalyserNode; device: string };
  private cap?: { temp: boolean; node: AudioWorkletNode; chunks: Float32Array[][]; first: number; startStep: number; done: RecDone; inLat: number; mode: RecMode };

  /** Signalé quand des sons d'instruments réels sont en cours de chargement, puis chargés ou en échec. */
  onBanks: (state: 'loading' | 'ready' | 'failed') => void = () => { };
  constructor() { setDecoder(this.ctx); }

  sync() { this.mix.sync(S.project); }

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
    await this.ctx.resume();
    await this.prepare(); // les vrais instruments doivent être en mémoire avant le premier temps
    // Le bégaiement garde en mémoire les derniers instants joués : il doit écouter dès le début de la lecture.
    this.mix.initStutter().catch(() => { });
    this.mix.autoOn = this.mode === 'arr';
    this.sync();
    this.playing = true;
    this.t0 = this.nextTime = this.ctx.currentTime + 0.06 + preroll;
    this.seg = true; this.marks = [];
    if (preroll > 0) { const beat = preroll / 4; for (let i = 0; i < 4; i++) this.click(this.t0 - preroll + i * beat, i === 0); }
    this.timer = window.setInterval(() => this.tick(), 25);
    this.tick();
  }

  async play(preroll = 0) {
    if (this.playing) return;
    this.mode = 'arr'; this.playFrom = this.pos; this.nextStep = Math.floor(this.pos);
    await this.start(preroll);
  }

  /** Arrêt. À l'arrêt, un second appel ramène au début. */
  stop() {
    if (!this.playing) { this.pos = 0; return; }
    this.playing = false; clearInterval(this.timer);
    this.mix.stopAll(); this.voices.clear(); this.mix.clearAuto(S.project);
    if (this.mode === 'live') { this.liveActive.clear(); this.liveQueued.clear(); this.liveSrc.clear(); this.mode = 'arr'; this.onLive(); }
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
        if (s % (p.liveQ || BAR) === 0 && this.liveQueued.size) {
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
        if (p.metronome && s % 4 === 0) this.click(t, s % BAR === 0);
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
      if (looping && this.nextStep === le) { this.nextStep = ls; this.seg = true; }
      const limit = looping && this.nextStep < le ? le : null;
      this.mix.applyAuto(p, this.nextStep, this.nextTime); this.onStep(this.nextStep, this.nextTime);
      scheduleStep(this.mix, p, buffers, this.nextStep, swingT(p, this.nextStep, this.nextTime), this.seg, limit);
      if (p.metronome && this.nextStep % 4 === 0) this.click(this.nextTime, this.nextStep % BAR === 0);
      this.marks.push({ t: this.nextTime, s: this.nextStep });
      this.nextTime += durAt(p, this.nextStep); this.nextStep++; this.seg = false; // le tempo peut changer d'un pas à l'autre
    }
  }

  private click(t: number, accent: boolean) {
    const o = this.mix.reg(this.ctx.createOscillator()), g = this.ctx.createGain();
    o.frequency.value = accent ? 1600 : 1000;
    g.gain.setValueAtTime(0.25, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
    o.connect(g).connect(this.ctx.destination); o.start(t); o.stop(t + 0.05);
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
    if (track.synth?.engine === 'multi' && track.synth.bank && !bankReady(track.synth.bank)) { this.loadBank(track.synth.bank); return; }
    const n = this.mix.tracks.get(track.id), key = track.id + ':' + midi;
    if (!n || !track.synth) return;
    this.voices.get(key)?.release(this.ctx.currentTime);
    const v = playNote(this.mix, n.input, track.synth, midi, this.ctx.currentTime + 0.003, null, vel, buffers);
    if (v) this.voices.set(key, v);
  }
  noteOff(track: Track, midi: number) {
    const key = track.id + ':' + midi;
    this.voices.get(key)?.release(this.ctx.currentTime); this.voices.delete(key);
  }
  previewNote(track: Track, midi: number, dur = 0.25) {
    this.ctx.resume(); this.sync();
    const n = this.mix.tracks.get(track.id);
    if (n && track.synth) playNote(this.mix, n.input, track.synth, midi, this.ctx.currentTime + 0.005, dur, 0.8, buffers);
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
    if (track.kit === 'acoustic' && !bankReady('drums')) this.loadBank('drums');
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
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { deviceId: device ? { exact: device } : undefined, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    await this.ctx.resume();
    const src = this.ctx.createMediaStreamSource(stream), gain = this.ctx.createGain(), mon = this.ctx.createGain(), analyser = this.ctx.createAnalyser();
    gain.gain.value = gainVal; mon.gain.value = monVal; analyser.fftSize = 2048;
    src.connect(gain); gain.connect(analyser); gain.connect(mon).connect(this.mix.master);
    this.inp = { stream, src, gain, mon, analyser, device };
  }
  closeInput() {
    const i = this.inp;
    if (!i) return;
    i.src.disconnect(); i.gain.disconnect(); i.mon.disconnect(); i.stream.getTracks().forEach(t => t.stop());
    this.inp = undefined;
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
    const inLat = (inp.stream.getAudioTracks()[0]?.getSettings() as { latency?: number }).latency ?? 0;
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
    const off = (this.t0 - cap.first / sr) + (this.ctx.outputLatency || 0) + inLat + S.recOffsetMs / 1000;
    cap.done(buf, cap.startStep, Math.max(0, Math.min(off, buf.duration - 0.01)), cap.mode);
  }

  // ---------- Sortie audio et latence ----------
  /** Latences annoncées par le système, en secondes, et fréquence d'échantillonnage. */
  latency(): { output: number; input: number; rate: number } {
    const inLat = (this.inp?.stream.getAudioTracks()[0]?.getSettings() as { latency?: number } | undefined)?.latency ?? 0;
    return { output: (this.ctx.baseLatency || 0) + (this.ctx.outputLatency || 0), input: inLat, rate: this.ctx.sampleRate };
  }
  canSetOutput() { return typeof (this.ctx as unknown as { setSinkId?: unknown }).setSinkId === 'function'; }
  async setOutput(id: string): Promise<boolean> {
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
    g.gain.value = 0; o.connect(g).connect(this.ctx.destination); o.start(t0 - 0.01); o.stop(t0 + 0.02);
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
    return detectPitch(buf, this.ctx.sampleRate);
  }

  /** Réduction de gain appliquée par le compresseur d'une tranche, en dB (0 = aucune). */
  reduction(id: string): number { const n = this.mix.tracks.get(id); return n?.compOn ? n.comp.reduction : 0; }

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

// ---------- Export : rendu hors-ligne + encodage WAV ----------
/** Ce que le dernier rendu n'a pas pu inclure. */
export const lastRender = { wamFailed: 0 };

export async function renderOffline(p: Project, normalize = true): Promise<AudioBuffer> {
  const end = contentEnd(p);
  if (!end) throw new Error('empty');
  await ensureBanks(p);
  const sr = 44100;
  const off = new OfflineAudioContext(2, Math.ceil((timeOf(p, end) + 2.5) * sr), sr);
  const mix = new Mix(off, false); mix.autoOn = true; mix.sync(p);
  lastRender.wamFailed = await mix.loadWams(p); // plugins web : recréés pour ce rendu
  for (let s = 0; s < end; s++) mix.applyAuto(p, s, timeOf(p, s));
  for (let s = 0; s < end; s++) scheduleStep(mix, p, buffers, s, swingT(p, s, timeOf(p, s)), s === 0, null);
  const out = await off.startRendering();
  mix.active.clear(); mix.disposePlugins();
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

/** Volume perçu et crête du morceau tel qu'il sera exporté. */
export async function analyze(p: Project): Promise<{ lufs: number; peakDb: number }> {
  const b = await renderOffline(p);
  return { lufs: lufs(b), peakDb: 20 * Math.log10(Math.max(1e-9, peakOf(b))) };
}

/** Encode en MP3 (192 kbit/s). L'encodeur n'est chargé qu'à la première utilisation. */
export async function encodeMp3(b: AudioBuffer): Promise<Blob> {
  const { Mp3Encoder } = await import('@breezystack/lamejs');
  const ch = Math.min(2, b.numberOfChannels), enc = new Mp3Encoder(ch, b.sampleRate, 192), parts: BlobPart[] = [], BLK = 1152 * 20;
  const pcm = Array.from({ length: ch }, (_, c) => { const d = b.getChannelData(c), o = new Int16Array(d.length); for (let i = 0; i < d.length; i++) { const x = Math.max(-1, Math.min(1, d[i])); o[i] = x < 0 ? x * 0x8000 : x * 0x7fff; } return o; });
  for (let i = 0; i < b.length; i += BLK) {
    const out = enc.encodeBuffer(pcm[0].subarray(i, i + BLK), ch > 1 ? pcm[1].subarray(i, i + BLK) : undefined);
    if (out.length) parts.push(new Uint8Array(out) as BlobPart);
  }
  const end = enc.flush(); if (end.length) parts.push(new Uint8Array(end) as BlobPart);
  return new Blob(parts, { type: 'audio/mpeg' });
}

export function encodeWav(b: AudioBuffer): Blob {
  const ch = b.numberOfChannels, n = b.length, v = new DataView(new ArrayBuffer(44 + n * ch * 2));
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * ch * 2, true); str(8, 'WAVEfmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true);
  v.setUint32(24, b.sampleRate, true); v.setUint32(28, b.sampleRate * ch * 2, true);
  v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, n * ch * 2, true);
  const data = Array.from({ length: ch }, (_, i) => b.getChannelData(i));
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) {
    const x = Math.max(-1, Math.min(1, data[c][i]));
    v.setInt16(o, x < 0 ? x * 0x8000 : x * 0x7fff, true); o += 2;
  }
  return new Blob([v], { type: 'audio/wav' });
}
