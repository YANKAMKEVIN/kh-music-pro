import { engine } from '../audio/engine';
import { t } from '../i18n';
import { S } from '../store';
import { h, slider, toast } from './dom';

const dlg = () => document.getElementById('audio') as HTMLDialogElement;
const ms = (s: number) => Math.round(s * 1000) + ' ms';

async function render() {
  const d = dlg(), lat = engine.latency();
  let outs: MediaDeviceInfo[] = [];
  try { outs = (await navigator.mediaDevices.enumerateDevices()).filter(x => x.kind === 'audiooutput' && x.deviceId); } catch { /* liste indisponible */ }
  const out = h('select', { 'aria-label': t('aud.output'), data: { role: 'audout' }, disabled: !engine.canSetOutput() },
    h('option', { value: '' }, t('aud.defaultOut')), ...outs.filter(o => o.deviceId !== 'default').map((o, i) => h('option', { value: o.deviceId, selected: S.outputDevice === o.deviceId }, o.label || `${t('aud.output')} ${i + 1}`)));
  out.onchange = async () => { if (await engine.setOutput(out.value)) { S.outputDevice = out.value; toast(t('aud.outSet')); } else toast(t('aud.outFail'), 'error'); render(); };
  const result = h('span', { class: 'lufs', role: 'status', data: { role: 'latresult' } }, '');
  const measure = h('button', { class: 'pill', data: { act: 'latmeasure' }, title: t('aud.measureTip') }, '📏 ' + t('aud.measure'));
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
  const kids: (HTMLElement | false)[] = [
    h('h2', {}, '🔧 ' + t('aud.title')),
    h('label', { class: 'fld' }, t('aud.output'), out),
    !engine.canSetOutput() && h('p', { class: 'tip' }, t('aud.outUnsupported')),
    h('h3', {}, t('aud.latency')),
    h('p', { class: 'latrow', data: { role: 'latinfo' } }, t('aud.latInfo', ms(lat.output), lat.input ? ms(lat.input) : '—', Math.round(lat.rate))),
    h('p', { class: 'tip' }, t('aud.latHelp')),
    slider(t('aud.recOffset'), -200, 200, 1, S.recOffsetMs, v => { S.recOffsetMs = v; try { localStorage.setItem('kh-rec-offset', String(v)); } catch { /* stockage désactivé */ } }, v => (v > 0 ? '+' : '') + v + ' ms', 'wide', true),
    h('div', { class: 'fxfoot' }, measure, result),
    h('form', { method: 'dialog' }, h('button', { class: 'pill accent' }, t('lib.close')))];
  d.replaceChildren(...kids.filter((k): k is HTMLElement => !!k));
}

export function showAudio() { render(); if (!dlg().open) dlg().showModal(); }
