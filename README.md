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

## Jeu expressif et production (v0.19)

- **Pitch bend, molette de modulation et aftertouch** du clavier MIDI (le DGX-670 envoie les deux premiers) : joués en direct sur la piste choisie, enregistrés dans le clip, gardés dans le projet, rendus à l'export audio et écrits dans l'export MIDI (relus à l'import). Plage du bend réglable (± 2 demi-tons par défaut, jusqu'à ± 12) dans les réglages de l'instrument. La molette ajoute du vibrato ; l'aftertouch gonfle le son et ajoute un léger vibrato.
  - **Molettes à l'écran**, à gauche du clavier à l'écran : pitch bend (revient au centre au relâchement) et modulation (reste où on la laisse), à la souris, au doigt ou au clavier (flèches).
  - **Ligne des contrôles** sous le piano roll (bouton « 〰 Contrôles ») : voir, dessiner à la souris ou au doigt, effacer le bend, la modulation ou la pression d'un clip.
  - Une molette déjà assignée à un réglage du mixeur garde son assignation.
- **Exporter une partie seulement** et **WAV 24 bits / 48 kHz** : menu ▾ à côté d'Exporter, « Options d'export… ». Tout le morceau, la zone de boucle, ou de la mesure X à la mesure Y ; avec ou sans la fin du son (2,5 s de réverb et de relâchement). WAV en 16 bits (CD, streaming) ou 24 bits (studio, mastering), à 44,1 ou 48 kHz. Le MP3 et les pistes séparées suivent la même partie et la même fréquence ; le nom du fichier indique les mesures (« _m2-3 »). Le passage exporté sonne exactement comme dans le morceau (les notes tenues depuis avant y sont). Le MIDI exporte toujours tout.
- **Comping** : un clip enregistré en boucle (plusieurs prises) montre une ligne par prise dans l'éditeur. Glisser sur une prise la garde sur ce passage, à la souris ou au doigt ; au clavier, flèches puis Entrée. Les jonctions entre prises ont un fondu très court, sans clic. Le bouton « Prise N » reprend une prise sur tout le clip.
- **Fondus enchaînés** entre deux clips audio qui se touchent : réglage « Fondu enchaîné » du clip de droite. Le clip de gauche continue en s'effaçant pendant que celui de droite monte (à puissance constante, sans creux de volume) ; un X le montre dans l'arrangement. Cela vaut aussi pour les clips qui suivent le tempo.
- **Vrai sidechain** : dans le mixeur, sous le réglage « Sidechain », la source peut être le kick du séquenceur (comme avant) ou n'importe quelle autre piste — un kick importé en audio, une voix qui fait baisser la musique. La source est prise avant son volume : même coupée, elle fait pomper (« kick fantôme »).
- **Envois libres** : « ＋ Envoi » sur une piste du mixeur ; autant d'envois que voulu, chacun vers le bus choisi (un bus est créé s'il n'y en a pas), avec son niveau, pris avant (Pré) ou après (Post) le volume de la piste.
- **Quantification fine** : menu ▾ à côté de 🧲 dans le piano roll. Force (100 % sur la grille, 50 % à mi-chemin), swing appliqué aux notes (66 % ≈ ternaire), humanisation (petits décalages et forces au hasard), légato (chaque note jusqu'à la suivante). Sur les notes sélectionnées, ou toutes.
- **Instruments du Mac** (version bureau macOS) : dans les réglages d'une piste d'instrument, la liste « Instrument du Mac » propose les instruments Audio Unit installés (DLSMusicDevice, AUSampler d'Apple, et Serum, Arturia, Kontakt… s'ils sont installés). La piste joue alors ce plugin : clavier MIDI, clavier à l'écran, enregistrement, piano roll, pitch bend, molette, aftertouch et pédale lui sont transmis, à l'échantillon près. « Fenêtre de l'instrument » ouvre son interface ; ce qu'on y règle est gardé dans le projet (état complet du plugin) et rechargé à l'export. Sur le web, une telle piste reste muette et le dit. Essai réel : `node qa/au-instrument.cjs`.

## Barre du haut repensée (v0.18)

La barre du haut tient sur une ligne et se lit en trois groupes :

- **Projet**, à gauche : nom du morceau, menu **Projet ▾** (nouveau, bibliothèque, versions, ouvrir, enregistrer, importer), annuler et rétablir.
- **Jouer**, au centre : stop, lecture, enregistrement, compteur (mesure, temps, tempo), Tap, mesure (4/4), métronome ♪, boucle (le bouton affiche sa plage, par exemple « ⟲ 1 → 4 »), menu **Prise ▾** (décompte, punch, plage de la boucle).
- **Sortie**, à droite : **Exporter** (WAV) avec son menu ▾ (MP3, pistes séparées, MIDI), réglages ⚙ (clavier MIDI, carte son, langue) et aide.

Une **barre d'arrangement**, juste au-dessus des pistes, réunit la grille, le zoom, les changements de tempo, les repères et les notes du projet.

Sur **téléphone**, la barre tient sur deux lignes sans déborder : ☰, transport et compteur en haut ; projet, métronome, boucle et prise en dessous. Export, réglages et aide sont dans ☰, et le menu Projet propose « Renommer le projet… ». Un appui long sur un clip ouvre son menu même quand le téléphone est occupé (chargement des sons, gros redessin) : c'est la durée de l'appui qui compte ; le menu reste ouvert quand le doigt se lève, même juste après un appui bref (depuis le 21/11/2026).

**Têtes de piste** : le nom de chaque piste s'affiche en entier. M, S, A et le volume restent visibles ; monter, descendre, dupliquer, geler et supprimer sont dans le menu **⋯** de la piste (aussi au doigt sur téléphone, où ces actions n'étaient pas accessibles). Une piste gelée montre ❄ à côté de son nom. Le menu ⋯ reste ouvert pendant la lecture ou une prise (depuis le 21/11/2026) : il se referme par un clic ailleurs, Échap ou un choix.

**Du son à la séquence (V20, en cours)** — menu Projet › « Du son à la séquence… » : charge un fichier audio (une chanson, une maquette ; usage personnel) et KHMP en tire de quoi refaire le morceau. **Séparer les pistes** : voix, batterie, basse, guitare, piano et autres instruments (modèle Demucs à six pistes, 177 Mo téléchargés une fois ; mode rapide à quatre pistes sans modèle). **Tempo et tonalité** : tempo, premier temps, changements de tempo en grands passages réguliers. **Chant → notes**, **Basse → notes**, **Piano → notes**, **Guitare → notes** (modèle Basic Pitch) et **Batterie → motif** : chaque partie trouvée s'ajoute au morceau comme une piste jouable et modifiable, calée sur le tempo du son ; quand la vraie piste séparée existe, la partie en reprend les nuances (force de chaque note) et le volume, et la guitare joue six notes au plus en même temps. Les pistes séparées ajoutées au morceau commencent à leur premier temps, pour tomber juste avec les parties rejouées. **Instruments** : familles d'instruments reconnues. Tout se calcule dans l'appareil, rien n'est envoyé ailleurs. Limites : le résultat est une base de travail, pas une copie exacte ; compter plusieurs minutes de calcul par minute de son pour la séparation. Détail : `docs/v20-du-son-a-la-sequence.md`.

**Correctifs de l'audit de novembre 2026** (détail : `docs/correctifs-audit-2026-11.md`) : séquenceur au clavier avec les flèches, une prise sur plusieurs mesures donne un seul clip, tempo au centième (93,5), bandeau quand la sauvegarde devient impossible (appareil plein) avec « Enregistrer en fichier », lettres du clavier prises de la vraie disposition, accordeur plus stable sur une machine chargée, export des gros projets environ deux fois plus rapide (pistes rendues par groupes sur plusieurs cœurs).

**Téléphone** : Rétablir est sur la deuxième ligne ; le morceau s'ouvre avec quatre mesures visibles ; le séquenceur montre 8 pas à la fois en grandes cases, un glissé du doigt passe aux 8 suivants ; tout ce qu'on touche fait au moins 44 px.

Les menus s'ouvrent d'un clic ou d'un toucher et se referment d'un clic ailleurs ou avec Échap (le focus revient au bouton). Les raccourcis clavier ne changent pas.

## Piano électrique, basse et percussions (v0.17.1)

Trois ajouts viennent compléter le piano acoustique et la batterie Studio :

- **Piano électrique expressif · Wurlitzer EP200**, famille Claviers et orgues : 47 échantillons mono, jusqu’à quatre nuances réelles. Les zones de notes et les corrections de justesse du mappage original sont respectées ; les nuances n’ont pas toutes les mêmes notes sources. Certaines notes aiguës réutilisent la même prise entre nuances, comme dans la banque d’origine. Plage d’origine MIDI 33–96 ; au-delà, la note source la plus proche est transposée.
- **Basse électrique expressive · Fashionbass**, famille Basses : 190 échantillons mono, cinq nuances et deux prises alternées par note enregistrée. Notes pincées uniquement, sans bruits de corde ni effets du moteur SFZ original. Zones d’origine MIDI 12–72, notes sources 18–69 ; les registres extrêmes hors plage restent obtenus par transposition.
- **Percussions acoustiques · VCSL**, dans le menu Kit d’une piste Batterie : 16 pads nommés, 72 frappes, une à quatre nuances et jusqu’à deux prises selon le son. Tumba, congas ouvertes/étouffées, quinto, bongos ouverts/étouffés, darbuka, claves, shaker, tambourin, guiro et triangle. Les percussions ne déclenchent pas artificiellement le sidechain du kick et ne se coupent pas entre elles comme un charleston.

Ces choix s’utilisent avec le clavier MIDI, la pédale existante, le piano roll et les pads. Les samples personnels restent prioritaires. Les anciens sons ne sont pas remplacés ; aucun nouveau champ n’est nécessaire dans les projets `.khm`. Les corrections de hauteur, les nuances et les prises alternées sont communes au direct et à l’export.

Sources : [Greg Sullivan’s E-Pianos](https://github.com/sfzinstruments/GregSullivan.E-Pianos), Greg Sullivan, CC BY 3.0 ; [Fashionbass](https://github.com/sfzinstruments/karoryfer.fashionbass), Karoryfer Samples, CC0 ; [VCSL](https://github.com/sgossner/VCSL), Versilian Studios, CC0. Les licences, mappages originaux et attributions sont fournis avec les sons. Les prises de percussions trop faibles sont amplifiées avant compression, puis le gain de lecture est calculé à partir du fichier final.

Les ajouts occupent **26,7 Mo** compressés ; mémoire décodée approximative à 48 kHz : Wurlitzer 19 Mio, basse 209 Mio, percussions 17 Mio. Chargement à la demande, uniquement pour les banques utilisées. Le catalogue contient désormais 56 sons d’instrument (dont 32 échantillonnés), et six kits. L’ensemble des cinq banques expressives représente 544 échantillons et 60,7 Mo compressés.

Le même script `python3 tools/build-expressive-banks.py` reconstruit les cinq banques ; il conserve les fichiers déjà vérifiés, sauf avec `--force`. `python3 tools/check-expressive-banks.py` contrôle les 544 fichiers et leurs mappages. `node qa/expressive-demo.cjs --ensemble` génère un projet et quatre écoutes dans `livrables/v0.17.1/`.

L’écoute humaine et les essais avec le Yamaha/Focusrite restent à faire. Les variantes et articulations des moteurs SFZ complets ne sont pas toutes reprises ; le logiciel utilise les enregistrements sélectionnés dans son propre lecteur.

## Banques expressives (v0.17.0)

Deux nouveaux choix complètent les instruments existants, sans remplacer les sons des anciens projets :

- **Piano à queue expressif · Salamander** : dans une piste Instrument, ouvrir **Son** ou **Parcourir les sons** et chercher « Salamander ». Quatre nuances réellement enregistrées (120 échantillons stéréo, 30 notes sources entre MIDI 21 et 108) sont choisies selon la force du jeu. Les notes intermédiaires sont transposées. Le réglage de nuances synthétiques est masqué pour ce piano : son timbre vient des prises originales.
- **Acoustique expressive · Studio** : sur une piste Batterie, choisir ce kit dans **Kit**, puis jouer les **Pads** ou le séquenceur. 16 pads, 115 frappes enregistrées, une à quatre nuances selon l’élément. Grosse caisse, charlestons, cymbales et percussions disposent jusqu’à trois variantes alternées. La caisse claire et les toms ont plusieurs nuances mais pas de variantes à force identique. Un charleston fermé coupe le charleston ouvert de la même piste.
- Les sons personnels importés sur un pad restent prioritaires et sont inclus dans le fichier `.khm`. Les banques embarquées sont référencées par leur identifiant ; elles ne sont pas dupliquées dans chaque fichier projet.
- **Pédale MIDI CC64** : maintien tout-ou-rien, relâchement et réattaque ; les durées enregistrées sont prolongées jusqu’au lever de pédale et sont donc conservées dans l’export audio et MIDI. Arrêt, perte de focus et déconnexion libèrent le maintien. Pas de demi-pédale ni de modélisation des résonances sympathiques.
- **Frappes MIDI enregistrées** : leur force est conservée dans le motif de batterie et à l’export MIDI.
- Une banque incomplète n’est jamais considérée comme chargée. Un export audio est annulé avec un message si un instrument ne peut pas être chargé, pour éviter un fichier incomplet. L’export MP3 contrôle également les crêtes après décodage et réduit légèrement le gain si nécessaire, sans modifier le WAV ni le projet.

Les deux banques ajoutent environ **34 Mo** compressés, chargés à la demande avec six téléchargements/décodages simultanés au plus par banque. La version bureau inclut tous les fichiers. Sur le web, utiliser une première fois chaque banque en ligne pour que le service hors ligne puisse la garder ; un premier chargement hors ligne n’est pas possible. Le cache du navigateur reste soumis à son quota. Une fois décodés à 48 kHz, les sons occupent environ 433 Mio pour le piano et 60 Mio pour la batterie, en plus du reste de l’application : ces banques visent d’abord un ordinateur.

Sources : [Salamander Grand Piano v3](https://github.com/sfzinstruments/SalamanderGrandPiano), Alexander Holm, CC BY 3.0 ; [Virtuosity Drums](https://github.com/sfzinstruments/virtuosity_drums), Versilian Studios et Karoryfer, CC0. Attributions et adaptations dans `public/banks/CREDITS.txt`, licences originales dans les dossiers des banques. Les révisions sources, chemins et empreintes de chaque fichier figurent dans `public/banks/expressive-provenance.json`.

Reconstruction (Python 3, curl et ffmpeg) : `python3 tools/build-expressive-banks.py`. Vérification hors ligne des 235 fichiers : `python3 tools/check-expressive-banks.py`. La reconstruction sélectionne une version allégée : piano limité à 12 secondes par note, batterie à 6 secondes, fondu final de 150 ms. Bruits de mécanique/pédale et résonances du piano source non intégrés ; aucune banque complète de plugin tiers n’est nécessaire.

Exemples : serveur lancé, `node qa/expressive-demo.cjs` produit un projet `.khm`, trois écoutes WAV et deux captures dans `livrables/v0.17.0/` (profil temporaire, aucun projet personnel modifié).

Vérifications musicales finales : à écouter par le propriétaire avec son Yamaha DGX-670, sa pédale et sa Focusrite. Les tests MIDI et micro automatisés utilisent des messages et entrées simulés ; ils ne valident pas le branchement ni la latence de ce matériel réel.

## Fonctions (v0.17)

- **Arrangement** multipiste : clips déplaçables, redimensionnables, duplication, scission, boucle, grille magnétique, zoom ; pistes duplicables et réordonnables.
- **Automation** : courbes de volume, de pan et de filtre par piste, dessinées dans l'arrangement (bouton **A**) ; depuis la v0.17, aussi n'importe quel réglage des effets de la piste, plugins du Mac compris. Depuis la suite du 21/11/2026 : l'égaliseur (graves, médiums, aigus) et le seuil du compresseur de la tranche, et, pour un instrument de l'application, le filtre et la résonance (lus au départ de chaque note). Depuis le 22/11/2026 : la fréquence du médium et le taux du compresseur.
- **Batterie** : 16 sons, 3 kits, séquenceur à pas avec swing et notes douces, **16 pads** jouables (souris, clavier, MIDI) acceptant vos propres samples.
- **Instruments** : 24 sons (claviers, basses dont 808 et acid, leads, cuivres, flûte, nappes, cordes pincées, cloches) sur quatre moteurs (soustractif, FM, corde pincée, **sampler**).
- **Piano roll** : vélocité par note, transposition, **gamme** (surlignage et aimantation), **accords à un doigt**.
- **Jeu en direct** : clavier d'ordinateur avec notes tenues et changement d'octave, **clavier maître ou pads MIDI**.
- **Enregistrement** : micro calé à l'échantillon près sur le transport, enregistrement de ce que vous jouez (notes, accords et pads) en boucle, décompte.
- **Entrée audio** : choix du micro ou de la carte son, vumètre et gain d'entrée, écoute de contrôle.
- **Clips audio** : gain, fondus d'entrée et de sortie, inversion, normalisation, **étirement au tempo** sans changer la hauteur et **transposition** sans changer la durée.
- **Chaîne d'effets** par tranche : écho, réverb, phaser, auto-pan, bande d'égaliseur, gain, à ajouter, ordonner et couper librement (jusqu'à huit).
- **Chaînes d'effets à la place de la tranche fixe** (21/11/2026) : dans la fenêtre Effets, « Convertir la tranche en effets » (ou « Tout le projet ») transforme le filtre, la saturation, le lo-fi, le chorus, le trémolo, l'égaliseur et le compresseur de la tranche en effets placés en tête de chaîne, avec leurs réglages et leurs courbes : le son ne change pas (vérifié à l'échantillon près). On peut ensuite les retirer, en ajouter, les réordonner (▲ ▼, glisser la poignée ⠿, ou Alt + flèches) et les automatiser, y compris la profondeur du trémolo et la fréquence du médium. Le mixeur et l'assignation MIDI pilotent les effets de la chaîne ; « Revenir à la tranche fixe » reste possible tant que l'ordre du son est gardé. Les anciens projets s'ouvrent en tranche fixe, comme avant.
- **Plugins web** (Web Audio Modules) dans la chaîne d'effets, avec leur propre interface ; un plugin d'exemple est fourni. Un plugin venu d'un autre site demande un accord explicite.
- **Plugins du Mac** (version bureau macOS) : les effets Audio Unit installés sur le Mac s'ajoutent à la chaîne d'effets, avec leurs réglages (fréquences sur une échelle logarithmique, listes de choix, interrupteurs) et leurs préréglages d'usine ; on les entend à l'écoute comme à l'export, et leur latence est compensée.
- **Réglages audio** : choix de la sortie, latence affichée, décalage d'enregistrement réglable ou mesuré. Sur Mac, dans la version bureau : **moteur audio natif** (son par Core Audio, environ 74 ms aller-retour au lieu de 110 sur les haut-parleurs du Mac), **activé par défaut** depuis le 21/11/2026 quand le module natif est présent. Pour le couper : l'interrupteur des Réglages audio (choix retenu) ou `KH_NATIVE=0` au lancement ; s'il ne démarre pas, le son repasse tout seul par le navigateur. Site web, Windows et Linux : inchangés. Avec une carte son externe (Focusrite…), le moteur natif a la carte pour lui seul : plus de craquements dus au navigateur (v0.19.1).
- **Tempo et mesure** : changements de tempo en cours de morceau (posés dans la règle, suivis à la lecture, à l'export et dans le MIDI), signature rythmique de 2/4 à 7/4, et depuis la suite du 21/11/2026 en croches : 6/8, 9/8 et 12/8 (temps d'une noire pointée : métronome, décompte, compteur, lignes de temps), 5/8 et 7/8 (temps d'une croche). La signature part dans le fichier MIDI.
- **Mode Live** : calage du lancement à la mesure, au temps ou immédiat ; scènes lancées aux touches 1 à 9. Depuis la suite du 21/11/2026 : **clips enregistrés à la volée** (ligne « Prise » sous les clips : ● sur une piste d'instrument ou de batterie, la prise part à la mesure suivante, dure 1, 2 (par défaut), 4 ou 8 mesures, puis le clip tourne en boucle ; un second appui abandonne, Annuler la retire ; l'arpégiateur, la répétition de notes, le pitch bend et la molette y sont gardés depuis le 22/11/2026).
- **Mixage avancé** : bus pour regrouper des pistes, bande médium à fréquence réglable avec courbe d'égaliseur visible, compresseur réglable (seuil, taux, réduction affichée), automation des envois de réverb et d'écho et du chorus.
- **Prises multiples** : enregistrement audio en boucle (une prise par tour), choix de la prise, montage par scission ; **punch** sur la zone de boucle ; **correction de justesse** vers la gamme du projet.
- **Banque généraliste** : 29 instruments échantillonnés, classés en huit familles (claviers et orgues, guitares, basses, cordes, cuivres, bois, percussions mélodiques, voix et ambiances), et une batterie acoustique. Seuls les sons utilisés sont chargés, depuis les fichiers embarqués. Les sons de synthèse et le sampler restent disponibles.
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

## Nouveaux sons (v0.15)

Sur une piste **Instrument**, ouvrir le menu **Son** dans l’éditeur. Les sons enregistrés sont classés par famille avant les sons de synthèse.

| Famille | Ajouts |
|---|---|
| Claviers et orgues | Piano droit honky-tonk, piano électrique enregistré, clavinet, orgue à tirettes, orgue d’église |
| Guitares et basses | Guitare acoustique acier, guitare saturée, basse slap |
| Cordes et cuivres | Violon solo, contrebasse à l’archet, trompette, trombone |
| Percussions mélodiques | Marimba et vibraphone enregistrés, steel drum |
| Voix et ambiances | Nappe aérienne, texture cinématique, chœur synthétique |

Les 18 ajouts représentent 450 fichiers MP3 (25 notes par son, MIDI 24 à 96). Ils sont inclus dans la version bureau ; dans la version web, un son doit être chargé une première fois en ligne avant de pouvoir être réutilisé hors ligne. Les instruments et leurs identifiants précédents sont conservés, ainsi que le format `.khm`.

Les sons ont une seule couche de vélocité. Les orgues à tirettes et d’église, les cordes, le violon, le violoncelle, la contrebasse à l’archet, les chœurs et les ambiances proposent désormais des notes longues avec boucle de maintien et raccord fondu. Les sons percussifs gardent leur décroissance naturelle. Le piano droit a une couleur honky-tonk, distincte d’un piano droit neutre. L’écoute humaine et les essais sur matériel réel restent à faire.

## Notes longues et navigateur de sons (v0.15.1)

- **Parcourir les sons**, dans l’éditeur d’une piste Instrument : rechercher par nom (avec ou sans accents), filtrer par famille et retrouver ses **Favoris**. Les favoris restent sur cet appareil et ne modifient pas le projet.
- Le bouton **▶** préécoute un son sans changer l’instrument de la piste ni démarrer le transport. Cliquer sur son nom pour l’appliquer ; ce changement reste annulable. **Échap** ferme le navigateur et arrête la préécoute.
- **Notes longues**, à côté du choix du son pour les instruments compatibles, prolonge la partie tenue jusqu’au relâchement, en direct comme dans l’arrangement et à l’export. L’attaque d’origine est conservée et la fin reste progressive. On peut désactiver ce réglage.
- Les instruments compatibles nouvellement sélectionnés activent ce maintien par défaut. Un ancien projet sans ce réglage conserve sa durée précédente ; le bouton permet de l’activer explicitement. Le choix voyage dans le fichier `.khm`.
- La boucle est calculée à partir d’une portion du son avec raccord de phase et fondu croisé. Le réalisme du maintien et l’équilibre des timbres restent à vérifier à l’oreille sur du matériel réel.

## Nuances et sons plus réguliers (v0.15.2)

- **Nuances**, dans les réglages d’un instrument enregistré : une note jouée doucement (clavier MIDI sensible au toucher, ou force réduite dans le piano roll) sonne plus feutrée et attaque un peu moins sec ; jouée fort, le son s’ouvre complètement. À zéro, la force ne change que le volume. Les nouveaux instruments enregistrés ont des nuances par défaut ; un ancien projet garde exactement son son.
- Les sources libres utilisées n’ont qu’une prise par note : les nuances sont obtenues en assombrissant le timbre selon la force, relativement à la hauteur de la note. Sur des sons déjà doux (piano électrique, nappes), l’effet est discret.
- **Registres égalisés** : le volume perçu de chaque note enregistrée est ramené vers la tendance de son instrument. Plus de note qui ressort ou disparaît par rapport à ses voisines (écart maximal mesuré : 1,3 dB entre deux notes enregistrées voisines, contre 11 dB avant), tout en gardant un grave plus rond et un aigu plus léger.
- **Raccords des notes longues** : fondu de 100 ms, niveau corrigé pendant le fondu et compensation progressive sur toute la boucle. Plus de bosse ou de creux de niveau à chaque tour (jusqu’à 8 dB avant sur certaines notes), et aucun clic, mesurés sur les 237 boucles.

## Ne rien perdre, gros projets, plugins du Mac (v0.17)

- **Versions du morceau** (menu Projet) : une version est gardée toutes les deux minutes de travail, à l'ouverture et avant chaque restauration ; on revient à n'importe laquelle, et Annuler ramène l'état d'avant.
- **Après un plantage** (onglet ou application fermés net, ordinateur éteint) : au lancement suivant, le morceau est rouvert tel qu'il était à la dernière sauvegarde automatique, avec un message et un accès aux versions. Une sauvegarde illisible est remplacée par la dernière version lisible.
- **Version bureau Mac : vrais fichiers** : Ouvrir, Enregistrer (Cmd+S réécrit le même fichier), Enregistrer sous (Cmd+Maj+S) dans le dossier de son choix, fichiers récents dans le menu Projet, double-clic sur un `.khm` dans le Finder. Écriture sûre : un plantage pendant l'enregistrement ne laisse jamais un fichier à moitié écrit.
- **Gestes plus sûrs** : un glissé (note, poignée, vélocité, boucle, clip, point d'automation, séparation) annulé par le système revient comme avant ; un deuxième doigt ne le perturbe pas ; une souris relâchée hors de la fenêtre ne laisse rien accroché.
- **Clips audio qui suivent le tempo** (bouton « Suit le tempo » d'un clip audio) : le son s'étire sans changer de hauteur pour suivre le tempo du morceau et ses changements, à l'écoute comme à l'export ; tempo d'origine réglable (boucle à 90 BPM dans un morceau à 120). L'étirement garde chaque coup de batterie à l'heure.
- **Geler une piste** (❄ dans l'en-tête) : son rendu (instrument, effets, automation) devient un clip audio sur une piste juste en dessous ; l'originale est coupée et ne calcule plus rien. Dégeler la ramène.
- **Charge** (mixeur) : mesure la puissance de calcul que demande le mixage, avec les notes en retard et les décrochages de la dernière lecture.
- **Fenêtre des plugins du Mac** (version bureau) : bouton « Fenêtre du plugin » dans la chaîne d'effets ; ce qu'on y règle est enregistré dans le projet.

## QA

Chaque cas d'usage est couvert par un test de bout en bout dans un vrai navigateur (`qa/run.cjs`, 459 cas).
Le plus simple, serveur compris :

```bash
npm run qa:all
```

Ou, avec le serveur de développement déjà lancé sur le port 5173 :

```bash
npm run qa
```

Le rapport est écrit dans `qa/REPORT.md`. Les cas EM comparent des exports à une **empreinte sonore** enregistrée (`qa/empreintes/`) ; après un changement de son voulu et écouté : `KH_EMPREINTE=maj npm run qa:all -- EM`. Pour continuer à modifier le code pendant une campagne : `qa/snapshot.sh <dossier> npm run qa:all` la lance sur une copie figée. Si Chromium est déjà installé sur la machine, `KH_CHROMIUM_PATH=/chemin/vers/chromium npm run qa:all` permet de l’utiliser. Un seul domaine : `npm run qa -- L` (Live), `npm run qa -- AU,F` (automation et clips audio).
Les tests utilisent Playwright (`npm i -D playwright` puis `npx playwright install chromium` si besoin) ; le cas E04 utilise `python3` pour vérifier l'archive ZIP.

## Version bureau

```bash
npm run desktop
```

ouvre l'application dans une fenêtre de bureau (Electron). `npm run desktop:build` produit l'installateur de votre système dans `release/`.
Sur GitHub, l'action **Version bureau** construit les installateurs Windows, macOS (puces Apple et Intel) et Linux ; ils se téléchargent dans les *Artifacts* de l'exécution.
Poser une étiquette de version (`git tag v0.8.0 && git push origin v0.8.0`) les publie dans la page **Releases** du dépôt.
Ils ne sont pas signés : Windows et macOS afficheront un avertissement au premier lancement.

Sur Mac, la version bureau embarque un **module natif** (`native/kh-au-bridge`) pour les plugins Audio Unit et le moteur audio natif. Pour le construire (un fichier pour les puces Apple et Intel) :

```bash
npm run native
```

`KH_ARCHS=arm64 npm run native` le construit pour une seule puce, plus vite. Sans lui, la version bureau marche comme la version web.
Vérifications natives (sur un Mac) : `node qa/au-bridge.cjs 60`, `node qa/native-io.cjs 60`, `node qa/au-window.cjs` (fenêtre des plugins), `node qa/empreinte-mac.cjs` (empreinte sonore des plugins du Mac), `node qa/desktop-files.cjs` (fichiers de projet), et `node qa/packaged-mac.cjs --strict` pour l'application de l'installateur.

## QA automatique

L'action **QA** relance toute la campagne à chaque mise à jour du dépôt et joint le rapport à l'exécution.

## Mise en ligne

Le fichier `.github/workflows/deploy.yml` publie l'application sur GitHub Pages à chaque mise à jour de `main`.
À activer une fois : dans le dépôt, *Settings > Pages > Source : GitHub Actions*.

## Sons embarqués

Les vrais instruments viennent de banques libres, converties par `tools/build-banks.sh` dans `public/banks` :

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
- `src/audio/au.ts`, `src/audio/native-io.ts`, `src/ui/native.ts` — plugins du Mac et moteur audio natif ; `native/kh-au-bridge` — module natif ; `electron/native-preload.cjs` — pont isolé vers la page
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
