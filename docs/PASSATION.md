# Document de passation — KH Music Pro

Rédigé à la fin de la V14a pour qu'une nouvelle session (notamment sur le Mac du propriétaire) reparte sans le fil de la conversation d'origine.

## 1. Le projet en une minute

- **But** : un logiciel de création musicale « à la Ableton / Logic / FL Studio », accessible, pour un musicien (beatmaker, enregistrement, mixage, scène).
- **État** : version 0.14, 190 cas de QA verts. En ligne sur https://yankamkevin.github.io/kh-music-pro/, installable (PWA), et empaqueté pour le bureau (Electron) pour Windows, macOS (Apple et Intel) et Linux.
- **Dépôt** : `YANKAMKEVIN/kh-music-pro`. `main` = version en ligne. Releases publiées : v0.8.0, v0.10.0, v0.13.0.
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
| `electron/main.cjs` | Fenêtre de la version bureau |
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
3. **Windows et macOS** : les installateurs se construisent ; seul celui de Linux est lancé automatiquement. Personne n'a ouvert le `.exe` ni le `.dmg`.
4. **Un vrai téléphone** : la mise en page tactile est testée dans un navigateur qui simule un écran tactile.
5. **Les plugins web tiers** : l'hôte n'est validé qu'avec le plugin d'exemple fourni (`public/wam/kh-tape`). Un essai avec des plugins de la communauté (paquet npm `wam-community` : burns-audio, wimmics) a été préparé puis refusé par la protection de la session cloud, car il exécute du code tiers. À refaire avec l'accord du propriétaire.
6. **La mesure de latence** : le chemin « clic non détecté » est testé ; une mesure réussie demande de vrais haut-parleurs et un vrai micro.
7. **HawkScan** (analyse de sécurité demandée par un hook de session) : jamais lancé, faute de clé API. L'application n'a pas de serveur.

## 4. Limites connues, assumées

- Instruments enregistrés : notes d'environ 3 secondes, une seule nuance, pas de bouclage.
- Tempo : les clips audio ne suivent pas les changements de tempo ; le mode Live et les effets calés (écho, trémolo) restent au tempo de départ.
- Signature : une seule pour tout le morceau, de 2/4 à 7/4.
- Chaîne d'effets : elle s'ajoute après la tranche fixe (filtre, saturation, égaliseur, compresseur) ; huit effets au plus.
- Automation : six paramètres (volume, pan, filtre, réverb, écho, chorus).
- Installateurs non signés ; pas de mise à jour automatique.
- Projets stockés dans le navigateur de chaque appareil ; le fichier `.khm` est la seule vraie sauvegarde.

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
- **RI05** (pad 4 de la batterie acoustique « identique au son synthétisé ») est **instable** : il échoue aussi sur `main` sans les changements de V14b (1 réussite sur 3). L'écart mesuré entre les deux sons frôle le seuil de 3 %. À corriger à part (seuil du test, ou son du pad 4).
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

### Critères de décision

- **On continue** si un plugin AU traite le son d'une piste avec une latence aller-retour inférieure à 12 ms et sans craquement pendant 5 minutes.
- **On s'arrête** si l'étape 4 demande de dupliquer le moteur de mixage en natif : c'est alors la piste 4, un projet de plusieurs mois, à décider en connaissance de cause.

### Ce qu'une session sur le Mac doit aussi faire

Profiter de la machine réelle pour lever la section 3 : écouter la démo et les modèles, enregistrer une vraie voix (prises, punch, justesse), brancher un clavier MIDI, ouvrir le `.dmg`, essayer la mesure de latence. Consigner ce qui sonne mal ou gêne à l'usage : ces retours passent avant toute nouvelle fonction.

## 6. Feuille de route

- **Faites** : V1 à V13, puis V14a (chaînes d'effets, latence, plugins web).
- **En cours** : V14b (ci-dessus), étapes 0 à 5 faites les 12 et 13/11/2026 sur la branche `v14b-prototype-natif`, puis une séance d'écoute : craquements sur un Mac en usage normal. Décision attendue du propriétaire : chercher la cause des craquements (comparaison sous charge contrôlée), ou s'arrêter là et garder le prototype comme référence sans le fusionner.
- **En attente** : la phase de QA humaine annoncée par le propriétaire.
- **Idées non engagées** : chaînes d'effets remplaçant la tranche fixe, automation de tout paramètre, clips audio qui suivent le tempo, enregistrement de clips à la volée en mode Live, 6/8, installateurs signés, travail à plusieurs.
