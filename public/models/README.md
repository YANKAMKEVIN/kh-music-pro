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
