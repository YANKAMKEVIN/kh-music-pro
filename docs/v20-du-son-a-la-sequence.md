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
| Séparation des pistes | `v20-pistes` | SEP (ST était déjà pris par l'étirement) |
| Basse et piano → notes | `v20-poly` | PO |
| Batterie → motif | `v20-batterie` | DR |
| Familles d'instruments | `v20-instruments` | IN |

## Séparation des pistes (branche `claude/v20-pistes-c1cd63`, préfixe de QA `SEP`)

### Fait

- `src/analysis/stems/` : `separate.ts` (mode rapide, calcul pur), `worker.ts` (le même calcul dans un Worker), `index.ts` (inscription, choix de la méthode, textes fr/en/es, vue), et les fichiers de Demucs ci-dessous. Une ligne dans `src/analysis/index.ts`.
- Remplit `ctx.result.stems` : `vocals`, `drums`, `bass`, `other`, **au taux et avec les canaux du son source** (stéréo → pistes stéréo, mono → pistes mono). Les autres analyses les lisent par `ctx.input('vocals')` etc. (contrat inchangé). Ordre d'affichage 10 : la séparation est en tête de la fenêtre.
- **Mode rapide (et secours de Demucs) : traitement du signal.** Transformée de Fourier à court terme (fenêtre de 4096 échantillons, 8192 au-delà de 60 kHz, recouvrement de 75 %), puis quatre masques doux qui font 1 en chaque case :
  - batterie = part percussive (séparation harmonique/percussive par filtres médians, 17 trames × 17 cases) ;
  - basse = part tenue sous ~120-250 Hz ;
  - voix = part tenue au-dessus de la basse **et au centre de l'image stéréo** (corrélation gauche/droite lissée) ;
  - autres = le reste. Les quatre pistes additionnées redonnent le son à 1e-7 près.
- Découpage en morceaux de 8 s recouverts d'1 s (fondu linéaire), avancement après chaque morceau, annulation (le Worker est arrêté). Si le Worker est refusé au démarrage (par exemple la version bureau en `file://`), le même calcul tourne sur le fil principal en rendant la main entre deux morceaux.
- Mémoire : estimée avant de lancer (pistes de sortie + un morceau) ; refus clair avec la durée maximale si elle dépasse 30 % de la mémoire de l'appareil ; analyse indisponible sous 1 Go (`navigator.deviceMemory`, connu de Chrome seulement). Exemple : 4 min en stéréo à 44,1 kHz ≈ 420 Mo.
- Vue : une ligne par piste (nom, niveau ou « presque vide »), **Écouter** seule (un appui lance, un autre arrête, une autre piste remplace la première ; fermer la fenêtre coupe ; le transport s'arrête), **Ajouter au morceau** (piste audio nommée « Voix », « Batterie »… avec un clip au début du morceau, un seul Ctrl+Z), **Ajouter les quatre pistes** (un seul Ctrl+Z). Boutons de 44 px, noms accessibles, clavier.
- Rapidité mesurée : 10 s de stéréo à 44,1 kHz en 1,4 s (Node, Mac de Kevin) ; un morceau de 3-4 min devrait prendre de 30 s à 1 min (non mesuré sur un vrai morceau).

### Demucs, qualité maximale (décision de Kevin du 23/11/2026 : « ajoute Demucs, je veux la meilleure qualité »)

- **Modèle** : HTDemucs (Meta, `facebookresearch/demucs`, licence MIT), export ONNX `Ghilda/htdemucs-onnx` sur Hugging Face (licence MIT indiquée par sa fiche, poids officiels reconvertis), en précision complète (fp32), 174 266 088 octets, SHA-256 `e528a932…9221af`. Coupé en quatre parties de 43,6 Mo dans `public/models/htdemucs/` (limite de 100 Mo par fichier de GitHub), avec `manifest.json` et `LICENSE.txt`. Choisi plutôt que le découpage demi-précision `monteslu/htdemucs-web-onnx` (125 Mo) : la demi-précision est mal prise en charge sans carte graphique, et le repli sur le processeur doit marcher.
- **Moteur** : `onnxruntime-web` 1.31.1 (Microsoft, MIT), variante `webgpu` (carte graphique, sinon WebAssembly). Son fichier WebAssembly (28,7 Mo) est copié par Vite dans `assets/` ; licence dans `public/licenses/`.
- **Fichiers** : `stems/demucs.ts` (préparation du spectre et reconstruction des pistes comme demucs, segments de 7,8 s recouverts de 25 %), `stems/model.ts` (téléchargement avec avancement, Cache Storage `kh-models-v1`, empreinte vérifiée, modèle abîmé oublié), `stems/dm-worker.ts` (session ONNX dans un Worker, gardée ouverte entre deux séparations).
- **Téléchargement** : une seule fois, à la première séparation en qualité maximale, depuis le site lui-même (aucun appel à Hugging Face ni à un autre site à l'exécution), avec « Téléchargement du modèle : X Mo sur 174 Mo » ; ensuite le modèle vient de l'appareil, même hors ligne. Si l'appareil refuse de le garder (espace plein, navigation privée), Demucs sépare quand même et le modèle sera retéléchargé la fois suivante. Le service worker hors ligne ignore `models/` pour ne pas le garder deux fois (`public/sw.js`, 2 lignes).
- **Carte graphique** : WebGPU seulement si la carte est réelle ; une carte émulée par logiciel (SwiftShader, « fallback adapter ») est refusée, elle est 8 fois plus lente que le processeur.
- **Le son** est rééchantillonné à 44,1 kHz pour le modèle puis rendu au taux d'origine ; un son mono est doublé en stéréo puis remis en mono.
- **Repli sur le mode rapide** (message clair, quatre pistes quand même) : appareil de moins de 4 Go, Worker impossible, modèle introuvable hors ligne, modèle abîmé, échec du modèle, ou Demucs trop lent (estimé après le premier segment : plus de 5 min et plus de 10 fois la durée du son).
- **Interface** : « Méthode » avec deux choix, **Qualité maximale (Demucs)** par défaut et **Rapide**, gardé d'une fois à l'autre ; ligne d'état (téléchargement, préparation, séparation sur carte graphique ou processeur) ; sous les pistes, la méthode utilisée et la durée. Trois langues.
- **Socle modifié (nécessaire)** : `Analyzer.options?(ctx)` dans `types.ts`, affiché sous l'aide par `ui/analyze.ts` (une ligne), pour choisir avant de lancer.

#### Temps mesurés (Mac de Kevin, pendant que d'autres sessions tournaient)

| Son | Carte graphique (WebGPU, Apple Metal) | Processeur (WebAssembly) |
|---|---|---|
| **1 minute** (mélange fabriqué, 48 kHz) | **238 s** | **220 s** |
| 20 s, machine très chargée | — | 240 s |
| 10 s (QA) | 51 s | 65 s (navigateur de la QA, plusieurs cœurs) |

Il faut donc compter **environ 4 minutes par minute de son** sur ce Mac (un morceau de 3 min ≈ 12 min), plus le premier téléchargement de 174 Mo. Sur ce Mac, la carte graphique ne va pas plus vite que le processeur avec ce modèle en précision complète ; une version demi-précision découpée (comme `monteslu/htdemucs-web-onnx`) serait plus rapide sur carte graphique, à essayer plus tard. Les deux donnent exactement la même séparation (gains identiques au centième). Mode rapide : 10 s de son en 1,4 s.

#### Taille : site et version bureau

- **GitHub Pages** : la version construite pèse 280 Mo (dont 174 Mo de modèle et 29 Mo de moteur), sous la limite de 1 Go par site ; chaque fichier fait moins de 100 Mo. La bande passante conseillée de Pages (100 Go par mois) correspond à environ 570 premiers téléchargements du modèle par mois.
- **Version bureau** : `electron-builder` emballe `dist/**`, donc le modèle va dans chaque installateur (environ +175 Mo ; les releases GitHub acceptent 2 Go par fichier). Non construit ici : la taille réelle des quatre installateurs sera visible sur la construction bureau de GitHub. **Vérifié** dans Electron 45 (Playwright pilote l'application construite, chargée en `file://`) : le Worker démarre, les fichiers du modèle se lisent, Demucs tourne sur la carte graphique (son de 3 s séparé en 20 s). En `file://`, pas de copie dans le Cache Storage (inutile, les fichiers sont dans l'application).
- **Dépôt** : +174 Mo pour toujours dans l'historique Git (accord de Kevin du 23/11/2026).

### Mesures (QA `SEP`, Chromium, mélanges fabriqués de `qa/stems-mix.cjs`)

Mélange connu : voix synthétique (mélodie, vibrato, voyelle « a ») au centre, batterie (grosse caisse, caisse claire, charleston un peu à droite), basse au centre, nappe à gauche et arpège à droite. « Gain » = rapport source/erreur de la piste séparée moins le même rapport si l'on rendait le mélange entier ; « corr » = corrélation avec la source d'origine.

| Cas | Voix | Batterie | Basse | Autres | Seuils de la QA |
|---|---|---|---|---|---|
| Stéréo, 10 s (SEP02) | +20,4 dB, corr 0,91 | +8,7 dB, corr 0,74 | +5,6 dB, corr 0,89 | +13,9 dB, corr 0,89 | 17 / 6,5 / 3,5 / 11 dB ; corr 0,88 / 0,7 / 0,85 / 0,85 |
| Mono, 8 s (SEP05) | +11,9 dB, corr 0,66 | +8,5 dB | +4,8 dB | corr 0,18 | batterie 6, basse 3, voix corr 0,5 |
| Voix sans vibrato (SEP22) | +20,7 dB | | | | 15 dB |
| Voix décentrée (pan 0,3) (SEP22) | +13,5 dB, corr 0,47 | | | | 6 dB |

**Demucs face au mode rapide**, même mélange stéréo de 10 s (SEP23, processeur ; SEP30, carte graphique : mêmes valeurs) :

| | Voix | Batterie | Basse | Autres |
|---|---|---|---|---|
| Demucs | +20,4 dB, corr 0,91 | **+17,5 dB**, corr 0,97 | **+22,5 dB**, corr 0,998 | **+19,5 dB**, corr 0,97 |
| Rapide | +20,4 dB, corr 0,91 | +8,7 dB, corr 0,74 | +5,6 dB, corr 0,89 | +13,9 dB, corr 0,89 |
| Seuils de la QA (Demucs) | 16 | 13, et rapide + 5 | 16, et rapide + 10 | 16 |

Sur 60 s, la voix monte à +27 dB et les autres à +24 dB. La voix fabriquée (au centre, sans réverbération) est le cas idéal du mode rapide, d'où l'égalité ; sur la batterie, la basse et le reste, Demucs gagne 6 à 17 dB. Son mono par Demucs (SEP24) : voix +17,8, batterie +24,4, basse +20,2, autres +17,0 dB (le mode rapide, lui, ne sait pas séparer la voix d'un son mono). Limite vue : sur un son très court (4 s), Demucs a rangé la voix fabriquée dans « autres » (corr 0,09) ; dès 10 s, elle est bien séparée.

Cas Demucs : SEP23 (premier téléchargement, 4 morceaux demandés, avancement, cache, gains), SEP24 (rechargement, hors ligne, choix gardé, son mono à 44,1 kHz), SEP25 (pas de réseau ni de cache → mode rapide), SEP26 (modèle abîmé → refusé, oublié), SEP27 (choix Rapide au clic et au clavier, rien téléchargé, trois langues), SEP28 (trop lent → mode rapide avec estimation), SEP29 (annulation pendant le téléchargement), SEP30 (carte graphique réelle, navigateur à part), SEP31 (moins de 4 Go → pas de téléchargement), SEP32 (appareil qui refuse de garder le modèle, espace plein : Demucs sépare quand même, sans rien garder).

Partie absente du mélange (SEP04), énergie de la piste correspondante par rapport au mélange : voix −23 dB, batterie −15,8 dB, basse −9,2 dB (seuils −18, −13, −7).

Autres cas : somme des pistes = son d'origine (SEP03), taux du son gardé à 44,1 et 48 kHz (SEP06), sons de 0,05 s et longueurs quelconques (SEP07), silence (SEP08), avancement (SEP09), annulation puis relance (SEP10), écoute seule et arrêt (SEP11, SEP12 au clavier), ajout d'une piste et des quatre avec Ctrl+Z (SEP13, SEP14), `ctx.input` (SEP15), changement de son (SEP16), page réactive pendant le calcul et repli sans Worker identique au bit près (SEP17), mémoire (SEP18), parcours réel avec un fichier WAV stéréo (SEP19), téléphone au doigt (SEP20), anglais et espagnol (SEP21).

### Limites connues

- Son **mono** : rien ne distingue la voix des autres instruments tenus ; la piste « voix » garde la nappe, les accords… (expliqué sous les pistes).
- Instruments tenus **au centre** (piano mono, synthé au centre) : ils partent dans la piste voix. Voix très décentrée ou très réverbérée : elle part en partie dans « autres ».
- Batterie : les sons tenus (cymbale crash, toms longs) peuvent passer en partie dans « autres » ou « basse » ; la queue grave d'une grosse caisse passe en partie dans « basse ».

### Non vérifié
- Demucs sur de la vraie musique et à l'oreille (seulement des mélanges fabriqués) ; Demucs sur Windows, Linux, téléphones, Safari et Firefox ; carte graphique autre que celle du Mac de Kevin.
- Taille réelle des installateurs avec le modèle (construction bureau de GitHub) ; durée du premier téléchargement sur une connexion lente.

- Vraie musique (seulement des mélanges fabriqués) ; écoute à l'oreille des pistes séparées.
- Version bureau : vérifiée seulement en lançant l'application construite sur le Mac (pas d'installateur ni Windows).
- Téléphones réels (mémoire, durée du calcul) ; Safari et Firefox (pas de `deviceMemory` : la limite suppose 8 Go).
- Durée de calcul sur un morceau de 3-4 min dans le navigateur.
