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
