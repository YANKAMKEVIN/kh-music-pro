/**
 * Modèle de projet : les types (pistes, clips, notes, projet…) et, réexportées, les fonctions du modèle rangées dans
 * src/model/ par thème. Les autres fichiers importent tout depuis './types', comme avant le découpage.
 */
export * from './model/ids';
export * from './model/comp';
export * from './model/automation';
export * from './model/timing';
export * from './model/music';
export * from './model/presets';
export * from './model/project';

export type TrackType = 'drums' | 'synth' | 'audio';
export type Engine = 'sub' | 'fm' | 'pluck' | 'sampler' | 'multi' | 'au';

/** p = hauteur MIDI, s = début (en pas), l = durée (en pas), v = vélocité 0..1. s et l peuvent être fractionnaires (triolets, triples-croches). */
export interface Note { p: number; s: number; l: number; v: number }

export interface Clip {
  id: string;
  name: string;
  /** position et durée sur la timeline, en pas (double-croches) */
  start: number;
  len: number;
  /** décalage dans le contenu : en pas pour les motifs, en secondes pour l'audio */
  offset: number;
  /** Audio (V17) : le clip suit le tempo du morceau ; `srcBpm` = tempo auquel le son tombe juste sur la grille. */
  warp?: boolean;
  srcBpm?: number;
  patLen?: number;
  /** Batterie : nombre de cases par pas (1 = doubles-croches, 2 = triples-croches, 0,75 = triolets de croches, 1,5 = triolets de doubles). */
  res?: number;
  drums?: number[][];
  notes?: Note[];
  bufferId?: string;
  gain?: number;
  /** fondus d'entrée et de sortie, en pas (clips audio) */
  fadeIn?: number; fadeOut?: number;
  /** Prises multiples (enregistrement en boucle) : décalage de chaque prise dans le son, et prise choisie. */
  takes?: number[]; take?: number;
  /** Comping (V19) : portions d'un clip à prises multiples, chacune lue dans sa prise. `s` = début en pas depuis le début du clip ; triées, la première à 0. */
  comp?: CompSeg[];
  /** Fondu enchaîné (V19) avec le clip audio de la même piste qui se termine exactement là où celui-ci commence : durée en pas. */
  xfade?: number;
  /** Contrôles joués (V19), par clip d'instrument : pitch bend, molette de modulation, aftertouch. Positions en pas, dans le motif, comme les notes. */
  ctl?: Partial<Record<CtlKind, Pt[]>>;
}

export interface CompSeg { s: number; take: number }

/** pb = pitch bend (-1..1, 0 au repos), mod = molette de modulation CC1 (0..1), at = aftertouch (0..1). */
export type CtlKind = 'pb' | 'mod' | 'at';

/** Point d'automation : s = position (pas), v = valeur (volume 0..1, pan et filtre -1..1). */
export interface Pt { s: number; v: number }
export type AutoParam = 'vol' | 'pan' | 'filter' | 'rev' | 'dly' | 'chorus';

export interface SynthParams {
  preset: string;
  engine: Engine;
  wave: OscillatorType; wave2: OscillatorType;
  detune: number; mix2: number; octave: number;
  cutoff: number; reso: number; envAmt: number;
  a: number; d: number; s: number; r: number;
  pitchEnv: number;                       // chute de hauteur à l'attaque (demi-tons)
  ratio: number; fmAmt: number; fmDecay: number; // FM
  damp: number;                           // corde pincée
  bufferId?: string; sampleName?: string; root: number; // sampler
  hold: boolean;                         // boucle de maintien des instruments échantillonnés
  touch: number;                          // nuances : jouer doucement assombrit le timbre (0 = volume seul)
  bank?: string;                          // instrument échantillonné (moteur « multi »)
  bend?: number;                          // plage du pitch bend en demi-tons (V19, 2 par défaut)
  /** Instrument du Mac (V19, moteur « au ») : identifiant « aumu:sous-type:fabricant », nom affiché, état complet (base64). */
  auUrl?: string; auName?: string; auState?: string;
}

/** Effet ajouté dans la chaîne d'une tranche. `p` = réglages ; pour un plugin web : `url`, `name` et `state`. */
export interface Insert { id: string; type: string; on: boolean; p: Record<string, number>; url?: string; name?: string; state?: unknown; preset?: number }  // preset : préréglage d'usine choisi (plugin du Mac)

export interface Pad { bufferId: string; name: string }
/** Réglages d'un pad : volume (1 = normal), hauteur en demi-tons, panoramique. */
export interface PadFx { vol: number; tune: number; pan: number }

export interface Track {
  id: string; name: string; type: TrackType; color: string;
  vol: number; pan: number; mute: boolean; solo: boolean;
  eqLow: number; eqMid: number; eqHigh: number;
  comp: boolean; rev: number; dly: number;
  drive: number;   // saturation 0..1
  filter: number;  // -1..0 passe-bas, 0..1 passe-haut
  duck: number;    // sidechain : atténuation à chaque coup de kick (ou de la piste source), 0..1
  /** Sidechain (V19) : piste dont le son fait baisser celle-ci ; absent = le kick du séquenceur, comme avant. */
  sc?: string;
  /** Envois libres (V19) vers les bus, avant ou après le volume de la piste. */
  sends?: Send[];
  chorus: number; trem: number; crush: number; // modulation : chorus, trémolo (à la croche), lo-fi, 0..1
  eqMidF: number;                    // fréquence de la bande médium (Hz)
  compThr: number; compRatio: number; // compresseur : seuil (dB) et taux
  out: string;                       // sortie : '' = général, sinon identifiant d'un bus
  inserts: Insert[];                 // chaîne d'effets ajoutés, dans l'ordre, après l'égaliseur et le compresseur
  /** Chaînes d'effets (21/11/2026) : 'fixe' = tranche fixe puis chaîne (comme avant) ; 'chaine' = la chaîne seule, la tranche fixe est débranchée. */
  strip: 'fixe' | 'chaine';
  /** Courbes d'automation : les six réglages de la piste (AutoParam) et, depuis la V17, les réglages de ses effets (insKey). */
  auto?: Partial<Record<AutoParam, Pt[]>> & Record<string, Pt[] | undefined>;
  autoShow?: string;
  /** Gel (V17) : `frozen` = piste transformée en audio (coupée, gardée pour la dégeler) ; `frozenFrom` = la piste audio qui la remplace. */
  frozen?: boolean;
  frozenFrom?: string;
  synth?: SynthParams;
  kit?: string;
  pads?: (Pad | null)[];
  padFx?: Record<number, PadFx>;
  clips: Clip[];
}

/** Envoi vers un bus : niveau 0..1 ; `pre` = pris avant le volume de la piste (indépendant du fader), sinon après. */
export interface Send { id: string; bus: string; amt: number; pre: boolean }

export interface Project {
  /** Numéro de schéma du projet enregistré (voir src/persist.ts) ; absent = projet antérieur à la numérotation. */
  schema?: number;
  name: string; bpm: number; swing: number;
  loop: boolean; loopStart: number; loopLen: number;
  metronome: boolean; countIn: boolean;
  master: number; filter: number;
  revSize: number;                 // durée de la réverb (s)
  dlySteps: number; dlyFb: number; // écho : temps (pas) et répétitions 0..0,85
  key: number; scale: string;      // tonalité (0 = do) et gamme
  markers: { s: number; name: string }[]; // repères de la règle
  mLow: number; mMid: number; mHigh: number; // égaliseur du général (dB)
  width: number;                             // largeur stéréo : 0 mono, 1 normale, 2 élargie
  target: number;                            // niveau d'export en LUFS, 0 = simple protection des crêtes
  notes: string;                             // bloc-notes du projet (paroles, idées)
  punch: boolean;                            // enregistrement audio limité à la zone de boucle (punch-in / punch-out)
  buses: Track[];                            // bus de mixage : des tranches sans clip, où l'on envoie plusieurs pistes
  tempos: { s: number; bpm: number }[];      // changements de tempo en cours de morceau (triés par position)
  sig: number;                               // numérateur de la signature : temps (x/4) ou croches (x/8) par mesure
  den: 4 | 8;                                // dénominateur (suite, 21/11/2026) : 4 = noires, 8 = croches (6/8, 9/8, 12/8, 5/8, 7/8)
  liveQ: number;                             // mode Live : calage du lancement des clips, en pas (0 = à la mesure)
  liveLen: number;                           // mode Live (suite) : longueur d'un clip enregistré à la volée, en mesures
  exp: ExportOpts;                           // réglages d'export (V19)
  tracks: Track[];
}

/** Export (V19) : plage (tout, zone de boucle, ou mesures `from` à `to` comprises), queue de son après la fin, résolution et fréquence du WAV. */
export interface ExportOpts { range: 'all' | 'loop' | 'bars'; from: number; to: number; tail: boolean; bits: 16 | 24; rate: 44100 | 48000 }
