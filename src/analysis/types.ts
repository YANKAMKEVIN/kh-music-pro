/** V20 — Du son à la séquence : contrat commun à toutes les analyses.
 *  Une analyse lit le son chargé (`ctx.source`), écrit ce qu'elle trouve dans `ctx.result`,
 *  et peut proposer des parties (suites de notes) que l'utilisateur ajoute au morceau. */

/** Une note trouvée dans le son, en secondes depuis le début du son. `midi` = hauteur (60 = do central) ; pour la batterie, numéro General MIDI (36 grosse caisse, 38 caisse claire, 42 charleston fermé…). */
export interface FoundNote { t: number; d: number; midi: number; vel: number }

/** Une partie prête à devenir une piste : mélodie chantée, basse, piano ou batterie. */
export interface Part {
  id: string;
  kind: 'melody' | 'bass' | 'piano' | 'drums' | 'other';
  /** nom montré à l'utilisateur, déjà traduit */
  name: string;
  notes: FoundNote[];
  /** son de piste conseillé pour une piste d'instrument (clé de PRESETS), facultatif */
  preset?: string;
}

/** Famille d'instruments reconnue, avec sa confiance 0..1 et, si connue, la part du morceau où on l'entend (0..1). */
export interface FoundInstrument { family: string; label: string; score: number; presence?: number }

export interface Result {
  /** tempo détecté (battements par minute) et décalage du premier temps, en secondes */
  bpm?: number; beatOffset?: number;
  /** tonalité : tonique 0..11 (0 = do), mode */
  key?: { tonic: number; mode: 'major' | 'minor'; score: number };
  /** pistes séparées (voix, batterie, basse, autres), au taux du son source */
  stems?: Partial<Record<'vocals' | 'drums' | 'bass' | 'other', AudioBuffer>>;
  parts: Part[];
  instruments?: FoundInstrument[];
}

export interface Ctx {
  source: { name: string; buffer: AudioBuffer } | null;
  result: Result;
  /** Son à analyser pour une partie donnée : la piste séparée si elle existe, sinon le son entier. */
  input(stem?: 'vocals' | 'drums' | 'bass' | 'other'): AudioBuffer;
}

export interface Analyzer {
  id: string;
  /** ordre d'affichage (petit = en haut) */
  order: number;
  title(): string;
  help(): string;
  /** Lance l'analyse. `progress` reçoit 0..1 ; `signal` annule. Doit écrire dans `ctx.result`. */
  run(ctx: Ctx, progress: (f: number) => void, signal: AbortSignal): Promise<void>;
  /** Résumé de ce qui a été trouvé (affiché sous le bouton), facultatif. */
  view?(ctx: Ctx): HTMLElement | null;
  /** Analyse impossible ici (raison à afficher), par exemple module trop lourd pour le téléphone. */
  unavailable?(): string | null;
}
