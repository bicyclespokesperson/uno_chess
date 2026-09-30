/** Where online games are hosted. Empty disables online play (e.g. a fork without a server). */
export const SERVER_URL: string = import.meta.env.VITE_SERVER_URL ?? (import.meta.env.DEV ? 'ws://127.0.0.1:7879/ws' : '');
