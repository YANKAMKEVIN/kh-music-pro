# Rapport de QA — KH Music Pro

148 cas réussis sur 148.

| Cas | Domaine | Cas d'usage | Résultat |
|---|---|---|---|
| T01 | Transport | Espace lance la lecture : le son sort et la position avance | OK |
| T02 | Transport | Stop revient au point de départ, un second Stop revient au début | OK |
| T03 | Transport | La boucle revient au début de la zone bouclée | OK |
| T04 | Transport | Sans boucle, la lecture s'arrête seule à la fin du morceau | OK |
| T05 | Transport | Le tempo saisi est appliqué et borné (40–240) | OK |
| T06 | Transport | Tap tempo : quatre tapes régulières règlent le tempo | OK |
| T07 | Transport | Métronome, décompte et boucle s'activent (boutons et raccourcis L / M) | OK |
| T08 | Transport | Un clic sur la règle déplace la tête de lecture | OK |
| A01 | Arrangement | Ajouter une piste de chaque type | OK |
| A02 | Arrangement | Renommer une piste | OK |
| A03 | Arrangement | Supprimer une piste (avec confirmation) | OK |
| A04 | Arrangement | Double-clic dans une piste : crée un clip et ouvre l'éditeur | OK |
| A05 | Arrangement | Déplacer un clip en le glissant (aimanté à la grille) | OK |
| A06 | Arrangement | Raccourcir un clip par son bord droit | OK |
| A07 | Arrangement | Dupliquer un clip (Ctrl+D) | OK |
| A08 | Arrangement | Scinder un clip à la tête de lecture (Ctrl+E) | OK |
| A09 | Arrangement | Supprimer un clip (touche Suppr) | OK |
| A10 | Arrangement | Annuler puis rétablir une modification | OK |
| A11 | Arrangement | Zoomer et dézoomer l'arrangement | OK |
| A12 | Arrangement | Glisser un clip vers une autre piste du même type | OK |
| A13 | Arrangement | Boucler la lecture sur un clip | OK |
| D01 | Batterie | Activer puis désactiver une case du séquenceur | OK |
| D02 | Batterie | Dessiner plusieurs cases en glissant | OK |
| D03 | Batterie | Le séquenceur propose 16 sons ; la longueur du motif est réglable | OK |
| D04 | Batterie | Effacer tout le motif | OK |
| D05 | Batterie | Changer de kit modifie réellement le son | OK |
| D06 | Pads | Vue Pads : 16 pads, un clic joue le son | OK |
| D07 | Pads | Jouer les pads au clavier (1–8 et rangée du milieu) | OK |
| D08 | Pads | Charger son propre sample sur un pad, puis revenir au son d'origine | OK |
| D09 | Batterie | Le swing retarde les contretemps du bon écart | OK |
| I01 | Instruments | Les 24 sons d'instrument produisent tous un signal propre | OK |
| I02 | Instruments | Choisir un son dans la liste change le moteur et l'affichage des réglages | OK |
| I03 | Piano roll | Ajouter une note d'un clic | OK |
| I04 | Piano roll | Déplacer une note (temps et hauteur) et l'étirer | OK |
| I05 | Piano roll | Effacer une note par double-clic, une autre par clic droit | OK |
| I06 | Jeu en direct | Jouer l'instrument au clavier : note tenue puis relâchée | OK |
| I07 | Jeu en direct | Changer d'octave au clavier | OK |
| I08 | Jeu en direct | Clavier maître MIDI : note on / note off sur un instrument, pads sur une batterie | OK |
| I09 | Sampler | Charger un son dans le sampler et le jouer à différentes hauteurs | OK |
| R01 | Enregistrement | Enregistrer ce que l'on joue au clavier dans un nouveau clip | OK |
| R02 | Enregistrement | Enregistrer des pads en boucle (overdub) dans le motif existant | OK |
| R03 | Enregistrement | Le clip enregistré épouse la zone de boucle | OK |
| R04 | Enregistrement | Décompte : une mesure avant le départ | OK |
| R05 | Enregistrement | Enregistrer le micro : un clip audio apparaît, avec du signal | OK |
| R06 | Enregistrement | Micro avec décompte : la prise est calée sur le premier temps | OK |
| U01 | Audio | Importer un fichier audio : le clip a la bonne durée | OK |
| U02 | Audio | Régler le gain d'un clip audio puis le scinder | OK |
| U03 | Export | Exporter le morceau en WAV : fichier valide, audible, sans saturation | OK |
| U04 | Mixage | Muet, solo et volume agissent sur le rendu | OK |
| U05 | Mixage | Filtre, saturation, réverb, égaliseur et filtre général agissent sur le rendu | OK |
| U06 | Export | Des exports successifs du même morceau sont identiques (aucune note perdue) | OK |
| M01 | Mixeur | Une tranche par piste plus le général ; le fader règle le volume | OK |
| M02 | Mixeur | Compresseur, muet et solo depuis le mixeur | OK |
| M03 | Mixeur | Les vumètres bougent pendant la lecture | OK |
| L01 | Live | Lancer un clip : il démarre à la mesure et tourne en boucle | OK |
| L02 | Live | Enchaîner un autre clip sur la même piste : bascule à la mesure suivante | OK |
| L03 | Live | Lancer une scène démarre toute la ligne | OK |
| L04 | Live | Arrêter une piste, puis tout arrêter | OK |
| L05 | Live | Filtre général et jeu par-dessus les clips en direct | OK |
| P01 | Projet | Enregistrer le projet, en créer un nouveau, puis rouvrir le fichier | OK |
| P02 | Projet | Les sons importés voyagent avec le fichier projet | OK |
| P03 | Projet | Un projet de la version précédente s'ouvre et se met à niveau | OK |
| P04 | Projet | Un fichier invalide est refusé avec un message clair | OK |
| P05 | Projet | Sauvegarde automatique : le travail survit au rechargement de la page | OK |
| N-en | Langues | Interface complète en « en » : toutes les vues, aucun texte manquant | OK |
| N-es | Langues | Interface complète en « es » : toutes les vues, aucun texte manquant | OK |
| N-fr | Langues | Interface complète en « fr » : toutes les vues, aucun texte manquant | OK |
| N04 | Langues | La langue choisie est conservée après rechargement ; les noms de notes suivent la langue | OK |
| X01 | Ergonomie | Saisir du texte ne déclenche aucun raccourci | OK |
| X02 | Ergonomie | L'aide s'ouvre avec « ? » et se ferme avec Échap ; elle bloque les raccourcis | OK |
| X03 | Accessibilité | Tous les boutons et champs ont un nom accessible | OK |
| X04 | Accessibilité | Navigation au clavier : Tab atteint les commandes, Entrée active une case du séquenceur | OK |
| X05-1024 | Ergonomie | Fenêtre 1024×700 : rien ne déborde, toutes les commandes restent atteignables | OK |
| X05-820 | Ergonomie | Fenêtre 820×620 : rien ne déborde, toutes les commandes restent atteignables | OK |
| X06 | Ergonomie | Le panneau du bas se redimensionne en glissant sa bordure | OK |
| X07 | Robustesse | Projet vide : lecture, export et scission ne plantent pas | OK |
| X08 | Robustesse | Supprimer la piste en cours de lecture ou d'enregistrement ne plante pas | OK |
| X09 | Robustesse | Changer le tempo et le zoom pendant la lecture | OK |
| AU01 | Automation | Le bouton A ouvre la piste d'automation ; un clic pose un point à la bonne valeur | OK |
| AU02 | Automation | Déplacer un point en le glissant, l'effacer par double-clic ou clic droit, annuler | OK |
| AU03 | Automation | Changer de paramètre (pan, filtre) et effacer une courbe | OK |
| AU04 | Automation | Une courbe de volume s'entend au rendu (montée progressive, niveau fixe) | OK |
| AU05 | Automation | Les courbes de pan et de filtre s'entendent au rendu | OK |
| AU06 | Automation | En lecture, la courbe pilote le son ; à l'arrêt, le mixeur reprend la main | OK |
| AU07 | Automation | Les courbes sont enregistrées dans le fichier projet | OK |
| F01 | Clips audio | Fondus d'entrée et de sortie : réglables et audibles au rendu | OK |
| F02 | Clips audio | Inverser un son : il est lu à l'envers, et l'annulation le rétablit | OK |
| F03 | Clips audio | Normaliser un son faible le ramène au niveau maximal sans saturer | OK |
| F04 | Clips audio | Un fondu plus long que le clip raccourci ne provoque ni erreur ni clic | OK |
| K01 | Piano roll | Vélocité : glisser dans la zone règle la force des notes | OK |
| K02 | Piano roll | Transposer le clip d'un demi-ton ou d'une octave, avec refus hors du clavier | OK |
| K03 | Gamme | Choisir une gamme grise les notes étrangères et aimante les notes posées | OK |
| K04 | Accords | Accords à un doigt : une touche joue et enregistre l'accord de la gamme | OK |
| K05 | Batterie | Notes douces : Maj+clic ou clic droit, visibles et plus faibles au rendu | OK |
| K06 | Piano roll | Les réglages du son se replient pour laisser la place aux notes | OK |
| MX01 | Mixage | Sidechain : la piste « pompe » à chaque coup de kick, puis revient | OK |
| MX02 | Mixage | Durée de la réverb, temps et répétitions de l'écho : réglables et audibles | OK |
| TK01 | Arrangement | Dupliquer une piste : copie complète, placée juste après | OK |
| TK02 | Arrangement | Monter et descendre une piste | OK |
| E01 | Passerelles | Exporter en MIDI : fichier standard, relu avec les bonnes notes et le bon tempo | OK |
| E02 | Passerelles | Importer un fichier MIDI : pistes, motif de batterie et tempo retrouvés, et jouables | OK |
| E03 | Passerelles | Un fichier MIDI illisible est refusé avec un message clair | OK |
| E04 | Passerelles | Exporter les pistes séparées : une archive ZIP valide, un WAV par piste, tous de même durée | OK |
| P06 | Projet | Un projet de la V2 s'ouvre dans la V3 avec les nouveaux réglages par défaut | OK |
| X10 | Robustesse | Automation, sidechain et accords pendant la lecture en boucle, puis suppression à chaud | OK |
| W01 | Application | Version construite : installable (manifeste) et utilisable hors-ligne après une première visite | OK |
| ST01 | Tempo et hauteur | Étirer un son à 200 % : deux fois plus long, même hauteur, niveau régulier | OK |
| ST02 | Tempo et hauteur | Transposer un son d'une octave ou d'une quinte : même durée, nouvelle hauteur | OK |
| ST03 | Tempo et hauteur | Indiquer le BPM du son le cale sur le tempo du projet | OK |
| IN01 | Entrée audio | Activer l'entrée : liste des micros, vumètre d'entrée, puis fermeture | OK |
| IN02 | Entrée audio | Écoute de contrôle et gain d'entrée | OK |
| IN03 | Entrée audio | Enregistrer avec l'entrée déjà ouverte : la prise est faite et l'entrée reste disponible | OK |
| AR01 | Arpégiateur | Les notes tenues sont égrenées dans l'ordre, au tempo, et s'arrêtent au relâchement | OK |
| AR02 | Arpégiateur | Modes descendant et aller-retour, avec un accord à un doigt | OK |
| AR03 | Arpégiateur | En enregistrement, l'arpège est calé sur la grille et écrit dans le clip | OK |
| MK01 | Repères | Poser des repères, y sauter, les renommer et les supprimer | OK |
| MB01 | Téléphone | Écran de téléphone tactile : mise en page compacte, lecture, séquenceur, pads, menu et onglets au doigt | OK |
| MB02 | Téléphone | Au doigt : déplacer un clip et dessiner une courbe d'automation | OK |
| OK01 | Clavier à l'écran | Afficher le clavier, jouer une touche à la souris, glisser vers une autre, changer d'octave | OK |
| OK02 | Clavier à l'écran | Sur écran tactile : clavier affiché d'office, accord à deux doigts | OK |
| SN01 | Piano roll | Sélectionner plusieurs notes au rectangle (Maj+glisser) et les déplacer ensemble | OK |
| SN02 | Piano roll | Tout sélectionner, copier, coller à la tête de lecture, supprimer la sélection | OK |
| SN03 | Piano roll | Flèches : déplacer et transposer la sélection ; sans sélection, Suppr supprime toujours le clip | OK |
| NR01 | Pads | Répétition de notes : un pad maintenu roule au tempo, puis s'arrête au relâchement | OK |
| NR02 | Pads | Un roulement joué pendant l'enregistrement est écrit sur la grille | OK |
| MA01 | Finition | Égaliseur et largeur stéréo du général : réglables et audibles | OK |
| MA02 | Finition | La mesure LUFS est juste sur des signaux de référence | OK |
| MA03 | Finition | Export au niveau streaming : le morceau sort à −14 LUFS sans saturer ; le bouton Mesurer l'affiche | OK |
| LB01 | Projets | Nouveau projet depuis un modèle ; le précédent reste dans « Mes projets » et se rouvre | OK |
| LB02 | Projets | Chaque modèle (trap, house, lo-fi, vide) donne un projet jouable, propre et dans sa gamme | OK |
| LB03 | Projets | Dupliquer et supprimer un projet ; la bibliothèque survit au rechargement de la page | OK |
| LB04 | Projets | Ouvrir un fichier .khm crée un nouveau projet sans écraser celui en cours | OK |
| CH01 | Découpage | Découper une boucle en 16 tranches : pads chargés, motif qui rejoue la boucle, piste d'origine en muet | OK |
| CH02 | Découpage | Découper selon les attaques : une tranche par coup, placée sur son temps | OK |
| CH03 | Découpage | Un son trop court est refusé ; 8 tranches égales fonctionne | OK |
| FX01 | Effets Live | Écho et réverb à la volée : le son se prolonge tant que le bouton est maintenu | OK |
| FX02 | Effets Live | Bégaiement : le dernier instant tourne en boucle, même transport arrêté, puis le son reprend normalement | OK |
| FX03 | Effets Live | Couper une piste d'un geste depuis la grille ; les effets se jouent aussi au clavier | OK |
| ML01 | Assignation MIDI | Relier un bouton de contrôleur à un réglage, le piloter, retrouver l'assignation après rechargement, l'effacer | OK |
| MP01 | Export | Exporter en MP3 : fichier valide, de la bonne durée, relisible et audible | OK |
| CC01 | Arrangement | Copier un clip et le coller à la tête de lecture, sur la même piste ou une autre du même type | OK |
| SP01 | Mixeur | L'analyseur de spectre s'anime pendant la lecture et retombe à l'arrêt | OK |
| MOD01 | Mixage | Chorus, trémolo et lo-fi : réglables et audibles au rendu | OK |
| TU01 | Accordeur | La détection de hauteur est juste : sinus, son riche en harmoniques, silence et bruit | OK |
| TU02 | Accordeur | Avec l'entrée active, l'accordeur affiche la note reçue ; il disparaît à la fermeture | OK |
| TR01 | Visite guidée | La visite se lance depuis l'aide, éclaire 8 zones, se parcourt au clic ou au clavier et bloque les raccourcis | OK |
| TR02 | Visite guidée | Sur téléphone, chaque bulle de la visite tient à l'écran | OK |
| DK01 | Version bureau | L'application de bureau démarre, charge le projet, joue et produit du son, sans accès système depuis la page | OK |
