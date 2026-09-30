import type { Action, GameEvent, GameView, PlayerId, Settings } from '../engine/game.ts';

/** Shared by the browser client and the server (server/). Messages are JSON over one WebSocket. */

export type WhiteChoice = 'host' | 'guest' | 'random';

export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 6;
export const MAX_NAME_LENGTH = 24;

export type ClientMessage =
  | { type: 'create'; name: string; settings: Settings; white: WhiteChoice }
  | { type: 'peek'; code: string }
  | { type: 'join'; code: string; name: string }
  | { type: 'resume'; code: string; token: string }
  /** `seq` is the view the player acted on; the server rejects actions against a stale game. */
  | { type: 'action'; id: number; seq: number; action: Action }
  | { type: 'rematch' };

export interface RoomInfo {
  code: string;
  names: Record<PlayerId, string | null>;
  settings: Settings;
  white: WhiteChoice;
  status: 'waiting' | 'playing';
}

export type Presence = Record<PlayerId, boolean>;

export type ErrorCode = 'not_found' | 'room_full' | 'bad_token' | 'rate_limited' | 'bad_request' | 'server_full' | 'replaced';

export type ServerMessage =
  | { type: 'room'; room: RoomInfo }
  | { type: 'welcome'; you: PlayerId; token: string; room: RoomInfo; view: GameView | null; presence: Presence }
  | { type: 'state'; view: GameView; events: GameEvent[] }
  | { type: 'presence'; presence: Presence; room: RoomInfo }
  | { type: 'ack'; id: number }
  | { type: 'rejected'; id: number; error: string }
  | { type: 'error'; code: ErrorCode; error: string };

export const normalizeRoomCode = (code: string): string => code.toUpperCase().replace(/[^A-Z0-9]/g, '');
