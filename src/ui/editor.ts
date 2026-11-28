import { deleteClip, duplicateClip, humanizeNotes, legatoNotes, quantizeNotes, setLoopToClip, splitClip, transposeClip } from '../actions';
import { engine } from '../audio/engine';
import { auName } from '../audio/au';
import { noteOf } from '../audio/pitch';
import { lang, t } from '../i18n';
import { kb, noteOff, noteOn } from '../input';
import { commit, emit, findClip, findTrack, revert, S } from '../store';
import { BAR, BEAT, Clip, GRIDS, inScale, Note, resOf, SCALES, snapTo, snapToScale, Track } from '../types';
import { wheelFactor, zoomAt } from './arr';
import { icon, typeIcon } from './icons';
import { clamp, followDrag, h, pct, slider, toast } from './dom';
import { isBlack, keyLabel, noteName, SOLF } from './editor/names';
import { ctlLane, screenKeys } from './editor/controls';
import { synthPanel } from './editor/synth';
import { drumEditor } from './editor/drums';
import { audioEditor, inputPanel } from './editor/audio';
export * from './editor/names';
export * from './editor/drums';
export * from './editor/synth';
export * from './editor/controls';
export * from './editor/audio';

/** Doigts posés sur le clavier à l'écran (identifiant de pointeur → note), conservés d'un redessin à l'autre. */
export const okbDown = new Map<number, number>();
const RH = 16, PMAX = 96, PMIN = 24, CELL = 34, LABEL_W = 150, KEYS_W = 62;
/** Largeur d'un pas dans le piano roll : suit le zoom (`S.epx`), relue à chaque dessin. */
export let SW = 28;
let lastLen = 2;
let scrollKey = '', scrollPos = { x: 0, y: 0 };
let edStepW = 0, edRes = 1;
/** Largeur d'un pas et résolution de la grille de batterie affichée, pour placer la tête de lecture. */
export const setEdGrid = (w: number, res: number) => { edStepW = w; edRes = res; };
export function lengthSelect(c: Clip, opts: number[]) {
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
export function clipTools(c: Clip) {
  const name = h('input', { class: 'cname-in', value: c.name, 'aria-label': t('clip.name'), spellcheck: false });
  name.onchange = () => { c.name = name.value.trim() || c.name; commit(); };
  const b = (key: string, ico: string | Node, fn: () => void, cls = '') => h('button', { class: cls, title: t('tip.' + key), data: { act: key }, onclick: fn }, ico, ' ' + t('act.' + key));
  return h('div', { class: 'tools' }, name, b('dup', '⧉', duplicateClip), b('split', '✂', splitClip), b('loop', '⟲', setLoopToClip), b('del', icon('trash', 15), deleteClip, 'danger'));
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
  const target = () => { const sel2 = c.notes!.filter(n => selNotes.has(n)); return sel2.length ? sel2 : c.notes!; };
  const sel = h('select', { 'aria-label': t('ed.grid'), title: t('ed.gridTip'), data: { role: 'notegrid' } },
    ...[['16', '1/16'], ['32', '1/32'], ['8t', t('grid.8t')], ['16t', t('grid.16t')], ['free', t('grid.free')]].map(([v, l]) => h('option', { value: v, selected: S.grid === v }, l)));
  sel.onchange = () => { S.grid = sel.value; emit(); };
  const has = !!c.ctl && Object.values(c.ctl).some(p => p?.length), on = S.ctlShow || has;
  return h('div', { class: 'tools' }, h('label', { class: 'fld' }, t('ed.grid'), sel),
    h('button', { class: 'pill' + (on ? ' on' : ''), data: { act: 'ctlshow' }, 'aria-pressed': String(on), disabled: has, title: t('ctl.showTip'), onclick: () => { S.ctlShow = !S.ctlShow; emit(); } }, '〰 ' + t('ctl.lane')),
    h('button', { title: t('tip.quantize'), data: { act: 'quantize' }, onclick: () => quantizeNotes(target(), GRIDS[S.grid] ?? 1, c.patLen!, S.quant) }, icon('magnet', 15), ' ' + t('act.quantize') + (S.quant.str < 1 || S.quant.swing ? ` ${Math.round(S.quant.str * 100)} %` : '')),
    quantMenu(c, target));
}
/** Réglages de la quantification (V19) : force, swing, humanisation, légato. */
function quantMenu(c: Clip, target: () => Note[]) {
  const d = h('details', { class: 'menu tmenu qmenu' });
  const q = S.quant;
  const btn = (act: string, ico: string | Node, fn: () => void) => h('button', { data: { act }, title: t('q.' + act + 'Tip'), onclick: () => { d.open = false; fn(); } }, ico, ` ${t('q.' + act)}`);
  d.append(h('summary', { class: 'pill', title: t('q.menu'), 'aria-label': t('q.menu'), data: { act: 'qmenu' } }, '▾'), h('div', { class: 'menu-list' },
    slider(t('q.str'), 0, 1, 0.05, q.str, v => { q.str = v; }, pct, 'qstr', true),
    slider(t('q.swing'), 0, 1, 0.01, q.swing, v => { q.swing = v; }, pct, 'qswing', true),
    btn('apply', icon('magnet', 15), () => quantizeNotes(target(), GRIDS[S.grid] ?? 1, c.patLen!, q)),
    h('p', { class: 'tip' }, t('q.swingTip')),
    slider(t('q.hum'), 0, 1, 0.05, q.hum, v => { q.hum = v; }, pct, 'qhum', true),
    btn('humanize', icon('dice', 15), () => humanizeNotes(target(), q.hum, c.patLen!)),
    btn('legato', '⟿', () => legatoNotes(target(), c.notes!, c.patLen!))));
  return d;
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
  SW = S.epx;
  const rows = PMAX - PMIN + 1, W = c.patLen! * SW, P = S.project, scaled = P.scale !== 'off', G = GRIDS[S.grid] ?? 1;
  const fit = (p: number) => clamp(scaled ? snapToScale(P, p) : p, PMIN, PMAX);
  if (selOwner !== c.id) { selNotes.clear(); selOwner = c.id; }
  const refreshSel = () => grid.querySelectorAll<HTMLElement>('.note').forEach(el => el.classList.toggle('sel', selNotes.has(c.notes![+el.dataset.i!])));
  const keys = h('div', { class: 'keys' });
  const grid = h('div', { class: 'pr-grid ed-grid', style: `width:${W}px;height:${rows * RH}px;--sw:${SW}px;--rh:${RH}px;--gw:${G * SW}px;--bs:${BAR};--bt:${BEAT}` });   // lignes de mesure et de temps selon la signature
  for (let p = PMAX; p >= PMIN; p--) {
    keys.append(h('button', {
      class: 'key' + (isBlack(p) ? ' black' : '') + (p % 12 === 0 ? ' c' : '') + (scaled && (p - P.key) % 12 === 0 ? ' root' : ''), tabIndex: -1, 'aria-label': noteName(p), data: { p: String(p) },
      // La touche joue tant qu'elle est tenue (souris ou doigt), par le même chemin que le clavier de l'ordinateur
      // et le MIDI : accords à un doigt, arpégiateur et enregistrement de ce que l'on joue s'appliquent.
      // Le relâchement est écouté sur la fenêtre : il arrive même si la touche a été redessinée ou quittée entre-temps.
      onpointerdown: (e: PointerEvent) => {
        e.preventDefault();
        const live = S.selTrack === tr.id;
        if (live) noteOn(p); else engine.noteOn(tr, p);
        const up = (u: PointerEvent) => { if (u.pointerId !== e.pointerId) return; if (live) noteOff(p); else engine.noteOff(tr, p); removeEventListener('pointerup', up); removeEventListener('pointercancel', up); };
        addEventListener('pointerup', up); addEventListener('pointercancel', up);
      },
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
        box.remove();
        const sa = Math.min(x0, x1) / SW, sb = Math.max(x0, x1) / SW, pa = PMAX - Math.floor(Math.max(y0, y1) / RH), pb = PMAX - Math.floor(Math.min(y0, y1) / RH);
        selNotes = new Set(c.notes!.filter(n => n.s < sb && n.s + n.l > sa && n.p >= pa && n.p <= pb)); refreshSel();
      };
      followDrag(e, mv, up, () => box.remove());   // annulé : la sélection ne change pas
      return;
    }
    if (el) {
      note = c.notes![+el.dataset.i!];
      if (e.button === 2) { selNotes.delete(note); c.notes!.splice(c.notes!.indexOf(note), 1); commit(); return; }
      if (e.shiftKey) { if (selNotes.has(note)) selNotes.delete(note); else selNotes.add(note); refreshSel(); return; }
      if (!selNotes.has(note)) { selNotes.clear(); selNotes.add(note); refreshSel(); }
      // La poignée d'étirement occupe le bord droit, mais jamais plus du tiers d'une note courte : celle-ci doit rester déplaçable.
      const nr = el.getBoundingClientRect(); resize = e.clientX > nr.right - Math.min(8, nr.width / 3);
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
      lastLen = note.l; node.classList.remove('drag');
      if (created || note.l !== o.l || group.some(g => g.n.s !== g.o.s || g.n.p !== g.o.p)) commit();
    };
    // Geste annulé : notes remises comme avant (une note qu'on était en train de créer disparaît).
    followDrag(e, mv, up, () => { node.classList.remove('drag'); selNotes.clear(); revert(); });
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
    followDrag(e, apply, () => { if (changed) commit(); }, revert);
  };
  const showCtl = S.ctlShow || (!!c.ctl && Object.values(c.ctl).some(p => p?.length));
  const scroll = h('div', { class: 'pr' }, h('div', { class: 'pr-inner' }, keys, grid),
    h('div', { class: 'pr-foot' }, h('div', { class: 'vel-row' }, h('div', { class: 'vel-lbl', title: t('tip.velocity') }, t('ed.velocity')), vel), showCtl && ctlLane(c, W)));
  const key = c.id;
  scroll.onscroll = () => { scrollKey = key; scrollPos = { x: scroll.scrollLeft, y: scroll.scrollTop }; };
  // Ctrl ou Cmd + molette (ou pincement au trackpad) : zoom dans le temps, le pas visé reste sous le pointeur.
  scroll.onwheel = e => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    const z = zoomAt(S.epx, wheelFactor(e), Math.max(0, e.clientX - scroll.getBoundingClientRect().left - KEYS_W), scroll.scrollLeft, 10, 72);
    if (z.px === S.epx) return;
    S.epx = z.px; scrollKey = key; scrollPos = { x: z.scroll, y: scroll.scrollTop }; emit();
  };
  const restore = scrollKey === key ? { ...scrollPos } : null;
  queueMicrotask(() => {
    if (restore) { scroll.scrollLeft = restore.x; scroll.scrollTop = restore.y; return; }
    const ps = c.notes!.map(n => n.p), center = ps.length ? (Math.max(...ps) + Math.min(...ps)) / 2 : 60;
    scroll.scrollTop = (PMAX - center) * RH - (scroll.clientHeight - 58) / 2;
  });
  edStepW = SW;
  return h('div', { class: 'editor' },
    h('div', { class: 'ebar' }, h('strong', {}, typeIcon('synth'), ' ' + tr.name), clipTools(c), lengthSelect(c, [1, 2, 4, 8]),
      h('div', { class: 'segs', role: 'group', 'aria-label': t('ed.transpose'), title: t('ed.transpose') },
        ...[-12, -1, 1, 12].map(n => h('button', { class: 'seg', data: { act: 'tr' + n }, 'aria-label': `${t('ed.transpose')} ${n > 0 ? '+' : ''}${n}`, onclick: () => transposeClip(n) }, (n > 0 ? '+' : '−') + Math.abs(n)))),
      gridTools(c), scaleTools()),
    synthPanel(tr, true), S.kbShow && screenKeys(), scroll);
}
function emptyState(tr?: Track) {
  if (tr?.type === 'drums') return drumEditor(tr, null);
  if (tr?.type === 'synth') return h('div', { class: 'editor' },
    h('div', { class: 'ebar' }, h('strong', {}, typeIcon('synth'), ' ' + tr.name), scaleTools(), h('span', { class: 'tip' }, t('hint.synthEmpty', ['A', 'S', 'D', 'F', 'G', 'H', 'J'].map(keyLabel).join(' '), keyLabel('Z'), 'X'))),
    synthPanel(tr), S.kbShow && screenKeys());
  if (tr) return h('div', { class: 'editor' }, h('div', { class: 'ebar' }, h('strong', {}, typeIcon('audio'), ' ' + tr.name)), inputPanel(),
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
let tunerHz = 0, tunerMiss = 0, tunerShown = false;
/** Dernières mesures brutes : une note ne s'affiche qu'une fois confirmée par 3 mesures concordantes (à 3 % près),
 *  pour qu'une trame abîmée (ordinateur chargé, attaque, bruit) ne donne pas un écart faux. */
const tunerRaw: number[] = [];
export function updateTuner() {
  const el = document.querySelector<HTMLElement>('.tuner');
  if (!el) { tunerShown = false; return; }
  // Accordeur rouvert : on repart de zéro, sans lisser depuis une note entendue la fois d'avant.
  if (!tunerShown) { tunerShown = true; tunerHz = 0; tunerMiss = 0; tunerRaw.length = 0; }
  const hz = engine.inputPitch();
  if (hz) {
    tunerRaw.push(hz); if (tunerRaw.length > 5) tunerRaw.shift();
    const med = [...tunerRaw].sort((a, b) => a - b)[tunerRaw.length >> 1];
    const agree = tunerRaw.filter(v => Math.abs(Math.log2(v / med)) < 0.03);
    if (agree.length >= 3) {
      // Médiane des mesures concordantes : une trame abîmée, même proche de la note, ne déplace pas l'affichage.
      const f = agree.sort((a, b) => a - b)[agree.length >> 1];
      tunerHz = tunerHz && Math.abs(Math.log2(f / tunerHz)) < 0.03 ? tunerHz * 0.7 + f * 0.3 : f;
    }
    tunerMiss = 0;
  } else if (++tunerMiss > 30) { tunerHz = 0; tunerRaw.length = 0; }
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
/** Instrument du Mac prêt (le bouton de sa fenêtre s'active) ou en échec (message). */
engine.mix.onInst = (tid, ok) => {
  const tr = findTrack(tid);
  if (!ok && tr) toast(t('toast.auInstFail', auName(tr.synth?.auName ?? '')), 'error');
  emit();
};
