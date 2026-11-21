# Correctifs de l'audit de novembre 2026 (branche `v18-correctifs`)

Suite à `docs/audit-2026-11.md` et à la demande de Kevin du 18/11/2026 : « fixe tous les soucis rencontrés ».
Branche partie de `v18` à `bf29829`. Les défauts du téléphone et des têtes de piste (D1 à D4) sont dans les fichiers que la session V18 modifie en ce moment (`arr.ts`, `top.ts`, `style.css`) : ils lui ont été confiés pour éviter les conflits.

## Ce qui est corrigé

| # | Défaut | Correction | Cas de QA |
|---|---|---|---|
| D5 | Séquenceur pénible au clavier (256 arrêts de Tab, flèches inactives) | Une seule case atteinte par Tab (la dernière visitée). Les flèches, Début et Fin passent d'une case à l'autre, Entrée ou Espace allume. La grille a un nom pour les lecteurs d'écran. | AD01 |
| D6 | Une prise sur plusieurs mesures donnait un clip par mesure | Le clip de la prise en cours s'allonge jusqu'à la mesure jouée, tant qu'aucun autre clip n'est entre les deux. Une nouvelle prise fait un nouveau clip. | AD03 |
| D7 | Tempo en nombre entier, et 0 remettait 120 | Tempo au centième (93,5) dans le champ BPM, les changements de tempo et l'import MIDI ; la virgule est acceptée. Une saisie vide ou nulle garde le tempo actuel. | AD04 |
| D8 | Sauvegarde muette quand l'appareil est plein | Un bandeau reste affiché tant que la sauvegarde échoue : « espace plein » ou « stockage bloqué », avec un bouton « Enregistrer en fichier » (44 px). Un message annonce le retour à la normale. Une écriture abandonnée faute de place ne bloque plus la sauvegarde pour toujours (la promesse ne se terminait jamais). Textes en trois langues. | AD05 |
| D9 | Lettres du clavier devinées d'après la langue | Les lettres viennent de la vraie disposition du clavier quand le navigateur la donne (Chrome, Edge, version bureau). Sinon, l'ancienne règle s'applique (AZERTY en français). | AD02 |
| D10 | Accordeur faux de +12 cents quand l'ordinateur est chargé | Une note ne s'affiche qu'une fois confirmée par 3 mesures concordantes sur les 5 dernières. Une trame abîmée n'est jamais montrée. | AD06 (et TU02) |
| D11 | Export lent sur un gros projet | À partir de 12 pistes, l'export rend les pistes par groupes (jusqu'à 4), en même temps sur plusieurs cœurs, puis passe la somme une fois dans la chaîne du général. Restent ensemble un bus et ses pistes, ainsi que les kicks et les pistes qu'ils font pomper. Pas de découpage avec un plugin du Mac ou une piste en solo. | AD07, AD08 |

### Mesures de l'export parallèle

- **Projet de test** de 16 pistes (AD07) : même son qu'avant, avec un écart maximal de 2,4 × 10⁻⁷, cent fois plus petit qu'un pas d'un fichier WAV 16 bits (l'export). Temps : 1,5 s avant, 0,7 s après.
- **Gros projet** (40 pistes, 120 effets), sur un Mac très chargé (charge moyenne de 37 pendant la mesure) : 355 s avant, 99 s après, avec 4 groupes sur 8 cœurs. Le niveau est le même à 0,4 % près ; la petite différence vient des réverbs et des bruits, qui sont tirés au hasard à chaque rendu.
- **Petits projets** (moins de 12 pistes, dont la démo et les modèles) : rien ne change, l'export se fait comme avant. Les empreintes sonores (EM) ne sont donc pas touchées.

## Non vérifié

- **L'écoute** d'un export parallèle comparé à un export d'un seul tenant. La mesure dit « identique » sans réverb ; avec réverb, la queue tirée au hasard diffère d'un export à l'autre, comme avant.
- **La vraie disposition du clavier** sur le Mac de Kevin : elle est testée avec une disposition simulée. Safari et Firefox ne donnent pas la disposition et gardent l'ancienne règle.
- **Un vrai disque plein** : la panne est simulée dans le navigateur.
- **D1 à D4** : confiés à la session V18.

## À faire à la fusion dans `v18`

- Ajouter une ligne au README et une section à la passation : laissé de côté ici pour ne pas entrer en conflit avec les fichiers non enregistrés de la session V18.
- Les cas AD01 à AD08 sont en fin de `qa/run.cjs`, juste avant le lancement de la campagne.
