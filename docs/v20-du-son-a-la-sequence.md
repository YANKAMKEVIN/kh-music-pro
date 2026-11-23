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
| Familles d'instruments | `v20-instruments` | INF |

## Familles d'instruments (branche `claude/v20-instruments-0f6266`, cas INF)

**Fait**
- Analyse « Familles d'instruments » (`src/analysis/instruments/`) : voix, piano, piano électrique, orgue, guitare acoustique, guitare électrique, basse, batterie, cordes, cuivres, bois, percussions mélodiques, synthé (nappe ou solo, d'après la tenue du son). Pour chacune : une confiance, la part du morceau où on l'entend, le **son de KH Music Pro le plus proche** (ex. trompette → « Trompette », batterie → kit « Acoustique expressive · Studio ») et un bouton **Créer une piste**. L'interface dit que ce sont des familles, pas le modèle exact de l'instrument.
- Modèle : **YAMNet** (Google, Apache 2.0, 521 classes AudioSet), version TF.js, **16 Mo** dans `public/models/yamnet/` ; moteur **TF.js 4.22.0** (Apache 2.0) avec son moteur WebAssembly (`public/models/tfjs/`, 0,7 Mo). Chargé à la première analyse, aucun appel réseau vers un tiers (vérifié par INF01). Les classes AudioSet sont regroupées en familles dans `families.ts`.
- Calcul dans un **Worker** (repli sur le fil principal s'il ne démarre pas, résultat identique : INF11), avancement et annulation. Une minute de son : ~8 à 15 s sur le Mac de développement.
- YAMNet reconnaît mal un instrument dans un mélange (il répond surtout « Musique », et la batterie masque le reste). D'où une **séparation légère** avant le classement : partie tenue / partie frappée (filtres médians sur le spectrogramme), bande grave pour la basse. Si l'analyse « pistes séparées » (ST) a rempli `ctx.result.stems`, chaque piste est classée à part (voix → voix, batterie → batterie, basse → basse, reste → instruments).
- Les parties des autres analyses (`bass`, `piano`, `melody`) sans son reçoivent celui de la famille entendue ; un son déjà choisi n'est jamais remplacé (INF06).

**Mesures** (sons rendus par l'application, 4 mesures à 100 BPM ; « retrouvées » = familles présentes reconnues, « justes » = familles annoncées qui sont bien là ; voisines admises, par ex. piano / piano électrique)

| Cas | Retrouvées | Annonces justes | Seuil du cas |
|---|---|---|---|
| 34 instruments seuls (INF02) | 100 % | 84 % | 85 % / 75 % |
| 20 mélanges de 2 à 4 instruments, sans pistes séparées (INF03) | 54 % | 93 % | 45 % / 70 % |
| les mêmes avec pistes séparées parfaites (INF04) | 77 % | 96 % | 70 % / 70 % |

Erreurs typiques : un piano ou des cordes sous la batterie ne sont pas entendus ; cordes et flûte ensemble passent inaperçues ; les percussions mélodiques font aussi annoncer « batterie ». Réglages (`TUNE` dans `families.ts`, `SPLIT` dans `core.ts`) choisis par recherche sur 71 cas.

**Non vérifié** : morceaux réels du commerce (seulement des sons de l'appli), écoute à l'oreille du son conseillé, version bureau (Worker et WebAssembly depuis `file://` ; le modèle est lu par XMLHttpRequest comme les banques, et un repli sur le fil principal existe), Windows, téléphone réel (16 Mo à charger, calcul plus lent), fonctionnement hors ligne après un premier chargement (le service worker garde les fichiers qu'il a servis, non testé ici). Avec les vraies pistes de l'analyse ST, imparfaites, le résultat sera entre les deux mesures ci-dessus.

**Pour la fusion** : dépendances `@tensorflow/tfjs-core`, `-converter`, `-backend-cpu`, `-backend-wasm` (4.22.0) dans `package.json` ; une ligne `import './instruments';` dans `src/analysis/index.ts`. Préfixe de QA **INF** (« IN » était déjà pris par les cas d'entrée audio IN01-IN03).

Campagne complète (`KH_PORT=5245 npm run qa:all`, 23/11/2026) : 484/491. Les 12 cas INF passent. AR03, LQ01, BN03, CT06, QZ04 et LR05 ont échoué sous la charge (cinq sessions en parallèle) et passent rejoués seuls ; **QZ03** échoue aussi sur la branche `v20` sans ce travail (clic qui n'aboutit pas, à regarder à part). `npm run build` passe.
