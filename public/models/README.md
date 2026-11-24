# Modèles d'analyse (V20)

## `yamnet/` — classement des sons (familles d'instruments)

- YAMNet, Google (réseau MobileNet v1 entraîné sur AudioSet, 521 classes), version TF.js « tfjs/1 » publiée sur Kaggle Models (`google/yamnet/tfJs/tfjs/1`).
- Licence : Apache 2.0.
- Taille : 16 Mo (poids en float32, 4 fichiers) + `model.json` (100 ko).
- Entrée : son mono à 16 kHz ; sortie : 521 probabilités par fenêtre de 0,96 s (pas de 0,48 s).
- Liste des classes : `yamnet_class_map.csv` de tensorflow/models (Apache 2.0) ; seuls les numéros utiles sont repris dans `src/analysis/instruments/families.ts`.

## `tfjs/` — moteur WebAssembly de TensorFlow.js

- `@tensorflow/tfjs-backend-wasm` 4.22.0, Apache 2.0, ~0,7 Mo. Sans WebAssembly, TF.js calcule en JavaScript pur (plus lent).

Tout est servi par le site lui-même : aucun appel réseau vers un tiers ; le service worker garde ces fichiers pour le hors-ligne une fois chargés.

## `basic-pitch/` — notes (chant, basse, piano)

- Basic Pitch, Spotify (paquet npm `@spotify/basic-pitch` 1.0.1, dossier `model/`), licence Apache 2.0 (`LICENSE.txt`).
- Taille : 0,9 Mo. Entrée : son mono à 22 050 Hz par fenêtres de 2 s ; sorties : pour chacune des 88 touches, 86 fois par seconde, « la note sonne » et « la note commence ».
- Calcul avec le moteur WebAssembly de `tfjs/` ; la création des notes est réécrite dans `src/analysis/bp/core.ts` d'après la méthode publiée avec le modèle.

## `htdemucs6/` — séparation en six pistes (voix, batterie, basse, guitare, piano, autres)

- HTDemucs `htdemucs_6s`, Meta (`facebookresearch/demucs`, licence MIT, `LICENSE.txt`), export ONNX `StemSplitio/htdemucs-6s-onnx` sur Hugging Face (fichier `htdemucs_6s.onnx` fp32, 258 Mo, SHA-256 `48f8e849…ca779a`).
- Ici : seulement le **cœur** du réseau (177 Mo, en 4 parties de moins de 50 Mo ; empreinte dans `manifest.json`). La transformée inverse du modèle d'origine ne passe pas dans le navigateur (calcul en double précision, et trop de mémoire) : on a gardé les sorties « freq » et « time » juste avant elle, et KHMP fait la transformée inverse (`src/analysis/stems/demucs.ts`). Vérifié : même résultat que le modèle entier à 2e-6 près.
- Pour refaire le fichier : couper le graphe aux sorties `/Add_3_output_0` (→ `freq`) et `/Add_4_output_0` (→ `time`) avec le paquet Python `onnx`.
