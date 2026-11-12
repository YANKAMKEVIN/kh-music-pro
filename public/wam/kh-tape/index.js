// KH Tape Echo — plugin web d'exemple livré avec KH Music Pro.
// Il suit l'interface des Web Audio Modules : createInstance(), audioNode, createGui(), getState()/setState().
export default class KhTapeEcho {
  static async createInstance(groupId, audioContext, initialState) {
    const p = new KhTapeEcho(groupId, audioContext);
    if (initialState) await p.audioNode.setState(initialState);
    return p;
  }

  constructor(groupId, ctx) {
    this.groupId = groupId; this.audioContext = ctx;
    this.descriptor = { name: 'KH Tape Echo', vendor: 'KH Music Pro', version: '1.0.0', isInstrument: false, website: '' };
    const input = ctx.createGain(), output = ctx.createGain(), dry = ctx.createGain(), wet = ctx.createGain();
    const delay = ctx.createDelay(2), fb = ctx.createGain(), tone = ctx.createBiquadFilter(), sat = ctx.createWaveShaper();
    const wow = ctx.createOscillator(), wowDepth = ctx.createGain();
    tone.type = 'lowpass'; wow.frequency.value = 0.6; wowDepth.gain.value = 0.0015;
    const curve = new Float32Array(512); for (let i = 0; i < 512; i++) curve[i] = Math.tanh((i / 255.5 - 1) * 1.6) / Math.tanh(1.6);
    sat.curve = curve;
    input.connect(dry).connect(output);
    input.connect(delay).connect(tone).connect(sat).connect(wet).connect(output);
    sat.connect(fb).connect(delay);
    wow.connect(wowDepth).connect(delay.delayTime); wow.start();
    this._n = { delay, fb, tone, wet, dry };
    this._state = { time: 0.28, feedback: 0.45, tone: 2600, mix: 0.4 };
    // Nœud composite : on entre par `input`, mais tout ce qui se branche en sortie part de `output`.
    input.connect = output.connect.bind(output); input.disconnect = output.disconnect.bind(output);
    input.getState = async () => ({ ...this._state });
    input.setState = async s => { Object.assign(this._state, s); this._apply(); };
    input.destroy = () => { try { wow.stop(); } catch (e) { /* déjà arrêté */ } };
    this.audioNode = input;
    this._apply();
  }

  _apply() {
    const s = this._state, n = this._n;
    n.delay.delayTime.value = Math.max(0.02, Math.min(1.9, s.time)); n.fb.gain.value = Math.max(0, Math.min(0.9, s.feedback));
    n.tone.frequency.value = s.tone; n.wet.gain.value = s.mix; n.dry.gain.value = 1;
  }

  async createGui() {
    const el = document.createElement('div');
    el.style.cssText = 'display:grid;grid-template-columns:repeat(2,1fr);gap:8px 16px;font:12px system-ui;';
    const defs = [['time', 'Time', 0.02, 1.2, 0.01], ['feedback', 'Feedback', 0, 0.9, 0.01], ['tone', 'Tone', 300, 9000, 10], ['mix', 'Mix', 0, 1, 0.01]];
    for (const [key, label, min, max, step] of defs) {
      const row = document.createElement('label'), inp = document.createElement('input');
      row.textContent = label + ' '; inp.type = 'range'; inp.min = min; inp.max = max; inp.step = step; inp.value = this._state[key]; inp.dataset.wamParam = key;
      inp.setAttribute('aria-label', label);
      inp.oninput = () => { this._state[key] = +inp.value; this._apply(); };
      row.append(inp); el.append(row);
    }
    return el;
  }

  destroyGui() { }
}
