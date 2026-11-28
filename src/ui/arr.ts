import { addTrack, copyClip, deleteClip, deleteTrack, duplicateClip, duplicateTrack, editTempo, freezeTrack, moveTrack, pickAudio, removeTempo, renameMarker, selectedClips, setLoopToClip, splitClipAt, unfreezeTrack } from '../actions';
import { engine } from '../audio/engine';
import { t } from '../i18n';
import { buffers, commit, emit, findTrack, revert, S, select } from '../store';
import { BAR, BEAT, Clip, compSlice, contentEnd, newPatternClip, srcStep, Track, TrackType } from '../types';
import { clamp, followDrag, h, popMenu, resettable } from './dom';
import { meter } from './meters';
import { typeIcon } from './icons';
import { drawPreview } from './arr/waves';
import { ahead, alane } from './arr/auto';
export * from './arr/waves';
export * from './arr/auto';
export * from './arr/zoom';

// ---------- Rendu ----------
const TRACK_H = 84;
/** Bouton d'ajout d'une piste d'un type : rangés dans la barre d'arrangement (V18, maquette ; décision de Kevin du 22/11). */
export function addBtn(type: TrackType) {
  return h('button', { class: 'add', data: { add: type }, title: t('track.add', t('type.' + type)), onclick: () => addTrack(type) }, '＋ ', typeIcon(type, 16), h('span', {}, t('type.' + type)));
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
  resettable(vol, 0.8, v => { tr.vol = v; engine.sync(); }, commit, t('sl.resetTip'));
  return h('div', {
    class: 'head' + (S.selTrack === tr.id ? ' sel' : '') + (tr.frozen ? ' frozen' : ''), data: { id: tr.id }, style: `--c:${tr.color}`,
    onpointerdown: () => { if (S.selTrack !== tr.id) select(tr.id, ''); },
  },
    h('div', { class: 'hrow' }, h('span', { class: 'ticon', title: t('type.' + tr.type) }, typeIcon(tr.type)), name,
      tr.frozen ? h('span', { class: 'tfrzbadge', title: t('frz.frozen'), role: 'img', 'aria-label': t('frz.frozen') }, '❄') : '', tmenu),
    h('div', { class: 'hrow' }, tog('mute', 'M'), tog('solo', 'S'),
      h('button', {
        class: 'mini autob' + (tr.autoShow ? ' on' : '') + (hasAuto ? ' has' : ''), title: t('auto.toggle'), 'aria-label': `${t('auto.toggle')} – ${tr.name}`, 'aria-pressed': String(!!tr.autoShow),
        onclick: (e: Event) => { e.stopPropagation(); tr.autoShow = tr.autoShow ? '' : 'vol'; commit(); },
      }, 'A'), vol),
    // Niveau de la piste, visible sans quitter l'arrangement (même mesure que le vumètre du mixeur).
    meter(tr.id, tr.name, 'hmeter'),
  );
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
/**
 * Menu d'un clip (clic droit, appui long au doigt, touche Menu ou Maj+F10) : les actions de la barre de l'éditeur et du clavier,
 * là où l'on regarde. `at` : pas visé par le pointeur (« Scinder ici ») ; sans pointeur, la scission se fait à la tête de lecture.
 */
function clipMenu(tr: Track, c: Clip, x: number, y: number, at: number | null) {
  // Le clip visé devient le clip sélectionné, sauf s'il fait partie d'une sélection multiple (les actions portent alors sur elle).
  if (S.selClip !== c.id && !S.selMore.has(c.id)) select(tr.id, c.id);
  const here = at ?? Math.round(engine.currentStep()), inside = here > c.start && here < c.start + c.len;
  popMenu(x, y, [
    { id: 'rename', label: t('ctx.rename'), fn: () => {
      select(tr.id, c.id); S.tab = 'editor'; emit();
      const f = document.querySelector<HTMLInputElement>('#panel .cname-in'); f?.focus(); f?.select();
    } },
    { id: 'dup', label: t('act.dup'), key: 'Ctrl+D', fn: duplicateClip },
    { id: 'split', label: t(at === null ? 'ctx.splitPlay' : 'ctx.splitHere'), key: at === null ? 'Ctrl+E' : undefined, disabled: !inside, fn: () => { select(tr.id, c.id); splitClipAt(here); } },
    { id: 'loop', label: t('act.loop'), fn: () => { select(tr.id, c.id); setLoopToClip(); } },
    { id: 'copy', label: t('ctx.copy'), key: 'Ctrl+C', fn: () => { select(tr.id, c.id); copyClip(); } },
    null,
    { id: 'del', label: t('act.del'), key: t('help.key.del'), danger: true, fn: deleteClip },
  ], t('ctx.clip', c.name), () => document.querySelector<HTMLElement>(`.clip[data-id="${c.id}"]`));
}
const ctxOpen = () => !!document.querySelector('.menu-list.ctx');
function lane(tr: Track) {
  const el = h('div', { class: 'lane' + (S.selTrack === tr.id ? ' sel' : ''), data: { id: tr.id } });
  for (const c of tr.clips) el.append(clipEl(tr, c));
  if (!tr.clips.length) el.append(h('div', { class: 'hint' }, t(tr.type === 'audio' ? 'hint.audioLane' : 'hint.patternLane')));
  el.onpointerdown = e => laneDown(e, tr);
  const clipOf = (e: Event) => { const ce = (e.target as HTMLElement).closest<HTMLElement>('.clip'), c = ce && tr.clips.find(x => x.id === ce.dataset.id); return ce && c ? { ce, c } : null; };
  el.oncontextmenu = e => {
    const hit = clipOf(e);
    if (!hit) return;
    e.preventDefault();
    if (ctxOpen()) return;   // déjà ouvert par l'appui long ou par le clavier
    const r = hit.ce.getBoundingClientRect(), on = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    if (on) clipMenu(tr, hit.c, e.clientX, e.clientY, Math.round((e.clientX - el.getBoundingClientRect().left) / S.px / S.snap) * S.snap);
    else clipMenu(tr, hit.c, r.left + 12, r.top + 24, null);   // demandé au clavier : posé sur le clip
  };
  el.onkeydown = e => {
    const hit = (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) && clipOf(e);
    if (!hit) return;
    e.preventDefault(); e.stopPropagation();
    const r = hit.ce.getBoundingClientRect(); clipMenu(tr, hit.c, Math.max(r.left, el.parentElement!.getBoundingClientRect().left) + 12, r.top + 24, null);
  };
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
  let changed = false, target = tr, stop = () => { };
  // Appui long au doigt ou au stylet (sans bouger) : le menu du clip s'ouvre, le glissé est abandonné.
  const HOLD = 550, longPress = (lifted = false) => {
    if (changed || ctxOpen()) return;
    stop(); clipMenu(tr, clip, e.clientX + 4, e.clientY + 4, Math.round((e.clientX - el.parentElement!.getBoundingClientRect().left) / px / S.snap) * S.snap);
    // Le lever du doigt peut encore produire un clic sur le clip, voire un double-clic avec un appui bref juste avant : le
    // double-clic ouvrirait l'éditeur, dont le redessin referme aussitôt le menu. Ces clics-là sont ignorés, jusqu'au prochain
    // appui (dans le menu ou ailleurs), qui agit normalement.
    const swallow = (ev: Event) => { ev.stopPropagation(); ev.preventDefault(); };
    const MOUSE = ['mousedown', 'mouseup', 'click', 'dblclick'];
    const done = () => { for (const t of MOUSE) removeEventListener(t, swallow, true); removeEventListener('pointerdown', done, true); removeEventListener('pointerup', later, true); };
    const later = () => setTimeout(done, 400);
    for (const t of MOUSE) addEventListener(t, swallow, true);
    addEventListener('pointerdown', done, true);
    if (lifted) later(); else addEventListener('pointerup', later, { capture: true, once: true });
  };
  let held = e.pointerType !== 'mouse';
  const hold = held ? window.setTimeout(() => longPress(), HOLD) : 0;
  const mv = (ev: PointerEvent) => {
    if (Math.hypot(ev.clientX - sx, ev.clientY - e.clientY) > 8) { clearTimeout(hold); held = false; }
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
  const up = (ev: PointerEvent) => {
    clearTimeout(hold);
    // Téléphone occupé (chargement des sons, redessin) : le doigt a été tenu assez longtemps, mais le minuteur n'a pas encore pu
    // passer quand le lever arrive. La durée de l'appui (horodatage des deux gestes) décide, pas l'heure du minuteur.
    if (held && !changed && target === tr && ev.timeStamp - e.timeStamp >= HOLD) { longPress(true); return; }
    if (target !== tr) { tr.clips.splice(tr.clips.indexOf(clip), 1); target.clips.push(clip); S.selTrack = target.id; }
    if (changed) commit();
  };
  // Geste annulé : le clip (et ceux qui le suivaient) reviennent à leur place, sur leur piste.
  stop = followDrag(e, mv, up, () => { clearTimeout(hold); revert(); if (target !== tr) emit(); });
}
/**
 * Menu ⋯ ouvert pendant un redessin (note jouée en enregistrement, lecture, réglage…) : rouvert dans la nouvelle tête de la même
 * piste, à la même place et sans animation, focus compris (décision de Kevin du 21/11/2026). Il ne se referme que sur un clic
 * dehors, Échap, un choix, ou un défilement qui l'éloignerait de son bouton.
 */
function keepTrackMenu(root: HTMLElement): () => void {
  const old = root.querySelector<HTMLDetailsElement>('.head details.tmenu[open]');
  const id = old?.closest<HTMLElement>('.head')?.dataset.id;
  if (!old || !id) return () => { };
  const list = old.querySelector<HTMLElement>(':scope > .menu-list')!, a = document.activeElement;
  const focus = a && old.contains(a) ? (a.tagName === 'SUMMARY' ? -1 : [...list.querySelectorAll('button')].indexOf(a as HTMLButtonElement)) : null;
  const pos = { left: list.style.left, top: list.style.top, y: old.dataset.y };
  return () => {
    const d = [...root.querySelectorAll<HTMLElement>('.head')].find(e => e.dataset.id === id)?.querySelector<HTMLDetailsElement>('details.tmenu');
    if (!d) return;
    const l = d.querySelector<HTMLElement>(':scope > .menu-list')!;
    d.classList.add('kept'); l.style.left = pos.left; l.style.top = pos.top; if (pos.y !== undefined) d.dataset.y = pos.y;
    d.open = true;
    if (focus === -1) d.querySelector<HTMLElement>('summary')!.focus({ preventScroll: true });
    else if (focus !== null && focus >= 0) l.querySelectorAll<HTMLElement>('button')[focus]?.focus({ preventScroll: true });
  };
}
/**
 * Longueur dessinée en plus pendant la lecture : la tête de lecture peut dépasser la fin du morceau (un enregistrement
 * n'a pas encore de clip tant qu'il n'est pas arrêté). Sans elle, la règle s'arrêtait à 48 mesures et ses numéros disparaissaient.
 */
let playSpan = 0, drawn = 0;
const baseSpan = () => Math.max(contentEnd(S.project) + BAR * 8, BAR * 48);
/** Appelé à chaque image : rallonge l'arrangement avant que la tête de lecture n'atteigne sa fin, et le ramène à l'arrêt. */
export function followPlayhead(step: number, playing: boolean) {
  // En lecture : on agrandit par 16 mesures, 4 mesures avant la fin. À l'arrêt : juste de quoi voir la tête de lecture.
  const want = playing ? Math.max(playSpan, step + BAR * 4 > drawn ? Math.ceil((step + BAR * 16) / BAR) * BAR : 0)
    : step + BAR * 2 > baseSpan() ? Math.ceil((step + BAR * 8) / BAR) * BAR : 0;
  if (want === playSpan) return;
  playSpan = want;
  if (Math.max(baseSpan(), playSpan) !== drawn) renderArr();
}
export function renderArr() {
  const root = document.getElementById('arr')!, p = S.project, px = S.px;
  const reopen = keepTrackMenu(root);
  const total = drawn = Math.max(baseSpan(), playSpan);
  const heads = h('div', { class: 'heads' });
  const lanes = h('div', { class: 'lanes', style: `width:${total * px}px;--bar:${BAR * px}px;--beat:${BEAT * px}px` });

  heads.append(h('div', { class: 'corner' }, h('span', { class: 'clbl' }, t('arr.tracks'))));

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
    ondblclick: () => renameMarker(m.s),
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
  lanes.append(h('div', { id: 'recz' }), h('div', { id: 'ph' }));

  const keep = root.scrollLeft;
  root.replaceChildren(h('div', { class: 'arr-inner' }, heads, lanes));
  root.scrollLeft = keep;
  reopen();
}
// ---------- Prise en cours : piste enregistrée et zone déjà captée ----------
/** Zone parcourue par une prise, en pas : elle s'étend avec la tête de lecture (en boucle, elle finit par couvrir toute la boucle). */
export function recSpan(prev: { from: number; to: number } | null, step: number): { from: number; to: number } {
  return prev ? { from: Math.min(prev.from, step), to: Math.max(prev.to, step) } : { from: step, to: step };
}
let recZone: { from: number; to: number } | null = null, recOn = false;
/**
 * À chaque image pendant un enregistrement : liseré rouge sur la tête de la piste enregistrée et voile rouge léger sur la zone
 * déjà captée (rien pendant le décompte ; en punch, seulement la zone de boucle). Tout s'efface à la fin de la prise.
 */
export function updateRecView(step: number) {
  const z = document.getElementById('recz');
  if (!z) return;
  if (!engine.recording) {
    if (recOn) { recOn = false; recZone = null; z.style.display = ''; document.querySelectorAll('#arr .head.rec').forEach(e => e.classList.remove('rec')); }
    return;
  }
  recOn = true;
  // Piste qui reçoit la prise : celle du jeu enregistré, ou la piste audio sélectionnée (sinon la prise ira sur une piste audio libre).
  const id = engine.recording === 'midi' ? engine.recTrack : findTrack(S.selTrack)?.type === 'audio' ? S.selTrack : '';
  document.querySelectorAll<HTMLElement>('#arr .head').forEach(e => e.classList.toggle('rec', !!id && e.dataset.id === id));
  if (engine.countLeft() > 0) { recZone = null; z.style.display = ''; return; }
  // La zone part du point de départ de la prise (la tête de lecture y était à l'arrêt), pas de la première image affichée.
  recZone = recSpan(recZone ?? recSpan(null, engine.pos), step);
  let { from, to } = recZone;
  if (engine.recording === 'audio' && engine.recMode === 'punch') { const p = S.project; from = Math.max(from, p.loopStart * BAR); to = Math.min(to, (p.loopStart + p.loopLen) * BAR); }
  const lane = id ? document.querySelector<HTMLElement>(`#arr .lane[data-id="${id}"]`) : null, all = z.parentElement!;
  if (to <= from) { z.style.display = ''; return; }
  z.style.cssText = `display:block;left:${from * S.px}px;width:${(to - from) * S.px}px;top:${lane ? lane.offsetTop : 36}px;height:${lane ? lane.offsetHeight : all.scrollHeight - 36}px`;
}
/** Met à jour les surbrillances de sélection sans reconstruire le DOM. */
export function refreshSelection() {
  document.querySelectorAll<HTMLElement>('#arr .head, #arr .lane').forEach(e => e.classList.toggle('sel', e.dataset.id === S.selTrack));
  document.querySelectorAll<HTMLElement>('#arr .clip').forEach(e => { const more = S.selMore.has(e.dataset.id!); e.classList.toggle('sel', more || e.dataset.id === S.selClip); e.classList.toggle('sel2', more); });
}
