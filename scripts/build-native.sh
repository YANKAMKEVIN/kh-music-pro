#!/bin/bash
# Construit le module natif de la version bureau macOS (plugins Audio Unit, carte son par Core Audio) contre les en-têtes
# de la version d'Electron installée. Par défaut, un seul fichier « universel » qui marche sur les Mac Apple et Intel ;
# KH_ARCHS="arm64" (ou "x64") pour une seule puce, plus rapide en développement.
# Résultat : native/kh-au-bridge/build/Release/kh_au_bridge.node (rangé dans l'installateur par electron-builder).
set -euo pipefail
if [ "$(uname)" != "Darwin" ]; then echo "Module natif : macOS seulement, rien à faire ici."; exit 0; fi
cd "$(dirname "$0")/../native/kh-au-bridge"
VERSION=$(node -p "require('../../node_modules/electron/package.json').version")
ARCHS=${KH_ARCHS:-"arm64 x64"}
TMP=$(mktemp -d)
for A in $ARCHS; do
  echo "Module natif : Electron $VERSION, puce $A"
  npx --yes node-gyp@11 rebuild --target="$VERSION" --arch="$A" --dist-url=https://electronjs.org/headers >"$TMP/gyp-$A.log" 2>&1 || { cat "$TMP/gyp-$A.log"; exit 1; }
  cp build/Release/kh_au_bridge.node "$TMP/kh_au_bridge-$A.node"
done
lipo -create "$TMP"/kh_au_bridge-*.node -output build/Release/kh_au_bridge.node
# Signature « ad hoc » : obligatoire pour charger du code sur un Mac Apple (l'application n'est pas signée par un développeur).
codesign --force --sign - build/Release/kh_au_bridge.node
lipo -info build/Release/kh_au_bridge.node
rm -rf "$TMP"
