# unochess: the online game server

The static site stays on GitHub Pages. Online games go through a small Node WebSocket server (`server/main.ts`) running on this machine as a systemd **user** service, behind Caddy at `https://unochess.jeremysigrist.com` (proxying to `127.0.0.1:7879`). The layout follows `~/Development/afm/services/afm-web`.

| Piece | Where |
| --- | --- |
| Server code | `server/` (runs the same `src/engine/` as the browser, TypeScript run directly by Node 24) |
| Unit | `services/unochess/unochess.service`, symlinked into `~/.config/systemd/user/` |
| Data | `~/.local/share/uno-chess/rooms/<CODE>.json`, one file per game (mode 0600) |
| Caddy block | `services/unochess/Caddyfile.production`, appended to `/etc/caddy/Caddyfile` |
| Frontend config | GitHub repo variable `VITE_SERVER_URL`, read by `.github/workflows/deploy.yml` |

## First-time setup

1. DNS: add a `CNAME` record `unochess` → `garden.jeremysigrist.com` at the DNS provider (there is no wildcard record).
2. Install and start the service (no sudo):

   ```sh
   cd ~/Development/uno_chess && npm ci
   ln -s ~/Development/uno_chess/services/unochess/unochess.service ~/.config/systemd/user/
   systemctl --user daemon-reload && systemctl --user enable --now unochess
   curl -s http://127.0.0.1:7879/healthz        # {"ok":true,...}
   ```

3. Caddy (the only sudo step; backs up the Caddyfile, appends the block, validates, reloads, waits for a 200):

   ```sh
   services/unochess/install_caddy_site.sh
   ```

4. Turn online play on in the published site:

   ```sh
   gh variable set VITE_SERVER_URL --body 'wss://unochess.jeremysigrist.com/ws'
   gh workflow run deploy.yml
   ```

## Day to day

- `systemctl --user status|restart unochess`, `journalctl --user -u unochess -f`
- Deploying server changes: `git pull && npm ci && systemctl --user restart unochess`. Restarts are safe: SIGTERM flushes every room to disk, and browsers reconnect and resume on their own.
- Don't `kill -9` it: saves are batched every 250 ms, so a hard kill can lose the last moves.
- Stale rooms are swept hourly: games nobody joined after 2 days, and any game idle for 30 days.

## How it's protected

- Only the GitHub Pages origin and the local Vite dev server may open a WebSocket (`--origin` flag to change, repeatable).
- Each player gets a random 256-bit token kept in their browser's localStorage. The server stores only its SHA-256, and compares in constant time.
- The server is authoritative: every action runs through the engine's `applyAction`, which validates the action's shape and legality. Clients never see the deck order or RNG state.
- Rate limits: 20 failed joins/resumes (bad codes or tokens) per IP per 10 minutes; 30 new games per IP per hour; 10 messages/second per connection (burst 40); 16 KB per message; 5,000 rooms total. Behind Caddy, the client IP is the rightmost `X-Forwarded-For` entry.
- The unit drops API tokens from its environment, and runs with `NoNewPrivileges`, `PrivateTmp` and `UMask=0077`.
