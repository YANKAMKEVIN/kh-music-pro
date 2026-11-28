// Canvas nets sur écran haute densité, sans faire exploser le coût sur téléphone.

/** Densité maximale prise en compte : au-delà (téléphones à 3×), la différence ne se voit pas, le coût (pixels à remplir) si. */
export const MAX_DPR = 2;
/** Plafond de pixels par canvas (un long clip très zoomé) : reste sous les limites des navigateurs mobiles. */
const MAX_PIXELS = 4_000_000;

/** Densité retenue pour un canvas de `w` × `h` pixels CSS : celle de l'écran, plafonnée à MAX_DPR et au budget de pixels. */
export function canvasRatio(w: number, h: number, dpr = (typeof devicePixelRatio === 'number' ? devicePixelRatio : 1) || 1): number {
  const r = Math.min(Math.max(1, dpr), MAX_DPR);
  const fit = Math.sqrt(MAX_PIXELS / Math.max(1, w * h));
  return Math.max(1, Math.min(r, fit));
}

/**
 * Dimensionne le canvas pour `w` × `h` pixels CSS à la densité plafonnée et renvoie son contexte, déjà mis à l'échelle :
 * le dessin se fait en pixels CSS, comme avant. La taille affichée doit être donnée par la feuille de style
 * (sinon le canvas s'afficherait à sa taille en pixels réels, deux fois trop grand).
 */
export function fitCanvas(cv: HTMLCanvasElement, w: number, h: number): CanvasRenderingContext2D {
  const r = canvasRatio(w, h);
  cv.width = Math.round(w * r); cv.height = Math.round(h * r);
  const g = cv.getContext('2d')!;
  g.setTransform(r, 0, 0, r, 0, 0);
  return g;
}
