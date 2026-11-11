# KH Music Pro

Station de travail audio (DAW) dans le navigateur, pour composer, enregistrer, mixer et jouer en direct.
Interface en français, anglais et espagnol.

## Lancer

```bash
npm install
npm run dev
```

Puis ouvrir http://localhost:5173 (Chrome ou Edge conseillés ; Firefox fonctionne, sans MIDI selon les versions).

`npm run build` produit une version statique dans `dist/`, prête à être hébergée ou empaquetée (Electron / Tauri).

## Fonctions (v0.5)

- **Arrangement** multipiste : clips déplaçables, redimensionnables, duplication, scission, boucle, grille magnétique, zoom ; pistes duplicables et réordonnables.
- **Automation** : courbes de volume, de pan et de filtre par piste, dessinées dans l'arrangement (bouton **A**).
- **Batterie** : 16 sons, 3 kits, séquenceur à pas avec swing et notes douces, **16 pads** jouables (souris, clavier, MIDI) acceptant vos propres samples.
- **Instruments** : 24 sons (claviers, basses dont 808 et acid, leads, cuivres, flûte, nappes, cordes pincées, cloches) sur quatre moteurs (soustractif, FM, corde pincée, **sampler**).
- **Piano roll** : vélocité par note, transposition, **gamme** (surlignage et aimantation), **accords à un doigt**.
- **Jeu en direct** : clavier d'ordinateur avec notes tenues et changement d'octave, **clavier maître ou pads MIDI**.
- **Enregistrement** : micro calé à l'échantillon près sur le transport, enregistrement de ce que vous jouez (notes, accords et pads) en boucle, décompte.
- **Entrée audio** : choix du micro ou de la carte son, vumètre et gain d'entrée, écoute de contrôle.
- **Clips audio** : gain, fondus d'entrée et de sortie, inversion, normalisation, **étirement au tempo** sans changer la hauteur et **transposition** sans changer la durée.
- **Clavier à l'écran** : jouable au doigt (plusieurs touches, glissé) ou à la souris.
- **Sélection de notes** : rectangle de sélection, déplacement en groupe, copier/coller, flèches du clavier.
- **Répétition de notes** sur les pads (roulements), enregistrable.
- **Finition** : égaliseur et largeur stéréo sur le général, mesure du volume perçu (LUFS), export au niveau des plateformes (−14 LUFS) avec limiteur.
- **Mes projets** : plusieurs projets gardés dans le navigateur, modèles de départ (trap, house, lo-fi).
- **Arpégiateur** : notes tenues égrenées au tempo (quatre modes), jouable et enregistrable.
- **Repères** nommés dans la règle (Intro, Refrain…) pour naviguer.
- **Téléphone et tablette** : mise en page compacte et commandes tactiles.
- **Mode Live** : lanceur de clips et de scènes calé sur la mesure, filtre général, tap tempo.
- **Mixeur** : volume, pan, muet/solo, égaliseur 3 bandes, filtre, saturation, compresseur, **sidechain** sur le kick, réverb (durée réglable), écho (temps et répétitions), limiteur général, vumètres.
- **Projet** : annuler/rétablir, sauvegarde automatique locale, fichiers `.khm` (sons inclus), export WAV.
- **Passerelles** : export des pistes séparées (un WAV par piste, en ZIP), export et import de fichiers MIDI standard, pour continuer dans un autre logiciel.
- **Application installable** : la version construite (`npm run build`) fonctionne hors-ligne après une première visite et s'installe comme une application depuis Chrome ou Edge.

## QA

Chaque cas d'usage est couvert par un test de bout en bout dans un vrai navigateur (`qa/run.cjs`, 132 cas).
Le plus simple, serveur compris :

```bash
npm run qa:all
```

Ou, avec le serveur de développement déjà lancé sur le port 5173 :

```bash
npm run qa
```

Le rapport est écrit dans `qa/REPORT.md`. Un seul domaine : `npm run qa -- L` (Live), `npm run qa -- AU,F` (automation et clips audio).
Les tests utilisent Playwright (`npm i -D playwright` puis `npx playwright install chromium` si besoin) ; le cas E04 utilise `python3` pour vérifier l'archive ZIP.

## Mise en ligne

Le fichier `.github/workflows/deploy.yml` publie l'application sur GitHub Pages à chaque mise à jour de `main`.
À activer une fois : dans le dépôt, *Settings > Pages > Source : GitHub Actions*.

## Structure

- `src/types.ts` — modèle de données, catalogue des sons, migration des anciens projets
- `src/i18n.ts` — textes en trois langues
- `src/audio/graph.ts` — graphe de mixage, instruments, batterie, séquenceur (partagé entre temps réel et export)
- `src/audio/engine.ts` — transport, mode Live, enregistrement, rendu hors-ligne, WAV
- `src/audio/stretch.ts` — étirement temporel et transposition des sons
- `src/audio/loudness.ts` — mesure LUFS et limiteur d'export
- `src/ui/library.ts` — fenêtre des projets et des modèles
- `src/input.ts` — jeu en direct (clavier, MIDI, accords, arpégiateur) et écriture des prises
- `src/files.ts` — export et import MIDI, archive ZIP des pistes séparées
- `public/` — manifeste, icône et service worker (hors-ligne)
- `src/store.ts` — état, historique, persistance
- `src/ui/` — arrangement, éditeurs, mixeur, Live, barre supérieure
