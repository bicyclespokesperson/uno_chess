import type { Action, GameView, PlayerId } from '../engine/game.ts';
import type { DispatchResult, GameClient, Listener } from './client.ts';
import type { ClientMessage, ErrorCode, Presence, RoomInfo, ServerMessage } from './protocol.ts';
import { clearOnline, saveOnline } from './storage.ts';

export type ConnectionStatus = 'online' | 'reconnecting' | 'closed';

export interface OnlineMeta {
  status: ConnectionStatus;
  you: PlayerId;
  code: string;
  room: RoomInfo;
  presence: Presence;
  /** Why the connection ended for good, when status is 'closed'. */
  closedReason: string | null;
}

export type MetaListener = (meta: OnlineMeta) => void;

export class OnlineError extends Error {
  readonly code: ErrorCode | 'unreachable';
  constructor(code: ErrorCode | 'unreachable', message: string) {
    super(message);
    this.code = code;
  }
}

const ACTION_TIMEOUT_MS = 10_000;
const MAX_BACKOFF_MS = 10_000;
const UNREACHABLE = 'Couldn’t reach the game server. Check your connection and try again.';

/** Opens a socket, sends one message and resolves with the first reply that `accept` recognises. */
function exchange<T>(url: string, hello: ClientMessage, accept: (m: ServerMessage) => T | undefined): Promise<{ ws: WebSocket; value: T }> {
  return new Promise((resolve, reject) => {
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      return reject(new OnlineError('unreachable', UNREACHABLE));
    }
    const timer = setTimeout(() => {
      ws.close();
      reject(new OnlineError('unreachable', UNREACHABLE));
    }, ACTION_TIMEOUT_MS);
    ws.onopen = () => ws.send(JSON.stringify(hello));
    ws.onerror = () => {
      clearTimeout(timer);
      reject(new OnlineError('unreachable', UNREACHABLE));
    };
    ws.onmessage = (e) => {
      const msg = JSON.parse(String(e.data)) as ServerMessage;
      if (msg.type === 'error') {
        clearTimeout(timer);
        ws.close();
        return reject(new OnlineError(msg.code, msg.error));
      }
      const value = accept(msg);
      if (value === undefined) return;
      clearTimeout(timer);
      ws.onopen = ws.onerror = ws.onmessage = null;
      resolve({ ws, value });
    };
  });
}

/** Online play: the server runs the engine; this device acts for exactly one player. */
export class RemoteClient implements GameClient {
  readonly localPlayers: readonly PlayerId[];
  private readonly url: string;
  private ws: WebSocket | null;
  private token: string;
  private view: GameView | null;
  private meta: OnlineMeta;
  private listeners = new Set<Listener>();
  private metaListeners = new Set<MetaListener>();
  private pending = new Map<number, (r: DispatchResult) => void>();
  private nextId = 1;
  private attempts = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  /** Sends `create`, `join` or `resume` and resolves once the server has seated us. */
  static async connect(url: string, hello: ClientMessage): Promise<RemoteClient> {
    const { ws, value } = await exchange(url, hello, (m) => (m.type === 'welcome' ? m : undefined));
    return new RemoteClient(url, ws, value);
  }

  static async peek(url: string, code: string): Promise<RoomInfo> {
    const { ws, value } = await exchange(url, { type: 'peek', code }, (m) => (m.type === 'room' ? m.room : undefined));
    ws.close();
    return value;
  }

  private constructor(url: string, ws: WebSocket, welcome: Extract<ServerMessage, { type: 'welcome' }>) {
    this.url = url;
    this.ws = ws;
    this.token = welcome.token;
    this.localPlayers = [welcome.you];
    this.view = welcome.view;
    this.meta = { status: 'online', you: welcome.you, code: welcome.room.code, room: welcome.room, presence: welcome.presence, closedReason: null };
    saveOnline({ code: welcome.room.code, token: welcome.token, you: welcome.you });
    this.wire(ws);
    window.addEventListener('online', this.reconnectNow);
  }

  hasGame(): boolean {
    return this.view !== null;
  }

  getView(): GameView {
    if (!this.view) throw new Error('No game yet: waiting for an opponent.');
    return this.view;
  }

  getMeta(): OnlineMeta {
    return this.meta;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  subscribeMeta(listener: MetaListener): () => void {
    this.metaListeners.add(listener);
    return () => this.metaListeners.delete(listener);
  }

  dispatch(actor: PlayerId, action: Action): Promise<DispatchResult> {
    if (actor !== this.meta.you) return Promise.resolve({ ok: false, error: 'You can only act for yourself.' });
    if (!this.view) return Promise.resolve({ ok: false, error: 'Waiting for your opponent to join.' });
    if (this.meta.status !== 'online' || this.ws?.readyState !== WebSocket.OPEN) {
      return Promise.resolve({ ok: false, error: 'You’re offline. Reconnecting…' });
    }
    const id = this.nextId++;
    this.send({ type: 'action', id, seq: this.view.seq, action });
    return new Promise((resolve) => {
      const timer = setTimeout(() => this.settle(id, { ok: false, error: 'The server didn’t answer. Try again.' }), ACTION_TIMEOUT_MS);
      this.pending.set(id, (r) => {
        clearTimeout(timer);
        resolve(r);
      });
    });
  }

  rematch(): void {
    this.send({ type: 'rematch' });
  }

  /** Stop playing on this device. The seat stays reserved on the server until the room expires. */
  leave(): void {
    clearOnline();
    this.dispose();
  }

  dispose(): void {
    this.disposed = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    window.removeEventListener('online', this.reconnectNow);
    this.ws?.close(1000, 'left');
    this.ws = null;
    this.listeners.clear();
    this.metaListeners.clear();
  }

  private send(msg: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private settle(id: number, result: DispatchResult): void {
    this.pending.get(id)?.(result);
    this.pending.delete(id);
  }

  private setMeta(patch: Partial<OnlineMeta>): void {
    this.meta = { ...this.meta, ...patch };
    this.metaListeners.forEach((l) => l(this.meta));
  }

  private wire(ws: WebSocket): void {
    ws.onmessage = (e) => this.receive(JSON.parse(String(e.data)) as ServerMessage);
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      for (const id of [...this.pending.keys()]) this.settle(id, { ok: false, error: 'Connection lost. Reconnecting…' });
      if (this.disposed || this.meta.status === 'closed') return;
      this.setMeta({ status: 'reconnecting' });
      this.scheduleReconnect();
    };
  }

  private receive(msg: ServerMessage): void {
    switch (msg.type) {
      case 'welcome':
        this.attempts = 0;
        this.view = msg.view;
        this.setMeta({ status: 'online', room: msg.room, presence: msg.presence });
        if (msg.view) this.listeners.forEach((l) => l(msg.view!, []));
        return;
      case 'state':
        this.view = msg.view;
        this.listeners.forEach((l) => l(msg.view, msg.events));
        return;
      case 'presence':
        this.setMeta({ presence: msg.presence, room: msg.room });
        return;
      case 'ack':
        return this.settle(msg.id, { ok: true });
      case 'rejected':
        return this.settle(msg.id, { ok: false, error: msg.error });
      case 'error':
        if (msg.code === 'replaced' || msg.code === 'bad_token' || msg.code === 'not_found') {
          if (msg.code !== 'replaced') clearOnline();
          this.setMeta({ status: 'closed', closedReason: msg.error });
          this.ws?.close();
        }
        return;
      case 'room':
        return;
    }
  }

  private reconnectNow = (): void => {
    if (this.meta.status !== 'reconnecting' || this.ws) return;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.open();
  };

  private scheduleReconnect(): void {
    const delay = Math.min(MAX_BACKOFF_MS, 500 * 2 ** this.attempts) * (0.75 + Math.random() * 0.5);
    this.attempts++;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.open();
    }, delay);
  }

  private open(): void {
    if (this.disposed) return;
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch {
      return this.scheduleReconnect();
    }
    this.ws = ws;
    this.wire(ws);
    ws.onopen = () => ws.send(JSON.stringify({ type: 'resume', code: this.meta.code, token: this.token } satisfies ClientMessage));
  }
}
