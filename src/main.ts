import './style.css';
import { deleteClip, duplicateClip, saveFile, splitClip, toggleRecord } from './actions';
import { engine, renderOffline } from './audio/engine';
import { stretchBuffer } from './audio/stretch';
import { exportMidi, importMidi, zip } from './files';
import { setLang, t } from './i18n';
import { allNotesOff, kb, midi, noteOff, noteOn, onMidi, padHit } from './input';
import { S, buffers, commit, emit, findTrack, loadAutosave, onChange, onSelect, redo, resetHistory, undo } from './store';
import { BAR, demoProject, stepDur } from './types';
import { initArrDrop, refreshSelection, renderArr } from './ui/arr';
import { clamp, toast } from './ui/dom';
import { flashPad, renderEditor, updateEditorPlayhead } from './ui/editor';
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

function renderAll() { engine.sync(); renderArr(); renderPanel(); renderTop(); }
onChange(renderAll);
onSelect(() => {
  refreshSelection();
  if (S.tab === 'editor') renderPanel();
  else document.querySelectorAll<HTMLElement>('.strip[data-id]').forEach(e => e.classList.toggle('sel', e.dataset.id === S.selTrack));
});
engine.onLive = refreshLive;
midi.onChange = renderTop;

document.querySelectorAll<HTMLElement>('#tabs button').forEach(b => b.onclick = () => { S.tab = b.dataset.tab as typeof S.tab; renderPanel(); });
$('split').onpointerdown = e => {
  e.preventDefault();
  const main = document.querySelector('main') as HTMLElement;
  const mv = (ev: PointerEvent) => { main.style.gridTemplateRows = `1fr ${clamp(innerHeight - ev.clientY, 140, innerHeight - 220)}px`; };
  const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); };
  addEventListener('pointermove', mv); addEventListener('pointerup', up);
};

// ---------- Clavier ----------
const PIANO: Record<string, number> = { KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6, KeyG: 7, KeyY: 8, KeyH: 9, KeyU: 10, KeyJ: 11, KeyK: 12, KeyO: 13, KeyL: 14 };
const PADS = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK'];
const down = new Map<string, number>();

addEventListener('keydown', e => {
  const el = e.target as HTMLElement;
  if (help.open) return;
  if (el.tagName === 'SELECT' || el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && (el as HTMLInputElement).type !== 'range')) return;
  const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
  if (mod) {
    const fn = ({ z: e.shiftKey ? redo : undo, y: redo, d: duplicateClip, e: splitClip, s: saveFile } as Record<string, () => void>)[k];
    if (fn) { e.preventDefault(); fn(); }
    return;
  }
  if (e.altKey) return;
  if (e.code === 'Space') { e.preventDefault(); engine.toggle(); return; }
  if (e.key === 'Enter' && el.tagName !== 'BUTTON') { engine.seek(0); return; }
  if (e.key === 'Delete' || e.key === 'Backspace') { deleteClip(); return; }
  if (e.key === '?') { help.showModal(); return; }
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
addEventListener('keyup', e => { const m = down.get(e.code); if (m !== undefined) { down.delete(e.code); noteOff(m); } });
addEventListener('blur', () => { down.clear(); allNotesOff(); });

// ---------- Boucle d'affichage ----------
function frame() {
  const step = engine.currentStep(), p = S.project, live = engine.mode === 'live';
  const ph = document.getElementById('ph');
  if (ph) { ph.style.transform = `translateX(${(live ? engine.pos : step) * S.px}px)`; ph.style.opacity = live ? '.3' : '1'; }
  const s = Math.floor(step + 1e-6), sec = step * stepDur(p.bpm);
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
  updateEditorPlayhead(step);
  updateMeters();
  requestAnimationFrame(frame);
}

// ---------- Démarrage ----------
function rebuild() { buildTop(onLang); renderAll(); }
function onLang() { rebuild(); }

(async () => {
  await loadAutosave();
  resetHistory();
  S.selTrack = S.project.tracks[0]?.id ?? '';
  S.selClip = S.project.tracks[0]?.clips[0]?.id ?? '';
  initArrDrop(); initFileInputs();
  rebuild();
  requestAnimationFrame(frame);
  try { if (!localStorage.getItem('kh-welcome')) { help.showModal(); localStorage.setItem('kh-welcome', '1'); } } catch { /* stockage désactivé */ }
})();

// Point d'accès pour les tests automatisés (QA) et le débogage.
Object.assign(window, { kh: { S, engine, buffers, commit, emit, renderOffline, exportMidi, importMidi, zip, stretchBuffer, kb, noteOn, noteOff, padHit, onMidi, setLang: (l: 'fr' | 'en' | 'es') => { setLang(l); rebuild(); }, demoProject, resetHistory } });

// Application installable et utilisable hors-ligne (version construite uniquement).
if (import.meta.env.PROD && 'serviceWorker' in navigator) addEventListener('load', async () => {
  try {
    await navigator.serviceWorker.register('sw.js');
    const reg = await navigator.serviceWorker.ready;
    const urls = performance.getEntriesByType('resource').map(e => e.name).filter(u => u.startsWith(location.origin));
    reg.active?.postMessage({ cache: urls });
  } catch { /* hors-ligne indisponible : l'application fonctionne quand même */ }
});
