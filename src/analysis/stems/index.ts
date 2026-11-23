/** V20 — Séparation des pistes : voix, batterie, basse, autres (`ctx.result.stems`, au taux du son source).
 *  Calcul par traitement du signal (voir `separate.ts`), dans un Worker, morceau par morceau, annulable.
 *  La vue permet d'écouter chaque piste seule et de l'ajouter au morceau comme piste audio. */
import { engine } from '../../audio/engine';
import { addTexts, t } from '../../i18n';
import { S, addBuffer, commit } from '../../store';
import { Clip, newTrack, stepDur, uid } from '../../types';
import { h, toast } from '../../ui/dom';
import { registerAnalyzer } from '../registry';
import type { Analyzer, Ctx } from '../types';
import { STEMS, StemName, SepOut, memoryNeeded, separate } from './separate';

addTexts({
  'st.title': ['Séparer les pistes', 'Separate the stems', 'Separar las pistas'],
  'st.help': ['Sépare le son en quatre pistes : voix, batterie, basse et autres instruments. Écoute chacune seule, ajoute celles qui te servent au morceau. Les autres analyses s\'en servent pour être plus justes.', 'Splits the sound into four stems: vocals, drums, bass and other instruments. Listen to each one alone and add the ones you need to the song. The other analyses use them to be more accurate.', 'Separa el sonido en cuatro pistas: voz, batería, bajo y otros instrumentos. Escucha cada una sola y añade las que te sirvan a la canción. Los demás análisis las usan para ser más precisos.'],
  'st.vocals': ['Voix', 'Vocals', 'Voz'],
  'st.drums': ['Batterie', 'Drums', 'Batería'],
  'st.bass': ['Basse', 'Bass', 'Bajo'],
  'st.other': ['Autres instruments', 'Other instruments', 'Otros instrumentos'],
  'st.listen': ['Écouter', 'Listen', 'Escuchar'],
  'st.stop': ['Arrêter', 'Stop', 'Detener'],
  'st.listenA': ['Écouter la piste « {0} » seule', 'Listen to the “{0}” stem alone', 'Escuchar la pista «{0}» sola'],
  'st.add': ['Ajouter au morceau', 'Add to song', 'Añadir a la canción'],
  'st.addA': ['Ajouter la piste « {0} » au morceau', 'Add the “{0}” stem to the song', 'Añadir la pista «{0}» a la canción'],
  'st.addAll': ['Ajouter les quatre pistes', 'Add all four stems', 'Añadir las cuatro pistas'],
  'st.addedAll': ['Quatre pistes ajoutées au morceau.', 'Four stems added to the song.', 'Cuatro pistas añadidas a la canción.'],
  'st.level': ['{0} dB', '{0} dB', '{0} dB'],
  'st.silent': ['presque vide', 'almost empty', 'casi vacía'],
  'st.lowMem': ['Cet appareil n\'a pas assez de mémoire pour séparer les pistes.', 'This device doesn\'t have enough memory to separate stems.', 'Este dispositivo no tiene memoria suficiente para separar las pistas.'],
  'st.tooLong': ['Son trop long pour la mémoire de cet appareil ({0} au plus) : coupe-le en plusieurs parties.', 'Sound too long for this device\'s memory ({0} at most): cut it into several parts.', 'Sonido demasiado largo para la memoria de este dispositivo ({0} como máximo): córtalo en varias partes.'],
  'st.note': ['Séparation par traitement du signal : la voix est ce qui sonne au centre de l\'image stéréo ; sur un son mono, elle garde aussi les autres instruments.', 'Signal-processing separation: vocals are what sounds in the centre of the stereo image; on a mono sound they also keep the other instruments.', 'Separación por tratamiento de señal: la voz es lo que suena en el centro de la imagen estéreo; en un sonido mono también conserva los demás instrumentos.'],
});

const label = (s: StemName) => t('st.' + s);

// ---------- Mémoire disponible ----------
/** Mémoire de l'appareil en octets (Chrome : `deviceMemory`, plafonnée à 8 Go) ; QA : `qa.mem` la remplace. */
const deviceBytes = () => qa.mem ?? (((navigator as { deviceMemory?: number }).deviceMemory ?? 8) * 2 ** 30);
/** Part de la mémoire qu'on s'autorise pour la séparation. */
const budget = () => deviceBytes() * 0.3;

// ---------- Calcul (Worker, sinon fil principal) ----------
const NO_WORKER = new Error('no-worker');
function inWorker(ch: Float32Array[], sr: number, progress: (f: number) => void, signal: AbortSignal): Promise<SepOut> {
  return new Promise((ok, ko) => {
    let w: Worker, heard = false;
    try { w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }); }
    catch { return ko(NO_WORKER); }
    const end = () => { w.terminate(); signal.removeEventListener('abort', stop); };
    const stop = () => { end(); ko(new DOMException('annulé', 'AbortError')); };
    signal.addEventListener('abort', stop);
    w.onmessage = (e: MessageEvent<{ progress?: number; out?: SepOut; error?: string }>) => {
      heard = true;
      if (e.data.progress !== undefined) progress(e.data.progress);
      else if (e.data.out) { end(); ok(e.data.out); }
      else { end(); ko(new Error(e.data.error || '?')); }
    };
    // Worker refusé au démarrage (version bureau en file://, réglages du navigateur) : on calculera sur le fil principal.
    w.onerror = e => { end(); ko(heard ? new Error(e.message || 'worker') : NO_WORKER); };
    w.postMessage({ ch, sr, chunkSec: qa.chunkSec }, ch.map(a => a.buffer as ArrayBuffer));
  });
}

function onMainThread(ch: Float32Array[], sr: number, progress: (f: number) => void, signal: AbortSignal) {
  return separate(ch, sr, { chunkSec: qa.chunkSec }, progress, () => signal.aborted, () => new Promise(r => setTimeout(r, 0)));
}

async function run(ctx: Ctx, progress: (f: number) => void, signal: AbortSignal) {
  const src = ctx.source!.buffer, nc = Math.min(2, src.numberOfChannels), sr = src.sampleRate;
  if (memoryNeeded(src.length, nc, sr) > budget()) {
    const sec = Math.max(0, (budget() - memoryNeeded(0, nc, sr)) / (nc * 4 * 5 * sr));
    throw new Error(t('st.tooLong', `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`));
  }
  stopListening();
  const copy = () => Array.from({ length: nc }, (_, c) => src.getChannelData(c).slice());   // copies : transférées au Worker
  let out: SepOut | null = null;
  if (typeof Worker !== 'undefined' && !qa.mainThread) {
    try { out = await inWorker(copy(), sr, progress, signal); }
    catch (e) { if (e !== NO_WORKER) throw e; qa.fallbacks++; }
  }
  out ??= await onMainThread(copy(), sr, progress, signal);
  if (signal.aborted) throw new DOMException('annulé', 'AbortError');
  const stems: NonNullable<typeof ctx.result.stems> = {};
  for (const s of STEMS) {
    const b = engine.ctx.createBuffer(nc, src.length, sr);
    out[s].forEach((a, c) => b.copyToChannel(a as Float32Array<ArrayBuffer>, c));
    stems[s] = b;
  }
  ctx.result.stems = stems;
  qa.runs++;
}

// ---------- Écoute d'une piste seule ----------
let playing: { stem: StemName; src: AudioBufferSourceNode; gain: GainNode } | null = null;

function paintListen() {
  document.querySelectorAll<HTMLButtonElement>('#analyze [data-stem] [data-role="listen"]').forEach(b => {
    const on = playing?.stem === b.closest<HTMLElement>('[data-stem]')!.dataset.stem;
    b.setAttribute('aria-pressed', String(on)); b.classList.toggle('on', on);
    b.textContent = (on ? '■ ' : '▶ ') + t(on ? 'st.stop' : 'st.listen');
  });
}

export function stopListening() {
  if (!playing) return;
  const p = playing; playing = null;
  const now = engine.ctx.currentTime;
  p.gain.gain.cancelScheduledValues(now); p.gain.gain.setValueAtTime(p.gain.gain.value, now); p.gain.gain.linearRampToValueAtTime(0, now + 0.03);
  try { p.src.stop(now + 0.04); } catch { /* déjà arrêtée */ }
  setTimeout(() => p.gain.disconnect(), 80);
  paintListen();
}

function listen(ctx: Ctx, stem: StemName) {
  const was = playing?.stem;
  stopListening();
  const buf = ctx.result.stems?.[stem];
  if (was === stem || !buf) return;
  if (engine.playing) engine.stop();
  engine.ctx.resume(); engine.sync();
  const gain = engine.ctx.createGain(); gain.gain.value = 0.9; gain.connect(engine.mix.master);
  const src = engine.ctx.createBufferSource(); src.buffer = buf; src.connect(gain); src.start();
  src.onended = () => { if (playing?.src === src) stopListening(); };
  playing = { stem, src, gain };
  document.getElementById('analyze')?.addEventListener('close', stopListening, { once: true });
  paintListen();
}

// ---------- Ajout au morceau ----------
/** Ajoute des pistes séparées au morceau : une piste audio par piste séparée, au début du morceau. Un seul pas d'annulation. */
export function addStems(ctx: Ctx, which: StemName[]) {
  const name = (ctx.source?.name || '').replace(/\.[^.]+$/, '');
  let last = null as null | { tr: string; clip: string };
  for (const s of which) {
    const buf = ctx.result.stems?.[s];
    if (!buf) continue;
    const id = uid(); addBuffer(id, buf);
    const tr = newTrack('audio', S.project.tracks.filter(x => x.type === 'audio').length + 1);
    tr.name = label(s);
    const clip: Clip = { id: uid(), name: name ? `${name} · ${label(s)}` : label(s), start: 0, offset: 0, bufferId: id, gain: 1, len: Math.max(1, Math.ceil(buf.duration / stepDur(S.project.bpm))) };
    tr.clips.push(clip); S.project.tracks.push(tr);
    last = { tr: tr.id, clip: clip.id };
  }
  if (!last) return 0;
  S.selTrack = last.tr; S.selClip = last.clip;
  commit();
  toast(which.length === 1 ? t('an.added', label(which[0])) : t('st.addedAll'));
  return which.length;
}

// ---------- Résumé ----------
const dbOf = (b: AudioBuffer) => {
  let e = 0, n = 0;
  for (let c = 0; c < b.numberOfChannels; c++) { const x = b.getChannelData(c); for (let i = 0; i < x.length; i += 4) { e += x[i] * x[i]; n++; } }
  return n ? 10 * Math.log10(e / n + 1e-12) : -120;
};

function view(ctx: Ctx): HTMLElement | null {
  const stems = ctx.result.stems;
  if (!stems) return null;
  if (playing && stems[playing.stem] !== playing.src.buffer) stopListening();
  const rows = STEMS.filter(s => stems[s]).map(s => {
    const db = dbOf(stems[s]!), on = playing?.stem === s;
    return h('div', { class: 'fxfoot st-row', data: { stem: s } },
      h('span', { class: 'st-name', style: 'min-width:9em;font-weight:600' }, label(s)),
      h('span', { class: 'tip' }, db < -50 ? t('st.silent') : t('st.level', Math.round(db))),
      h('button', { class: 'pill' + (on ? ' on' : ''), data: { role: 'listen' }, 'aria-pressed': String(on), 'aria-label': t('st.listenA', label(s)), onclick: () => listen(ctx, s) }, (on ? '■ ' : '▶ ') + t(on ? 'st.stop' : 'st.listen')),
      h('button', { class: 'pill', data: { role: 'add' }, 'aria-label': t('st.addA', label(s)), onclick: () => addStems(ctx, [s]) }, t('st.add')));
  });
  return h('div', { class: 'st-view', id: 'stView' }, ...rows,
    h('div', { class: 'fxfoot' }, h('button', { class: 'pill accent', id: 'stAddAll', onclick: () => addStems(ctx, STEMS.filter(s => stems[s])) }, t('st.addAll'))),
    h('p', { class: 'tip' }, t('st.note')));
}

/** Réglages pour la QA (pas d'effet en usage normal). */
const qa = { mem: undefined as number | undefined, mainThread: false, chunkSec: undefined as number | undefined, runs: 0, fallbacks: 0, separate, stopListening, addStems, playing: () => playing?.stem ?? null };

const stemsAnalyzer: Analyzer & { qa: typeof qa } = {
  id: 'stems', order: 10,
  title: () => t('st.title'),
  help: () => t('st.help'),
  run, view,
  unavailable: () => deviceBytes() < 2 ** 30 ? t('st.lowMem') : null,
  qa,
};
registerAnalyzer(stemsAnalyzer);
