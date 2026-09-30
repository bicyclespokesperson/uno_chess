import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { isIPv6 } from 'node:net';
import {
  applyAction,
  createGame,
  GameError,
  isPlayerId,
  MOVE_CAP_OPTIONS,
  otherPlayer,
  PLAYER_IDS,
  startingWhite,
  toView,
  type GameState,
  type PlayerId,
  type Settings,
} from '../src/engine/game.ts';
import {
  MAX_NAME_LENGTH,
  normalizeRoomCode,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  type ClientMessage,
  type ErrorCode,
  type Presence,
  type RoomInfo,
  type ServerMessage,
  type WhiteChoice,
} from '../src/net/protocol.ts';

export interface Seat {
  name: string;
  /** sha256 of the player's token; the token itself only ever lives in their browser. Empty once they leave. */
  tokenHash: string;
  left?: boolean;
}

export interface Room {
  code: string;
  createdAt: number;
  updatedAt: number;
  settings: Settings;
  white: WhiteChoice;
  seats: Record<PlayerId, Seat | null>;
  state: GameState | null;
}

export interface Connection {
  readonly ip: string;
  send(msg: ServerMessage): void;
  close(code: number, reason: string): void;
}

export interface RoomStore {
  load(): Room[];
  save(room: Room): void;
  remove(code: string): void;
}

export interface RoomManagerOptions {
  maxRooms?: number;
  now?: () => number;
  log?: (msg: string) => void;
}

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WAITING_ROOM_TTL = 12 * HOUR;
const IDLE_ROOM_TTL = 30 * DAY;

export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

function tokenMatches(token: unknown, hash: string): boolean {
  if (typeof token !== 'string' || token.length > 200 || !hash) return false;
  const a = Buffer.from(hashToken(token), 'hex');
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Rate limits key on the client's /64 for IPv6, since one host can trivially rotate within it. */
export function ipBucket(ip: string): string {
  const bare = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  if (!isIPv6(bare)) return bare;
  const [head] = bare.split('::');
  const groups = bare.includes('::') ? head.split(':').filter(Boolean) : bare.split(':');
  return `${[...groups, '0', '0', '0', '0'].slice(0, 4).join(':')}::/64`;
}

function cleanName(v: unknown, fallback: string): string {
  if (typeof v !== 'string') return fallback;
  const name = v.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH);
  return name || fallback;
}

function cleanSettings(v: unknown): Settings | null {
  if (typeof v !== 'object' || v === null) return null;
  const { moveCap, allowEarlyEnd } = v as Record<string, unknown>;
  if (!(MOVE_CAP_OPTIONS as readonly unknown[]).includes(moveCap) || typeof allowEarlyEnd !== 'boolean') return null;
  return { moveCap: moveCap as number, allowEarlyEnd };
}

/** Counts events per key inside a sliding window, plus a server-wide total. */
export class SlidingLimiter {
  private hits = new Map<string, number[]>();
  private readonly perKey: number;
  private readonly total: number;
  private readonly windowMs: number;
  private readonly now: () => number;

  constructor(perKey: number, total: number, windowMs: number, now: () => number) {
    this.perKey = perKey;
    this.total = total;
    this.windowMs = windowMs;
    this.now = now;
  }

  private recent(key: string): number[] {
    const cutoff = this.now() - this.windowMs;
    const list = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    if (list.length) this.hits.set(key, list);
    else this.hits.delete(key);
    return list;
  }

  blocked(key: string): boolean {
    return this.recent(key).length >= this.perKey || this.recent('*').length >= this.total;
  }

  hit(key: string): void {
    for (const k of [key, '*']) this.hits.set(k, [...this.recent(k), this.now()]);
  }

  /** Forget keys with nothing inside the window, so one-off addresses don't accumulate. */
  prune(): void {
    for (const key of [...this.hits.keys()]) this.recent(key);
  }

  size(): number {
    return this.hits.size;
  }
}

export class RoomManager {
  private rooms = new Map<string, Room>();
  private seats = new Map<Connection, { code: string; seat: PlayerId }>();
  private byRoom = new Map<string, Set<Connection>>();
  private readonly store: RoomStore;
  private readonly maxRooms: number;
  private readonly now: () => number;
  private readonly log: (msg: string) => void;
  private readonly failures: SlidingLimiter;
  private readonly creations: SlidingLimiter;

  constructor(store: RoomStore, opts: RoomManagerOptions = {}) {
    this.store = store;
    this.maxRooms = opts.maxRooms ?? 20_000;
    this.now = opts.now ?? Date.now;
    this.log = opts.log ?? (() => {});
    this.failures = new SlidingLimiter(20, 500, 10 * MINUTE, this.now);
    this.creations = new SlidingLimiter(10, 300, HOUR, this.now);
    for (const room of store.load()) this.rooms.set(room.code, room);
  }

  stats(): { rooms: number; connections: number } {
    return { rooms: this.rooms.size, connections: this.seats.size };
  }

  isSeated(conn: Connection): boolean {
    return this.seats.has(conn);
  }

  handle(conn: Connection, raw: unknown): void {
    if (typeof raw !== 'object' || raw === null || typeof (raw as { type?: unknown }).type !== 'string') {
      return this.fail(conn, 'bad_request', 'Unrecognized message.');
    }
    const msg = raw as ClientMessage;
    switch (msg.type) {
      case 'create': return this.create(conn, msg);
      case 'peek': return this.peek(conn, msg.code);
      case 'join': return this.join(conn, msg.code, msg.name);
      case 'resume': return this.resume(conn, msg.code, msg.token);
      case 'action': return this.act(conn, msg);
      case 'rematch': return this.rematch(conn);
      case 'leave': return this.leave(conn);
      default: return this.fail(conn, 'bad_request', 'Unrecognized message.');
    }
  }

  disconnect(conn: Connection): void {
    const room = this.detach(conn);
    if (room) this.broadcastPresence(room);
  }

  /** Drops abandoned rooms and forgets stale rate-limit entries. Rooms with someone connected are kept. */
  sweep(): void {
    const now = this.now();
    for (const room of this.rooms.values()) {
      const ttl = room.state ? IDLE_ROOM_TTL : WAITING_ROOM_TTL;
      if (now - room.updatedAt < ttl || this.byRoom.get(room.code)?.size) continue;
      this.deleteRoom(room, 'expired');
    }
    this.failures.prune();
    this.creations.prune();
  }

  private fail(conn: Connection, code: ErrorCode, error: string): void {
    conn.send({ type: 'error', code, error });
  }

  private admissionBlocked(conn: Connection): boolean {
    if (!this.failures.blocked(ipBucket(conn.ip))) return false;
    this.fail(conn, 'rate_limited', 'Too many failed attempts. Wait a few minutes and try again.');
    return true;
  }

  private lookup(conn: Connection, rawCode: unknown): Room | null {
    const room = typeof rawCode === 'string' ? this.rooms.get(normalizeRoomCode(rawCode)) : undefined;
    if (room) return room;
    this.failures.hit(ipBucket(conn.ip));
    this.fail(conn, 'not_found', 'No game with that code. Check the link, or ask for a new one.');
    return null;
  }

  private newCode(): string {
    for (;;) {
      let code = '';
      for (let i = 0; i < ROOM_CODE_LENGTH; i++) code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
      if (!this.rooms.has(code)) return code;
    }
  }

  private roomInfo(room: Room): RoomInfo {
    return {
      code: room.code,
      names: { p1: room.seats.p1?.name ?? null, p2: room.seats.p2?.name ?? null },
      left: { p1: Boolean(room.seats.p1?.left), p2: Boolean(room.seats.p2?.left) },
      settings: room.settings,
      white: room.white,
      status: room.state ? 'playing' : 'waiting',
    };
  }

  private presence(room: Room): Presence {
    const seated = new Set([...(this.byRoom.get(room.code) ?? [])].map((c) => this.seats.get(c)?.seat));
    return { p1: seated.has('p1'), p2: seated.has('p2') };
  }

  private broadcast(room: Room, msg: ServerMessage, except?: Connection): void {
    for (const c of this.byRoom.get(room.code) ?? []) if (c !== except) c.send(msg);
  }

  private broadcastPresence(room: Room, except?: Connection): void {
    this.broadcast(room, { type: 'presence', presence: this.presence(room), room: this.roomInfo(room) }, except);
  }

  /** Unseats a connection; returns the room it was in. */
  private detach(conn: Connection): Room | null {
    const seat = this.seats.get(conn);
    if (!seat) return null;
    this.seats.delete(conn);
    const set = this.byRoom.get(seat.code);
    set?.delete(conn);
    if (set && !set.size) this.byRoom.delete(seat.code);
    return this.rooms.get(seat.code) ?? null;
  }

  /** Seats a connection, replacing any older tab that held the same seat. */
  private attach(conn: Connection, room: Room, seat: PlayerId, token: string): void {
    const previous = this.detach(conn);
    if (previous && previous !== room) this.broadcastPresence(previous);
    for (const other of [...(this.byRoom.get(room.code) ?? [])]) {
      if (this.seats.get(other)?.seat !== seat) continue;
      this.detach(other);
      other.send({ type: 'error', code: 'replaced', error: 'This game was opened somewhere else.' });
      other.close(4000, 'replaced');
    }
    this.seats.set(conn, { code: room.code, seat });
    if (!this.byRoom.has(room.code)) this.byRoom.set(room.code, new Set());
    this.byRoom.get(room.code)!.add(conn);
    conn.send({
      type: 'welcome',
      you: seat,
      token,
      room: this.roomInfo(room),
      view: room.state ? toView(room.state) : null,
      presence: this.presence(room),
    });
    this.broadcastPresence(room, conn);
  }

  private touch(room: Room): void {
    room.updatedAt = this.now();
    this.store.save(room);
  }

  private deleteRoom(room: Room, why: string): void {
    this.rooms.delete(room.code);
    this.store.remove(room.code);
    this.log(`room ${room.code} ${why}`);
  }

  private create(conn: Connection, msg: Extract<ClientMessage, { type: 'create' }>): void {
    const settings = cleanSettings(msg.settings);
    if (!settings || !['host', 'guest', 'random'].includes(msg.white)) return this.fail(conn, 'bad_request', 'Those game settings aren’t valid.');
    const bucket = ipBucket(conn.ip);
    if (this.creations.blocked(bucket)) return this.fail(conn, 'rate_limited', 'Lots of games are being created right now. Wait a bit and try again.');
    if (this.rooms.size >= this.maxRooms) return this.fail(conn, 'server_full', 'The server is full right now. Try again later.');
    this.creations.hit(bucket);
    const token = randomBytes(32).toString('base64url');
    const now = this.now();
    const room: Room = {
      code: this.newCode(),
      createdAt: now,
      updatedAt: now,
      settings,
      white: msg.white,
      seats: { p1: { name: cleanName(msg.name, 'Player 1'), tokenHash: hashToken(token) }, p2: null },
      state: null,
    };
    this.rooms.set(room.code, room);
    this.store.save(room);
    this.log(`room ${room.code} created`);
    this.attach(conn, room, 'p1', token);
  }

  private peek(conn: Connection, code: unknown): void {
    if (this.admissionBlocked(conn)) return;
    const room = this.lookup(conn, code);
    if (room) conn.send({ type: 'room', room: this.roomInfo(room) });
  }

  private join(conn: Connection, code: unknown, name: unknown): void {
    if (this.admissionBlocked(conn)) return;
    const room = this.lookup(conn, code);
    if (!room) return;
    if (room.seats.p2) return this.fail(conn, 'room_full', 'Two players are already in this game.');
    const token = randomBytes(32).toString('base64url');
    const guestName = cleanName(name, 'Player 2');
    room.seats.p2 = { name: guestName === room.seats.p1!.name ? `${guestName} (2)` : guestName, tokenHash: hashToken(token) };
    room.state = this.newGame(room, room.white === 'guest' ? 'p2' : room.white === 'host' ? 'p1' : randomInt(2) ? 'p1' : 'p2');
    this.touch(room);
    this.log(`room ${room.code} joined`);
    this.broadcast(room, { type: 'state', view: toView(room.state), events: [] });
    this.attach(conn, room, 'p2', token);
  }

  private resume(conn: Connection, code: unknown, token: unknown): void {
    if (this.admissionBlocked(conn)) return;
    const room = this.lookup(conn, code);
    if (!room) return;
    const seat = PLAYER_IDS.find((p) => {
      const s = room.seats[p];
      return s !== null && tokenMatches(token, s.tokenHash);
    });
    if (!seat) {
      this.failures.hit(ipBucket(conn.ip));
      return this.fail(conn, 'bad_token', 'This browser isn’t a player in that game.');
    }
    this.attach(conn, room, seat, token as string);
  }

  private seatOf(conn: Connection): { room: Room; seat: PlayerId } | null {
    const s = this.seats.get(conn);
    const room = s && this.rooms.get(s.code);
    return room && isPlayerId(s.seat) ? { room, seat: s.seat } : null;
  }

  private act(conn: Connection, msg: Extract<ClientMessage, { type: 'action' }>): void {
    const id = Number.isInteger(msg.id) ? msg.id : -1;
    const seated = this.seatOf(conn);
    if (!seated) return this.fail(conn, 'bad_request', 'Join a game first.');
    const { room, seat } = seated;
    const reject = (error: string) => conn.send({ type: 'rejected', id, error });
    if (!room.state) return reject('Waiting for your opponent to join.');
    if (msg.seq !== room.state.seq) return reject('The game changed before that arrived. Try again.');
    try {
      const { state, events } = applyAction(room.state, seat, msg.action);
      room.state = state;
      this.touch(room);
      conn.send({ type: 'ack', id });
      this.broadcast(room, { type: 'state', view: toView(state), events });
    } catch (err) {
      if (err instanceof GameError) return reject(err.message);
      this.log(`room ${room.code}: unexpected error ${(err as Error).stack ?? err}`);
      reject('Something went wrong on the server.');
    }
  }

  private newGame(room: Room, whitePlayer: PlayerId): GameState {
    return createGame({
      names: { p1: room.seats.p1!.name, p2: room.seats.p2!.name },
      whitePlayer,
      settings: room.settings,
      seed: randomInt(2 ** 31),
    });
  }

  private rematch(conn: Connection): void {
    const seated = this.seatOf(conn);
    if (!seated?.room.state || seated.room.state.phase.kind !== 'over') {
      return this.fail(conn, 'bad_request', 'A rematch can start once the game is over.');
    }
    const { room } = seated;
    const presence = this.presence(room);
    if (PLAYER_IDS.some((p) => room.seats[p]?.left || !presence[p])) {
      return this.fail(conn, 'bad_request', 'Your opponent isn’t here for a rematch.');
    }
    room.state = this.newGame(room, otherPlayer(startingWhite(room.state!)));
    this.touch(room);
    this.log(`room ${room.code} rematch`);
    this.broadcast(room, { type: 'state', view: toView(room.state), events: [] });
  }

  private leave(conn: Connection): void {
    const seated = this.seatOf(conn);
    if (!seated) return;
    const { room, seat } = seated;
    this.detach(conn);
    if (!room.state) return this.deleteRoom(room, 'cancelled by host');
    room.seats[seat] = { ...room.seats[seat]!, tokenHash: '', left: true };
    if (room.state.phase.kind !== 'over') {
      const { state, events } = applyAction(room.state, seat, { type: 'resign' });
      room.state = state;
      this.broadcast(room, { type: 'state', view: toView(state), events });
    }
    this.touch(room);
    this.log(`room ${room.code}: ${seat} left`);
    this.broadcastPresence(room);
  }
}
