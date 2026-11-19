import { addTrack, audioFiles, deleteTrack, duplicateTrack, editTempo, freezeTrack, importFiles, moveTrack, pickAudio, removeTempo, selectedClips, unfreezeTrack } from '../actions';
import { engine } from '../audio/engine';
import { t } from '../i18n';
import { S, buffers, commit, emit, findTrack, revert, select } from '../store';
import { AutoParam, BAR, Clip, FX, Pt, Track, TrackType, autoMeta, compSlice, contentEnd, fxAutomatable, fxToNorm, insKey, newPatternClip, parseInsKey, srcStep } from '../types';
import { auToNorm, auName } from '../audio/au';
import { liveWams, wamKey } from '../audio/wam';
import { clamp, followDrag, h } from './dom';

export const ICON: Record<TrackType, string> = { drums: '🥁', synth: '🎹', audio: '🎙️' };

// ---------- Formes d'onde ----------
const BLK = 256, peakCache = new Map<string, Float32Array>();
function peaks(id: string) {
  let p = peakCache.get(id);
  if (p) return p;
  const b = buffers.get(id);
  if (!b) return null;
  const a = b.getChannelData(0), c = b.numberOfChannels > 1 ? b.getChannelData(1) : a;
  p = new Float32Array(Math.ceil(b.length / BLK));
  for (let i = 0; i < b.length; i++) { const v = Math.max(Math.abs(a[i]), Math.abs(c[i])), k = (i / BLK) | 0; if (v > p[k]) p[k] = v; }
  peakCache.set(id, p);
  return p;
}

export function drawWave(g: CanvasRenderingContext2D, id: string, from: number, to: number, w: number, hgt: number) {
  const p = peaks(id), b = buffers.get(id);
  if (!p || !b) return;
  const perSec = b.sampleRate / BLK, mid = hgt / 2;
  for (let x = 0; x < w; x++) {
    const i0 = Math.floor((from + (to - from) * x / w) * perSec), i1 = Math.max(i0 + 1, Math.floor((from + (to - from) * (x + 1) / w) * perSec));
    let m = 0;
    for (let i = i0; i < i1 && i < p.length; i++) if (p[i] > m) m = p[i];
    const y = Math.max(0.5, m * mid * 0.95);
    g.fillRect(x, mid - y, 1, y * 2);
  }
}

function drawPreview(cv: HTMLCanvasElement, tr: Track, c: Clip, wCss: number, hgt: number) {
  const w = Math.min(Math.max(1, Math.round(wCss)), 6000);
  cv.width = w; cv.height = hgt;
  const g = cv.getContext('2d')!;
  g.fillStyle = 'rgba(4,8,20,.72)';
  const sw = w / c.len;
  if (tr.type === 'drums') {
    const rh = hgt / c.drums!.length;
    for (let s = 0; s < c.len; s++) {
      const l = (s + c.offset) % c.patLen!;
      const res = c.res ?? 1, i0 = Math.ceil(l * res - 1e-6), i1 = Math.ceil((l + 1) * res - 1e-6);
      c.drums!.forEach((row, r) => { for (let i = i0; i < i1 && i < row.length; i++) if (row[i]) g.fillRect((s + i / res - l) * sw + 0.5, r * rh, Math.max(1.5, sw / res - 1), Math.max(2, rh - 0.5)); });
    }
  } else if (tr.type === 'synth') {
    const ns = c.notes!;
    if (!ns.length) return;
    let lo = Infinity, hi = -Infinity;
    for (const n of ns) { lo = Math.min(lo, n.p); hi = Math.max(hi, n.p); }
    const span = Math.max(12, hi - lo + 1), nh = Math.max(2, hgt / span - 1);
    for (let k = -1; k * c.patLen! < c.len + c.offset; k++) for (const n of ns) {
      const x = n.s - c.offset + k * c.patLen!;
      if (x + n.l <= 0 || x >= c.len) continue;
      g.fillRect(x * sw, (hi - n.p + (span - (hi - lo + 1)) / 2) * (hgt / span), Math.max(2, n.l * sw - 1), nh);
    }
  } else if (c.bufferId) {
    drawAudio(g, c, w, hgt);
    drawFades(g, c, w, hgt);
  }
}

/** Forme d'onde d'un clip audio ; avec un comping, chaque portion est lue dans sa prise, séparée par un trait. */
export function drawAudio(g: CanvasRenderingContext2D, c: Clip, w: number, hgt: number) {
  const st = srcStep(S.project, c);
  if (!c.comp?.length || !c.takes) { drawWave(g, c.bufferId!, c.offset, c.offset + c.len * st, w, hgt); return; }
  const sw = w / c.len;
  c.comp.forEach((seg, i) => {
    const a = seg.s, b = i + 1 < c.comp!.length ? c.comp![i + 1].s : c.len, x0 = Math.round(a * sw), x1 = Math.round(b * sw), o = (c.takes![seg.take] ?? c.offset) + a * st;
    g.save(); g.translate(x0, 0); drawWave(g, c.bufferId!, o, o + (b - a) * st, Math.max(1, x1 - x0), hgt); g.restore();
    if (i) { g.save(); g.fillStyle = 'rgba(255,255,255,.7)'; g.fillRect(x0, 0, 1, hgt); g.restore(); }
  });
}

/** Dessine les fondus d'un clip audio sous forme de coins clairs. */
export function drawFades(g: CanvasRenderingContext2D, c: Clip, w: number, hgt: number) {
  const sw = w / c.len, tri = (x0: number, x1: number) => { g.beginPath(); g.moveTo(x0, 0); g.lineTo(x1, 0); g.lineTo(x0, hgt); g.closePath(); g.fill(); };
  g.save(); g.fillStyle = 'rgba(255,255,255,.5)';
  if (c.fadeIn) tri(0, c.fadeIn * sw);
  if (c.fadeOut) tri(w, w - c.fadeOut * sw);
  // Fondu enchaîné avec le clip précédent : un X sur la zone où les deux sons se mêlent.
  if (c.xfade) { const x = Math.min(w, c.xfade * sw); g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(0, 0); g.lineTo(x, hgt); g.moveTo(0, hgt); g.lineTo(x, 0); g.stroke(); }
  g.restore();
}

// ---------- Rendu ----------
const TRACK_H = 84;

function addBtn(type: TrackType) {
  return h('button', { class: 'add', data: { add: type }, title: t('track.add', t('type.' + type)), onclick: () => addTrack(type) }, `＋ ${ICON[type]}`, h('span', {}, t('type.' + type)));
}

function head(tr: Track) {
  const name = h('input', { class: 'tname', value: tr.name, title: tr.name, 'aria-label': t('track.name'), spellcheck: false });
  name.onchange = () => { tr.name = name.value.trim() || tr.name; commit(); };
  name.onkeydown = e => { if (e.key === 'Enter') name.blur(); };
  const tog = (key: 'mute' | 'solo', txt: string) => h('button', {
    class: `mini ${key} ${tr[key] ? 'on' : ''}`, title: t('mix.' + key), 'aria-label': t('mix.' + key), 'aria-pressed': String(tr[key]),
    onclick: (e: Event) => { e.stopPropagation(); tr[key] = !tr[key]; commit(); },
  }, txt);
  // Actions rares de la piste (V18) : rangées dans le menu ⋯ pour laisser toute la place au nom.
  const tmenu = h('details', { class: 'menu tmenu' });
  const act = (cls: string, txt: string, label: string, fn: () => void, extra: Record<string, unknown> = {}) => h('button', {
    class: cls, title: label, 'aria-label': `${label} – ${tr.name}`, ...extra, onclick: (e: Event) => { e.stopPropagation(); tmenu.open = false; fn(); },
  }, txt, ' ', label);
  const frz = tr.frozen ? 'frz.unfreeze' : 'frz.freeze';
  tmenu.append(h('summary', { class: 'mini tmore', title: t('track.menu'), 'aria-label': `${t('track.menu')} – ${tr.name}` }, '⋯'), h('div', { class: 'menu-list' },
    act('tup', '▲', t('track.up'), () => moveTrack(tr.id, -1)), act('tdown', '▼', t('track.down'), () => moveTrack(tr.id, 1)),
    act('tdup', '⧉', t('track.dup'), () => duplicateTrack(tr.id)),
    ...(tr.type !== 'audio' ? [act('tfrz' + (tr.frozen ? ' on' : ''), '❄', t(frz), () => { if (tr.frozen) unfreezeTrack(tr.id); else freezeTrack(tr.id); }, { data: { act: 'freeze' }, 'aria-pressed': String(!!tr.frozen) })] : []),
    h('hr', {}), act('del danger', '✕', t('track.delete'), () => deleteTrack(tr.id))));
  const hasAuto = Object.values(tr.auto ?? {}).some(l => l?.length);
  const vol = h('input', { type: 'range', min: '0', max: '1.25', step: '0.01', class: 'tvol', title: t('mix.volume'), 'aria-label': `${t('mix.volume')} – ${tr.name}` });
  vol.value = String(tr.vol);
  vol.oninput = () => { tr.vol = +vol.value; engine.sync(); };
  vol.onchange = () => commit();
  return h('div', {
    class: 'head' + (S.selTrack === tr.id ? ' sel' : '') + (tr.frozen ? ' frozen' : ''), data: { id: tr.id }, style: `--c:${tr.color}`,
    onpointerdown: () => { if (S.selTrack !== tr.id) select(tr.id, ''); },
  },
    h('div', { class: 'hrow' }, h('span', { class: 'ticon', title: t('type.' + tr.type) }, ICON[tr.type]), name,
      tr.frozen ? h('span', { class: 'tfrzbadge', title: t('frz.frozen'), role: 'img', 'aria-label': t('frz.frozen') }, '❄') : '', tmenu),
    h('div', { class: 'hrow' }, tog('mute', 'M'), tog('solo', 'S'),
      h('button', {
        class: 'mini autob' + (tr.autoShow ? ' on' : '') + (hasAuto ? ' has' : ''), title: t('auto.toggle'), 'aria-label': `${t('auto.toggle')} – ${tr.name}`, 'aria-pressed': String(!!tr.autoShow),
        onclick: (e: Event) => { e.stopPropagation(); tr.autoShow = tr.autoShow ? '' : 'vol'; commit(); },
      }, 'A'), vol),
  );
}

// ---------- Automation ----------
const AH = 64, PADY = 8, NS = 'http://www.w3.org/2000/svg';
const autoY = (prm: string, v: number) => { const m = autoMeta(prm).min; return PADY + (1 - (v - m) / (1 - m)) * (AH - 2 * PADY); };
const autoV = (prm: string, y: number) => { const m = autoMeta(prm).min; return Math.round(clamp(m + (1 - (y - PADY) / (AH - 2 * PADY)) * (1 - m), m, 1) * 1000) / 1000; };
const PARAMS: AutoParam[] = ['vol', 'pan', 'filter', 'rev', 'dly', 'chorus'];
/**
 * Réglages automatisables des effets de la piste (V17) : effets intégrés (sauf la taille de la réverb) et plugins du Mac
 * chargés (leur liste de réglages vient du plugin). Chaque entrée : clé, nom de l'effet, nom du réglage, valeur actuelle (0..1).
 */
function insParams(tr: Track): { key: string; fx: string; label: string; cur: number }[] {
  const out: { key: string; fx: string; label: string; cur: number }[] = [];
  tr.inserts?.forEach((ins, n) => {
    if (FX[ins.type]?.length) {
      const fx = `${n + 1}. ${t('fxn.' + ins.type)}`;
      for (const [k] of FX[ins.type]) if (fxAutomatable(ins.type, k)) out.push({ key: insKey(ins.id, k), fx, label: t('fxp.' + k), cur: fxToNorm(ins.type, k, ins.p[k]) });
    } else if (ins.type === 'au') {
      const inst = liveWams.get(wamKey(tr.id, ins.id)) as { params?: import('../audio/au').AuParam[] } | undefined, fx = `${n + 1}. 🍎 ${auName(ins.name || '')}`;
      for (const p of inst?.params ?? []) out.push({ key: insKey(ins.id, String(p.address)), fx, label: p.name, cur: auToNorm(p, ins.p[String(p.address)] ?? p.value) });
    }
  });
  return out;
}

function ahead(tr: Track) {
  const prm = tr.autoShow ?? 'vol', extra = insParams(tr), groups = new Map<string, typeof extra>();
  for (const e of extra) groups.set(e.fx, [...(groups.get(e.fx) ?? []), e]);
  const dot = (k: string) => (tr.auto?.[k]?.length ? ' •' : '');
  // Un réglage d'effet dont l'effet a disparu (ou un plugin du Mac pas encore chargé) reste affiché tel quel.
  const orphan = parseInsKey(prm) && !extra.some(e => e.key === prm);
  const sel = h('select', { 'aria-label': `${t('auto.param')} – ${tr.name}`, title: t('auto.param'), data: { role: 'autoparam' } },
    h('optgroup', { label: t('auto.track') }, ...PARAMS.map(k => h('option', { value: k, selected: prm === k }, t('auto.' + k) + dot(k)))),
    ...[...groups].map(([fx, l]) => h('optgroup', { label: fx }, ...l.map(e => h('option', { value: e.key, selected: prm === e.key }, e.label + dot(e.key))))),
    ...(orphan ? [h('option', { value: prm, selected: true }, t('auto.unavailable'))] : []));
  sel.onchange = () => { tr.autoShow = sel.value; commit(); };
  return h('div', { class: 'ahead', style: `--c:${tr.color}` }, h('span', { class: 'albl' }, t('auto.title')), sel,
    h('button', { class: 'mini', title: t('auto.clear'), 'aria-label': `${t('auto.clear')} – ${tr.name}`, data: { act: 'autoclear' }, disabled: !tr.auto?.[prm]?.length, onclick: () => { delete tr.auto![prm]; commit(); } }, '⌫'));
}

function alane(tr: Track, total: number) {
  const prm = tr.autoShow || 'vol', px = S.px, W = total * px;
  // Valeur de départ d'une courbe vide : le réglage actuel (effet), ou la valeur par défaut (piste).
  const def = insParams(tr).find(e => e.key === prm)?.cur ?? autoMeta(prm).def;
  const el = h('div', { class: 'alane', data: { auto: tr.id }, style: `--c:${tr.color}` });
  const svg = document.createElementNS(NS, 'svg'), line = document.createElementNS(NS, 'polyline');
  svg.setAttribute('width', String(W)); svg.setAttribute('height', String(AH)); svg.append(line); el.append(svg);
  const hint = h('div', { class: 'hint ahint' }, t('auto.hint'));
  const draw = () => {
    const l = tr.auto?.[prm] ?? [], y0 = autoY(prm, l.length ? l[0].v : def);
    const xy = [[0, y0], ...l.map(p => [p.s * px, autoY(prm, p.v)]), [W, l.length ? autoY(prm, l[l.length - 1].v) : y0]];
    line.setAttribute('points', xy.map(a => a.join(',')).join(' '));
    el.classList.toggle('none', !l.length);
    el.querySelectorAll('.apt').forEach(e => e.remove());
    l.forEach((p, i) => el.append(h('div', { class: 'apt', data: { i: String(i) }, style: `left:${p.s * px}px;top:${autoY(prm, p.v)}px`, title: String(Math.round(p.v * 100)) })));
    hint.style.display = l.length ? 'none' : '';
  };
  el.append(hint); draw();
  const remove = (pt: Pt) => { const l = tr.auto![prm]!; l.splice(l.indexOf(pt), 1); if (!l.length) delete tr.auto![prm]; commit(); };
  el.oncontextmenu = e => e.preventDefault();
  el.ondblclick = e => { const hit = (e.target as HTMLElement).closest<HTMLElement>('.apt'); if (hit) remove(tr.auto![prm]![+hit.dataset.i!]); };
  el.onpointerdown = e => {
    if (e.button !== 0 && e.button !== 2) return;
    e.preventDefault();
    const r = el.getBoundingClientRect(), hit = (e.target as HTMLElement).closest<HTMLElement>('.apt');
    tr.auto ??= {};
    const list = tr.auto[prm] ??= [];
    let pt: Pt, changed = false;
    if (hit) { pt = list[+hit.dataset.i!]; if (e.button === 2) return remove(pt); }
    else {
      if (e.button !== 0) return;
      pt = { s: Math.max(0, Math.round((e.clientX - r.left) / px)), v: autoV(prm, e.clientY - r.top) };
      const same = list.findIndex(x => x.s === pt.s);
      if (same >= 0) list.splice(same, 1);
      list.push(pt); list.sort((a, b) => a.s - b.s); changed = true; draw();
    }
    const mv = (ev: PointerEvent) => {
      const i = list.indexOf(pt), lo = i > 0 ? list[i - 1].s + 1 : 0, hi = i < list.length - 1 ? list[i + 1].s - 1 : 1e6;
      const s = clamp(Math.round((ev.clientX - r.left) / px), lo, hi), v = autoV(prm, ev.clientY - r.top);
      if (s !== pt.s || v !== pt.v) { pt.s = s; pt.v = v; changed = true; draw(); }
    };
    followDrag(e, mv, () => { if (changed) commit(); }, revert);
  };
  return el;
}

function clipEl(tr: Track, c: Clip) {
  const px = S.px, w = c.len * px;
  const cv = h('canvas', {});
  const el = h('div', {
    class: 'clip' + (S.selClip === c.id ? ' sel' : S.selMore.has(c.id) ? ' sel sel2' : ''), data: { id: c.id }, tabIndex: 0,
    style: `left:${c.start * px}px;width:${w}px;--c:${tr.color}`, title: c.name,
  }, h('div', { class: 'cname' }, c.name), cv, h('div', { class: 'grip gripl' }), h('div', { class: 'grip' }));
  drawPreview(cv, tr, c, w, TRACK_H - 34);
  return el;
}

function lane(tr: Track) {
  const el = h('div', { class: 'lane' + (S.selTrack === tr.id ? ' sel' : ''), data: { id: tr.id } });
  for (const c of tr.clips) el.append(clipEl(tr, c));
  if (!tr.clips.length) el.append(h('div', { class: 'hint' }, t(tr.type === 'audio' ? 'hint.audioLane' : 'hint.patternLane')));
  el.onpointerdown = e => laneDown(e, tr);
  el.ondblclick = e => {
    if ((e.target as HTMLElement).closest('.clip')) { S.tab = 'editor'; emit(); return; }
    const start = Math.floor((e.clientX - el.getBoundingClientRect().left) / S.px / BAR) * BAR;
    if (tr.type === 'audio') return pickAudio(tr.id, start);
    const c = newPatternClip(tr.type, start, t(tr.type === 'drums' ? 'clip.pattern' : 'clip.notes'));
    tr.clips.push(c); S.selTrack = tr.id; S.selClip = c.id; S.tab = 'editor'; commit();
  };
  return el;
}

function laneDown(e: PointerEvent, tr: Track) {
  if (e.button !== 0) return;
  const el = (e.target as HTMLElement).closest<HTMLElement>('.clip');
  if (!el) { select(tr.id, ''); return; }
  const clip = tr.clips.find(c => c.id === el.dataset.id)!;
  if (e.shiftKey) {
    // Maj+clic : ajoute le clip à la sélection, ou l'en retire.
    e.preventDefault();
    if (S.selMore.has(clip.id)) S.selMore.delete(clip.id);
    else if (clip.id !== S.selClip) { if (S.selClip) S.selMore.add(clip.id); else { S.selTrack = tr.id; S.selClip = clip.id; } }
    refreshSelection(); return;
  }
  const grouped = S.selMore.size > 0 && (S.selMore.has(clip.id) || S.selClip === clip.id);
  if (!grouped) select(tr.id, clip.id);
  e.preventDefault();
  const px = S.px, sx = e.clientX, o = { start: clip.start, len: clip.len, offset: clip.offset, takes: clip.takes, comp: clip.comp }, r = el.getBoundingClientRect(), dur = srcStep(S.project, clip);
  const resize = e.clientX > r.right - 10, trim = !resize && e.clientX < r.left + 8 && r.width > 30;
  const buf = clip.bufferId ? buffers.get(clip.bufferId) : undefined;
  const maxLen = buf ? Math.ceil((buf.duration - clip.offset) / dur) : Infinity;
  // Déplacement de groupe : les autres clips sélectionnés suivent, chacun sur sa piste.
  const others = grouped && !resize && !trim ? selectedClips().filter(x => x.clip !== clip).map(x => ({ c: x.clip, s: x.clip.start, el: document.querySelector<HTMLElement>(`.clip[data-id="${x.clip.id}"]`) })) : [];
  const minStart = Math.min(o.start, ...others.map(x => x.s));
  let changed = false, target = tr;
  const mv = (ev: PointerEvent) => {
    let d = Math.round((ev.clientX - sx) / px / S.snap) * S.snap;
    if (resize) { clip.len = clamp(o.len + d, Math.min(S.snap, o.len), maxLen); if (o.comp) { clip.comp = o.comp.map(x => ({ ...x })); compSlice(clip, 0, clip.len); } }
    else if (trim) {
      // Bord gauche : le début avance ou recule, le contenu reste en place sur la timeline.
      d = clamp(d, Math.max(-o.start, buf ? -Math.floor(o.offset / dur) : -o.start), o.len - Math.min(S.snap, o.len));
      clip.start = o.start + d; clip.len = o.len - d;
      if (buf && o.takes) clip.takes = o.takes.map(x => x + d * dur);
      clip.offset = buf ? Math.max(0, o.offset + d * dur) : ((o.offset + d) % clip.patLen! + clip.patLen!) % clip.patLen!;
      // Comping : les portions restent à leur place sur la timeline (elles sont comptées depuis le début du clip).
      if (o.comp) { clip.comp = o.comp.map(x => ({ ...x })); compSlice(clip, d, o.len); }
    } else {
      d = Math.max(-minStart, d); clip.start = o.start + d;
      for (const x of others) { x.c.start = x.s + d; if (x.el) x.el.style.left = x.c.start * px + 'px'; }
    }
    el.style.left = clip.start * px + 'px'; el.style.width = clip.len * px + 'px';
    if (d !== 0) changed = true;
    if (resize || trim || others.length) return;
    const over = [...document.querySelectorAll<HTMLElement>('.lane')].find(l => { const q = l.getBoundingClientRect(); return ev.clientY >= q.top && ev.clientY < q.bottom; });
    const tt = over && findTrack(over.dataset.id!);
    if (over && tt && tt.type === tr.type && tt !== target) { target = tt; over.append(el); changed = true; }
  };
  const up = () => {
    if (target !== tr) { tr.clips.splice(tr.clips.indexOf(clip), 1); target.clips.push(clip); S.selTrack = target.id; }
    if (changed) commit();
  };
  // Geste annulé : le clip (et ceux qui le suivaient) reviennent à leur place, sur leur piste.
  followDrag(e, mv, up, () => { revert(); if (target !== tr) emit(); });
}

export function renderArr() {
  const root = document.getElementById('arr')!, p = S.project, px = S.px;
  const total = Math.max(contentEnd(p) + BAR * 8, BAR * 48);
  const heads = h('div', { class: 'heads' });
  const lanes = h('div', { class: 'lanes', style: `width:${total * px}px;--bar:${BAR * px}px;--beat:${4 * px}px` });

  heads.append(h('div', { class: 'corner' }, addBtn('drums'), addBtn('synth'), addBtn('audio')));

  const ruler = h('div', { class: 'ruler', title: t('hint.ruler') });
  const every = BAR * px >= 44 ? 1 : BAR * px >= 22 ? 2 : 4;
  for (let b = 0; b < total / BAR; b += every) ruler.append(h('span', { style: `left:${b * BAR * px}px` }, String(b + 1)));
  if (p.loop) ruler.append(h('div', { class: 'loopr', style: `left:${p.loopStart * BAR * px}px;width:${p.loopLen * BAR * px}px` }));
  for (const m of p.tempos) ruler.append(h('button', {
    class: 'mark tmark', style: `left:${m.s * px}px`, title: t('tempo.tip'), data: { tempo: String(m.s) },
    onpointerdown: (e: Event) => e.stopPropagation(), onclick: () => editTempo(m.s),
    oncontextmenu: (e: Event) => { e.preventDefault(); removeTempo(m.s); },
  }, `♩ ${m.bpm}`));
  for (const m of p.markers) ruler.append(h('button', {
    class: 'mark', style: `left:${m.s * px}px`, title: t('mark.tip'), data: { mark: String(m.s) },
    onpointerdown: (e: Event) => e.stopPropagation(), onclick: () => engine.seek(m.s),
    ondblclick: () => { const n = prompt(t('mark.rename'), m.name); if (n?.trim()) { m.name = n.trim().slice(0, 24); commit(); } },
    oncontextmenu: (e: Event) => { e.preventDefault(); p.markers.splice(p.markers.indexOf(m), 1); commit(); },
  }, '⚑ ' + m.name));
  ruler.onpointerdown = e => {
    const left = ruler.getBoundingClientRect().left, bar = (x: number) => Math.max(0, Math.floor((x - left) / px / BAR));
    if (!e.shiftKey) return engine.seek(Math.max(0, Math.round((e.clientX - left) / px / S.snap) * S.snap));
    // Maj+glisser dans la règle : trace la zone de boucle.
    e.preventDefault();
    const b0 = bar(e.clientX), zone = ruler.querySelector<HTMLElement>('.loopr') ?? ruler.appendChild(h('div', { class: 'loopr' }));
    const set = (x: number) => { const b1 = bar(x); p.loop = true; p.loopStart = Math.min(b0, b1); p.loopLen = Math.abs(b1 - b0) + 1; zone.style.cssText = `left:${p.loopStart * BAR * px}px;width:${p.loopLen * BAR * px}px`; };
    set(e.clientX);
    followDrag(e, ev => set(ev.clientX), () => commit(), revert);
  };
  lanes.append(ruler);

  for (const tr of p.tracks) {
    heads.append(head(tr)); lanes.append(lane(tr));
    if (tr.autoShow) { heads.append(ahead(tr)); lanes.append(alane(tr, total)); }
  }
  if (!p.tracks.length) lanes.append(h('div', { class: 'empty' }, t('hint.noTracks')));
  lanes.append(h('div', { id: 'ph' }));

  root.replaceChildren(h('div', { class: 'arr-inner' }, heads, lanes));
}

/** Met à jour les surbrillances de sélection sans reconstruire le DOM. */
export function refreshSelection() {
  document.querySelectorAll<HTMLElement>('#arr .head, #arr .lane').forEach(e => e.classList.toggle('sel', e.dataset.id === S.selTrack));
  document.querySelectorAll<HTMLElement>('#arr .clip').forEach(e => { const more = S.selMore.has(e.dataset.id!); e.classList.toggle('sel', more || e.dataset.id === S.selClip); e.classList.toggle('sel2', more); });
}

// ---------- Zoom à la molette et au pincement ----------
/**
 * Zoom autour d'un point : le pas qui se trouve à `x` px du bord gauche de la zone visible y reste après le zoom.
 * Renvoie la nouvelle largeur d'un pas et le défilement qui garde ce pas sous le pointeur.
 */
export function zoomAt(px: number, factor: number, x: number, scroll: number, min = 3, max = 44): { px: number; scroll: number } {
  const n = clamp(px * factor, min, max);
  return { px: n, scroll: Math.max(0, (scroll + x) / px * n - x) };
}
/** Facteur de zoom d'un cran de molette (ou d'un pincement au trackpad, que le navigateur envoie comme Ctrl+molette). */
export const wheelFactor = (e: WheelEvent) => Math.exp(-clamp(e.deltaY * (e.deltaMode === 1 ? 16 : 1), -240, 240) * 0.0022);

/**
 * Arrangement : Ctrl ou Cmd + molette (ou pincement au trackpad) zoome en gardant sous le pointeur la mesure visée ;
 * Maj + molette fait défiler dans le temps ; deux doigts qui s'écartent ou se rapprochent zooment sur un écran tactile.
 */
export function initArrZoom() {
  const root = document.getElementById('arr')!;
  const headW = () => root.querySelector<HTMLElement>('.heads')?.offsetWidth ?? 0;
  /** Applique le zoom une fois par image : plusieurs crans de molette ne redessinent l'arrangement qu'une fois. */
  let want: { px: number; scroll: number } | null = null, raf = 0;
  const apply = (z: { px: number; scroll: number }) => {
    want = z;
    raf ||= requestAnimationFrame(() => { raf = 0; if (!want) return; const w = want; want = null; if (w.px !== S.px) { S.px = w.px; emit(); } root.scrollLeft = w.scroll; });
  };
  const xOf = (clientX: number) => Math.max(0, clientX - root.getBoundingClientRect().left - headW());
  root.addEventListener('wheel', e => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      apply(zoomAt(want?.px ?? S.px, wheelFactor(e), xOf(e.clientX), want?.scroll ?? root.scrollLeft));
    } else if (e.shiftKey && !e.deltaX && e.deltaY) { e.preventDefault(); root.scrollLeft += e.deltaY * (e.deltaMode === 1 ? 16 : 1); }
  }, { passive: false });

  // Pincement à deux doigts. Le doigt posé en premier a pu commencer à déplacer un clip : ce glissé est annulé.
  let lastTouch = -1, pinch: { d: number; px: number; step: number } | null = null;
  root.addEventListener('pointerdown', e => { if (e.pointerType === 'touch') lastTouch = e.pointerId; }, true);
  const span = (t: TouchList) => ({ d: Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY), x: xOf((t[0].clientX + t[1].clientX) / 2) });
  const move = (e: TouchEvent) => {
    if (!pinch || e.touches.length !== 2) return;
    if (e.cancelable) e.preventDefault();
    const { d, x } = span(e.touches), px = clamp(pinch.px * d / pinch.d, 3, 44);
    apply({ px, scroll: Math.max(0, pinch.step * px - x) });
  };
  root.addEventListener('touchstart', e => {
    if (e.touches.length !== 2) { pinch = null; return; }
    const { d, x } = span(e.touches);
    if (d < 10) return;
    pinch = { d, px: S.px, step: (root.scrollLeft + x) / S.px };
    if (lastTouch >= 0) dispatchEvent(new PointerEvent('pointercancel', { pointerId: lastTouch, pointerType: 'touch' }));
    // Le zoom redessine les pistes : l'élément touché quitte la page, mais c'est lui qui continue de recevoir les mouvements
    // des doigts. On l'écoute donc directement, jusqu'à ce qu'un doigt se lève.
    const targets = [...new Set([...e.touches].map(t => t.target))];
    const end = (ev: Event) => {
      if ((ev as TouchEvent).touches.length >= 2) return;
      pinch = null;
      for (const el of targets) { el.removeEventListener('touchmove', move as EventListener); el.removeEventListener('touchend', end); el.removeEventListener('touchcancel', end); }
    };
    for (const el of targets) { el.addEventListener('touchmove', move as EventListener, { passive: false }); el.addEventListener('touchend', end); el.addEventListener('touchcancel', end); }
  }, { passive: true });
}

export function initArrDrop() {
  const root = document.getElementById('arr')!;
  root.ondragover = e => { e.preventDefault(); root.classList.add('drop'); };
  root.ondragleave = () => root.classList.remove('drop');
  root.ondrop = e => {
    e.preventDefault(); root.classList.remove('drop');
    const files = audioFiles(e.dataTransfer?.files);
    if (!files.length) return;
    const laneEl = (e.target as HTMLElement).closest<HTMLElement>('.lane');
    const start = laneEl ? Math.max(0, Math.round((e.clientX - laneEl.getBoundingClientRect().left) / S.px / S.snap) * S.snap) : undefined;
    importFiles(files, laneEl?.dataset.id, start);
  };
}
