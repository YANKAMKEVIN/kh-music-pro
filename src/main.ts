import './style.css';
import './ui/savealert.css';
import { watchSaveHealth } from './ui/savealert';
import { copyClip, deleteClip, duplicateClip, listenSystemOpen, openProjectFile, pasteClip, saveFile, saveFileAs, splitClip, toggleRecord } from './actions';
import { engine, lastRender, measureLoad, renderGroups, renderOffline, renderOpts } from './audio/engine';
import { auBridge, createAu } from './audio/au';
import { ioBridge } from './audio/native-io';
import { initNative, setNativeEngine } from './ui/native';
import { liveWams } from './audio/wam';
import { lufs, noteLoudness } from './audio/loudness';
import { BANKS, forgetBank, loadBank, sampleFor, expressiveSample, bankReady } from './audio/banks';
import { SUSTAIN_BANKS } from './audio/sustain';
import { touchCutoff, touchSoftness } from './audio/graph';
import { stretchBuffer } from './audio/stretch';
import { tuneBuffer } from './audio/tune';
import { exportMidi, importMidi, zip } from './files';
import { setLang, t } from './i18n';
import { allNotesOff, kb, learn, midi, noteOff, noteOn, onMidi, padHit, padRelease } from './input';
import { S, buffers, commit, crash, saveHealth, emit, findTrack, listVersions, loadAutosave, markRecovered, onChange, onSelect, redo, resetHistory, restoreVersion, saveNow, snapshot, undo, versioning, watchSession } from './store';
import { BAR, MIX_PRESETS, PRESETS, bpmAt, demoProject, makeSynth, newBus, newInsert, setBar, setRes, templateProject, timeOf } from './types';
import { initArrDrop, refreshSelection, renderArr } from './ui/arr';
import { clamp, followDrag, h, toast } from './ui/dom';
import { detectPitch } from './audio/pitch';
import { flashPad, notesKey, readKeyboardLayout, renderEditor, setKeyboardLayout, updateEditorPlayhead, updateTuner } from './ui/editor';
import { refreshRack, showRack } from './ui/rack';
import { startTour } from './ui/tour';
import { createFromTemplate, showLibrary, showVersions } from './ui/library';
import { refreshLive, renderLive } from './ui/live';
import { renderMixer, updateMeters } from './ui/mixer';
import { buildTop, initFileInputs, renderTop } from './ui/top';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const help = $<HTMLDialogElement>('help');

function renderPanel() {
  $('panel').replaceChildren(S.tab === 'editor' ? renderEditor() : S.tab === 'mixer' ? renderMixer() : renderLive());
  document.querySelectorAll<HTMLElement>('#tabs button').forEach(b => {
    const on = b.dataset.tab === S.tab; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on));
  });
}

/** Signature de l'élément qui a le focus : balise, attributs data-*, aria-label, et rang parmi les éléments identiques. */
function focusKey(): { sel: string; i: number } | null {
  const a = document.activeElement as HTMLElement | null;
  // Seulement les boutons et les curseurs : un champ texte ou une liste qui garderait le focus bloquerait les raccourcis (Espace…).
  if (!a || a.closest('dialog') || !(a.tagName === 'BUTTON' || (a.tagName === 'INPUT' && (a as HTMLInputElement).type === 'range'))) return null;
  const esc = (v: string) => v.replace(/["\\]/g, '\\$&');
  let sel = a.tagName.toLowerCase();
  for (const at of [...a.attributes]) if (at.name.startsWith('data-') || at.name === 'aria-label' || at.name === 'type') sel += `[${at.name}="${esc(at.value)}"]`;
  return { sel, i: [...document.querySelectorAll(sel)].indexOf(a) };
}
/** Au clavier, chaque réglage redessine l'écran : le focus revient sur le même contrôle, au lieu de repartir en haut de la page. */
function keepFocus(draw: () => void) {
  const k = focusKey(), before = document.activeElement;
  draw();
  if (!k || (before && before.isConnected) || k.i < 0) return;
  const el = document.querySelectorAll<HTMLElement>(k.sel)[k.i];
  el?.focus({ preventScroll: true });
}

function renderAll() { keepFocus(() => { setBar((S.project.sig || 4) * 4); engine.sync(); refreshRack(); renderArr(); renderPanel(); renderTop(); }); }
onChange(renderAll);
onSelect(() => {
  refreshSelection();
  if (S.tab === 'editor') keepFocus(renderPanel);
  else document.querySelectorAll<HTMLElement>('.strip[data-id]').forEach(e => e.classList.toggle('sel', e.dataset.id === S.selTrack));
});
engine.onLive = refreshLive;
engine.onBanks = st => st === 'failed' ? toast(t('toast.bankFailed'), 'error') : toast(t(st === 'loading' ? 'toast.bankLoading' : 'toast.bankReady'));
midi.onChange = renderTop;

document.querySelectorAll<HTMLElement>('#tabs button').forEach(b => b.onclick = () => { S.tab = b.dataset.tab as typeof S.tab; renderPanel(); });
$('split').onpointerdown = e => {
  e.preventDefault();
  const main = document.querySelector('main') as HTMLElement;
  const mv = (ev: PointerEvent) => { main.style.gridTemplateRows = `1fr ${clamp(innerHeight - ev.clientY, 140, innerHeight - 220)}px`; };
  followDrag(e, mv, () => { });
};

// ---------- Clavier ----------
const PIANO: Record<string, number> = { KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6, KeyG: 7, KeyY: 8, KeyH: 9, KeyU: 10, KeyJ: 11, KeyK: 12, KeyO: 13, KeyL: 14 };
const PADS = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK'];
const down = new Map<string, number>();

/** Le focus vient-il de la touche Tab (navigation au clavier) plutôt que d'un clic ou d'un doigt ? */
let focusByTab = false;
addEventListener('keydown', e => { if (e.key === 'Tab') focusByTab = true; }, true);
addEventListener('pointerdown', () => { focusByTab = false; }, true);
addEventListener('keydown', e => {
  const el = e.target as HTMLElement;
  if (document.querySelector('dialog[open], .tour')) return;
  if (el.tagName === 'SELECT' || el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && (el as HTMLInputElement).type !== 'range')) return;
  const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
  if (el.tagName !== 'INPUT' && notesKey(e)) { e.preventDefault(); return; }
  if (mod) {
    const fn = ({ z: e.shiftKey ? redo : undo, y: redo, d: duplicateClip, e: splitClip, s: e.shiftKey ? saveFileAs : saveFile, o: openProjectFile } as Record<string, () => void>)[k];
    if (fn) { e.preventDefault(); fn(); }
    else if (k === 'c' && !getSelection()?.toString()) { if (copyClip()) e.preventDefault(); }
    else if (k === 'v') { if (pasteClip()) e.preventDefault(); }
    return;
  }
  if (e.altKey) return;
  // Espace lance ou arrête la lecture, sauf sur un bouton atteint au clavier (Tab) : il actionne alors ce bouton,
  // comme partout ailleurs. Un bouton juste cliqué à la souris ou au doigt garde le focus : Espace reste la lecture.
  // (:focus-visible ne suffit pas : Chromium le rallume dès qu'une touche est pressée.)
  if (e.code === 'Space' && el.tagName === 'BUTTON' && focusByTab) return;
  if (e.code === 'Space') { e.preventDefault(); engine.toggle(); return; }
  if (e.key === 'Enter' && el.tagName !== 'BUTTON') { engine.seek(0); return; }
  if (e.key === 'Delete' || e.key === 'Backspace') { deleteClip(); return; }
  if (e.key === '?') { help.showModal(); return; }
  // Onglet Live : les chiffres lancent les scènes.
  if (S.tab === 'live' && /^Digit[1-9]$/.test(e.code)) { engine.launchScene(+e.code.slice(5) - 1); return; }
  const tr = findTrack(S.selTrack);
  if (tr?.type === 'synth') {
    if (e.code in PIANO) {
      if (!e.repeat && !down.has(e.code)) { const m = 60 + PIANO[e.code] + kb.octave * 12; down.set(e.code, m); noteOn(m); }
      return;
    }
    if (e.code === 'KeyZ' || e.code === 'KeyX') { kb.octave = clamp(kb.octave + (e.code === 'KeyZ' ? -1 : 1), -3, 3); toast(t('toast.octave', (kb.octave > 0 ? '+' : '') + kb.octave)); return; }
  }
  if (tr?.type === 'drums') {
    const i = PADS.indexOf(e.code);
    if (i >= 0) { if (!e.repeat) { padHit(i, 1, tr); flashPad(i); } return; }
  }
  if (e.code === 'KeyR') toggleRecord();
  else if (k === 'l') $('bLoop').click();
  else if (k === 'm') $('bMetro').click();
});
addEventListener('keyup', e => { const pi = PADS.indexOf(e.code); if (pi >= 0) padRelease(pi); const m = down.get(e.code); if (m !== undefined) { down.delete(e.code); noteOff(m); } });
addEventListener('blur', () => { down.clear(); allNotesOff(); });

// ---------- Boucle d'affichage ----------
function frame() {
  const step = engine.currentStep(), p = S.project, live = engine.mode === 'live';
  const ph = document.getElementById('ph');
  if (ph) { ph.style.transform = `translateX(${(live ? engine.pos : step) * S.px}px)`; ph.style.opacity = live ? '.3' : '1'; }
  const s = Math.floor(step + 1e-6), sec = live ? step * 15 / p.bpm : timeOf(p, step);
  // Avec des changements de tempo, l'afficheur suit le tempo en vigueur sous la tête de lecture.
  const bpmEl = $<HTMLInputElement>('bpm'); if (p.tempos.length && !live && document.activeElement !== bpmEl) bpmEl.value = String(bpmAt(p, step));
  $('pos').textContent = `${Math.floor(s / BAR) + 1}.${Math.floor((s % BAR) / 4) + 1}.${(s % 4) + 1}`;
  $('time').textContent = `${Math.floor(sec / 60)}:${(sec % 60).toFixed(1).padStart(4, '0')}`;
  document.body.classList.toggle('playing', engine.playing);
  document.body.classList.toggle('recording', !!engine.recording);
  document.body.classList.toggle('livemode', live);
  $('bPlay').textContent = engine.playing ? '❚❚' : '▶';
  if (engine.playing && !live) {
    const arr = $('arr'), x = step * S.px, view = arr.clientWidth - 256;
    if (x > arr.scrollLeft + view - 40 || x < arr.scrollLeft) arr.scrollLeft = Math.max(0, x - 80);
  }
  updateEditorPlayhead(step); updateTuner();
  updateMeters();
  requestAnimationFrame(frame);
}

// ---------- Démarrage ----------
function rebuild() { buildTop(onLang); renderAll(); }
function onLang() { rebuild(); }
// Lettres des touches affichées d'après le vrai clavier (relu au retour dans la fenêtre : un clavier a pu être branché).
readKeyboardLayout(rebuild);
watchSaveHealth(saveFile);
addEventListener('focus', () => readKeyboardLayout(rebuild));

/** Après une fermeture inattendue : le morceau est déjà rouvert depuis la sauvegarde automatique ; on le dit, avec un accès aux versions. */
function crashNotice() {
  const fmt = new Intl.DateTimeFormat(document.documentElement.lang, { dateStyle: 'medium', timeStyle: 'medium' });
  const d = h('dialog', { id: 'crash', class: 'crash', 'aria-labelledby': 'crashT' },
    h('h2', { id: 'crashT' }, t('crash.title')),
    h('p', {}, t('crash.body', crash.name || S.project.name, crash.at ? fmt.format(crash.at) : '—')),
    h('div', { class: 'vrow' },
      h('button', { class: 'pill', data: { act: 'crashvers' }, onclick: () => { d.close(); showVersions(); } }, t('crash.versions')),
      h('button', { class: 'pill accent', data: { act: 'crashok' }, onclick: () => d.close() }, t('crash.ok'))));
  d.addEventListener('close', () => d.remove());
  document.body.append(d); d.showModal();
  (d.querySelector('[data-act=crashok]') as HTMLElement).focus();
}

(async () => {
  await loadAutosave();
  await watchSession(() => { markRecovered().catch(() => { }); if (!document.querySelector('dialog[open]')) crashNotice(); });
  resetHistory();
  S.selTrack = S.project.tracks[0]?.id ?? '';
  S.selClip = S.project.tracks[0]?.clips[0]?.id ?? '';
  initArrDrop(); initFileInputs(); listenSystemOpen();
  rebuild();
  engine.prepare().then(() => emit()); // instruments réels du projet rouvert
  // Version bureau macOS : moteur audio natif, s'il a été activé dans les Réglages audio.
  initNative();
  requestAnimationFrame(frame);
  // Version d'ouverture : on peut toujours revenir au morceau tel qu'il était au démarrage.
  snapshot(crash.found ? 'crash' : 'open').catch(() => { });
  let welcome = false;
  try { if (!localStorage.getItem('kh-welcome')) { welcome = true; help.showModal(); localStorage.setItem('kh-welcome', '1'); } } catch { /* stockage désactivé */ }
  if (crash.found && !welcome) crashNotice();
})();

// Point d'accès pour les tests automatisés (QA) et le débogage.
Object.assign(window, { kh: { S, engine, buffers, commit, emit, renderOffline, renderOpts, renderGroups, exportMidi, importMidi, zip, stretchBuffer, tuneBuffer, kb, learn, showLibrary, createFromTemplate, MIX_PRESETS, setRes, newBus, showRack, newInsert, liveWams, lastRender, timeOf, bpmAt, bar: () => BAR, PRESETS, makeSynth, detectPitch, startTour, lufs, templateProject, noteOn, noteOff, padHit, onMidi, setLang: (l: 'fr' | 'en' | 'es') => { setLang(l); rebuild(); }, demoProject, resetHistory, listenSystemOpen, measureLoad, store: { saveHealth, versioning, listVersions, restoreVersion, snapshot, saveNow, crash }, showVersions, banks: { BANKS, forgetBank, SUSTAIN_BANKS, loadBank, sampleFor, expressiveSample, bankReady, noteLoudness, touchSoftness, touchCutoff }, createAu, auBridge, ioBridge, setNativeEngine, initNative, setKeyboardLayout: (m: Record<string, string> | null) => { setKeyboardLayout(m && new Map(Object.entries(m))); rebuild(); } } });

// Application installable et utilisable hors-ligne (version construite uniquement).
if (import.meta.env.PROD && 'serviceWorker' in navigator) addEventListener('load', async () => {
  try {
    await navigator.serviceWorker.register('sw.js');
    const reg = await navigator.serviceWorker.ready;
    const urls = performance.getEntriesByType('resource').map(e => e.name).filter(u => u.startsWith(location.origin));
    reg.active?.postMessage({ cache: urls });
  } catch { /* hors-ligne indisponible : l'application fonctionne quand même */ }
});
