#!/usr/bin/env bash
# Copie figée du projet pour lancer la QA pendant qu'on continue d'éditer : qa/snapshot.sh <dossier> <commande...>
# (le serveur de développement recharge le code modifié ; une campagne lancée sur le dossier de travail se fausserait).
set -e
SRC="$(cd "$(dirname "$0")/.." && pwd)"; DST="$1"; shift
mkdir -p "$DST"
rsync -a --delete --exclude node_modules --exclude .git --exclude release --exclude 'qa/shots' "$SRC/" "$DST/"
[ -e "$DST/node_modules" ] || ln -s "$SRC/node_modules" "$DST/node_modules"
cd "$DST" && "$@"
