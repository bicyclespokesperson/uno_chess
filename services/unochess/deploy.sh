#!/usr/bin/env bash
# Build the frontend and restart the server so https://unochess.jeremysigrist.com serves the current checkout.
set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")/../.."
mise exec -- npm ci --silent
mise exec -- npm test --silent
mise exec -- npm run build --silent
systemctl --user restart unochess
sleep 1
curl -fsS http://127.0.0.1:7879/healthz && echo
echo "✅ Deployed $(git rev-parse --short HEAD)"
