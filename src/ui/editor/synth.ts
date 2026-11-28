// Réglages de l'instrument, instruments du Mac (version bureau) et sampler.
import { SUSTAIN_BANKS } from '../../audio/sustain';
import { recordedDynamics } from '../../audio/banks';
import { chooseSound, showSounds } from '../sounds';
import { audioFiles, loadSample, pickFiles } from '../../actions';
import { engine } from '../../audio/engine';
import { auBridge, auInstruments, auName } from '../../audio/au';
import { t } from '../../i18n';
import { commit, emit, S } from '../../store';
import { CATS, PRESETS, Track } from '../../types';
import { icon } from '../icons';
import { clamp, h, pct, slider, toast } from '../dom';
import { noteName } from './names';

// ---------- Instrument : réglages ----------
export function synthPanel(tr: Track, collapsible = false) {
  const sp = tr.synth!;
  const preset = h('select', { 'aria-label': t('syn.sound'), title: t('syn.sound'), data: { role: 'preset' } });
  for (const cat of CATS) {
    const grp = h('optgroup', { label: t('cat.' + cat) });
    for (const [id, def] of Object.entries(PRESETS)) if (def.cat === cat) grp.append(h('option', { value: id, selected: sp.preset === id }, t('ins.' + id)));
    preset.append(grp);
  }
  if (sp.engine === 'au') preset.prepend(h('option', { value: '', selected: true }, '🍎 ' + auName(sp.auName ?? sp.auUrl ?? '')));
  preset.onchange = () => { if (preset.value) chooseSound(tr.id, preset.value); };
  const wave = (key: 'wave' | 'wave2', label: string) => {
    const s = h('select', { 'aria-label': label });
    for (const v of ['sine', 'triangle', 'sawtooth', 'square']) s.append(h('option', { value: v, selected: sp[key] === v }, t('wave.' + v)));
    s.onchange = () => { sp[key] = s.value as OscillatorType; commit(); };
    return h('label', { class: 'fld' }, label, s);
  };
  const ms = (v: number) => Math.round(v * 1000) + ' ms';
  const sl = (key: string, min: number, max: number, step: number, prop: keyof typeof sp, fmt?: (v: number) => string) =>
    slider(t('syn.' + key), min, max, step, clamp(sp[prop] as number, min, max), v => { (sp as any)[prop] = v; }, fmt);
  const specific: (HTMLElement | false)[] =
    sp.engine === 'au' ? [] : sp.engine === 'fm' ? [sl('ratio', 0.5, 8, 0.5, 'ratio', v => '×' + v), sl('fmAmt', 0, 6, 0.05, 'fmAmt', v => v.toFixed(1)), sl('fmDecay', 0.02, 2, 0.01, 'fmDecay', ms)]
      : sp.engine === 'pluck' ? [sl('damp', 0, 1, 0.01, 'damp', pct)]
        : sp.engine === 'sampler' ? [samplerBox(tr)]
          : sp.engine === 'multi' ? [h('span', { class: 'tip real' }, '🎻 ' + t(sp.bank === 'salamander' ? 'syn.recordedLayers' : recordedDynamics(sp.bank) ? 'syn.recordedDynamics' : 'syn.real')), !recordedDynamics(sp.bank) && sl('touch', 0, 1, 0.05, 'touch', pct)]
          : [wave('wave', t('syn.wave1')), wave('wave2', t('syn.wave2')), sl('mix2', 0, 1, 0.01, 'mix2', pct), sl('detune', 0, 50, 1, 'detune', v => v + ' ct'), sl('pitchEnv', 0, 24, 1, 'pitchEnv', v => v + ' st')];
  // Avec un clip ouvert, les réglages détaillés sont repliés pour laisser la place au piano roll.
  const open = !collapsible || S.synthOpen;
  const head: (HTMLElement | false)[] = [h('label', { class: 'fld big' }, t('syn.sound'), preset),
    h('button', { class: 'pill', 'aria-label': t('sounds.browse'), title: t('sounds.browse'), data: { act: 'sound-browser' }, onclick: () => showSounds(tr.id) }, t('sounds.browse')),
    sp.engine === 'multi' && !!sp.bank && SUSTAIN_BANKS.has(sp.bank) && h('button', {
      class: 'pill' + (sp.hold ? ' on' : ''), 'aria-pressed': String(!!sp.hold), title: t('syn.holdTip'), data: { act: 'sustain' },
      onclick: () => { sp.hold = !sp.hold; commit(); },
    }, '∞ ' + t('syn.hold')),
    macInstruments(tr),
    sp.engine === 'au' && h('button', { class: 'pill', data: { act: 'auiwindow' }, title: t('aui.windowTip'), disabled: !engine.mix.instOf(tr.id) || !auBridge()?.uiOpen, onclick: () => openInstWindow(tr) }, '🪟 ' + t('aui.window')),
    sp.engine === 'au' && engine.mix.instOf(tr.id) === undefined && h('span', { class: 'tip', role: 'status', data: { aui: 'state' } }, t(auBridge() ? 'aui.loading' : 'aui.missing')),
    collapsible && h('button', { class: 'pill' + (open ? ' on' : ''), data: { act: 'synthopen' }, 'aria-expanded': String(open), title: t('syn.settingsTip'), onclick: () => { S.synthOpen = !S.synthOpen; emit(); } }, `🎚 ${t('syn.settings')} ${open ? '▴' : '▾'}`),
    h('button', { class: 'pill' + (S.kbShow ? ' on' : ''), data: { act: 'okb' }, 'aria-pressed': String(S.kbShow), title: t('okb.tip'), onclick: () => { S.kbShow = !S.kbShow; emit(); } }, '🎹 ' + t('okb.title')),
    collapsible && h('span', { class: 'tip' }, t('hint.pianoRoll'))];
  if (!open) return h('div', { class: 'synth' }, ...head);
  // Instrument du Mac : ses réglages sont dans sa propre fenêtre ; ici, seulement l'octave et la plage du pitch bend.
  if (sp.engine === 'au') return h('div', { class: 'synth' }, ...head,
    sl('octave', -2, 2, 1, 'octave', v => (v > 0 ? '+' : '') + v), slider(t('syn.bend'), 1, 12, 1, sp.bend ?? 2, v => { sp.bend = v; }, v => '± ' + v + ' st'));
  return h('div', { class: 'synth' },
    ...head, ...specific,
    sl('octave', -2, 2, 1, 'octave', v => (v > 0 ? '+' : '') + v),
    slider(t('syn.bend'), 1, 12, 1, sp.bend ?? 2, v => { sp.bend = v; }, v => '± ' + v + ' st'),
    sl('cutoff', 80, 12000, 10, 'cutoff', v => Math.round(v) + ' Hz'), sl('reso', 0, 18, 0.1, 'reso', v => v.toFixed(1)),
    sl('envAmt', 0, 1, 0.01, 'envAmt', pct),
    sl('a', 0.002, 1.5, 0.001, 'a', ms), sl('d', 0.01, 3, 0.01, 'd', ms), sl('s', 0, 1, 0.01, 's', pct), sl('r', 0.01, 3, 0.01, 'r', ms));
}
// ---------- Instruments du Mac (V19, version bureau macOS) ----------
/** Liste des instruments Audio Unit installés ; le choix d'un instrument remplace le son de la piste. */
function macInstruments(tr: Track) {
  const list = auInstruments(), sp = tr.synth!;
  if (!list.length) return false;
  const sel = h('select', { 'aria-label': t('aui.pick'), title: t('aui.pickTip'), data: { role: 'auinst' } },
    h('option', { value: '' }, '🍎 ' + t('aui.pick') + '…'),
    ...list.map(d => { const url = `${d.type}:${d.subtype}:${d.manufacturer}`; return h('option', { value: url, selected: sp.engine === 'au' && sp.auUrl === url }, auName(d.name)); }));
  sel.onchange = () => {
    const d = list.find(x => `${x.type}:${x.subtype}:${x.manufacturer}` === sel.value);
    if (!d) return;
    Object.assign(sp, { engine: 'au', auUrl: sel.value, auName: d.name, preset: 'au' }); delete sp.auState; delete sp.bank;
    commit();
  };
  return h('label', { class: 'fld' }, t('aui.label'), sel);
}
/** Fenêtre de l'instrument : distribue les évènements du Mac, et recopie l'état du plugin dans le projet (chaque seconde et à la fermeture). */
const instFollow = new Map<string, number>();
function openInstWindow(tr: Track) {
  const br = auBridge(), au = engine.mix.instOf(tr.id);
  if (!br?.uiOpen || !au) return;
  try { br.uiOpen(au.auId); } catch { toast(t('au.uiFail'), 'error'); return; }
  if (instFollow.has(tr.id)) return;
  let n = 0;
  const keep = () => { const st = au.getState(); if (st && tr.synth && tr.synth.engine === 'au' && tr.synth.auState !== st) { tr.synth.auState = st; commit(); } };
  const timer = window.setInterval(() => {
    if (!br.uiIsOpen?.(au.auId) || engine.mix.instOf(tr.id) !== au) { clearInterval(timer); instFollow.delete(tr.id); if (engine.mix.instOf(tr.id) === au) keep(); return; }
    br.uiPump?.();
    if (++n % 33 === 0) keep();
  }, 30);
  instFollow.set(tr.id, timer);
}
function samplerBox(tr: Track) {
  const sp = tr.synth!;
  const set = async (f: File) => { const s = await loadSample(f); if (s) { sp.bufferId = s.id; sp.sampleName = s.name; commit(); engine.previewNote(tr, sp.root); } };
  const root = h('select', { 'aria-label': t('smp.root'), title: t('smp.rootTip') });
  for (let p = 36; p <= 84; p++) root.append(h('option', { value: String(p), selected: sp.root === p }, noteName(p)));
  root.onchange = () => { sp.root = +root.value; commit(); };
  const box = h('div', { class: 'smp' },
    h('button', { data: { act: 'smpload' }, onclick: () => pickFiles(fs => set(fs[0])) }, icon('folder', 15), ' ' + t('smp.load')),
    h('span', { class: 'sname2' + (sp.bufferId ? '' : ' none') }, sp.sampleName ?? t('smp.none')),
    h('label', { class: 'fld' }, t('smp.root'), root));
  box.ondragover = e => { e.preventDefault(); box.classList.add('over'); };
  box.ondragleave = () => box.classList.remove('over');
  box.ondrop = e => { e.preventDefault(); e.stopPropagation(); box.classList.remove('over'); const f = audioFiles(e.dataTransfer?.files)[0]; if (f) set(f); };
  return box;
}
