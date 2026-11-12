import { engine } from '../audio/engine';
import { t } from '../i18n';
import { kb } from '../input';
import { S, commit, findTrack } from '../store';
import { CATS, PRESETS, makeSynth } from '../types';
import { h, toast } from './dom';

const FAVORITES = 'kh-sound-favorites';
let choiceToken = 0;
/** Même chemin de sélection pour le menu rapide et le navigateur. */
export function chooseSound(trackId: string, id: string): boolean {
  const tr = findTrack(trackId);
  if (!tr || tr.type !== 'synth' || !PRESETS[id]) return false;
  const sp = tr.synth, keep = { bufferId: sp?.bufferId, sampleName: sp?.sampleName, root: sp?.root ?? 60 };
  tr.synth = { ...makeSynth(id), ...keep }; const token = ++choiceToken; commit();
  const preview = () => { if (token === choiceToken && findTrack(trackId) === tr && tr.synth?.preset === id) engine.previewNote(tr, 60 + kb.octave * 12); };
  if (tr.synth.engine === 'multi' && tr.synth.bank) engine.loadBank(tr.synth.bank).then(ok => { if (ok) preview(); });
  else preview();
  return true;
}

function favorites(): Set<string> {
  try { const data = JSON.parse(localStorage.getItem(FAVORITES) || '[]'); return new Set(Array.isArray(data) ? data.filter(id => typeof id === 'string' && PRESETS[id]) : []); }
  catch { return new Set(); }
}
const normalize = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/** Fenêtre de sons : recherche, famille, favoris et préécoute sans modifier la piste. */
export function showSounds(trackId: string) {
  if (document.getElementById('sounds')) return;
  const found = findTrack(trackId); if (!found || found.type !== 'synth') return;
  const tr = found; choiceToken++; engine.stopAudition();
  const owner = S.project, favs = favorites();
  let onlyFavorites = false, request = 0, closed = false;
  const dlg = h('dialog', { id: 'sounds', class: 'sound-browser', 'aria-labelledby': 'sounds-title' });
  const status = h('p', { class: 'sound-status', role: 'status', 'aria-live': 'polite' });
  const count = h('span', { class: 'sound-count', 'aria-live': 'polite' });
  const list = h('ul', { class: 'sound-list', 'aria-label': t('sounds.results') });
  const query = h('input', { type: 'search', placeholder: t('sounds.search'), 'aria-label': t('sounds.search'), data: { role: 'sound-search' }, autocomplete: 'off' });
  const family = h('select', { 'aria-label': t('sounds.family'), data: { role: 'sound-family' } }, h('option', { value: '' }, t('sounds.all')));
  for (const cat of CATS) family.append(h('option', { value: cat }, t('cat.' + cat)));
  const favFilter = h('button', { class: 'pill', 'aria-pressed': 'false', data: { act: 'sound-favorites' }, onclick: () => {
    stop(); onlyFavorites = !onlyFavorites; favFilter.setAttribute('aria-pressed', String(onlyFavorites)); favFilter.classList.toggle('on', onlyFavorites); render();
  } }, '★ ' + t('sounds.favorites'));
  const validTrack = () => S.project === owner && findTrack(trackId) === tr;
  const stop = () => { request++; engine.stopAudition(); status.textContent = ''; };
  const audition = async (id: string, button: HTMLButtonElement) => {
    stop(); const token = request;
    if (!validTrack()) { status.textContent = t('sounds.noTrack'); return; }
    const sp = { ...makeSynth(id), bufferId: tr.synth?.bufferId, root: tr.synth?.root ?? 60 };
    if (sp.engine === 'sampler' && !sp.bufferId) { status.textContent = t('sounds.noSample'); return; }
    status.textContent = t('sounds.loading'); button.setAttribute('aria-busy', 'true');
    try {
      const ok = await engine.audition(sp, PRESETS[id].cat.toLowerCase().includes('bass') ? 48 : 60);
      if (!closed && token === request) status.textContent = t(ok ? 'sounds.listening' : 'sounds.failed', t('ins.' + id));
    } catch { if (!closed && token === request) status.textContent = t('sounds.failed'); }
    finally { button.removeAttribute('aria-busy'); }
  };
  function render() {
    const words = normalize(query.value.trim()).split(/\s+/).filter(Boolean);
    const ids = CATS.flatMap(cat => Object.keys(PRESETS).filter(id => PRESETS[id].cat === cat)).filter(id =>
      (!family.value || PRESETS[id].cat === family.value) && (!onlyFavorites || favs.has(id)) &&
      words.every(w => normalize(t('ins.' + id) + ' ' + id).includes(w)));
    count.textContent = t(ids.length === 1 ? 'sounds.countOne' : 'sounds.count', ids.length, Object.keys(PRESETS).length);
    list.replaceChildren();
    if (!ids.length) { list.append(h('li', { class: 'sound-empty' }, t('sounds.empty'))); return; }
    for (const id of ids) {
      const name = t('ins.' + id), selected = tr.synth?.preset === id;
      const use = h('button', { class: 'sound-use', 'aria-label': t('sounds.use', name), 'aria-pressed': String(selected), data: { act: 'sound-use' }, onclick: () => {
        if (!validTrack()) { status.textContent = t('sounds.noTrack'); return; }
        stop(); if (chooseSound(trackId, id)) dlg.close();
      } }, h('strong', {}, name), h('small', {}, t('cat.' + PRESETS[id].cat)));
      const preview = h('button', { class: 'sound-icon', title: t('sounds.preview', name), 'aria-label': t('sounds.preview', name), data: { act: 'sound-preview' }, onclick: () => audition(id, preview) }, '▶');
      const favorite = h('button', { class: 'sound-icon' + (favs.has(id) ? ' on' : ''), 'aria-pressed': String(favs.has(id)), 'aria-label': t(favs.has(id) ? 'sounds.unfavorite' : 'sounds.favorite', name), data: { act: 'sound-favorite' }, onclick: () => {
        if (favs.has(id)) favs.delete(id); else favs.add(id);
        try { localStorage.setItem(FAVORITES, JSON.stringify([...favs])); } catch { status.textContent = t('sounds.sessionOnly'); }
        const focusId = id; render();
        const row = [...list.querySelectorAll<HTMLElement>('[data-sound]')].find(e => e.dataset.sound === focusId);
        (row?.querySelector<HTMLButtonElement>('[data-act=sound-favorite]') ?? favFilter).focus();
      } }, favs.has(id) ? '★' : '☆');
      list.append(h('li', { class: 'sound-row' + (selected ? ' selected' : ''), data: { sound: id } }, use, preview, favorite));
    }
  }
  query.oninput = () => { stop(); render(); }; family.onchange = () => { stop(); render(); };
  dlg.append(h('header', { class: 'sound-head' }, h('h2', { id: 'sounds-title' }, t('sounds.title')), h('button', { class: 'pill', 'aria-label': t('sounds.close'), data: { act: 'sound-close' }, onclick: () => dlg.close() }, t('sounds.close'))),
    h('div', { class: 'sound-filters' }, query, family, favFilter), count, list,
    h('footer', { class: 'sound-footer' }, status, h('button', { class: 'pill', data: { act: 'sound-stop' }, onclick: stop }, '■ ' + t('sounds.stop'))));
  dlg.addEventListener('close', () => { closed = true; stop(); dlg.remove(); document.querySelector<HTMLButtonElement>('[data-act=sound-browser]')?.focus(); });
  document.body.append(dlg); render(); dlg.showModal(); query.focus();
}
