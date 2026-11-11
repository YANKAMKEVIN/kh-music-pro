#!/usr/bin/env bash
# Lance le serveur de développement, exécute la campagne de QA, puis arrête le serveur.
cd "$(dirname "$0")/.."
npx vite --port 5199 --strictPort >/dev/null 2>&1 &
PID=$!
trap 'kill $PID 2>/dev/null' EXIT
for i in $(seq 1 40); do curl -s -o /dev/null http://localhost:5199/ && break; sleep 0.5; done
KH_URL=http://localhost:5199/ NODE_PATH="${NODE_PATH:-$(npm root -g)}" node qa/run.cjs "$@"
