import { audioFiles, chopClip, chooseInput, deleteClip, doublePattern, duplicateClip, quantizeNotes, shiftPattern, inputs, loadSample, normalizeClip, pickFiles, reverseClip, setLoopToClip, splitClip, stretchClip, toggleInput, transposeClip } from '../actions';
import { engine } from '../audio/engine';
import { noteOf } from '../audio/pitch';
import { hasKey, lang, t } from '../i18n';
import { kb, noteOff, noteOn, padHit, padRelease } from '../input';
import { S, commit, emit, findClip, findTrack } from '../store';
import { BAR, CATS, Clip, GRIDS, KITS, NPADS, Note, PRESETS, SCALES, Track, inScale, makeSynth, resOf, setRes, snapTo, snapToScale, stepDur } from '../types';
import { ICON, drawFades, drawWave } from './arr';
import { clamp, h, pct, slider, toast } from './dom';

const RH = 16, SW = 28, PMAX = 96, PMIN = 24, CELL = 34, LABEL_W = 150;
const SOLF = { fr: ['Do', 'Do#', 'Ré', 'Ré#', 'Mi', 'Fa', 'Fa#', 'Sol', 'Sol#', 'La', 'La#', 'Si'], es: ['Do', 'Do#', 'Re', 'Re#', 'Mi', 'Fa', 'Fa#', 'Sol', 'Sol#', 'La', 'La#', 'Si'], en: ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] };
const isBlack = (p: number) => [1, 3, 6, 8, 10].includes(p % 12);
export const noteName = (p: number) => SOLF[lang()][p % 12] + (Math.floor(p / 12) - 1);
/** Étiquette d'une touche physique selon la disposition la plus probable (AZERTY en français). */
export const keyLabel = (k: string) => lang() === 'fr' ? ({ A: 'Q', Q: 'A', W: 'Z', Z: 'W' } as Record<string, string>)[k] ?? k : k;
export const PAD_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', 'A', 'S', 'D', 'F', 'G', 'H', 'J', 'K'];
export const padName = (tr: Track, r: number) => tr.pads?.[r]?.name ?? t(tr.kit === 'acoustic' && hasKey('da' + r) ? 'da' + r : 'd' + r);

let lastLen = 2;
let scrollKey = '', scrollPos = { x: 0, y: 0 };
let edStepW = 0, edRes = 1;

function lengthSelect(c: Clip, opts: number[]) {
  const sel = h('select', { 'aria-label': t('ed.length'), title: t('ed.length'), data: { role: 'length' } });
  for (const b of opts) sel.append(h('option', { value: String(b * BAR), selected: c.patLen === b * BAR }, t(b > 1 ? 'ed.bars' : 'ed.bar', b)));
  sel.onchange = () => {
    const n = +sel.value;
    if (c.drums) { const cells = Math.max(1, Math.round(n * resOf(c))); c.drums = c.drums.map(r => Array.from({ length: cells }, (_, i) => r[i] ?? 0)); }
    if (c.notes) c.notes = c.notes.filter(x => x.s < n).map(x => ({ ...x, l: Math.min(x.l, n - x.s) }));
    c.patLen = n; c.offset = 0; if (c.len < n) c.len = n;
    commit();
  };
  return h('label', { class: 'fld' }, t('ed.length'), sel);
}

function clipTools(c: Clip) {
  const name = h('input', { class: 'cname-in', value: c.name, 'aria-label': t('clip.name'), spellcheck: false });
  name.onchange = () => { c.name = name.value.trim() || c.name; commit(); };
  const b = (key: string, icon: string, fn: () => void, cls = '') => h('button', { class: cls, title: t('tip.' + key), data: { act: key }, onclick: fn }, `${icon} ${t('act.' + key)}`);
  return h('div', { class: 'tools' }, name, b('dup', '⧉', duplicateClip), b('split', '✂', splitClip), b('loop', '⟲', setLoopToClip), b('del', '🗑', deleteClip, 'danger'));
}

// ---------- Batterie : séquenceur et pads ----------
function drumBar(tr: Track, c: Clip | null) {
  const kit = h('select', { 'aria-label': t('drum.kit'), data: { role: 'kit' } });
  for (const k of Object.keys(KITS)) kit.append(h('option', { value: k, selected: tr.kit === k }, t('kit.' + k)));
  kit.onchange = async () => { tr.kit = kit.value; commit(); if (kit.value === 'acoustic') await engine.loadBank('drums'); engine.pad(tr, 0); };
  const view = (v: 'seq' | 'pads', label: string) => h('button', {
    class: 'seg' + (S.drumView === v || (!c && v === 'pads') ? ' on' : ''), disabled: !c && v === 'seq', data: { view: v },
    onclick: () => { S.drumView = v; emit(); },
  }, label);
  return h('div', { class: 'ebar' }, h('strong', {}, `${ICON.drums} ${tr.name}`),
    h('div', { class: 'segs', role: 'group' }, view('seq', t('drum.seq')), view('pads', t('drum.pads'))),
    c && clipTools(c), c && lengthSelect(c, [1, 2, 4]), c && resSelect(c),
    h('label', { class: 'fld' }, t('drum.kit'), kit),
    slider(t('drum.swing'), 0, 0.6, 0.01, S.project.swing, v => S.project.swing = v, pct),
    c && h('button', { title: t('tip.clear'), data: { act: 'clear' }, onclick: () => { c.drums = c.drums!.map(r => r.map(() => 0)); commit(); } }, t('act.clear')),
    c && h('div', { class: 'segs', role: 'group', 'aria-label': t('pat.tools') },
      h('button', { class: 'seg', data: { act: 'patleft' }, title: t('pat.left'), 'aria-label': t('pat.left'), onclick: () => shiftPattern(-1) }, '◀'),
      h('button', { class: 'seg', data: { act: 'patright' }, title: t('pat.right'), 'aria-label': t('pat.right'), onclick: () => shiftPattern(1) }, '▶'),
      h('button', { class: 'seg', data: { act: 'patdouble' }, title: t('pat.double'), 'aria-label': t('pat.double'), onclick: doublePattern }, '×2')),
    c && S.drumView === 'seq' && h('span', { class: 'tip' }, t('hint.accent')));
}

/** Résolution du motif de batterie : doubles-croches, triples-croches ou triolets. */
function resSelect(c: Clip) {
  const sel = h('select', { 'aria-label': t('ed.res'), title: t('ed.resTip'), data: { role: 'res' } },
    ...[[1, '1/16'], [2, '1/32'], [0.75, t('grid.8t')], [1.5, t('grid.16t')]].map(([v, l]) => h('option', { value: String(v), selected: resOf(c) === v }, String(l))));
  sel.onchange = () => { setRes(c, +sel.value); commit(); };
  return h('label', { class: 'fld' }, t('ed.res'), sel);
}

function padsView(tr: Track) {
  const grid = h('div', { class: 'pads' });
  for (let r = 0; r < NPADS; r++) {
    const custom = tr.pads?.[r];
    const setSample = async (f: File) => { const s = await loadSample(f); if (s) { tr.pads![r] = { bufferId: s.id, name: s.name }; commit(); engine.pad(tr, r); } };
    const pad = h('div', { class: 'pad' + (custom ? ' custom' : '') + (S.padEdit === r ? ' editing' : '') + (tr.padFx?.[r] ? ' tuned' : ''), data: { pad: String(r) }, role: 'button', tabIndex: 0, 'aria-label': padName(tr, r) },
      h('kbd', {}, keyLabel(PAD_KEYS[r])), h('span', { class: 'pad-name' }, padName(tr, r)),
      h('span', { class: 'pact' },
        h('button', { title: t('pad.settings'), 'aria-label': `${t('pad.settings')} – ${padName(tr, r)}`, data: { act: 'padfx' }, onclick: (e: Event) => { e.stopPropagation(); S.padEdit = S.padEdit === r ? -1 : r; emit(); } }, '⚙'),
        h('button', { title: t('pad.load'), 'aria-label': t('pad.load'), data: { act: 'padload' }, onclick: (e: Event) => { e.stopPropagation(); pickFiles(fs => setSample(fs[0])); } }, '📂'),
        custom && h('button', { title: t('pad.reset'), 'aria-label': t('pad.reset'), data: { act: 'padreset' }, onclick: (e: Event) => { e.stopPropagation(); tr.pads![r] = null; commit(); } }, '↺')));
    pad.onpointerdown = e => {
      if ((e.target as HTMLElement).closest('.pact')) return;
      e.preventDefault(); padHit(r, 1, tr); flashPad(r);
      const up = () => { padRelease(r); removeEventListener('pointerup', up); removeEventListener('pointercancel', up); };
      addEventListener('pointerup', up); addEventListener('pointercancel', up);
    };
    pad.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); padHit(r, 1, tr); flashPad(r); } };
    pad.ondragover = e => { e.preventDefault(); pad.classList.add('over'); };
    pad.ondragleave = () => pad.classList.remove('over');
    pad.ondrop = e => { e.preventDefault(); e.stopPropagation(); pad.classList.remove('over'); const f = audioFiles(e.dataTransfer?.files)[0]; if (f) setSample(f); };
    grid.append(pad);
  }
  const rep = h('select', { 'aria-label': t('pad.repeat'), title: t('pad.repeatTip'), data: { role: 'repeat' } }, ...[[0, t('chord.1')], [1, '1/16'], [2, '1/8'], [4, '1/4']].map(([v, l]) => h('option', { value: String(v), selected: kb.repeat === v }, String(l))));
  rep.onchange = () => { kb.repeat = +rep.value; rep.blur(); };
  // Réglages du pad choisi avec ⚙ : volume, hauteur, panoramique.
  let fxBox: HTMLElement | false = false;
  if (S.padEdit >= 0 && S.padEdit < NPADS) {
    const r = S.padEdit, cur = tr.padFx?.[r] ?? { vol: 1, tune: 0, pan: 0 };
    const set = (k: 'vol' | 'tune' | 'pan', v: number) => { tr.padFx ??= {}; const f = tr.padFx[r] ??= { vol: 1, tune: 0, pan: 0 }; f[k] = v; if (f.vol === 1 && !f.tune && !f.pan) delete tr.padFx[r]; };
    fxBox = h('div', { class: 'padfx' }, h('strong', {}, `⚙ ${padName(tr, r)}`),
      slider(t('mix.volume'), 0, 1.5, 0.01, cur.vol, v => set('vol', v), pct),
      slider(t('st.pitch'), -12, 12, 1, cur.tune, v => set('tune', v), v => (v > 0 ? '+' : '') + v + ' st'),
      slider(t('mix.pan'), -1, 1, 0.01, cur.pan, v => set('pan', Math.abs(v) < 0.04 ? 0 : v), v => String(Math.round(v * 100))),
      h('div', { class: 'tools' },
        h('button', { class: 'pill', data: { act: 'padtest' }, onclick: () => { padHit(r, 1, tr); flashPad(r); } }, '▶ ' + t('pad.test')),
        h('button', { class: 'pill', data: { act: 'padfxload' }, onclick: () => pickFiles(async fs => { const smp = await loadSample(fs[0]); if (smp) { tr.pads![r] = { bufferId: smp.id, name: smp.name }; commit(); } }) }, '📂 ' + t('smp.load')),
        h('button', { class: 'pill', data: { act: 'padfxreset' }, onclick: () => { if (tr.padFx) delete tr.padFx[r]; commit(); } }, '↺ ' + t('pad.fxReset'))));
  }
  // Choix du pad à régler par une liste : indispensable au doigt, où les petits boutons des pads sont masqués.
  const pick = h('select', { 'aria-label': t('pad.settings'), title: t('pad.settings'), data: { role: 'padpick' } }, h('option', { value: '-1' }, '—'), ...Array.from({ length: NPADS }, (_, r) => h('option', { value: String(r), selected: S.padEdit === r }, `${r + 1} · ${padName(tr, r)}`)));
  pick.onchange = () => { S.padEdit = +pick.value; emit(); };
  return h('div', { class: 'escroll padwrap' }, grid, h('div', { class: 'padside' }, h('label', { class: 'fld' }, t('pad.settings'), pick), fxBox, h('label', { class: 'fld' }, t('pad.repeat'), rep), h('p', { class: 'tip' }, t('pad.help'))));
}

export function flashPad(r: number) {
  const el = document.querySelector<HTMLElement>(`.pad[data-pad="${r}"]`);
  if (!el) return;
  el.classList.remove('hit'); void el.offsetWidth; el.classList.add('hit');
}

function drumEditor(tr: Track, c: Clip | null) {
  if (!c || S.drumView === 'pads') return h('div', { class: 'editor' }, drumBar(tr, c), padsView(tr));
  const res = resOf(c), cw = res > 1 ? 20 : 30;
  const grid = h('div', { class: 'dgrid ed-grid', style: `--cw:${cw}px` });
  // Regroupement visuel par temps : le pas d'une case vaut 1/res double-croche.
  const beat = (s: number) => Math.floor(s / res / 4 + 1e-6), isBar = (s: number) => s > 0 && Math.abs(s / res / BAR - Math.round(s / res / BAR)) < 1e-6;
  c.drums!.forEach((row, r) => {
    const line = h('div', { class: 'drow' },
      h('button', { class: 'dlabel', title: t('drum.listen', padName(tr, r)), onclick: () => engine.pad(tr, r) }, h('kbd', {}, keyLabel(PAD_KEYS[r])), h('span', {}, padName(tr, r))));
    row.forEach((v, s) => line.append(h('button', {
      class: `cell${v ? ' on' : ''}${v && v < 1 ? ' soft' : ''}${beat(s) % 2 ? ' alt' : ''}${isBar(s) ? ' barstart' : ''}`,
      data: { r: String(r), s: String(s) }, 'aria-label': `${padName(tr, r)} ${s + 1}`, 'aria-pressed': String(!!v),
    })));
    grid.append(line);
  });
  const setCell = (el: HTMLElement, v: number) => {
    const r = +el.dataset.r!, s = +el.dataset.s!;
    if (c.drums![r][s] === v) return;
    c.drums![r][s] = v; el.classList.toggle('on', !!v); el.classList.toggle('soft', v > 0 && v < 1); el.setAttribute('aria-pressed', String(!!v));
    if (v && !engine.playing) engine.pad(tr, r, v);
  };
  grid.onpointerdown = e => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('.cell');
    if (!el) return;
    e.preventDefault();
    // Maj+clic ou clic droit : note douce (accent faible) ; clic simple : note pleine ou effacement.
    const cur = c.drums![+el.dataset.r!][+el.dataset.s!];
    const v = e.shiftKey || e.button === 2 ? (cur === 0.5 ? 1 : 0.5) : cur ? 0 : 1;
    setCell(el, v);
    const mv = (ev: PointerEvent) => { const x = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>('.cell'); if (x && grid.contains(x)) setCell(x, v); };
    const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); removeEventListener('pointercancel', up); commit(); };
    addEventListener('pointermove', mv); addEventListener('pointerup', up); addEventListener('pointercancel', up);
  };
  grid.oncontextmenu = e => e.preventDefault();
  grid.onkeydown = e => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('.cell');
    if (el && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); e.stopPropagation(); setCell(el, c.drums![+el.dataset.r!][+el.dataset.s!] ? 0 : 1); commit(); }
  };
  grid.append(h('div', { class: 'ed-ph' }));
  edStepW = cw + 4; edRes = res;
  return h('div', { class: 'editor' }, drumBar(tr, c), h('div', { class: 'escroll' }, grid));
}

// ---------- Instrument : réglages ----------
function synthPanel(tr: Track, collapsible = false) {
  const sp = tr.synth!;
  const preset = h('select', { 'aria-label': t('syn.sound'), title: t('syn.sound'), data: { role: 'preset' } });
  for (const cat of CATS) {
    const grp = h('optgroup', { label: t('cat.' + cat) });
    for (const [id, def] of Object.entries(PRESETS)) if (def.cat === cat) grp.append(h('option', { value: id, selected: sp.preset === id }, t('ins.' + id)));
    preset.append(grp);
  }
  preset.onchange = () => {
    const keep = { bufferId: sp.bufferId, sampleName: sp.sampleName, root: sp.root };
    tr.synth = { ...makeSynth(preset.value), ...keep }; commit();
    const bank = tr.synth.engine === 'multi' ? tr.synth.bank : undefined;
    if (bank) engine.loadBank(bank).then(ok => { if (ok) engine.previewNote(tr, 60 + kb.octave * 12); }); else engine.previewNote(tr, 60 + kb.octave * 12);
  };
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
    sp.engine === 'fm' ? [sl('ratio', 0.5, 8, 0.5, 'ratio', v => '×' + v), sl('fmAmt', 0, 6, 0.05, 'fmAmt', v => v.toFixed(1)), sl('fmDecay', 0.02, 2, 0.01, 'fmDecay', ms)]
      : sp.engine === 'pluck' ? [sl('damp', 0, 1, 0.01, 'damp', pct)]
        : sp.engine === 'sampler' ? [samplerBox(tr)]
          : sp.engine === 'multi' ? [h('span', { class: 'tip real' }, '🎻 ' + t('syn.real'))]
          : [wave('wave', t('syn.wave1')), wave('wave2', t('syn.wave2')), sl('mix2', 0, 1, 0.01, 'mix2', pct), sl('detune', 0, 50, 1, 'detune', v => v + ' ct'), sl('pitchEnv', 0, 24, 1, 'pitchEnv', v => v + ' st')];
  // Avec un clip ouvert, les réglages détaillés sont repliés pour laisser la place au piano roll.
  const open = !collapsible || S.synthOpen;
  const head = [h('label', { class: 'fld big' }, t('syn.sound'), preset),
    collapsible && h('button', { class: 'pill' + (open ? ' on' : ''), data: { act: 'synthopen' }, 'aria-expanded': String(open), title: t('syn.settingsTip'), onclick: () => { S.synthOpen = !S.synthOpen; emit(); } }, `🎚 ${t('syn.settings')} ${open ? '▴' : '▾'}`),
    h('button', { class: 'pill' + (S.kbShow ? ' on' : ''), data: { act: 'okb' }, 'aria-pressed': String(S.kbShow), title: t('okb.tip'), onclick: () => { S.kbShow = !S.kbShow; emit(); } }, '🎹 ' + t('okb.title')),
    collapsible && h('span', { class: 'tip' }, t('hint.pianoRoll'))];
  if (!open) return h('div', { class: 'synth' }, ...head);
  return h('div', { class: 'synth' },
    ...head, ...specific,
    sl('octave', -2, 2, 1, 'octave', v => (v > 0 ? '+' : '') + v),
    sl('cutoff', 80, 12000, 10, 'cutoff', v => Math.round(v) + ' Hz'), sl('reso', 0, 18, 0.1, 'reso', v => v.toFixed(1)),
    sl('envAmt', 0, 1, 0.01, 'envAmt', pct),
    sl('a', 0.002, 1.5, 0.001, 'a', ms), sl('d', 0.01, 3, 0.01, 'd', ms), sl('s', 0, 1, 0.01, 's', pct), sl('r', 0.01, 3, 0.01, 'r', ms));
}

function samplerBox(tr: Track) {
  const sp = tr.synth!;
  const set = async (f: File) => { const s = await loadSample(f); if (s) { sp.bufferId = s.id; sp.sampleName = s.name; commit(); engine.previewNote(tr, sp.root); } };
  const root = h('select', { 'aria-label': t('smp.root'), title: t('smp.rootTip') });
  for (let p = 36; p <= 84; p++) root.append(h('option', { value: String(p), selected: sp.root === p }, noteName(p)));
  root.onchange = () => { sp.root = +root.value; commit(); };
  const box = h('div', { class: 'smp' },
    h('button', { data: { act: 'smpload' }, onclick: () => pickFiles(fs => set(fs[0])) }, '📂 ' + t('smp.load')),
    h('span', { class: 'sname2' + (sp.bufferId ? '' : ' none') }, sp.sampleName ?? t('smp.none')),
    h('label', { class: 'fld' }, t('smp.root'), root));
  box.ondragover = e => { e.preventDefault(); box.classList.add('over'); };
  box.ondragleave = () => box.classList.remove('over');
  box.ondrop = e => { e.preventDefault(); e.stopPropagation(); box.classList.remove('over'); const f = audioFiles(e.dataTransfer?.files)[0]; if (f) set(f); };
  return box;
}

// ---------- Clavier à l'écran ----------
function screenKeys() {
  // Deux octaves sur grand écran, une seule sur téléphone pour garder des touches assez larges pour le doigt.
  const base = 48 + kb.octave * 12, N = innerWidth < 760 ? 13 : 25, whites: number[] = [];
  for (let m = base; m < base + N; m++) if (!isBlack(m)) whites.push(m);
  const el = h('div', { class: 'okb-keys', style: `--nw:${N === 13 ? 8 : 15}` });
  whites.forEach(m => el.append(h('div', { class: 'wk', data: { m: String(m) } }, m % 12 === 0 ? noteName(m) : '')));
  for (let m = base; m < base + N; m++) if (isBlack(m)) {
    const i = whites.findIndex(w => w > m);
    el.append(h('div', { class: 'bk', data: { m: String(m) }, style: `left:calc(${i} * 100% / ${whites.length} - 100% / ${whites.length} * .3)` }));
  }
  // Plusieurs doigts, et glissé d'une touche à l'autre.
  const down = new Map<number, number>();
  const at = (e: PointerEvent) => { const k = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>('[data-m]'); return k && el.contains(k) ? +k.dataset.m! : null; };
  const mark = (m: number, on: boolean) => el.querySelector(`[data-m="${m}"]`)?.classList.toggle('on', on);
  const set = (id: number, m: number | null) => {
    const cur = down.get(id);
    if (cur === m || (cur === undefined && m === null)) return;
    if (cur !== undefined) { noteOff(cur); mark(cur, false); down.delete(id); }
    if (m !== null && ![...down.values()].includes(m)) { noteOn(m, 0.8); mark(m, true); down.set(id, m); }
  };
  el.onpointerdown = e => { e.preventDefault(); try { el.setPointerCapture(e.pointerId); } catch { /* pointeur synthétique */ } set(e.pointerId, at(e)); };
  el.onpointermove = e => { if (down.has(e.pointerId)) set(e.pointerId, at(e)); };
  el.onpointerup = el.onpointercancel = e => set(e.pointerId, null);
  const oct = (d: number, label: string) => h('button', { class: 'pill', data: { act: d < 0 ? 'octdown' : 'octup' }, 'aria-label': t('help.k.octave') + ' ' + label, title: t('help.k.octave'), onclick: () => { kb.octave = clamp(kb.octave + d, -3, 3); emit(); } }, label);
  return h('div', { class: 'okb', role: 'group', 'aria-label': t('okb.title') }, oct(-1, '−'), el, oct(1, '+'));
}

// ---------- Sélection de notes ----------
let selNotes = new Set<Note>(), selOwner = '', clipboard: Note[] = [];

/** Raccourcis du piano roll (sélection, copier/coller, flèches). Renvoie vrai si la touche a été traitée. */
export function notesKey(e: KeyboardEvent): boolean {
  const f = S.tab === 'editor' ? findClip(S.selClip) : null, c = f?.clip;
  if (!c?.notes) return false;
  const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase(), sel = c.notes.filter(n => selNotes.has(n));
  if (mod && k === 'a') { selNotes = new Set(c.notes); selOwner = c.id; emit(); return true; }
  if (mod && k === 'v' && clipboard.length) {
    const step = engine.currentStep(), inside = step >= c.start && step < c.start + c.len;
    const at = inside ? Math.round(step - c.start + c.offset) % c.patLen! : 0, min = Math.min(...clipboard.map(n => n.s));
    const added = clipboard.map(n => ({ ...n, s: n.s - min + at })).filter(n => n.s < c.patLen!).map(n => ({ ...n, l: Math.min(n.l, c.patLen! - n.s) }));
    if (!added.length) return true;
    c.notes.push(...added); selNotes = new Set(added); selOwner = c.id; commit(); toast(t('toast.pasted', added.length)); return true;
  }
  if (!sel.length) return false;
  if (mod && k === 'c') { clipboard = sel.map(n => ({ ...n })); toast(t('toast.copied', sel.length)); return true; }
  if (mod) return false;
  if (e.key === 'Escape') { selNotes.clear(); emit(); return true; }
  if (e.key === 'Delete' || e.key === 'Backspace') { c.notes = c.notes.filter(n => !selNotes.has(n)); selNotes.clear(); commit(); return true; }
  const G = GRIDS[S.grid] ?? 1, dp = e.key === 'ArrowUp' ? 1 : e.key === 'ArrowDown' ? -1 : 0, ds = e.key === 'ArrowRight' ? G : e.key === 'ArrowLeft' ? -G : 0;
  if (!dp && !ds) return false;
  const P = dp * (e.shiftKey ? 12 : 1);
  if (sel.some(n => n.p + P < PMIN || n.p + P > PMAX || n.s + ds < -1e-6 || n.s + n.l + ds > c.patLen! + 1e-6)) return true;
  for (const n of sel) { n.p += P; n.s = Math.max(0, snapTo(n.s + ds, 1 / 24)); }
  commit(); return true;
}

// ---------- Grille des notes ----------
function gridTools(c: Clip) {
  const sel = h('select', { 'aria-label': t('ed.grid'), title: t('ed.gridTip'), data: { role: 'notegrid' } },
    ...[['16', '1/16'], ['32', '1/32'], ['8t', t('grid.8t')], ['16t', t('grid.16t')], ['free', t('grid.free')]].map(([v, l]) => h('option', { value: v, selected: S.grid === v }, l)));
  sel.onchange = () => { S.grid = sel.value; emit(); };
  return h('div', { class: 'tools' }, h('label', { class: 'fld' }, t('ed.grid'), sel),
    h('button', { title: t('tip.quantize'), data: { act: 'quantize' }, onclick: () => { const sel2 = c.notes!.filter(n => selNotes.has(n)); quantizeNotes(sel2.length ? sel2 : c.notes!, GRIDS[S.grid] ?? 1, c.patLen!); } }, '🧲 ' + t('act.quantize')));
}

// ---------- Gamme et accords ----------
function scaleTools() {
  const P = S.project;
  const key = h('select', { 'aria-label': t('ed.key'), title: t('ed.key'), data: { role: 'key' } }, ...SOLF[lang()].map((n, i) => h('option', { value: String(i), selected: P.key === i }, n)));
  key.onchange = () => { P.key = +key.value; commit(); };
  const scale = h('select', { 'aria-label': t('ed.scale'), title: t('ed.scaleTip'), data: { role: 'scale' } }, ...Object.keys(SCALES).map(k => h('option', { value: k, selected: P.scale === k }, t('scale.' + k))));
  scale.onchange = () => { P.scale = scale.value; commit(); };
  const chord = h('select', { 'aria-label': t('ed.chord'), title: t('ed.chordTip'), data: { role: 'chord' } }, ...[1, 3, 4].map(n => h('option', { value: String(n), selected: kb.chord === n }, t('chord.' + n))));
  chord.onchange = () => { kb.chord = +chord.value; chord.blur(); };
  const arp = h('select', { 'aria-label': t('ed.arp'), title: t('ed.arpTip'), data: { role: 'arp' } }, ...['off', 'up', 'down', 'updown', 'random'].map(k => h('option', { value: k, selected: kb.arp === k }, t('arp.' + k))));
  arp.onchange = () => { kb.arp = arp.value as typeof kb.arp; arp.blur(); };
  const rate = h('select', { 'aria-label': t('ed.arpRate'), title: t('ed.arpRate'), data: { role: 'arprate' } }, ...[[1, '1/16'], [2, '1/8'], [4, '1/4']].map(([v, l]) => h('option', { value: String(v), selected: kb.arpRate === v }, String(l))));
  rate.onchange = () => { kb.arpRate = +rate.value; rate.blur(); };
  return h('div', { class: 'tools' }, h('label', { class: 'fld' }, t('ed.scale'), key, scale), h('label', { class: 'fld' }, t('ed.chord'), chord), h('label', { class: 'fld' }, t('ed.arp'), arp, rate));
}

// ---------- Piano roll ----------
function pianoRoll(tr: Track, c: Clip) {
  const rows = PMAX - PMIN + 1, W = c.patLen! * SW, P = S.project, scaled = P.scale !== 'off', G = GRIDS[S.grid] ?? 1;
  const fit = (p: number) => clamp(scaled ? snapToScale(P, p) : p, PMIN, PMAX);
  if (selOwner !== c.id) { selNotes.clear(); selOwner = c.id; }
  const refreshSel = () => grid.querySelectorAll<HTMLElement>('.note').forEach(el => el.classList.toggle('sel', selNotes.has(c.notes![+el.dataset.i!])));
  const keys = h('div', { class: 'keys' });
  const grid = h('div', { class: 'pr-grid ed-grid', style: `width:${W}px;height:${rows * RH}px;--sw:${SW}px;--rh:${RH}px;--gw:${G * SW}px` });
  for (let p = PMAX; p >= PMIN; p--) {
    keys.append(h('button', {
      class: 'key' + (isBlack(p) ? ' black' : '') + (p % 12 === 0 ? ' c' : '') + (scaled && (p - P.key) % 12 === 0 ? ' root' : ''), tabIndex: -1, 'aria-label': noteName(p),
      onpointerdown: () => engine.previewNote(tr, p),
    }, p % 12 === 0 ? noteName(p) : ''));
    if (scaled ? !inScale(P, p) : isBlack(p)) grid.append(h('div', { class: 'blk' + (scaled ? ' oos' : ''), style: `top:${(PMAX - p) * RH}px` }));
    if (p % 12 === 0) grid.append(h('div', { class: 'oct', style: `top:${(PMAX - p + 1) * RH}px` }));
  }
  const place = (el: HTMLElement, n: Note) => { el.style.cssText = `left:${n.s * SW}px;top:${(PMAX - n.p) * RH}px;width:${n.l * SW - 1}px;opacity:${(0.4 + 0.6 * n.v).toFixed(2)}`; el.title = noteName(n.p); };
  const mk = (n: Note, i: number) => { const el = h('div', { class: 'note' + (selNotes.has(n) ? ' sel' : ''), data: { i: String(i) } }, h('i', {})); place(el, n); return el; };
  c.notes!.forEach((n, i) => grid.append(mk(n, i)));
  grid.append(h('div', { class: 'ed-ph' }));

  grid.oncontextmenu = e => e.preventDefault();
  grid.ondblclick = e => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('.note');
    if (el) { selNotes.delete(c.notes![+el.dataset.i!]); c.notes!.splice(+el.dataset.i!, 1); commit(); }
  };
  grid.onpointerdown = e => {
    e.preventDefault();
    const r = grid.getBoundingClientRect();
    let el = (e.target as HTMLElement).closest<HTMLElement>('.note');
    let note: Note, resize: boolean;
    if (!el && e.shiftKey && e.button === 0) {
      // Maj+glisser dans le vide : rectangle de sélection.
      const x0 = e.clientX - r.left, y0 = e.clientY - r.top, box = h('div', { class: 'marq' }); grid.append(box);
      let x1 = x0, y1 = y0;
      const mv = (ev: PointerEvent) => { x1 = ev.clientX - r.left; y1 = ev.clientY - r.top; box.style.cssText = `left:${Math.min(x0, x1)}px;top:${Math.min(y0, y1)}px;width:${Math.abs(x1 - x0)}px;height:${Math.abs(y1 - y0)}px`; };
      const up = () => {
        removeEventListener('pointermove', mv); removeEventListener('pointerup', up); box.remove();
        const sa = Math.min(x0, x1) / SW, sb = Math.max(x0, x1) / SW, pa = PMAX - Math.floor(Math.max(y0, y1) / RH), pb = PMAX - Math.floor(Math.min(y0, y1) / RH);
        selNotes = new Set(c.notes!.filter(n => n.s < sb && n.s + n.l > sa && n.p >= pa && n.p <= pb)); refreshSel();
      };
      addEventListener('pointermove', mv); addEventListener('pointerup', up);
      return;
    }
    if (el) {
      note = c.notes![+el.dataset.i!];
      if (e.button === 2) { selNotes.delete(note); c.notes!.splice(c.notes!.indexOf(note), 1); commit(); return; }
      if (e.shiftKey) { if (selNotes.has(note)) selNotes.delete(note); else selNotes.add(note); refreshSel(); return; }
      if (!selNotes.has(note)) { selNotes.clear(); selNotes.add(note); refreshSel(); }
      resize = e.clientX > el.getBoundingClientRect().right - 8;
    } else {
      if (e.button !== 0) return;
      const s = clamp(snapTo(Math.floor((e.clientX - r.left) / SW / G + 1e-6) * G, G), 0, c.patLen! - G);
      note = { p: fit(PMAX - Math.floor((e.clientY - r.top) / RH)), s, l: Math.min(Math.max(G, snapTo(lastLen, G)), c.patLen! - s), v: 0.8 };
      c.notes!.push(note); selNotes.clear(); selNotes.add(note); el = mk(note, c.notes!.length - 1); grid.append(el); refreshSel(); resize = true;
    }
    engine.previewNote(tr, note.p);
    const o = { ...note }, sx = e.clientX, sy = e.clientY, node = el;
    node.classList.add('drag');
    const mv = (ev: PointerEvent) => {
      const dx = snapTo((ev.clientX - sx) / SW, G), dy = Math.round((ev.clientY - sy) / RH);
      if (resize) { note.l = clamp(snapTo(o.l + dx, G), G, c.patLen! - note.s); place(node, note); return; }
      // Déplacement de toute la sélection, bornée pour qu'aucune note ne sorte du clip.
      const cdx = clamp(dx, -Math.min(...group.map(g => g.o.s)), Math.min(...group.map(g => c.patLen! - g.o.s - g.o.l)));
      const cdy = clamp(dy, Math.max(...group.map(g => g.o.p)) - PMAX, Math.min(...group.map(g => g.o.p)) - PMIN);
      for (const g of group) {
        g.n.s = snapTo(g.o.s + cdx, 1 / 24);
        const np = fit(g.o.p - cdy);
        if (np !== g.n.p) { g.n.p = np; if (g.n === note) engine.previewNote(tr, np); }
        if (g.el) place(g.el, g.n);
      }
    };
    const group = [...selNotes].filter(n => c.notes!.includes(n)).map(n => ({ n, o: { ...n }, el: n === note ? node : grid.querySelector<HTMLElement>(`.note[data-i="${c.notes!.indexOf(n)}"]`) }));
    const created = !o.l || resize && !(e.target as HTMLElement).closest('.note');
    const up = () => {
      removeEventListener('pointermove', mv); removeEventListener('pointerup', up); lastLen = note.l; node.classList.remove('drag');
      if (created || note.l !== o.l || group.some(g => g.n.s !== g.o.s || g.n.p !== g.o.p)) commit();
    };
    addEventListener('pointermove', mv); addEventListener('pointerup', up);
  };

  // Vélocité : une barre par note, à régler en glissant.
  const vel = h('div', { class: 'vel', style: `width:${W}px;--sw:${SW}px` });
  const bars = c.notes!.map((n, i) => h('div', { class: 'vbar', data: { i: String(i) }, style: `left:${n.s * SW + 4}px;height:${Math.round(n.v * 100)}%` }));
  vel.append(...bars);
  vel.onpointerdown = e => {
    e.preventDefault();
    const r = vel.getBoundingClientRect(); let changed = false;
    const apply = (ev: PointerEvent) => {
      const s = Math.floor((ev.clientX - r.left) / SW), v = Math.round(clamp(1 - (ev.clientY - r.top) / r.height, 0.05, 1) * 100) / 100;
      c.notes!.forEach((n, i) => {
        if (Math.floor(n.s + 1e-6) !== s || !bars[i]) return;
        n.v = v; changed = true; bars[i].style.height = Math.round(v * 100) + '%';
        const el = grid.querySelector<HTMLElement>(`.note[data-i="${i}"]`); if (el) el.style.opacity = (0.4 + 0.6 * v).toFixed(2);
      });
    };
    apply(e);
    const up = () => { removeEventListener('pointermove', apply); removeEventListener('pointerup', up); if (changed) commit(); };
    addEventListener('pointermove', apply); addEventListener('pointerup', up);
  };
  const scroll = h('div', { class: 'pr' }, h('div', { class: 'pr-inner' }, keys, grid),
    h('div', { class: 'vel-row' }, h('div', { class: 'vel-lbl', title: t('tip.velocity') }, t('ed.velocity')), vel));
  const key = c.id;
  scroll.onscroll = () => { scrollKey = key; scrollPos = { x: scroll.scrollLeft, y: scroll.scrollTop }; };
  const restore = scrollKey === key ? { ...scrollPos } : null;
  queueMicrotask(() => {
    if (restore) { scroll.scrollLeft = restore.x; scroll.scrollTop = restore.y; return; }
    const ps = c.notes!.map(n => n.p), center = ps.length ? (Math.max(...ps) + Math.min(...ps)) / 2 : 60;
    scroll.scrollTop = (PMAX - center) * RH - (scroll.clientHeight - 58) / 2;
  });
  edStepW = SW;
  return h('div', { class: 'editor' },
    h('div', { class: 'ebar' }, h('strong', {}, `${ICON.synth} ${tr.name}`), clipTools(c), lengthSelect(c, [1, 2, 4, 8]),
      h('div', { class: 'segs', role: 'group', 'aria-label': t('ed.transpose'), title: t('ed.transpose') },
        ...[-12, -1, 1, 12].map(n => h('button', { class: 'seg', data: { act: 'tr' + n }, 'aria-label': `${t('ed.transpose')} ${n > 0 ? '+' : ''}${n}`, onclick: () => transposeClip(n) }, (n > 0 ? '+' : '−') + Math.abs(n)))),
      gridTools(c), scaleTools()),
    synthPanel(tr, true), S.kbShow && screenKeys(), scroll);
}

// ---------- Entrée audio ----------
function inputPanel() {
  const on = !!engine.inp;
  const dev = h('select', { 'aria-label': t('in.device'), title: t('in.device'), data: { role: 'indev' } },
    h('option', { value: '' }, t('in.default')), ...inputs.map(d => h('option', { value: d.id, selected: S.inputDevice === d.id }, d.label)));
  dev.onchange = () => chooseInput(dev.value);
  return h('div', { class: 'ebar inbar' }, h('span', { class: 'sect' }, t('in.title')), h('label', { class: 'fld' }, t('in.device'), dev),
    h('button', { class: 'pill' + (on ? ' on' : ''), data: { act: 'inopen' }, 'aria-pressed': String(on), title: t('in.openTip'), onclick: () => toggleInput(!on) }, '🎤 ' + t(on ? 'in.on' : 'in.open')),
    h('div', { class: 'meter', title: t('in.level') }, h('div', { class: 'mfill', data: { id: 'input' } })),
    on && h('div', { class: 'tuner', role: 'status', title: t('tuner.tip'), 'aria-label': t('tuner.title') }, h('span', { class: 'tnote' }, '—'), h('span', { class: 'tbar' }, h('i', {})), h('span', { class: 'tcents' }, '')),
    slider(t('in.gain'), 0, 4, 0.01, S.inputGain, v => { S.inputGain = v; engine.setInput(v, S.inputMonitor); }, pct, '', true),
    h('button', { class: 'pill' + (S.inputMonitor ? ' on' : ''), data: { act: 'inmon' }, disabled: !on, 'aria-pressed': String(S.inputMonitor), title: t('in.monTip'), onclick: () => { S.inputMonitor = !S.inputMonitor; engine.setInput(S.inputGain, S.inputMonitor); emit(); } }, '🎧 ' + t('in.monitor')));
}

// ---------- Clip audio ----------
function audioEditor(tr: Track, c: Clip) {
  const cv = h('canvas', { class: 'bigwave' });
  queueMicrotask(() => {
    const w = cv.clientWidth || 800, hgt = cv.clientHeight || 120;
    cv.width = w; cv.height = hgt;
    const g = cv.getContext('2d')!; g.fillStyle = tr.color;
    if (c.bufferId) { drawWave(g, c.bufferId, c.offset, c.offset + c.len * stepDur(S.project.bpm), w, hgt); g.fillStyle = '#fff'; drawFades(g, c, w, hgt); }
  });
  const sec = (v: number) => (v * stepDur(S.project.bpm)).toFixed(2) + ' s', half = Math.max(1, Math.floor(c.len / 2));
  const act = (key: string, icon: string, fn: () => void) => h('button', { title: t('tip.' + key), data: { act: key }, onclick: fn }, `${icon} ${t('act.' + key)}`);
  const chopMode = h('select', { 'aria-label': t('chop.mode'), title: t('chop.mode'), data: { role: 'chopmode' } }, ...[[16, t('chop.n', 16)], [8, t('chop.n', 8)], [0, t('chop.auto')]].map(([v, l]) => h('option', { value: String(v) }, String(l))));
  if (S.stretch.clip !== c.id) S.stretch = { clip: c.id, pct: 100, semis: 0 };
  const st = S.stretch;
  const bpm = h('input', { type: 'number', min: '40', max: '240', placeholder: '—', 'aria-label': t('st.bpm'), title: t('st.bpmTip'), data: { role: 'srcbpm' } });
  bpm.onchange = () => { const v = +bpm.value; if (v >= 20 && v <= 400) { st.pct = clamp(Math.round(v / S.project.bpm * 100), 50, 200); emit(); } };
  return h('div', { class: 'editor' },
    h('div', { class: 'ebar' }, h('strong', {}, `${ICON.audio} ${tr.name}`), clipTools(c),
      slider(t('clip.gain'), 0, 2, 0.01, c.gain ?? 1, v => c.gain = v, pct),
      slider(t('clip.fadeIn'), 0, half, 1, Math.min(c.fadeIn ?? 0, half), v => c.fadeIn = v, sec),
      slider(t('clip.fadeOut'), 0, half, 1, Math.min(c.fadeOut ?? 0, half), v => c.fadeOut = v, sec),
      act('reverse', '⇄', reverseClip), act('normalize', '📈', normalizeClip)),
    h('div', { class: 'ebar' }, h('span', { class: 'sect' }, t('st.title')),
      slider(t('st.length'), 50, 200, 1, st.pct, v => { st.pct = v; }, v => v + ' %', '', true),
      h('label', { class: 'fld mini-in' }, t('st.bpm'), bpm),
      slider(t('st.pitch'), -12, 12, 1, st.semis, v => { st.semis = v; }, v => (v > 0 ? '+' : '') + v + ' st', '', true),
      act('stretch', '⏱', () => stretchClip(st.pct, st.semis)),
      h('span', { class: 'sect' }, t('chop.title')), chopMode,
      act('chop', '🔪', () => chopClip(+chopMode.value))),
    inputPanel(), cv, h('p', { class: 'tip pad-x' }, t('hint.audioClip')));
}

function emptyState(tr?: Track) {
  if (tr?.type === 'drums') return drumEditor(tr, null);
  if (tr?.type === 'synth') return h('div', { class: 'editor' },
    h('div', { class: 'ebar' }, h('strong', {}, `${ICON.synth} ${tr.name}`), scaleTools(), h('span', { class: 'tip' }, t('hint.synthEmpty', ['A', 'S', 'D', 'F', 'G', 'H', 'J'].map(keyLabel).join(' '), keyLabel('Z'), 'X'))),
    synthPanel(tr), S.kbShow && screenKeys());
  if (tr) return h('div', { class: 'editor' }, h('div', { class: 'ebar' }, h('strong', {}, `${ICON.audio} ${tr.name}`)), inputPanel(),
    h('div', { class: 'editor center' }, h('p', { class: 'bigtip' }, t('hint.audioEmpty'))));
  return h('div', { class: 'editor center' }, h('p', { class: 'bigtip' }, t('hint.nothing')));
}

export function renderEditor(): HTMLElement {
  edStepW = 0;
  const f = findClip(S.selClip);
  if (!f) return emptyState(findTrack(S.selTrack));
  const { track, clip } = f;
  return track.type === 'drums' ? drumEditor(track, clip) : track.type === 'synth' ? pianoRoll(track, clip) : audioEditor(track, clip);
}

/** Accordeur : affiche la note reçue et son écart (lissé pour rester lisible). */
let tunerHz = 0, tunerMiss = 0;
export function updateTuner() {
  const el = document.querySelector<HTMLElement>('.tuner');
  if (!el) return;
  const hz = engine.inputPitch();
  if (hz) { tunerHz = tunerHz && Math.abs(Math.log2(hz / tunerHz)) < 0.03 ? tunerHz * 0.7 + hz * 0.3 : hz; tunerMiss = 0; }
  else if (++tunerMiss > 30) tunerHz = 0;
  const [note, bar, cents] = el.children as unknown as HTMLElement[];
  if (!tunerHz) { note.textContent = '—'; cents.textContent = ''; el.classList.remove('ok'); (bar.firstChild as HTMLElement).style.left = '50%'; return; }
  const n = noteOf(tunerHz);
  note.textContent = noteName(n.midi); cents.textContent = (n.cents > 0 ? '+' : '') + n.cents;
  el.classList.toggle('ok', Math.abs(n.cents) <= 5); (bar.firstChild as HTMLElement).style.left = 50 + n.cents + '%';
}

/** Tête de lecture dans l'éditeur de motif. */
export function updateEditorPlayhead(step: number) {
  const ph = document.querySelector<HTMLElement>('#panel .ed-ph');
  if (!ph) return;
  const f = findClip(S.selClip);
  const inside = f && engine.playing && engine.mode === 'arr' && edStepW && step >= f.clip.start && step < f.clip.start + f.clip.len;
  ph.style.display = inside ? 'block' : 'none';
  if (!inside) return;
  const local = (step - f.clip.start + f.clip.offset) % f.clip.patLen!;
  const drums = f.track.type === 'drums';
  ph.style.left = (drums ? LABEL_W + Math.floor(local * edRes + 1e-6) * edStepW : local * edStepW) + 'px';
  ph.style.width = drums ? edStepW + 'px' : '2px';
}
