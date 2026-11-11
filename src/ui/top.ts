import { exportMidiFile, exportStems, exportWav, filesPicked, importMidiFile, newProject, openFile, pickAudio, saveFile, tapTempo, toggleRecord } from '../actions';
import { engine } from '../audio/engine';
import { LANGS, Lang, lang, setLang, t } from '../i18n';
import { connectMidi, midi } from '../input';
import { S, commit, emit, redo, undo } from '../store';
import { clamp, h, toast } from './dom';
import { keyLabel } from './editor';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

async function midiConnect() {
  if (!midi.supported) return toast(t('midi.unsupported'), 'error');
  try { const n = await connectMidi(); toast(n ? t('midi.connected', n) : t('midi.none')); }
  catch { toast(t('midi.denied'), 'error'); }
}

/** Construit la barre supérieure dans la langue courante. */
export function buildTop(onLang: () => void) {
  const b = (id: string, cls: string, label: string, tip: string, fn: () => void) => h('button', { id, class: cls, title: tip, 'aria-label': tip, onclick: fn }, label);
  const tgl = (id: string, label: string, tip: string, fn: () => void) => h('button', { id, class: 'pill', title: tip, 'aria-pressed': 'false', onclick: fn }, label);
  const num = (id: string, label: string, min: number, max: number, fn: () => void) => { const i = h('input', { id, type: 'number', min: String(min), max: String(max), step: '1', 'aria-label': label, title: label }); i.onchange = fn; return i; };

  const setLoop = () => {
    const s = clamp(Math.round(+$<HTMLInputElement>('loopS').value) || 1, 1, 999), e = Math.max(s, Math.round(+$<HTMLInputElement>('loopE').value) || s);
    S.project.loopStart = s - 1; S.project.loopLen = e - s + 1; commit();
  };
  const bpm = num('bpm', t('top.tempo'), 40, 240, () => { S.project.bpm = clamp(Math.round(+bpm.value) || 120, 40, 240); bpm.value = String(S.project.bpm); commit(); });
  const snap = h('select', { id: 'snap', 'aria-label': t('top.gridTip') },
    h('option', { value: '16' }, t('grid.bar')), h('option', { value: '4' }, t('grid.beat')), h('option', { value: '1' }, '1/16'));
  snap.onchange = () => { S.snap = +snap.value; };
  const zoom = (f: number) => { S.px = clamp(S.px * f, 3, 44); emit(); };
  const pname = h('input', { id: 'pname', class: 'pname', 'aria-label': t('top.pname'), title: t('top.pname'), spellcheck: false });
  pname.onchange = () => { S.project.name = pname.value.trim() || t('proj.new'); commit(); };
  const langSel = h('select', { id: 'lang', 'aria-label': t('top.lang'), title: t('top.lang') }, ...LANGS.map(([v, n]) => h('option', { value: v, selected: v === lang() }, n)));
  langSel.onchange = () => { setLang(langSel.value as Lang); onLang(); };

  const menu = h('details', { class: 'menu', id: 'menu' });
  const item = (id: string, label: string, fn: () => void) => h('button', { id, onclick: () => { menu.open = false; fn(); } }, label);
  menu.append(h('summary', { class: 'pill' }, t('top.project') + ' ▾'), h('div', { class: 'menu-list' },
    item('bNew', t('top.new'), newProject), item('bOpen', t('top.open'), () => $('fProj').click()),
    item('bSave', t('top.save'), saveFile), item('bImport', t('top.import'), () => pickAudio()),
    item('bMidiIn', t('top.midiIn'), () => $('fMidi').click()), h('hr', {}),
    item('bStems', t('top.stems'), exportStems), item('bMidiOut', t('top.midiOut'), exportMidiFile)));

  $('top').replaceChildren(
    h('div', { class: 'brand', 'aria-label': 'KH Music Pro' }, h('span', { class: 'logo' }, 'KH'), h('span', { class: 'bname' }, 'MUSIC PRO')),
    h('div', { class: 'grp transport', role: 'group' },
      b('bStop', 'tbtn', '■', t('top.stop'), () => engine.stop()),
      b('bPlay', 'tbtn play', '▶', t('top.play'), () => engine.toggle()),
      b('bRec', 'tbtn rec', '●', t('top.rec'), () => toggleRecord())),
    h('div', { class: 'grp display' },
      h('div', {}, h('span', { id: 'pos' }, '1.1.1'), h('small', {}, t('top.bar'))),
      h('div', {}, h('span', { id: 'time' }, '0:00.0'), h('small', {}, t('top.time'))),
      h('label', {}, bpm, h('small', {}, 'BPM'))),
    h('div', { class: 'grp' },
      b('bTap', 'pill', 'Tap', t('top.tapTip'), tapTempo),
      tgl('bMetro', t('top.metro'), t('top.metroTip'), () => { S.project.metronome = !S.project.metronome; commit(); }),
      tgl('bCount', t('top.countIn'), t('top.countInTip'), () => { S.project.countIn = !S.project.countIn; commit(); }),
      tgl('bLoop', '⟲ ' + t('top.loop'), t('top.loopTip'), () => { S.project.loop = !S.project.loop; commit(); }),
      h('label', { class: 'mini-in' }, t('top.from'), num('loopS', t('top.loopS'), 1, 999, setLoop)),
      h('label', { class: 'mini-in' }, t('top.to'), num('loopE', t('top.loopE'), 1, 999, setLoop))),
    h('div', { class: 'grp right' },
      h('label', { class: 'mini-in', title: t('top.gridTip') }, t('top.grid'), snap),
      b('bZoomOut', 'icon', '−', t('top.zoomOut'), () => zoom(1 / 1.3)), b('bZoomIn', 'icon', '＋', t('top.zoomIn'), () => zoom(1.3)),
      b('bUndo', 'icon', '↶', t('top.undo'), undo), b('bRedo', 'icon', '↷', t('top.redo'), redo),
      b('bMidi', 'pill', '🎛 MIDI', t('top.midiTip'), midiConnect),
      pname, menu,
      b('bExport', 'pill accent', t('top.export'), t('top.exportTip'), exportWav),
      langSel,
      b('bHelp', 'icon', '?', t('top.help'), () => $<HTMLDialogElement>('help').showModal())));

  document.querySelectorAll<HTMLElement>('#tabs button').forEach(x => { x.textContent = t('tab.' + x.dataset.tab); });
  $('split').title = t('split.tip');
  buildHelp();
}

export function renderTop() {
  const p = S.project, bpm = $<HTMLInputElement>('bpm'), pname = $<HTMLInputElement>('pname');
  if (document.activeElement !== bpm) bpm.value = String(p.bpm);
  if (document.activeElement !== pname) pname.value = p.name;
  $<HTMLInputElement>('loopS').value = String(p.loopStart + 1);
  $<HTMLInputElement>('loopE').value = String(p.loopStart + p.loopLen);
  $<HTMLSelectElement>('snap').value = String(S.snap);
  for (const [id, on] of [['bLoop', p.loop], ['bMetro', p.metronome], ['bCount', p.countIn], ['bMidi', midi.inputs > 0]] as const) {
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
    [`${k(keyLabel('Z'))} / ${k('X')}`, 'octave'], [`${k('1')}–${k('8')} · ${k(keyLabel('A'))}–${k('K')}`, 'pads'],
  ];
  $('help').innerHTML = `
    <h2><span class="logo">KH</span> ${t('help.title')}</h2>
    <div class="hcols">
      <div><h3>${t('help.start')}</h3><ol>${[1, 2, 3, 4, 5, 6, 7, 9, 8].map(i => `<li>${t('help.s' + i)}</li>`).join('')}</ol></div>
      <div><h3>${t('help.keys')}</h3><table>${rows.map(([a, key]) => `<tr><td>${a}</td><td>${t('help.k.' + key)}</td></tr>`).join('')}</table></div>
    </div>
    <form method="dialog"><button class="pill accent" autofocus>${t('help.go')}</button></form>`;
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
