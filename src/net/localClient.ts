import { applyAction, GameError, PLAYER_IDS, toView, type Action, type GameState, type GameView, type PlayerId } from '../engine/game';
import type { DispatchResult, GameClient, Listener } from './client';
import { saveGame } from './storage';

/** Hot-seat play: the engine runs in the browser and both players share this device. */
export class LocalClient implements GameClient {
  readonly localPlayers: readonly PlayerId[] = PLAYER_IDS;
  private listeners = new Set<Listener>();
  private view: GameView;

  constructor(private state: GameState) {
    this.view = toView(state);
  }

  getView(): GameView {
    return this.view;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async dispatch(actor: PlayerId, action: Action): Promise<DispatchResult> {
    try {
      const { state, events } = applyAction(this.state, actor, action);
      this.state = state;
      this.view = toView(state);
      saveGame(state);
      this.listeners.forEach((l) => l(this.view, events));
      return { ok: true };
    } catch (err) {
      if (err instanceof GameError) return { ok: false, error: err.message };
      throw err;
    }
  }

  dispose(): void {
    this.listeners.clear();
  }
}
