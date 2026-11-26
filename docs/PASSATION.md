# Document de passation — KH Music Pro

Rédigé à la fin de la V14a, mis à jour pour la V15.1, la version 0.16.0 en ligne (15/11/2026), puis la V17 (0.17.0, fusionnée dans `main` le 16/11/2026) et la V17.1 (banques expressives, branche `v17-expressive-banks`), pour qu'une nouvelle session (notamment sur le Mac du propriétaire) reparte sans le fil de la conversation d'origine.

## 1. Le projet en une minute

- **But** : un logiciel de création musicale « à la Ableton / Logic / FL Studio », accessible, pour un musicien (beatmaker, enregistrement, mixage, scène).
- **État** : version **0.16.0 en ligne** sur `main` depuis le 15/11/2026 (fusion de la V15, banque de sons, et de la V14b, moteur natif et plugins du Mac : PR #2). 239 cas de QA. Site : https://yankamkevin.github.io/kh-music-pro/ ; installable (PWA) ; installateurs Windows, macOS (Apple et Intel) et Linux dans la release v0.16.0. Installée sur le Mac du propriétaire (`/Applications/KH Music Pro.app`).
- **Dépôt** : `YANKAMKEVIN/kh-music-pro`. `main` = version en ligne. Releases publiées : v0.8.0, v0.10.0, v0.13.0, v0.16.0 à v0.16.2, **v0.17.1** (17/11/2026, la v0.17.0 n'a pas eu de release). Depuis le 17/11/2026, Claude publie la release après chaque fusion dans `main` (CLAUDE.md). Les branches `v14b-prototype-natif`, `v15-banque-generaliste` et `integration-v15-natif` sont fusionnées : tout nouveau travail part de `main`.
- **Prochaine étape** : la V18 (refonte ciblée de l'interface, section 16) sur la branche `v18`, et la séance d'écoute et de jeu du propriétaire (listes en fin de sections 5, 9, 13, 14 et 15). Ses retours passent avant toute nouvelle fonction. La V17 (0.17.0) est en ligne sur `main` (PR #6) ; la V17.1 (0.17.1, sections 14 et 15) attend sur `v17-expressive-banks` (PR #5) : pas de fusion sans son accord.
- **V19 (0.19.0, branche `v19`, 18/11/2026)** : pitch bend, molette et aftertouch ; export d'une plage, 24 bits, 48 kHz ; comping et fondus enchaînés ; sidechain depuis n'importe quelle piste et envois libres ; quantification fine (section 17). L'étude des plugins instruments du Mac attend la décision de Kevin (`docs/etude-au-instruments.md`). Pas de fusion dans `main` sans son accord.
- **Liste des fonctions** : section « Fonctions » du README.

## 2. Architecture

Tout tourne dans le navigateur, y compris dans la version bureau (Electron n'est qu'une fenêtre autour de `dist/`).

| Fichier | Rôle |
|---|---|
| `src/types.ts` | Modèle de données (projet, pistes, clips, notes), catalogue des sons, gammes, tempo, migration des anciens projets |
| `src/store.ts` | État de l'application, annuler/rétablir, bibliothèque de projets (IndexedDB), fichiers `.khm` |
| `src/audio/graph.ts` | Graphe de mixage (`Mix`), instruments, batterie, effets, séquenceur. Le même code sert au temps réel et à l'export |
| `src/audio/engine.ts` | Transport, mode Live, enregistrement, latence, rendu hors-ligne, WAV et MP3 |
| `src/audio/banks.ts` | Instruments enregistrés (`public/banks`, chargés à la demande) |
| `src/audio/wam.ts` | Hôte de plugins web (Web Audio Modules) |
| `src/audio/stretch.ts`, `tune.ts`, `pitch.ts`, `loudness.ts` | Étirement, justesse, détection de hauteur, LUFS et limiteur |
| `src/input.ts` | Jeu en direct : clavier, MIDI, accords, arpégiateur, répétition de notes, assignation MIDI |
| `src/actions.ts` | Toutes les actions de l'utilisateur |
| `src/ui/*` | Arrangement, éditeurs, mixeur, Live, rack d'effets, fenêtres |
| `src/i18n.ts` | Textes en français, anglais, espagnol |
| `electron/main.cjs`, `electron/native-preload.cjs` | Fenêtre de la version bureau ; pont isolé vers le module natif (macOS) |
| `src/audio/au.ts`, `src/audio/native-io.ts`, `src/ui/native.ts` | Plugins Audio Unit du Mac, moteur audio natif et son réglage ; module dans `native/kh-au-bridge` (`npm run native`) |
| `qa/run.cjs` | Campagne de QA ; `qa/desktop-smoke.cjs` pour la version bureau |

Principes à respecter :
- **Pas de framework** : un helper `h()` crée le DOM, tout est redessiné sur `emit()`. `commit()` = enregistrer dans l'historique + redessiner.
- **Unité de temps** : le « pas » = une double-croche. Les notes peuvent avoir des positions fractionnaires (triolets, triples-croches). `BAR` (pas par mesure) suit la signature du projet.
- **Temps réel et export partagent le graphe** : toute nouveauté audio doit marcher dans un `OfflineAudioContext`, sinon l'export diverge de l'écoute.
- **Compatibilité** : tout nouveau champ du projet reçoit une valeur par défaut dans `migrate()` ; un cas de QA (P06) le vérifie.
- **Point d'accès de test** : `window.kh` expose l'état et le moteur pour la QA.

## 3. Ce qui n'a jamais été vérifié

À traiter en priorité lors d'une session sur une vraie machine :

1. **L'écoute** : aucune oreille humaine n'a jugé les sons, les effets, le time-stretch, la correction de justesse ni le limiteur. Tout est validé par mesure (niveau, fréquence, instants).
2. **Le vrai matériel** : micro, carte son et clavier MIDI n'ont été testés qu'en simulé.
3. **Windows et macOS** : les installateurs se construisent ; ceux de Linux et de macOS (puce Apple, avec le module natif) sont lancés automatiquement sur GitHub. La v0.16.0 pour puce Apple est installée et s'ouvre sur le Mac du propriétaire ; personne n'a ouvert le `.exe` ni l'installateur Intel sur une vraie machine.
4. **Un vrai téléphone** : la mise en page tactile est testée dans un navigateur qui simule un écran tactile.
5. **Les plugins web tiers** : essai fait avec l'accord du propriétaire sur huit plugins du paquet npm `wam-community` (version 0.4.9), servis depuis un dossier temporaire, sans les intégrer à l'application.
   - **Fonctionnent entièrement** (chargement, interface, réglages lus, inclus à l'export) : burns-audio *Simple Delay*, *Simple Distortion*, *Simple EQ* ; wimmics *PingPongDelay*, *QuadraFuzz*.
   - **Ne se chargent pas** : wimmics *graphicEqualizer*, *BigMuff*, *SmoothDelay* (plugins construits avec Faust). Ils réclament un fichier absent du paquet lui-même (`utils/sdk-parammgr/src/sdk/src/addFunctionModule.js`) : c'est un défaut de ce paquet, pas de l'hôte. À réessayer depuis leur site d'origine, inaccessible depuis la session cloud.
   - Non vérifié : leur son à l'oreille, les plugins instruments, la version bureau.
6. **La mesure de latence** : le chemin « clic non détecté » est testé ; une mesure réussie demande de vrais haut-parleurs et un vrai micro.
7. **HawkScan** (analyse de sécurité demandée par un hook de session) : jamais lancé, faute de clé API. L'application n'a pas de serveur.

## 4. Limites connues, assumées

- Instruments enregistrés : une seule prise par note (les nuances sont imitées par un filtre, voir section 9), sources d’environ 3 secondes. Le réglage Notes longues prolonge les instruments compatibles par une boucle fondue ; les sons percussifs gardent leur décroissance naturelle.
- Tempo : depuis la V17, un clip audio peut suivre le tempo (réglage « Suit le tempo », désactivé par défaut) ; le mode Live et les effets calés (écho, trémolo) restent au tempo de départ.
- Signature : une seule pour tout le morceau, de 2/4 à 7/4, ou 5/8, 6/8, 7/8, 9/8, 12/8 depuis la section 18. Pas de changement de signature en cours de morceau ; pas de regroupement libre des croches (7/8 compté en croches, pas en 2+2+3).
- Chaîne d'effets : elle s'ajoute après la tranche fixe (filtre, saturation, égaliseur, compresseur) ; huit effets au plus. Depuis la section 19, une tranche peut être convertie en chaîne seule : ses sept étages deviennent des effets (un de chaque au plus, hors de la limite de huit).
- Automation : six réglages de piste (volume, pan, filtre, réverb, écho, chorus) et, depuis la V17, les réglages des effets de la piste (sauf la taille de la réverb d'effet) et des plugins du Mac ; depuis la section 18, l'égaliseur et le seuil du compresseur de la tranche, le filtre et la résonance de l'instrument (lus au départ de chaque note). Depuis la section 20, aussi la fréquence du médium et le taux du compresseur. Restent non automatisables dans la tranche fixe : saturation, lo-fi, trémolo (automatisable une fois la tranche convertie en chaîne), enveloppe et oscillateurs de l'instrument, instruments du Mac.
- Installateurs non signés ; pas de mise à jour automatique.
- Projets stockés dans le navigateur de chaque appareil, avec des versions (V17) ; le fichier `.khm` reste la seule sauvegarde hors de l'appareil. Version bureau Mac : vrais fichiers sur le disque (V17).
- Performance (V17, mesurée) : le moteur audio du navigateur calcule sur un seul cœur ; un projet de 40 pistes et 120 effets le dépasse. Le gel de piste est la parade.

## 5. V14b — prototype natif sur le Mac

### La question à trancher

Peut-on charger un plugin Audio Unit (ou VST3) installé sur le Mac, y faire passer le son d'une piste de KH Music Pro, et l'entendre avec une latence nettement plus faible que dans le navigateur ?

C'est un **prototype**, pas une version : son seul livrable est une réponse chiffrée et une estimation de ce que coûterait la suite.

### Pourquoi c'est difficile

Le moteur audio vit dans le navigateur (Web Audio). Un plugin natif vit dans un processus natif avec son propre fil audio. Il faut donc soit sortir le son du navigateur vers un hôte natif puis l'y ramener, soit déplacer tout le moteur en natif.

### Pistes, de la moins chère à la plus chère

1. **Mesurer d'abord.** Ouvrir la version bureau sur le Mac, fenêtre « Réglages audio » : relever la latence annoncée, puis la mesure réelle par clic. Si elle est déjà sous 15 ms aller-retour avec une bonne carte son, l'argument « latence native » tombe en grande partie.
2. **Hôte natif séparé, relié par un pont audio.** Un petit programme natif (JUCE ou AudioKit/AVAudioEngine en Swift) héberge le plugin ; le son y entre et en sort par des tampons partagés avec l'application. Simple à prototyper avec `AVAudioUnit` en Swift pour les AU. Coût : latence du pont, synchronisation.
3. **Module natif pour Electron** (N-API, C++/JUCE) qui héberge les plugins dans le processus de l'application et échange les blocs audio avec un `AudioWorklet` via `SharedArrayBuffer`. C'est la piste la plus crédible pour garder l'interface actuelle.
4. **Moteur entièrement natif** (JUCE ou Tracktion Engine) avec l'interface web par-dessus. C'est une réécriture : à n'envisager que si 3 échoue et que le bureau devient l'usage principal.

### Déroulement proposé

- **Étape 0** — état des lieux : `xcode-select -p`, version de macOS, puce (Apple ou Intel), `auval -a` pour lister les Audio Units installés, carte son utilisée.
- **Étape 1** — mesure de référence (piste 1) : latence aller-retour de la version actuelle, en ms.
- **Étape 2** — plus petit hôte possible : un outil en ligne de commande en Swift qui charge un AU d'effet par son identifiant, traite un fichier WAV et écrit le résultat. Preuve : le fichier de sortie diffère de l'entrée de la façon attendue.
- **Étape 3** — temps réel : le même hôte branché sur l'entrée et la sortie de la carte son ; mesurer sa latence aller-retour.
- **Étape 4** — pont avec l'application : choisir entre les pistes 2 et 3 selon ce que l'étape 3 a montré, et faire passer le son d'une piste par le plugin.
- **À chaque étape** : noter le résultat chiffré dans ce document, et s'arrêter pour demander l'avis du propriétaire avant la suivante.

### Résultats

**Étape 0 — état des lieux (12/11/2026)**

- Machine : MacBook Pro, Apple M3 (arm64), macOS 26.7 (25G229).
- Outils : Xcode 26.6 (`/Applications/Xcode.app`), Swift 6.3.3, Node 26.9.0, npm 11.19.1.
- Audio Units : seulement ceux d'Apple (23 effets, 3 instruments). Aucun AU ni VST3 tiers installé. Pour les étapes 2 et 3, `AUDelay` (`aufx dely appl`), `AUPeakLimiter` (`aufx lmtr appl`) ou `AUNBandEQ` (`aufx nbeq appl`) suffisent ; un plugin tiers gratuit sera à installer plus tard, avec l'accord du propriétaire, pour valider un cas réel.
- Carte son : pas d'interface audio dédiée. Sortie par défaut : un adaptateur USB « USB-Audio-1.0 » (Yichip, 2 sorties et 1 entrée, 48 kHz). Entrée par défaut : le micro intégré du MacBook Pro. Les haut-parleurs intégrés sont aussi disponibles.
- Conséquence : les mesures de latence (étapes 1 et 3) se feront avec ce matériel grand public. Elles serviront de comparaison entre le navigateur et le natif sur la même machine, mais pas de référence « studio ». L'objectif de 12 ms est à juger avec cette réserve.

**Étape 1 — latence de référence de la version bureau (12/11/2026)**

Version bureau (Electron 45.3) lancée par un script Playwright, qui appelle `engine.latency()` puis cinq fois `engine.measureLatency()` (clic à 2 kHz joué, puis repéré au micro) pour chaque sortie. Entrée : micro intégré, sans annulation d'écho, réduction de bruit ni contrôle de gain. 48 kHz partout.

| Sortie | Latence annoncée (base + sortie + entrée) | Aller-retour mesuré |
|---|---|---|
| Adaptateur USB « USB-Audio-1.0 » (12d1:3a06) | 5,3 + 13,0 + 2,7 = **21 ms** | clic non détecté (5 fois sur 5) |
| Haut-parleurs du MacBook Pro | 5,3 + 28,0 + 2,7 = **36 ms** | **108 à 111 ms** (4 essais sur 5 ; le premier, raté, est le temps que l'entrée se lance) |

Lecture :
- La sortie USB n'est pas entendue par le micro : c'est sans doute un casque ou des écouteurs. C'est le chemin « clic non détecté » prévu, pas une panne. Pour mesurer cette sortie, il faudra un micro qui l'entende.
- Sur les haut-parleurs, le trajet réel est environ **trois fois** ce que le système annonce : il manque environ 73 ms. Ils viennent du traitement des haut-parleurs intégrés et des tampons d'entrée de Chromium, que Web Audio ne déclare pas.
- Le chemin navigateur est donc loin des 12 ms visées (au moins 21 ms annoncées, environ 110 ms réelles sur haut-parleurs). L'argument « latence native » tient. Reste à savoir, à l'étape 3, quelle part de ces 110 ms appartient au matériel (et ne disparaîtra pas en natif).
- Pour refaire la mesure : `npm ci`, puis `node node_modules/electron/install.js` (npm 11 ne télécharge plus Electron tout seul), `npm run build`, et le script décrit ci-dessus (ou la fenêtre « Réglages audio », bouton de mesure).

**Étape 2 — plus petit hôte Audio Unit (12/11/2026)**

Outil en ligne de commande Swift dans `native/au-host` (paquet Swift, aucune dépendance). Il charge un AU par son identifiant (`AVAudioUnit.instantiate`), le branche dans un `AVAudioEngine` en rendu hors-ligne (blocs de 512 échantillons), traite un WAV et en écrit un autre. Il sait aussi lister les paramètres d'un plugin, générer des signaux de test et analyser un fichier (niveau par fréquence, pics).

```
cd native/au-host && swift build -c release
.build/release/au-host params aufx lpas appl
.build/release/au-host gen tones in.wav
.build/release/au-host process aufx lpas appl in.wav out.wav 0=1000
.build/release/au-host analyse out.wav 200 8000
```

| Plugin et réglage | Signal d'entrée | Résultat attendu | Résultat obtenu |
|---|---|---|---|
| AULowpass, coupure 1 kHz | 200 Hz + 8 kHz, chacun à -12 dBFS | 200 Hz intact, 8 kHz fortement atténué | 200 Hz : -11,9 dBFS ; 8 kHz : -49,8 dBFS (**-37,8 dB**) |
| AUDelay, 250 ms, mix 50 %, sans réinjection | impulsion à 0,500 s | impulsion + écho 250 ms plus tard | pics à 0,5000 s et **0,7500 s** |
| AUPeakLimiter, réglages d'usine | impulsion à 0,500 s | décalage égal à la latence déclarée (2 ms) | pic à **0,5020 s** |

Lecture :
- **Preuve faite** : un plugin AU installé sur le Mac traite le son, et le résultat est exactement celui attendu. Le limiteur montre en plus que l'hôte lit la latence déclarée par le plugin (2 ms), ce qu'il faudra compenser plus tard dans le mixage.
- **Coût de calcul négligeable** : 3 s de son traitées en 0,6 à 2,4 ms, soit 1 600 à 5 000 fois le temps réel. Le calcul ne sera pas le facteur limitant ; la latence viendra des tampons et du matériel.
- Limites : seuls des AU d'Apple ont été essayés (aucun plugin tiers installé), sans interface graphique de plugin, et sans VST3.

**Étape 3 — hôte en temps réel sur la carte son (12/11/2026)**

Méthode (`au-host rt`, fichier `native/au-host/Sources/RealTime.swift`) : pour éviter tout larsen au bureau, le micro n'est jamais renvoyé vers les haut-parleurs. Un clic à 2 kHz (6 ms) est produit en temps réel, passe ou non par un AU (AULowpass réglé à 18 kHz), sort sur les haut-parleurs du MacBook au volume laissé bas par le propriétaire, et le micro intégré l'enregistre. Les deux côtés sont datés avec l'horloge de la machine (`mHostTime`) ; l'écart est le trajet réel entre l'instant où le son quitte le logiciel et l'instant où il y revient. L'aller-retour d'une application (entrée → traitement → sortie) ajoute deux tampons. 8 clics par réglage ; le premier est souvent manqué (démarrage de l'entrée).

| Tampon | Latence déclarée par Core Audio | Trajet mesuré (médiane) | Aller-retour d'une appli (mesuré + 2 tampons) |
|---|---|---|---|
| 512 (10,7 ms) | 69,7 ms | 46,4 ms | **67,7 ms** |
| 256 (5,3 ms) | 59,1 ms | 46,4 ms | **57,1 ms** |
| 128 (2,7 ms) | 53,7 ms | 46,3 ms | **51,7 ms** |
| 64 (1,3 ms) | 51,1 ms | 46,5 ms | **49,1 ms** |
| 32 (0,7 ms) | 49,7 ms | 46,4 ms | **47,7 ms** |

- Avec ou sans plugin : aucune différence (écart < 0,2 ms). Écart entre clics : 0,1 à 0,7 ms.
- Détail déclaré, en échantillons à 48 kHz : sortie = appareil 70 + marge 74 + flux **690** ; entrée = marge 50 + flux **1 439**. Le traitement du micro intégré (30 ms) et celui des haut-parleurs intégrés (14 ms) font à eux seuls environ 46 ms, quels que soient le logiciel et le tampon. La mesure le confirme : le trajet reste à 46,4 ms de 512 à 32.

Tenue dans la durée (`au-host stress`) : chaîne de 8 AU d'Apple (NBandEQ → Lowpass → DynamicsProcessor → MatrixReverb → Delay → PeakLimiter → ParametricEQ → Hipass) sur les haut-parleurs, signal inaudible (-100 dBFS), 5 minutes. On compte les surcharges signalées par Core Audio et les trous dans la cadence de rendu.

| Tampon | Surcharges | Trous de rendu |
|---|---|---|
| 64 (1,3 ms) | 2 (une au démarrage, une entre 280 et 310 s) | 1 (9,7 ms) |
| 128 (2,7 ms) | 3 (vers 60, 120 et 270 s) | 3 (le plus long : 15,3 ms) |
| 128, **sans aucun plugin** (contrôle) | 0 | 0 |

- Les décrochages viennent bien de la chaîne de plugins, pas du système ni de l'hôte : sans plugin, 5 minutes parfaitement propres. Ils ne dépendent pas de la taille du tampon (plutôt plus nombreux à 128 qu'à 64), donc ce n'est pas un manque de puissance : 8 AU d'Apple sont très légers pour un M3. Hypothèse la plus probable : un plugin qui fait de temps en temps un travail lourd ou une allocation dans le fil audio (`AUMatrixReverb`, ancien, est le premier suspect). À vérifier en retirant les plugins un par un.
- Le critère « sans craquement pendant 5 minutes » n'est donc **pas encore rempli** avec cette chaîne ; il l'est sans plugin.

Lecture :
- **En natif, sur le même matériel, l'aller-retour tombe d'environ 110 ms (navigateur, étape 1) à environ 50 ms.** Le natif gagne donc environ 60 ms.
- **L'objectif de 12 ms est impossible avec le micro et les haut-parleurs intégrés**, quel que soit le logiciel : environ 46 ms sont dans le matériel et ses pilotes. Le critère « < 12 ms » ne peut se juger qu'avec une interface audio (ou un casque-micro USB), qui n'a pas ces traitements.
- La sortie USB (Yichip) déclare 13 ms de sortie côté navigateur, contre 28 ms pour les haut-parleurs : c'est sur ce genre de matériel que l'écart entre navigateur et natif deviendra décisif. Mesure à refaire avec un micro qui l'entend, ou avec une interface qui a une boucle de retour.

**Étape 4 — pont avec l'application (12/11/2026)**

Choix : **piste 3**, un module natif chargé dans la version bureau. L'étape 3 a montré que le plugin lui-même ne coûte rien en latence ni en calcul ; tout se joue sur le pont, et un pont dans le même processus, par mémoire partagée, est le seul qui puisse ne rien ajouter.

Fonctionnement :
- `native/kh-au-bridge` : module Node natif (Objective-C++, ~200 lignes), construit contre les en-têtes d'Electron 45. Il crée l'Audio Unit et un fil à priorité temps réel qui le fait tourner. API : `open`, `setParam`, `info`, `close`, `list`.
- `src/audio/au.ts` : un AudioWorklet écrit chaque bloc de 128 échantillons dans un `SharedArrayBuffer`, signale la demande, et attend la réponse du fil natif **dans le même bloc**. Le pont n'ajoute donc aucun retard. Si le natif ne répond pas en 3 ms, le bloc passe tel quel et il est compté comme manqué.
- Vu du mixeur, un Audio Unit est un effet de la chaîne comme un plugin web : type `au`, `url: 'aufx:lpas:appl'`, paramètres par adresse dans `p`. Il prend la même place (`attachWam`, `loadWams`) et sert donc à l'écoute **et** à l'export, comme l'exige le principe « temps réel et export partagent le graphe ». Les instances créées pour un export sont libérées ensuite (`disposePlugins`).
- Activé seulement par `KH_NATIVE=1` sur macOS : la fenêtre sort alors du bac à sable pour le script de préchargement (`electron/native-preload.cjs`), coupe l'isolation de contexte et active `SharedArrayBuffer`. La page n'a toujours pas accès à `require`. Sans cette variable, rien ne change. Ce réglage est à revoir avant toute version publiée (Electron affiche d'ailleurs son avertissement de sécurité dans ce mode).
- **Aucun moteur de mixage dupliqué** : Web Audio mixe toujours ; le natif ne fait que les plugins. Le critère d'arrêt n'est pas atteint.

Pour essayer :

```
npm run build
cd native/kh-au-bridge && npx node-gyp@11 rebuild --target=45.3.0 --arch=arm64 --dist-url=https://electronjs.org/headers && cd ../..
node qa/au-bridge.cjs 300        # vérifications automatiques, temps réel sans sortie audio
KH_NATIVE=1 npx electron .       # l'application, avec le pont
```

Résultats (`qa/au-bridge.cjs`) :

| Vérification | Résultat |
|---|---|
| Pont chargé, 23 Audio Units listés, page toujours sans `require` | oui |
| AULowpass 1 kHz sur 200 Hz + 8 kHz (rendu hors-ligne) | 200 Hz : -11,9 dBFS ; 8 kHz : -49,8 dBFS, comme l'hôte Swift |
| Retard ajouté par le pont (impulsion, passe-bas ouvert) | **0 échantillon** |
| AUPeakLimiter | décalage de 96 échantillons = sa latence déclarée (2 ms) |
| AUDelay 250 ms | écho à 36 001 (attendu 36 000 ± 1, même écart dans l'hôte Swift) |
| Vraie piste du projet de démo, à l'export, avec AULowpass 300 Hz | aigus de -29,2 à -51,4 dB ; aucun échec |
| Vraie piste (« Basse »), rendu sans plugin refait deux fois | identique (-54,3 / -54,3 dB) |
| Même piste à l'export avec AULowpass 300 Hz | aigus de -54,3 à -63,5 dB ; aucun échec |
| Lecture en boucle de la démo à travers le plugin, 5 minutes | **113 411 blocs, 0 manqué**, aucune erreur ni plantage |

Le temps réel a tourné avec la sortie audio coupée (`setSinkId({ type: 'none' })`), pour ne rien jouer au bureau : la cadence est alors donnée par une horloge logicielle, pas par la carte son. L'attente du worklet est restée très courte (au plus environ 30 000 tours de boucle par bloc, sans jamais toucher la limite de 3 ms).

Ce que les essais ont appris en route :
- Fenêtre cachée : Chromium ralentit une page en arrière-plan, et avec la sortie coupée, l'horloge audio ralentit avec elle (5 minutes devenues 26, 8 327 blocs au lieu de 113 000). Le mode natif désactive donc ce ralentissement (`backgroundThrottling: false`), ce qui est de toute façon souhaitable pour une application audio.
- Un premier essai s'est arrêté vers 4 min 30 sans rapport de plantage macOS ; l'essai surveillé suivant (fermeture de fenêtre, plantage de page, fin du processus) n'a rien montré d'anormal. Cause non établie ; fermeture manuelle de la fenêtre possible.
- Les projets de la version bureau sont enregistrés : les premiers essais avaient laissé deux effets `au` dans le projet de démo du profil de développement (nettoyés depuis). Le test utilise désormais un profil temporaire (`--user-data-dir`).
- Sans le pont (version normale), un effet `au` ne se charge pas et le son passe tel quel, comme un plugin web absent.

Non-régression de la version normale (13/11/2026, sur ce Mac) : `qa/desktop-smoke.cjs` OK ; campagne `qa/run.cjs` : 188/190. Les deux échecs ne viennent pas de V14b :
- **DK01** appelle `xvfb-run`, qui n'existe que sous Linux : ce cas ne peut pas tourner sur un Mac (le test de la version bureau, lancé directement, passe).
- **RI05** (pad 4 de la batterie acoustique « identique au son synthétisé ») était **instable** : il échouait aussi sur `main` sans les changements de V14b (1 réussite sur 3), car les deux sons ont presque le même niveau. **Corrigé le 14/11/2026** : un son compte comme différent si son niveau **ou** son timbre (part d'aigus) s'écarte de plus de 3 %. 4 réussites sur 4. Campagne complète du 14/11 : 189/191 ; DK01 (Linux seulement) et T01, qui a échoué une fois (premier cas de la campagne, Mac chargé, niveau nul) puis réussi 3 fois sur 3. Seconde campagne (après la réserve à 16 ms) : 189/191, DK01 et **TU02** (accordeur, attente fixe de 300 ms trop courte quand le Mac est chargé) ; TU02 attend désormais l'accordeur jusqu'à 3 s, 4 réussites sur 4.
- Sur un Mac neuf, il faut d'abord `npx playwright install chromium`.

Lecture :
- **On sait maintenant faire passer le son d'une piste de KH Music Pro dans un plugin Audio Unit du Mac**, à l'écoute comme à l'export, sans retard ajouté par le pont.
- **Ce pont ne réduit pas la latence de l'application** : le son entre et sort toujours par Web Audio (environ 110 ms aller-retour sur les haut-parleurs, étape 1). Il apporte l'accès aux plugins du Mac, pas la faible latence.
- Pour gagner aussi la latence (environ 50 ms au lieu de 110 sur ce matériel, étape 3), il faudrait que le natif prenne aussi l'entrée et la sortie de la carte son, Web Audio ne faisant plus que le calcul du mixage. C'est faisable sans dupliquer le mixage, mais demande de caler deux horloges (Web Audio et carte son) : c'est la prochaine étape possible.

**Étape 5 — entrée et sortie de la carte son par le natif (13/11/2026)**

But : en mode `KH_NATIVE=1`, Web Audio ne fait plus que calculer le mixage ; le natif sort le son vers la carte son et capte le micro. **Le mixage n'est pas dupliqué** : il reste entièrement dans Web Audio, le natif ne fait que transporter le son (et les plugins AU de l'étape 4).

Fonctionnement :
- `native/kh-au-bridge/src/io.mm` (~400 lignes, même module) : deux unités Core Audio (`AUHAL`), une pour la sortie choisie, une pour l'entrée choisie (elles peuvent être deux appareils, donc deux horloges). API : `ioStart`, `ioStop`, `ioStats`, `ioArm` (mesure), `ioGain`, `ioDevices`.
- `src/audio/native-io.ts` : en fin de chaîne, le limiteur du général ne va plus vers la sortie du navigateur mais vers un AudioWorklet (`kh-out`) qui écrit chaque bloc dans un tampon circulaire partagé (`SharedArrayBuffer`) ; le fil de la carte son le lit. En sens inverse, le natif écrit le micro dans un second tampon, qu'un AudioWorklet (`kh-in`) relit comme une source : l'enregistrement, le vumètre, l'accordeur et la mesure de latence s'en servent sans changement.
- `engine.useNative()` est appelé au démarrage dès que le module est là. `engine.out` remplace `ctx.destination` partout. Le choix de la sortie (Réglages audio) et de l'entrée passe au natif par le nom de l'appareil. La compensation d'enregistrement utilise les latences du chemin natif.
- **Calage des horloges** : chaque tampon a un niveau cible ; le natif mesure le niveau (moyenne sur 0,5 s) et lit ou écrit à un rapport 1 ± 0,3 % au plus (régulateur proportionnel + intégral, interpolation cubique) pour y rester. Mesuré : 0 à ±20 ppm quand Web Audio et la sortie suivent la même horloge.
- Sans le module (version web, ou bureau sans `KH_NATIVE`), rien ne change : nouveau cas de QA **LAT03**.

Ce que les essais ont appris (choix de l'horloge de Web Audio) :
- **Piste envisagée, `setSinkId({ type: 'none' })`, écartée** : sans sortie, Chromium cadence le calcul avec une horloge logicielle qui livre les blocs par paquets (le tampon oscille sur ~650 échantillons) et s'arrête parfois plus de 20 ms (environ une fois par minute). Il fallait plus de 1 024 échantillons (21 ms) de réserve, et même ainsi un manque est apparu au bout de 98 s.
- **Retenu** : Web Audio garde comme sortie le même appareil que le natif, mais n'y envoie qu'un signal infime (-180 dB, sinon Chromium repasse sur son horloge logicielle après un silence). Son calcul est alors cadencé par la carte son elle-même : le tampon n'oscille plus que d'un bloc (128 échantillons), sans aucun arrêt, et les deux côtés ont la même horloge. Ce n'est pas un changement d'architecture : Web Audio ne fait toujours que le calcul.
- Niveau cible : 384 échantillons (8 ms) en sortie, 256 (5,3 ms) en entrée. À 256 en sortie, le résultat dépend de l'ordre dans lequel les fils de Chromium et du natif se réveillent à chaque cycle : parfois aucun manque en 2 minutes, parfois des centaines en 5 minutes. 384 garde une marge dans les deux cas.

Pour essayer :

```
npm run build
cd native/kh-au-bridge && npx node-gyp@11 rebuild --target=45.3.0 --arch=arm64 --dist-url=https://electronjs.org/headers && cd ../..
node qa/native-io.cjs 300            # tenue de 5 minutes, rien ne s'entend (-100 dB)
node qa/native-io.cjs 5 --mesure     # clics courts sur les haut-parleurs du Mac, micro intégré
KH_NATIVE=1 npx electron .           # l'application, son par le natif
```

Tenue (`qa/native-io.cjs 300`) : démo en boucle, haut-parleurs du Mac à -100 dB (inaudible), micro ouvert sans écoute de contrôle.

| Vérification | Résultat |
|---|---|
| Natif démarré avec l'application, mixage envoyé au natif, page sans `require` | oui |
| 5 minutes de lecture | 113 851 blocs de Web Audio |
| Manques à la carte son / surcharges Core Audio / trous de rendu | **0 / 0 / 0** |
| Blocs perdus entre Web Audio et le natif (sortie, entrée) | **0 / 0** |
| Niveau des tampons (sortie, entrée) | 311 à 470 (cible 384), 182 et plus (cible 256) |
| Écart d'horloge corrigé | ±2 ppm |

Aller-retour (`qa/native-io.cjs 5 --mesure`), même méthode qu'aux étapes 1 et 3 : clic à 2 kHz de 6 ms, haut-parleurs du Mac au volume laissé bas, micro intégré, jamais de micro vers les haut-parleurs. Deux séries de 6 clics, tous entendus ; le premier de chaque série sert de démarrage.

| Mesure | Résultat (médiane) | Comparaison |
|---|---|---|
| Aller-retour dans l'application (clic joué par Web Audio, retrouvé dans le son du micro reçu par Web Audio : la mesure de l'étape 1) | **68,6 et 69,6 ms** (écart entre clics < 1,5 ms) | navigateur seul (étape 1) : 108 à 111 ms ; natif seul (étape 3) : ~50 ms |
| Trajet natif, du son qui quitte le logiciel au son qui revient du micro (horloge de la machine, comme à l'étape 3) | **46,3 ms** | étape 3 : 46,4 ms |
| Part des deux tampons partagés et du calcul de Web Audio | ~23 ms | tampons 8 + 5,3 ms, tampons de la carte son 2 × 2,7 ms, le reste dans le cycle de Web Audio |

Lecture :
- **La version bureau passe d'environ 110 ms à environ 69 ms d'aller-retour** sur ce matériel, sans craquement pendant 5 minutes et sans dupliquer le mixage. Elle gagne donc environ 40 ms sur les 60 que le natif seul pouvait gagner.
- Les ~20 ms qui restent par rapport au natif seul sont le prix du pont : deux tampons partagés (13 ms) et le cycle de Web Audio. On pourrait en reprendre quelques-unes (cible d'entrée plus basse, tampon de la carte son à 64), au prix de la marge.
- **L'objectif de 12 ms reste impossible avec le micro et les haut-parleurs intégrés** (46 ms de matériel, étape 3). Avec une interface audio, le même chemin donnerait environ 23 ms + la latence de l'interface : en dessous de 30 ms, toujours au-dessus de 12. Pour descendre sous 12 ms, il faudrait réduire les tampons partagés à un bloc, donc faire calculer Web Audio au rythme exact du natif : ce n'est pas possible avec Web Audio tel qu'il est.
- Non vérifié : l'écoute à l'oreille (tenue à -100 dB pour ne rien faire entendre au bureau), l'enregistrement d'une vraie prise par ce chemin, un appareil de sortie différent de l'entrée avec une vraie dérive d'horloge (la sortie USB n'était plus branchée pendant les essais), et le changement d'appareil en cours de lecture (il coupe le son un instant : quelques blocs manqués, attendus).
- Non-régression (13/11/2026, sur ce Mac) : `qa/au-bridge.cjs` (étape 4) OK par le nouveau chemin, sortie native à zéro ; `qa/desktop-smoke.cjs` OK ; campagne `qa/run.cjs` : 190/191, seul échec DK01 (Linux seulement, connu). RI05 est passé cette fois.

**Séance d'écoute par le propriétaire (13/11/2026)**

Application lancée en mode natif sur le profil normal par `qa/ecoute-native.cjs`, qui relève toutes les 5 s les incidents du chemin natif. Haut-parleurs et micro intégrés. Mac en usage normal : application Claude, Chrome et correcteur orthographique actifs (charge moyenne environ 4).

- Durée : 2 h 34 d'application ouverte, dont environ 12 minutes de lecture (de 2 à 14 min), le reste à l'arrêt.
- **À l'oreille : craquements entendus** par le propriétaire.
- Relevé : **162 manques** à la carte son, **139 surcharges** Core Audio, **135 trous** de rendu (le plus long : 56 ms), 1 bloc perdu entre Web Audio et le natif. La plupart sont groupés entre la 10ᵉ et la 70ᵉ minute (72 manques entre 10 et 20 min, en pleine lecture) ; presque rien après la 100ᵉ.
- **Les incidents arrivent aussi à l'arrêt.** Ils ne viennent donc pas de la charge de calcul de la démo, mais du rythme des fils audio. Pendant les incidents, le niveau du tampon de sortie saute (jusqu'à 7 106 échantillons au lieu de 384) et le calage d'horloge part en butée (±3 000 ppm) : Web Audio livre ses blocs par à-coups, puis rattrape.
- Le pré-essai de 30 s du même jour avait déjà eu 12 manques et 2 surcharges ; le suivant, de 60 s, était propre. Les tenues de 5 minutes de l'étape 5 avaient été faites sur une machine plus calme.
- **Pas de prise par ce chemin** : le son du micro n'a jamais été lu par l'application pendant la séance. L'enregistrement réel reste à faire.
- **Défaut découvert** : en mode natif, le micro est capté en permanence, même sans enregistrer (pastille orange du Mac allumée tout le temps ; environ 375 blocs d'entrée par seconde jetés faute de lecteur). À corriger avant toute intégration : n'ouvrir l'entrée native que quand l'application en a besoin.

Lecture :
- **Le chemin natif de l'étape 5 n'est pas fiable en usage réel** : il tient sur une machine calme, pas sur un Mac occupé à autre chose. C'est le contraire de ce qu'on attend d'un chemin « plus professionnel ».
- Cause non établie. Trois suspects, à départager en reproduisant sous une charge contrôlée : (1) le fil de calcul de Web Audio (Chromium), retardé par la charge, avec seulement 8 ms de réserve dans le tampon partagé ; (2) le fil natif lui-même ; (3) deux programmes qui se partagent le même appareil de sortie (Web Audio y envoie son signal infime pour garder l'horloge de la carte son). Une comparaison sous la même charge du navigateur seul, de l'hôte natif seul (`au-host rt`, étape 3) et du chemin de l'étape 5 dirait lequel décroche.

**Recherche de la cause des craquements (13 et 14/11/2026)**

Charge contrôlée : 8 processus `yes` occupent les 8 cœurs du M3 à 100 % pendant la mesure. Tout est inaudible (-100 dB).

| Essai | Résultat |
|---|---|
| Natif seul (`au-host stress 60 128 0`), 60 s sous charge | 2 surcharges, 1 trou (6 ms), toutes dans les 30 premières secondes |
| Chemin de l'étape 5, 60 s sous charge (premier essai) | **16 manques**, 1 surcharge ; le tampon de sortie tombe à 22 puis remonte à 1 928 : Web Audio s'est arrêté environ 40 ms, puis a rattrapé |
| Navigateur seul (version normale, compteur `playbackStats` de Chromium), 2 × 60 s sous charge | 1 coupure par essai (12 et 18 ms) |
| Étape 5 + calcul audio du navigateur en priorité temps réel (`KH_RT=1`), 2 × 60 s sous charge | 0 / 0 / 0, tampon jamais sous 311 |
| Même chose, 5 min sous charge | propre 2 min 30, puis 5 surcharges et 1 manque |
| Série alternée, 3 × 2 min sans et avec `KH_RT=1`, sous charge | **tout à 0**, dans les deux cas |
| Fenêtre réduite dans le Dock (`--reduite`), 2 min sans et avec `KH_RT=1` | 0 / 0 / 0 dans les deux cas |
| 30 min la nuit, fenêtre réduite, sans `KH_RT`, avec témoin du navigateur | natif : 2 manques ; **témoin navigateur : 2 coupures au même instant** (1 411 s) |

Le « témoin » : pendant une tenue de l'étape 5, Web Audio envoie toujours son signal infime à la sortie du navigateur (c'est ce qui cadence son calcul) ; Chromium compte les coupures de cette sortie (`ctx.playbackStats`). Les deux chemins subissent donc exactement les mêmes épisodes ; on peut voir lequel craque.

Lecture :
- **Ni la charge de calcul, ni la fenêtre cachée ne reproduisent les craquements de façon fiable.** Ils arrivent par épisodes ; entre deux épisodes, les deux chemins tiennent sans faute, même sous pleine charge.
- **Pendant un épisode, le navigateur décroche aussi** (nuit du 13 au 14 : 2 manques natifs, 2 coupures du navigateur, au même moment). Sur une machine au calme, le chemin natif n'est donc pas plus fragile que le navigateur.
- Les ~160 incidents de la séance d'écoute viennent de ce que faisait le Mac à ce moment-là (usage réel du propriétaire), qu'aucune charge artificielle n'a reproduit. Il reste à savoir si, dans ces conditions, le navigateur craquait autant que le natif : c'est ce que dira une seconde séance avec le témoin.
- Priorité temps réel (`KH_RT=1`, réglage Chromium `AudioWorkletRealtimeThread`) : un seul essai montre un effet net (16 manques sans, 0 avec), les autres sont propres dans les deux cas. Effet possible, pas démontré. Le réglage reste une option d'essai, désactivée par défaut.

Outils ajoutés : `qa/native-io.cjs --reduite` (fenêtre réduite) et le témoin dans son relevé ; `qa/ecoute-native.cjs` relève aussi le témoin ; `KH_RT=1` dans `electron/main.cjs` (mode natif seulement).

**Seconde séance avec le témoin (14/11/2026, `KH_RT=1 node qa/ecoute-native.cjs`)** — premières 2 h 27, application **à l'arrêt** (propriétaire absent), Mac en usage ordinaire (télévision et autres appareils dans la pièce, sans effet sur ces compteurs qui mesurent le rythme de l'ordinateur, pas le son capté).

| Tranche | Manques natifs | Surcharges Core Audio | Coupures du navigateur (témoin) |
|---|---|---|---|
| 0-90 min | 11 | 28 | 16 |
| 90-105 min | **20** | 6 | 3 |
| 105-147 min | 3 | 5 | 3 |
| **Total** | **34** | **39** | **22** |

- La plupart des incidents tombent **au même instant sur les deux chemins** : le Mac a des « hoquets » toutes les 5 à 7 minutes environ, qui touchent aussi le navigateur. La sortie normale du navigateur craquerait donc, elle aussi, sur ce Mac.
- Le natif a en plus deux rafales qui lui sont propres (vers 71 min et de 99 min 43 à 100 min 08 : 19 manques en 25 s, 1 seule coupure du navigateur). La réserve de 8 ms est trop juste pour les hoquets les plus longs, que les tampons plus grands du navigateur encaissent.
- Une campagne de QA complète a tourné pendant la séance (à partir de 147 min), comme charge supplémentaire.

Lecture : les craquements ont deux sources. (1) Des hoquets du Mac, communs aux deux chemins, que le chemin natif ne peut pas supprimer. (2) Une réserve trop juste dans le chemin natif. Remède proposé pour (2) : passer la réserve de sortie de 384 à 768 échantillons (8 → 16 ms), soit environ 77 ms d'aller-retour au lieu de 69 (le navigateur : 110), puis refaire une séance avec le témoin.

Prochaine mesure proposée (faite ci-dessus, à l'arrêt seulement) : une seconde séance d'usage réel (`KH_RT=1 node qa/ecoute-native.cjs`), où le propriétaire écoute et travaille comme d'habitude. Si le témoin craque autant que le natif, les craquements viennent du Mac et pas du chemin natif ; s'il reste propre, la réserve de 8 ms du chemin natif est trop juste pour l'usage réel (la passer à 16 ou 21 ms coûterait autant de millisecondes de latence).

**Réserve de sortie à 16 ms (14/11/2026)** — `OUT_TARGET` passe de 384 à 768 échantillons dans `src/audio/native-io.ts` (seul le mode natif est concerné). La séance précédente a été arrêtée à 163 min, toujours à l'arrêt.

| Vérification | Résultat |
|---|---|
| Tenue de 60 s (`KH_RT=1 node qa/native-io.cjs 60`) | **0 manque** ; 3 surcharges Core Audio au moment d'une coupure du témoin (hoquet du Mac, commun aux deux chemins) |
| Aller-retour (`--mesure`, 6 clics) | **75,4 ms** (médiane ; écart entre clics < 2,5 ms) ; trajet natif 46,1 ms ; part des tampons et de Web Audio 29,3 ms |

- La version bureau en mode natif passe donc de 69 à 75 ms d'aller-retour, contre 110 ms pour le navigateur seul.
- Troisième séance lancée ensuite avec cette réserve (`KH_RT=1 node qa/ecoute-native.cjs`), pour l'écoute et la vraie prise du propriétaire.

**Troisième séance, avec le propriétaire (14/11/2026, 68 min)** — écoute aux EarPods (USB) puis vraie prise.

- **La prise s'est bien passée** (avis du propriétaire) : enregistrement par le micro du Mac, en écoutant aux EarPods.
- Quatre défauts du mode natif découverts en usage réel :
  1. **Écouteurs branchés, son toujours dans les haut-parleurs** : le natif choisissait sa sortie au démarrage et ne suivait pas la sortie du système. Il fallait la choisir à la main (🔧).
  2. **Micro des EarPods muet** : les EarPods tournent à 44,1 kHz, l'application à 48 kHz. Pour la sortie, Core Audio convertit, mais pas pour l'entrée : aucun son ne sortait du micro.
  3. **Écouteurs débranchés en cours de lecture : application bloquée.** Le contexte Web Audio signale une erreur d'appareil, le natif reste accroché à l'appareil disparu, plus rien n'avance.
  4. **Micro capté en permanence** (défaut déjà noté).
- Une sourdine de macOS sur les EarPods a fait croire un moment que le son ne sortait plus : ce n'était pas l'application.

**Corrections (14/11/2026)**

- **Micro à la demande** : le natif démarre sans entrée ; `ioInput(nom | null)` ouvre ou ferme l'entrée seule, sans toucher à la sortie. `engine.openInput` l'ouvre, `closeInput` la referme (pastille orange éteinte quand l'application n'écoute pas le micro).
- **Micro à une autre fréquence** : l'entrée est ouverte à la fréquence propre de l'appareil, et le natif la rééchantillonne vers celle de Web Audio (le régulateur existant, multiplié par le rapport des fréquences). Latences déclarées divisées par la fréquence de chaque appareil.
- **Quand la sortie n'est pas à la fréquence de Web Audio** (EarPods), Chromium livre ses blocs par paquets d'environ 250 échantillons : la réserve d'entrée passe alors de 256 à 512 échantillons (256 vidait le tampon une fois toutes les 8 s environ ; 512 : aucun manque).
- **Suivi des appareils** : le natif écoute Core Audio (sortie ou entrée du système changée, appareil débranché) et compte ces événements (`devEvents`). La page les surveille et redémarre le natif. Si l'appareil choisi a disparu, elle se rabat sur celui du système, rouvre la sortie de Chromium qui cadence Web Audio, et affiche « Appareil audio changé, le son passe maintenant par : … » (trois langues). L'erreur du contexte Web Audio déclenche le même rétablissement.

Vérifications (`qa/native-io.cjs`, nouvelles étapes) :

| Vérification | Résultat |
|---|---|
| Au démarrage, micro non capté (aucun appel d'entrée en 0,8 s) | oui |
| Micro ouvert à la demande, puis refermé ; sortie jamais redémarrée, 0 manque pendant ce temps | oui |
| Sortie choisie disparue : rabattu sur « Haut-parleurs MacBook Pro », message affiché | oui |
| Micro à 48 kHz dans un contexte à 44,1 kHz, 8 s | 2 756 blocs (le bon rythme), 0 manque, tampon stable (min 301 pour 512) |
| Tenue de 60 s | 0 manque, 0 surcharge, témoin du navigateur 0 |
| Aller-retour (`--mesure`) | 73,7 ms, 6 clics sur 6 |
| `qa/au-bridge.cjs`, `qa/desktop-smoke.cjs` | OK |
| Campagne `qa/run.cjs` | 190/191 (DK01, Linux seulement) |

Non vérifié : le vrai débranchement et le vrai branchement d'écouteurs (le rabattement est testé en simulant un appareil disparu ; les événements de Core Audio et la reprise du contexte Web Audio après erreur ne peuvent être provoqués que par le propriétaire), et le micro des EarPods lui-même (testé à fréquences inversées, micro du Mac à 48 kHz dans un contexte à 44,1 kHz).

**Essais du propriétaire après corrections (14/11/2026)**

- **Micro à la demande, confirmé en vrai** : le micro du Mac s'ouvre pour la prise, puis se referme seul après « Prise enregistrée ». À l'ouverture du micro intégré, un manque natif et une rafale de 13 coupures du navigateur au même instant : ouvrir le micro intégré secoue brièvement la sortie intégrée du Mac (à confirmer).
- **Application lancée avec les EarPods branchés** : elle démarre directement sur eux (sortie 44,1 kHz, réserve d'entrée 512 automatiquement).
- **Débranchement en pleine lecture** : le son passe sur les haut-parleurs du Mac, message affiché, aucun blocage. **Rebranchement** : le son revient dans les EarPods, message affiché. Le propriétaire entend une coupure d'environ une seconde à chaque changement (attente de 300 ms après le dernier événement de Core Audio, guet toutes les 400 ms, puis réouverture des deux sorties) : à raccourcir.
- **Micro des EarPods : pas encore essayé** après la correction (le propriétaire n'a pas refait de prise ; ses prises précédentes passaient par le micro du Mac).

**Coupure au changement d'appareil raccourcie (14/11/2026)** — guet toutes les 100 ms au lieu de 400, attente de 120 ms au lieu de 300 après le dernier événement de Core Audio, et plus de double démarrage de la sortie sur un appareil à 44,1 kHz : la réserve d'entrée est ajustée en rouvrant seulement l'entrée (`ioInput(nom, réserve)`), et seulement si elle est ouverte. Rétablissement mesuré (appareil disparu simulé) : **134 ms**, contre environ une seconde entendue avant. Le vrai branchement reste à réécouter par le propriétaire. Tenues de 30 s faites pendant une compilation Gradle d'un autre projet (charge 7,8) : ratés natifs **et** coupures du navigateur aux mêmes instants (jusqu'à 17), c'est-à-dire les hoquets du Mac déjà connus. QA : 190/191 (DK01, Linux) ; `qa/au-bridge.cjs` OK.

**Réécoute par le propriétaire (15/11/2026)** — branchements et débranchements des EarPods en pleine lecture : le son suit à chaque fois, message affiché, et **« la coupure est beaucoup plus courte »**. Le **micro des EarPods** s'ouvre maintenant (entrée « Micro EarPods », tampon d'entrée à 472 pour une réserve de 512 sur une sortie à 44,1 kHz) ; la qualité d'une prise par ce micro reste à écouter.

**Intégration dans l'interface de la version bureau (15/11/2026, version 0.15.0)**

Le prototype ne s'activait qu'avec `KH_NATIVE=1`. Il est maintenant dans l'application, pour le propriétaire comme pour un utilisateur de l'installateur macOS.

Ce que voit l'utilisateur (version bureau sur Mac, module natif présent ; ailleurs, rien ne change) :
- **🔧 Réglages audio → « ⚡ Moteur audio natif »** : interrupteur (rôle `switch`, clavier et doigt), **désactivé par défaut** (activé par défaut depuis la décision de Kevin du 21/11/2026, section 18), choix retenu sur l'appareil (`localStorage` `kh-native`). La bascule se fait sans redémarrer : `engine.useNative()` / `engine.stopNative()` (nouveau), l'entrée ouverte est rouverte sur le nouveau chemin. La ligne de latence indique le chemin (« chemin natif » ou « navigateur »). En cas d'échec : message dans les réglages (`role=alert`) et à l'écran, et retour automatique au navigateur sur la sortie choisie. Code : `src/ui/native.ts`, `src/ui/audio.ts`.
- **Chaîne d'effets → groupe « 🍎 Plugins du Mac »** : les Audio Units d'effet installés (`list`, type `aufx`), triés, nom court (« Apple: AUDelay » → « Delay »). Une fois ajouté, un curseur par réglage, lu dans le plugin (nouvelle fonction native `params` : adresse, nom, bornes, valeur par défaut et actuelle, unité Core Audio), affiché avec son unité (Hz, dB, %, s…), bouton « Réglages d'origine ». Les réglages sont enregistrés dans le projet (`p`, par adresse), annulables, et appliqués au plugin en direct (`AuInstance.apply`) comme à l'export. Les plugins du Mac marchent **même avec le moteur natif désactivé** : ils n'ont besoin que du module. Projet ouvert ailleurs (site, Windows) : mention « Plugin du Mac indisponible ici », le son passe tel quel, sans message d'erreur. Fenêtres graphiques des plugins : non reprises (curseurs génériques seulement).

Sécurité de la fenêtre (solution publiable) :
- **L'isolation de contexte reste active** ; la page n'a ni `require`, ni `process`, ni `module`. Le préchargement (`electron/native-preload.cjs`) expose par `contextBridge` une liste fermée de fonctions, avec contrôle du type des arguments.
- La mémoire partagée (`SharedArrayBuffer`) **ne traverse pas `contextBridge`** (« An object could not be cloned », essayé). Contournement : la page la confie une fois par `window.postMessage({ khSab, key })`, le préchargement la garde sous cette clé et répond `{ khSabOk: key }` (`shareSab` dans `src/audio/au.ts`) ; les fonctions du pont reçoivent ensuite la clé (`open(key, …)`, `ioStart(key, …)`, `forget(key)`). Vérifié : une valeur écrite d'un côté est lue de l'autre (même processus, mémoire réellement partagée), et les mesures de l'étape 4 sont inchangées (0 échantillon de retard, 0 bloc manqué).
- Seul le **bac à sable du préchargement** reste coupé (`sandbox: false`) : un préchargement en bac à sable ne peut pas charger de module natif. C'est la configuration habituelle d'une application Electron avec module natif ; la page, elle, reste isolée. Le préchargement n'est chargé que si le module existe (`electron/main.cjs`, chemin passé par `--kh-native=`). L'avertissement d'Electron sur l'isolation a disparu ; reste celui sur l'absence de règle de contenu (CSP), qui existait déjà dans la version normale (voir suite).
- `KH_NATIVE=0` fait comme si le module était absent ; `KH_NATIVE=1` allume le moteur natif au démarrage sans passer par le réglage (scripts de vérification). `KH_RT=1` inchangé.

Empaquetage :
- `npm run native` (`scripts/build-native.sh`) construit le module pour les puces Apple **et** Intel, les réunit en un seul fichier (`lipo`) et le signe « ad hoc » (obligatoire sur puce Apple). Le code d'attente active n'utilise plus d'instruction propre à la puce Apple (`pause()`).
- electron-builder le range dans `Contents/Resources/native/kh_au_bridge.node` (`build.mac.extraResources`), hors de l'archive de l'application.
- GitHub (action « Version bureau ») : construction du module, puis `qa/packaged-mac.cjs` lance **l'application empaquetée** et vérifie module, isolation, AULowpass exact et bascule du moteur natif. Première exécution verte (le moteur natif y démarre sur « Apple Virtual Sound Device »). L'action se relance aussi quand le module, le script ou `package.json` changent.

Vérifications :

| Vérification | Résultat |
|---|---|
| `qa/au-bridge.cjs` : pont isolé, réglages d'AULowpass lus, 23 plugins proposés, « Delay » ajouté par l'interface, curseur « Delay Time » appliqué au vrai plugin | OK |
| `qa/native-io.cjs` : réglage présent et activé (KH_NATIVE=1), désactivé à l'écran (natif arrêté, son au navigateur, choix retenu), réactivé ; tenue sans manque | OK |
| `qa/packaged-mac.cjs --strict`, installateur puce Apple, sur ce Mac | OK (moteur natif sur « Haut-parleurs MacBook Pro ») |
| Même chose, application Intel (`--mac dir --x64`), sous Rosetta | OK |
| Campagne `qa/run.cjs` : nouveaux cas NAT01-05 (réglage, échec, choix retenu, langues) et MAC01-05 (liste, réglages, annulation, indisponible ici, échec, huit effets, libération) avec un module natif simulé dans le navigateur (`qa.fakeNative`) | **200/201** (DK01, Linux seulement) ; deux campagnes précédentes à 199/201 : MAC02 une fois (avant correction de la libération des plugins), R05 une fois (prise chronométrée, Mac chargé ; 3 réussites sur 3 seul) |
| `qa/desktop-smoke.cjs` | OK, désormais sur un profil temporaire (le profil de développement avait un projet « Démo » vidé de ses clips, qui le faisait échouer) |

Défauts trouvés et corrigés en route :
- **Plugins jamais libérés à la suppression d'une piste** (ou à l'ouverture d'un autre projet) : un plugin du Mac continuait de tourner dans son fil natif. Désormais libérés ; un effet retiré pendant son chargement est libéré sans message d'échec (cas MAC05).
- **Réglages audio vides pendant plusieurs secondes** dans la version bureau sur Mac : la première liste des sorties audio (`enumerateDevices`) met 1 à 4 s à venir. La fenêtre s'affiche maintenant tout de suite et la liste se remplit après, sans redessiner le reste (une mesure peut être en cours).
- La campagne lance désormais Chromium avec `SharedArrayBuffer` activé (comme la version bureau en mode natif), pour les cas NAT et MAC.

Non vérifié : **l'écoute d'un plugin du Mac à l'oreille** (à faire par le propriétaire : ajouter « Delay » ou « Lowpass » à une piste, moteur natif activé ou non) ; l'installateur sur un vrai Mac Intel (seulement sous Rosetta) ; l'ouverture du `.dmg` téléchargé depuis GitHub (avertissement de macOS attendu, application non signée) ; des plugins tiers (aucun installé) ; HawkScan (pas de clé API, application sans serveur).

**Suite faite dans la nuit du 15 au 16/11/2026** (consigne de nuit du propriétaire, transmise par la session « Avancer le projet au maximum ») — chaque point avec ses cas de QA, ses textes en trois langues, un commit poussé :

1. **Échelle logarithmique** (`bc331ec`) : réglages en Hz, et ceux que le plugin déclare logarithmiques (`kAudioUnitParameterFlag_DisplayLogarithmic`, renvoyé par `params` dans `flags`), sur un curseur logarithmique quand la plage le permet (minimum positif, facteur 20 au moins). Le projet garde la valeur en Hz, à 4 chiffres significatifs. Tous les curseurs de l'application donnent maintenant leur valeur affichée aux lecteurs d'écran (`aria-valuetext`). Cas MAC06. Au passage : la fenêtre des effets « oubliait » parfois qu'elle était rouverte (événement de fermeture différé), cause de l'instabilité de MAC02 ; corrigé.
2. **Réglages à choix** (`dc3d09b`) : `params` renvoie les noms des valeurs (`kAudioUnitProperty_ParameterValueStrings`) ; ils s'affichent en liste (ex. AUFilter « Low Filter Type » : Low Shelf / High Pass ; AUNBandEQ « Type » : 11 formes de filtre). Les réglages marche/arrêt (`Boolean`) deviennent un interrupteur (rôle `switch`). Cas MAC07 ; vérifié sur AUFilter dans `qa/au-bridge.cjs`.
3. **Préréglages d'usine** (`cec7b54`) : nouvelles fonctions natives `presets` et `setPreset`. Liste « Préréglage d'usine » dans la carte de l'effet (AUMatrixReverb et AUReverb2 : 13 ; AUDistortion : 22 ; AUDynamicsProcessor : 6…). Le plugin charge le préréglage, puis tous ses réglages sont recopiés dans le projet (`p`), avec le numéro du préréglage (`Insert.preset`, champ facultatif) : écoute et export identiques, annulable. Toucher un réglage repasse en « Réglages personnels ». Cas MAC08 ; vérifié avec « Large Hall » d'AUMatrixReverb (13 réglages changés, recopiés à l'identique). Limite : un préréglage qui changerait un état interne non exposé en réglage ne serait pas reproduit à l'export (non constaté sur les plugins d'Apple).
4. **Compensation de latence** (`3bd8f50`) : chaque tranche a un retard (`pdc`) après sa chaîne d'effets. Les pistes envoyées vers un bus sont calées entre elles à l'entrée du bus, puis bus et pistes directes sur le chemin le plus long. Une piste muette compte toujours. À l'export, tout le mixage est ramené au début du fichier (`lastRender.pdc`) ; à l'enregistrement, ce retard s'ajoute à la compensation des prises. Cas MAC09 (retards par piste et par bus, plugin coupé, piste muette, export) ; avec le vrai AUPeakLimiter (2 ms), l'export est calé à l'échantillon près. Limites : seuls les plugins du Mac déclarent une latence (les plugins web non) ; le clic de la mesure de latence et le métronome ne passent pas par le retard (écart égal à la latence du plugin, 2 ms pour le limiteur).
5. **Règle de contenu (CSP)** (`71e5031`) : ajoutée à la version construite par `vite.config.ts` (site web **et** version bureau ; pas pendant le développement, à cause du rechargement à chaud). Elle autorise le code de l'application, les worklets et sons créés en mémoire (`blob:`), et, pour les plugins web d'un autre site acceptés par l'utilisateur, leur code et leurs fichiers en https. Elle interdit eval, objets intégrés, cadres et formulaires. Plus aucun avertissement de sécurité d'Electron. Vérifié : `qa/desktop-smoke.cjs` (avec le plugin web fourni), `qa/au-bridge.cjs`, `qa/native-io.cjs`, et une campagne complète **sur la version construite** (`vite preview`) : 203/205, sans aucun refus de la règle. Les deux échecs sont DK01 (Linux seulement) et RI06 : en version construite, le service hors ligne télécharge lui-même les sons, et le refus simulé par le test ne l'atteint pas ; ce n'est pas lié à la règle.

Bilan de la nuit : campagne `npm run qa:all` **204/205** (DK01, Linux seulement) ; `npm run build` OK ; `qa/au-bridge.cjs`, `qa/native-io.cjs`, `qa/desktop-smoke.cjs` OK ; installateur `release/KH Music Pro-0.15.0-arm64.dmg` construit avec le module universel, `qa/packaged-mac.cjs --strict` OK.

Reste possible : fenêtres graphiques des plugins (vue Cocoa dans une fenêtre native) ; latence des plugins web ; noms des réglages répétés d'AUNBandEQ (« Bypass », « Type »… une fois par bande, sans numéro de bande).

### À valider par Kevin

1. **Écouter un plugin du Mac** : version bureau, 🧩 d'une piste → « 🍎 Plugins du Mac » → « MatrixReverb », préréglage « Large Hall », puis « Lowpass » en bougeant « Cutoff Frequency ». Le son change-t-il comme attendu, sans craquement ?
2. **Moteur audio natif** : 🔧 Réglages audio → « ⚡ Moteur audio natif » : l'activer, jouer, enregistrer une prise, brancher puis débrancher les EarPods, le désactiver. Désactivé par défaut : faut-il l'activer par défaut sur Mac ? **Oui** (Kevin, 21/11/2026 ; fait, section 18).
3. ~~Installateur~~ : fait, v0.16.0 installée depuis la release (15/11/2026).
4. ~~Numéro de version~~ : 0.16.0, validé par le propriétaire.
5. ~~Fusion dans `main`~~ : faite le 15/11/2026 (PR #2).
6. Le micro des EarPods : une prise reste à écouter (déjà noté plus haut).

### Critères de décision

- **On continue** si un plugin AU traite le son d'une piste avec une latence aller-retour inférieure à 12 ms et sans craquement pendant 5 minutes.
- **On s'arrête** si l'étape 4 demande de dupliquer le moteur de mixage en natif : c'est alors la piste 4, un projet de plusieurs mois, à décider en connaissance de cause.

### Ce qu'une session sur le Mac doit aussi faire

Profiter de la machine réelle pour lever la section 3 : écouter la démo et les modèles, enregistrer une vraie voix (prises, punch, justesse), brancher un clavier MIDI, ouvrir le `.dmg`, essayer la mesure de latence. Consigner ce qui sonne mal ou gêne à l'usage : ces retours passent avant toute nouvelle fonction.

## 6. Feuille de route

- **Faites** : V1 à V13, V14a (chaînes d'effets, latence, plugins web), puis **0.16.0** (15/11/2026) = V14b + V15 à V15.2.
- **En cours** : V14b (ci-dessus), étapes 0 à 5 faites les 12 et 13/11/2026 sur la branche `v14b-prototype-natif`, puis une séance d'écoute : craquements sur un Mac en usage normal. Recherche de la cause (13-14/11) : non reproduits sous charge artificielle ; le navigateur décroche aux mêmes épisodes. Seconde séance avec le témoin (14/11, à l'arrêt) : hoquets du Mac communs aux deux chemins, plus des rafales propres au natif (réserve de 8 ms trop juste). Réserve passée à 16 ms (75 ms d'aller-retour, 0 manque en 60 s) ; troisième séance : prise réussie, quatre défauts du mode natif trouvés et corrigés (suivi des écouteurs, micro des EarPods, débranchement, micro capté en permanence). Écouteurs vérifiés par le propriétaire (coupure courte) ; micro des EarPods ouvert, prise à écouter. **15/11 : intégré à l'interface de la version bureau** (réglage « moteur audio natif », plugins du Mac dans la chaîne d'effets, pont isolé, module dans l'installateur macOS) : **en ligne dans la version 0.16.0**, à écouter.
- **En attente** : la phase de QA humaine du propriétaire (écoute, vrai matériel) ; décisions de Kevin du 21/11/2026 appliquées (section 18) : moteur natif activé par défaut sur Mac ; batterie à plusieurs nuances (Virtuosity Drums) déjà présente comme kit Studio.
- **Idées non engagées** : chaînes d'effets remplaçant la tranche fixe (plan en section 18), installateurs signés, travail à plusieurs. Première tranche faite en section 18 (branche `claude/suite`) : automation de la tranche et de l'instrument, 6/8 et signatures composées, clips enregistrés à la volée en mode Live ; les clips audio qui suivent le tempo existaient depuis la V17.

## 7. Extension généraliste V15 (branche v15-banque-generaliste)

- Version 0.15.0 : 18 banques supplémentaires, 29 instruments échantillonnés au total et 24 sons existants (sampler compris), classés par famille dans le menu Son. Les identifiants existants et le format du projet sont conservés ; aucun nouveau champ à migrer.
- 450 MP3 supplémentaires sélectionnés sans conversion dans FluidR3 GM / midi-js-soundfonts (CC BY 3.0), source figée au commit `044fab8e1456bfafc5776e86dfd6bb8697149aef`. Attribution dans `public/banks/CREDITS.txt` et l’aide.
- Le script `tools/build-banks.sh` reconstruit aussi ces sons. Le chargement à la demande et le graphe commun à l’écoute et à l’export sont inchangés.
- En V15.0 : une seule couche de vélocité, durée finie et pas de boucle de maintien ; la V15.1 ajoute le maintien décrit en section 8. Le piano droit est un honky-tonk ; ne pas le présenter comme un piano droit neutre.
- QA : six cas BN01–BN06 ajoutés (traductions/familles, clavier, chargement à la demande, fichier/rechargement, échec/réessai, téléphone) ; RI01 vérifie les 29 sons, W01 un nouvel instrument hors ligne et DK01 un nouvel instrument dans Electron.
- Écoute humaine, micro et MIDI matériels, Windows/macOS réels : toujours à vérifier par le propriétaire.

## 8. V15.1 — navigateur de sons et notes longues

- `src/ui/sounds.ts` : navigateur modal, recherche sans accents, familles, favoris locaux validés, préécoute sans modifier le projet et sélection via le même chemin que le menu rapide. Fermeture et changement de filtres annulent les préécoutes en attente ; une piste disparue ne peut plus être modifiée.
- `src/audio/sustain.ts` : banques éligibles, recherche d’un raccord de phase et préparation d’un tampon de maintien avec fondu croisé. Le tampon original reste inchangé. `banks.ts` prépare les boucles au chargement et choisit une note enregistrée audible si l’échantillon le plus proche est silencieux.
- `SynthParams.hold` : `false` dans BASE pour préserver les anciens fichiers ; activé pour les nouveaux préréglages compatibles. `graph.ts` utilise les mêmes boucles en direct et en export, avec l’enveloppe et l’arrêt des voix existants.
- `engine.audition()` et `stopAudition()` isolent la préécoute du contenu du projet et des tranches de piste. Les requêtes périmées sont annulées logiquement après chargement. Le général règle le volume de préécoute.
- QA : LH01–LH06 (maintien dans plusieurs registres, attaque, relâchement, anciens projets, arrêt, WAV) et SB01–SB10 (langues, recherche, favoris, préécoute, chargements tardifs, annulation, clavier, tactile et erreurs). Captures du navigateur jointes au rapport GitHub Actions.
- À apprécier par le propriétaire : qualité des raccords à l’oreille et confort de jeu, clavier MIDI réel, téléphone réel et ouverture des installateurs Windows/macOS.

Validation V15.1 : compilation réussie ; 212/212 cas dans https://github.com/YANKAMKEVIN/kh-music-pro/actions/runs/43330407090. Installateurs dans https://github.com/YANKAMKEVIN/kh-music-pro/actions/runs/43330406587 ; le test Electron Linux vérifie le maintien après quatre secondes, la préécoute du navigateur et le retour du focus.

## 9. V15.2 — nuances, raccords mesurés, registres égalisés (nuit du 15/11/2026)

Travail fait sans le propriétaire, sur sa consigne de nuit : tout ce qui se vérifie par mesure. Aucune nouvelle source sonore : seulement les fichiers FluidR3 (CC BY 3.0) déjà présents.

- **Nuances** (`SynthParams.touch`, 0 à 1) : `graph.ts` insère, pour le moteur « multi », un passe-bas dont la coupure suit la douceur de la note (`touchSoftness`, `touchCutoff`), relative à la hauteur (jamais sous le 3e harmonique), et allonge un peu l'attaque des notes douces (jusqu'à 15 ms). Même code à l'écoute et à l'export. `BASE.touch = 0` : un ancien projet sonne exactement pareil ; les préréglages enregistrés reçoivent `TOUCH_DEFAULT = 0.7`. Réglage « Nuances » dans l'éditeur, trois langues.
- **Pourquoi pas de vraies couches de vélocité** : FluidR3 / midi-js-soundfonts n'a qu'une prise par note. La batterie Virtuosity Drums (CC0, déjà notée dans les crédits) existe en plusieurs nuances (`vl3`, `vl4`, `vl12`, `vl16`, `vl36`…), mais il faudrait télécharger de nouveaux fichiers : laissé à la décision du propriétaire. Le moteur prendrait plusieurs couches sans changer le format du projet.
- **Raccords de boucle** (`sustain.ts`) : mesure de l'état V15.1 sur les 237 boucles : aucun clic, mais des bosses ou creux de niveau jusqu'à 8 dB pendant le fondu (sons imparfaitement en phase), et une marche à chaque tour sur les notes qui s'éteignent. Corrections : fondu porté de 40 à 100 ms ; niveau ramené tranche par tranche (5 ms) à la valeur attendue pendant le fondu ; gain progressif sur le corps de la boucle pour que la fin rejoigne le niveau du début (mesuré sur 250 ms, borné à ±6 dB). Une première version mesurait sur 40 ms et créait elle-même une rampe de 3 dB sur les cordes : corrigé et couvert par LP02.
- **Registres** (`banks.ts`, `registerGains`, `noteLoudness` dans `loudness.ts`) : volume perçu (pondération K) de chaque note au chargement, comparé à la droite de tendance de l'instrument adoucie de moitié ; correction bornée à ±9 dB, puis la crête la plus forte est ramenée à 0,9 (crête désormais mesurée sur tous les échantillons et canaux, plus un sur huit). Écart maximal entre deux notes enregistrées voisines : 1,3 dB (11 dB avant, vibraphone). Les niveaux d'anciens projets changent donc légèrement : c'est voulu.
- `window.kh.banks` expose le chargement et les mesures pour la QA.
- QA : NU01–NU07 (timbre selon la force, nuances à zéro, ancien projet, réglage/annulation/fichier, trois langues, progression de la coupure, MIDI en direct), LP01–LP02 (237 raccords mesurés ; note tenue 10 s comparée à la variation naturelle de l'enregistrement), RG01–RG03 (voisines à moins de 2 dB sur 29 instruments, aucune saturation, gamme de trois octaves à l'export). LH02 compare désormais l'attaque sur 0,6 s (la boucle commence là).

### À écouter / valider par Kevin au réveil

1. **Le navigateur de sons et les 29 instruments** (V15.0 et V15.1, jamais écoutés) : qualité générale, notes qui sonnent faux ou bizarres, le « piano droit » qui est un honky-tonk.
2. **Les notes longues** sur cordes, orgue d'église, violon, chœur : garder une touche 10 s ; plus de pulsation ni de « hoquet » à chaque tour ?
3. **Les nuances** au clavier MIDI (ou en baissant la force des notes dans le piano roll) sur piano, guitare nylon, cuivres : jouer doucement doit sonner feutré, pas étouffé. Trop ? Pas assez ? Le réglage « Nuances » va de 0 à 100 % (70 % par défaut).
4. **Les registres** : une gamme du grave à l'aigu sur piano, flûte, vibraphone : plus de note qui ressort ou disparaît ?
5. **Décision** : télécharger les nuances réelles de la batterie Virtuosity Drums (CC0, quelques mégaoctets) pour une batterie qui change vraiment de timbre selon la force ? **Oui** : fait en V17.1 (kit Studio, section 14), confirmé par Kevin le 21/11/2026 (section 18).
6. ~~Fusion~~ : faite avec la V14b, version 0.16.0 en ligne (15/11/2026).


## 10. Branche d'essai : V15 + V14b réunies (15/11/2026), fusionnée

Branche `integration-v15-natif` : la banque de sons V15 (`v15-banque-generaliste`, à `3155021`, avec les nuances V15.2) et le moteur natif V14b (`v14b-prototype-natif`, à `5967113`) réunis en un seul commit de fusion. Rien n'a été fusionné dans `main`, et les deux branches d'origine sont intactes.

Conflits résolus (10 blocs, 8 fichiers, tous « garder les deux ») :
- `package.json` : les deux branches se disaient 0.15 (0.15.2 et 0.15.0). La réunion passe en **0.16.0**, à confirmer par le propriétaire.
- `src/main.ts` (point d'accès de test `window.kh`), `src/audio/engine.ts` (imports), `src/style.css` : union des deux côtés.
- `qa/run.cjs` : Chromium lancé avec `SharedArrayBuffer` (V14b) **et** le chemin de navigateur réglable `KH_CHROMIUM_PATH` (V15).
- `qa/desktop-smoke.cjs` : l'orgue tenu et le navigateur de sons (V15), plus le plugin web et la règle de contenu (V14b).
- README et passation : nombre de cas et version.

Vérifications sur ce Mac :

| Vérification | Résultat |
|---|---|
| `npm run build` (types + version de production) | OK |
| Campagne complète, serveur de développement | 1er passage 236/239 ; 2e passage **238/239** (seul DK01, qui ne tourne que sous Linux). Au 1er passage, T01 et MP01 avaient échoué ; ils passent seuls deux fois de suite et dans le 2e passage complet : instables selon l'ordre, pas cassés par la réunion. |
| Campagne complète sur la version construite (règle de contenu active) | 235/239 : DK01, plus RI06, BN05 et SB09. Ces trois-là bloquent volontairement le chargement d'un son, mais le service hors ligne le sert depuis son cache ; même cause que RI06, déjà connue sur V14b. Aucun refus de la règle de contenu : les sons de la banque se chargent. |
| `qa/desktop-smoke.cjs` (version bureau) | OK : orgue tenu, navigateur de sons, plugin web, règle de contenu, aucun avertissement |
| `qa/au-bridge.cjs` (plugins du Mac, vrai module natif) | OK : réglages, préréglage « Large Hall », aucun refus de la règle de contenu |
| `qa/native-io.cjs` (moteur audio natif : interrupteur, bascule, tenue) | OK, aucun bloc manqué |

Non vérifié : l'écoute (sons V15 et plugins du Mac), les installateurs de cette branche, et une version Windows.

Décision du propriétaire : tout d'un coup. Fusionnée dans `main` le 15/11/2026 (PR #2, commit `e55983c`, QA et version bureau vertes sur GitHub), site mis en ligne, release **v0.16.0** créée avec ses quatre installateurs (Mac puce Apple, Mac Intel, Windows, Linux).

## 11. V16.1 — touches tenues à l'écran (15/11/2026)

Premier retour d'écoute du propriétaire sur la 0.16.0 : les instruments « s'entendent plutôt bien », mais « les touches longues font juste un bruit bref ». Il jouait sans clavier MIDI, en cliquant sur le **clavier dessiné à gauche du piano roll**. Ces touches jouaient toujours une note d'un quart de seconde (`engine.previewNote`), même tenues : les notes longues ne pouvaient donc pas s'y entendre. Les touches de l'ordinateur (Q, S, D…) et le MIDI, eux, tenaient déjà la note (LH03).

Correction (`src/ui/editor.ts`, `src/style.css`) :
- La touche joue tant qu'elle est tenue, à la souris comme au doigt (`engine.noteOn` à l'appui, `noteOff` au relâchement).
- Le relâchement est écouté sur toute la fenêtre, avec le même identifiant de pointeur : la note s'arrête même si le doigt glisse hors de la touche ou si l'écran se redessine pendant l'appui. Un geste annulé par le système (`pointercancel`) coupe aussi la note.
- `touch-action: none` et pas de menu d'appui long sur les touches : au doigt, tenir une touche ne fait plus défiler la page (ce qui aurait coupé la note).
- Chaque touche porte `data-p` (sa hauteur MIDI) pour la QA.

QA : LH07 (souris tenue 3,6 s puis relâchée), LH08 (doigt : pas de défilement, levé hors de la touche), LH09 (redessin pendant l'appui, geste annulé : aucune note bloquée). Version 0.16.1.

Non vérifié : l'écoute par le propriétaire de cette correction, et un vrai téléphone.

## 12. V16.2 — tournée « gestes de musicien » (15/11/2026)

Suite au retour de la V16.1 (« il faut faire des QA poussées en amont »), chaque contrôle qui joue, enregistre ou modifie le son a été passé en revue avec la question : que se passe-t-il si on le tient, le glisse, le touche au doigt, l'utilise au clavier seul, sans MIDI ? Inventaire fait par lecture du code et de `qa/run.cjs` (ce qui était testé par un vrai geste et ce qui ne l'était pas), puis chaque défaut certain a reçu un cas de QA qui rejoue le geste, et une correction.

Corrigé :
- **Clavier du piano roll** : passe par le jeu en direct (`input.noteOn/noteOff`) quand sa piste est sélectionnée : accords à un doigt, arpégiateur et enregistrement de ce que l'on joue s'appliquent comme au clavier de l'ordinateur (LH10, LH11). La colonne des touches est en `touch-action: pan-y` : tenir une touche joue, glisser verticalement fait défiler le piano roll (régression de la V16.1, où plus rien ne défilait au doigt ; LH08 adapté).
- **Clavier à l'écran 🎹** : les doigts posés sont gardés hors de l'élément (`okbDown`) et suivis sur la fenêtre : une touche tenue pendant un redessin (enregistrement, bouton MIDI) ne reste plus bloquée, arpégiateur compris (GE01).
- **Effets momentanés du Live** : même principe ; un redessin pendant l'appui ne laisse plus l'effet allumé avec un bouton éteint ; au clavier, relâchement écouté sur la fenêtre, et perte du focus de la fenêtre = relâchement (GE02).
- **Espace** : sur un bouton atteint par Tab, Espace actionne ce bouton (accessibilité) ; après un clic ou un doigt, Espace reste la lecture. `:focus-visible` ne convient pas (Chromium le rallume à chaque touche) : `main.ts` suit l'origine du focus (`focusByTab`) (GE03).
- **Pads** : au clavier, une frappe par appui et la répétition de notes s'arrête au relâchement ; en multi-touch, lever un doigt n'arrête plus la répétition des autres pads (GE04).
- **Première note d'un instrument pas encore chargé** : elle sonne dès la fin du chargement si la touche est toujours tenue (`engine.pendingOn`) ; `window.kh.banks.forgetBank` permet de rejouer un premier chargement en QA (GE05).
- **Clavier seul** : après chaque réglage, l'écran redessiné remet le focus sur le même bouton ou curseur (`keepFocus` dans `main.ts`, signature data-*/aria-label/rang) ; avant, chaque flèche sur un curseur renvoyait le focus en haut de la page (GE06). Les champs texte et listes ne sont pas concernés, pour ne pas bloquer les raccourcis.

Relevé mais non corrigé, à trancher par le propriétaire :
1. **Séquenceur de batterie au doigt** : faire défiler la grille allume la case touchée au départ ; peindre plusieurs cases en glissant est impossible au doigt. Choix : la grille capte le doigt (peinture, mais défilement par une autre zone) ou elle défile (pas de peinture au doigt).
2. **Double-clic dans le vide du piano roll** : crée puis supprime une note (rien ne reste) ; même chose pour l'automation. Un habitué d'Ableton peut être surpris.
3. **Téléphone** : supprimer une note, créer un clip ou supprimer un point d'automation ne passe que par double-clic, clic droit ou Suppr. Il manque un geste tactile (appui long, ou bouton « supprimer » sur la sélection). À vérifier sur un vrai téléphone.
4. **Glisser une note, la boucle, un clip, un point d'automation** : pas de gestion de `pointercancel` ni de filtre par doigt. Rare, mais un geste annulé par le système laisse le glissé branché.

QA : LH10-LH11, GE01-GE06 ; 250 cas. Version 0.16.2. Non vérifié : un vrai téléphone, un lecteur d'écran réel, l'écoute.

## 13. V17 — version 0.17.0 (branche `v17`, nuit du 15 au 16/11/2026)

Consigne du propriétaire : « pour le moment on se concentre uniquement sur le Mac, fais le maximum qui ne dépend pas de mon écoute ». Neuf étapes, toutes faites ; chacune a des cas de QA qui rejouent les gestes réels (souris tenue, doigt, clavier seul, plantage réel d'un onglet, fenêtres du système) et mesurent le son produit. **Rien n'est fusionné dans `main`.** Commits : `e7cbe0e` (étapes 1-2), `2c8c838` (3-4), `9fc3038` (5-8), puis l'étape 9 et cette section.

### Ce qui a été fait

1. **Empreinte sonore de référence** (`qa/empreinte.cjs`, `qa/empreintes/*.json`) : un export WAV est mesuré (durée, crête, LUFS, enveloppe par 250 ms, énergie par octave de 31 Hz à 16 kHz, clics, coupures de 10 ms, saturation, valeurs invalides) et comparé à une empreinte enregistrée. Cas EM01-EM05 : démo, notes tenues (cordes, orgue d'église, chœur, violoncelle), modèles trap/house/lofi, exportés par le vrai bouton « Exporter » ; EM04 vérifie que des défauts fabriqués (clic, trou de 30 ms, saturation, piste muette) sont bien signalés ; EM05 mesure une touche tenue 8 s à la souris toutes les 50 ms. Les bruits (caisse claire, réverbération) tirent au hasard : la graine est fixée pendant l'export de QA. `qa/empreinte-mac.cjs` fait de même avec de vrais Audio Units d'Apple (filtre + écho, réverb, dynamique) dans la version bureau. **Mise à jour volontaire seulement** : `KH_EMPREINTE=maj` (après une écoute qui valide un changement de son).
2. **Ne jamais perdre un morceau** (`store.ts`) : versions du projet (instantané toutes les 2 minutes de travail, à l'ouverture, avant restauration, à la main ; on garde les 20 dernières et une par jour sur 10 jours), menu « Versions du morceau… » et bouton 🕘 dans la bibliothèque ; restauration annulable par Ctrl+Z. Fermeture inattendue détectée au lancement suivant (verrou Web Locks de chaque onglet ; sans lui, battement de 5 s) : message « Morceau récupéré » avec accès aux versions. Sauvegarde automatique illisible → dernière version lisible. Écriture forcée quand la page se cache ou se ferme. Quand le système libère l'onglet planté en retard (vu sous Linux sur GitHub), une seconde vérification 8 s après le démarrage affiche le message et marque alors la version d'ouverture « récupérée » (`markRecovered`). Cas SV01-SV09 (SV01 et SV06 tuent réellement l'onglet ; SV09 reproduit la libération tardive).
3. **Vrais fichiers dans la version bureau** (`electron/files.cjs`, `electron/preload.cjs` en bac à sable, repris par `native-preload.cjs`) : Ouvrir (Cmd+O), Enregistrer (Cmd+S réécrit le fichier lié, même après redémarrage), Enregistrer sous (Cmd+Maj+S), fichiers récents dans le menu Projet, ouverture depuis le Finder (`open-file`, association `.khm` dans l'installateur), point « modifié » du Mac, titre de fenêtre. Écriture sûre (fichier temporaire puis remplacement). Le processus principal n'écrit que dans les fichiers choisis par l'utilisateur dans les fenêtres du système (ou ses récents) : vérifié. Cas DF01-DF08 (pont simulé) et `qa/desktop-files.cjs` (vraie version bureau, avec et sans module natif).
4. **Glisser annulé** (`followDrag` dans `dom.ts`, `revert` dans `store.ts`) : note, poignée, vélocité, boucle, clip, point d'automation, séparation et grille de batterie. Seul le pointeur qui a commencé le glissé le pilote ; `pointercancel` remet l'état d'avant ; souris relâchée hors de la fenêtre = fin normale. Usage inchangé. Cas GD01-GD10 ; 9 sur 10 échouent sur l'ancien code (vérifié).
5. **Clips audio qui suivent le tempo** (`Clip.warp`, `Clip.srcBpm`, `graph.ts`) : bouton « Suit le tempo » et « Tempo d'origine » dans l'éditeur audio. Une portion par tempo traversé, lue dans une version étirée sans changer la hauteur (fondus de 10 ms aux changements), même code à l'écoute et à l'export ; versions étirées gardées en mémoire (24 au plus). L'étirement WSOLA (`stretch.ts`) garde maintenant chaque attaque à l'heure, sans l'effacer ni la doubler (il en perdait avant ; profite aussi à l'étirement manuel). Cas WP01-WP07.
6. **Automation de n'importe quel réglage d'effet** (clés `ins:<effet>:<réglage>`) : effets intégrés par rampes sur leurs paramètres audio, plugins du Mac par envoi au bon instant (minuterie à l'écoute, pauses du rendu hors-ligne à l'export). Liste des réglages groupée par effet dans la courbe d'automation ; retirer l'effet retire ses courbes. Cas AX01-AX06 ; `empreinte-mac.cjs` vérifie un vrai AULowpass automatisé à l'export (aigus −107 → −41 dB).
7. **Gel de piste** (❄ dans l'en-tête, `freezeTrack`/`unfreezeTrack`) : rendu avant le fader (instrument, égaliseur, effets, automation) sur une piste audio juste en dessous, qui reprend volume, panoramique, envois, sortie et sidechain ; l'originale est coupée, ne joue plus ses notes et sa chaîne d'effets est débranchée. Cas FZ01-FZ05.
8. **Performance** : indicateur « ⚡ Charge » dans le mixeur (`measureLoad` : temps de calcul de 4 s de mixage, notes programmées en retard, décrochages signalés par Chromium quand il les expose). Optimisations sans changement de son : chorus, trémolo et égaliseur à plat débranchés (40 pistes vides : 39 % → 25 % d'un cœur), phaser et autopan recalculés par bloc. Cas PF01-PF03, chiffres dans `qa/perf-gros-projet.json`.
9. **Fenêtres graphiques des plugins du Mac** (`native/kh-au-bridge/src/bridge.mm` : `uiOpen`, `uiClose`, `uiIsOpen`, `uiPump`) : la vue Cocoa du plugin (ou la vue générique d'Apple) dans une fenêtre native flottante, ouverte par le bouton « 🪟 Fenêtre du plugin » de la chaîne d'effets. La page relit les réglages du plugin toutes les 300 ms et les recopie dans le projet (enregistrés, annulables, à l'export) ; pas pendant la lecture d'une automation de ce plugin. La fenêtre se ferme avec l'effet. Le module natif est désormais lié à AppKit, CoreAudioKit et QuartzCore. Cas AW01-AW03 et `qa/au-window.cjs` (vraie fenêtre vérifiée dans la liste des fenêtres du Mac).

Aussi : `qa/snapshot.sh` lance une campagne sur une copie figée (le serveur de développement recharge le code modifié : une campagne lancée pendant qu'on édite se fausse) ; IN01 attend l'ouverture du micro au lieu d'un délai fixe.

### Vérifié (sur le MacBook Pro M3 du propriétaire)

| Vérification | Résultat |
|---|---|
| `npm run build` | OK |
| `npm run qa:all` (308 cas) | dernière campagne complète : 307/308 (seul DK01, qui ne tourne que sous Linux) ; avant : 305/307 (DK01, et PF03 avant l'assouplissement de son seuil) ; la précédente 302/307 sous une charge machine de 100 à 185, ses échecs (L02, AR03, GE04, PF02, sensibles au temps) repassant seuls aussitôt. Campagnes précédentes : 263/265, 282/283, 302/304 (seuls DK01 et des cas de temps). DK01 ne tourne que sous Linux. |
| `qa/desktop-smoke.cjs`, `qa/desktop-files.cjs`, `qa/au-window.cjs`, `qa/empreinte-mac.cjs`, `qa/au-bridge.cjs 60` | OK |
| `qa/native-io.cjs 60` | OK au calme (charge 20) : 0 manque, 0 surcharge Core Audio, 0 coupure du témoin en 60 s. Un premier passage sous une charge de 185 (autres applications) avait échoué (1 manque, 2 surcharges, et le témoin navigateur coupait aussi). |
| Charge du gros projet (40 pistes, 120 effets dont 10 réverbs d'effet) | machine au calme : 150 % d'un cœur → 63 % après gel des 32 pistes d'instruments, aucune note en retard ; machine saturée : 363 % / 526 % → 166 %, mais une fois 332 % → 298 % (mesure très bruitée sous charge extérieure ; PF03 exige donc seulement 10 % de baisse). Redessin de l'écran 20 à 60 ms, mixeur 27 à 37 ms. |

Instabilités vues, liées à la charge de la machine : T01 (déjà connu, section 10) a échoué 2 fois sur 5 sous forte charge et passe au calme ; MA03, AX02 et PF03 ont révélé l'un un vrai défaut (classe CSS partagée, corrigé), les autres des seuils absolus remplacés par des critères relatifs.

### Non vérifié

- **L'écoute** de tout ce qui précède, en particulier : l'étirement des clips qui suivent le tempo (voix, batterie, instruments tenus), le nouvel étirement qui garde les attaques, le son gelé comparé à l'original, l'automation d'un plugin du Mac (petits sauts de valeur à chaque double-croche : la valeur est envoyée par pas, pas en continu).
- **La souris dans la fenêtre d'un plugin du Mac** : la fenêtre s'ouvre, s'affiche, se ferme et ses réglages reviennent dans le projet, mais aucun test n'a cliqué dans ses boutons (le système demande une autorisation d'accessibilité pour simuler la souris). Elle vit dans le processus de la page (pas de vraie boucle d'évènements du Mac) : les évènements lui sont distribués toutes les 30 ms. Elle reste au-dessus des autres fenêtres, même d'autres applications.
- Les vrais fichiers sur un autre Mac, un disque externe ou iCloud Drive ; l'association `.khm` (elle n'existe qu'une fois l'installateur reconstruit).
- La charge mesurée par le rendu hors-ligne surestime sans doute la réverb d'effet à l'écoute (Chromium calcule la fin des longues réverbs sur un autre fil en temps réel).
- Windows et Linux pour les nouveautés de la version bureau (elles visent le Mac).

### À décider par le propriétaire

1. Les trois choix de la section 12 (points 1 à 3) restent ouverts.
2. « Suit le tempo » activé par défaut pour les nouveaux clips audio (comme Ableton pour les boucles) ? Aujourd'hui désactivé : un ancien projet sonne exactement pareil.
3. Fréquence des versions (2 minutes) et nombre gardé (20 + une par jour sur 10 jours) : à ajuster selon l'usage.
4. Fusion de `v17` dans `main` (met le site en ligne à jour) et release 0.17.0.


## 14. V17.1 — piano expressif, batterie Studio et pédale (16/11/2026)

Travail demandé explicitement par le propriétaire : avancer sans son intervention sur les banques intégrées et préparer le jeu avec son Yamaha DGX-670, sa Focusrite (modèle non confirmé) et son micro. Branche `v17-expressive-banks`, issue de `main` à `ef4a5c1`. Version préparée : **0.17.0**. La version en ligne et l’application installée ne sont pas remplacées par ce travail.

### Sons et droits

- `r_salamander` / banque `salamander` : Salamander Grand Piano v3, Alexander Holm, CC BY 3.0. Source figée `sfzinstruments/SalamanderGrandPiano@3382bf9496bba2486f5ab0de55a264d1dfc38404`. 120 MP3 stéréo : 30 notes MIDI 21–108, 4 nuances (v4/v8/v12/v16), maximum 12 secondes, 44,1 kHz et 192 kbit/s.
- Kit `studio` / banque `studio_drums` : Virtuosity Drums, Versilian Studios et Karoryfer, CC0. Source figée `sfzinstruments/virtuosity_drums@9f04cf9a734527edfbb0a4eee1f674e45bbf71bc`. 115 MP3 mono pour 16 pads ; jusqu’à 4 nuances et 3 répétitions selon l’élément. Pas de répétitions de même nuance pour la caisse claire et les toms, conformément à la source. Une prise micro par son, maximum 6 secondes et 128 kbit/s.
- 34,0 Mo compressés au total. À 48 kHz, environ 433 Mio de piano et 60 Mio de batterie décodés en mémoire : ces banques ciblent d’abord l’ordinateur, pas un petit téléphone.
- Les licences et README originaux sont livrés dans les dossiers de sons. Crédits et transformations dans `public/banks/CREDITS.txt`, avec leur texte reproductible dans `tools/expressive-credits.txt`. Le script historique conserve ces nouveaux crédits.
- `tools/build-expressive-banks.py` télécharge les seules données audio/licences, puis les convertit avec ffmpeg ; aucun code tiers téléchargé n’est exécuté. Il conserve source, révision, SHA256 source/sortie, durée, canaux, gain et décalage d’attaque dans `public/banks/expressive-provenance.json`, et génère `src/audio/expressive-manifest.ts`.
- `tools/check-expressive-banks.py` vérifie hors ligne les 235 fichiers, empreintes et mappages. Ajouté à la CI QA.

### Lecture et compatibilité

- Les anciens identifiants de piano et de kit acoustique ne changent pas. Aucun nouveau champ à migrer ni changement du format `.khm`. Le choix des nouvelles banques est explicite dans les menus existants et traduit dans les trois langues.
- `banks.ts` charge les nouvelles banques à la demande avec six travailleurs par banque. Un échec ne publie aucun ensemble partiel ; les téléchargements en cours terminent avant le rejet, puis un réessai est possible. Les banques originales gardent leur lecteur.
- La vélocité sélectionne un véritable enregistrement. Les gains de lecture égalisent le niveau d’attaque tout en bornant les crêtes à 0,85 ; l’amplitude jouée suit ensuite la vélocité. Le nouveau piano n’utilise pas le filtre de nuances artificielles, dont le curseur est masqué pour ce son.
- Le même graphe sert au direct et à l’export. Les compteurs de répétition appartiennent à chaque Mix et piste, jamais à la banque globale ; jouer/préécouter n’altère pas les exports suivants. Le charleston fermé coupe le charleston ouvert de la même piste. Les samples personnels restent prioritaires sur les pads.
- Les notes qui attendent le premier chargement sont annulées par l’arrêt ; une banque ou une piste remplacée ne peut pas déclencher une vieille note après son chargement.
- Un export WAV/MP3 est désormais refusé avec un message clair quand une banque manque, plutôt que de rendre une piste silencieuse sans le dire. Le cas RI06 a été adapté pour vérifier cette protection, tout en gardant le jeu des autres pistes en direct.

### MIDI et exports

- CC64 maintient les notes après le relâchement des touches ; lever la pédale libère les notes différées, rejouer une note la réattaque. Arrêt, perte de focus, déconnexion et CC120/123 libèrent le maintien. Le contrôle de pédale est suivi par canal ; le moteur de jeu reste celui d’une seule piste sélectionnée, sans routage multitimbral.
- L’enregistrement inscrit la durée audible jusqu’au lever de pédale dans les notes, donc cette durée survit à l’audio et au MIDI exportés. Pas de piste d’événements CC64 séparée, pas de demi-pédale ni de résonances sympathiques.
- Les pads enregistrés conservent leur force (avant : valeur 1 systématique et force minimale de 0,3 imposée en MIDI). Les roulements enregistrés gardent aussi la force de lecture.
- La première campagne a révélé un échec MP01 déjà décrit comme instable dans ce document : crête décodée à 1,00005 après compression MP3. L’encodeur vérifie maintenant le fichier décodé sur les deux canaux et le réencode à gain réduit si nécessaire, trois essais au maximum. Le WAV et le tampon source ne sont pas modifiés. Le MP3 peut donc être légèrement moins fort que la cible LUFS du rendu source. Le test MP01 contrôle les deux canaux avec une marge de crête.

### Vérifications et livrables

- 15 nouveaux cas EX01–EX10 et MD01–MD05 : sélection/traductions, 4 nuances réelles/stéréo, justesse/relâchement, 16 pads, répétitions et export reproductible, charleston, import personnel, fichier/rechargement, panne/réessai/export bloqué, compatibilité, pédale et nuances MIDI enregistrées.
- DK01 sait maintenant lancer Electron directement sur macOS et Windows ; seul Linux passe par xvfb-run. Il ne s’agit pas de supprimer son contrôle. Les tests bureau et application Mac empaquetée vérifient les deux nouvelles banques depuis les fichiers locaux.
- Premier passage complet : **264/265**, les 15 nouveaux cas réussis ; seul MP01 en échec. Après correction MP3, MP01 isolé et compilation passent. Passage final complet : **265/265 réussis** sur ce Mac, puis compilation de production réussie. Application Mac empaquetée vérifiée avec `qa/packaged-mac.cjs --strict` : module natif, isolation, effet AU, bascule native et les deux nouvelles banques embarquées OK.
- Module natif universel Apple/Intel construit. Installateur de test Apple dans `release/KH Music Pro-0.17.0-arm64.dmg`. L’application installée dans `/Applications` n’est pas touchée.
- `qa/expressive-demo.cjs` produit `livrables/v0.17.0/` : exemple `.khm`, trois écoutes WAV et deux captures françaises. Le lanceur local `Ouvrir-la-version-essai.command` utilise un profil distinct pour essayer l’application construite sans utiliser les projets du profil installé.
- Guide de branchement sourcé : `docs/YAMAHA-FOCUSRITE.md`.

Non vérifié par cette session : écoute humaine, véritable DGX-670/pédale, véritable Focusrite/micro, latence avec ce matériel, appareil mobile réel, installateur Windows. Les sons du piano sont une sélection allégée de la source, sans bruits de mécanique, pédale, résonances ni prise en charge du moteur SFZ/ARIA original. Pas de plugins instruments Audio Unit ajoutés.


## 15. V17.1 (suite) — Wurlitzer, basse électrique et percussions (16/11/2026)

Suite à la demande du propriétaire « vas y rajoute » : ajout des trois familles proposées, dans la branche d’essai V17 existante (PR #5 encore ouverte). Version préparée : **0.17.1**. Aucun remplacement des anciens identifiants ni nouvelle migration de projet.

### Sources et contenu

- `r_wurli` / `wurli` : Wurlitzer EP200 de Greg Sullivan, portage kinwie, CC BY 3.0. Dépôt `sfzinstruments/GregSullivan.E-Pianos`, révision `8c3e581acda3594b553948ff0222d4f84a698376`. 47 échantillons mono, jusqu’à quatre nuances, 8 s maximum, 160 kbit/s. La répartition des notes varie selon la nuance ; le lecteur respecte les zones et corrections de hauteur du SFZ d’origine. Certaines prises aiguës sont partagées entre nuances dans la source.
- `r_fashionbass` / `fashionbass` : basse électrique pincée Fashionbass, Karoryfer Samples, CC0. Dépôt `sfzinstruments/karoryfer.fashionbass`, révision `0703973b300a6bacb837602be9b588ab64732a72`. 190 échantillons mono : 19 notes sources, cinq nuances, deux prises alternées. 6 s maximum, 160 kbit/s. Pas de bruitages, key-switches ni effets des variantes shifty/unison.
- Kit `percussion` : VCSL, Versilian Studios, CC0. Dépôt `sgossner/VCSL`, révision `c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e`. 16 pads, 72 frappes, une à quatre nuances et jusqu’à deux prises par élément. Tumba, conga ouverte/étouffée, quinto, bongos ouverts/étouffés, deux sons de darbuka, deux claves, shaker, tambourin, guiro, triangle. MP3 mono, 6 s maximum, 128 kbit/s.
- Les nouvelles banques ajoutent 26,7 Mo compressés et environ 245 Mio décodés à 48 kHz (19 + 209 + 17). Le total des cinq banques expressives est de 544 fichiers et 60,7 Mo. Les fichiers restent chargés à la demande.
- Les licences, SFZ utilisés, crédits et provenance sont livrés. Fashionbass n’a pas de README amont : `SOURCE-README.md` l’indique explicitement et donne une notice générée, sans prétendre être un document original.

### Lecteur et préparation

- Le constructeur de banques lit les SFZ comme données avec des expressions régulières, sans exécuter de code tiers. Les notes, zones, corrections de justesse et limites de vélocité sont reprises ; les paramètres du moteur SFZ complet ne sont pas importés.
- Le lecteur sélectionne d’abord une nuance puis la note source dans cette nuance, au lieu de supposer que toutes les nuances ont les mêmes notes enregistrées. Ce choix évite les trous de registre du Wurlitzer.
- Les répétitions mélodiques utilisent des compteurs par destination de piste et par note dans chaque Mix. Une préécoute ne change pas les variantes de la piste ou celles d’un export.
- Les percussions sélectionnent leur nuance d’après le nombre de couches de chaque pad, pas d’après le maximum du kit. Elles ne déclenchent pas le sidechain du kick et ne passent pas dans le groupe d’étouffement des charlestons.
- Les sources VCSL très faibles sont amplifiées avant compression, pour ne pas encoder un signal minuscule avant de l’amplifier à l’écoute. Le gain de lecture est ensuite calculé sur le MP3 final. Le gain préparatoire est consigné dans la provenance.
- Les téléchargements d’une même source utilisée par plusieurs régions emploient désormais des fichiers temporaires distincts, évitant une course lors de la conversion parallèle. La reconstruction conserve les fichiers dont le hash et la source n’ont pas changé ; `--force` les régénère tous.
- Les échantillons des deux banques 0.17.0 ne sont pas réencodés dans cette extension. Les nouveaux textes et noms des pads existent en français, anglais et espagnol. Catalogue : 56 instruments, dont 32 échantillonnés, et six kits.

### Validation

- Neuf cas BX01–BX09 ajoutés : traductions et sélection, couverture de toutes les notes/nuances du Wurlitzer, justesse, cinq nuances et répétitions de basse, 16 percussions aux forces extrêmes, sample personnel prioritaire et réinitialisation, sauvegarde/rechargement/export, isolation des préécoutes, panne/réessai et accès tactile.
- Les 13 cas ciblés BX + RI01/BN01/SB01/EX05 réussissent sur ce Mac. Les cinq banques sont également chargées depuis l’application Mac empaquetée avec le contrôle natif strict : OK.
- La précédente CI Linux 0.17.0 avait terminé à 264/265 : seul EX05 comparait deux rendus à 1e-7 près et trouvait un écart maximal de 0,00001758. Le contrôle tolère désormais moins d’un pas PCM 16 bits (1/32768), tout en refusant un changement musical de variante. La condition n’est ni supprimée ni ignorée.
- Campagne complète 0.17.1 : **274/274 réussis** sur ce Mac. `npm run build`, contrôle des 544 échantillons, démarrage bureau et application Mac empaquetée avec le module natif : OK. La validation Linux et les constructions des installateurs sont relancées sur GitHub après la sauvegarde de la branche.

`node qa/expressive-demo.cjs --ensemble` produit une démo `.khm`, quatre écoutes WAV et deux captures dans `livrables/v0.17.1/`. Installateur Apple : `release/KH Music Pro-0.17.1-arm64.dmg`. Lanceur d’essai local avec profil distinct ; application installée et version en ligne non remplacées.

Restent à faire avec le propriétaire : écoute humaine, toucher du DGX-670, vraie pédale, Focusrite et micro, latence et appareils mobiles réels. Pas de nouveaux plugins instruments natifs ; ces banques utilisent le lecteur d’échantillons intégré.

## 16. V18 — barre du haut repensée (version 0.18.0, branche `v18`, 18/11/2026)

Demande du propriétaire : refonte ciblée de l'interface, en commençant par la barre du haut ; maquette validée avant le code.

### Ce qui a été fait
- **Barre du haut en trois groupes** (`src/ui/top.ts`) : projet (nom, menu Projet, annuler, rétablir), jeu (transport, compteur, Tap, mesure, métronome, boucle avec sa plage, menu **Prise** : décompte, punch, plage de la boucle), sortie (Exporter + menu ▾ des autres formats, réglages ⚙ : MIDI, carte son, langue ; aide). Tous les identifiants des boutons sont gardés : raccourcis, visite guidée et QA les retrouvent.
- **Barre d'arrangement** `#abar` (nouvel élément de `index.html`, entre la barre du haut et les pistes) : grille, zoom, changement de tempo, repère, notes.
- **Menus** : des `<details>` ; un clic ailleurs ou Échap referme (le focus revient au bouton), un seul ouvert à la fois. Les boutons-symboles (⚙, ▾, ☰) ont un nom accessible ; « Projet » et « Prise » gardent leur mot visible comme nom.
- **Téléphone** (≤ 760 px) : deux lignes sans défilement horizontal ; le groupe de sortie est dans ☰ (toujours ouvert sur ordinateur, bouton caché) ; les listes des menus prennent la largeur de l'écran, sous le bouton qui les ouvre ; « Renommer le projet… » dans le menu Projet (le champ du nom est masqué).
- Sous 1 500 px, le texte « MUSIC PRO » à côté du logo est masqué pour que la barre tienne sur une ligne ; vers 1 100 px elle passe proprement sur deux lignes.
- « Exporter WAV » devient « Exporter » (le format est dans la bulle et le menu ▾). Textes nouveaux en trois langues.
- QA : aides `reveal`, `clickIn`, `selectIn` (ouvrent les menus par de vrais clics avant d'atteindre un bouton rangé) ; cas TB01-TB07 (une ligne sur ordinateur, menus à la souris et au clavier, boucle, téléphone au doigt, écran moyen, traductions). Capture : `qa/shots/v18-phone.png`. MB01 adapté : la barre téléphone fait désormais deux lignes sans défilement (au plus 120 px), au lieu d'une ligne qui défilait.
- Vérifié : campagne complète 338/339 puis MB01 corrigé et repassé avec les autres cas téléphone ; `npm run build` et démarrage de la version bureau OK.

- **Têtes de piste** (`src/ui/arr.ts`, `head`) : ▲ ▼ ⧉ ❄ ✕ rangés dans un menu ⋯ (`details.menu.tmenu`, mêmes classes `tup`, `tdown`, `tdup`, `tfrz`/`data-act=freeze`, `del`) ; la liste est en position fixe à côté du bouton (sinon coupée par la zone des pistes qui défile) et se referme quand les pistes défilent. Repère ❄ à côté du nom d'une piste gelée. Sur téléphone, l'icône du type est masquée pour laisser la place au nom, et le menu ⋯ rend enfin possibles monter, descendre, dupliquer et supprimer au doigt. QA : aide `headAct`, `reveal` sait ouvrir un menu sans identifiant ; cas TH01-TH06.

- **Export MP3** : marge de -1 dB de vraie crête (0,89 au lieu de 0,966) ; un lecteur qui rééchantillonne faisait remonter les crêtes au-dessus de 0,98 (MP01 instable). Ne joue que si l'encodage crée des crêtes ; le WAV ne change pas. **À écouter** : un MP3 très fort, comparé au WAV.
- Campagne complète 345/345 sur ce Mac (après correction de cas de test : icône masquée sur téléphone, défilement qui précède l'ouverture du menu ⋯).

- **Correctifs de l'audit** (session d'audit, branche `v18-correctifs`, fusionnée dans `v18` en avance rapide à `0007113` avec l'accord du propriétaire) : D5 séquenceur au clavier (une seule case dans l'ordre de Tab, flèches, Début, Fin), D6 prise d'un seul tenant, D7 tempo au centième, D8 bandeau de sauvegarde impossible avec « Enregistrer en fichier », D9 vraie disposition du clavier, D10 accordeur confirmé sur 3 mesures sur 5, D11 export des projets de 12 pistes ou plus rendu par groupes en parallèle (42 s → 22,9 s pour le gros projet de 40 pistes). Cas AD01-AD08, en fin de `qa/run.cjs`. Détail, mesures et non-vérifié : `docs/correctifs-audit-2026-11.md`. Campagne 353/353 (session d'audit).

- **Téléphone, défauts D2 à D4 de l'audit** (branche `v19-telephone`, partie de `v19` à `06d3aa6`, 19/11/2026) : Rétablir de nouveau visible (la plage de la boucle est masquée sur le bouton pour lui faire place, la bulle la garde) ; le morceau s'ouvre avec quatre mesures visibles (zoom de départ calculé dans `main.ts`) ; séquenceur par pages de 8 pas entiers, cases de 34 × 44 px, glissé arrêté pile sur les pas 9, 17… (`scroll-snap`, classe `page` tous les 8 pas dans `editor.ts`) ; tout ce qu'on touche fait au moins 44 px (pistes hautes de 104 px, colonne des pistes à 156 px, M/S/A, ⋯, ajout de pistes, menus, barre d'arrangement, éditeur, onglets). Exceptions assumées : les cases du séquenceur font 34 px de large (8 pas sur 375 px), le champ du tempo est petit mais tout le compteur autour le rend touchable. QA PH01-PH04 ; MB01 (colonne des pistes ≤ 160 px) et MB02 (glissé calculé d'après le zoom, couloir d'automation amené à l'écran) adaptés. L'accordeur repart de zéro à chaque ouverture (avant, l'aiguille glissait depuis la note de sa dernière utilisation ; AD06 échouait dans la campagne complète). Campagne complète 404/404. **Repris sur `claude/suite` le 21/11/2026** (la branche n'avait jamais été fusionnée) : adapté à UX15 (accueil du premier lancement, menus qui s'ouvrent en douceur ; l'accordeur remis à zéro y était déjà).

### Reste à faire (suite de la V18)
- Ajout de pistes : toujours dans le coin des pistes (la maquette les plaçait dans la barre d'arrangement).

### Non vérifié
- Un vrai téléphone et un vrai lecteur d'écran (testé dans un navigateur qui simule le tactile).


## 17. V19 — les manques prioritaires de l'audit (version 0.19.0, branche `v19`, 18/11/2026)

Demande : combler la priorité 1 de la partie 3 de l'audit (`docs/audit-2026-11.md`), un chantier à la fois. Branche `v19` partie de `v18` à `59bb5e4`. Pas de fusion dans `main` sans l'accord de Kevin.

### Ce qui a été fait

1. **Pitch bend, molette (CC1), aftertouch** (`input.ts` `ctlIn`, `graph.ts` `CtlNodes`/`schedCtl`, `files.ts`). Chaque piste d'instrument a une « hauteur commune » (`pitch`, un GainNode) branchée sur le `detune` de toutes ses voix : un ConstantSource pour le bend (plage `synth.bend`, ± 2 demi-tons par défaut), un LFO de 5,5 Hz pour le vibrato de la molette (40 cents à fond) et de l'aftertouch (20 cents), et l'aftertouch gonfle aussi l'entrée de la tranche (× 1,4 à fond). Les points sont gardés dans le clip (`clip.ctl`, positions en pas dans le motif, comme les notes) et programmés à chaque pas par le même code à l'écoute et à l'export. Remise au repos à la fin de chaque clip et à l'arrêt. Export MIDI : 0xE0 (14 bits), CC1, 0xD0 ; relus à l'import. Molettes à l'écran (couchées sur téléphone), ligne des contrôles sous le piano roll. Une molette déjà assignée à un réglage du mixeur garde son assignation. Cas CT01-CT12.
   - Piège de test : le navigateur ne calcule pas un réglage audio qu'aucune voix n'utilise ; `bend.offset.value` ne se lit donc qu'avec une note tenue.
2. **Export d'une plage, 24 bits, 48 kHz** (`engine.ts` `renderOffline(p, normalize, range)`, `encodeWav(b, bits)`, `top.ts` `showExportOptions`). Réglages gardés dans le projet (`p.exp`, valeurs par défaut dans `migrate`). Le morceau est rendu depuis le début puis découpé : l'extrait sonne comme dans le morceau (notes tenues, réverb en cours) ; les sons s'arrêtent à la fin de la plage, avec ou sans 2,5 s de queue. Le MP3 et les pistes séparées suivent. Cas XP01-XP08, P06 étendu.
3. **Comping et fondus enchaînés** (`types.ts` `compSet`/`compSlice`/`normComp`, `graph.ts` `audioPieces`). Un clip à prises a `comp` (portions triées, chacune avec sa prise) ; au rendu il devient une suite de morceaux, chacun lu dans sa prise. Deux morceaux qui se touchent reçoivent un fondu enchaîné à puissance constante placé juste après la jonction (le morceau de gauche continue en s'effaçant) : 12 ms entre portions d'un comping, durée choisie (`clip.xfade`, en pas) entre deux clips. Scission, rognage, étirement et inversion tiennent compte des portions. Cas CP01-CP05, CF01-CF04.
4. **Sidechain depuis n'importe quelle piste et envois libres** (`graph.ts` `syncRouting`, `initEnv`). Sidechain : suiveur d'enveloppe en AudioWorklet (attaque 3 ms, maintien 15 ms, relâchement de constante 60 ms : le volume revient en 0,2 s environ) branché sur la piste source avant son volume, qui pilote le gain `duck` de la piste ; chargé aussi dans chaque rendu d'export. Sans source choisie, le kick du séquenceur agit comme avant. Envois : un GainNode par envoi, pris avant le volume (`pdc`) ou après (`pan`), vers l'entrée du bus ; muet et solo s'y appliquent. Sources et envois partent toujours d'une piste, jamais d'un bus : pas de boucle possible. L'export par groupes garde ensemble une piste, ses bus et la source de son sidechain (union de groupes). Le gel d'une source fait suivre sa version audio. Cas SC01-SC04, SD01-SD04.
5. **Quantification fine** (`actions.ts` `quantizeNotes` avec force et swing, `humanizeNotes`, `legatoNotes` ; menu ▾ à côté de 🧲). À 100 % sans swing, le comportement d'avant est gardé (début et durée recalés). Cas QZ01-QZ05.
6. **Instruments Audio Unit du Mac** (accord de Kevin du 19/11/2026 sur l'étude `docs/etude-au-instruments.md`). Module natif (`bridge.mm`) : un plugin de type `aumu` s'ouvre sans entrée audio ; à chaque bloc, l'AudioWorklet range dans la mémoire partagée les évènements MIDI qui y tombent (jusqu'à 256, chacun avec sa position dans le bloc, `hdr[3]` = leur nombre) et le fil natif les donne au plugin (`MusicDeviceMIDIEvent`) juste avant `AudioUnitRender`. `getState`/`setState` lisent et rechargent l'état complet (`kAudioUnitProperty_ClassInfo`, plist binaire en base64). `list` donne aussi les instruments. Application : moteur `au` des instruments (`synth.auUrl`, `auName`, `auState`) ; `playNote` envoie note et relâchement au plugin, les contrôles joués partent en pitch bend 14 bits, CC1 et pression ; la plage du bend est envoyée en RPN 0 à la création ; l'arrêt envoie CC123, CC64 0 et le bend au centre. L'export recrée l'instrument avec l'état de celui qui joue (sinon celui du projet) et attend que tous ses évènements soient arrivés au worklet (`flush`) avant le calcul ; un projet avec un instrument du Mac est rendu d'un seul tenant. La fenêtre du plugin recopie son état dans le projet chaque seconde et à sa fermeture (annulable). Cas AI01-AI05 (module simulé) ; essai réel `node qa/au-instrument.cjs` sur le MacBook Pro M3 avec DLSMusicDevice : **15/15** (note à 0,2 ms près, hauteur, relâchement, pitch bend à l'écoute et à l'export, aucun bloc manqué, jeu en direct, état lu et rechargé).

### Vérifications

- Campagne complète finale : **395/395** sur le MacBook Pro M3 (copie figée, 18/11/2026), puis `npm run build` OK. Une campagne précédente avait donné 393/395 : LT01 (doublons de boutons de prise, corrigé) et AD06, accordeur sensible à la charge du Mac (1 échec sur 8 passages, code non touché par la V19).

- Après le chantier 6 (19/11/2026) : campagne complète **400/400**, `npm run build`, essai réel des effets du Mac `qa/au-bridge.cjs 20` OK, démarrage de la version bureau `qa/desktop-smoke.cjs` OK, essai réel des instruments `qa/au-instrument.cjs` 15/15.

- QA sur la machine Linux de GitHub (19/11/2026) : AD07, XP06 et SD03 comparaient l'export parallèle et l'export d'un seul tenant au seuil de 10⁻⁴ ; Linux y montre jusqu'à 3,5 × 10⁻⁴ (−69 dB, cause non établie, Mac : 2 × 10⁻⁷). Seuil porté à 10⁻³ (−60 dB, inaudible). TH05 : le nom « Batterie » était coupé sur téléphone avec les polices de Linux ; noms un peu plus petits sur téléphone (12,5 px). QZ03 : clic sur la note rendu plus sûr. AD06 (accordeur) reste sensible à la charge de la machine.

### Focusrite de Kevin (19/11/2026)

- Modèle : **Scarlett 4i4 de 3ᵉ génération** (USB 1235:8212), 6 entrées (dont Loopback 5-6) et 4 sorties ; Focusrite Control 2 (1.1210) installé par Kevin, Loopback = Playback 1-2, réglée à 48 kHz. Il a fallu un autre câble USB-C (le premier ne l'alimentait pas).
- Mesure (`au-host rt` avec `KH_OUT=Scarlett KH_IN=Scarlett KH_CH=4 KH_AMP=0.05`, clics à −26 dB renvoyés par le Loopback numérique) :

| Tampon | Aller-retour déclaré par Core Audio | Retard caché mesuré en plus des horodatages |
|---|---|---|
| 256 | 14,3 ms | 0,6 ms |
| 128 | 9,0 ms | 0,4 ms |
| 64 | 6,3 ms | 0,4 ms |
| 32 | 5,0 ms | 0,6 ms |

- Lecture : contrairement au micro et aux haut-parleurs du MacBook (environ 46 ms cachés), la Scarlett ne cache presque rien ; l'aller-retour réel d'un logiciel natif est d'environ ce qui est déclaré, **5 à 9 ms à 32-128**, plus les convertisseurs (≈ 1 ms, non mesurés : le Loopback est numérique). L'objectif de 12 ms est donc atteignable avec le moteur natif. Non mesuré : l'aller-retour de KH Music Pro lui-même (navigateur ou moteur natif, qui ajoute ses réserves de 768/256 échantillons), ni avec un câble analogique de bouclage.
- **KH Music Pro lui-même** (`node qa/latence-carte.cjs Scarlett 4 256 128 64` : la mesure de l'application, clic joué puis retrouvé à l'entrée Loopback, moteur audio natif) :

| Tampon natif | Annoncé par KH (sortie + entrée) | Mesuré par KH (médiane de 6) |
|---|---|---|
| 256 | 35,7 ms (21,9 + 13,7) | 35,0 ms |
| 128 | 30,3 ms (19,3 + 11,1) | 29,3 ms |
| 64 | 27,7 ms (17,9 + 9,8) | 29,6 ms (26 à 33) |

  - Ce que KH annonce correspond à la mesure (à 1 ou 2 ms) : la compensation des prises est juste avec cette carte.
  - L'écart avec les 5 à 9 ms de la carte vient des réserves du moteur natif (768 échantillons en sortie, soit 16 ms, portés de 384 à 768 le 14/11/2026 à cause des hoquets du Mac sur ses haut-parleurs ; 256 en entrée) et de la cadence de Web Audio. Pour jouer un instrument virtuel, seul compte le trajet de sortie : environ 18 à 22 ms. Piste possible : réserves plus petites quand la carte est une vraie interface (à valider par une tenue de 5 minutes sans craquement).
  - Chemin navigateur (moteur natif désactivé) : non mesurable par le Loopback, car Chromium ne capte que 2 voies d'une carte (entrées 1-2). Annoncé par Chromium : sortie 5,3 + 39 ms, entrée 2,7 ms, environ 47 ms. Le mesurer demande un câble de la sortie ligne vers l'entrée 1.
- **Réserves du moteur natif avec la Scarlett** (`node qa/tenue-carte.cjs Scarlett <s> <sortie> <entrée> 4`, démo en boucle à −100 dB, nuit du 18 au 19/11/2026) :

| Réserves sortie / entrée | Délai de sortie annoncé | Durée | Manques sortie | Manques entrée | Surcharges Core Audio |
|---|---|---|---|---|---|
| 768 / 256 (actuel) | 19,3 ms | 1 min | 0 | 0 | 0 |
| 384 / 128 | 11,3 ms | 5 min | 1 | 18 | 0 |
| 256 / 128 | 8,6 ms | 5 min | 40 (d'un coup, vers 5 min) | 0 | 0 |
| 768 / 256 (actuel) | 19,3 ms | 20 min | 1 | 4 | 4 |
| 512 / 256 | 13,9 ms | 20 min | 0 | 1 | 1 |

  - Même au réglage actuel, la Scarlett subit des surcharges signalées par Core Audio (le Mac lui-même, pas la taille des réserves) : 4 en 20 minutes, chacune pouvant faire un petit craquement. Une réserve de 128 en entrée est trop juste (manques répétés). Avec 512 / 256, pas pire que 768 sur 20 minutes, mais l'échantillon est trop petit pour conclure.
  - **Rien n'est changé dans l'application.** Suite possible : des tenues plus longues (une heure par réglage) et chercher l'origine des surcharges (Mac sur batterie, mise en veille d'appareils USB, autres applications).
- **Tenues d'une heure** (19/11/2026, Mac sur secteur, batterie pleine, Focusrite seule branchée) :

  | Réserve de sortie | Manques de sortie | Manques d'entrée | Surcharges Core Audio |
  |---|---|---|---|
  | 768 (actuel) | 19 | 40 | 9 |
  | 512 | 9 | 10 | 3 |

  - Les manques arrivent par paquets, en même temps que les surcharges signalées par Core Audio (« trous ») : ce sont des à-coups du Mac, pas une réserve trop petite. 512 n'est pas pire que 768 (mieux sur cette heure, sans valeur statistique). La batterie en charge est écartée.
  - **Toujours rien de changé dans l'application.** La bonne suite n'est pas la taille des réserves mais l'origine des surcharges : charge du fil audio d'Electron, du fil Web Audio qui remplit la réserve, ou du pilote USB de la carte. Passer à 512 pour une interface reste possible si cette origine est trouvée.
- **Origine trouvée et corrigée** (19/11/2026, commit `d7a7d93`, cas NAT06) :
  - La Scarlett seule, sans KH (`qa/halseul.swift`, sortie Core Audio minimale à 128 échantillons, silence) : **aucune surcharge en 20 min**. Le pilote et le Mac ne sont pas en cause.
  - Cause : Chromium ouvrait aussi la carte du natif pour cadencer Web Audio (horloge « output »). Son fil audio attend le calcul de la page pendant le tour de la carte ; ses retards déclenchent des surcharges de toute la carte, que le natif subit.
  - Correctif (`native-io.ts`, `clockTarget`, réglage par défaut « apart ») : quand le natif joue sur une carte externe, Chromium se cale sur une sortie intégrée du Mac (libellé « (Built-in) »), sans rien y faire entendre ; le régulateur du natif rattrape l'écart entre les deux horloges. Si la sortie du natif est intégrée, ou s'il n'y a pas de sortie intégrée, rien ne change.
  - Tenues de 20 min après correctif (Scarlett, tampon 128) :

    | Réserve de sortie | Manques de sortie | Manques d'entrée | Surcharges |
    |---|---|---|---|
    | 768 (avant le correctif, essai à la main) | 0 | 0 | 0 |
    | 768 | 1 | 0 | 0 |
    | 512 | 0 | 0 | 0 |
    | 384 | 9 | 9 | 3 |

  - Bilan : 3 surcharges en 80 min au lieu d'environ 9 par heure, et la plupart des tenues sans aucun manque. Les surcharges ne disparaissent pas tout à fait (384 : origine non trouvée). **Réserve gardée à 768** ; 512 a tenu 20 min sans manque, à confirmer par une tenue d'une heure avant d'en faire le réglage des cartes externes. Pas vérifié à l'oreille.
- Moteur natif : nouvelle option `inFirst` (première voie d'entrée captée, `io.mm` par la carte des voies de Core Audio) ; elle permettra aussi d'enregistrer les entrées 3-4 de la Scarlett (Yamaha). Pas encore de réglage dans l'interface.
- `au-host rt` prend désormais la voie voulue par la carte des voies de Core Audio (AVAudioEngine ne donne qu'une voie d'entrée).
- **Premier vrai enregistrement du piano (19/11/2026, version installée 0.19.1)** : DGX-670, prise PHONES/OUTPUT → câble en Y (jack stéréo 6,35 → 2 jacks mono) → entrées 1 et 2 de la Scarlett, INST éteint. Niveaux mesurés après réglage des gains : crêtes de −14 à −6 dBFS, rien au-dessus. Montage de Kevin : sortie du système (haut-parleurs du Mac), entrée Scarlett sur la piste audio, « Écoute » allumée (pas de casque), moteur natif éteint. Constaté par Kevin : vumètre et écoute OK, retard d'écoute non ressenti, son net, notes calées sur le métronome à la réécoute. Punch sur les mesures 6-7 d'une prise de 8 mesures : zone bien remplacée (constaté par Kevin). Craquements occasionnels attribués par Kevin à son ordinateur (déjà vus hors de KH), pas étudiés. Pas encore de câble USB du piano : MIDI et son par USB non essayés. Moteur natif avec entrée Scarlett et sortie Mac (deux cartes différentes) jamais essayé.

### Méthode de QA apprise

- Une campagne lancée sur le serveur de développement du dossier de travail est faussée par toute modification de fichier pendant qu'elle tourne (rechargement de la page). La campagne complète tourne donc sur une copie figée du dossier (`rsync` sans `node_modules`, lien vers celui du dossier), comme le fait `qa/all.sh` sur le port 5199.

### Non vérifié

- **L'oreille** : vibrato, gonflement de l'aftertouch, fondus enchaînés, pompage du sidechain et humanisation ne sont jugés que par mesure.
- **Le vrai DGX-670** : pitch bend et molette testés par messages MIDI simulés ; le DGX-670 n'envoie pas d'aftertouch (à confirmer avec le manuel), celui-ci ne sert qu'à d'autres claviers.
- **Un vrai micro** pour le comping : les prises de test sont des sons de synthèse.
- **Windows** et **un vrai téléphone**.
- Mode Live : un clip à comping y joue la prise principale sur toute sa durée ; les fondus enchaînés ne s'y appliquent pas.
- ~~Fondu enchaîné sur un clip qui suit le tempo : le clip de gauche ne se prolonge pas.~~ Corrigé en section 18 (CF05).
- Instruments du Mac : seuls ceux d'Apple ont été essayés (aucun instrument tiers installé) ; un plugin lourd (Kontakt) recharge ses sons à chaque export (plusieurs secondes, beaucoup de mémoire) ; un AUv3 seul n'est pas ouvert (AUv2 seulement) ; pas d'aftertouch polyphonique par note (ramené à la pression de canal) ; la première note jouée pendant le chargement de l'instrument est perdue. La vraie fenêtre d'un instrument n'a pas été ouverte par l'essai automatique (elle s'afficherait sur l'écran) : c'est le même code que pour les effets, vérifié en V17. Module natif construit ici pour la puce Apple seulement (`KH_ARCHS=arm64`) ; la construction universelle se fait sur GitHub.
- Compensation de latence des plugins du Mac sur un envoi qui va vers un bus où la piste ne sort pas : non calée (cas rare).

## 18. Suite des éléments restants (branche `claude/suite`, 21/11/2026)

Demande de Kevin : « mets en place tous ces éléments qui restent à faire ». Branche `claude/suite`, partie de `main` à `8345170` (QA 439/439). Un commit par élément ; pas de fusion ni de changement de version.

### Tri des branches non fusionnées

| Branche | Commit | Sur `main` ? | Suite donnée |
|---|---|---|---|
| `v19` | `9608859` docs : premier vrai enregistrement du DGX-670 par la Scarlett | Non | Repris dans la section 17 (Focusrite de Kevin), avec la précision du commit suivant. |
| `v19` | `ae52403` docs : punch vérifié avec le vrai piano | Non | Repris (même ligne). |
| `v19-telephone` | `5a9f9b8` téléphone, défauts D2 à D4 de l'audit | Non (seule la remise à zéro de l'accordeur y était, refaite par `claude/fix-qa`) | Repris, adapté à UX15 (PH01-PH04). |
| `v19-telephone` | `7e5fe95` fusion de `v19` dans la branche | Oui (son contenu vient de `v19`, déjà dans `main`) | Rien à reprendre. |
| `audit-2026-11` | `d613296` état des lieux (`docs/audit-2026-11.md`) | Non, alors que la passation et `docs/correctifs-audit-2026-11.md` y renvoient | Repris tel quel. |
| `audit-2026-11` | `e8e5541` suite donnée aux défauts | Non | Repris (fin du même fichier). |

Aucune branche n'est supprimée.

### Automation de la tranche et de l'instrument (idée de la feuille de route « automation de tout paramètre »)

- Existait déjà : six réglages de piste, tous les réglages des effets ajoutés et des plugins du Mac (V17).
- Ajouté : clés `set:<champ>` (`SET_AUTO` dans `types.ts`, courbe de 0 à 1 sur la plage du réglage, comme les effets) : graves, médiums, aigus, seuil du compresseur (par rampes ; le gain de compensation suit le seuil comme au mixeur), filtre et résonance de l'instrument (`synthAt`, lus au départ de chaque note : une note tenue garde son timbre, choix assumé car chaque voix a son propre filtre). Groupes « Tranche » et « Instrument » dans la liste des réglages de la courbe ; pas de groupe Instrument pour la batterie ni pour un instrument du Mac. En mode Live, comme les autres courbes, rien n'est appliqué.
- QA : AZ01-AZ04 (souris, export, écoute puis retour au réglage fixe, fichier, traductions) ; AX01 et AX04 adaptés aux nouveaux groupes.
- Suite possible : saturation et lo-fi (courbes de distorsion, il faudrait les recalculer ou les mélanger), enveloppe de l'instrument, filtre suivi en continu sur les notes tenues (un filtre commun à la piste).

### Clips audio qui suivent le tempo (idée de la feuille de route)

- **Déjà fait** depuis la V17 (section 13, étape 5 : « Suit le tempo », WP01-WP07) ; l'idée était restée dans la liste des idées non engagées.
- Ajouté : la dernière limite connue de cette fonction est levée. Un clip qui suit le tempo se prolonge maintenant pendant le fondu enchaîné avec le clip suivant, lu dans sa version étirée au tempo de sa fin (`graph.ts`, `fireClip`). QA CF05 (deux clips à 96 BPM d'origine joués à 120).
- Restent : le mode Live joue au tempo de départ (pas de changement de tempo en Live), écho et trémolo calés sur le tempo de départ.

### Mesures en 6/8 et signatures composées (idée de la feuille de route « 6/8 »)

- Nouveau champ `Project.den` (4 ou 8 ; `migrate` met 4). `BAR` = numérateur × 16 / dénominateur ; nouveau `BEAT` (`types.ts`, `setBar(pas, temps)`) : noire (4 pas) en x/4, noire pointée (6 pas) en 6/8, 9/8, 12/8, croche (2 pas) en 5/8 et 7/8.
- `BEAT` sert au métronome, au décompte (un clic par temps : 2 en 6/8 ; corrige au passage le décompte de 4 clics en 3/4, qui en fait maintenant 3), au compteur mesure.temps.double-croche, au témoin du temps, aux lignes de temps de l'arrangement et du piano roll (qui ignorait jusqu'ici la signature : lignes de mesure toutes les 16 pas même en 3/4), aux cases alternées du séquenceur, au calage « au temps » du mode Live.
- Menu de la signature : valeurs « 2 » à « 7 » inchangées pour x/4 (anciens tests et anciens projets), « 5/8 » à « 12/8 » pour les croches. Export MIDI : évènement de signature (FF 58), y compris en x/4 ; lu à l'import depuis la section 20.
- QA : SG02-SG05 (souris, règle, compteur, séquenceur, métronome et décompte épiés, 12/8 à 5/8, boucle d'une mesure de 7/8 à l'écoute, MIDI, fichier projet, ancien projet).

### Clips enregistrés à la volée en mode Live (idée de la feuille de route)

- N'existait pas : le Live ne faisait que lancer des clips existants.
- Ajouté : ligne « Prise » sous la grille du Live, un bouton ● par piste d'instrument ou de batterie (`live.ts`). La prise attend la mesure suivante (bouton qui clignote), coupe le clip de la piste, crée un clip vide de la longueur choisie (« Longueur d'une prise » dans le panneau de jeu : 1, 2, 4 ou 8 mesures, `Project.liveLen`, **2 par défaut**, validé par Kevin le 21/11/2026) placé après le dernier clip de la piste (il prend donc la ligne suivante de la grille et apparaît dans l'arrangement), y range les notes (calées sur la grille du piano roll) et les coups de pad joués au clavier, au MIDI ou à l'écran, puis le lance en boucle dès sa fin (`engine.recordLive`, `liveRec`, `liveRecPos` ; `input.ts`, `engine.onLiveRec`). Une note jouée jusqu'à une double-croche avant le départ compte pour le premier temps. Une note encore tenue à la fin va jusqu'au bout du clip et continue de sonner jusqu'au relâchement. Second appui : prise abandonnée. Arrêter pendant la prise : on garde ce qui a été joué (rien si rien n'a été joué). La fin de la prise est une entrée de l'historique (Annuler la retire).
- QA : LR01-LR04 (souris, clavier, position des notes, batterie et nuance, boucle audible, arrangement, abandon, arrêt, fichier, ancien projet, traductions).
- Restent : prise audio (micro) à la volée, longueur libre (arrêter la prise d'un second appui pour en fixer la longueur), enregistrement par-dessus un clip qui tourne (overdub). ~~Pitch bend et molette pendant la prise.~~ ~~Arpégiateur (ses notes ne sont pas rangées).~~ Faits en section 20 (LR05, LR06).

### Chaînes d'effets qui remplacent la tranche fixe : plan (réalisé depuis, voir section 19)

Verdict : **pas compatible sans une migration** de l'architecture actuelle, donc non fait dans cette suite. La tranche fixe (filtre, saturation, lo-fi, chorus, trémolo, égaliseur, compresseur) est câblée une fois pour toutes dans `makeTrack` (`graph.ts`) ; ses réglages sont des champs de la piste lus par le mixeur, l'assignation MIDI (`RANGES` dans `input.ts`), l'automation (`filter`, `chorus`, `set:eq*`, `set:compThr`), les modèles de mixage et les cas d'empreinte sonore. La chaîne d'effets est une liste dynamique (`syncInserts`) branchée entre `insIn` et `insOut`, après le compresseur. Les deux se rejoignent bien, mais remplacer l'une par l'autre touche tout ce qui lit ces champs.

Plan proposé, en une ou deux sessions :
1. Nouveaux types d'effet `filter`, `drive`, `lofi`, `chorus`, `trem`, `eq3`, `comp` dans `FX` et `buildInsert`, en reprenant le code de `makeTrack` (`djFreqs`, `driveCurve`, `crushCurve`, gain de compensation). Rien ne change pour les projets existants.
2. Champ de piste `strip: 'fixe' | 'chaine'` (`migrate` : `'fixe'`). En `'chaine'`, `sync` branche `input` directement sur `insIn` (comme le débranchement des branches au neutre de la V17) ; la limite de huit effets ne compte pas ces sept-là.
3. Action « Convertir la tranche en effets » (annulable) : les valeurs fixes deviennent des effets en tête de chaîne, dans l'ordre actuel du son, et les courbes `filter`, `chorus`, `set:*` sont renommées en `ins:<effet>:<réglage>`. Retour possible tant que l'ordre n'a pas changé.
4. Mixeur : en mode chaîne, les sections égaliseur / compresseur / couleur montent les réglages de l'effet correspondant (ou disparaissent : **décision d'interface pour Kevin**) ; assignations MIDI redirigées vers l'effet.
5. QA : rendu identique avant et après conversion (comparaison échantillon par échantillon, comme AD07), courbes conservées, annuler, fichier, assignation MIDI, gel, export par groupes.

### Non faits, décisions et vérifications pour Kevin

- **Non faits** : installateurs signés (il faut les certificats de Kevin : Apple Developer ID et notarisation, certificat de signature Windows ; à brancher ensuite dans `desktop.yml` par les secrets du dépôt) ; travail à plusieurs (il faut un serveur et des comptes : aucun backend dans ce projet, qui garde les morceaux dans l'appareil et le fichier `.khm`).
- **Décisions de Kevin** : toutes tranchées le 21/11/2026, voir ci-dessous.
- **Pour Kevin** : écoute (filtre et égaliseur automatisés, fondu enchaîné d'un clip qui suit le tempo, métronome et décompte en 6/8), vrai matériel (clavier MIDI pendant une prise à la volée du Live), vrai téléphone (cibles de 44 px, séquenceur par pages de 8 pas, Rétablir), accordeur avec un instrument ; sur le Mac (décisions du 21/11/2026) : premier lancement de la version bureau avec le moteur natif allumé tout seul (son, prise, EarPods branchés puis débranchés, puis « Désactivé » retenu au lancement suivant), menu ⋯ ouvert pendant une prise au clavier MIDI, kit Studio joué doucement puis fort.

### Décisions de Kevin du 21/11/2026, appliquées sur `claude/suite`

1. **Moteur audio natif activé par défaut sur Mac.** Version bureau macOS avec le module natif : au lancement, `initNative` (`src/ui/native.ts`) allume le moteur natif sauf si l'utilisateur l'a désactivé dans 🔧 Réglages audio (choix retenu : `localStorage` `kh-native` = `0`). Rien n'est retenu tant que l'utilisateur n'a pas touché au réglage. Pour le couper : l'interrupteur « ⚡ Moteur audio natif » (retenu), ou `KH_NATIVE=0` au lancement (module ignoré, comme avant). Repli automatique : module absent ou qui ne charge pas (le préchargement n'expose alors pas `window.khNative`) → chemin navigateur ; carte son refusée au démarrage → retour au navigateur sur la sortie choisie, sans message d'erreur à l'écran (allumage automatique), la raison restant affichée dans les Réglages audio. Site web, Windows et Linux : inchangés (le module n'est chargé que sur macOS, `electron/main.cjs`). Aide du réglage complétée en trois langues. QA : NAT07 (allumage par défaut, choix « Désactivé » retenu, échec au lancement, version web) ; NAT02 renommé (il part d'un moteur arrêté) ; `qa/packaged-mac.cjs` attend désormais le moteur natif allumé au premier lancement (ou, sans `--strict`, le repli sur le navigateur faute de carte son).
2. **Batterie à plusieurs nuances « Virtuosity Drums »** : **déjà faite** depuis la V17.1 (section 14, commit `f0e705e`, 16/11/2026), la mention « non tranchée » de cette section était en retard. C'est le kit **Studio** des pistes Batterie (banque `studio_drums`), intégré comme les autres instruments SFZ : données audio seules téléchargées depuis la source officielle `sfzinstruments/virtuosity_drums`, révision figée `9f04cf9a734527edfbb0a4eee1f674e45bbf71bc`, converties en MP3 mono 128 kbit/s par `tools/build-expressive-banks.py`, empreintes dans `public/banks/expressive-provenance.json`, chargement à la demande par `banks.ts`. Sélection : 16 pads, 115 frappes ; 4 couches de vélocité pour 11 pads, 3 pour 4 pads, une seule pour le pad 13 (rangée 12, déjà exclue des nuances par EX04) ; jusqu'à 3 variantes alternées. Licence CC0 1.0 (`studio_drums/SOURCE-LICENSE`, `public/banks/CREDITS.txt`, README). Poids : 5,4 Mo (5 416 374 octets) déjà dans le dépôt ; **rien d'ajouté** par cette décision. QA ajoutée : VD01 (le kit se charge depuis le menu Kit ; sur la grosse caisse et la caisse claire, une frappe douce et une frappe forte jouent deux enregistrements différents, repérés au moment où le son démarre, et la forte sonne plus fort), en plus d'EX01-EX10.
3. **Le menu ⋯ d'une piste reste ouvert au redessin.** Avant, tout redessin de l'arrangement (une note jouée pendant une prise, la lecture, un réglage) recréait les têtes de piste et refermait le menu. Désormais `renderArr` (`src/ui/arr.ts`, `keepTrackMenu`) rouvre le menu ⋯ de la même piste dans la nouvelle tête, à la même place, sans rejouer son déroulé (classe `kept`, `style.css`), avec le focus sur ⋯ ou sur la même action. Il se referme sur un clic dehors, Échap, un choix, ou un défilement des pistes qui l'éloignerait de son bouton (comportement de TH04 gardé). Piste supprimée entre-temps : rien à rouvrir. QA : TH07 (réglage, lecture, notes jouées en prise, arrêt, focus, Échap, clic dehors, choix) ; X08 adapté : il vérifiait la suppression pendant l'écriture d'une note en contournant la fermeture ; il vérifie maintenant que le menu reste ouvert après le redessin causé par la note, puis supprime la piste pendant l'écriture d'une autre note.
4. **Prise à la volée en Live : 2 mesures par défaut.** Valeur actuelle confirmée par Kevin : **validée**, rien ne change dans le code (`Project.liveLen`, `migrate` met 2 ; LR01-LR04).

### Vérifications de la suite

- `npx tsc --noEmit` et `npm run build` sur Linux ; QA des cas touchés en local (navigateur Chromium de Playwright), puis campagne complète sur la branche poussée (GitHub Actions). Rien n'a été écouté ni essayé sur Mac, Windows, téléphone ou matériel réel.

## 19. Chaînes d'effets qui remplacent la tranche fixe (branche `claude/chaines-effets`, 21/11/2026)

Réalisation du plan de la section 18, partie de `main` à `760a364` (QA 459/459). Pas de fusion ni de changement de version (0.19.1).

### Ce que voit le musicien

- Fenêtre **Effets** d'une piste ou d'un bus : en tranche fixe, deux boutons, **⛓ Convertir la tranche en effets** et **Tout le projet** (pistes et bus). Le filtre, la saturation, le lo-fi, le chorus, le trémolo, l'égaliseur et le compresseur deviennent des effets en tête de chaîne, dans l'ordre du son, avec leurs réglages et leurs courbes ; le son ne change pas. Une seule entrée d'annulation.
- En mode chaîne : la liste se modifie librement. Nouveau groupe « Étages de tranche (un de chaque) » dans le menu d'ajout ; un étage ajouté se range à sa place dans l'ordre du son, avant les effets ordinaires (on peut ensuite le déplacer). Les étages ne comptent pas dans la limite de huit effets. Déplacement par ▲ ▼ (comme avant), en faisant glisser la poignée ⠿ (souris ou doigt), ou au clavier avec Alt + ↑ / ↓ sur la poignée (le focus suit la carte).
- **Revenir à la tranche fixe** : possible tant que les étages restent en tête, dans l'ordre du son, allumés (le compresseur peut être éteint) et sans courbe que la tranche fixe ne sait pas jouer (trémolo ; la fréquence du médium et le taux le peuvent depuis la section 20). Sinon le bouton est grisé et la raison s'affiche. Un étage retiré revient à sa valeur neutre ; si c'est le filtre, le filtre au repos de la tranche fixe revient (il coupe l'extrême aigu en pente douce, voir plus bas).
- **Mixeur** d'une tranche en chaîne (choix par défaut sur la décision laissée à Kevin, voir « À valider ») : badge **⛓ Chaîne** (ouvre la fenêtre Effets) ; les curseurs d'égaliseur, filtre, saturation, chorus, trémolo, lo-fi et compresseur règlent le premier effet de ce type dans la chaîne ; un étage absent n'a pas de curseur. L'interrupteur du compresseur allume ou éteint l'effet. La courbe d'égaliseur affichée suit les filtres et égaliseurs allumés de la chaîne, la réduction de gain suit le compresseur de la chaîne. Les préréglages de mixage règlent les effets et créent ceux qui manquent.
- **Assignation MIDI** : un bouton assigné au filtre, à la saturation, au chorus, au trémolo ou au lo-fi d'une piste en chaîne règle l'effet correspondant (rien s'il n'y en a pas).
- **Automation** : chaque réglage des étages se trace dans le groupe de son effet (« 1. Filtre », « 6. Égaliseur 3 bandes »…), y compris deux réglages qui ne l'étaient pas dans la tranche fixe : la profondeur du trémolo et la fréquence du médium. Saturation et lo-fi restent non automatisables (courbe recalculée, comme dans la tranche fixe). En mode chaîne, le groupe « Tranche » et les courbes de filtre et de chorus de la piste disparaissent de la liste.
- Les anciens projets s'ouvrent en tranche fixe, à l'identique : rien n'est converti sans le demander.

### Comment c'est fait

- Format : nouveau champ `Track.strip` (`'fixe' | 'chaine'`), mis à `'fixe'` par `migrate` pour les pistes et les bus. Sept nouveaux types d'effet dans `FX` (`types.ts`) : `filter` (v, −1 à 1), `drive` (amt), `lofi` (amt), `chorus` (mix), `trem` (depth), `eq3` (low, mid, freq, high), `comp` (thr, ratio). `STRIP_FX`, `isStripFx`, `fxCount` (limite de huit sans les étages).
- `src/chain.ts` (nouveau) : `stripToChain`, `canRevert`, `chainToStrip`, `stripGet`, `stripSet`, `addStripFx`. Conversion : le filtre est toujours repris (dans la tranche fixe, il est toujours traversé, même au repos) ; les autres étages seulement s'ils changent le son ou ont une courbe ; un compresseur éteint mais réglé ou automatisé devient un effet éteint. Courbes renommées : `filter` → `ins:<filtre>:v` (valeur (v + 1) / 2), `chorus` → `ins:<chorus>:mix`, `set:eqLow|eqMid|eqHigh` → `ins:<eq3>:low|mid|high`, `set:compThr` → `ins:<comp>:thr` ; `autoShow` suit. Les champs de tranche reviennent au neutre.
- `graph.ts` : `buildStripFx` reprend exactement les nœuds, réglages et branchements de `makeTrack`/`sync` (mêmes valeurs de départ, même contournement de l'égaliseur à plat, mêmes branches de chorus et de trémolo débranchées au neutre, gain de compensation du compresseur). `InsNode.set` reçoit les réglages automatisés (résonance du filtre balayé, branches allumées). En mode chaîne, `sync` débranche l'entrée de la tranche fixe et la branche droit sur la chaîne. `eqCurve` et `reduction` (déplacée de `engine.ts` dans `Mix`) lisent la chaîne.
- Écoute et export : même graphe (`Mix`), donc rien de spécifique pour l'export, le gel ni l'export parallèle ; c'est vérifié par les cas CE08 et CE09.

### Vérification de l'identité du rendu (migration)

- CE01 : un projet de mesure (trois synthés : les sept étages réglés ; courbes de filtre, chorus, graves et seuil avec écho et phaser ; tranche neutre ; une piste audio de son calculé sortie dans un bus réglé) est enregistré sans le champ `strip`, rouvert (migration), rendu piste par piste (avec le bus), converti par « Tout le projet », puis rendu de nouveau : **écart nul, à l'échantillon près, pour chaque piste**. Le morceau entier est comparé aussi : l'écart reste celui de deux rendus du même projet (environ 1 à 2 × 10⁻⁴), car le navigateur ne garantit pas l'ordre dans lequel il additionne plusieurs pistes.
- Pourquoi pas de batterie ni de réverb dans ce projet : les sons de bruit de la batterie et la réponse de la réverb sont tirés au hasard, et le calcul de la réverb du navigateur n'est pas reproductible d'un rendu à l'autre ; ils empêchent toute comparaison à l'échantillon près (même sans conversion). Leur code n'est pas touché par la conversion.
- CE02 : fichier enregistré puis rouvert (écart nul) ; Annuler ; retour à la tranche fixe (écart < 10⁻⁶, dû à l'aller-retour de la courbe de filtre en virgule flottante). CE09 : le gel d'une piste en chaîne donne exactement le même son que le gel de la même piste en tranche fixe.

### QA ajoutée

CE01-CE10 (migration et identité, sans perte et retour, ajout/retrait/déplacement à la souris et au clavier, mixeur, MIDI, automation du filtre de la chaîne, automation du trémolo et de la fréquence du médium, export identique à la lecture et export parallèle, gel, traductions et clavier).

### Constat en passant (non corrigé)

- ~~Le gel d'une piste rend son son à travers le volume général et le limiteur du général, puis la piste gelée repasse par eux : un morceau gelé sonne environ 0,9 dB plus bas avec le général à 90 % (FZ01 tolère 1 dB), davantage sur une piste forte qui touche le limiteur.~~ Corrigé en section 20 (FZ06).

### À valider par Kevin

- **Décision d'interface (section 18, étape 4)** : choix par défaut appliqué, les sections du mixeur pilotent les effets de la chaîne et cachent les curseurs des étages absents. L'autre possibilité était de les retirer du mixeur en mode chaîne.
- Valeurs par défaut d'un étage ajouté à la main : saturation et lo-fi à 30 %, chorus et trémolo à 50 %, filtre au repos, égaliseur à plat (médium à 1 kHz), compresseur à −24 dB et 4:1 (les valeurs de la tranche).
- Les nouvelles pistes restent en tranche fixe ; la conversion est toujours demandée.

### Pour Kevin : à écouter

- Un vrai morceau converti par « Tout le projet » : il doit sonner pareil (vérifié par mesure, jamais à l'oreille), y compris la batterie et la réverb, non comparables par mesure.
- Une conversion **pendant la lecture** : les nouveaux effets partent de leurs valeurs de départ et rejoignent leurs réglages en 15 ms environ ; un petit souffle ou clic est possible à ce moment-là.
- Le glisser-déposer des effets au doigt sur un vrai téléphone ou une tablette.
- Le trémolo automatisé de rien à fond, et la fréquence du médium balayée, sur un vrai son.

## 20. Suite 3 (branche `claude/suite-3`, 22/11/2026)

Demande de Kevin (« oui vas-y ») : faire ce qui reste et qui peut se faire sans lui. Branche `claude/suite-3`, partie de `main` à `43ed207`. Un commit par élément ; pas de fusion ni de changement de version (0.19.1).

### Gel d'une piste au bon niveau

- Défaut constaté en section 19 : le rendu du gel passait par le volume général, son filtre, son égaliseur, sa largeur et son limiteur, puis la piste gelée y repassait. Un morceau gelé sonnait donc plus bas (0,9 dB avec le général à 90 %, bien plus avec un général bas ou un égaliseur du général poussé).
- Corrigé : le rendu du gel s'arrête avant le général (`renderOffline(…, { stem: true })`, général à 100 %, comme les rendus par groupes de l'export parallèle). Changer ensuite le général change la piste gelée comme l'originale.
- QA : FZ06 (général à 50 %, égaliseur, filtre et largeur du général réglés : écart sous 0,3 dB avant et après le gel ; puis général changé : gelé et dégelé sonnent pareil). FZ06 échoue sans le correctif (0,73 dB sur le morceau de démonstration).

### Arpégiateur et répétition de notes pendant une prise à la volée du Live

- Avant : pendant une prise à la volée (section 18), les notes égrenées par l'arpégiateur et les coups répétés d'un pad tenu (répétition de notes) sonnaient mais n'étaient pas rangés dans le clip ; seules les touches et les frappes elles-mêmes l'étaient.
- Désormais (`input.ts`, `liveSpotAt`) : chaque note de l'arpège est rangée à l'instant où elle sonne, calée sur la grille du piano roll (ou sur le pas de l'arpège s'il est plus fin), longue d'un pas d'arpège, à la nuance de la touche ; chaque coup répété va dans la case la plus proche du motif, à la nuance des coups répétés (0,85). Comme pour les notes jouées, rien n'est rangé avant la double-croche qui précède le départ ni après la fin de la prise.
- L'arpège du Live garde son horloge libre (il n'est pas calé sur la mesure du Live, comme avant) : ses notes sont donc aimantées sur la grille au rangement.
- QA : LR05 (arpège montant à la noire sur deux touches : 3 à 5 notes alternées, une par noire, nuance gardée ; pad tenu avec répétition à la croche : coups rangés). LR05 échoue sans le correctif (aucune note rangée).

### Pitch bend, molette et pression pendant une prise à la volée du Live

- Avant : ces gestes (clavier MIDI ou molettes à l'écran) jouaient pendant une prise à la volée mais n'étaient écrits que dans un enregistrement de l'arrangement.
- Désormais (`ctlIn`, `input.ts`) : ils sont écrits dans le clip de la prise, avec les mêmes règles que l'enregistrement (courbe allégée, retour au repos exact, un nouveau geste remplace l'ancien sur la même zone). Le clip ne jouant pas encore pendant la prise, l'écriture est immédiate. Le clip enregistré rejoue ensuite sa courbe en boucle, comme tout clip du Live.
- QA : LR06 (note, montée du bend, molette à 90, retour du bend au centre : courbes gardées et dans le clip). LR06 échoue sans le correctif (courbe vide).

### Icônes dessinées : deuxième tranche (suite de l'amélioration UX15 n° 13)

- La première tranche (branche `claude/ux15`) avait dessiné les types de piste et les boutons les plus visibles ; restaient en emojis l'éditeur (accordeur, quantification, pads), les réglages et les modèles.
- Dessinés maintenant (`src/ui/icons.ts`, même trait, couleur du texte) : réglages et chargement d'un pad (roue dentée, dossier), quantification et humanisation (aimant, dé), ouverture du micro et écoute de l'entrée audio, où se trouve l'accordeur (micro, casque), bouton des réglages, connexion MIDI, réglages audio et options d'export (roue dentée, prise MIDI, clé), mesure de latence (règle), modèles de la fenêtre des projets (page, flamme, boule à facettes, tasse, étincelles).
- Les noms accessibles ne changent pas (les boutons à symbole seul gardent leur `aria-label`).
- Restent des emojis ou symboles, hors du périmètre de la tranche : flocon du gel, ⚡ du moteur natif et du sidechain, 🍎 des plugins du Mac, 🎻 des instruments enregistrés, 🎹 du clavier à l'écran, 🎚 des réglages de l'instrument, 🪟 des fenêtres de plugin, ✂ 🔪 ⇄ 📈 de l'éditeur audio, 🧭 de la visite guidée, ★ des favoris. Les symboles typographiques (▶, ↶, ⚑, ♩, ✕) restent : ils ont le même dessin partout.
- QA : UX13b (pads, quantification, entrée audio, réglages, fenêtre audio, modèles : icônes attendues, aucun emoji, noms accessibles).

### Automation de la fréquence du médium et du taux du compresseur dans la tranche fixe

- Avant : ces deux réglages ne s'automatisaient qu'une fois la tranche convertie en chaîne d'effets (section 19), et une courbe sur l'un d'eux empêchait le retour à la tranche fixe.
- Désormais : clés `set:eqMidF` (200 Hz à 8 kHz) et `set:compRatio` (1:1 à 20:1), mêmes plages logarithmiques que les réglages de l'effet de la chaîne, donc courbe reprise telle quelle par la conversion dans les deux sens (`CURVES`, `chain.ts`). Dans la liste des réglages de la courbe, groupe « Tranche » : graves, médiums, fréquence du médium, aigus, seuil, taux. Le gain de compensation du compresseur suit le seuil et le taux (courbe ou réglage fixe), comme au mixeur. À l'arrêt, les deux réglages reviennent à la valeur du mixeur. Le retour à la tranche fixe n'est plus refusé pour ces deux courbes (texte de la raison mis à jour en trois langues) ; il l'est toujours pour une courbe de trémolo.
- QA : AZ05 (fréquence tracée à la souris, export plus brillant à la fin, valeur suivie à l'écoute puis rendue au mixeur ; taux de 1:1 à 20:1 comparé aux taux fixes ; conversion en chaîne sans changement de son, courbes passées aux effets, retour sans perte ; libellés traduits) ; AZ01 adapté (six réglages dans le groupe Tranche).

### Signature lue à l'import d'un fichier MIDI

- Avant : l'export MIDI écrivait la signature (section 18) mais l'import l'ignorait ; un fichier en 6/8 arrivait dans un projet en 4/4.
- Désormais (`importMidi`, `files.ts`) : la signature du début du fichier (FF 58 au premier instant ; les changements en cours de morceau restent ignorés, faute de signatures multiples) est lue si l'application la connaît (2/4 à 7/4, 5/8, 6/8, 7/8, 9/8, 12/8). Comme le tempo, elle n'est reprise que par un projet vide (`importMidiFile`) ; les clips importés se comptent alors dans ses mesures. Un projet déjà commencé garde sa signature. Une seule entrée d'annulation pour l'import.
- QA : SG06 (projet commencé en 4/4 inchangé ; projet vide passé en 6/8 avec le menu à jour, clip de 24 pas, Annuler ; 12/8 et 7/4 lus ; 11/8 ignoré).


## 21. V20 — Du son à la séquence (branche `v20`, 23/11/2026)

Charger un son (usage personnel ; pas de téléchargement YouTube dans l'appli) et en tirer de quoi refaire le morceau : menu Projet › « Du son à la séquence… ». Cinq analyses : chant → notes, tempo et tonalité (VX) ; séparation des pistes, Demucs en qualité maximale avec un mode rapide en secours (SEP) ; basse et piano → notes (PO) ; batterie → motif du séquenceur (DR) ; familles d'instruments avec YAMNet (IN). Détail, méthodes, mesures et non-vérifié : `docs/v20-du-son-a-la-sequence.md`.

- Construite par cinq sessions en parallèle sur le socle `v20`, puis rassemblée sur `v20` (commit 08f96f5). Nouvelles dépendances : `onnxruntime-web`, `@tensorflow/tfjs-*` ; modèles dans `public/models` (Demucs ~175 Mo en 4 parties, YAMNet).
- Campagne complète du 23/11/2026 au calme : 565/566. SEP20 (séparation au doigt sur téléphone) a dépassé son attente de 60 s pendant la campagne ; seul, il passe 2 fois sur 2. Demucs prend environ 4 min par minute de son sur le Mac.
- `KH_PORT` choisit le port du serveur de QA (`KH_PORT=5231 npm run qa:all`) pour faire tourner plusieurs campagnes en même temps.
- Base : `main` (0.18.0). La V19 (branche `v19`) n'y est pas : à réconcilier avant toute fusion. Numéro de version non changé.
- Non vérifié : vraies chansons, vraie voix, écoute à l'oreille, installateurs avec le modèle (+175 Mo chacun), Windows, vrai téléphone.

### Suite du 24/11/2026 : essai sur une vraie chanson, notes par modèle, tempo stabilisé

Kevin a fourni une vraie chanson (« Tous les jours », 7 min ; jamais mise dans le dépôt : `public/_essai/` est exclu de git, à ne jamais committer).

- **Premier essai (calculs maison) : « complètement raté » à l'écoute.** Les cas de QA sur sons fabriqués ne prouvaient rien sur de la vraie musique. Leçon : seul l'avis de Kevin à l'oreille valide une transcription.
- **Notes par le modèle Basic Pitch** (Spotify, Apache 2.0, 0,9 Mo dans `public/models/basic-pitch`, `src/analysis/bp/`) pour le chant, la basse et le piano ; les calculs maison restent en secours (cas PO et VX les testent avec `kh.analysis.bp.off = true`). Cas BP01-BP05. Verdict de Kevin sur la reconstitution : « beaucoup mieux, ça commence à venir, pas encore totalement ça ».
- **Tempo qui bouge** : temps suivis un par un (`tempoPath`, `beatTrack`), parties calées dessus (`warpNotes`), marques de tempo posées par « Appliquer le tempo ». Cas TM01-TM05.
- **Tempo stabilisé (retour de Kevin : « le tempo semble accélérer puis ralentir »)** : les temps suivis tremblaient (48 marques de tempo sur la chanson, intro suivie à moitié tempo). `steadyGrid` (`src/analysis/vx-dsp.ts`) les remplace par des tronçons de tempo constant raccordés bout à bout (coupe seulement si c'est nettement mieux, recoupe là où le tempo glisse vraiment, ramène les tronçons suivis à la moitié ou au double à la pulsation principale). Résultat sur la chanson : 6 tronçons au lieu de 48 (115 à 118 BPM jusqu'à 4:55, puis 87). `Result.tempoSecs` porte les tronçons. Cas TM06-TM10.
- **Doute non levé** : la fin de la chanson (à partir de 4:55) est lue à 87 BPM. D'après les attaques, c'est probablement un passage en ternaire (6/8) à la même pulsation plutôt qu'un vrai ralenti ; KHMP le range à 87 BPM, où les notes tombent sur la grille des doubles-croches. À faire juger par Kevin.
- **Pistes de progrès** : piano trop chargé (la piste « autres » de Demucs contient guitares, claviers et nappes ; une version allégée a été soumise à l'écoute de Kevin) ; sons d'instruments choisis d'office (flûte pour le chant) ; mesures ternaires (pas de grille en triolets) ; reconnaissance d'instruments incomplète.
- **Sessions d'agents V20** : archivées le 24/11/2026 à la demande de Kevin (tout leur travail est dans `v20`).

### Suite du 24/11/2026 (après-midi) : séparation en six pistes, partie guitare

Retour de Kevin sur la reconstitution : « le piano essaie de faire la guitare et d'autres instruments ». Cause : à quatre pistes, guitare, piano et claviers étaient mélangés dans « autres ». Un essai hors de KHMP avec Demucs à six pistes (session parallèle) a été validé par Kevin à l'oreille (« basse et batterie nickels », guitare bien, piano « pas mal » mais discret dans ce chant), puis il a demandé le branchement.

- **Modèle** : `htdemucs_6s` remplace le modèle à quatre pistes (`public/models/htdemucs6/`, 177 Mo ; l'ancien dossier `htdemucs/` est retiré). Le fichier d'origine ne tourne pas dans le navigateur (double précision, mémoire) : on n'a gardé que le cœur du réseau, voir `public/models/README.md`. Mesuré sur 30 s de la chanson dans Chromium : 132 s sur le processeur, 188 s sur la carte graphique du Mac (environ 4 à 6 min par minute de son).
- **Pistes** : voix, batterie, basse, guitare, piano, autres avec Demucs ; quatre pistes (sans guitare ni piano) en mode rapide. « Ajouter toutes les pistes ».
- **Guitare → notes** (nouvelle analyse, `guitar-notes`, son `r_eguitar`) : lit la piste guitare, sinon « autres ». **Piano → notes** lit la piste piano quand elle existe.
- **Piano nettoyé** : piste piano presque vide (35 dB sous le morceau) → pas de partie, message ; piste bien plus faible que la voix (12 dB) et mélodie chantée connue → on retire les notes qui doublent le chant (`dropVocalLeak`). Lancer « Chant → notes » avant « Piano → notes » pour en profiter.
- **QA** : PO16-PO20 (guitare, piano), SEP23 vérifie les six lignes ; cas SEP adaptés au nouveau modèle.
- **Non vérifié** : piano sur un morceau où il mène ; guitare en accords saturés ; durée de la séparation complète d'une chanson dans le navigateur (seulement 30 s mesurées ; la reconstitution d'essai a utilisé les six pistes calculées hors navigateur, celles que Kevin a écoutées) ; reconnaissance des familles d'instruments pas encore reliée aux pistes guitare et piano ; téléphones, Windows.
- **Campagne complète du 24/11/2026 (six pistes)** : 583/586, puis les trois restants verts — TH02 et SEP20 passent relancés seuls (sensibles à la charge), PO01 attendait l'ancien texte d'aide du piano (test corrigé). `npm run build` passe. HawkScan toujours pas lancé (`HAWK_API_KEY` absente).

### Reprise (état au 24/11/2026 au soir)

- Branche `v20`, worktree `.claude/worktrees/v20`, tout poussé. Rien dans `main` ; V19 (`v19`) à réconcilier avant toute fusion ; numéro de version non changé.
- **En attente : le verdict de Kevin à l'écoute** de `~/Downloads/Tous les jours - reconstitution v4 six pistes.m4a` (guitare et piano séparés, tempo stabilisé).
- Fichiers d'essai hors git, dans le worktree : `public/_essai/chanson.mp3` (la chanson) et `_essai-local/` (les six pistes validées par Kevin en WAV, le modèle d'origine `htdemucs_6s.onnx`, `recon.cjs` qui refait la reconstitution, `sep6.cjs` qui essaie la séparation dans le navigateur). Ne jamais les committer.
- Pour refaire une reconstitution : `npx vite build --outDir <dossier>` puis `npx vite preview --outDir <dossier> --port 5261` (copie figée : le serveur de dev recharge la page pendant les longs calculs), copier les pistes dans `<dossier>/_stems6/`, puis `node _essai-local/recon.cjs "$PWD" x <sortie> http://localhost:5261/ bp` (environ 20 min).
- Questions ouvertes pour Kevin : la fin de la chanson (4:55) est-elle un ralenti ou un passage en ternaire ? le piano est-il trop présent (piste très faible mais 1 250 notes jouées à volume normal) ?
- Pistes de travail : volume des parties d'après le niveau de leur piste ; relier la reconnaissance d'instruments aux pistes guitare et piano ; séparer une chanson entière dans KHMP (seulement 30 s mesurées) ; préférer le processeur à la carte graphique quand il est plus rapide ; grille ternaire.

### Suite du 25-26/11/2026 : rendu fidèle (branche `v20`)

Essai mixte du 25/11 (vraie voix et vraie batterie, basse, guitare et piano rejoués) jugé « pas encore ça ». Cause principale trouvée par le calcul : **les parties rejouées étaient 2,2 s en avance** sur les vraies pistes (elles commencent au premier temps trouvé, les vraies pistes au début du son ; mesuré par corrélation des attaques). Le même décalage existait dans KHMP quand on ajoutait au morceau les pistes séparées et les parties.

- **Pistes séparées calées sur le premier temps** : « Ajouter » / « Ajouter toutes les pistes » ouvre chaque piste à son premier temps quand le tempo a été trouvé (ce qui précède est coupé, c'est dit dans le message).
- **Nuances de la vraie piste** : à l'ajout d'une partie (chant, basse, guitare, piano), chaque note prend la force mesurée sur sa vraie piste ; les notes posées là où la vraie piste est muette sont retirées (sur la chanson : 497 notes de piano sur 1 256, 73 de basse, 19 de chant, 9 de guitare).
- **Six cordes** : la guitare joue six notes au plus en même temps (23 notes étouffées sur la chanson) ; le piano dix.
- **Volume calé** : juste après l'ajout, KHMP règle le volume de la piste pour qu'elle sonne au niveau de sa vraie piste. Sur la chanson : basse +1,0 dB, guitare −7,9 dB, piano −12,2 dB (proches des corrections faites à la main le 25/11 : +1,7, −8,1, −12,9). Mesuré ensuite sur les 7 minutes : chaque partie à 1 dB près de sa vraie piste, calage à 30 ms près.
- Un seul Ctrl+Z retire la partie et son réglage. Sans pistes séparées, rien ne change.
- Détail : `docs/v20-du-son-a-la-sequence.md`, section « Rendu fidèle ». Cas RF01-RF10.
- **Livré à l'écoute** : `~/Downloads/Tous les jours - essai mixte v2 (calé et nuancé par KHMP).m4a`, fabriqué par KHMP lui-même (boutons d'ajout, volumes réglés par l'application, aucune retouche à la main ; seul le limiteur final est ajouté). **En attente : l'avis de Kevin.**
- Non vérifié : l'écoute ; le rendu audio d'une chanson de 7 minutes est lent (environ 17 minutes pour les quatre parties rejouées sur le Mac) ; Windows, téléphone.
- **Instruments des parties rejouées** (demande de Kevin, 26/11 à 0 h 51) : piano Salamander (4 nuances) au lieu du piano FluidR3, Fashion bass (5 nuances) au lieu de la basse FluidR3 (**retirée le 26/11 au matin** : elle sonne une octave trop haut, voir le document V20 ; la basse FluidR3 `r_ebass` est revenue), et nouvelle **guitare électrique FreePats « FSBS Electric Guitar Clean »** (Fender, CC0, version 2026-08-07, micro chevalet ; deux nuances, deux prises par note ; 9 Mo, `public/banks/fsbs_guitar`, son `r_fsbsguitar`) au lieu de la guitare FluidR3 (une seule nuance). Ajoutée par `tools/build-expressive-banks.py` (nouvelle source « archive 7z » vérifiée par SHA256 ; `py7zr` ou `7z` requis). La reconnaissance d'instruments conseille aussi ces trois sons. Cas GT01-GT02 ; BN01 compte 57 sons.
- Autres guitares libres repérées, non retenues : Shinyguitar de Karoryfer (semi-acoustique, GPL 3 d'après KVR, 439 Mo), FreePats « Jazz » et « Direct » (CC0).
- Fichiers d'essai hors git : `/private/tmp/khmp-fidele*` sur le Mac (copie de travail détachée, peut être supprimée : `git worktree remove /private/tmp/khmp-fidele`).
- **Essai v4** (26/11) : `~/Downloads/Tous les jours - essai mixte v4 (basse v2, piano et guitare v3).m4a` sur le Mac de Kevin, mêmes rendus que v2/v3 sans nouveau calcul. Mesures par partie face à la vraie piste (classes de notes, sur 7 min) : basse v2 0,82 / v3 0,53 ; piano v2 0,68 / v3 0,71 ; guitare v2 0,72 / v3 0,82. Pas encore écouté par Kevin au moment de l'écrire.
- **Guitare et piano en vraie piste** (décision de Kevin du 26/11, « Les deux ») : une partie guitare ou piano qui a sa propre piste séparée s'ajoute en sourdine, avec sa vraie piste séparée au-dessus. Détails et raisons dans le document V20. Essai v5 (`~/Downloads/Tous les jours - essai mixte v5 (seule la basse rejouée).m4a`). Reste à faire : chercher de meilleurs outils de séparation et de notes pour guitare et piano.
