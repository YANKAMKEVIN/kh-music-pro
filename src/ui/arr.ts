import { addTrack, audioFiles, deleteTrack, duplicateTrack, importFiles, moveTrack, pickAudio, selectedClips } from '../actions';
import { engine } from '../audio/engine';
import { t } from '../i18n';
import { S, buffers, commit, emit, findTrack, select } from '../store';
import { AUTO, AutoParam, BAR, Clip, Pt, Track, TrackType, contentEnd, newPatternClip, stepDur } from '../types';
import { clamp, h } from './dom';

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
    drawWave(g, c.bufferId, c.offset, c.offset + c.len * stepDur(S.project.bpm), w, hgt);
    drawFades(g, c, w, hgt);
  }
}

/** Dessine les fondus d'un clip audio sous forme de coins clairs. */
export function drawFades(g: CanvasRenderingContext2D, c: Clip, w: number, hgt: number) {
  const sw = w / c.len, tri = (x0: number, x1: number) => { g.beginPath(); g.moveTo(x0, 0); g.lineTo(x1, 0); g.lineTo(x0, hgt); g.closePath(); g.fill(); };
  g.save(); g.fillStyle = 'rgba(255,255,255,.5)';
  if (c.fadeIn) tri(0, c.fadeIn * sw);
  if (c.fadeOut) tri(w, w - c.fadeOut * sw);
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
  const sm = (cls: string, txt: string, key: string, fn: () => void) => h('button', {
    class: 'mini sm ' + cls, title: t(key), 'aria-label': `${t(key)} – ${tr.name}`, onclick: (e: Event) => { e.stopPropagation(); fn(); },
  }, txt);
  const hasAuto = Object.values(tr.auto ?? {}).some(l => l?.length);
  const vol = h('input', { type: 'range', min: '0', max: '1.25', step: '0.01', class: 'tvol', title: t('mix.volume'), 'aria-label': `${t('mix.volume')} – ${tr.name}` });
  vol.value = String(tr.vol);
  vol.oninput = () => { tr.vol = +vol.value; engine.sync(); };
  vol.onchange = () => commit();
  return h('div', {
    class: 'head' + (S.selTrack === tr.id ? ' sel' : ''), data: { id: tr.id }, style: `--c:${tr.color}`,
    onpointerdown: () => { if (S.selTrack !== tr.id) select(tr.id, ''); },
  },
    h('div', { class: 'hrow' }, h('span', { class: 'ticon', title: t('type.' + tr.type) }, ICON[tr.type]), name,
      sm('tup', '▲', 'track.up', () => moveTrack(tr.id, -1)), sm('tdown', '▼', 'track.down', () => moveTrack(tr.id, 1)), sm('tdup', '⧉', 'track.dup', () => duplicateTrack(tr.id)),
      h('button', { class: 'mini del', title: t('track.delete'), 'aria-label': `${t('track.delete')} – ${tr.name}`, onclick: (e: Event) => { e.stopPropagation(); deleteTrack(tr.id); } }, '✕')),
    h('div', { class: 'hrow' }, tog('mute', 'M'), tog('solo', 'S'),
      h('button', {
        class: 'mini autob' + (tr.autoShow ? ' on' : '') + (hasAuto ? ' has' : ''), title: t('auto.toggle'), 'aria-label': `${t('auto.toggle')} – ${tr.name}`, 'aria-pressed': String(!!tr.autoShow),
        onclick: (e: Event) => { e.stopPropagation(); tr.autoShow = tr.autoShow ? '' : 'vol'; commit(); },
      }, 'A'), vol),
  );
}

// ---------- Automation ----------
const AH = 64, PADY = 8, NS = 'http://www.w3.org/2000/svg';
const autoY = (prm: AutoParam, v: number) => PADY + (1 - (v - AUTO[prm].min) / (1 - AUTO[prm].min)) * (AH - 2 * PADY);
const autoV = (prm: AutoParam, y: number) => Math.round(clamp(AUTO[prm].min + (1 - (y - PADY) / (AH - 2 * PADY)) * (1 - AUTO[prm].min), AUTO[prm].min, 1) * 100) / 100;
const PARAMS: AutoParam[] = ['vol', 'pan', 'filter'];

function ahead(tr: Track) {
  const prm = tr.autoShow as AutoParam;
  const sel = h('select', { 'aria-label': `${t('auto.param')} – ${tr.name}`, title: t('auto.param'), data: { role: 'autoparam' } },
    ...PARAMS.map(k => h('option', { value: k, selected: prm === k }, t('auto.' + k) + (tr.auto?.[k]?.length ? ' •' : ''))));
  sel.onchange = () => { tr.autoShow = sel.value as AutoParam; commit(); };
  return h('div', { class: 'ahead', style: `--c:${tr.color}` }, h('span', { class: 'albl' }, t('auto.title')), sel,
    h('button', { class: 'mini', title: t('auto.clear'), 'aria-label': `${t('auto.clear')} – ${tr.name}`, data: { act: 'autoclear' }, disabled: !tr.auto?.[prm]?.length, onclick: () => { delete tr.auto![prm]; commit(); } }, '⌫'));
}

function alane(tr: Track, total: number) {
  const prm = tr.autoShow as AutoParam, px = S.px, W = total * px;
  const el = h('div', { class: 'alane', data: { auto: tr.id }, style: `--c:${tr.color}` });
  const svg = document.createElementNS(NS, 'svg'), line = document.createElementNS(NS, 'polyline');
  svg.setAttribute('width', String(W)); svg.setAttribute('height', String(AH)); svg.append(line); el.append(svg);
  const hint = h('div', { class: 'hint ahint' }, t('auto.hint'));
  const draw = () => {
    const l = tr.auto?.[prm] ?? [], y0 = autoY(prm, l.length ? l[0].v : AUTO[prm].def);
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
    const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); if (changed) commit(); };
    addEventListener('pointermove', mv); addEventListener('pointerup', up);
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
  const px = S.px, sx = e.clientX, o = { start: clip.start, len: clip.len, offset: clip.offset }, r = el.getBoundingClientRect(), dur = stepDur(S.project.bpm);
  const resize = e.clientX > r.right - 10, trim = !resize && e.clientX < r.left + 8 && r.width > 30;
  const buf = clip.bufferId ? buffers.get(clip.bufferId) : undefined;
  const maxLen = buf ? Math.ceil((buf.duration - clip.offset) / dur) : Infinity;
  // Déplacement de groupe : les autres clips sélectionnés suivent, chacun sur sa piste.
  const others = grouped && !resize && !trim ? selectedClips().filter(x => x.clip !== clip).map(x => ({ c: x.clip, s: x.clip.start, el: document.querySelector<HTMLElement>(`.clip[data-id="${x.clip.id}"]`) })) : [];
  const minStart = Math.min(o.start, ...others.map(x => x.s));
  let changed = false, target = tr;
  const mv = (ev: PointerEvent) => {
    let d = Math.round((ev.clientX - sx) / px / S.snap) * S.snap;
    if (resize) clip.len = clamp(o.len + d, Math.min(S.snap, o.len), maxLen);
    else if (trim) {
      // Bord gauche : le début avance ou recule, le contenu reste en place sur la timeline.
      d = clamp(d, Math.max(-o.start, buf ? -Math.floor(o.offset / dur) : -o.start), o.len - Math.min(S.snap, o.len));
      clip.start = o.start + d; clip.len = o.len - d;
      clip.offset = buf ? Math.max(0, o.offset + d * dur) : ((o.offset + d) % clip.patLen! + clip.patLen!) % clip.patLen!;
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
    removeEventListener('pointermove', mv); removeEventListener('pointerup', up);
    if (target !== tr) { tr.clips.splice(tr.clips.indexOf(clip), 1); target.clips.push(clip); S.selTrack = target.id; }
    if (changed) commit();
  };
  addEventListener('pointermove', mv); addEventListener('pointerup', up);
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
    const mv = (ev: PointerEvent) => set(ev.clientX);
    const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); commit(); };
    addEventListener('pointermove', mv); addEventListener('pointerup', up);
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
