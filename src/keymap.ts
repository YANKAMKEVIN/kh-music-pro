// Clavier d'ordinateur joué comme un instrument : disposition des touches (par position physique, `KeyboardEvent.code`,
// donc la même en AZERTY et en QWERTY) pour le piano et pour les 16 pads de la batterie.

/** Rangée du milieu = touches blanches à partir de Do, rangée du haut = touches noires ; deux octaves moins quelques notes. */
export const PIANO: Record<string, number> = { KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6, KeyG: 7, KeyY: 8, KeyH: 9, KeyU: 10, KeyJ: 11, KeyK: 12, KeyO: 13, KeyL: 14 };
/** Pads 1 à 8 sur les chiffres, 9 à 16 sur la rangée du milieu. */
export const PADS = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK'];

/** Note MIDI jouée par une touche du piano (Do central = 60, décalé de `octave` octaves), ou null si la touche n'en joue pas. */
export const pianoNote = (code: string, octave: number): number | null => code in PIANO ? 60 + PIANO[code] + octave * 12 : null;
/** Pad (0 à 15) d'une touche, ou -1. */
export const padOf = (code: string): number => PADS.indexOf(code);
