import type { Action, GameEvent, GameView, PlayerId } from '../engine/game';

export type DispatchResult = { ok: true } | { ok: false; error: string };

export type Listener = (view: GameView, events: GameEvent[]) => void;

/**
 * The UI's only door into a game. Local hot-seat play and a future online mode both implement this:
 * an online client would send `dispatch` calls to a server running the same engine and feed the
 * server's broadcasts to `subscribe` listeners. See ARCHITECTURE.md.
 */
export interface GameClient {
  /** Players this device may act for: both in hot-seat play, one when online. */
  readonly localPlayers: readonly PlayerId[];
  getView(): GameView;
  subscribe(listener: Listener): () => void;
  dispatch(actor: PlayerId, action: Action): Promise<DispatchResult>;
  dispose(): void;
}
