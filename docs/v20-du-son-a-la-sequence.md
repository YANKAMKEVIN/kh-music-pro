# V20 — Du son à la séquence

But : charger un son (MP3, WAV… ; pour un usage personnel) et en tirer de quoi refaire le morceau dans KH Music Pro : chant → notes, tempo et tonalité, pistes séparées, basse et piano → notes, batterie → motif, familles d'instruments.

Pas de téléchargement depuis YouTube dans l'application (conditions d'utilisation de YouTube) : l'utilisateur apporte un fichier audio.

## Socle (branche `v20`, fait)

- `src/analysis/types.ts` : le contrat. `Analyzer` (une analyse), `Ctx` (son chargé + résultats), `Result` (tempo, tonalité, pistes séparées, parties, instruments), `Part` / `FoundNote` (notes en secondes).
- `src/analysis/registry.ts` : `registerAnalyzer()`. Chaque analyse s'inscrit depuis son propre fichier.
- `src/analysis/index.ts` : **une ligne d'import par analyse** (seul point partagé).
- `src/analysis/build.ts` : `toNotes()` et `addPartAsTrack()` (partie → piste d'instrument calée sur le tempo).
- `src/ui/analyze.ts` : fenêtre « Du son à la séquence… » (menu Projet, bouton `#bAnalyze`) : choix du fichier, une ligne par analyse (Lancer, avancement, Annuler, résumé `view()`), liste des parties avec « Ajouter au morceau ».
- `addTexts()` dans `src/i18n.ts` : chaque analyse garde ses textes (fr, en, es) dans son propre fichier.
- QA : `window.kh.analysis` (`loadSource`, `runAnalyzer`, `addPart`, `AN`, `registerAnalyzer`, `reset`) ; cas AN01-AN04 ; `anTone()` fabrique un son de test. `KH_PORT=52xx bash qa/all.sh …` choisit le port du serveur de QA, pour que plusieurs sessions fassent tourner leur campagne en même temps.

## Règles pour chaque analyse

- Un dossier ou des fichiers à soi dans `src/analysis/` ; textes via `addTexts` ; ne pas modifier `ui/analyze.ts`, `types.ts` ni `build.ts` sauf nécessité (le dire dans la passation).
- Calcul lourd hors du fil principal (Worker) ; annulable par `signal` ; avancement par `progress`.
- Modèles d'apprentissage : licence permissive (MIT, Apache 2.0), chargés à la demande, servis depuis `public/` (fichiers < 100 Mo, limite de GitHub) ; pas d'appel réseau vers un tiers à l'exécution. Le site et l'appli bureau doivent fonctionner hors ligne une fois le modèle chargé.
- Cas de QA avec un préfixe à soi, des sons de test fabriqués (pas de musique protégée dans le dépôt), et des seuils de précision mesurés et notés.

## Répartition

| Partie | Branche | Préfixe QA |
|---|---|---|
| Chant → notes, tempo, tonalité | `v20-chant` | VX |
| Séparation des pistes | `v20-pistes` | ST |
| Basse et piano → notes | `v20-poly` | PO |
| Batterie → motif | `v20-batterie` | DR |
| Familles d'instruments | `v20-instruments` | IN |

## Batterie → motif (branche `v20-batterie`, préfixe DR)

Fichiers : `src/analysis/drums/` (`dsp.ts` repérage, `pattern.ts` grille et piste, `index.ts` analyse, textes, résumé). Une ligne dans `src/analysis/index.ts`. Aucun autre fichier partagé modifié.

### Ce que fait l'analyse

- Lit `ctx.input('drums')` (la piste séparée si elle existe, sinon le son entier), en mono.
- Repère les coups par traitement du signal, sans modèle appris : spectrogramme en tiers d'octave blanchi par bande, factorisation en matrices non négatives (NMF, divergence KL) avec quatre gabarits (fûts graves, caisse claire, métal, « attaque »). Les gabarits s'adaptent au son ; une seconde passe apprend le gabarit du charleston sur les coups de charleston du morceau joués sans grosse caisse. Les fuites d'un instrument sur la caisse claire sont mesurées sur les coups isolés et retranchées (les ghost notes restent).
- Classement : grosse caisse (36), caisse claire / clap (38), charleston fermé (42), ouvert (46, extinction nettement plus lente que les autres coups de métal du morceau), cymbale (49, extinction très lente), toms (45 / 47 / 50 selon leurs hauteurs relatives ; un fût grave dont la hauteur reste au-dessus de 100 Hz est un tom).
- Calcul dans un Worker créé à partir du code de `detectDrums` (blob : marche aussi en `file://` dans la version bureau, et la règle de contenu autorise `worker-src blob:`) ; repli sur le fil principal si le Worker est refusé. Avancement et annulation (le Worker est arrêté).
- Résultat : une `Part` `kind: 'drums'` (numéros General MIDI, temps en secondes) dans `ctx.result.parts`, et le résumé dans la fenêtre : nombre de coups par instrument, tempo et nombre de mesures, swing trouvé.
- Calage : tempo de `ctx.result.bpm` (avec `beatOffset` comme phase) sinon celui du projet ; phase des doubles-croches par moyenne circulaire des coups graves ; swing (doubles-croches impaires retardées, comme le swing du séquenceur) ; premier temps choisi pour mettre la grosse caisse sur 1 et la caisse claire sur 2 et 4 ; un son qui commence en cours de mesure est calé sur ses coups.
- « Ajouter en piste de batterie » (`addDrumTrack`, dans `pattern.ts`, pas dans `build.ts`) : nouvelle piste de batterie du séquenceur, un clip couvrant tout le morceau, une ligne par pad (ordre de `GM_DRUMS`), force du coup dans chaque case. Kit au choix (acoustique par défaut). Option « Repérer la mesure qui se répète » : motif d'une ou deux mesures (case gardée si elle revient dans plus de la moitié des blocs) joué en boucle sur la longueur du morceau, avec la part du morceau où il revient. Case « Appliquer ce swing au morceau » si un swing est trouvé. Ctrl+Z retire la piste.

### Mesures (23/11/2026, QA DR00, rythmes rendus hors ligne avec les sons de l'appli)

Coups retrouvés à 35 ms près et bien classés / coups joués ; « cases » = F-mesure du motif case par case. Les sons de batterie ont une part de hasard (bruit, échantillons) : d'un rendu à l'autre, un coup de plus ou de moins.

| Rythme | Grosse caisse | Caisse claire | Charleston | Autres | Cases |
|---|---|---|---|---|---|
| Rock 120, électro | 12/12 | 8/8 (parfois +1) | 32/32 | | 99-100 % |
| Rock 100, acoustique (banque enregistrée) | 12/12 | 8/8 | 32/32 | | 100 % |
| Hip-hop 90, charleston en doubles | 12/12 | 8/8 | 63-64/64 | | 98-100 % |
| Ghost notes 95 | 12/12 | 24/24 | 32/32 (+1 à +5) | | 93-99 % |
| Charleston ouvert 110 | 8/8 | 8/8 | 26-28/28 | ouvert 4/4 | 97-100 % |
| Crash + toms 130 | 4/4 | 3/3 (+1 à +3) | 8-10/12 | crash 1/1 ; toms 3/5 | 81-88 % |
| Swing 0,4 à 100 | 12/12 | 8/8 | 64/64 | swing trouvé 0,35-0,40 | 98-100 % |
| Rapide 174, 8 mesures | 16/16 | 16/16 | 64/64 | | 98-100 % |
| Lent 70, kit profond | 12/12 | 8/8 | 32/32 | | 98-100 % |
| Studio 120 (banque enregistrée) | 12/12 | 8/8 (parfois +1) | 32/32 | | 99-100 % |

Calage moyen des coups : -1 à +5 ms. Durée : 3 minutes de son (acoustique, 1 080 coups, tous retrouvés) analysées en 5 à 10 s dans le Worker.

Seuils vérifiés par la QA (F-mesure par instrument) : 0,9 en général ; rock électro 0,95 (grosse caisse, caisse claire) ; ghost notes 0,9 (caisse claire) et 0,85 (charleston), et les ghost notes ont une force < 0,6 × celle des coups appuyés ; ouvert 0,75 ; crash + toms : grosse caisse 0,9, caisse claire et charleston 0,75, cymbale 0,6, toms 0,4 ; avec un bruit de fond léger : charleston 0,85.

Cas DR01-DR15 : précision par style et par kit, tempos 70 à 174, swing (et « Appliquer ce swing »), levée de 1,3 s, tempo donné par l'analyse du tempo, gestes réels (Lancer, résumé, choix du kit, « Ajouter en piste de batterie », Ctrl+Z, bouton ≥ 44 px, calcul bien dans le Worker), boucle d'une mesure (au clavier : Espace sur la case, Entrée sur le bouton) et de deux mesures, annulation d'une analyse d'une minute, silence et note tenue (aucun coup), textes anglais et espagnols.

### Non vérifié, limites connues

- **Aucune vraie chanson** : tout est mesuré sur des rythmes fabriqués avec les sons de l'appli (pas de musique protégée dans le dépôt). Sur un morceau mixé (basse, guitares, chant), la précision sera plus basse, surtout sans piste de batterie séparée : la séparation des pistes (`v20-pistes`) devrait passer avant.
- Toms électroniques purs : trouvés en partie (3 sur 5) ; les toms aigus se confondent avec le corps de la caisse claire.
- Une ghost note jouée en même temps qu'un charleston, sur un kit dont le charleston déborde beaucoup dans le médium (acoustique), peut être prise pour une fuite et perdue.
- Clap et caisse claire ne sont pas séparés (tous deux 38). Ride = cymbale (49) ou charleston ouvert selon sa résonance. Pas de triolets ni de résolution plus fine que la double-croche dans le motif ajouté (le swing du séquenceur est utilisé à la place).
- Pas écouté à l'oreille ; pas essayé sous Windows ni dans la version bureau (le Worker en blob a été vérifié dans la version construite servie en local).
- Le bouton commun « Ajouter au morceau » de la liste des parties (`ui/analyze.ts`, `addPartAsTrack`) fait d'une partie de batterie une piste d'instrument (numéros GM joués comme des notes). Suggestion pour le rassemblement : dans `addPart`, si `part.kind === 'drums'`, appeler l'ajout en piste de batterie (`addFoundDrums` de `src/analysis/drums/index.ts`, ou une petite table « ajout par type de partie »). Je n'ai pas modifié `ui/analyze.ts`.
