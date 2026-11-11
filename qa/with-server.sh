#!/usr/bin/env bash
# Exécute une commande avec le serveur de développement démarré : qa/with-server.sh <commande...>
cd "$(dirname "$0")/.."
npx vite --port 5199 --strictPort >/dev/null 2>&1 &
PID=$!
trap 'kill $PID 2>/dev/null' EXIT
for i in $(seq 1 40); do curl -s -o /dev/null http://localhost:5199/ && break; sleep 0.5; done
export KH_URL=http://localhost:5199/ NODE_PATH="${NODE_PATH:-$(npm root -g)}"
"$@"
