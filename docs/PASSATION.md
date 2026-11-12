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

### Critères de décision

- **On continue** si un plugin AU traite le son d'une piste avec une latence aller-retour inférieure à 12 ms et sans craquement pendant 5 minutes.
- **On s'arrête** si l'étape 4 demande de dupliquer le moteur de mixage en natif : c'est alors la piste 4, un projet de plusieurs mois, à décider en connaissance de cause.

### Ce qu'une session sur le Mac doit aussi faire

Profiter de la machine réelle pour lever la section 3 : écouter la démo et les modèles, enregistrer une vraie voix (prises, punch, justesse), brancher un clavier MIDI, ouvrir le `.dmg`, essayer la mesure de latence. Consigner ce qui sonne mal ou gêne à l'usage : ces retours passent avant toute nouvelle fonction.

## 6. Feuille de route

- **Faites** : V1 à V13, puis V14a (chaînes d'effets, latence, plugins web).
- **En attente** : V14b (ci-dessus), et la phase de QA humaine annoncée par le propriétaire.
- **Idées non engagées** : chaînes d'effets remplaçant la tranche fixe, automation de tout paramètre, clips audio qui suivent le tempo, enregistrement de clips à la volée en mode Live, 6/8, installateurs signés, travail à plusieurs.
