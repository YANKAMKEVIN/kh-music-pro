# Jouer et enregistrer avec le Yamaha DGX-670

Guide préparé pour KH Music Pro 0.17.0. Aucun branchement, pilote, réglage du
Yamaha ou réglage de la Focusrite n’a été modifié pendant le développement.
Le modèle et la génération exacts de la Focusrite restent à identifier.

## Jouer les instruments de KH Music Pro

Le chemin est : **Yamaha → notes MIDI par USB → instrument de KH Music Pro →
sortie Focusrite → casque ou enceintes**.

1. Relier la prise **USB TO HOST** du DGX-670 au Mac avec un câble de données
   compatible. Cette prise transmet le MIDI et l’audio ; ne pas la confondre
   avec USB TO DEVICE, destinée aux périphériques USB. Yamaha recommande une
   connexion directe à l’ordinateur. [Manuel Yamaha, pages 92–93](https://data.yamaha.com/files/download/other_assets/1/1345721/DGX-670_owners_manual_En_D0.pdf)
2. Brancher la Focusrite au Mac et le casque sur la Focusrite.
3. Dans KH Music Pro, ouvrir **Réglages audio**, choisir la Focusrite en sortie.
4. Appuyer sur **MIDI** et autoriser la connexion si le système le demande.
5. Sélectionner une piste Instrument, puis **Parcourir les sons** et chercher
   **Salamander**. Choisir **Piano à queue expressif · Salamander**.
6. Attendre le message de fin de chargement avant de jouer. Faire quatre notes
   de plus en plus fortes : le logiciel doit choisir des prises différentes.
7. Essayer la pédale : tenir une note à la pédale, lever le doigt, puis la
   pédale. KH prend en charge CC64 en marche/arrêt, sans demi-pédale.

Si le piano Yamaha et le piano du logiciel se superposent, le réglage **Local
Control** du Yamaha permet de déconnecter le clavier de son générateur sonore
interne tout en pilotant un instrument externe. Le remettre sur On pour
retrouver son fonctionnement autonome. [Manuel de référence Yamaha, page 80](https://data.yamaha.com/files/download/other_assets/0/1345700/DGX-670_reference_manual_En_B0.pdf)

Pour enregistrer une partie modifiable, sélectionner la piste Instrument,
appuyer sur ●, jouer, puis arrêter. Les notes, leurs nuances et leur durée
avec pédale restent éditables. On peut ensuite choisir un autre son sans
rejouer la partie. Changer le timbre ne transforme pas une prise audio en MIDI.

## Jouer les pads et la batterie

Sur une piste Batterie, choisir **Acoustique expressive · Studio** dans Kit,
puis ouvrir **Pads**. Les 16 cases ont déjà leurs sons : aucun téléchargement
manuel ni plugin à installer. Les nuances enregistrées s’entendent avec un
contrôleur MIDI sensible à la force et dans les cases douces du séquenceur.
La souris et le clavier d’ordinateur déclenchent une force fixe.

Le bouton dossier d’un pad permet d’importer son propre son. Le bouton de
réinitialisation rend le son du kit. Les samples personnels voyagent dans le
fichier `.khm`. Les sons du pack Studio restent fournis avec l’application.

## Enregistrer le son propre du Yamaha

Le DGX-670 peut transmettre son son en audio par USB TO HOST. Sur une piste
Audio, choisir son entrée USB si elle est proposée. Pour enregistrer seulement
le Yamaha et éviter de réenregistrer le retour de l’ordinateur, le manuel décrit
le réglage **Audio Loopback Off**. [Manuel Yamaha, page 93](https://data.yamaha.com/files/download/other_assets/1/1345721/DGX-670_owners_manual_En_D0.pdf)

Cette prise capture le timbre du Yamaha. Elle peut être découpée, mixée et
traitée par des effets. Enregistrer les notes MIDI reste le meilleur choix si
l’on veut remplacer ensuite l’instrument par un autre son du logiciel.

## Enregistrer le micro par la Focusrite

Brancher le micro sur la Focusrite selon sa notice. Dans une piste Audio,
choisir la Focusrite comme entrée, surveiller le vumètre, régler le niveau sans
saturation puis enregistrer. Le branchement du micro, l’alimentation éventuelle
et la sélection des canaux sont à confirmer avec les modèles exacts.

Pour entendre le micro pendant la prise, choisir une seule écoute : celle de
KH Music Pro, ou le **Direct Monitor** de la Focusrite. Le Direct Monitor
renvoie l’entrée directement vers le casque avec très peu de retard, tout en
permettant son enregistrement dans le logiciel. Couper l’écoute d’entrée dans
KH si le Direct Monitor est utilisé, pour éviter le doublage. Ce réglage
n’accélère pas les instruments virtuels, dont le son est créé dans
l’ordinateur. [Explication Focusrite](https://support.focusrite.com/hc/en-gb/articles/207546305-What-is-direct-monitoring)

## Ce qui reste à écouter sur ton matériel

- Le toucher et l’équilibre doux/fort du piano ; les passages entre nuances.
- Le fonctionnement réel de la pédale et le confort de jeu au casque.
- Le délai entre une touche du Yamaha et le son entendu par la Focusrite.
- Le niveau, les canaux et la qualité d’une prise de micro.

Le logiciel a des tests audio et MIDI simulés ; ces essais matériels restent
nécessaires. Les sauvegardes importantes se font aussi par un fichier `.khm`.
