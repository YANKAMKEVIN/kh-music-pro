# Rapport de QA — KH Music Pro

477 cas réussis sur 477.

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
| A03 | Arrangement | Supprimer une piste (sans question, annulable) | OK |
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
| R09 | Enregistrement | Enregistrer au-delà de la 48e mesure : la règle s'allonge pendant la prise, le clip arrive à la bonne place | OK |
| R10 | Enregistrement | Enregistrer des notes au-delà de la 48e mesure : la règle suit la tête de lecture | OK |
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
| RI01 | Vrais instruments | Les 32 instruments enregistrés se chargent et produisent un signal propre | OK |
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
| NAT02 | Moteur natif | Avec le module, moteur arrêté : réglage désactivé, activé au clic, désactivé au clavier ; le son change de chemin et le choix est retenu | OK |
| NAT03 | Moteur natif | Échec du moteur natif : message clair, le son reste au navigateur, la sortie choisie est gardée | OK |
| NAT04 | Moteur natif | Le choix est retenu : au lancement suivant, le moteur natif se rallume tout seul | OK |
| NAT05 | Moteur natif | Réglage et plugins du Mac en anglais et en espagnol | OK |
| NAT06 | Moteur natif | Horloge de Web Audio : sur une carte son externe, le navigateur se cale sur les haut-parleurs du Mac (pas sur la carte du natif) ; sinon sur la sortie du natif ; carte débranchée suivie | OK |
| NAT07 | Moteur natif | Activé par défaut sur Mac (décision du 21/11/2026) : allumé au lancement sans choix retenu, « Désactivé » est retenu, un échec au lancement rend la main au navigateur sans message d'erreur | OK |
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
| SB01 | Navigateur de sons | Les 56 sons, les familles et les commandes du navigateur sont nommés dans les trois langues | OK |
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
| EX01 | Banques expressives | Piano et kit Studio sélectionnables dans les trois langues, avec de vrais noms de pads | OK |
| EX02 | Banques expressives | Les quatre nuances du piano sont des enregistrements distincts et jouent doucement ou fort | OK |
| EX03 | Banques expressives | Le nouveau piano est juste dans plusieurs registres, transposition comprise, et s’arrête au relâchement | OK |
| EX04 | Banques expressives | Les 16 pads Studio produisent un son propre, avec nuances et variantes de répétition | OK |
| EX05 | Banques expressives | Les variantes restent reproductibles à l’export, indépendamment des pads joués avant | OK |
| EX06 | Banques expressives | Le charleston fermé coupe le charleston ouvert du même kit | OK |
| EX07 | Banques expressives | Un sample personnel importé remplace un pad Studio et voyage avec le projet | OK |
| EX08 | Banques expressives | Piano expressif et batterie Studio conservés dans le fichier, après rechargement, et audibles à l’export | OK |
| EX09 | Banques expressives | Un téléchargement incomplet reste indisponible, bloque l’export puis se recharge après réessai | OK |
| EX10 | Banques expressives | Un ancien projet garde le piano et le kit acoustique historiques | OK |
| VD01 | Banques expressives | Batterie à plusieurs nuances (Virtuosity Drums, décision du 21/11/2026) : le kit Studio se charge, une frappe douce et une frappe forte jouent des enregistrements différents | OK |
| MD01 | Pédale MIDI | La pédale tient le piano après la touche, et son relâchement arrête le son | OK |
| MD02 | Pédale MIDI | La pédale n’agit que sur son canal et une répétition réattaque sans note bloquée | OK |
| MD03 | Pédale MIDI | Les notes enregistrées avec pédale gardent leur durée jusqu’au lever de pédale | OK |
| MD04 | Pédale MIDI | Arrêt et perte de focus coupent le maintien, même pendant le premier chargement | OK |
| MD05 | Pads MIDI | L’enregistrement conserve les frappes douces et fortes, et le MIDI exporté les distingue | OK |
| BX01 | Nouvelles banques | Wurlitzer, basse et kit de percussions se choisissent dans les trois langues | OK |
| BX02 | Nouvelles banques | Le Wurlitzer couvre toutes les notes et nuances malgré ses zones irrégulières | OK |
| BX03 | Nouvelles banques | La basse dispose de cinq nuances et de deux prises alternées, et reste juste | OK |
| BX04 | Nouvelles banques | Les seize percussions sont audibles, sans silence dans les nuances hautes des pads à peu de couches | OK |
| BX05 | Nouvelles banques | Un son importé reste prioritaire sur un pad de percussions et sa réinitialisation rend le bon instrument | OK |
| BX06 | Nouvelles banques | Les trois choix survivent au fichier projet, au rechargement et à un rendu complet | OK |
| BX07 | Nouvelles banques | Les répétitions de basse et de percussions restent indépendantes des préécoutes | OK |
| BX08 | Nouvelles banques | Une banque de percussions incomplète est refusée puis se recharge après réessai | OK |
| BX09 | Nouvelles banques | Les percussions restent accessibles au doigt sur un écran de téléphone | OK |
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
| SV09 | Sauvegarde | Plantage reconnu en retard (le système libère l’onglet planté après le redémarrage) : le message arrive quand même et la version rouverte est marquée « récupérée » | OK |
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
| WP01 | Tempo | Clip audio qui suit le tempo : bouton activé à la souris, tempo tapé au clavier, le son s’étire sans changer de hauteur, à l’export comme à l’écoute | OK |
| WP02 | Tempo | Changement de tempo au milieu d’un clip qui suit le tempo : chaque coup tombe sur son temps, avant et après le changement | OK |
| WP03 | Tempo | Tempo d’origine saisi (boucle jouée à 60 BPM dans un morceau à 120) : le clip se raccourcit et se cale sur la grille | OK |
| WP04 | Tempo | Au tempo d’origine, suivre le tempo ne change rien au son : rendu identique échantillon par échantillon | OK |
| WP05 | Tempo | Scinder et rogner un clip qui suit le tempo : les coups restent sur les temps | OK |
| WP06 | Tempo | Au clavier : activer le suivi du tempo avec Entrée, l’annuler ; le réglage voyage dans le fichier projet | OK |
| WP07 | Tempo | Suivi du tempo traduit en anglais et en espagnol | OK |
| AX01 | Automation | Automatiser le réglage d’un effet : le choisir dans la liste, tracer la courbe à la souris ; l’export suit la courbe | OK |
| AX02 | Automation | À l’écoute : pendant la lecture, l’effet suit la courbe ; à l’arrêt, il revient à son réglage fixe | OK |
| AX03 | Automation | Retirer l’effet retire ses courbes ; Annuler ramène l’effet et ses courbes ; le tout voyage dans le fichier projet | OK |
| AX04 | Automation | Plugin du Mac : ses réglages apparaissent dans la liste ; automatisé, il reçoit les valeurs au fil de la lecture | OK |
| AX05 | Automation | Écho automatisé (dosage) à l’export : la traîne n’apparaît que là où la courbe monte | OK |
| AX06 | Automation | Liste des réglages traduite (anglais, espagnol) | OK |
| FZ01 | Gel de piste | Geler une piste d’un clic : son rendu en audio sur une nouvelle piste juste en dessous, l’originale coupée, le morceau sonne pareil | OK |
| FZ02 | Gel de piste | Dégeler : la piste audio disparaît, l’originale revient audible ; Ctrl+Z annule le gel comme le dégel | OK |
| FZ03 | Gel de piste | Une piste avec un effet et une automation de filtre se gèle avec son traitement : même son, mais un réglage de l’originale ne change plus rien | OK |
| FZ04 | Gel de piste | Au clavier : le bouton de gel s’atteint et s’actionne avec Entrée ; le gel voyage dans le fichier projet | OK |
| FZ05 | Gel de piste | Bouton de gel traduit (anglais, espagnol), absent des pistes audio | OK |
| FZ06 | Gel de piste | Le général (volume, égaliseur, filtre, largeur) ne s’applique qu’une fois à une piste gelée : même niveau qu’avant le gel | OK |
| PF01 | Performance | Gros projet (40 pistes, 120 effets) : mesures chiffrées de la charge, du redessin de l’écran et de l’export ; l’écran reste rapide et la lecture se mesure | OK |
| PF03 | Performance | Gros projet allégé par le gel : les 32 pistes d’instruments gelées d’un clic chacune, la charge chute, la lecture ne prend plus de retard | OK |
| PF02 | Performance | Indicateur de charge du mixeur : un clic mesure et affiche la charge, les pistes et les effets ; traduit en anglais et en espagnol | OK |
| AW01 | Plugins du Mac | Fenêtre du plugin : un clic l’ouvre ; un réglage changé dans la fenêtre est recopié dans le projet, affiché, annulable | OK |
| AW02 | Plugins du Mac | Pendant la lecture d’une automation de ce plugin, les valeurs de la courbe ne sont pas recopiées dans le projet | OK |
| AW03 | Plugins du Mac | Module natif plus ancien (sans fenêtre) : pas de bouton ; au clavier, le bouton s’atteint et s’active avec Entrée ; traduit | OK |
| TB01 | Barre du haut | Ordinateur : projet, jeu et sortie tiennent sur une seule ligne ; la barre d’arrangement est juste au-dessus des pistes | OK |
| TB02 | Barre du haut | Menus à la souris : un clic ouvre, un clic ailleurs ou un choix referme ; un seul menu ouvert à la fois | OK |
| TB03 | Barre du haut | Menus au clavier seul : Tab jusqu’à « Prise », Entrée ouvre, Espace règle le décompte, Échap referme et rend le focus | OK |
| TB04 | Barre du haut | Le bouton Boucle affiche sa plage et la suit quand on la change dans « Prise » ; les raccourcis ne changent pas | OK |
| TB05 | Barre du haut | Téléphone : barre sans débordement, transport et tempo visibles, tout le reste au doigt par ☰, Projet et Prise | OK |
| TB06 | Barre du haut | Écran moyen (1100 px) : la barre passe proprement sur deux lignes, rien n’est coupé ni caché | OK |
| TB07 | Barre du haut | Nouveaux menus et bulles traduits en anglais et en espagnol | OK |
| AD01 | Correctifs audit | Séquenceur au clavier : une seule case atteinte par Tab, les flèches, Début et Fin passent d’une case à l’autre, Entrée allume, le focus survit au redessin | OK |
| AD02 | Correctifs audit | Lettres des touches : celles du vrai clavier quand le navigateur les donne (QWERTY en français, AZERTY en anglais), sinon d’après la langue | OK |
| AD03 | Correctifs audit | Une prise jouée sur trois mesures reste un seul clip, annulé d’un coup ; une seconde prise fait un clip à elle | OK |
| AD04 | Correctifs audit | Tempo au centième : 93,5 BPM gardé (champ, changement de tempo, fichier MIDI) ; une saisie vide ou nulle garde le tempo | OK |
| AD05 | Correctifs audit | Sauvegarde impossible (espace plein, stockage bloqué) : bandeau qui reste, bouton « Enregistrer en fichier », message de retour ; traduit | OK |
| AD06 | Correctifs audit | Accordeur : une mesure abîmée (ordinateur chargé) n’est jamais affichée ; la note s’affiche juste une fois confirmée | OK |
| AD06b | Correctifs audit | Accordeur : la trame où la note commence est sautée ; une trame abîmée proche de la note ne décale pas l’affichage ; rouvert, il ne lisse pas depuis la note d’avant | OK |
| AD07 | Correctifs audit | Export d’un gros projet en parallèle (un rendu par groupe de pistes) : même son à l’échantillon près que le rendu d’un seul tenant, et plus rapide | OK |
| AD08 | Correctifs audit | Export parallèle : les kicks restent avec les pistes qu’ils font pomper ; rien n’est découpé avec un plugin du Mac, une piste en solo ou un petit projet | OK |
| TH01 | Têtes de piste | Ordinateur : les noms des pistes de la démo sont entiers ; seuls nom, ⋯, M, S, A et volume sont visibles | OK |
| TH02 | Têtes de piste | Menu ⋯ à la souris sur une piste non sélectionnée : il s’ouvre entier à côté du bouton, sélectionne la piste, un choix le referme | OK |
| TH03 | Têtes de piste | Menu ⋯ au clavier : Entrée ouvre, Tab parcourt les actions, Entrée agit, Échap referme et rend le focus | OK |
| TH04 | Têtes de piste | Faire défiler les pistes referme un menu ⋯ ouvert ; une piste gelée montre ❄ à côté de son nom | OK |
| TH07 | Têtes de piste | Le menu ⋯ reste ouvert quand l’écran se redessine (lecture, note jouée en prise) ; seuls un clic dehors, Échap ou un choix le referment | OK |
| TH05 | Têtes de piste | Téléphone : noms lisibles, ⋯ au doigt (monter, descendre, supprimer enfin possibles), menu dans l’écran | OK |
| TH06 | Têtes de piste | Menu ⋯ et repère ❄ traduits en anglais et en espagnol | OK |
| CT01 | Contrôles joués | Pitch bend MIDI joué en direct : la note tenue monte, descend et revient au centre | OK |
| CT02 | Contrôles joués | Export audio : le pitch bend du clip change la hauteur rendue (la 440 → si 494, puis ± 12) | OK |
| CT03 | Contrôles joués | Export audio : la molette ajoute du vibrato, l’aftertouch gonfle le son ; sans contrôle, rien ne bouge | OK |
| CT04 | Contrôles joués | Enregistrement : note, montée du bend, molette et pression du DGX simulé sont gardés dans le clip, puis à l’export | OK |
| CT05 | Contrôles joués | Molettes à l’écran à la souris : le bend revient au centre au relâchement, la modulation reste ; au clavier aussi | OK |
| CT06 | Contrôles joués | Molette à l’écran au doigt pendant un enregistrement : le geste survit aux redessins et s’écrit dans le clip | OK |
| CT07 | Contrôles joués | Ligne des contrôles : dessiner un bend à la souris, changer de contrôle, effacer, annuler | OK |
| CT08 | Contrôles joués | Fichier MIDI : bend, molette et pression exportés puis relus ; projet sauvegardé et rouvert | OK |
| CT09 | Contrôles joués | Copier, dupliquer et scinder un clip : les contrôles suivent sans être partagés | OK |
| CT10 | Contrôles joués | Gros projet exporté en parallèle : le bend est rendu pareil qu’en un seul tenant ; l’arrêt remet tout au repos | OK |
| CT11 | Contrôles joués | Molette assignée à un réglage du mixeur : elle garde son assignation ; textes traduits | OK |
| CT12 | Contrôles joués | Téléphone : molettes couchées au-dessus du clavier (touches assez larges), bend au doigt qui revient au centre | OK |
| XP01 | Export | Options d’export à la souris : WAV 24 bits à 48 kHz, tout le morceau ; le réglage est gardé dans le projet | OK |
| XP02 | Export | Exporter seulement la boucle, sans queue : durée exacte de la boucle, nom de fichier avec les mesures | OK |
| XP03 | Export | Exporter des mesures X à Y au clavier, avec la queue de son ; une borne inversée est corrigée | OK |
| XP04 | Export | Le début d’un extrait sonne comme ce passage dans le morceau (notes tenues comprises), et l’extrait s’arrête à sa fin | OK |
| XP05 | Export | WAV 24 bits : chaque échantillon garde 256 fois plus de précision qu’en 16 bits | OK |
| XP06 | Export | À 48 kHz, la hauteur et le tempo ne changent pas ; l’export parallèle d’un gros projet suit la plage | OK |
| XP07 | Export | Pistes séparées et MP3 suivent la plage et la fréquence ; le MIDI exporte toujours tout | OK |
| XP08 | Export | Options d’export traduites, lisibles au clavier ; Échap referme sans exporter | OK |
| CP01 | Comping | Glisser sur la prise 2 garde la prise 2 sur les temps 2 et 3, la prise 1 ailleurs ; l’export suit | OK |
| CP02 | Comping | Au clavier : flèches puis Entrée choisissent la prise 3 sur le dernier temps ; ↑ ↓ changent de prise | OK |
| CP03 | Comping | Aucun clic aux jonctions entre prises (fondu enchaîné très court) | OK |
| CP04 | Comping | Prise entière, annulation, scission et rognage à gauche gardent les portions à leur place | OK |
| CP05 | Comping | Le comping est gardé au rechargement de la page | OK |
| CF01 | Fondus enchaînés | Réglé au curseur sur le second clip : le premier continue en s’effaçant pendant que le second monte | OK |
| CF02 | Fondus enchaînés | Fondu à puissance constante : pas de creux de volume à la jonction | OK |
| CF03 | Fondus enchaînés | Le réglage n’apparaît que pour deux clips qui se touchent ; le X se dessine ; textes traduits ; annulable | OK |
| CF04 | Fondus enchaînés | Export parallèle d’un gros projet, scission et rechargement gardent le fondu enchaîné | OK |
| SC01 | Sidechain | Un kick audio importé fait pomper la basse : choix de la source et du réglage dans le mixeur | OK |
| SC02 | Sidechain | Une voix fait baisser la musique tant qu’elle chante, et la musique remonte après ; réglage à 50 % | OK |
| SC03 | Sidechain | Le kick du séquenceur reste la source par défaut ; une piste qui suit une autre source ne pompe plus sur lui | OK |
| SC04 | Sidechain | À l’écoute : le suiveur se branche en direct ; gel de la source : la piste suit sa version audio | OK |
| SD01 | Envois | Ajouter un envoi au clic crée un bus ; post suit le fader, pré ne le suit pas | OK |
| SD02 | Envois | Deux envois vers deux bus traités différemment ; supprimer un bus retire ses envois, l’annulation les rend | OK |
| SD03 | Envois | Gros projet : export parallèle identique à l’export d’un seul tenant avec envois et sidechain | OK |
| SD04 | Envois | Envois et source du sidechain traduits, gardés au rechargement | OK |
| QZ01 | Quantification | Force 50 % à la souris : chaque note fait la moitié du chemin vers la grille ; la durée est gardée | OK |
| QZ02 | Quantification | Swing 66 % : une double-croche sur deux est retardée d’un tiers de pas, et l’export le fait entendre | OK |
| QZ03 | Quantification | Humaniser : petits décalages (± 0,12 pas) et forces (± 12 %) au hasard, annulables ; sur la sélection seulement | OK |
| QZ04 | Quantification | Légato : chaque note va jusqu’à la suivante, un accord garde une seule fin, la dernière va jusqu’au bout du clip | OK |
| QZ05 | Quantification | Menu au clavier (Tab, Entrée, flèches), réglages gardés pendant la séance, textes traduits | OK |
| AI01 | Instruments du Mac | Choisir un instrument du Mac dans la liste : la piste le joue, ses réglages sont dans sa fenêtre | OK |
| AI02 | Instruments du Mac | Jeu au clavier MIDI : note, relâchement, pitch bend, molette et pédale partent vers le plugin | OK |
| AI03 | Instruments du Mac | Lecture d’un clip : chaque note part à son instant et se relâche à sa fin ; l’arrêt coupe tout | OK |
| AI04 | Instruments du Mac | L’état réglé dans la fenêtre est gardé dans le projet, rechargé dans le plugin, et l’export reste d’un seul tenant | OK |
| AI05 | Instruments du Mac | Version web : pas de liste, piste muette annoncée, export possible ; textes traduits | OK |
| UX01a | Export | Pendant un export, le bouton Exporter devient une barre qui avance, puis revient ; le fichier arrive | OK |
| UX01b | Export | Annuler un export : aucun fichier, message clair, et l’export suivant marche | OK |
| UX01c | Export | Pistes séparées : « piste i sur n » dans la barre ; part faite calculée juste ; annulation au clavier ; trois langues | OK |
| UX02a | Arrangement | Ctrl + molette zoome autour du pointeur : la mesure visée ne bouge pas ; les boutons − et + restent | OK |
| UX02b | Arrangement | Maj + molette fait défiler dans le temps ; la molette seule ne zoome pas | OK |
| UX02c | Piano roll | Ctrl + molette zoome le piano roll autour du pointeur ; les notes restent éditables | OK |
| UX02d | Téléphone | Pincer à deux doigts zoome l’arrangement ; un clip touché en premier ne se déplace pas | OK |
| UX03a | Arrangement | Clic droit sur un clip : menu avec Renommer, Dupliquer, Scinder ici, Boucler, Copier, Supprimer et leurs raccourcis | OK |
| UX03b | Arrangement | Menu du clip : scinder à l’endroit visé, boucler, copier puis coller, renommer, supprimer | OK |
| UX03c | Accessibilité | Menu du clip au clavier : Maj+F10 l’ouvre, les flèches le parcourent, Entrée choisit ; Suppr n’agit pas derrière le menu | OK |
| UX03d | Téléphone | Appui long au doigt sur un clip : le menu s’ouvre, le clip ne bouge pas, Supprimer et Dupliquer marchent au doigt | OK |
| UX04a | Enregistrement | Décompte visible : 4 · 3 · 2 · 1 en grand à la place du compteur, puis la position revient ; la barre ne change pas de hauteur | OK |
| UX04b | Transport | Témoin du temps : il bat à chaque temps, plus fort sur le premier ; éteint à l’arrêt ; fixe si le système demande moins d’animations | OK |
| UX05a | Mixeur | Tranche en quatre sections (Égaliseur, Effets, Envois, Dynamique) ; le panoramique est au-dessus du fader et règle la piste | OK |
| UX05b | Mixeur | Replier une section la replie sur toutes les tranches ; l’état est gardé après un redessin et dans l’appareil ; les réglages repliés marchent toujours | OK |
| UX05c | Mixeur | Un point signale les sections qui contiennent un réglage actif, même repliées ; titres traduits | OK |
| UX06a | Mixeur | Double-clic sur un curseur : retour à sa valeur d’origine, annulable ; un repère la marque ; le fader revient à 80 % | OK |
| UX06b | Mixeur | Suppr sur un curseur le remet à l’origine sans supprimer le clip sélectionné ; Maj + glissé règle finement | OK |
| UX06c | Interface | Retour à l’origine dans l’arrangement, le Live et les effets ; les curseurs sans valeur neutre ne changent pas | OK |
| UX07a | Interface | Supprimer une piste : plus de question, la piste part et le message propose Annuler | OK |
| UX07b | Interface | Fenêtres maison : la valeur est sélectionnée, Entrée valide, Échap annule ; renommer le projet et un repère ; trois langues | OK |
| UX08a | Arrangement | Chaque tête de piste montre le niveau de sa piste pendant la lecture, comme le vumètre du mixeur | OK |
| UX08b | Mixeur | Crête retenue une seconde ; le témoin de saturation reste allumé jusqu’au clic, dans la tête de piste comme dans le mixeur | OK |
| UX09a | Live | La case qui joue se remplit au fil de sa boucle, puis repart de zéro | OK |
| UX09b | Live | La case en attente compte les temps avant son départ (3 · 2 · 1), puis joue | OK |
| UX09c | Live | La scène en cours est marquée, la scène attendue clignote ; rien n’est marqué à l’arrêt | OK |
| UX10a | Accueil | Première visite : un accueil court (question, cinq modèles, visite guidée, Commencer) à la place de la notice ; « ? » ouvre toujours l’aide | OK |
| UX10b | Accueil | Choisir un modèle à l’accueil : il remplace le morceau d’exemple (un seul projet dans la bibliothèque) et joue | OK |
| UX10c | Accueil | Accueil : la visite guidée démarre ; Échap referme ; téléphone et trois langues | OK |
| UX11a | Projets | Chaque projet de la bibliothèque montre son tempo, ses pistes, sa durée et une miniature de l’arrangement | OK |
| UX11b | Projets | Renommer un projet depuis la liste, ouvert ou non ; le nom est gardé | OK |
| UX11c | Projets | Au-delà de huit projets, un champ de recherche filtre la liste par nom (sans tenir compte des accents) | OK |
| UX12a | Enregistrement | Pendant une prise : tête de lecture et règle rouges, liseré sur la piste enregistrée, voile sur la zone déjà captée ; tout s’efface à l’arrêt | OK |
| UX12b | Enregistrement | Prise micro : la piste audio sélectionnée est marquée ; rien n’est voilé pendant le décompte | OK |
| UX13a | Interface | Icônes dessinées : les types de piste ont le même dessin partout (têtes, mixeur, Live, éditeur), à la couleur de la piste, sans emoji | OK |
| UX13b | Interface | Icônes dessinées (suite) : pads, quantification, entrée audio, réglages, modèles et réglages audio sans emoji, noms accessibles gardés | OK |
| UX14a | Démarrage | Écran d’attente : le logo est dans la page avant le script, puis disparaît ; icônes PNG 192 et 512, version maskable et icône iPhone | OK |
| UX15a | Interface | Fenêtres et menus s’ouvrent en 140 ms (fondu, léger agrandissement, voile qui s’installe) ; rien ne bouge si le système demande moins d’animations | OK |
| PH01 | Téléphone | Rétablir est visible au doigt sur téléphone : annuler puis rétablir une case du séquenceur | OK |
| PH02 | Téléphone | Le morceau s’ouvre sur téléphone avec au moins quatre mesures visibles | OK |
| PH03 | Téléphone | Séquenceur sur téléphone : 8 pas entiers à la fois, cases hautes de 44 px, glisser passe aux 8 suivants, toucher allume | OK |
| PH04 | Téléphone | Au doigt, tout ce qu’on touche fait au moins 44 px (barre, arrangement, pistes, éditeur, onglets, menus) et rien ne déborde | OK |
| AZ01 | Automation | Filtre de l’instrument automatisé : choisi dans le groupe Instrument, tracé à la souris ; les notes s’ouvrent au fil de la courbe à l’export | OK |
| AZ02 | Automation | Une note garde le filtre de son départ ; à l’arrêt, une note jouée à la main reprend le réglage fixe | OK |
| AZ03 | Automation | Aigus de l’égaliseur automatisés de −15 à +15 dB : export plus brillant à la fin ; à l’arrêt, l’égaliseur revient à son réglage | OK |
| AZ04 | Automation | Seuil du compresseur automatisé ; la courbe voyage dans le fichier projet ; batterie sans groupe Instrument ; textes traduits | OK |
| CF05 | Fondus enchaînés | Clips qui suivent le tempo (joués plus vite que leur tempo d’origine) : le premier continue en s’effaçant pendant le fondu enchaîné | OK |
| SG02 | Signature | Passer en 6/8 à la souris : mesure de 12 pas en deux temps d’une noire pointée (règle, lignes de temps, compteur, séquenceur) | OK |
| SG03 | Signature | Métronome en 6/8 : deux clics par mesure, le premier accentué ; décompte de deux clics ; en 3/4, trois clics de décompte | OK |
| SG04 | Signature | 12/8, 9/8, 7/8 et 5/8 : longueur de mesure, temps, boucle d’une mesure à l’écoute | OK |
| SG05 | Signature | 6/8 dans le fichier MIDI exporté, dans le fichier projet ; un ancien projet s’ouvre en x/4 | OK |
| SG06 | Signature | Import MIDI : un projet vide prend la signature du fichier (6/8, 12/8, 7/4) ; un projet déjà commencé garde la sienne ; signature inconnue ignorée | OK |
| AZ05 | Automation | Fréquence du médium et taux du compresseur automatisés dans la tranche fixe : à l’écoute, à l’export, à l’arrêt ; conversion en chaîne et retour sans perte | OK |
| LR01 | Live | Enregistrer un clip à la volée : ● sur une piste, la prise part à la mesure, les notes jouées s’y rangent, puis le clip tourne en boucle | OK |
| LR02 | Live | Batterie : les pads joués pendant la prise remplissent le motif ; le clip enregistré sonne en boucle et apparaît dans l’arrangement | OK |
| LR03 | Live | Un second appui abandonne la prise (rien n’est gardé, la musique continue) ; Arrêter pendant une prise garde ce qui a été joué | OK |
| LR04 | Live | Au clavier : ● se déclenche avec Entrée ; une piste audio n’a pas de bouton ; longueur gardée dans le fichier ; textes traduits | OK |
| LR05 | Live | Arpégiateur et répétition de notes pendant une prise à la volée : les notes égrenées et les coups répétés sont rangés dans le clip | OK |
| LR06 | Live | Pitch bend et molette joués pendant une prise à la volée : la courbe est gardée dans le clip, retour au centre compris | OK |
| CE01 | Chaînes d'effets | Migration : un ancien projet s’ouvre en tranche fixe ; « Tout le projet » convertit pistes et bus en chaînes, et le rendu reste identique à l’échantillon près (piste par piste, courbes comprises) | OK |
| CE02 | Chaînes d'effets | Migration sans perte : courbes renommées vers les effets, Annuler revient à la tranche fixe, le fichier garde la chaîne ; retour à la tranche fixe identique, refusé si l’ordre a changé | OK |
| CE03 | Chaînes d'effets | Interface : ajouter un étage de tranche depuis le menu (un de chaque, rangé dans l’ordre du son, hors limite de huit), le retirer, réordonner à la souris et au clavier | OK |
| CE04 | Chaînes d'effets | Mixeur d’une tranche en chaîne : les curseurs pilotent les effets de la chaîne, un étage absent n’a pas de curseur, le préréglage crée ce qui manque, la réduction du compresseur s’affiche | OK |
| CE05 | Chaînes d'effets | Assignation MIDI : un bouton assigné au filtre pilote le filtre de la chaîne ; un étage absent ne bouge pas ; la tranche fixe ne bouge pas | OK |
| CE06 | Chaînes d'effets | Automation : le filtre de la chaîne se choisit dans le groupe de l’effet et se trace à la souris ; export plus brillant au fil de la courbe ; à l’écoute la courbe pilote le filtre, puis l’arrêt rend le réglage | OK |
| CE07 | Chaînes d'effets | Automation de réglages qui ne l’étaient pas dans la tranche fixe : profondeur du trémolo (de rien à fond) et fréquence du médium ; saturation et lo-fi non proposés | OK |
| CE08 | Chaînes d'effets | Export identique à la lecture : à l’écoute, le filtre de la chaîne prend à chaque instant la valeur de la courbe que suit l’export ; export parallèle d’un gros projet en chaînes = rendu d’un seul tenant | OK |
| CE09 | Chaînes d'effets | Gel d’une piste en chaîne d’effets : le son gelé est exactement celui de la même piste gelée en tranche fixe (chaîne et courbes comprises) ; dégeler rend la chaîne | OK |
| CE10 | Chaînes d'effets | Textes traduits (fenêtre des effets, mixeur, noms des étages) ; au clavier, la conversion s’atteint et s’actionne avec Entrée | OK |
