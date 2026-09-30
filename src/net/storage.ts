import type { GameState, PlayerId, Settings } from '../engine/game.ts';

const GAME_KEY = 'uno-chess:game:v1';
const PREFS_KEY = 'uno-chess:prefs:v1';

export interface Prefs {
  names: Record<PlayerId, string>;
  settings: Settings;
  whiteChoice: PlayerId | 'random';
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
