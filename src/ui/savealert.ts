import { t } from '../i18n';
import { saveHealth } from '../store';
import { h, toast } from './dom';

/** Bandeau qui reste affiché tant que le morceau ne peut pas être enregistré sur l'appareil (espace plein, stockage bloqué),
 *  avec un bouton pour l'enregistrer en fichier. Disparaît dès qu'une sauvegarde réussit de nouveau. */
export function watchSaveHealth(saveToFile: () => void) {
  saveHealth.onChange = (failing, full) => {
    document.getElementById('saveAlert')?.remove();
    if (!failing) { toast(t('save.back')); return; }
    const bar = h('div', { id: 'saveAlert', class: 'save-alert', role: 'alert' },
      h('span', {}, t(full ? 'save.full' : 'save.failed')),
      h('button', { class: 'pill', data: { act: 'savefile' }, onclick: () => saveToFile() }, t('save.toFile')),
      h('button', { class: 'x', 'aria-label': t('save.hide'), title: t('save.hide'), onclick: () => bar.remove() }, '✕'));
    document.body.append(bar);
  };
}
