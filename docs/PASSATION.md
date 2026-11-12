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
5. **Les plugins web tiers** : essai fait avec l'accord du propriétaire sur huit plugins du paquet npm `wam-community` (version 0.4.9), servis depuis un dossier temporaire, sans les intégrer à l'application.
   - **Fonctionnent entièrement** (chargement, interface, réglages lus, inclus à l'export) : burns-audio *Simple Delay*, *Simple Distortion*, *Simple EQ* ; wimmics *PingPongDelay*, *QuadraFuzz*.
   - **Ne se chargent pas** : wimmics *graphicEqualizer*, *BigMuff*, *SmoothDelay* (plugins construits avec Faust). Ils réclament un fichier absent du paquet lui-même (`utils/sdk-parammgr/src/sdk/src/addFunctionModule.js`) : c'est un défaut de ce paquet, pas de l'hôte. À réessayer depuis leur site d'origine, inaccessible depuis la session cloud.
   - Non vérifié : leur son à l'oreille, les plugins instruments, la version bureau.
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

### Critères de décision

- **On continue** si un plugin AU traite le son d'une piste avec une latence aller-retour inférieure à 12 ms et sans craquement pendant 5 minutes.
- **On s'arrête** si l'étape 4 demande de dupliquer le moteur de mixage en natif : c'est alors la piste 4, un projet de plusieurs mois, à décider en connaissance de cause.

### Ce qu'une session sur le Mac doit aussi faire

Profiter de la machine réelle pour lever la section 3 : écouter la démo et les modèles, enregistrer une vraie voix (prises, punch, justesse), brancher un clavier MIDI, ouvrir le `.dmg`, essayer la mesure de latence. Consigner ce qui sonne mal ou gêne à l'usage : ces retours passent avant toute nouvelle fonction.

## 6. Feuille de route

- **Faites** : V1 à V13, puis V14a (chaînes d'effets, latence, plugins web).
- **En attente** : V14b (ci-dessus), et la phase de QA humaine annoncée par le propriétaire.
- **Idées non engagées** : chaînes d'effets remplaçant la tranche fixe, automation de tout paramètre, clips audio qui suivent le tempo, enregistrement de clips à la volée en mode Live, 6/8, installateurs signés, travail à plusieurs.
