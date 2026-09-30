# unochess: the online game server

One Node process (`server/main.ts`) serves both the built site (`dist/`) and the game's WebSocket (`/ws`) from `https://unochess.jeremysigrist.com`. It runs on this machine as a systemd **user** service behind Caddy, which proxies to `127.0.0.1:7879`. Serving both from one origin means the browser needs no server URL and no cross-origin setup. The layout follows `~/Development/afm/services/afm-web`. GitHub Pages only hosts a redirect (`pages-redirect/`) so old links keep working.

| Piece | Where |
| --- | --- |
| Server code | `server/` (runs the same `src/engine/` as the browser, TypeScript run directly by Node 24) |
| Unit | `services/unochess/unochess.service`, symlinked into `~/.config/systemd/user/` |
| Data | `~/.local/share/uno-chess/rooms/<CODE>.json`, one file per game (mode 0600) |
| Caddy block | `services/unochess/Caddyfile.production`, appended to `/etc/caddy/Caddyfile` |
| Site | `dist/`, built from the checkout by `deploy.sh` |

## First-time setup

1. DNS: add a `CNAME` record `unochess` → `garden.jeremysigrist.com` at the DNS provider (there is no wildcard record).
2. Install and start the service (no sudo):

   ```sh
   cd ~/Development/uno_chess && npm ci && npm run build
   ln -s ~/Development/uno_chess/services/unochess/unochess.service ~/.config/systemd/user/
   systemctl --user daemon-reload && systemctl --user enable --now unochess
   curl -s http://127.0.0.1:7879/healthz        # {"ok":true,...}
   ```

3. Caddy (the only sudo step; backs up the Caddyfile, appends the block, validates, reloads, waits for a 200):

   ```sh
   services/unochess/install_caddy_site.sh
   ```


## Day to day

- `systemctl --user status|restart unochess`, `journalctl --user -u unochess -f`
- Deploying: `services/unochess/deploy.sh` (installs, runs the tests, builds `dist/`, restarts). Restarts are safe: SIGTERM flushes every room to disk, and browsers reconnect and resume on their own. Rebuilding `dist/` in this checkout changes what the live site serves, so build dev experiments elsewhere or redeploy afterwards.
- Don't `kill -9` it: saves are batched every 250 ms, so a hard kill can lose the last moves.
- Stale rooms are swept hourly: games nobody joined after 12 hours, and any game idle for 30 days. Leaving a game releases it right away: a room nobody joined is deleted, and leaving mid-game resigns.

## How it's protected

- Only pages from `https://unochess.jeremysigrist.com` and the local Vite dev server may open a WebSocket (`--origin` flag to change, repeatable). The site is served with a strict Content-Security-Policy, `nosniff`, `no-referrer` and `frame-ancestors 'none'`. Hashed assets are cached for a year, and `index.html` is never cached.
- Each player gets a random 256-bit token kept in their browser's localStorage. The server stores only its SHA-256, and compares in constant time.
- The server is authoritative: every action runs through the engine's `applyAction`, which validates the action's shape and legality. Clients never see the deck order or RNG state.
- Limits:
  - Per address (IPv6 is bucketed by /64): 20 failed joins/resumes per 10 minutes, 10 new games per hour, and 16 open connections.
  - Server-wide: 500 failed attempts per 10 minutes, 300 new games per hour, 2,000 connections, and 20,000 rooms.
  - Per connection: 10 messages/second (burst 40) and 16 KB per message. A socket that hasn't joined a game within 30 s is closed.
  - Per game: 1,000 cards, after which it's a draw. This keeps saved and broadcast games small.
  - Behind Caddy, the client IP is the rightmost `X-Forwarded-For` entry.
- The unit drops API tokens from its environment, and runs with `NoNewPrivileges`, `PrivateTmp` and `UMask=0077`.
