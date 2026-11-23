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

- `src/analysis/stems/` : `separate.ts` (calcul pur), `worker.ts` (le même calcul dans un Worker), `index.ts` (inscription, textes fr/en/es, vue). Une ligne dans `src/analysis/index.ts`. Aucun autre fichier du socle modifié.
- Remplit `ctx.result.stems` : `vocals`, `drums`, `bass`, `other`, **au taux et avec les canaux du son source** (stéréo → pistes stéréo, mono → pistes mono). Les autres analyses les lisent par `ctx.input('vocals')` etc. (contrat inchangé). Ordre d'affichage 10 : la séparation est en tête de la fenêtre.
- **Méthode : traitement du signal, sans modèle d'apprentissage.** Transformée de Fourier à court terme (fenêtre de 4096 échantillons, 8192 au-delà de 60 kHz, recouvrement de 75 %), puis quatre masques doux qui font 1 en chaque case :
  - batterie = part percussive (séparation harmonique/percussive par filtres médians, 17 trames × 17 cases) ;
  - basse = part tenue sous ~120-250 Hz ;
  - voix = part tenue au-dessus de la basse **et au centre de l'image stéréo** (corrélation gauche/droite lissée) ;
  - autres = le reste. Les quatre pistes additionnées redonnent le son à 1e-7 près.
- Découpage en morceaux de 8 s recouverts d'1 s (fondu linéaire), avancement après chaque morceau, annulation (le Worker est arrêté). Si le Worker est refusé au démarrage (par exemple la version bureau en `file://`), le même calcul tourne sur le fil principal en rendant la main entre deux morceaux.
- Mémoire : estimée avant de lancer (pistes de sortie + un morceau) ; refus clair avec la durée maximale si elle dépasse 30 % de la mémoire de l'appareil ; analyse indisponible sous 1 Go (`navigator.deviceMemory`, connu de Chrome seulement). Exemple : 4 min en stéréo à 44,1 kHz ≈ 420 Mo.
- Vue : une ligne par piste (nom, niveau ou « presque vide »), **Écouter** seule (un appui lance, un autre arrête, une autre piste remplace la première ; fermer la fenêtre coupe ; le transport s'arrête), **Ajouter au morceau** (piste audio nommée « Voix », « Batterie »… avec un clip au début du morceau, un seul Ctrl+Z), **Ajouter les quatre pistes** (un seul Ctrl+Z). Boutons de 44 px, noms accessibles, clavier.
- Rapidité mesurée : 10 s de stéréo à 44,1 kHz en 1,4 s (Node, Mac de Kevin) ; un morceau de 3-4 min devrait prendre de 30 s à 1 min (non mesuré sur un vrai morceau).

### Pourquoi pas de modèle (Demucs) pour l'instant

Des exports ONNX de HTDemucs (Meta, licence MIT) existent sur Hugging Face et tournent dans le navigateur avec `onnxruntime-web` : `monteslu/htdemucs-web-onnx` (21 morceaux de moins de 23 Mo, ~125 Mo en tout, prévu pour WebGPU), `StemSplitio/htdemucs-onnx` (fichier fp16 de 166 Mo, trop gros pour GitHub), `Ghilda/htdemucs-onnx` (174 Mo). Aucun ne tient en un fichier sous 100 Mo ; le seul découpé pèse 125 Mo à ajouter au dépôt et au site, vise WebGPU (l'exécution WASM, seule disponible dans la QA et sur beaucoup d'appareils, n'est pas garantie) et demande un téléchargement que Kevin doit accepter. Le calcul a donc été écrit pour qu'un modèle puisse le remplacer plus tard sans toucher au contrat : il suffit de produire les mêmes quatre `AudioBuffer`. **Décision à prendre par Kevin** : ajouter HTDemucs (~125 Mo, bien meilleur sur de la vraie musique) ou garder le traitement du signal.

### Mesures (QA `SEP`, Chromium, mélanges fabriqués de `qa/stems-mix.cjs`)

Mélange connu : voix synthétique (mélodie, vibrato, voyelle « a ») au centre, batterie (grosse caisse, caisse claire, charleston un peu à droite), basse au centre, nappe à gauche et arpège à droite. « Gain » = rapport source/erreur de la piste séparée moins le même rapport si l'on rendait le mélange entier ; « corr » = corrélation avec la source d'origine.

| Cas | Voix | Batterie | Basse | Autres | Seuils de la QA |
|---|---|---|---|---|---|
| Stéréo, 10 s (SEP02) | +20,4 dB, corr 0,91 | +8,7 dB, corr 0,74 | +5,6 dB, corr 0,89 | +13,9 dB, corr 0,89 | 17 / 6,5 / 3,5 / 11 dB ; corr 0,88 / 0,7 / 0,85 / 0,85 |
| Mono, 8 s (SEP05) | +11,9 dB, corr 0,66 | +8,5 dB | +4,8 dB | corr 0,18 | batterie 6, basse 3, voix corr 0,5 |
| Voix sans vibrato (SEP22) | +20,7 dB | | | | 15 dB |
| Voix décentrée (pan 0,3) (SEP22) | +13,5 dB, corr 0,47 | | | | 6 dB |

Partie absente du mélange (SEP04), énergie de la piste correspondante par rapport au mélange : voix −23 dB, batterie −15,8 dB, basse −9,2 dB (seuils −18, −13, −7).

Autres cas : somme des pistes = son d'origine (SEP03), taux du son gardé à 44,1 et 48 kHz (SEP06), sons de 0,05 s et longueurs quelconques (SEP07), silence (SEP08), avancement (SEP09), annulation puis relance (SEP10), écoute seule et arrêt (SEP11, SEP12 au clavier), ajout d'une piste et des quatre avec Ctrl+Z (SEP13, SEP14), `ctx.input` (SEP15), changement de son (SEP16), page réactive pendant le calcul et repli sans Worker identique au bit près (SEP17), mémoire (SEP18), parcours réel avec un fichier WAV stéréo (SEP19), téléphone au doigt (SEP20), anglais et espagnol (SEP21).

### Limites connues

- Son **mono** : rien ne distingue la voix des autres instruments tenus ; la piste « voix » garde la nappe, les accords… (expliqué sous les pistes).
- Instruments tenus **au centre** (piano mono, synthé au centre) : ils partent dans la piste voix. Voix très décentrée ou très réverbérée : elle part en partie dans « autres ».
- Batterie : les sons tenus (cymbale crash, toms longs) peuvent passer en partie dans « autres » ou « basse » ; la queue grave d'une grosse caisse passe en partie dans « basse ».

### Non vérifié

- Vraie musique (seulement des mélanges fabriqués) ; écoute à l'oreille des pistes séparées.
- Version bureau : le Worker en `file://` n'a pas été essayé ; le repli sur le fil principal est vérifié dans le navigateur (SEP17), pas dans Electron.
- Téléphones réels (mémoire, durée du calcul) ; Safari et Firefox (pas de `deviceMemory` : la limite suppose 8 Go).
- Durée de calcul sur un morceau de 3-4 min dans le navigateur.
