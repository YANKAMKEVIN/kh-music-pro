# V20 — Du son à la séquence

But : charger un son (MP3, WAV… ; pour un usage personnel) et en tirer de quoi refaire le morceau dans KH Music Pro : chant → notes, tempo et tonalité, pistes séparées, basse et piano → notes, batterie → motif, familles d'instruments.

Pas de téléchargement depuis YouTube dans l'application (conditions d'utilisation de YouTube) : l'utilisateur apporte un fichier audio.

## Socle (branche `v20`, fait)

- `src/analysis/types.ts` : le contrat. `Analyzer` (une analyse), `Ctx` (son chargé + résultats), `Result` (tempo, tonalité, pistes séparées, parties, instruments), `Part` / `FoundNote` (notes en secondes).
- `src/analysis/registry.ts` : `registerAnalyzer()`. Chaque analyse s'inscrit depuis son propre fichier.
- `src/analysis/index.ts` : **une ligne d'import par analyse** (seul point partagé).
- `src/analysis/build.ts` : `toNotes()` et `addPartAsTrack()` (partie → piste d'instrument calée sur le tempo).
- `src/ui/analyze.ts` : fenêtre « Du son à la séquence… » (menu Projet, bouton `#bAnalyze`) : choix du fichier, une ligne par analyse (Lancer, avancement, Annuler, résumé `view()`), liste des parties avec « Ajouter au morceau ».
- `addTexts()` dans `src/i18n.ts` : chaque analyse garde ses textes (fr, en, es) dans son propre fichier.
- QA : `window.kh.analysis` (`loadSource`, `runAnalyzer`, `addPart`, `AN`, `registerAnalyzer`, `reset`) ; cas AN01-AN04 ; `anTone()` fabrique un son de test. `KH_PORT=52xx bash qa/all.sh …` choisit le port du serveur de QA, pour que plusieurs sessions fassent tourner leur campagne en même temps.

## Règles pour chaque analyse

- Un dossier ou des fichiers à soi dans `src/analysis/` ; textes via `addTexts` ; ne pas modifier `ui/analyze.ts`, `types.ts` ni `build.ts` sauf nécessité (le dire dans la passation).
- Calcul lourd hors du fil principal (Worker) ; annulable par `signal` ; avancement par `progress`.
- Modèles d'apprentissage : licence permissive (MIT, Apache 2.0), chargés à la demande, servis depuis `public/` (fichiers < 100 Mo, limite de GitHub) ; pas d'appel réseau vers un tiers à l'exécution. Le site et l'appli bureau doivent fonctionner hors ligne une fois le modèle chargé.
- Cas de QA avec un préfixe à soi, des sons de test fabriqués (pas de musique protégée dans le dépôt), et des seuils de précision mesurés et notés.

## Répartition

| Partie | Branche | Préfixe QA |
|---|---|---|
| Chant → notes, tempo, tonalité | `v20-chant` | VX |
| Séparation des pistes | `v20-pistes` | ST |
| Basse et piano → notes | `v20-poly` | PO |
| Batterie → motif | `v20-batterie` | DR |
| Familles d'instruments | `v20-instruments` | IN |

## Chant → notes, tempo et tonalité (branche `v20-chant`, préfixe QA `VX`)

### Ce qui est fait

- **Deux analyses** dans la fenêtre « Du son à la séquence » :
  - **Tempo et tonalité** (`vx-tempo`) : tempo en BPM, premier temps, tonalité (tonique + majeur/mineur, avec une confiance). Deux boutons : « Appliquer le tempo au morceau » et « Appliquer la tonalité au morceau » (tonalité et gamme du projet). Chacun s'annule par Ctrl+Z ou par le bouton « Annuler » du message de confirmation.
  - **Chant → notes** (`vx-melody`) : suit la voix note par note et propose une partie « Chant » (son de piste conseillé : flûte), ajoutée au morceau par « Ajouter au morceau ». Utilise la voix séparée (`ctx.input('vocals')`) si la séparation des pistes a tourné, et le dit ; sinon conseille de lancer la séparation d'abord.
- **Calcul dans un Worker** (`src/analysis/vx.worker.ts`, intégré au code par Vite en `?worker&inline`, donc compatible avec la règle de sécurité du site et de la version bureau), avec avancement et annulation. Si le navigateur refusait le Worker, le calcul tourne dans la page (même résultat).
- **Fichiers** (tous à moi) : `vx-dsp.ts` (calculs purs), `vx.worker.ts`, `vx-run.ts` (lancement, annulation, son mono), `vx-tempo.ts`, `vx-melody.ts`, `vx.ts` ; une ligne `import './vx';` dans `index.ts`. Aucun changement de `types.ts`, `build.ts` ni `ui/analyze.ts`.

### Méthodes

- Le son est ramené en mono à 11 025 Hz (filtre passe-bas puis prélèvement).
- **Tempo** : courbe des attaques par bandes de fréquence (la bande grave pèse double, car grosse caisse et basse marquent les temps, les cymbales souvent les croches), autocorrélation, peigne de tempo de 50 à 205 BPM, puis choix du tempo le plus rapide dont la grille tombe sur des attaques aussi fortes (évite les tempos moitié/double), affinage au centième puis recalage par régression sur chaque temps. Tempo arrondi à l'entier quand il en est à moins de 0,3.
- **Premier temps** : le premier temps de la grille où la musique commence vraiment ; si un temps sur quatre se détache nettement (accent), le premier temps de mesure. Remarque : `build.ts` écarte les notes placées avant le premier temps (levée) ; à revoir si besoin lors du rassemblement.
- **Tonalité** : chromagramme (pics du spectre de 60 à 2 000 Hz, chaque trame normalisée), corrélation avec les profils de Krumhansl et Kessler pour les 24 tonalités.
- **Chant** : YIN (65 à 1 100 Hz, 100 mesures par seconde), seuil de silence relatif au niveau du son, erreurs d'octave isolées corrigées, accord global du chanteur estimé puis retiré (un chanteur 35 centièmes trop haut garde les bonnes notes), hauteur lissée sur une période de vibrato, découpe avec hystérésis, début d'un glissé = début de la note, notes de moins de ~0,1 s fusionnées ou ignorées, même note répétée séparée par le creux d'énergie, vélocité de 0,2 à 1 selon le niveau par rapport à la note la plus forte (−30 dB → 0).

### Mesures (sons fabriqués dans la QA, VX01-VX12)

| Mesure | Résultat |
|---|---|
| Tempo, 70 à 170 BPM + 75,5 BPM, grosse caisse + charleston ; grosse caisse seule en stéréo | 13/13 à ±1 BPM (écart mesuré 0 en pratique) |
| Premier temps (départ à 0 s, 0,05 s, 0,37 s, 1,1 s, 2,3 s) | à 30 ms près (écart mesuré ~7 ms) |
| Tonalité, 4 majeures et 3 mineures (accords + mélodie) | 7/7 |
| Chant → notes, 7 variantes × 3 mélodies de 18 s (propre, vibrato ±0,5 et ±0,9 demi-ton, désaccord +35 et −40 centièmes, bruit, glissés de 0,15 s) | 99,5 % des notes retrouvées, 99,5 % justes (au demi-ton, attaque à 100 ms près) ; pire cas 94 % (glissés lents) |
| Chanson de 3 minutes | ~3,5 s de calcul, la page n'est jamais bloquée plus de ~170 ms, 99/100 % |

### Ce qui n'est pas vérifié

- **Pas de vraie voix** : toutes les mesures portent sur une voix synthétique. Une vraie voix (consonnes, souffle, attaques molles, notes très ornées) donnera moins bien ; écoute à l'oreille non faite.
- **Sans séparation des pistes**, sur un morceau avec accompagnement, le suivi monophonique échoue (mesuré : avec des accords, presque aucune note juste ; avec une batterie, beaucoup de notes en trop). Il faut la voix séparée (branche `v20-pistes`) : c'est le parcours prévu, à vérifier une fois les branches rassemblées.
- **Tempo** : vérifié sur des rythmes fabriqués réguliers ; pas sur de vrais morceaux (tempo qui flotte, swing, mesures à 3 temps, morceau sans batterie). Le premier temps de mesure ne se trouve que si un temps est accentué ; sinon c'est le premier temps entendu.
- **Tonalité** : modes autres que majeur/mineur (dorien, blues…) non reconnus ; confusions possibles entre relatives (do majeur / la mineur) sur de vrais morceaux.
- Pas testé sous Windows ni dans la version bureau construite (seulement la version construite servie en local : le Worker y fonctionne).
