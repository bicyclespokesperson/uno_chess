/**
 * Where online games are hosted. Production builds are served by the game server itself, so the
 * default is the same origin; `VITE_SERVER_URL` overrides it (e.g. a frontend hosted elsewhere).
 */
function defaultServerUrl(): string {
  if (import.meta.env.DEV) return 'ws://127.0.0.1:7879/ws';
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
}

export const SERVER_URL: string = import.meta.env.VITE_SERVER_URL || defaultServerUrl();
