import type { GameState, PlayerId, Settings } from '../engine/game.ts';
import type { WhiteChoice } from './protocol.ts';

const GAME_KEY = 'uno-chess:game:v1';
const PREFS_KEY = 'uno-chess:prefs:v1';
const ONLINE_KEY = 'uno-chess:online:v2';
const MAX_ONLINE_SESSIONS = 10;

export interface Prefs {
  names: Record<PlayerId, string>;
  settings: Settings;
  whiteChoice: PlayerId | 'random';
  onlineName?: string;
  onlineWhite?: WhiteChoice;
}

/** Proof that this browser holds a seat in an online game. */
export interface OnlineSession {
  code: string;
  token: string;
  you: PlayerId;
  /** For the "rejoin" list, e.g. "Ana vs Bo". */
  label: string;
  savedAt: number;
}

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be unavailable (private mode, quota); the game still works without saving.
  }
}

export function loadGame(): GameState | null {
  const game = read<GameState>(GAME_KEY);
  return game?.version === 1 ? game : null;
}

export const saveGame = (game: GameState): void => write(GAME_KEY, game);
export const clearGame = (): void => write(GAME_KEY, null);
export const loadPrefs = (): Prefs | null => read<Prefs>(PREFS_KEY);
export const savePrefs = (prefs: Prefs): void => write(PREFS_KEY, prefs);
/** Every online game this browser can rejoin, most recent first. */
export const loadOnlineSessions = (): OnlineSession[] => read<OnlineSession[]>(ONLINE_KEY) ?? [];

export const loadOnline = (code?: string): OnlineSession | null =>
  loadOnlineSessions().find((s) => code === undefined || s.code === code) ?? null;

export function saveOnline(session: Omit<OnlineSession, 'savedAt'>): void {
  const others = loadOnlineSessions().filter((s) => s.code !== session.code);
  write(ONLINE_KEY, [{ ...session, savedAt: Date.now() }, ...others].slice(0, MAX_ONLINE_SESSIONS));
}

export function clearOnline(code: string): void {
  write(ONLINE_KEY, loadOnlineSessions().filter((s) => s.code !== code));
}
