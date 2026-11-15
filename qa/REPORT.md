# Rapport de QA — KH Music Pro

282 cas réussis sur 283.

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
| DK01 | Version bureau | L'application de bureau démarre, charge le projet, joue et produit du son, sans accès système depuis la page | ÉCHEC : échec : spawnSync xvfb-run ENOENT |
| CL01 | Arrangement | Rogner un clip par son bord gauche : le contenu reste à sa place, sans pouvoir dépasser le début du son | OK |
| CL02 | Arrangement | Sélectionner plusieurs clips (Maj+clic), les déplacer, les dupliquer et les supprimer ensemble | OK |
| CL03 | Arrangement | Tracer la boucle dans la règle (Maj+glisser) ; un clic simple déplace toujours la tête de lecture | OK |
| PD01 | Pads | Réglages par pad : volume, hauteur et panoramique, audibles au rendu, puis retour à l'origine | OK |
| PT01 | Batterie | Décaler le motif d'un pas et doubler sa longueur | OK |
| MP02 | Mixeur | Appliquer un préréglage de mixage à une piste, l'entendre et l'annuler | OK |
| NT01 | Projet | Notes du projet : écrire sans déclencher de raccourci, retrouver le texte, le garder dans le fichier | OK |
| GR01 | Grille fine | Triples-croches : la grille 1/32 aimante au demi-pas, et les notes sonnent au bon instant | OK |
| GR02 | Grille fine | Triolets : trois notes par temps, placées et jouées à intervalles égaux | OK |
| GR03 | Grille fine | Quantifier : recaler toutes les notes ou seulement la sélection sur la grille | OK |
| GR04 | Grille fine | Batterie en triples-croches et en triolets : les coups gardent leur place, les nouveaux sonnent au bon instant | OK |
| GR05 | Grille fine | Enregistrement : les notes jouées se calent sur la grille choisie, les pads sur la résolution du motif | OK |
| GR06 | Grille fine | MIDI : triolets et triples-croches survivent à l'export puis à l'import | OK |
| GR07 | Grille fine | Mode Live, scission et copier/coller fonctionnent avec des notes hors de la double-croche | OK |
| RI01 | Vrais instruments | Les 29 instruments enregistrés se chargent et produisent un signal propre | OK |
| RI02 | Vrais instruments | Les notes sont justes, y compris celles obtenues par transposition | OK |
| RI03 | Vrais instruments | Les notes partent à l'heure (pas de retard dû au fichier son) et s'arrêtent quand on les relâche | OK |
| RI04 | Vrais instruments | Choisir un vrai instrument dans la liste, le jouer au clavier, le retrouver après rechargement | OK |
| RI05 | Vrais instruments | Batterie acoustique : 16 sons enregistrés, à l'heure, différents des sons synthétisés | OK |
| RI06 | Vrais instruments | Si les sons ne peuvent pas être chargés : message clair, rien ne plante, le reste joue | OK |
| LT01 | Prises | Enregistrer en boucle : une prise par tour, alignées, à choisir ensuite ; scinder pour mêler deux prises | OK |
| LT02 | Prises | Punch : seule la zone de boucle est réenregistrée, ce qui l'entoure est conservé | OK |
| TN01 | Justesse | La correction ramène une note fausse sur la gamme, sans changer la durée ni abîmer le son | OK |
| TN02 | Justesse | Bouton « Corriger » : le clip est accordé, le message le dit, l'annulation le rétablit ; un bruit est refusé | OK |
| BS01 | Bus | Créer un bus, y envoyer des pistes, et les traiter ensemble (volume, muet, filtre) | OK |
| BS02 | Bus | Renommer et supprimer un bus ; le routage survit au fichier projet ; les vumètres du bus bougent | OK |
| EQ01 | Mixeur | Bande médium à fréquence réglable, et courbe d'égaliseur fidèle aux réglages | OK |
| CP01 | Mixeur | Compresseur réglable : seuil et taux agissent, la réduction s'affiche en lecture | OK |
| AU08 | Automation | Automatiser les envois de réverb et d'écho et le chorus | OK |
| TP01 | Tempo | Un changement de tempo en cours de morceau s'entend au bon instant, à l'export comme en lecture | OK |
| TP02 | Tempo | Poser, modifier et supprimer un changement de tempo depuis la règle | OK |
| TP03 | Tempo | Les changements de tempo voyagent dans le fichier projet et dans le MIDI | OK |
| SG01 | Signature | Passer en 3/4 : mesures de trois temps dans la règle, la boucle, les clips et les motifs | OK |
| LQ01 | Live | Calage du lancement : à la mesure, au temps ou immédiat ; les chiffres lancent les scènes | OK |
| FXC01 | Chaîne d'effets | Ouvrir la chaîne d'une piste, ajouter des effets, les régler, les réordonner, les couper, les retirer | OK |
| FXC02 | Chaîne d'effets | Chaque effet s'entend au rendu ; un effet coupé ne change rien | OK |
| FXC03 | Chaîne d'effets | Les effets fonctionnent sur un bus et voyagent dans le fichier projet | OK |
| WAM01 | Plugins web | Charger le plugin web fourni, le régler par sa propre interface, l'entendre en direct et à l'export, le retrouver dans le projet | OK |
| WAM02 | Plugins web | Plugin introuvable : message clair, le son passe quand même, l'export le signale | OK |
| WAM03 | Plugins web | Un plugin venu d'un autre site demande un accord explicite ; une adresse dangereuse est refusée | OK |
| LAT01 | Latence | Réglages audio : latence affichée, choix de la sortie, mesure qui échoue proprement sans haut-parleur | OK |
| LAT02 | Latence | Le décalage d'enregistrement recale réellement les prises | OK |
| LAT03 | Latence | Sans le module natif (version web), le son entre et sort toujours par le navigateur | OK |
| NAT01 | Moteur natif | Sans module natif (site web, Windows, Linux) : ni réglage « moteur audio natif » ni plugins du Mac | OK |
| NAT02 | Moteur natif | Avec le module : réglage désactivé par défaut, activé au clic, désactivé au clavier ; le son change de chemin et le choix est retenu | OK |
| NAT03 | Moteur natif | Échec du moteur natif : message clair, le son reste au navigateur, la sortie choisie est gardée | OK |
| NAT04 | Moteur natif | Le choix est retenu : au lancement suivant, le moteur natif se rallume tout seul | OK |
| NAT05 | Moteur natif | Réglage et plugins du Mac en anglais et en espagnol | OK |
| MAC01 | Plugins du Mac | Les plugins d'effet du Mac sont proposés dans la chaîne d'effets, triés ; en ajouter un affiche ses réglages | OK |
| MAC02 | Plugins du Mac | Les curseurs d'un plugin du Mac pilotent le plugin, s'enregistrent dans le projet, s'annulent et reviennent aux réglages d'origine | OK |
| MAC03 | Plugins du Mac | Projet avec un plugin du Mac ouvert sans module natif : mention « indisponible ici », son tel quel, aucun message d'erreur | OK |
| MAC04 | Plugins du Mac | Plugin du Mac qui ne se charge pas : message clair, le son passe sans lui ; huit effets au plus | OK |
| MAC05 | Plugins du Mac | Supprimer la piste ou ouvrir un autre projet libère ses plugins du Mac ; un effet retiré pendant son chargement n'est pas signalé en échec | OK |
| MAC06 | Plugins du Mac | Fréquences d'un plugin du Mac sur une échelle logarithmique : le milieu du curseur tombe vers 470 Hz, valeur lue au lecteur d'écran | OK |
| MAC07 | Plugins du Mac | Réglages à choix d'un plugin du Mac : liste des valeurs par leur nom, interrupteur marche/arrêt au clavier | OK |
| MAC08 | Plugins du Mac | Préréglages d'usine d'un plugin du Mac : en charger un recopie ses réglages dans le projet ; toucher un réglage repasse en réglages personnels ; annulable | OK |
| MAC09 | Plugins du Mac | Compensation de la latence déclarée par les plugins du Mac : les autres pistes et les bus sont retardés d'autant, l'export reste calé | OK |
| BN01 | Banque généraliste | Les 18 nouveaux sons sont classés par famille et nommés dans les trois langues | OK |
| BN02 | Banque généraliste | Chaque nouveau son se choisit et se joue au clavier en direct | OK |
| BN03 | Banque généraliste | Les banques sont chargées uniquement au choix du son et réutilisées ensuite | OK |
| BN04 | Banque généraliste | Un projet avec les 18 nouveaux sons survit au fichier .khm et au rechargement | OK |
| BN05 | Banque généraliste | Un nouveau son indisponible signale l’échec puis peut être rechargé | OK |
| BN06 | Banque généraliste | Sur téléphone, le sélecteur de sons et ses familles restent accessibles au doigt | OK |
| LH01 | Notes longues | Les dix instruments à maintien restent audibles dans trois registres après huit secondes | OK |
| LH02 | Notes longues | Le maintien conserve l’attaque originale et peut être désactivé sans prolonger le son | OK |
| LH03 | Notes longues | Une touche tenue joue au-delà de la durée du fichier et s’arrête quand elle est relâchée | OK |
| LH04 | Notes longues | Un ancien projet garde sa durée puis le maintien se règle, s’annule et voyage dans le fichier | OK |
| LH05 | Notes longues | Arrêter le transport coupe aussi les voix bouclées sans note bloquée | OK |
| LH06 | Notes longues | L’export WAV contient la note longue et une fin silencieuse sans saturation | OK |
| LH07 | Notes longues | Une touche du clavier du piano roll tenue à la souris joue tant qu’elle est enfoncée, puis s’arrête au relâchement | OK |
| LH08 | Notes longues | Au doigt : la touche tenue joue, la colonne des touches reste le moyen de défiler, et la note s’arrête même si le doigt est levé ailleurs | OK |
| LH09 | Notes longues | Une touche tenue pendant que l’écran se redessine ne reste pas bloquée ; un geste annulé coupe aussi la note | OK |
| LH10 | Notes longues | Accords à un doigt depuis le clavier du piano roll, à la souris : la touche tenue joue tout l’accord, le relâchement le coupe | OK |
| LH11 | Notes longues | Enregistrer en jouant sur le clavier du piano roll à la souris : la note tenue est écrite avec sa durée | OK |
| GE01 | Gestes réels | Clavier à l’écran : une touche tenue pendant un redessin (enregistrement, bouton MIDI) ne reste pas bloquée, arpégiateur compris | OK |
| GE02 | Gestes réels | Effet Live tenu à la souris puis au clavier pendant un redessin : l’effet s’arrête au relâchement et le bouton reste fidèle | OK |
| GE03 | Gestes réels | Espace sur un bouton atteint au clavier actionne ce bouton ; après un clic à la souris, Espace reste la lecture | OK |
| GE04 | Gestes réels | Pad au clavier avec répétition de notes : la répétition s’arrête au relâchement de la touche ; un autre doigt levé ne coupe pas un pad tenu | OK |
| GE05 | Gestes réels | La première touche d’un instrument pas encore chargé sonne dès la fin du chargement si elle est toujours tenue | OK |
| GE06 | Gestes réels | Au clavier seul : un curseur du mixeur garde le focus d’un cran à l’autre, et un bouton actionné reste sélectionné | OK |
| SB01 | Navigateur de sons | Les 53 sons, les familles et les commandes du navigateur sont nommés dans les trois langues | OK |
| SB02 | Navigateur de sons | Recherche sans accents, filtres combinés et favoris conservés après rechargement | OK |
| SB03 | Navigateur de sons | La préécoute et les favoris ne changent ni le projet ni le transport | OK |
| SB04 | Navigateur de sons | Fermer pendant le chargement empêche une préécoute tardive | OK |
| SB05 | Navigateur de sons | Choisir un instrument est annulable et conserve les sons personnels du sampler | OK |
| SB06 | Navigateur de sons | La recherche bloque les raccourcis musicaux et Échap rend le focus à la piste | OK |
| SB07 | Navigateur de sons | Sur téléphone et en paysage, les filtres et les boutons restent atteignables au doigt | OK |
| SB08 | Navigateur de sons | Des favoris invalides sont ignorés et le sampler vide explique comment être préécouté | OK |
| SB09 | Navigateur de sons | Une préécoute indisponible signale l’échec puis fonctionne après réessai | OK |
| SB10 | Navigateur de sons | Changer de projet pendant l’ouverture ne permet pas de modifier une ancienne piste | OK |
| NU01 | Nuances | Une note jouée doucement est plus sombre qu’une note jouée fort sur cinq instruments enregistrés | OK |
| NU02 | Nuances | Nuances à zéro : la force ne change que le volume, pas le timbre | OK |
| NU03 | Nuances | Un ancien projet garde exactement son son : nuances à zéro après ouverture | OK |
| NU04 | Nuances | Le réglage Nuances s’affiche pour un instrument enregistré, s’annule et voyage dans le fichier | OK |
| NU05 | Nuances | Le réglage est traduit dans les trois langues | OK |
| NU06 | Nuances | Le timbre s’ouvre progressivement avec la force et ne descend jamais sous le troisième harmonique | OK |
| NU07 | Nuances | Une touche jouée doucement au clavier MIDI sonne plus sombre en direct | OK |
| LP01 | Raccords de boucle | Les 237 boucles de maintien : ni clic ni saut de niveau au raccord, mesurés note par note | OK |
| LP02 | Raccords de boucle | Une note tenue dix secondes ne varie pas plus que l’enregistrement d’origine, sans pulsation à chaque tour | OK |
| RG01 | Registres | D’une note enregistrée à sa voisine, le volume perçu ne saute pas de plus de 2 dB, sur les 29 instruments | OK |
| RG02 | Registres | Aucune note ne sature après égalisation : la plus forte reste sous la pleine échelle | OK |
| RG03 | Registres | Une gamme jouée sur trois octaves au piano reste régulière à l’export | OK |
| EM01 | Empreinte sonore | La démo exportée par le bouton Exporter garde son empreinte : niveau, spectre, enveloppe, ni clic, ni coupure, ni saturation | OK |
| EM02 | Empreinte sonore | Notes tenues (cordes, orgue d’église, chœur, violoncelle, huit secondes chacune) : empreinte conservée, aucun trou pendant la tenue | OK |
| EM03-trap | Empreinte sonore | Le modèle « trap » exporté garde son empreinte | OK |
| EM03-house | Empreinte sonore | Le modèle « house » exporté garde son empreinte | OK |
| EM03-lofi | Empreinte sonore | Le modèle « lofi » exporté garde son empreinte | OK |
| EM04 | Empreinte sonore | L’empreinte repère vraiment les défauts : un clic, une coupure de 30 ms, une saturation et une piste devenue muette sont signalés | OK |
| EM05 | Empreinte sonore | Geste réel dans la durée : une touche du piano roll tenue huit secondes à la souris sonne sans trou ni chute, puis s’arrête | OK |
| SV01 | Sauvegarde | Plantage de l’onglet juste après une modification au clavier : le morceau revient tel quel, un message le dit et mène aux versions | OK |
| SV02 | Sauvegarde | Une fermeture normale (rechargement) n’affiche pas de message de récupération | OK |
| SV03 | Sauvegarde | Versions : revenir à un état antérieur depuis le menu Projet, l’état remplacé reste gardé et Ctrl+Z annule la restauration | OK |
| SV04 | Sauvegarde | Au clavier seul : ouvrir les versions, garder une version, en restaurer une avec Tab et Entrée | OK |
| SV05 | Sauvegarde | Les versions anciennes sont éclaircies : seules les plus récentes restent, sans laisser de données orphelines | OK |
| SV06 | Sauvegarde | Sauvegarde automatique illisible au démarrage : la dernière version lisible est rouverte, avec le message de récupération | OK |
| SV07 | Sauvegarde | Supprimer un projet de la bibliothèque supprime aussi ses versions | OK |
| SV08 | Sauvegarde | Versions et message de récupération traduits en anglais et en espagnol | OK |
| DF01 | Fichiers | Navigateur : pas de commandes de la version bureau ; bureau : « Enregistrer sous… » et la liste des fichiers récents apparaissent dans le menu Projet | OK |
| DF02 | Fichiers | Bureau : Cmd+S la première fois demande où enregistrer ; ensuite Cmd+S réécrit le même fichier sans rien demander, le titre suit | OK |
| DF03 | Fichiers | Bureau : Cmd+O ouvre un projet du disque ; rouvrir le même fichier ne crée pas de doublon dans la bibliothèque ; annuler ne change rien | OK |
| DF04 | Fichiers | Bureau : fichiers récents dans le menu, du plus récent au plus ancien ; un clic rouvre ; un fichier disparu est signalé et retiré | OK |
| DF05 | Fichiers | Bureau : un échec d’écriture (disque plein, dossier protégé) est expliqué, le projet reste dans l’application | OK |
| DF06 | Fichiers | Bureau, au clavier seul : ouvrir le menu Projet, atteindre un fichier récent avec Tab et l’ouvrir avec Entrée | OK |
| DF07 | Fichiers | Fichier ouvert depuis le Finder (double-clic sur un .khm) : le projet s’ouvre et le fichier est lié | OK |
| DF08 | Fichiers | Commandes de fichiers traduites en anglais et en espagnol | OK |
| GD01 | Gestes | Note glissée au doigt puis geste annulé par le système : la note revient, rien n’est enregistré, les mouvements suivants n’ont plus d’effet | OK |
| GD02 | Gestes | Deux doigts : un deuxième doigt qui bouge ou se lève ailleurs ne pilote ni ne termine le glissé de la note par le premier | OK |
| GD03 | Gestes | Poignée de durée et note en cours de création : un geste annulé ne change pas la durée et ne laisse pas de note | OK |
| GD04 | Gestes | Vélocité glissée puis geste annulé : les forces de frappe reviennent ; un deuxième doigt ne les change pas | OK |
| GD05 | Gestes | Boucle tracée dans la règle (Maj+glisser) puis geste annulé : la boucle reste comme avant | OK |
| GD06 | Gestes | Clip glissé vers une autre piste puis geste annulé : il revient à sa place et sur sa piste | OK |
| GD07 | Gestes | Point d’automation créé ou déplacé au doigt puis geste annulé : la courbe revient comme avant | OK |
| GD08 | Gestes | Séparation du panneau du bas : un deuxième doigt ne la déplace pas, un geste annulé la libère | OK |
| GD09 | Gestes | Souris relâchée hors de la fenêtre pendant le glissé d’une note : le glissé se termine, il est enregistré et s’annule, la souris ne traîne plus la note | OK |
| GD10 | Gestes | Sans incident, rien ne change : glisser une note et un clip à la souris déplace et s’annule comme avant | OK |
