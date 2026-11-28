/** Voix : boîte à rythmes synthétisée, pads, instruments mélodiques (synthés, échantillons, corde pincée). */
import { KITS, type SynthParams, type Track } from '../types';
import { drumBank, drumSample, expressiveSample, recordedDynamics, sampleFor } from './banks';
import type { Buffers, Mix, Voice } from './graph';

// ---------- Boîte à rythmes (16 sons synthétisés, modulés par le kit) ----------

function env(ctx: BaseAudioContext, t: number, peak: number, decay: number) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(peak, t); g.gain.exponentialRampToValueAtTime(0.001, t + decay);
  return g;
}
function osc(mix: Mix, type: OscillatorType, t: number, dur: number, f0: number, f1?: number, ft = 0.1) {
  const o = mix.reg(mix.ctx.createOscillator()); o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + ft);
  o.start(t); o.stop(t + dur + 0.02);
  return o;
}
function noise(mix: Mix, t: number, dur: number, type: BiquadFilterType, freq: number, q = 1) {
  const s = mix.reg(mix.ctx.createBufferSource()); s.buffer = mix.noise; s.loop = true;
  const f = mix.ctx.createBiquadFilter(); f.type = type; f.frequency.value = Math.min(freq, 20000); f.Q.value = q;
  s.connect(f); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
  return f;
}

export function playDrum(mix: Mix, dest: AudioNode, row: number, t: number, vel = 1, kit = 'electro', semis = 0) {
  const c = mix.ctx, K = KITS[kit] ?? KITS.electro, T = K.tune * Math.pow(2, semis / 12), D = K.dec;
  const tone = (type: OscillatorType, f0: number, f1: number, ft: number, dur: number, g: number) =>
    osc(mix, type, t, dur * D, f0 * T, f1 * T, ft).connect(env(c, t, vel * g, dur * D)).connect(dest);
  const nz = (type: BiquadFilterType, f: number, dur: number, g: number, q = 1) =>
    noise(mix, t, dur * D, type, f * T, q).connect(env(c, t, vel * g, dur * D)).connect(dest);
  switch (row) {
    case 0: tone('sine', 160, 42, 0.13, 0.45, 1); tone('triangle', 900, 200, 0.02, 0.03, 0.35); break;       // kick
    case 1: nz('highpass', 1400, 0.2, 0.7); tone('triangle', 220, 140, 0.08, 0.12, 0.6); break;             // snare
    case 2: { // clap
      const f = noise(mix, t, 0.3, 'bandpass', 1300 * T, 1.2), g = c.createGain();
      g.gain.setValueAtTime(0, t);
      for (const o of [0, 0.011, 0.022]) { g.gain.setValueAtTime(vel * 0.9, t + o); g.gain.exponentialRampToValueAtTime(0.08, t + o + 0.01); }
      g.gain.setValueAtTime(vel * 0.9, t + 0.033); g.gain.exponentialRampToValueAtTime(0.001, t + 0.033 + 0.25 * D);
      f.connect(g).connect(dest); break;
    }
    case 3: nz('highpass', 7500, 0.055, 0.45); break;                                                       // charley fermé
    case 4: nz('highpass', 7000, 0.33, 0.4); break;                                                         // charley ouvert
    case 5: tone('sine', 210, 95, 0.2, 0.33, 0.8); break;                                                   // tom basse
    case 6: { // rim
      const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1700 * T; f.Q.value = 3;
      osc(mix, 'square', t, 0.04, 820 * T).connect(f).connect(env(c, t, vel * 0.7, 0.04)).connect(dest); break;
    }
    case 7: { // cloche
      const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 800 * T; f.Q.value = 2;
      const g = env(c, t, vel * 0.4, 0.25 * D);
      osc(mix, 'square', t, 0.25 * D, 540 * T).connect(f); osc(mix, 'square', t, 0.25 * D, 800 * T).connect(f);
      f.connect(g).connect(dest); break;
    }
    case 8: tone('sine', 125, 40, 0.22, 1.0, 1); break;                                                     // kick 808
    case 9: nz('bandpass', 2600, 0.13, 0.9, 0.8); tone('triangle', 280, 190, 0.05, 0.08, 0.5); break;       // snare sèche
    case 10: tone('sine', 300, 150, 0.18, 0.28, 0.8); break;                                                // tom médium
    case 11: tone('sine', 420, 220, 0.15, 0.24, 0.75); break;                                               // tom aigu
    case 12: nz('bandpass', 6200, 0.09, 0.5, 1.6); break;                                                   // shaker
    case 13: nz('highpass', 4500, 1.3, 0.4); nz('bandpass', 9000, 0.6, 0.25, 0.7); break;                   // crash
    case 14: nz('highpass', 8500, 0.5, 0.25); tone('square', 5200, 5200, 0.1, 0.3, 0.04); break;            // ride
    default: tone('sine', 340, 250, 0.06, 0.2, 0.8);                                                         // conga
  }
}

/** Déclenche un pad : sample chargé par l'utilisateur, sinon son synthétisé. */
export function hitPad(mix: Mix, buffers: Buffers, tr: Track, dest: AudioNode, row: number, t: number, vel = 1) {
  const pad = tr.pads?.[row], buf = pad ? buffers.get(pad.bufferId) : undefined, fx = tr.padFx?.[row];
  if (tr.kit !== 'percussion' && (row === 0 || row === 8)) mix.kick(t);
  // Réglages du pad : volume, hauteur, panoramique.
  let out = dest;
  if (fx?.pan) { const pn = mix.ctx.createStereoPanner(); pn.pan.value = fx.pan; pn.connect(dest); out = pn; }
  const v = vel * (fx?.vol ?? 1), semis = fx?.tune ?? 0;
  // Sans sample personnel : la batterie acoustique si elle est choisie et chargée, sinon le son synthétisé.
  const key = tr.id + ':' + row, turn = mix.sampleTurns.get(key) ?? 0;
  const bank = drumBank(tr.kit), layered = !!bank && bank !== 'drums';
  const real = !buf && bank ? layered ? expressiveSample(bank, row, vel, turn)?.s : drumSample(row) : undefined;
  if (real && layered) mix.sampleTurns.set(key, turn + 1);
  // Never substitute a synthesized drum for a missing Studio recording.
  if (!buf && !real && layered) return;
  if (!buf && !real) return playDrum(mix, out, row, t, v, tr.kit, semis);
  const s = mix.reg(mix.ctx.createBufferSource()), g = mix.ctx.createGain();
  s.buffer = buf ?? real!.buf; g.gain.value = v * (real ? 0.9 * real.gain : 1); s.playbackRate.value = Math.pow(2, semis / 12);
  if (tr.kit === 'studio' && !buf && (row === 3 || row === 4)) {
    const prev = mix.openHats.get(tr.id);
    if (prev) { prev.gain.gain.setTargetAtTime(0, t, 0.003); try { prev.src.stop(t + 0.02); } catch { /* ended */ } }
    if (row === 4) mix.openHats.set(tr.id, { src: s, gain: g }); else mix.openHats.delete(tr.id);
  }
  s.connect(g).connect(out); s.start(t, real?.off ?? 0);
}

// ---------- Instruments mélodiques ----------

const ksCache = new Map<string, AudioBuffer>();
/** Corde pincée (Karplus-Strong), pré-calculée par note. */
function pluckBuffer(ctx: BaseAudioContext, freq: number, damp: number): AudioBuffer {
  const sr = ctx.sampleRate, key = `${Math.round(freq * 10)}|${damp.toFixed(2)}|${sr}`;
  let b = ksCache.get(key);
  if (b) return b;
  if (ksCache.size > 300) ksCache.clear();
  const N = Math.max(2, Math.round(sr / freq)), len = Math.floor(sr * Math.min(4, 1.2 + 220 / freq));
  b = ctx.createBuffer(1, len, sr);
  const d = b.getChannelData(0), bl = 0.08 + damp * 0.42, g = 0.9985 - damp * 0.004;
  let prev = 0;
  for (let i = 0; i < N; i++) { const x = Math.random() * 2 - 1; prev = prev + (x - prev) * (1 - damp * 0.7); d[i] = prev; }
  for (let i = N; i < len; i++) { const j = i - N; d[i] = g * ((1 - bl) * d[j] + bl * d[j > 0 ? j - 1 : 0]); }
  ksCache.set(key, b);
  return b;
}

/** Part de douceur d'une note (0 = jouée à fond ou nuances coupées, jusqu'à 1). */
export const touchSoftness = (p: SynthParams, vel: number) => Math.max(0, Math.min(1, (p.touch ?? 0) * (1 - Math.min(1, vel))));
/** Fréquence de coupure du timbre selon la douceur, relative à la note jouée : ouverte à fond,
 * elle descend vers les premiers harmoniques quand on joue doucement, jamais sous le 3e. */
export const touchCutoff = (soft: number, freq: number) => Math.min(18000, freq * Math.max(3, Math.pow(18000 / Math.max(20, freq), 1 - 1.3 * soft)));

/**
 * Joue une note. `dur` en secondes pour une note programmée ; `null` pour une note tenue
 * (jeu en direct) : la voix renvoyée doit alors être relâchée avec `release()`.
 */
export function playNote(mix: Mix, dest: AudioNode, p: SynthParams, midi: number, t: number, dur: number | null, vel = 0.8, buffers?: Buffers): Voice | undefined {
  const c = mix.ctx;
  // Instrument du Mac (V19) : la note part en message MIDI vers le plugin, à l'échantillon près.
  if (p.engine === 'au') {
    const au = mix.instFor.get(dest), key = Math.max(0, Math.min(127, midi + p.octave * 12));
    if (!au) return;
    au.midi(0x90, key, Math.max(1, Math.round(Math.min(1, vel) * 127)), t);
    if (dur !== null) { au.midi(0x80, key, 0, t + dur); return; }
    return { release(at: number) { au.midi(0x80, key, 0, at); } };
  }
  const freq = 440 * Math.pow(2, (midi - 69) / 12 + p.octave);
  const vca = c.createGain(), filt = c.createBiquadFilter();
  const srcs: AudioScheduledSourceNode[] = [];
  let level = 0.15, startOff = 0, softAttack = 0;

  if (p.engine === 'fm') {
    const car = mix.reg(c.createOscillator()), mod = mix.reg(c.createOscillator()), mg = c.createGain();
    car.frequency.value = freq; mod.frequency.value = freq * p.ratio;
    const idx = p.fmAmt * freq;
    mg.gain.setValueAtTime(idx, t); mg.gain.setTargetAtTime(idx * 0.15, t, Math.max(0.01, p.fmDecay));
    mod.connect(mg).connect(car.frequency); car.connect(filt);
    srcs.push(car, mod); level = 0.2;
  } else if (p.engine === 'pluck') {
    const s = mix.reg(c.createBufferSource()); s.buffer = pluckBuffer(c, freq, p.damp);
    s.connect(filt); srcs.push(s); level = 0.5;
  } else if (p.engine === 'multi') {
    // Vrai instrument : l'échantillon le plus proche, transposé jusqu'à la note demandée.
    const turns = mix.instrumentTurns.get(dest) ?? new Map<number, number>();
    mix.instrumentTurns.set(dest, turns); const turn = turns.get(midi) ?? 0; turns.set(midi, turn + 1);
    const m = p.bank ? sampleFor(p.bank, midi + p.octave * 12, vel, turn) : null;
    if (!m) return;
    const s = mix.reg(c.createBufferSource()); s.buffer = p.hold && m.s.held ? m.s.held.buf : m.s.buf; s.playbackRate.value = m.rate;
    if (p.hold && m.s.held) { s.loop = true; s.loopStart = m.s.held.loop.start; s.loopEnd = m.s.held.loop.end; }
    // Nuances : les sources n'ont qu'une couche par note ; une note jouée doucement est donc
    // assombrie (moins d'harmoniques aigus) et attaquée un peu moins sec, comme un vrai instrument.
    const soft = recordedDynamics(p.bank) ? 0 : touchSoftness(p, vel);
    if (soft > 0) {
      const tone = c.createBiquadFilter(); tone.type = 'lowpass'; tone.Q.value = 0.5;
      tone.frequency.value = touchCutoff(soft, freq); s.connect(tone).connect(filt); softAttack = soft * 0.015;
    } else s.connect(filt);
    srcs.push(s); level = 0.5 * m.s.gain; startOff = m.s.off;
  } else if (p.engine === 'sampler') {
    const buf = p.bufferId ? buffers?.get(p.bufferId) : undefined;
    if (!buf) return;
    const s = mix.reg(c.createBufferSource()); s.buffer = buf;
    s.playbackRate.value = Math.pow(2, (midi - p.root) / 12 + p.octave);
    s.connect(filt); srcs.push(s); level = 0.9;
  } else {
    const mk = (type: OscillatorType, detune: number, gain: number) => {
      const o = mix.reg(c.createOscillator()), g = c.createGain();
      o.type = type; o.detune.value = detune; g.gain.value = gain;
      if (p.pitchEnv) { o.frequency.setValueAtTime(freq * Math.pow(2, p.pitchEnv / 12), t); o.frequency.exponentialRampToValueAtTime(freq, t + 0.07); }
      else o.frequency.value = freq;
      o.connect(g).connect(filt); srcs.push(o);
    };
    mk(p.wave, 0, 1);
    if (p.mix2 > 0) mk(p.wave2, p.detune, p.mix2);
  }

  filt.type = 'lowpass'; filt.Q.value = p.reso;
  filt.frequency.setValueAtTime(Math.min(18000, p.cutoff + p.envAmt * 9000), t);
  filt.frequency.setTargetAtTime(p.cutoff, t + p.a, Math.max(0.01, p.d / 3));

  const peak = vel * level, sus = peak * p.s, a = Math.max(0.002, p.a, softAttack), dk = Math.max(0.01, p.d / 3), rk = Math.max(0.01, p.r / 3);
  const g = vca.gain;
  g.setValueAtTime(0, t);
  filt.connect(vca).connect(dest);
  // Pitch bend et vibrato (V19) : toutes les voix de la piste suivent la même hauteur commune.
  const pitch = mix.pitchFor.get(dest);
  if (pitch) for (const s of srcs) {
    const d = (s as OscillatorNode | AudioBufferSourceNode).detune;
    if (!d) continue;
    pitch.connect(d);
    if (mix.live) s.addEventListener('ended', () => { try { pitch.disconnect(d); } catch { /* déjà débranché */ } });
  }
  for (const s of srcs) { if (startOff && s instanceof AudioBufferSourceNode) s.start(t, startOff); else s.start(t); }
  const tail = p.r * 2 + 0.1;

  if (dur === null) {
    g.linearRampToValueAtTime(peak, t + a); g.setTargetAtTime(sus, t + a, dk);
    return {
      release(at: number) {
        if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(at); else g.cancelScheduledValues(at);
        g.setTargetAtTime(0, at, rk);
        for (const s of srcs) { try { s.stop(at + tail); } catch { /* déjà arrêté */ } }
      },
    };
  }
  const tR = t + dur;
  if (dur <= a) g.linearRampToValueAtTime(peak * dur / a, tR);
  else {
    g.linearRampToValueAtTime(peak, t + a); g.setTargetAtTime(sus, t + a, dk);
    g.setValueAtTime(sus + (peak - sus) * Math.exp(-(dur - a) / dk), tR);
  }
  g.setTargetAtTime(0, tR, rk);
  for (const s of srcs) s.stop(tR + tail);
}
