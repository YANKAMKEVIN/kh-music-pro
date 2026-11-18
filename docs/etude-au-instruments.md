# Étude : plugins instruments Audio Unit sur le Mac (V19, chantier 6)

Rédigée le 18/11/2026 pour décision de Kevin. **Aucun code n'a été écrit pour ce chantier** : la règle est de soumettre l'étude avant de toucher au module natif (`native/kh-au-bridge`).

## Ce que tu gagnerais

Jouer dans KH Music Pro les instruments que tu installerais sur ton Mac (Serum, Arturia, Kontakt, Pianoteq, Keyscape…), comme on le fait aujourd'hui avec les **effets** Audio Unit :
- jouer au DGX-670, enregistrer, éditer les notes dans le piano roll ;
- le pitch bend, la molette et l'aftertouch de la V19 seraient transmis tels quels au plugin ;
- la fenêtre du plugin s'ouvrirait comme celle des effets ;
- l'export audio inclurait l'instrument (même chemin que l'écoute).

## Ce qui existe déjà et servira

| Pièce | Où | Réutilisable pour les instruments |
|---|---|---|
| Plugin dans un fil natif temps réel, échange par mémoire partagée, aucun retard ajouté | `bridge.mm` (397 lignes), `au.ts` | Oui, tel quel |
| Liste des plugins installés | `bridge.mm` `List` | Oui (filtre `aumu` au lieu de `aufx`) |
| Réglages, préréglages d'usine, fenêtre graphique | `bridge.mm`, `rack.ts` | Oui |
| Plugin recréé pour chaque export, libéré ensuite | `graph.ts` (`loadWams`, `disposePlugins`) | Oui |
| Compensation de latence | `graph.ts` (`compensate`) | Oui |

Ton Mac n'a aujourd'hui que les trois instruments d'Apple (relevé du 18/11/2026, `auval -s aumu`) : **DLSMusicDevice** (General MIDI), **AUMIDISynth** et **AUSampler**. Ils suffisent pour construire et tester ; un plugin tiers gratuit (par exemple Surge XT ou Vital) serait à installer avec ton accord pour valider un cas réel.

## Ce qu'il faut construire

1. **Module natif** (environ 250 lignes d'Objective-C++, dans `bridge.mm`) :
   - ouvrir un plugin de type instrument (`aumu`) : il n'a pas d'entrée audio, seulement une sortie ;
   - recevoir les notes et contrôles (note, relâchement, pitch bend, molette, aftertouch, pédale) dans une **file sans verrou** de la mémoire partagée, avec leur position à l'échantillon près dans le bloc, et les donner au plugin juste avant chaque calcul (`MusicDeviceMIDIEvent`) ;
   - **sauvegarder et recharger l'état complet** du plugin (`kAudioUnitProperty_ClassInfo`) : indispensable pour Serum ou Kontakt, dont le son ne tient pas dans une simple liste de réglages. Il serait gardé dans le projet `.khm`.
2. **Côté application** (environ 300 lignes de TypeScript) :
   - un nouveau moteur d'instrument « plugin du Mac » dans le choix des sons ;
   - le séquenceur, le jeu en direct et les contrôles joués envoient des messages au plugin au lieu de créer des voix Web Audio ;
   - l'export crée une seconde instance du plugin, lui donne le même état, et lui envoie les notes calées sur le rendu hors-ligne.
3. **QA** (environ 12 cas) : le module natif simulé de `qa/run.cjs` est étendu (notes reçues, état sauvegardé, export) ; un essai réel avec DLSMusicDevice sur ton Mac (`qa/au-bridge.cjs`).

## Estimation

| Étape | Durée estimée (sessions de travail) |
|---|---|
| Module natif : instrument, file d'évènements, état complet | 1 à 1,5 |
| Application : moteur « plugin », jeu, enregistrement, contrôles | 1 |
| Export avec instrument, état gardé dans le projet | 0,5 à 1 |
| QA simulée + essai réel sur le Mac avec les instruments d'Apple | 0,5 |
| **Total** | **3 à 4 sessions** |

## Risques, du plus probable au moins probable

1. **Plugins lourds à l'export** (Kontakt, grandes bibliothèques) : l'export crée une seconde instance, qui recharge ses sons (plusieurs secondes, plusieurs Go de mémoire). Parade possible : enregistrer la piste en audio (gel) avant l'export, comme dans les autres logiciels.
2. **Fenêtres d'autorisation** de certains plugins (iLok, activation) qui s'ouvrent au premier chargement : elles bloquent tant qu'on n'y répond pas.
3. **Plugins qui refusent le rendu plus rapide que le temps réel** (rare, certains instruments « en ligne ») : l'export resterait possible en temps réel seulement.
4. **Plugins AUv3 seulement** (rares sur Mac pour ces marques) : le module actuel ouvre les AUv2 ; un AUv3 pur demanderait l'ouverture asynchrone d'Apple (environ une demi-session de plus).
5. **Export parallèle des gros projets** : comme pour les effets du Mac, un projet avec un instrument plugin serait rendu d'un seul tenant (déjà le cas, pas de régression).

## Ce qui ne changerait pas

- La version web n'a pas de plugins du Mac ; un projet qui en contient y joue la piste en silence et le dit (comme les effets aujourd'hui).
- Windows et VST3 restent hors du chantier.

## Décision demandée

- **Oui, on y va** : je commence par le module natif avec DLSMusicDevice, puis je m'arrête pour te faire essayer sur le Mac avant l'export.
- **Pas maintenant** : les banques intégrées (Salamander, Wurlitzer, Fashionbass…) restent la seule source d'instruments.
- **Installer d'abord un instrument gratuit** (Surge XT ou Vital) pour valider un cas réel : il faut ton accord pour le télécharger et l'installer.
