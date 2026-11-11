import { audioFiles, chooseInput, deleteClip, duplicateClip, inputs, loadSample, normalizeClip, pickFiles, reverseClip, setLoopToClip, splitClip, stretchClip, toggleInput, transposeClip } from '../actions';
import { engine } from '../audio/engine';
import { lang, t } from '../i18n';
import { kb, padHit } from '../input';
import { S, commit, emit, findClip, findTrack } from '../store';
import { BAR, CATS, Clip, KITS, NPADS, Note, PRESETS, SCALES, Track, emptyDrums, inScale, makeSynth, snapToScale, stepDur } from '../types';
import { ICON, drawFades, drawWave } from './arr';
import { clamp, h, pct, slider } from './dom';

const RH = 16, SW = 28, PMAX = 96, PMIN = 24, CELL = 34, LABEL_W = 150;
const SOLF = { fr: ['Do', 'Do#', 'Ré', 'Ré#', 'Mi', 'Fa', 'Fa#', 'Sol', 'Sol#', 'La', 'La#', 'Si'], es: ['Do', 'Do#', 'Re', 'Re#', 'Mi', 'Fa', 'Fa#', 'Sol', 'Sol#', 'La', 'La#', 'Si'], en: ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] };
const isBlack = (p: number) => [1, 3, 6, 8, 10].includes(p % 12);
export const noteName = (p: number) => SOLF[lang()][p % 12] + (Math.floor(p / 12) - 1);
/** Étiquette d'une touche physique selon la disposition la plus probable (AZERTY en français). */
export const keyLabel = (k: string) => lang() === 'fr' ? ({ A: 'Q', Q: 'A', W: 'Z', Z: 'W' } as Record<string, string>)[k] ?? k : k;
export const PAD_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', 'A', 'S', 'D', 'F', 'G', 'H', 'J', 'K'];
export const padName = (tr: Track, r: number) => tr.pads?.[r]?.name ?? t('d' + r);

let lastLen = 2;
let scrollKey = '', scrollPos = { x: 0, y: 0 };
let edStepW = 0;

function lengthSelect(c: Clip, opts: number[]) {
  const sel = h('select', { 'aria-label': t('ed.length'), title: t('ed.length'), data: { role: 'length' } });
  for (const b of opts) sel.append(h('option', { value: String(b * BAR), selected: c.patLen === b * BAR }, t(b > 1 ? 'ed.bars' : 'ed.bar', b)));
  sel.onchange = () => {
    const n = +sel.value;
    if (c.drums) c.drums = c.drums.map(r => Array.from({ length: n }, (_, i) => r[i] ?? 0));
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
  kit.onchange = () => { tr.kit = kit.value; commit(); engine.pad(tr, 0); };
  const view = (v: 'seq' | 'pads', label: string) => h('button', {
    class: 'seg' + (S.drumView === v || (!c && v === 'pads') ? ' on' : ''), disabled: !c && v === 'seq', data: { view: v },
    onclick: () => { S.drumView = v; emit(); },
  }, label);
  return h('div', { class: 'ebar' }, h('strong', {}, `${ICON.drums} ${tr.name}`),
    h('div', { class: 'segs', role: 'group' }, view('seq', t('drum.seq')), view('pads', t('drum.pads'))),
    c && clipTools(c), c && lengthSelect(c, [1, 2, 4]),
    h('label', { class: 'fld' }, t('drum.kit'), kit),
    slider(t('drum.swing'), 0, 0.6, 0.01, S.project.swing, v => S.project.swing = v, pct),
    c && h('button', { title: t('tip.clear'), data: { act: 'clear' }, onclick: () => { c.drums = emptyDrums(c.patLen!); commit(); } }, t('act.clear')),
    c && S.drumView === 'seq' && h('span', { class: 'tip' }, t('hint.accent')));
}

function padsView(tr: Track) {
  const grid = h('div', { class: 'pads' });
  for (let r = 0; r < NPADS; r++) {
    const custom = tr.pads?.[r];
    const setSample = async (f: File) => { const s = await loadSample(f); if (s) { tr.pads![r] = { bufferId: s.id, name: s.name }; commit(); engine.pad(tr, r); } };
    const pad = h('div', { class: 'pad' + (custom ? ' custom' : ''), data: { pad: String(r) }, role: 'button', tabIndex: 0, 'aria-label': padName(tr, r) },
      h('kbd', {}, keyLabel(PAD_KEYS[r])), h('span', { class: 'pad-name' }, padName(tr, r)),
      h('span', { class: 'pact' },
        h('button', { title: t('pad.load'), 'aria-label': t('pad.load'), data: { act: 'padload' }, onclick: (e: Event) => { e.stopPropagation(); pickFiles(fs => setSample(fs[0])); } }, '📂'),
        custom && h('button', { title: t('pad.reset'), 'aria-label': t('pad.reset'), onclick: (e: Event) => { e.stopPropagation(); tr.pads![r] = null; commit(); } }, '↺')));
    pad.onpointerdown = e => {
      if ((e.target as HTMLElement).closest('.pact')) return;
      e.preventDefault(); padHit(r, 1, tr); flashPad(r);
    };
    pad.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); padHit(r, 1, tr); flashPad(r); } };
    pad.ondragover = e => { e.preventDefault(); pad.classList.add('over'); };
    pad.ondragleave = () => pad.classList.remove('over');
    pad.ondrop = e => { e.preventDefault(); e.stopPropagation(); pad.classList.remove('over'); const f = audioFiles(e.dataTransfer?.files)[0]; if (f) setSample(f); };
    grid.append(pad);
  }
  return h('div', { class: 'escroll padwrap' }, grid, h('p', { class: 'tip' }, t('pad.help')));
}

export function flashPad(r: number) {
  const el = document.querySelector<HTMLElement>(`.pad[data-pad="${r}"]`);
  if (!el) return;
  el.classList.remove('hit'); void el.offsetWidth; el.classList.add('hit');
}

function drumEditor(tr: Track, c: Clip | null) {
  if (!c || S.drumView === 'pads') return h('div', { class: 'editor' }, drumBar(tr, c), padsView(tr));
  const grid = h('div', { class: 'dgrid ed-grid' });
  c.drums!.forEach((row, r) => {
    const line = h('div', { class: 'drow' },
      h('button', { class: 'dlabel', title: t('drum.listen', padName(tr, r)), onclick: () => engine.pad(tr, r) }, h('kbd', {}, keyLabel(PAD_KEYS[r])), h('span', {}, padName(tr, r))));
    row.forEach((v, s) => line.append(h('button', {
      class: `cell${v ? ' on' : ''}${v && v < 1 ? ' soft' : ''}${Math.floor(s / 4) % 2 ? ' alt' : ''}${s % BAR === 0 && s ? ' barstart' : ''}`,
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
  edStepW = CELL;
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
    tr.synth = { ...makeSynth(preset.value), ...keep }; commit(); engine.previewNote(tr, 60 + kb.octave * 12);
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
          : [wave('wave', t('syn.wave1')), wave('wave2', t('syn.wave2')), sl('mix2', 0, 1, 0.01, 'mix2', pct), sl('detune', 0, 50, 1, 'detune', v => v + ' ct'), sl('pitchEnv', 0, 24, 1, 'pitchEnv', v => v + ' st')];
  // Avec un clip ouvert, les réglages détaillés sont repliés pour laisser la place au piano roll.
  const open = !collapsible || S.synthOpen;
  const head = [h('label', { class: 'fld big' }, t('syn.sound'), preset),
    collapsible && h('button', { class: 'pill' + (open ? ' on' : ''), data: { act: 'synthopen' }, 'aria-expanded': String(open), title: t('syn.settingsTip'), onclick: () => { S.synthOpen = !S.synthOpen; emit(); } }, `🎚 ${t('syn.settings')} ${open ? '▴' : '▾'}`),
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
  const rows = PMAX - PMIN + 1, W = c.patLen! * SW, P = S.project, scaled = P.scale !== 'off';
  const fit = (p: number) => clamp(scaled ? snapToScale(P, p) : p, PMIN, PMAX);
  const keys = h('div', { class: 'keys' });
  const grid = h('div', { class: 'pr-grid ed-grid', style: `width:${W}px;height:${rows * RH}px;--sw:${SW}px;--rh:${RH}px` });
  for (let p = PMAX; p >= PMIN; p--) {
    keys.append(h('button', {
      class: 'key' + (isBlack(p) ? ' black' : '') + (p % 12 === 0 ? ' c' : '') + (scaled && (p - P.key) % 12 === 0 ? ' root' : ''), tabIndex: -1, 'aria-label': noteName(p),
      onpointerdown: () => engine.previewNote(tr, p),
    }, p % 12 === 0 ? noteName(p) : ''));
    if (scaled ? !inScale(P, p) : isBlack(p)) grid.append(h('div', { class: 'blk' + (scaled ? ' oos' : ''), style: `top:${(PMAX - p) * RH}px` }));
    if (p % 12 === 0) grid.append(h('div', { class: 'oct', style: `top:${(PMAX - p + 1) * RH}px` }));
  }
  const place = (el: HTMLElement, n: Note) => { el.style.cssText = `left:${n.s * SW}px;top:${(PMAX - n.p) * RH}px;width:${n.l * SW - 1}px;opacity:${(0.4 + 0.6 * n.v).toFixed(2)}`; el.title = noteName(n.p); };
  const mk = (n: Note, i: number) => { const el = h('div', { class: 'note', data: { i: String(i) } }, h('i', {})); place(el, n); return el; };
  c.notes!.forEach((n, i) => grid.append(mk(n, i)));
  grid.append(h('div', { class: 'ed-ph' }));

  grid.oncontextmenu = e => e.preventDefault();
  grid.ondblclick = e => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('.note');
    if (el) { c.notes!.splice(+el.dataset.i!, 1); commit(); }
  };
  grid.onpointerdown = e => {
    e.preventDefault();
    const r = grid.getBoundingClientRect();
    let el = (e.target as HTMLElement).closest<HTMLElement>('.note');
    let note: Note, resize: boolean;
    if (el) {
      note = c.notes![+el.dataset.i!];
      if (e.button === 2) { c.notes!.splice(c.notes!.indexOf(note), 1); commit(); return; }
      resize = e.clientX > el.getBoundingClientRect().right - 8;
    } else {
      if (e.button !== 0) return;
      const s = clamp(Math.floor((e.clientX - r.left) / SW), 0, c.patLen! - 1);
      note = { p: fit(PMAX - Math.floor((e.clientY - r.top) / RH)), s, l: Math.min(lastLen, c.patLen! - s), v: 0.8 };
      c.notes!.push(note); el = mk(note, c.notes!.length - 1); grid.append(el); resize = true;
    }
    engine.previewNote(tr, note.p);
    const o = { ...note }, sx = e.clientX, sy = e.clientY, node = el;
    node.classList.add('drag');
    const mv = (ev: PointerEvent) => {
      const dx = Math.round((ev.clientX - sx) / SW), dy = Math.round((ev.clientY - sy) / RH);
      if (resize) note.l = clamp(o.l + dx, 1, c.patLen! - note.s);
      else {
        note.s = clamp(o.s + dx, 0, c.patLen! - note.l);
        const np = fit(o.p - dy);
        if (np !== note.p) { note.p = np; engine.previewNote(tr, np); }
      }
      place(node, note);
    };
    const created = !o.l || resize && !(e.target as HTMLElement).closest('.note');
    const up = () => {
      removeEventListener('pointermove', mv); removeEventListener('pointerup', up); lastLen = note.l; node.classList.remove('drag');
      if (created || note.s !== o.s || note.p !== o.p || note.l !== o.l) commit();
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
        if (n.s !== s || !bars[i]) return;
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
      scaleTools()),
    synthPanel(tr, true), scroll);
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
      act('stretch', '⏱', () => stretchClip(st.pct, st.semis))),
    inputPanel(), cv, h('p', { class: 'tip pad-x' }, t('hint.audioClip')));
}

function emptyState(tr?: Track) {
  if (tr?.type === 'drums') return drumEditor(tr, null);
  if (tr?.type === 'synth') return h('div', { class: 'editor' },
    h('div', { class: 'ebar' }, h('strong', {}, `${ICON.synth} ${tr.name}`), scaleTools(), h('span', { class: 'tip' }, t('hint.synthEmpty', ['A', 'S', 'D', 'F', 'G', 'H', 'J'].map(keyLabel).join(' '), keyLabel('Z'), 'X'))),
    synthPanel(tr));
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
  ph.style.left = (drums ? LABEL_W + Math.floor(local) * edStepW : local * edStepW) + 'px';
  ph.style.width = drums ? edStepW + 'px' : '2px';
}
