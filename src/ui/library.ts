import { engine } from '../audio/engine';
import { t } from '../i18n';
import { allNotesOff } from '../input';
import { S, emit, deleteProject, duplicateProject, library, listVersions, openProject, restoreVersion, snapshot, startProject } from '../store';
import { TEMPLATES, Template, templateProject } from '../types';
import { h, toast } from './dom';

const ICONS: Record<Template, string> = { empty: '📄', trap: '🔥', house: '🪩', lofi: '☕', demo: '✨' };
const dlg = () => document.getElementById('lib') as HTMLDialogElement;
const halt = () => { engine.stop(); engine.stop(); allNotesOff(); };

export function createFromTemplate(tpl: Template) {
  halt(); startProject(templateProject(tpl));
  S.selTrack = S.project.tracks[0].id; S.selClip = S.project.tracks[0].clips[0]?.id ?? '';
  emit(); engine.prepare();
}

function render() {
  const d = dlg(), fmt = new Intl.DateTimeFormat(document.documentElement.lang, { dateStyle: 'medium', timeStyle: 'short' });
  const tpl = h('div', { class: 'tpls' }, ...TEMPLATES.map(k => h('button', { class: 'tpl', data: { tpl: k }, onclick: () => { createFromTemplate(k); d.close(); toast(t('lib.created')); } },
    h('span', { class: 'tico' }, ICONS[k]), h('strong', {}, t('tpl.' + k)), h('small', {}, t('tpl.' + k + '.d')))));
  const rows = [...library].sort((a, b) => b.updated - a.updated).map(e => {
    const cur = e.id === S.pid;
    return h('li', { class: cur ? 'cur' : '', data: { pid: e.id } },
      h('button', { class: 'lopen', data: { act: 'libopen' }, title: t('lib.open'), onclick: async () => { halt(); await openProject(e.id); engine.prepare(); d.close(); toast(t('toast.opened')); } },
        h('strong', {}, e.name), h('small', {}, (cur ? t('lib.current') + ' · ' : '') + fmt.format(e.updated))),
      cur ? h('button', { class: 'mini', data: { act: 'libvers' }, title: t('ver.title'), 'aria-label': `${t('ver.title')} – ${e.name}`, onclick: () => renderVersions() }, '🕘') : '',
      h('button', { class: 'mini', data: { act: 'libdup' }, title: t('lib.dup'), 'aria-label': `${t('lib.dup')} – ${e.name}`, onclick: async () => { await duplicateProject(e.id); render(); } }, '⧉'),
      h('button', { class: 'mini danger', data: { act: 'libdel' }, title: t('lib.del'), 'aria-label': `${t('lib.del')} – ${e.name}`, disabled: cur, onclick: async () => { if (confirm(t('lib.confirmDel', e.name))) { await deleteProject(e.id); render(); } } }, '🗑'));
  });
  d.replaceChildren(
    h('h2', {}, t('lib.title')),
    h('h3', {}, t('lib.new')), tpl,
    h('h3', {}, t('lib.mine')), rows.length ? h('ul', { class: 'plist' }, ...rows) : h('p', { class: 'tip' }, t('lib.none')),
    h('p', { class: 'tip' }, t('lib.note')),
    h('form', { method: 'dialog' }, h('button', { class: 'pill' }, t('lib.close'))));
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
