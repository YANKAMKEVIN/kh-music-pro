// Zoom à la molette et au pincement, et dépôt de fichiers audio dans l'arrangement.
import { audioFiles, importFiles } from '../../actions';
import { t } from '../../i18n';
import { emit, S } from '../../store';
import { clamp } from '../dom';

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
