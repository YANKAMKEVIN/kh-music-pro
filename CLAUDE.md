# KH Music Pro — consignes pour Claude

Station de travail audio (DAW) dans le navigateur, en TypeScript sans framework. Lire `docs/PASSATION.md` avant tout travail : il décrit l'état du projet, les décisions prises et la suite prévue.

## Règles permanentes du propriétaire

- **Répondre en français.** Le propriétaire est musicien, pas développeur : parler de ce que fait l'application, pas du code.
- **QA obligatoire** : toute évolution web doit être couverte par des cas d'usage dans `qa/run.cjs` (un cas d'usage = un test de bout en bout dans un vrai navigateur). Imaginer beaucoup de cas, les ajouter, puis faire passer toute la campagne avant de livrer.
- **Trois langues** : tout texte d'interface va dans `src/i18n.ts` en français, anglais et espagnol.
- **Interface** : accessible, intuitive, futuriste ; utilisable au clavier et au doigt.
- **Franchise** : dire ce qui a été vérifié et ce qui ne l'a pas été (micro et MIDI réels, écoute à l'oreille, Windows).

## Commandes

```bash
npm install          # dépendances (Electron compris, c'est long)
npm run dev          # serveur de développement, http://localhost:5173
npm run build        # vérification des types + version de production dans dist/
npm run qa:all       # campagne de QA complète (lance et arrête le serveur)
npm run qa -- TP,SG  # un sous-ensemble de cas, serveur déjà lancé
npm run desktop      # version bureau (Electron)
```

La QA utilise Playwright 1.63.0 (`npx playwright install chromium` si le navigateur manque).

## Déroulement d'une version

1. Branche `vN` à partir de `main`.
2. Code + cas de QA + textes en trois langues ; README et numéro de version à jour.
3. `npm run qa:all` entièrement vert, puis `npm run build`.
4. Pousser la branche ; la QA et la construction bureau tournent sur GitHub.
5. Fusion dans `main` seulement avec l'accord du propriétaire (elle met le site en ligne à jour).
6. Release : c'est le propriétaire qui crée l'étiquette `vX.Y.Z` depuis la page Releases ; les installateurs s'y attachent tout seuls.
