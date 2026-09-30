import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { Action, GameView } from '../src/engine/game.ts';
import type { ClientMessage, ServerMessage } from '../src/net/protocol.ts';
import { startServer, type RunningServer } from '../server/main.ts';

const ORIGIN = 'http://127.0.0.1:5173';
let dataDir: string;
let server: RunningServer;
const sockets: WebSocket[] = [];

async function boot(): Promise<void> {
  server = await startServer({ port: 0, bind: '127.0.0.1', dataDir, origins: [ORIGIN], log: () => {} });
}

beforeEach(async () => {
  dataDir = mkdtempSync(path.join(os.tmpdir(), 'uno-chess-test-'));
  await boot();
});

afterEach(async () => {
  sockets.forEach((s) => s.terminate());
  sockets.length = 0;
  await server.close();
  rmSync(dataDir, { recursive: true, force: true });
});

/** A test client that queues every server message so tests can await them in order. */
class Client {
  private queue: ServerMessage[] = [];
  private waiters: ((m: ServerMessage) => void)[] = [];
  readonly ws: WebSocket;
  closed: Promise<number>;

  constructor(origin: string | undefined = ORIGIN) {
    this.ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`, origin ? { origin } : {});
    sockets.push(this.ws);
    this.ws.on('message', (data) => {
      const msg = JSON.parse(data.toString()) as ServerMessage;
      const waiter = this.waiters.shift();
      if (waiter) waiter(msg);
      else this.queue.push(msg);
    });
    this.closed = new Promise((resolve) => this.ws.on('close', (code) => resolve(code)));
  }

  open(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws.once('open', () => resolve());
      this.ws.once('error', reject);
    });
  }

  send(msg: ClientMessage | Record<string, unknown>): void {
    this.ws.send(JSON.stringify(msg));
  }

  next(): Promise<ServerMessage> {
    const queued = this.queue.shift();
    if (queued) return Promise.resolve(queued);
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  async expect<T extends ServerMessage['type']>(type: T): Promise<Extract<ServerMessage, { type: T }>> {
    const msg = await this.next();
    expect(msg.type, JSON.stringify(msg)).toBe(type);
    return msg as Extract<ServerMessage, { type: T }>;
  }
}

async function connect(origin?: string): Promise<Client> {
  const c = new Client(origin);
  await c.open();
  return c;
}

const settings = { moveCap: 3, allowEarlyEnd: true };

async function startGame() {
  const host = await connect();
  host.send({ type: 'create', name: 'Ana', settings, white: 'host' });
  const hostWelcome = await host.expect('welcome');
  const guest = await connect();
  guest.send({ type: 'join', code: hostWelcome.room.code.toLowerCase(), name: 'Bo' });
  const hostState = await host.expect('state');
  await host.expect('presence');
  const guestWelcome = await guest.expect('welcome');
  return { host, guest, hostWelcome, guestWelcome, code: hostWelcome.room.code, view: hostState.view };
}

let actionId = 0;
async function act(c: Client, view: GameView, action: Action): Promise<GameView> {
  const id = ++actionId;
  c.send({ type: 'action', id, seq: view.seq, action });
  expect(await c.expect('ack')).toEqual({ type: 'ack', id });
  return (await c.expect('state')).view;
}

describe('game server', () => {
  it('serves a health check', async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/healthz`);
    expect(await res.json()).toEqual({ ok: true, rooms: 0, connections: 0 });
  });

  it('creates a room, lets a guest join, and syncs actions to both players', async () => {
    const { host, guest, hostWelcome, guestWelcome, view } = await startGame();
    expect(hostWelcome).toMatchObject({ you: 'p1', view: null, room: { status: 'waiting', names: { p1: 'Ana', p2: null } } });
    expect(guestWelcome).toMatchObject({ you: 'p2', room: { status: 'playing', names: { p1: 'Ana', p2: 'Bo' } }, presence: { p1: true, p2: true } });
    expect(view.armies).toEqual({ w: 'p1', b: 'p2' });
    expect(view).not.toHaveProperty('drawPile');
    expect(view).not.toHaveProperty('rng');

    const afterDraw = await act(host, view, { type: 'draw' });
    const guestSees = await guest.expect('state');
    expect(guestSees.view).toEqual(afterDraw);
    expect(guestSees.events[0]).toMatchObject({ type: 'cardDrawn', player: 'p1' });
  });

  it('rejects actions out of turn, against stale state, or malformed', async () => {
    const { host, guest, view } = await startGame();
    guest.send({ type: 'action', id: 1, seq: view.seq, action: { type: 'draw' } });
    expect(await guest.expect('rejected')).toMatchObject({ id: 1, error: expect.stringMatching(/turn/) });
    host.send({ type: 'action', id: 2, seq: view.seq + 5, action: { type: 'draw' } });
    expect(await host.expect('rejected')).toMatchObject({ id: 2, error: expect.stringMatching(/changed/) });
    host.send({ type: 'action', id: 3, seq: view.seq, action: { type: 'drop', piece: 'k', to: 'x' } });
    expect(await host.expect('rejected')).toMatchObject({ id: 3 });
    host.send({ nonsense: true });
    expect(await host.expect('error')).toMatchObject({ code: 'bad_request' });
  });

  it('lets a player resume with their token, and rejects anyone else', async () => {
    const { hostWelcome, code, host, guest } = await startGame();
    host.ws.close();
    expect(await guest.expect('presence')).toMatchObject({ presence: { p1: false, p2: true } });

    const back = await connect();
    back.send({ type: 'resume', code, token: hostWelcome.token });
    expect(await back.expect('welcome')).toMatchObject({ you: 'p1', presence: { p1: true, p2: true } });
    expect(await guest.expect('presence')).toMatchObject({ presence: { p1: true, p2: true } });

    const imposter = await connect();
    imposter.send({ type: 'resume', code, token: 'not-a-real-token' });
    expect(await imposter.expect('error')).toMatchObject({ code: 'bad_token' });
    imposter.send({ type: 'join', code, name: 'Cy' });
    expect(await imposter.expect('error')).toMatchObject({ code: 'room_full' });
  });

  it('boots the older tab when the same seat connects twice', async () => {
    const { hostWelcome, code, host } = await startGame();
    const second = await connect();
    second.send({ type: 'resume', code, token: hostWelcome.token });
    await second.expect('welcome');
    expect(await host.expect('error')).toMatchObject({ code: 'replaced' });
    expect(await host.closed).toBe(4000);
  });

  it('keeps games across a restart', async () => {
    const { host, view, code, guestWelcome } = await startGame();
    const afterDraw = await act(host, view, { type: 'draw' });
    await server.close();
    expect(readdirSync(path.join(dataDir, 'rooms'))).toEqual([`${code}.json`]);
    await boot();
    const guest = await connect();
    guest.send({ type: 'resume', code, token: guestWelcome.token });
    expect((await guest.expect('welcome')).view).toEqual(afterDraw);
  });

  it('reports unknown codes and rate-limits guessing', async () => {
    const c = await connect();
    c.send({ type: 'peek', code: 'ZZZZZZ' });
    expect(await c.expect('error')).toMatchObject({ code: 'not_found' });
    for (let i = 0; i < 25; i++) c.send({ type: 'join', code: `NOPE${i}`, name: 'x' });
    const codes = new Set<string>();
    for (let i = 0; i < 25; i++) codes.add(((await c.expect('error')) as { code: string }).code);
    expect(codes).toContain('rate_limited');
  });

  it('refuses WebSocket upgrades from other sites', async () => {
    const evil = new Client('https://evil.example');
    await expect(evil.open()).rejects.toThrow(/403/);
  });

  it('starts a rematch with colors swapped once the game is over', async () => {
    const { host, guest, view } = await startGame();
    host.send({ type: 'rematch' });
    expect(await host.expect('error')).toMatchObject({ code: 'bad_request' });
    guest.send({ type: 'action', id: 99, seq: view.seq, action: { type: 'resign' } });
    await guest.expect('ack');
    const over = (await guest.expect('state')).view;
    expect(over.result).toMatchObject({ winner: 'p1', reason: 'resignation' });
    await host.expect('state');
    host.send({ type: 'rematch' });
    const fresh = (await host.expect('state')).view;
    expect(fresh.armies).toEqual({ w: 'p2', b: 'p1' });
    expect(fresh.result).toBeNull();
  });
});
