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

## Basse et piano → notes (branche `claude/v20-poly-a84884`, préfixe PO)

**Fait.** Deux lignes dans la fenêtre « Du son à la séquence » :

- **Basse → notes** (`bass-notes`) lit la piste de basse séparée (`ctx.input('bass')`) ou, à défaut, le son entier ; une note à la fois, de Mi1 à Sol4 ; partie « Basse » au son `r_ebass` (basse électrique échantillonnée).
- **Piano → notes** (`piano-notes`) lit la piste « autres instruments » (`ctx.input('other')`) ou le son entier ; accords jusqu'à 6 notes, du la 1 au do 7 (à partir du la 2 quand il n'y a pas de piste séparée : le grave du mélange appartient à la basse) ; partie « Piano » au son `r_piano`.
- Résumé : nombre de notes et registre (« 16 notes, de Mi1 à Mi3 »), avertissement quand le son entier est analysé, et pour le piano les **accords par mesure** (Do, La m, Fa, Sol 7 / C, Am, F, G7), calés sur le tempo trouvé (`result.bpm`, `beatOffset`) ou celui du morceau ; 16 mesures affichées, puis « … et N mesures de plus ».
- Réglages sous le résumé : **Sensibilité** (0–100 %, 50 % par défaut) et **Note la plus courte** (30–300 ms, 60 ms par défaut), au clavier et au doigt ; on change un réglage puis on appuie de nouveau sur Lancer (la fenêtre commune n'a pas d'emplacement de réglages avant la première analyse).
- Calcul dans un Worker (inclus dans la page, `?worker&inline`, autorisé par la règle de contenu `worker-src blob:` ; vérifié sur la version construite) ; avancement ; annulation (le Worker est arrêté). Si un Worker est impossible, le calcul se fait sur place.

**Méthode (traitement du signal, aucun modèle, aucune dépendance ajoutée).** Fichiers : `src/analysis/poly/core.ts` (calcul pur), `worker.ts`, `index.ts` (analyses, réglages, résumé, textes fr/en/es). Seul fichier partagé touché : une ligne dans `src/analysis/index.ts`.

- Le navigateur rééchantillonne le son en mono à 22 050 Hz et à 5 512,5 Hz (passe-bas 600 Hz pour la basse) ; pas d'analyse de 11,6 ms.
- Basse : hauteur par YIN (périodicité : juste même quand la fondamentale est faible) ; quand le son n'est pas bien périodique (mélange), on prend la note la plus grave trouvée par la méthode du piano. Débuts de note aux remontées d'énergie (notes rejouées) et aux changements de hauteur tenus (jeu lié). Accordage général corrigé (moyenne des écarts au demi-ton).
- Piano : une raie par demi-ton mesurée avec une fenêtre de 17 périodes de la note (résolution d'un demi-ton dans tout le registre) ; trame par trame, on retient la note dont la série d'harmoniques est la plus forte, on retire ses 12 premières harmoniques (enveloppe lisse, pour garder l'octave jouée dans l'accord), et on recommence. Ensuite : suivi de chaque hauteur, début calé sur l'attaque du son la plus proche (flux spectral), coupe d'une note rejouée, rejet des restes d'harmoniques et des « notes » sans attaque. Accordage général estimé (−40 à +50 cents) avant l'analyse.
- Accords : histogramme des notes de la mesure comparé à 7 types (majeur, mineur, 7, maj7, m7, dim, sus4), la note la plus grave favorisant la fondamentale.

**Pourquoi pas Basic Pitch (Spotify, Apache 2.0).** Le paquet npm `@spotify/basic-pitch` 1.0.1 impose TensorFlow.js 3 (environ 3 Mo de code en plus, modèle d'environ 1 Mo), lent sans carte graphique dans un Worker, et ajouterait une dépendance lourde dans `package.json` pendant que cinq branches le modifient en parallèle. La méthode ci-dessus est juste à 100 % sur nos sons de test, analyse 3 minutes en 2,5 s et ne charge rien. Basic Pitch reste une amélioration possible pour la vraie musique (instruments réels, réverbération), à mesurer sur des enregistrements.

**Mesures** (QA dans le navigateur, sons fabriqués ; F-mesure sur les débuts de note, même hauteur, à ±50 ms ; `node qa/bench/poly-bench.ts` refait les mêmes mesures hors navigateur) :

| Cas | F-mesure | Écart moyen des débuts | Seuil du cas |
|---|---|---|---|
| Basse à la fondamentale faible (PO02) | 1,00 | 16 ms | ≥ 0,9 |
| Basse rapide, notes répétées, octaves (PO03) | 1,00 | 31 ms | ≥ 0,9 |
| Basse liée / en sons purs (PO04) | 1,00 / 1,00 | 29 / 27 ms | ≥ 0,9 |
| Accords de 3-4 notes, timbre de piano (PO05) | 1,00 | 3 ms | ≥ 0,9 |
| Arpèges / notes tenues / accord rejoué (PO06) | 1,00 / 1,00 / 1,00 | 3-5 ms | ≥ 0,9 |
| Sons purs avec octave / aigus / note douce (PO07) | 1,00 / 1,00 / 1,00 | 3-6 ms | ≥ 0,9 |
| Accordé à −35 cents (basse, piano) / +25 cents (PO08) | 1,00 / 1,00 / 1,00 | 3-18 ms | ≥ 0,9 |
| Bruit de fond −40 dB : piano / basse (PO09) | 1,00 / 0,94 | 3 / 25 ms | ≥ 0,9 |
| Sans pistes séparées, basse + accords mélangés (PO10) | basse 0,74 · piano 0,74 | 19 / 3 ms | ≥ 0,7 / ≥ 0,6 |
| Trois minutes de piano (PO14) | 1,00, en 2,5 s | 4 ms | ≥ 0,9, < 60 s |

Autres cas : fenêtre et textes en trois langues (PO01), ajout au morceau calé au tempo + Ctrl+Z (PO11), annulation et interface fluide pendant le calcul (PO12), réglages au clavier (PO13), téléphone au doigt (PO15).

**Non vérifié.** Aucun enregistrement réel (vraie basse, vrai piano, réverbération, chant par-dessus) : tous les sons sont fabriqués, la précision sur de la musique réelle sera plus basse, surtout sans pistes séparées (0,74 sur un mélange simple). Pas d'écoute à l'oreille des parties ajoutées. Pas d'essai sous Windows ni dans l'application bureau (la version construite a été essayée dans Chromium, Worker compris). Les durées de note sont approximatives (seuls les débuts sont mesurés). Pas de pédale de sustain, pas de glissés de basse (une glissade devient une suite de notes).

**Campagne entière (23/11/2026, port 5243, cinq campagnes en parallèle sur la même machine).** 479/494 au premier passage ; les 15 échecs relancés seuls : 13 passent (dont PO09 et PO12, lents sous la charge), restent **CL01** (rognage d'un clip audio par la souris, échoue aussi sur la branche `v20` sans ce travail : défaut antérieur, sans lien avec l'analyse) et QZ03 (passe au deuxième essai). Les 15 cas PO passent.
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
- Campagne complète (23/11/2026, port 5244) : 493 cas sur 495. Les deux échecs sont des cas de rapidité (TR02 : chargement de page trop long ; PF03 : notes en retard après gel des pistes) ; TR02 passe rejoué seul, PF03 échoue aussi sur le socle `v20` sans la batterie : la machine faisait tourner les campagnes de cinq sessions (charge moyenne 30 à 40). À rejouer sur une machine calme ou sur GitHub.
- Pas écouté à l'oreille ; pas essayé sous Windows ni dans la version bureau (le Worker en blob a été vérifié dans la version construite servie en local).
- Le bouton commun « Ajouter au morceau » de la liste des parties (`ui/analyze.ts`, `addPartAsTrack`) fait d'une partie de batterie une piste d'instrument (numéros GM joués comme des notes). Suggestion pour le rassemblement : dans `addPart`, si `part.kind === 'drums'`, appeler l'ajout en piste de batterie (`addFoundDrums` de `src/analysis/drums/index.ts`, ou une petite table « ajout par type de partie »). Je n'ai pas modifié `ui/analyze.ts`.
## Chant → notes, tempo et tonalité (branche `v20-chant`, préfixe QA `VX`)

### Ce qui est fait

- **Deux analyses** dans la fenêtre « Du son à la séquence » :
  - **Tempo et tonalité** (`vx-tempo`) : tempo en BPM, premier temps, tonalité (tonique + majeur/mineur, avec une confiance). Deux boutons : « Appliquer le tempo au morceau » et « Appliquer la tonalité au morceau » (tonalité et gamme du projet). Chacun s'annule par Ctrl+Z ou par le bouton « Annuler » du message de confirmation.
  - **Chant → notes** (`vx-melody`) : suit la voix note par note et propose une partie « Chant » (son de piste conseillé : flûte), ajoutée au morceau par « Ajouter au morceau ». Utilise la voix séparée (`ctx.input('vocals')`) si la séparation des pistes a tourné, et le dit ; sinon conseille de lancer la séparation d'abord.
- **Calcul dans un Worker** (`src/analysis/vx.worker.ts`, intégré au code par Vite en `?worker&inline`, donc compatible avec la règle de sécurité du site et de la version bureau), avec avancement et annulation. Si le navigateur refusait le Worker, le calcul tourne dans la page (même résultat).
- **Fichiers** (tous à moi) : `vx-dsp.ts` (calculs purs), `vx.worker.ts`, `vx-run.ts` (lancement, annulation, son mono), `vx-tempo.ts`, `vx-melody.ts`, `vx.ts` ; une ligne `import './vx';` dans `index.ts`. Aucun changement de `types.ts`, `build.ts` ni `ui/analyze.ts`.

### Méthodes

- Le son est ramené en mono à 11 025 Hz (filtre passe-bas puis prélèvement).
- **Tempo** : courbe des attaques par bandes de fréquence (la bande grave pèse double, car grosse caisse et basse marquent les temps, les cymbales souvent les croches), autocorrélation, peigne de tempo de 50 à 205 BPM, puis choix du tempo le plus rapide dont la grille tombe sur des attaques aussi fortes (évite les tempos moitié/double), affinage au centième puis recalage par régression sur chaque temps. Tempo arrondi à l'entier quand il en est à moins de 0,3.
- **Premier temps** : le premier temps de la grille où la musique commence vraiment ; si un temps sur quatre se détache nettement (accent), le premier temps de mesure. Remarque : `build.ts` écarte les notes placées avant le premier temps (levée) ; à revoir si besoin lors du rassemblement.
- **Tonalité** : chromagramme (pics du spectre de 60 à 2 000 Hz, chaque trame normalisée), corrélation avec les profils de Krumhansl et Kessler pour les 24 tonalités.
- **Chant** : YIN (65 à 1 100 Hz, 100 mesures par seconde), seuil de silence relatif au niveau du son, erreurs d'octave isolées corrigées, accord global du chanteur estimé puis retiré (un chanteur 35 centièmes trop haut garde les bonnes notes), hauteur lissée sur une période de vibrato, découpe avec hystérésis, début d'un glissé = début de la note, glissés rattachés à la note d'arrivée, notes de moins de ~0,1 s fusionnées ou ignorées, même note répétée séparée par le creux d'énergie, vélocité de 0,2 à 1 selon le niveau par rapport à la note la plus forte (−30 dB → 0).

### Mesures (sons fabriqués dans la QA, VX01-VX12)

| Mesure | Résultat |
|---|---|
| Tempo, 70 à 170 BPM + 75,5 BPM, grosse caisse + charleston ; grosse caisse seule en stéréo | 13/13 à ±1 BPM (écart mesuré 0 en pratique) |
| Premier temps (départ à 0 s, 0,05 s, 0,37 s, 1,1 s, 2,3 s) | à 30 ms près (écart mesuré ~7 ms) |
| Tonalité, 4 majeures et 3 mineures (accords + mélodie) | 7/7 |
| Chant → notes, 7 variantes × 3 mélodies de 18 s (propre, vibrato ±0,5 et ±0,9 demi-ton, désaccord +35 et −40 centièmes, bruit, glissés de 0,15 s) | 100 % des notes retrouvées et justes (au demi-ton, attaque à 100 ms près) ; sur 42 mélodies hors QA : 100 % |
| Chanson de 3 minutes | ~3,5 s de calcul, la page n'est jamais bloquée plus de ~170 ms, 99/100 % |

### Ce qui n'est pas vérifié

- **Pas de vraie voix** : toutes les mesures portent sur une voix synthétique. Une vraie voix (consonnes, souffle, attaques molles, notes très ornées) donnera moins bien ; écoute à l'oreille non faite.
- **Sans séparation des pistes**, sur un morceau avec accompagnement, le suivi monophonique échoue (mesuré : avec des accords, presque aucune note juste ; avec une batterie, beaucoup de notes en trop). Il faut la voix séparée (branche `v20-pistes`) : c'est le parcours prévu, à vérifier une fois les branches rassemblées.
- **Tempo** : vérifié sur des rythmes fabriqués réguliers ; pas sur de vrais morceaux (tempo qui flotte, swing, mesures à 3 temps, morceau sans batterie). Le premier temps de mesure ne se trouve que si un temps est accentué ; sinon c'est le premier temps entendu.
- **Tonalité** : modes autres que majeur/mineur (dorien, blues…) non reconnus ; confusions possibles entre relatives (do majeur / la mineur) sur de vrais morceaux.
- Pas testé sous Windows ni dans la version bureau construite (seulement la version construite servie en local : le Worker y fonctionne).
