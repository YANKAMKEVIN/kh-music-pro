import { addMarker, addTempo, cancelExport, deskFiles, exportJob, exportMidiFile, exportMp3, exportStems, exportWav, filesPicked, importMidiFile, openFile, openProjectFile, openRecentFile, pickAudio, saveFile, saveFileAs, tapTempo, toggleRecord } from '../actions';
import { engine } from '../audio/engine';
import { LANGS, Lang, lang, setLang, t } from '../i18n';
import { connectMidi, midi } from '../input';
import { S, commit, emit, redo, undo } from '../store';
import { clamp, h, toast } from './dom';
import { keyLabel } from './editor';
import { showAudio } from './audio';
import { showLibrary, showVersions } from './library';
import { startTour } from './tour';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

async function midiConnect() {
  if (!midi.supported) return toast(t('midi.unsupported'), 'error');
  try { const n = await connectMidi(); toast(n ? t('midi.connected', n) : t('midi.none')); }
  catch { toast(t('midi.denied'), 'error'); }
}

// Un menu ouvert se referme quand on touche ailleurs ou qu'on appuie sur Échap (le focus revient à son bouton).
let menusWired = false;
function wireMenus() {
  if (menusWired) return; menusWired = true;
  const openMenus = () => [...document.querySelectorAll<HTMLDetailsElement>('details.menu[open], details.more[open]')].filter(d => !(d.id === 'more' && matchMedia('(min-width: 761px)').matches));
  document.addEventListener('pointerdown', e => { for (const d of openMenus()) if (!d.contains(e.target as Node)) d.open = false; });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    const inner = openMenus().filter(d => d.contains(document.activeElement)).pop() ?? openMenus().pop();
    if (inner) { inner.open = false; inner.querySelector('summary')?.focus(); e.stopPropagation(); }
  }, true);
  // Les pistes défilent : un menu ⋯ ouvert se refermerait loin de son bouton, on le ferme.
  // Position du bouton ⋯ relevée au clic même (l'évènement d'ouverture arrive plus tard, parfois après un défilement).
  document.addEventListener('click', e => {
    const d = (e.target as Element)?.closest?.('details.tmenu') as HTMLDetailsElement | null;
    if (d && (e.target as Element).closest('summary')) d.dataset.y = String(Math.round(d.querySelector('summary')!.getBoundingClientRect().top));
  }, true);
  // Seulement si son bouton a vraiment bougé : le défilement qui amène la piste à l'écran juste avant l'ouverture ne compte pas.
  document.addEventListener('scroll', () => {
    for (const d of document.querySelectorAll<HTMLDetailsElement>('details.tmenu[open]')) {
      const y = Math.round(d.querySelector('summary')!.getBoundingClientRect().top);
      if (Math.abs(y - +(d.dataset.y ?? y)) > 4) d.open = false;
    }
  }, true);
  // Téléphone : la liste s'affiche sur toute la largeur, juste sous le bouton qui l'a ouverte.
  document.addEventListener('toggle', e => {
    const d = e.target as HTMLDetailsElement;
    // Menu ⋯ d'une piste : liste posée à côté du bouton, au-dessus de la zone des pistes (qui défile et la couperait).
    if (d.open && d.classList?.contains('tmenu')) {
      const list = d.querySelector<HTMLElement>(':scope > .menu-list')!, r = d.querySelector('summary')!.getBoundingClientRect();
      list.style.left = Math.round(Math.min(r.left, innerWidth - list.offsetWidth - 8)) + 'px';
      list.style.top = Math.round(r.bottom + 4 + list.offsetHeight > innerHeight - 8 ? Math.max(8, r.top - 4 - list.offsetHeight) : r.bottom + 4) + 'px';
      return;
    }
    if (!d.open || !d.matches?.('details.menu, details.more') || matchMedia('(min-width: 761px)').matches) return;
    const list = d.querySelector<HTMLElement>(':scope > .menu-list, :scope > .grp.out'), r = d.querySelector('summary')!.getBoundingClientRect();
    if (list) list.style.top = Math.round(r.bottom + 6) + 'px';
  }, true);
}

/** Construit la barre supérieure dans la langue courante. */
export function buildTop(onLang: () => void) {
  const b = (id: string, cls: string, label: string, tip: string, fn: () => void) => h('button', { id, class: cls, title: tip, 'aria-label': tip, onclick: fn }, label);
  const tgl = (id: string, label: string, tip: string, fn: () => void) => h('button', { id, class: 'pill', title: tip, 'aria-label': tip, 'aria-pressed': 'false', onclick: fn }, label);
  const num = (id: string, label: string, min: number, max: number, fn: () => void) => { const i = h('input', { id, type: 'number', min: String(min), max: String(max), step: '1', 'aria-label': label, title: label }); i.onchange = fn; return i; };

  const setLoop = () => {
    const s = clamp(Math.round(+$<HTMLInputElement>('loopS').value) || 1, 1, 999), e = Math.max(s, Math.round(+$<HTMLInputElement>('loopE').value) || s);
    S.project.loopStart = s - 1; S.project.loopLen = e - s + 1; commit();
  };
  // Tempo au centième près (une boucle à 93,5 BPM se cale exactement) ; une saisie vide ou nulle garde le tempo actuel.
  const bpm = num('bpm', t('top.tempo'), 40, 240, () => { const v = parseFloat(bpm.value.replace(',', '.')); if (v > 0) { S.project.bpm = clamp(Math.round(v * 100) / 100, 40, 240); commit(); } bpm.value = String(S.project.bpm); });
  bpm.step = '0.01';
  const snap = h('select', { id: 'snap', 'aria-label': t('top.gridTip') },
    h('option', { value: '16' }, t('grid.bar')), h('option', { value: '4' }, t('grid.beat')), h('option', { value: '1' }, '1/16'));
  snap.onchange = () => { S.snap = +snap.value; };
  const sig = h('select', { id: 'sig', 'aria-label': t('top.sig'), title: t('top.sig'), data: { role: 'sig' } }, ...[2, 3, 4, 5, 6, 7].map(n => h('option', { value: String(n) }, `${n}/4`)));
  sig.onchange = () => { S.project.sig = +sig.value; commit(); };
  const zoom = (f: number) => { S.px = clamp(S.px * f, 3, 44); emit(); };
  const pname = h('input', { id: 'pname', class: 'pname', 'aria-label': t('top.pname'), title: t('top.pname'), spellcheck: false });
  pname.onchange = () => { S.project.name = pname.value.trim() || t('proj.new'); commit(); };
  const langSel = h('select', { id: 'lang', 'aria-label': t('top.lang'), title: t('top.lang') }, ...LANGS.map(([v, n]) => h('option', { value: v, selected: v === lang() }, n)));
  langSel.onchange = () => { setLang(langSel.value as Lang); onLang(); };

  wireMenus();
  // Menus déroulants (V18) : un clic ouvre, un clic ailleurs, Échap ou un choix referment.
  const drop = (id: string, summary: (string | Node)[], tip: string, ...items: Node[]) => {
    const d = h('details', { class: 'menu', id });
    // Un symbole seul (⚙, ▾) reçoit un nom accessible ; un mot visible (Projet, Prise) reste son propre nom.
    const named = summary.length === 1 && typeof summary[0] === 'string' && summary[0].replace(/[▾\s]/g, '').length > 1;
    d.append(h('summary', { class: 'pill', title: tip, ...(named ? {} : { 'aria-label': tip }) }, ...summary), h('div', { class: 'menu-list' }, ...items));
    return d;
  };
  const close = (el: HTMLElement) => { const d = el.closest('details'); if (d && d.id !== 'more') d.open = false; };
  const item = (id: string, label: string, fn: () => void) => { const x: HTMLButtonElement = h('button', { id, onclick: () => { close(x); fn(); } }, label); return x; };

  // Version bureau : Enregistrer sous et fichiers récents (liste relue à chaque ouverture du menu).
  const desk = deskFiles(), recent = h('div', { id: 'recent', class: 'recent', role: 'group', 'aria-label': t('file.recent') });
  const fillRecent = async () => {
    if (!desk) return;
    const list = await desk.recent().catch(() => []);
    recent.replaceChildren(h('small', { class: 'mhead' }, t('file.recent')),
      ...(list.length ? list.map(f => { const x: HTMLButtonElement = h('button', { class: 'rfile', data: { path: f.path }, title: f.path, onclick: () => { close(x); openRecentFile(f.path, f.name); } }, '🎵 ' + f.name); return x; })
        : [h('small', { class: 'mnone' }, t('file.none'))]),
      ...(list.length ? [h('button', { id: 'bRecentClear', class: 'rclear', onclick: async () => { await desk.clearRecent(); fillRecent(); } }, t('file.clear'))] : []));
  };
  const menu = drop('menu', [t('top.project') + ' ▾'], t('top.project'),
    item('bRename', t('top.rename'), () => { const n = prompt(t('top.pname'), S.project.name)?.trim(); if (n) { S.project.name = n; commit(); } }),
    item('bNew', t('top.new'), showLibrary), item('bLib', t('top.lib'), showLibrary), item('bVersions', t('ver.menu'), showVersions), item('bOpen', t('top.open'), openProjectFile),
    item('bSave', t('top.save'), saveFile), ...(desk ? [item('bSaveAs', t('file.saveAs'), saveFileAs)] : []), item('bImport', t('top.import'), () => pickAudio()),
    ...(desk ? [recent] : []), item('bMidiIn', t('top.midiIn'), () => $('fMidi').click()));
  menu.addEventListener('toggle', () => { if (menu.open) fillRecent(); });

  const take = drop('mTake', [t('top.take') + ' ▾'], t('top.takeTip'),
    tgl('bCount', t('top.countIn'), t('top.countInTip'), () => { S.project.countIn = !S.project.countIn; commit(); }),
    tgl('bPunch', t('top.punch'), t('top.punchTip'), () => { S.project.punch = !S.project.punch; commit(); }),
    h('div', { class: 'mrow' }, h('label', { class: 'mini-in' }, '⟲ ' + t('top.from'), num('loopS', t('top.loopS'), 1, 999, setLoop)),
      h('label', { class: 'mini-in' }, t('top.to'), num('loopE', t('top.loopE'), 1, 999, setLoop))));
  const exportMore = drop('mExport', ['▾'], t('top.exportMore'),
    item('bMp3', t('top.mp3'), exportMp3), item('bStems', t('top.stems'), exportStems), item('bMidiOut', t('top.midiOut'), exportMidiFile),
    item('bExpOpts', '⚙ ' + t('exp.menu'), showExportOptions));
  const settings = drop('mSettings', ['⚙'], t('top.settings'),
    item('bMidi', '🎛 ' + t('top.midiTip'), midiConnect), item('bAudio', '🔧 ' + t('aud.title'), showAudio),
    h('label', { class: 'mini-in mrow' }, t('top.lang'), langSel));
  // Tout ce qui sort du morceau : export, réglages, aide. Toujours ouvert sur ordinateur ; menu ☰ sur téléphone.
  const more = h('details', { class: 'more', id: 'more' });
  more.append(h('summary', { class: 'pill', title: t('top.more'), 'aria-label': t('top.more') }, '☰'),
    h('div', { class: 'grp out' },
      h('div', { class: 'split-btn' }, b('bExport', 'pill accent', t('top.export'), t('top.exportTip'), exportWav), exportMore,
        // Pendant un export : le bouton laisse la place à une barre d'avancement et à un bouton Annuler.
        h('div', { id: 'xProg', class: 'xprog', role: 'progressbar', 'aria-label': t('exp.progress'), 'aria-valuemin': '0', 'aria-valuemax': '100', hidden: true }, h('span', {})),
        h('button', { id: 'bExportCancel', class: 'pill xcancel', title: t('exp.cancelTip'), 'aria-label': t('exp.cancelTip'), hidden: true, onclick: cancelExport }, '✕ ' + t('exp.cancel'))),
      settings, b('bHelp', 'icon', '?', t('top.help'), () => $<HTMLDialogElement>('help').showModal())));
  const wide = matchMedia('(min-width: 761px)');
  const syncMore = () => { more.open = wide.matches; };
  syncMore(); wide.onchange = syncMore;

  $('top').replaceChildren(
    h('div', { class: 'brand', 'aria-label': 'KH Music Pro' }, h('span', { class: 'logo' }, 'KH'), h('span', { class: 'bname' }, 'MUSIC PRO')),
    h('div', { class: 'grp proj', role: 'group', 'aria-label': t('top.project') }, pname, menu,
      b('bUndo', 'icon', '↶', t('top.undo'), undo), b('bRedo', 'icon', '↷', t('top.redo'), redo)),
    h('div', { class: 'grp transport', role: 'group' },
      b('bStop', 'tbtn', '■', t('top.stop'), () => engine.stop()),
      b('bPlay', 'tbtn play', '▶', t('top.play'), () => engine.toggle()),
      b('bRec', 'tbtn rec', '●', t('top.rec'), () => toggleRecord())),
    h('div', { class: 'grp display' },
      h('div', {}, h('span', { id: 'pos' }, '1.1.1'), h('small', {}, t('top.bar'))),
      h('div', { class: 'dtime' }, h('span', { id: 'time' }, '0:00.0'), h('small', {}, t('top.time'))),
      h('label', {}, bpm, h('small', {}, 'BPM'))),
    h('div', { class: 'grp play', role: 'group' },
      b('bTap', 'pill', 'Tap', t('top.tapTip'), tapTempo), sig,
      tgl('bMetro', '♪', t('top.metroTip'), () => { S.project.metronome = !S.project.metronome; commit(); }),
      tgl('bLoop', '⟲', t('top.loopTip'), () => { S.project.loop = !S.project.loop; commit(); }),
      take),
    more);

  // Barre d'arrangement (V18), juste au-dessus des pistes : grille, zoom, tempo, repères, notes.
  $('abar').setAttribute('aria-label', t('abar.label'));
  $('abar').replaceChildren(
    h('label', { class: 'mini-in', title: t('top.gridTip') }, t('top.grid'), snap),
    b('bZoomOut', 'icon', '−', t('top.zoomOut'), () => zoom(1 / 1.3)), b('bZoomIn', 'icon', '＋', t('top.zoomIn'), () => zoom(1.3)),
    b('bTempoAdd', 'pill', '♩＋', t('tempo.add'), addTempo),
    b('bMark', 'pill', '⚑', t('mark.add'), addMarker), b('bNotes', 'pill', '📝', t('notes.title'), showNotes));

  exportJob.onChange = syncExport; syncExport();
  document.querySelectorAll<HTMLElement>('#tabs button').forEach(x => { x.textContent = t('tab.' + x.dataset.tab); });
  $('split').title = t('split.tip');
  buildHelp();
}

/** Bouton Exporter ↔ barre d'avancement : suit l'export en cours (pourcentage, ou « piste 3 sur 12 » pour les pistes séparées). */
function syncExport() {
  const prog = $('xProg'), j = exportJob, n = Math.round(j.pct * 100);
  if (!prog) return;
  const was = !prog.hidden;
  $('bExport').hidden = $('mExport').hidden = j.busy; prog.hidden = $('bExportCancel').hidden = !j.busy;
  prog.style.setProperty('--p', String(j.pct)); prog.setAttribute('aria-valuenow', String(n));
  prog.setAttribute('aria-valuetext', j.label ? `${j.label} ${n} %` : `${n} %`);
  prog.firstElementChild!.textContent = j.label ? `${j.label.replace(/…$/, '')} · ${n} %` : `${n} %`;
  // Le focus ne se perd pas quand le bouton change : Exporter → Annuler au départ, Annuler → Exporter à la fin.
  if (j.busy && !was && document.activeElement === document.body) $('bExportCancel').focus({ preventScroll: true });
  if (!j.busy && was && document.activeElement === document.body) $('bExport').focus({ preventScroll: true });
}

/** Résumé des réglages d'export (bulle du bouton Exporter, fenêtre des options). */
export function exportSummary(): string {
  const e = S.project.exp, p = S.project;
  const range = e.range === 'loop' ? t('exp.sumLoop', p.loopStart + 1, p.loopStart + p.loopLen) : e.range === 'bars' ? t('exp.sumBars', Math.round(e.from), Math.max(Math.round(e.from), Math.round(e.to))) : t('exp.sumAll');
  return `WAV ${e.bits} ${t('exp.bitsUnit')} · ${e.rate === 48000 ? '48' : '44,1'} kHz · ${range}`;
}
/** Options d'export (V19) : plage (tout, boucle, mesures X à Y), queue de son, WAV 16 ou 24 bits, 44,1 ou 48 kHz. Gardées dans le projet. */
export function showExportOptions() {
  const d = $<HTMLDialogElement>('expopts'), p = S.project, e = p.exp;
  const set = (fn: () => void) => { fn(); commit(); sum.textContent = exportSummary(); bars(); };
  const radio = (v: typeof e.range, label: string) => {
    const r = h('input', { type: 'radio', name: 'exprange', value: v, checked: e.range === v, data: { range: v } });
    r.onchange = () => { if (r.checked) set(() => { e.range = v; }); };
    return h('label', { class: 'eopt' }, r, label);
  };
  const num = (k: 'from' | 'to', label: string) => {
    const i = h('input', { type: 'number', min: '1', max: '999', step: '1', value: String(e[k]), 'aria-label': label, data: { role: 'exp' + k } });
    i.onchange = () => { const v = Math.round(+i.value); if (v >= 1 && v <= 999) set(() => { e[k] = v; if (e.to < e.from) { if (k === 'from') e.to = v; else e.from = v; } }); i.value = String(e[k]); };
    return i;
  };
  const from = num('from', t('exp.from')), to = num('to', t('exp.to'));
  const bars = () => { from.disabled = to.disabled = e.range !== 'bars'; from.value = String(e.from); to.value = String(e.to); };
  const tail = h('input', { type: 'checkbox', checked: e.tail, data: { role: 'exptail' } }); tail.onchange = () => set(() => { e.tail = tail.checked; });
  const bits = h('select', { 'aria-label': t('exp.bits'), data: { role: 'expbits' } }, ...[16, 24].map(b => h('option', { value: String(b), selected: e.bits === b }, t('exp.bitsOpt' + b))));
  bits.onchange = () => set(() => { e.bits = +bits.value as 16 | 24; });
  const rate = h('select', { 'aria-label': t('exp.rate'), data: { role: 'exprate' } }, ...[[44100, '44,1 kHz'], [48000, '48 kHz']].map(([v, l]) => h('option', { value: String(v), selected: e.rate === v }, String(l))));
  rate.onchange = () => set(() => { e.rate = +rate.value as 44100 | 48000; });
  const sum = h('p', { class: 'tip', role: 'status', id: 'expSum' }, exportSummary());
  d.replaceChildren(h('h2', {}, '⚙ ' + t('exp.title')),
    h('fieldset', { class: 'eset' }, h('legend', {}, t('exp.range')),
      radio('all', t('exp.all')), radio('loop', t('exp.loop', p.loopStart + 1, p.loopStart + p.loopLen)),
      h('div', { class: 'eopt' }, radio('bars', t('exp.bars')), h('label', { class: 'mini-in' }, t('exp.from'), from), h('label', { class: 'mini-in' }, t('exp.to'), to)),
      h('label', { class: 'eopt' }, tail, t('exp.tail'))),
    h('fieldset', { class: 'eset' }, h('legend', {}, t('exp.format')),
      h('label', { class: 'fld' }, t('exp.bits'), bits), h('label', { class: 'fld' }, t('exp.rate'), rate), h('p', { class: 'tip' }, t('exp.formatTip'))),
    sum,
    h('form', { method: 'dialog', class: 'erow' }, h('button', { type: 'button', class: 'pill accent', id: 'bExpGo', onclick: () => { d.close(); exportWav(); } }, t('exp.go')), h('button', { class: 'pill' }, t('lib.close'))));
  bars(); d.showModal();
}

/** Bloc-notes du projet : paroles, idées, liste de choses à faire. */
function showNotes() {
  const d = $<HTMLDialogElement>('notes'), area = h('textarea', { id: 'notesText', 'aria-label': t('notes.title'), placeholder: t('notes.placeholder'), spellcheck: true });
  area.value = S.project.notes;
  d.replaceChildren(h('h2', {}, '📝 ' + t('notes.title')), area, h('form', { method: 'dialog' }, h('button', { class: 'pill accent' }, t('lib.close'))));
  d.onclose = () => { if (area.value !== S.project.notes) { S.project.notes = area.value; commit(); } };
  d.showModal(); area.focus();
}

export function renderTop() {
  const p = S.project, bpm = $<HTMLInputElement>('bpm'), pname = $<HTMLInputElement>('pname');
  if (document.activeElement !== bpm) bpm.value = String(p.bpm);
  if (document.activeElement !== pname) pname.value = p.name;
  document.title = (S.file.path ? S.file.name : p.name) + ' — KH Music Pro';
  $<HTMLInputElement>('loopS').value = String(p.loopStart + 1);
  $<HTMLInputElement>('loopE').value = String(p.loopStart + p.loopLen);
  const lr = t('top.loopRange', p.loopStart + 1, p.loopStart + p.loopLen);
  $('bLoop').textContent = `⟲ ${p.loopStart + 1} → ${p.loopStart + p.loopLen}`; $('bLoop').title = t('top.loopTip') + ' — ' + lr; $('bLoop').setAttribute('aria-label', t('top.loop') + ' — ' + lr);
  $('bExport').title = t('top.exportTip') + ' — ' + exportSummary();
  $<HTMLSelectElement>('snap').value = String(S.snap);
  $<HTMLSelectElement>('sig').value = String(p.sig);
  for (const [id, on] of [['bLoop', p.loop], ['bMetro', p.metronome], ['bCount', p.countIn], ['bPunch', p.punch], ['bMidi', midi.inputs > 0], ['bNotes', !!p.notes.trim()]] as const) {
    $(id).classList.toggle('on', on); $(id).setAttribute('aria-pressed', String(on));
  }
}

function buildHelp() {
  const k = (s: string) => `<kbd>${s}</kbd>`;
  const piano = ['A', 'S', 'D', 'F', 'G', 'H', 'J'].map(x => k(keyLabel(x))).join('');
  const rows: [string, string][] = [
    [k(t('help.key.space')), 'space'], [k(t('help.key.enter')), 'enter'], [k('R'), 'rec'], [`${k('L')} / ${k('M')}`, 'loop'],
    [`${k('Ctrl')}+${k('Z')} / ${k('Y')}`, 'undo'], [`${k('Ctrl')}+${k('D')}`, 'dup'], [`${k('Ctrl')}+${k('E')}`, 'split'],
    [k(t('help.key.del')), 'del'], [`${k('Ctrl')}+${k('S')}`, 'save'], [piano + '…', 'piano'],
    [`${k(keyLabel('Z'))} / ${k('X')}`, 'octave'], [`${k('Ctrl')}+${k('A')} / ${k('C')} / ${k('V')}`, 'notes'], [`${k('←')} ${k('→')} ${k('↑')} ${k('↓')}`, 'arrows'], [`${k('1')}–${k('9')}`, 'scenes'], [k(t('help.key.shiftClick')), 'multi'], [k(t('help.key.shiftDrag')), 'looprule'], [k(t('help.key.ctrlWheel')), 'zoom'], [k(t('help.key.shiftWheel')), 'hscroll'], [`${k('1')}–${k('8')} · ${k(keyLabel('A'))}–${k('K')}`, 'pads'],
  ];
  $('help').innerHTML = `
    <h2><span class="logo">KH</span> ${t('help.title')}</h2>
    <div class="hcols">
      <div><h3>${t('help.start')}</h3><ol>${[1, 11, 2, 3, 4, 5, 10, 6, 7, 9, 8].map(i => `<li>${t('help.s' + i)}</li>`).join('')}</ol></div>
      <div><h3>${t('help.keys')}</h3><table>${rows.map(([a, key]) => `<tr><td>${a}</td><td>${t('help.k.' + key)}</td></tr>`).join('')}</table></div>
    </div>
    <p class="tip credits">${t('help.credits')}</p>
    <p class="tip credits"><a href="https://github.com/sfzinstruments/SalamanderGrandPiano" target="_blank" rel="noopener">Salamander Grand Piano</a> · <a href="https://creativecommons.org/licenses/by/3.0/" target="_blank" rel="noopener">CC BY 3.0</a> · <a href="https://versilian-studios.com/virtuosity-drums/" target="_blank" rel="noopener">Virtuosity Drums</a> · <a href="https://github.com/sfzinstruments/GregSullivan.E-Pianos" target="_blank" rel="noopener">Greg Sullivan E-Pianos</a> · <a href="https://github.com/sfzinstruments/karoryfer.fashionbass" target="_blank" rel="noopener">Fashionbass</a> · <a href="https://github.com/sgossner/VCSL" target="_blank" rel="noopener">VCSL</a> · <a href="https://creativecommons.org/publicdomain/zero/1.0/" target="_blank" rel="noopener">CC0</a></p>
    <form method="dialog"><button class="pill" id="bTour" value="tour">🧭 ${t('tour.start')}</button><button class="pill accent" autofocus>${t('help.go')}</button></form>`;
  $('bTour').onclick = () => setTimeout(startTour, 50);
}

export function initFileInputs() {
  $<HTMLInputElement>('fAudio').onchange = e => filesPicked(e.target as HTMLInputElement);
  $<HTMLInputElement>('fMidi').onchange = e => {
    const inp = e.target as HTMLInputElement;
    if (inp.files?.[0]) importMidiFile(inp.files[0]);
    inp.value = '';
  };
  $<HTMLInputElement>('fProj').onchange = e => {
    const inp = e.target as HTMLInputElement;
    if (inp.files?.[0]) openFile(inp.files[0]);
    inp.value = '';
  };
}
