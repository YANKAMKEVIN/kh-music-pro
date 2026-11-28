import { bankReady, drumBank } from './banks';
import { detectPitch } from './pitch';
import { hitPad, playNote, setLiveInstOf, Voice } from './graph';
import { buffers, S } from '../store';
import { IoOptions, NativeIO, nativeName } from './native-io';
import { BAR, CtlKind, stepDur, SynthParams, Track } from '../types';
import { EngineCore, RecDone, RecMode } from './engine-core';
export * from './render';
export type { RecDone, RecMode } from './engine-core';

const WORKLET = `class KhRec extends AudioWorkletProcessor{process(i){const c=i[0];if(c&&c[0])this.port.postMessage({f:currentFrame,ch:c.map(x=>x.slice())});return true}}registerProcessor('kh-rec',KhRec)`;

class Engine extends EngineCore {
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

  protected finishCapture() {
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
