#!/usr/bin/env node
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { WebSocketServer, type WebSocket } from 'ws';
import type { ServerMessage } from '../src/net/protocol.ts';
import { RoomManager, type Connection } from './rooms.ts';
import { FileRoomStore } from './store.ts';

const DEFAULT_ORIGINS = ['https://bicyclespokesperson.github.io', 'http://127.0.0.1:5173', 'http://localhost:5173'];
const MAX_MESSAGE_BYTES = 16 * 1024;
const HEARTBEAT_MS = 25_000;
/** Token bucket per connection: sustained messages per second, and burst size. */
const RATE_PER_SEC = 10;
const RATE_BURST = 40;

export interface ServerOptions {
  port: number;
  bind: string;
  dataDir: string;
  origins: string[];
  log?: (msg: string) => void;
}

export interface RunningServer {
  port: number;
  close(): Promise<void>;
}

function clientIp(req: http.IncomingMessage): string {
  const direct = req.socket.remoteAddress ?? 'unknown';
  const forwarded = req.headers['x-forwarded-for'];
  const isLoopback = direct === '127.0.0.1' || direct === '::1' || direct === '::ffff:127.0.0.1';
  // Behind Caddy the rightmost entry is the address Caddy itself saw; earlier entries are client-supplied.
  if (isLoopback && typeof forwarded === 'string') return forwarded.split(',').at(-1)!.trim();
  return direct;
}

export function startServer(opts: ServerOptions): Promise<RunningServer> {
  const log = opts.log ?? ((msg: string) => console.log(`${new Date().toISOString()} ${msg}`));
  const store = new FileRoomStore(opts.dataDir, { log });
  const manager = new RoomManager(store, { log });
  const origins = new Set(opts.origins);

  const httpServer = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/healthz') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ ok: true, ...manager.stats() }));
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Uno Chess game server. Play at https://bicyclespokesperson.github.io/uno_chess/\n');
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
  const alive = new WeakMap<WebSocket, boolean>();

  httpServer.on('upgrade', (req, socket, head) => {
    const origin = req.headers.origin;
    const pathname = new URL(req.url ?? '/', 'http://x').pathname;
    if (pathname !== '/ws' || (origin !== undefined && !origins.has(origin))) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  wss.on('connection', (ws: WebSocket, req: http.IncomingMessage) => {
    const conn: Connection = {
      ip: clientIp(req),
      send: (msg: ServerMessage) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(msg)),
      close: (code, reason) => ws.close(code, reason),
    };
    alive.set(ws, true);
    let tokens = RATE_BURST;
    let refilledAt = Date.now();

    ws.on('pong', () => alive.set(ws, true));
    ws.on('message', (data, isBinary) => {
      const now = Date.now();
      tokens = Math.min(RATE_BURST, tokens + ((now - refilledAt) / 1000) * RATE_PER_SEC);
      refilledAt = now;
      if (--tokens < 0) return ws.close(1008, 'too many messages');
      let msg: unknown;
      try {
        msg = isBinary ? null : JSON.parse(data.toString());
      } catch {
        msg = null;
      }
      manager.handle(conn, msg);
    });
    ws.on('close', () => manager.disconnect(conn));
    ws.on('error', (err) => log(`socket error from ${conn.ip}: ${err.message}`));
  });

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!alive.get(ws)) {
        ws.terminate();
        continue;
      }
      alive.set(ws, false);
      ws.ping();
    }
  }, HEARTBEAT_MS);
  const sweeper = setInterval(() => manager.sweep(), 60 * 60 * 1000);

  const close = () =>
    new Promise<void>((resolve) => {
      clearInterval(heartbeat);
      clearInterval(sweeper);
      for (const ws of wss.clients) ws.close(1012, 'server restarting');
      store.flush();
      wss.close();
      httpServer.close(() => resolve());
      httpServer.closeAllConnections();
    });

  return new Promise((resolve) => {
    httpServer.listen(opts.port, opts.bind, () => {
      const address = httpServer.address();
      const port = typeof address === 'object' && address ? address.port : opts.port;
      log(`listening on ${opts.bind}:${port}, data in ${opts.dataDir}, ${manager.stats().rooms} rooms loaded`);
      resolve({ port, close });
    });
  });
}

function main(): void {
  const { values } = parseArgs({
    options: {
      port: { type: 'string', default: '7879' },
      bind: { type: 'string', default: '127.0.0.1' },
      'data-dir': { type: 'string', default: path.join(os.homedir(), '.local/share/uno-chess') },
      origin: { type: 'string', multiple: true },
    },
  });
  void startServer({
    port: Number(values.port),
    bind: values.bind!,
    dataDir: values['data-dir']!,
    origins: values.origin?.length ? values.origin : DEFAULT_ORIGINS,
  }).then((server) => {
    const shutdown = (signal: string) => {
      console.log(`${new Date().toISOString()} ${signal}: saving and shutting down`);
      void server.close().then(() => process.exit(0));
    };
    process.once('SIGTERM', () => shutdown('SIGTERM'));
    process.once('SIGINT', () => shutdown('SIGINT'));
  });
}

if (import.meta.url === `file://${process.argv[1]}`) main();
