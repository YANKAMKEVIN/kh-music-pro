// Éditeur de batterie : séquenceur pas à pas et pads.
import { drumBank } from '../../audio/banks';
import { audioFiles, doublePattern, loadSample, pickFiles, shiftPattern } from '../../actions';
import { engine } from '../../audio/engine';
import { t } from '../../i18n';
import { kb, padHit, padRelease } from '../../input';
import { commit, emit, findTrack, S } from '../../store';
import { BAR, BEAT, Clip, KITS, NPADS, resOf, setRes, Track } from '../../types';
import { icon, typeIcon } from '../icons';
import { clamp, followDrag, h, pct, slider } from '../dom';
import { clipTools, lengthSelect, setEdGrid } from '../editor';
import { keyLabel, PAD_KEYS, padName } from './names';

/** Case du séquenceur qui reçoit le focus au clavier (une seule est atteignable par Tab). */
let gridPos = { r: 0, s: 0 };
// ---------- Batterie : séquenceur et pads ----------
function drumBar(tr: Track, c: Clip | null) {
  const kit = h('select', { 'aria-label': t('drum.kit'), data: { role: 'kit' } });
  for (const k of Object.keys(KITS)) kit.append(h('option', { value: k, selected: tr.kit === k }, t('kit.' + k)));
  kit.onchange = async () => {
    const selected = kit.value; tr.kit = selected; commit();
    const bank = drumBank(selected);
    if (bank && !await engine.loadBank(bank)) return;
    if (findTrack(tr.id) === tr && tr.kit === selected) engine.pad(tr, 0);
  };
  const view = (v: 'seq' | 'pads', label: string) => h('button', {
    class: 'seg' + (S.drumView === v || (!c && v === 'pads') ? ' on' : ''), disabled: !c && v === 'seq', data: { view: v },
    onclick: () => { S.drumView = v; emit(); },
  }, label);
  return h('div', { class: 'ebar' }, h('strong', {}, typeIcon('drums'), ' ' + tr.name),
    h('div', { class: 'segs', role: 'group' }, view('seq', t('drum.seq')), view('pads', t('drum.pads'))),
    c && clipTools(c), c && lengthSelect(c, [1, 2, 4]), c && resSelect(c),
    h('label', { class: 'fld' }, t('drum.kit'), kit),
    slider(t('drum.swing'), 0, 0.6, 0.01, S.project.swing, v => S.project.swing = v, pct, '', false, 0),
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
        h('button', { title: t('pad.settings'), 'aria-label': `${t('pad.settings')} – ${padName(tr, r)}`, data: { act: 'padfx' }, onclick: (e: Event) => { e.stopPropagation(); S.padEdit = S.padEdit === r ? -1 : r; emit(); } }, icon('gear', 14)),
        h('button', { title: t('pad.load'), 'aria-label': t('pad.load'), data: { act: 'padload' }, onclick: (e: Event) => { e.stopPropagation(); pickFiles(fs => setSample(fs[0])); } }, icon('folder', 14)),
        custom && h('button', { title: t('pad.reset'), 'aria-label': t('pad.reset'), data: { act: 'padreset' }, onclick: (e: Event) => { e.stopPropagation(); tr.pads![r] = null; commit(); } }, '↺')));
    pad.onpointerdown = e => {
      if ((e.target as HTMLElement).closest('.pact')) return;
      e.preventDefault(); padHit(r, 1, tr); flashPad(r); const id = e.pointerId;
      // Seul le doigt qui a frappé ce pad arrête sa répétition : lever un autre doigt ne coupe pas les autres pads.
      const up = (u: PointerEvent) => { if (u.pointerId !== id) return; padRelease(r); removeEventListener('pointerup', up); removeEventListener('pointercancel', up); };
      addEventListener('pointerup', up); addEventListener('pointercancel', up);
    };
    // Au clavier : une frappe par appui (pas d'auto-répétition), et le relâchement arrête la répétition de notes.
    pad.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); if (!e.repeat) { padHit(r, 1, tr); flashPad(r); } } };
    pad.onkeyup = e => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); padRelease(r); } };
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
    fxBox = h('div', { class: 'padfx' }, h('strong', {}, icon('gear', 16), ` ${padName(tr, r)}`),
      slider(t('mix.volume'), 0, 1.5, 0.01, cur.vol, v => set('vol', v), pct, '', false, 1),
      slider(t('st.pitch'), -12, 12, 1, cur.tune, v => set('tune', v), v => (v > 0 ? '+' : '') + v + ' st', '', false, 0),
      slider(t('mix.pan'), -1, 1, 0.01, cur.pan, v => set('pan', Math.abs(v) < 0.04 ? 0 : v), v => String(Math.round(v * 100)), '', false, 0),
      h('div', { class: 'tools' },
        h('button', { class: 'pill', data: { act: 'padtest' }, onclick: () => { padHit(r, 1, tr); flashPad(r); } }, '▶ ' + t('pad.test')),
        h('button', { class: 'pill', data: { act: 'padfxload' }, onclick: () => pickFiles(async fs => { const smp = await loadSample(fs[0]); if (smp) { tr.pads![r] = { bufferId: smp.id, name: smp.name }; commit(); } }) }, icon('folder', 15), ' ' + t('smp.load')),
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
export function drumEditor(tr: Track, c: Clip | null) {
  if (!c || S.drumView === 'pads') return h('div', { class: 'editor' }, drumBar(tr, c), padsView(tr));
  const res = resOf(c), cw = res > 1 ? 20 : 30;
  const grid = h('div', { class: 'dgrid ed-grid', style: `--cw:${cw}px` });
  // Regroupement visuel par temps : le pas d'une case vaut 1/res double-croche.
  const beat = (s: number) => Math.floor(s / res / BEAT + 1e-6), isBar = (s: number) => s > 0 && Math.abs(s / res / BAR - Math.round(s / res / BAR)) < 1e-6;
  // Une seule case atteignable par Tab (la dernière visitée) ; les flèches passent d'une case à l'autre.
  const rows = c.drums!.length, cols = c.drums![0]?.length ?? 0;
  gridPos = { r: clamp(gridPos.r, 0, rows - 1), s: clamp(gridPos.s, 0, cols - 1) };
  grid.setAttribute('role', 'group'); grid.setAttribute('aria-label', t('drum.grid'));
  c.drums!.forEach((row, r) => {
    const line = h('div', { class: 'drow' },
      h('button', { class: 'dlabel', title: t('drum.listen', padName(tr, r)), onclick: () => engine.pad(tr, r) }, h('kbd', {}, keyLabel(PAD_KEYS[r])), h('span', {}, padName(tr, r))));
    row.forEach((v, s) => line.append(h('button', {
      class: `cell${v ? ' on' : ''}${v && v < 1 ? ' soft' : ''}${beat(s) % 2 ? ' alt' : ''}${isBar(s) ? ' barstart' : ''}${s % 8 === 0 ? ' page' : ''}`,   // page : arrêt du glissé par 8 pas sur téléphone
      data: { r: String(r), s: String(s) }, 'aria-label': `${padName(tr, r)} ${s + 1}`, 'aria-pressed': String(!!v),
      tabindex: r === gridPos.r && s === gridPos.s ? '0' : '-1',
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
    followDrag(e, mv, () => commit());
  };
  grid.oncontextmenu = e => e.preventDefault();
  const moveTo = (r: number, s: number) => {
    const x = grid.querySelector<HTMLElement>(`.cell[data-r="${clamp(r, 0, rows - 1)}"][data-s="${clamp(s, 0, cols - 1)}"]`);
    if (x) x.focus();
  };
  grid.addEventListener('focusin', e => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('.cell');
    if (!el) return;
    gridPos = { r: +el.dataset.r!, s: +el.dataset.s! };
    grid.querySelectorAll<HTMLElement>('.cell[tabindex="0"]').forEach(x => { if (x !== el) x.tabIndex = -1; });
    el.tabIndex = 0;
  });
  grid.onkeydown = e => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('.cell');
    if (!el) return;
    const r = +el.dataset.r!, s = +el.dataset.s!;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); setCell(el, c.drums![r][s] ? 0 : 1); commit(); return; }
    const to = ({ ArrowRight: [r, s + 1], ArrowLeft: [r, s - 1], ArrowDown: [r + 1, s], ArrowUp: [r - 1, s], Home: [r, 0], End: [r, cols - 1] } as Record<string, number[]>)[e.key];
    if (to && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); e.stopPropagation(); moveTo(to[0], to[1]); }
  };
  grid.append(h('div', { class: 'ed-ph' }));
  setEdGrid(cw + 4, res);
  return h('div', { class: 'editor' }, drumBar(tr, c), h('div', { class: 'escroll' }, grid));
}
