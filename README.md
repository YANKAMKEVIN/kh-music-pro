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

## Fonctions (v0.14)

- **Arrangement** multipiste : clips déplaçables, redimensionnables, duplication, scission, boucle, grille magnétique, zoom ; pistes duplicables et réordonnables.
- **Automation** : courbes de volume, de pan et de filtre par piste, dessinées dans l'arrangement (bouton **A**).
- **Batterie** : 16 sons, 3 kits, séquenceur à pas avec swing et notes douces, **16 pads** jouables (souris, clavier, MIDI) acceptant vos propres samples.
- **Instruments** : 24 sons (claviers, basses dont 808 et acid, leads, cuivres, flûte, nappes, cordes pincées, cloches) sur quatre moteurs (soustractif, FM, corde pincée, **sampler**).
- **Piano roll** : vélocité par note, transposition, **gamme** (surlignage et aimantation), **accords à un doigt**.
- **Jeu en direct** : clavier d'ordinateur avec notes tenues et changement d'octave, **clavier maître ou pads MIDI**.
- **Enregistrement** : micro calé à l'échantillon près sur le transport, enregistrement de ce que vous jouez (notes, accords et pads) en boucle, décompte.
- **Entrée audio** : choix du micro ou de la carte son, vumètre et gain d'entrée, écoute de contrôle.
- **Clips audio** : gain, fondus d'entrée et de sortie, inversion, normalisation, **étirement au tempo** sans changer la hauteur et **transposition** sans changer la durée.
- **Chaîne d'effets** par tranche : écho, réverb, phaser, auto-pan, bande d'égaliseur, gain, à ajouter, ordonner et couper librement (jusqu'à huit).
- **Plugins web** (Web Audio Modules) dans la chaîne d'effets, avec leur propre interface ; un plugin d'exemple est fourni. Un plugin venu d'un autre site demande un accord explicite.
- **Réglages audio** : choix de la sortie, latence affichée, décalage d'enregistrement réglable ou mesuré.
- **Tempo et mesure** : changements de tempo en cours de morceau (posés dans la règle, suivis à la lecture, à l'export et dans le MIDI), signature rythmique de 2/4 à 7/4.
- **Mode Live** : calage du lancement à la mesure, au temps ou immédiat ; scènes lancées aux touches 1 à 9.
- **Mixage avancé** : bus pour regrouper des pistes, bande médium à fréquence réglable avec courbe d'égaliseur visible, compresseur réglable (seuil, taux, réduction affichée), automation des envois de réverb et d'écho et du chorus.
- **Prises multiples** : enregistrement audio en boucle (une prise par tour), choix de la prise, montage par scission ; **punch** sur la zone de boucle ; **correction de justesse** vers la gamme du projet.
- **Vrais instruments** : 11 instruments enregistrés (piano à queue, guitares, basses, cordes, violoncelle, cuivres, saxophone, flûte, chœur) et une batterie acoustique, chargés à la demande.
- **Grille fine** : triples-croches, triolets de croches et de doubles, placement libre ; quantification ; motifs de batterie en 1/32 ou en triolets ; MIDI fidèle au 1/24 de pas.
- **Édition des clips** : rognage par les deux bords, sélection multiple (Maj+clic) pour déplacer, dupliquer ou supprimer en groupe, boucle tracée dans la règle (Maj+glisser).
- **Réglages par pad** (volume, hauteur, panoramique) ; outils de motif (décaler, doubler).
- **Préréglages de mixage** par piste ; **notes du projet**.
- **Effets de modulation** par piste : chorus, trémolo calé sur le tempo, lo-fi.
- **Accordeur** sur l'entrée audio.
- **Visite guidée** interactive, depuis l'aide.
- **Découpage sur les pads** : un son devient 8 ou 16 tranches (égales ou selon les attaques) jouables et réarrangeables.
- **Effets de performance** en mode Live : écho et réverb à la volée, bégaiement, coupure de piste d'un geste.
- **Assignation MIDI** : boutons et curseurs d'un contrôleur reliés aux réglages du mixeur.
- **Export MP3** (192 kbit/s), copier/coller de clips, analyseur de spectre sur le général.
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

Chaque cas d'usage est couvert par un test de bout en bout dans un vrai navigateur (`qa/run.cjs`, 190 cas).
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

## Version bureau

```bash
npm run desktop
```

ouvre l'application dans une fenêtre de bureau (Electron). `npm run desktop:build` produit l'installateur de votre système dans `release/`.
Sur GitHub, l'action **Version bureau** construit les installateurs Windows, macOS (puces Apple et Intel) et Linux ; ils se téléchargent dans les *Artifacts* de l'exécution.
Poser une étiquette de version (`git tag v0.8.0 && git push origin v0.8.0`) les publie dans la page **Releases** du dépôt.
Ils ne sont pas signés : Windows et macOS afficheront un avertissement au premier lancement.

## QA automatique

L'action **QA** relance toute la campagne à chaque mise à jour du dépôt et joint le rapport à l'exécution.

## Mise en ligne

Le fichier `.github/workflows/deploy.yml` publie l'application sur GitHub Pages à chaque mise à jour de `main`.
À activer une fois : dans le dépôt, *Settings > Pages > Source : GitHub Actions*.

## Sons embarqués

Les vrais instruments viennent de banques libres, converties par `tools/build-banks.sh` dans `public/banks` (7 Mo) :

- instruments : **FluidR3 GM** de Frank Wen, licence CC BY 3.0 (la mention de l'auteur est obligatoire : elle figure dans l'aide de l'application et dans `public/banks/CREDITS.txt`) ;
- batterie acoustique : **Virtuosity Drums** de Versilian Studios, licence CC0.

## Passation

`docs/PASSATION.md` décrit l'architecture, ce qui n'a jamais été vérifié, les limites assumées et le plan du prototype natif (V14b). `CLAUDE.md` rappelle les règles du projet.

## Dépendance

L'export MP3 utilise [`@breezystack/lamejs`](https://www.npmjs.com/package/@breezystack/lamejs) (licence LGPL), chargé seulement au moment d'exporter.
L'hôte de plugins web utilise `@webaudiomodules/sdk` (licence MIT). Le reste de l'application est sans dépendance d'exécution. Electron et electron-builder ne servent qu'à la version bureau.

## Structure

- `src/types.ts` — modèle de données, catalogue des sons, migration des anciens projets
- `src/i18n.ts` — textes en trois langues
- `src/audio/graph.ts` — graphe de mixage, instruments, batterie, séquenceur (partagé entre temps réel et export)
- `src/audio/engine.ts` — transport, mode Live, enregistrement, rendu hors-ligne, WAV
- `src/audio/wam.ts` — hôte de plugins web ; `public/wam/kh-tape` — plugin d'exemple
- `src/audio/banks.ts` — chargement des instruments enregistrés
- `src/audio/tune.ts` — correction de justesse
- `src/audio/stretch.ts` — étirement temporel et transposition des sons
- `src/audio/loudness.ts` — mesure LUFS et limiteur d'export
- `src/ui/library.ts` — fenêtre des projets et des modèles
- `src/input.ts` — jeu en direct (clavier, MIDI, accords, arpégiateur) et écriture des prises
- `src/files.ts` — export et import MIDI, archive ZIP des pistes séparées
- `public/` — manifeste, icône et service worker (hors-ligne)
- `src/store.ts` — état, historique, persistance
- `src/ui/` — arrangement, éditeurs, mixeur, Live, barre supérieure
