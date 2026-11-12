# Document de passation — KH Music Pro

Rédigé à la fin de la V14a, mis à jour pour la V15.1, la version 0.16.0 en ligne (15/11/2026), puis la V17 (0.17.0, fusionnée dans `main` le 16/11/2026) et la V17.1 (banques expressives, branche `v17-expressive-banks`), pour qu'une nouvelle session (notamment sur le Mac du propriétaire) reparte sans le fil de la conversation d'origine.

## 1. Le projet en une minute

- **But** : un logiciel de création musicale « à la Ableton / Logic / FL Studio », accessible, pour un musicien (beatmaker, enregistrement, mixage, scène).
- **État** : version **0.16.0 en ligne** sur `main` depuis le 15/11/2026 (fusion de la V15, banque de sons, et de la V14b, moteur natif et plugins du Mac : PR #2). 239 cas de QA. Site : https://yankamkevin.github.io/kh-music-pro/ ; installable (PWA) ; installateurs Windows, macOS (Apple et Intel) et Linux dans la release v0.16.0. Installée sur le Mac du propriétaire (`/Applications/KH Music Pro.app`).
- **Dépôt** : `YANKAMKEVIN/kh-music-pro`. `main` = version en ligne. Releases publiées : v0.8.0, v0.10.0, v0.13.0, v0.16.0 à v0.16.2, **v0.17.1** (17/11/2026, la v0.17.0 n'a pas eu de release). Depuis le 17/11/2026, Claude publie la release après chaque fusion dans `main` (CLAUDE.md). Les branches `v14b-prototype-natif`, `v15-banque-generaliste` et `integration-v15-natif` sont fusionnées : tout nouveau travail part de `main`.
- **Prochaine étape** : la séance d'écoute et de jeu du propriétaire (listes en fin de sections 5, 9, 13, 14 et 15). Ses retours passent avant toute nouvelle fonction. La V17 (0.17.0) est en ligne sur `main` (PR #6) ; la V17.1 (0.17.1, sections 14 et 15) attend sur `v17-expressive-banks` (PR #5) : pas de fusion sans son accord.
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
- Signature : une seule pour tout le morceau, de 2/4 à 7/4.
- Chaîne d'effets : elle s'ajoute après la tranche fixe (filtre, saturation, égaliseur, compresseur) ; huit effets au plus.
- Automation : six réglages de piste (volume, pan, filtre, réverb, écho, chorus) et, depuis la V17, les réglages des effets de la piste (sauf la taille de la réverb d'effet) et des plugins du Mac. Les réglages de l'instrument ne sont pas automatisables.
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
- **🔧 Réglages audio → « ⚡ Moteur audio natif »** : interrupteur (rôle `switch`, clavier et doigt), **désactivé par défaut**, choix retenu sur l'appareil (`localStorage` `kh-native`). La bascule se fait sans redémarrer : `engine.useNative()` / `engine.stopNative()` (nouveau), l'entrée ouverte est rouverte sur le nouveau chemin. La ligne de latence indique le chemin (« chemin natif » ou « navigateur »). En cas d'échec : message dans les réglages (`role=alert`) et à l'écran, et retour automatique au navigateur sur la sortie choisie. Code : `src/ui/native.ts`, `src/ui/audio.ts`.
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
2. **Moteur audio natif** : 🔧 Réglages audio → « ⚡ Moteur audio natif » : l'activer, jouer, enregistrer une prise, brancher puis débrancher les EarPods, le désactiver. Désactivé par défaut : faut-il l'activer par défaut sur Mac ?
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
- **En attente** : la phase de QA humaine du propriétaire (écoute, vrai matériel) ; décisions : batterie à plusieurs nuances (Virtuosity Drums, CC0) et moteur natif activé ou non par défaut sur Mac.
- **Idées non engagées** : chaînes d'effets remplaçant la tranche fixe, automation de tout paramètre, clips audio qui suivent le tempo, enregistrement de clips à la volée en mode Live, 6/8, installateurs signés, travail à plusieurs.

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
5. **Décision** : télécharger les nuances réelles de la batterie Virtuosity Drums (CC0, quelques mégaoctets) pour une batterie qui change vraiment de timbre selon la force ?
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
