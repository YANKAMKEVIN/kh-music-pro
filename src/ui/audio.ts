import { engine } from '../audio/engine';
import { t } from '../i18n';
import { S } from '../store';
import { h, slider, toast } from './dom';
import { nativeAvailable, nativeBusy, nativeError, setNativeEngine } from './native';
import { icon } from './icons';

const dlg = () => document.getElementById('audio') as HTMLDialogElement;
const ms = (s: number) => Math.round(s * 1000) + ' ms';

/**
 * Sorties audio connues. La première liste peut mettre plusieurs secondes à venir (version bureau sur Mac) : la fenêtre
 * s'affiche tout de suite avec la dernière liste connue, puis se redessine quand la nouvelle arrive.
 */
let outsCache: MediaDeviceInfo[] = [];
let listing = false;
function refreshOuts() {
  if (listing) return;
  listing = true;
  navigator.mediaDevices.enumerateDevices().then(l => {
    const outs = l.filter(x => x.kind === 'audiooutput' && x.deviceId), sig = (a: MediaDeviceInfo[]) => a.map(o => o.deviceId + o.label).join('|');
    const changed = sig(outs) !== sig(outsCache);
    outsCache = outs;
    if (changed && dlg().open) fillOuts();
  }, () => { /* liste indisponible */ }).finally(() => { listing = false; });
}

/** Remplit la liste des sorties sans redessiner le reste de la fenêtre (une mesure peut être en cours). */
function fillOuts() {
  const sel = dlg().querySelector<HTMLSelectElement>('[data-role=audout]');
  if (!sel) return;
  sel.replaceChildren(h('option', { value: '' }, t('aud.defaultOut')), ...outsCache.filter(o => o.deviceId !== 'default').map((o, i) => h('option', { value: o.deviceId, selected: S.outputDevice === o.deviceId }, o.label || `${t('aud.output')} ${i + 1}`)));
}

function render() {
  const d = dlg(), lat = engine.latency();
  const out = h('select', { 'aria-label': t('aud.output'), data: { role: 'audout' }, disabled: !engine.canSetOutput() });
  out.onchange = async () => { if (await engine.setOutput(out.value)) { S.outputDevice = out.value; toast(t('aud.outSet')); } else toast(t('aud.outFail'), 'error'); render(); };
  const result = h('span', { class: 'lufs', role: 'status', data: { role: 'latresult' } }, '');
  const measure = h('button', { class: 'pill', data: { act: 'latmeasure' }, title: t('aud.measureTip') }, icon('ruler', 15), ' ' + t('aud.measure'));
  measure.onclick = async () => {
    measure.disabled = true; result.textContent = t('aud.measuring');
    const r = await engine.measureLatency().catch(() => null);
    measure.disabled = false;
    if (r === null) { result.textContent = t('aud.noClick'); return; }
    // Ce que la mesure trouve en plus de la compensation automatique devient le décalage d'enregistrement.
    S.recOffsetMs = Math.max(-200, Math.min(200, Math.round((r - lat.output - lat.input) * 1000)));
    try { localStorage.setItem('kh-rec-offset', String(S.recOffsetMs)); } catch { /* stockage désactivé */ }
    result.textContent = t('aud.measured', Math.round(r * 1000), S.recOffsetMs); render();
  };
  // Moteur audio natif : seulement dans la version bureau macOS, quand le module natif est présent.
  let nat: HTMLElement | false = false;
  if (nativeAvailable()) {
    const on = !!engine.native;
    const sw = h('button', { class: 'pill switch' + (on ? ' on' : ''), role: 'switch', 'aria-checked': String(on), 'aria-label': t('nat.title'), data: { act: 'native' }, disabled: nativeBusy },
      nativeBusy ? t('nat.switching') : (on ? '⚡ ' + t('nat.on') : t('nat.off')));
    sw.onclick = async () => {
      sw.disabled = true; sw.textContent = t('nat.switching');
      await setNativeEngine(!engine.native);
      render();
    };
    nat = h('section', { class: 'natsec', data: { role: 'native' } },
      h('h3', {}, '⚡ ' + t('nat.title')),
      h('div', { class: 'fxfoot' }, sw,
        h('span', { class: 'lufs', role: 'status', data: { role: 'natstate' } }, on ? t('nat.active', engine.native!.info.output) : t('nat.inactive'))),
      nativeError && h('p', { class: 'tip err', role: 'alert', data: { role: 'naterr' } }, t('nat.fail', nativeError)),
      h('p', { class: 'tip' }, t('nat.help')));
  }
  const kids: (HTMLElement | false | '')[] = [
    h('h2', {}, icon('wrench', 22), ' ' + t('aud.title')),
    nat,
    h('label', { class: 'fld' }, t('aud.output'), out),
    !engine.canSetOutput() && h('p', { class: 'tip' }, t('aud.outUnsupported')),
    h('h3', {}, t('aud.latency')),
    h('p', { class: 'latrow', data: { role: 'latinfo' } }, t('aud.latInfo', ms(lat.output), lat.input ? ms(lat.input) : '—', Math.round(lat.rate)) + (nativeAvailable() ? ` · ${engine.native ? t('aud.pathNative') : t('aud.pathBrowser')}` : '')),
    h('p', { class: 'tip' }, t('aud.latHelp')),
    slider(t('aud.recOffset'), -200, 200, 1, S.recOffsetMs, v => { S.recOffsetMs = v; try { localStorage.setItem('kh-rec-offset', String(v)); } catch { /* stockage désactivé */ } }, v => (v > 0 ? '+' : '') + v + ' ms', 'wide', true, 0),
    h('div', { class: 'fxfoot' }, measure, result),
    h('form', { method: 'dialog' }, h('button', { class: 'pill accent' }, t('lib.close')))];
  d.replaceChildren(...kids.filter((k): k is HTMLElement => !!k));
  fillOuts();
}

export function showAudio() { render(); refreshOuts(); if (!dlg().open) dlg().showModal(); }
