import { engine } from '../audio/engine';
import { t } from '../i18n';
import { allNotesOff } from '../input';
import { ProjInfo, S, emit, deleteProject, duplicateProject, library, libraryInfo, listVersions, openProject, renameLibProject, replaceProject, restoreVersion, snapshot, startProject } from '../store';
import { TEMPLATES, Template, templateProject } from '../types';
import { ask, confirmBox, h, toast } from './dom';
import { startTour } from './tour';
import { icon } from './icons';

const ICONS: Record<Template, string> = { empty: '📄', trap: '🔥', house: '🪩', lofi: '☕', demo: '✨' };
const dlg = () => document.getElementById('lib') as HTMLDialogElement;
const halt = () => { engine.stop(); engine.stop(); allNotesOff(); };

/** Ouvre un modèle. `replace` : à la place du projet ouvert (premier lancement), au lieu d'un nouveau projet dans la bibliothèque. */
export function createFromTemplate(tpl: Template, replace = false) {
  halt(); (replace ? replaceProject : startProject)(templateProject(tpl));
  S.selTrack = S.project.tracks[0].id; S.selClip = S.project.tracks[0].clips[0]?.id ?? '';
  emit(); engine.prepare();
}

/** Les modèles en cartes (Vide, Trap, House, Lo-fi, Démo) : dans la fenêtre des projets et à l'accueil. */
function tplCards(pick: (k: Template) => void) {
  return h('div', { class: 'tpls' }, ...TEMPLATES.map(k => h('button', { class: 'tpl', data: { tpl: k }, onclick: () => pick(k) },
    h('span', { class: 'tico' }, ICONS[k]), h('strong', {}, t('tpl.' + k)), h('small', {}, t('tpl.' + k + '.d')))));
}

/**
 * Accueil du premier lancement : au lieu de la notice complète, une question (« Par quoi commencer ? »), les modèles en cartes,
 * la visite guidée et un bouton pour commencer. L'aide complète reste derrière le bouton « ? ».
 */
export function showWelcome() {
  document.getElementById('welcome')?.remove();
  const d = h('dialog', { id: 'welcome', class: 'welcome', 'aria-labelledby': 'welT' });
  const end = () => { if (d.open) d.close(); d.remove(); };
  const go = h('button', { class: 'pill accent', id: 'bWelGo', onclick: end }, t('wel.go'));
  d.append(
    h('h2', { id: 'welT' }, h('span', { class: 'logo' }, 'KH'), t('help.title')),
    h('p', { class: 'welq' }, t('wel.q')),
    tplCards(k => { createFromTemplate(k, true); end(); }),
    h('p', { class: 'tip' }, t('wel.tip')),
    h('div', { class: 'vrow' }, h('button', { class: 'pill', id: 'bWelTour', onclick: () => { end(); setTimeout(startTour, 50); } }, '🧭 ' + t('tour.start')), go));
  d.addEventListener('cancel', end); d.addEventListener('close', end);
  document.body.append(d); d.showModal(); go.focus();
}

function render() {
  const d = dlg(), fmt = new Intl.DateTimeFormat(document.documentElement.lang, { dateStyle: 'medium', timeStyle: 'short' });
  const tpl = tplCards(k => { createFromTemplate(k); d.close(); toast(t('lib.created')); });
  const rows = [...library].sort((a, b) => b.updated - a.updated).map(e => {
    const cur = e.id === S.pid, date = (cur ? t('lib.current') + ' · ' : '') + fmt.format(e.updated);
    const thumb = h('canvas', { class: 'pthumb', width: 192, height: 80, 'aria-hidden': 'true' }), meta = h('small', {}, date);
    // Tempo, pistes, durée et miniature arrivent dès que le projet a été relu dans l'appareil.
    libraryInfo(e.id).then(info => { if (!info) return; drawThumb(thumb, info); meta.textContent = `${t('lib.meta', info.bpm, info.tracks, clock(info.sec))} · ${date}`; });
    return h('li', { class: cur ? 'cur' : '', data: { pid: e.id, name: e.name.toLowerCase() } },
      h('button', { class: 'lopen', data: { act: 'libopen' }, title: t('lib.open'), onclick: async () => { halt(); await openProject(e.id); engine.prepare(); d.close(); toast(t('toast.opened')); } },
        thumb, h('span', { class: 'pinfo' }, h('strong', {}, e.name), meta)),
      cur ? h('button', { class: 'mini', data: { act: 'libvers' }, title: t('ver.title'), 'aria-label': `${t('ver.title')} – ${e.name}`, onclick: () => renderVersions() }, icon('clock', 15)) : '',
      h('button', { class: 'mini', data: { act: 'librename' }, title: t('lib.rename'), 'aria-label': `${t('lib.rename')} – ${e.name}`, onclick: async () => { const n = await ask(t('lib.rename'), e.name); if (n?.trim()) { await renameLibProject(e.id, n); render(); } } }, '✎'),
      h('button', { class: 'mini', data: { act: 'libdup' }, title: t('lib.dup'), 'aria-label': `${t('lib.dup')} – ${e.name}`, onclick: async () => { await duplicateProject(e.id); render(); } }, '⧉'),
      h('button', { class: 'mini danger', data: { act: 'libdel' }, title: t('lib.del'), 'aria-label': `${t('lib.del')} – ${e.name}`, disabled: cur, onclick: async () => { if (await confirmBox(t('lib.confirmDel', e.name), t('act.del'), { danger: true })) { await deleteProject(e.id); render(); } } }, icon('trash', 15)));
  });
  // Au-delà de huit projets, un champ pour retrouver un morceau par son nom.
  const none = h('p', { class: 'tip', hidden: true, role: 'status' }, t('lib.noMatch'));
  const search = rows.length > SEARCH_FROM && h('input', { type: 'search', class: 'psearch', placeholder: t('lib.search'), 'aria-label': t('lib.search'), data: { role: 'libsearch' }, spellcheck: false });
  if (search) search.oninput = () => { none.hidden = filterRows(rows, search.value) > 0; };
  d.replaceChildren(
    h('h2', {}, t('lib.title')),
    h('h3', {}, t('lib.new')), tpl,
    h('h3', {}, t('lib.mine')), search || '', rows.length ? h('ul', { class: 'plist' }, ...rows) : h('p', { class: 'tip' }, t('lib.none')), none,
    h('p', { class: 'tip' }, t('lib.note')),
    h('form', { method: 'dialog' }, h('button', { class: 'pill' }, t('lib.close'))));
}

/** Nombre de projets à partir duquel le champ de recherche apparaît (plus de huit). */
const SEARCH_FROM = 8;
/** Ne garde affichés que les projets dont le nom contient le texte cherché (sans tenir compte des majuscules ni des accents). Renvoie leur nombre. */
export function filterRows(rows: HTMLElement[], q: string): number {
  const norm = (x: string) => x.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim(), want = norm(q);
  let n = 0;
  for (const li of rows) { const ok = !want || norm(li.dataset.name ?? '').includes(want); li.hidden = !ok; if (ok) n++; }
  return n;
}
/** Durée lisible : 1:04. */
export const clock = (sec: number) => { const s = Math.round(sec); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
/** Miniature de l'arrangement : une ligne par piste, un bloc par clip, à la couleur de la piste. */
function drawThumb(cv: HTMLCanvasElement, info: ProjInfo) {
  const g = cv.getContext('2d')!, W = cv.width, H = cv.height, n = Math.max(4, info.rows.length), rh = H / n, end = Math.max(1, info.end);
  g.clearRect(0, 0, W, H);
  info.rows.forEach((r, i) => {
    g.fillStyle = r.color;
    for (const [s, l] of r.clips) g.fillRect(Math.round(s / end * W), Math.round(i * rh) + 1, Math.max(2, Math.round(l / end * W) - 1), Math.max(2, Math.floor(rh) - 2));
  });
}

export function showLibrary() { render(); if (!dlg().open) dlg().showModal(); }

/** Versions du projet ouvert : instantanés automatiques, du plus récent au plus ancien, chacun restaurable. */
async function renderVersions() {
  const d = dlg(), fmt = new Intl.DateTimeFormat(document.documentElement.lang, { dateStyle: 'medium', timeStyle: 'medium' });
  const list = (await listVersions()).slice().reverse();
  const rows = list.map(v => h('li', { data: { ver: String(v.t) } },
    h('div', { class: 'lopen' }, h('strong', {}, fmt.format(v.t)), h('small', {}, `${v.name} · ${t('ver.tracks', v.tracks)} · ${t('ver.why.' + v.why)}`)),
    h('button', { class: 'pill', data: { act: 'verrestore' }, 'aria-label': `${t('ver.restore')} – ${fmt.format(v.t)}`, onclick: async () => {
      halt(); await restoreVersion(v.t); engine.prepare(); d.close(); toast(t('ver.restored', fmt.format(v.t)));
    } }, t('ver.restore'))));
  d.replaceChildren(
    h('h2', {}, t('ver.title') + ' – ' + S.project.name),
    h('p', { class: 'tip' }, t('ver.note')),
    h('button', { class: 'pill', data: { act: 'versnap' }, onclick: async () => { await snapshot('manual'); toast(t('ver.saved')); renderVersions(); } }, '＋ ' + t('ver.snap')),
    rows.length ? h('ul', { class: 'plist' }, ...rows) : h('p', { class: 'tip' }, t('ver.none')),
    h('div', { class: 'vrow' }, h('button', { class: 'pill', data: { act: 'verback' }, onclick: () => render() }, '← ' + t('lib.title')),
      h('form', { method: 'dialog' }, h('button', { class: 'pill' }, t('lib.close')))));
  if (!d.open) d.showModal();
  (d.querySelector('[data-act=verrestore], [data-act=versnap]') as HTMLElement | null)?.focus();
}
export function showVersions() { renderVersions(); }
