#!/usr/bin/env node
/**
 * Plays one online seat from the terminal, e.g. so an agent (or a patient human) can play without a browser.
 *
 *   npm run play -- CODE --name Claude     join a game (or resume it, if this directory holds a token for it)
 *   npm run play -- new --name Claude      create a game and print its code
 *
 * Runs until killed. On every update it rewrites <dir>/status.txt: the board from your side, the card, whose
 * turn it is, and your legal moves or drops. Send commands by appending lines to <dir>/cmd.txt:
 *
 *   draw | move <SAN or e2e4[q]> | drop <p|n|b|r|q> <square> | wild <1-9|skip|reverse|draw>
 *   end | resign | offer | answer yes|no | rematch | leave
 *
 * To wait for your turn, watch status.txt for `phase={"kind":"draw"} <<< YOUR MOVE`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import WebSocket from 'ws';
import { cardLabel, type Effect } from '../src/engine/cards.ts';
import { inCheck, legalMoves, moveToSan, parseSquare, squareName, toFen, type Color, type DroppableType, type Move, type Position } from '../src/engine/chess.ts';
import { droppableTypes, dropSquares, otherPlayer, type Action, type GameEvent, type GameView, type PlayerId } from '../src/engine/game.ts';
import type { ClientMessage, Presence, ServerMessage } from '../src/net/protocol.ts';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    name: { type: 'string', default: 'CLI player' },
    server: { type: 'string', default: 'wss://unochess.jeremysigrist.com/ws' },
    dir: { type: 'string' },
    'move-cap': { type: 'string', default: '3' },
  },
});
const target = positionals[0];
if (!target) {
  console.error('usage: npm run play -- <CODE|new> [--name NAME] [--server URL] [--dir DIR] [--move-cap N]');
  process.exit(2);
}

let code = target === 'new' ? null : target.toUpperCase();
const dir = path.resolve(values.dir ?? path.join('.play', code ?? 'new'));
fs.mkdirSync(dir, { recursive: true });
const statusFile = path.join(dir, 'status.txt');
const cmdFile = path.join(dir, 'cmd.txt');
const tokenFile = path.join(dir, 'token.json');

let ws: WebSocket | null = null;
let view: GameView | null = null;
let you: PlayerId | null = null;
let presence: Presence | null = null;
let nextId = 1;
const log: string[] = [];

function note(line: string): void {
  log.push(`${new Date().toLocaleTimeString()} ${line}`);
  if (log.length > 25) log.shift();
}

function boardAscii(pos: Position, whiteBottom: boolean): string {
  const rows: string[] = [];
  for (let r = 0; r < 8; r++) {
    const rank = whiteBottom ? 7 - r : r;
    let line = `${rank + 1} `;
    for (let f = 0; f < 8; f++) {
      const p = pos.board[rank * 8 + (whiteBottom ? f : 7 - f)];
      line += (p ? (p.color === 'w' ? p.type.toUpperCase() : p.type) : '.') + ' ';
    }
    rows.push(line);
  }
  rows.push('  ' + (whiteBottom ? 'a b c d e f g h' : 'h g f e d c b a'));
  return rows.join('\n');
}

function describeEvent(e: GameEvent, v: GameView): string {
  switch (e.type) {
    case 'cardDrawn': return `cardDrawn(${cardLabel(e.card)} by ${v.players[e.player].name})`;
    case 'moved':
    case 'dropped': return `${e.type}(${e.san})`;
    case 'turnEnded': return `turnEnded(${e.reason})`;
    default: return e.type;
  }
}

function render(): void {
  const out: string[] = [];
  if (code) out.push(`game ${code}`);
  if (!view || !you) {
    out.push(`waiting for an opponent to join… you=${you ?? '?'}`, ...log);
    fs.writeFileSync(statusFile, out.join('\n') + '\n');
    return;
  }
  const myColor: Color = view.armies.w === you ? 'w' : 'b';
  const turnPlayer = view.armies[view.turn];
  const mine = turnPlayer === you && view.phase.kind !== 'over';
  const top = view.discard.at(-1);
  out.push(`seq=${view.seq} you=${you} (${view.players[you].name}) playing ${myColor === 'w' ? 'WHITE' : 'BLACK'} | opponent online: ${presence?.[otherPlayer(you)] ?? '?'}`);
  out.push(`turn: ${view.turn === 'w' ? 'White' : 'Black'} (${view.players[turnPlayer].name}) phase=${JSON.stringify(view.phase)}${mine ? ' <<< YOUR MOVE' : ''}`);
  out.push(`top card: ${top ? cardLabel(top) : '-'}  deck=${view.drawPileCount}  drawOffer=${view.drawOffer}  moveCap=${view.settings.moveCap}`);
  if (view.result) out.push(`RESULT: ${JSON.stringify(view.result)}`);
  out.push(`pockets: white=[${view.pockets.w.join(',')}] black=[${view.pockets.b.join(',')}]`);
  out.push(`in check: white=${inCheck(view.position, 'w')} black=${inCheck(view.position, 'b')}`);
  out.push(boardAscii(view.position, myColor === 'w'));
  out.push(`FEN: ${toFen(view.position, view.turn)}`);
  if (mine && view.phase.kind === 'act') {
    if (view.phase.plan.kind === 'moves') {
      const sans = legalMoves(view.position, view.turn).map((m) => moveToSan(view!.position, view!.turn, m));
      out.push(`legal (${sans.length}): ${sans.join(' ')}`);
    } else {
      for (const t of droppableTypes(view)) out.push(`drop ${t}: ${dropSquares(view, t).map(squareName).join(' ')}`);
    }
  }
  out.push('--- history (last 8) ---');
  for (const r of view.history.slice(-8)) {
    const wild = r.card.kind === 'wild' && r.effect ? ` as ${JSON.stringify(r.effect)}` : '';
    out.push(`${r.n}. ${view.players[r.player].name}(${r.color}) ${cardLabel(r.card)}${wild}: ${r.actions.join(' ')}${r.notes.length ? ` [${r.notes.join(',')}]` : ''}`);
  }
  out.push('--- log ---', ...log);
  fs.writeFileSync(statusFile, out.join('\n') + '\n');
}

function send(msg: ClientMessage): void {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function act(action: Action): void {
  if (!view) return note('!! no game yet');
  send({ type: 'action', id: nextId++, seq: view.seq, action });
}

function parseMove(arg: string): Move | undefined {
  if (!view) return undefined;
  const { position, turn } = view;
  const legal = legalMoves(position, turn);
  const coords = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/.exec(arg);
  if (coords) {
    const [from, to] = [parseSquare(coords[1]), parseSquare(coords[2])];
    const promotion = coords[3] ?? 'q';
    return legal.find((m) => m.from === from && m.to === to && (!m.promotion || m.promotion === promotion));
  }
  const bare = (s: string) => s.replace(/[+#!?]/g, '');
  return legal.find((m) => bare(moveToSan(position, turn, m)) === bare(arg));
}

function wildEffect(arg: string | undefined): Effect | null {
  if (arg && /^\d$/.test(arg)) return { kind: 'number', value: Number(arg) };
  if (arg === 'skip' || arg === 'reverse') return { kind: arg };
  if (arg === 'draw') return { kind: 'draw', count: 2 };
  return null;
}

function command(line: string): void {
  const [cmd, a, b] = line.trim().split(/\s+/);
  if (!cmd) return;
  note(`> ${line.trim()}`);
  switch (cmd) {
    case 'draw': return act({ type: 'draw' });
    case 'end': return act({ type: 'endTurn' });
    case 'resign': return act({ type: 'resign' });
    case 'offer': return act({ type: 'offerDraw' });
    case 'answer': return act({ type: 'answerDraw', accept: a === 'yes' });
    case 'rematch': return send({ type: 'rematch' });
    case 'leave':
      send({ type: 'leave' });
      fs.rmSync(tokenFile, { force: true });
      note('left the game');
      render();
      return void setTimeout(() => process.exit(0), 300);
    case 'wild': {
      const effect = wildEffect(a);
      return effect ? act({ type: 'chooseWild', effect }) : note(`!! wild needs 1-9, skip, reverse or draw`);
    }
    case 'move': {
      const move = a ? parseMove(a) : undefined;
      return move ? act({ type: 'move', move }) : (note(`!! not a legal move right now: ${a}`), render());
    }
    case 'drop':
      if (!a || !b) return note('!! usage: drop <piece> <square>');
      return act({ type: 'drop', piece: a.toLowerCase() as DroppableType, to: parseSquare(b) });
    default:
      note(`!! unknown command ${cmd}`);
      render();
  }
}

function watchCommands(): void {
  fs.writeFileSync(cmdFile, '');
  let offset = 0;
  setInterval(() => {
    const text = fs.readFileSync(cmdFile, 'utf8');
    const complete = text.lastIndexOf('\n') + 1;
    if (complete <= offset) return;
    text.slice(offset, complete).split('\n').forEach(command);
    offset = complete;
  }, 200);
}

function hello(): ClientMessage {
  const saved = fs.existsSync(tokenFile) ? (JSON.parse(fs.readFileSync(tokenFile, 'utf8')) as { code: string; token: string }) : null;
  if (saved && (!code || saved.code === code)) {
    code = saved.code;
    return { type: 'resume', code: saved.code, token: saved.token };
  }
  if (code) return { type: 'join', code, name: values.name! };
  return { type: 'create', name: values.name!, settings: { moveCap: Number(values['move-cap']), allowEarlyEnd: true }, white: 'random' };
}

function receive(msg: ServerMessage): void {
  switch (msg.type) {
    case 'welcome':
      you = msg.you;
      code = msg.room.code;
      presence = msg.presence;
      view = msg.view ?? view;
      fs.writeFileSync(tokenFile, JSON.stringify({ code, token: msg.token }), { mode: 0o600 });
      note(`seated as ${you} in ${code}`);
      if (!msg.view) console.log(`Created game ${code}. Share: ${values.server!.replace(/^ws/, 'http').replace(/\/ws$/, '')}/#join=${code}`);
      break;
    case 'state':
      view = msg.view;
      if (msg.events.length) note(`events: ${msg.events.map((e) => describeEvent(e, msg.view)).join(', ')}`);
      break;
    case 'presence':
      presence = msg.presence;
      break;
    case 'rejected':
      note(`!! rejected: ${msg.error}`);
      break;
    case 'error':
      note(`!! ${msg.code}: ${msg.error}`);
      if (msg.code === 'bad_token' || msg.code === 'not_found' || msg.code === 'room_full') {
        render();
        console.error(msg.error);
        process.exit(1);
      }
      break;
    default:
      break;
  }
  render();
}

function connect(): void {
  ws = new WebSocket(values.server!);
  ws.on('open', () => send(hello()));
  ws.on('message', (data) => receive(JSON.parse(String(data)) as ServerMessage));
  ws.on('close', () => {
    note('connection closed; reconnecting in 2s');
    render();
    setTimeout(connect, 2000);
  });
  ws.on('error', (err) => note(`socket error: ${err.message}`));
}

console.log(`status: ${statusFile}\ncommands: append lines to ${cmdFile}`);
watchCommands();
connect();
render();
