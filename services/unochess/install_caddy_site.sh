#!/usr/bin/env bash
# Add the unochess.jeremysigrist.com site block to Caddy and reload.
# Safe to re-run: it won't append a duplicate block.

set -euo pipefail

CADDYFILE=/etc/caddy/Caddyfile
SITE=unochess.jeremysigrist.com

if [[ $EUID -ne 0 ]]; then
	echo "Needs root; re-running under sudo..."
	exec sudo -- "$0" "$@"
fi

BLOCK="$(dirname "$(readlink -f "$0")")/Caddyfile.production"

if grep -q "^${SITE}\b" "$CADDYFILE"; then
	echo "ℹ️  ${SITE} block already present in ${CADDYFILE}; leaving it alone."
	echo "   If it predates the hardened block, replace it by hand with the one in:"
	echo "   ${BLOCK}"
else
	cp "$CADDYFILE" "${CADDYFILE}.bak.$(date +%Y%m%d%H%M%S)"
	{ echo; grep -v '^#' "$BLOCK"; } >> "$CADDYFILE"
	echo "✅ Appended ${SITE} block (backup saved alongside ${CADDYFILE})."
fi

caddy validate --config "$CADDYFILE" --adapter caddyfile
systemctl reload caddy
echo "✅ Caddy reloaded."

echo "Waiting for the certificate (first request triggers issuance)..."
for i in $(seq 1 20); do
	code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "https://${SITE}/healthz" || true)
	if [[ "$code" == "200" ]]; then
		echo "✅ https://${SITE}/healthz is live (HTTP 200)."
		exit 0
	fi
	echo "  attempt ${i}: got '${code}', retrying..."
	sleep 3
done

echo "⚠️  Not serving 200 yet. Check: journalctl -u caddy -n 50 --no-pager"
exit 1
