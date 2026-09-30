import { describe, expect, it } from 'vitest';
import { fromFen, legalMoves, parseSquare as sq, type DroppableType } from '../src/engine/chess.ts';
import type { Card } from '../src/engine/cards.ts';
import {
  applyAction,
  createGame,
  currentPlayer,
  dropSquares,
  droppableTypes,
  GameError,
  wildOptions,
  type Action,
  type GameState,
  type Settings,
} from '../src/engine/game.ts';

let cardId = 1000;
const num = (value: number): Card => ({ id: cardId++, kind: 'number', color: 'red', value });
const special = (kind: 'skip' | 'reverse' | 'draw2'): Card => ({ id: cardId++, kind, color: 'blue' });
const wild = (kind: 'wild' | 'wild4'): Card => ({ id: cardId++, kind });

/** Builds a game whose deck will deal `cards` in order (first element first). */
function rigged(cards: Card[], opts: { fen?: string; settings?: Partial<Settings>; pockets?: GameState['pockets'] } = {}): GameState {
  const s = createGame({ names: { p1: 'Ana', p2: 'Bo' }, whitePlayer: 'p1', seed: 42, settings: opts.settings });
  s.drawPile = cards.slice().reverse();
  if (opts.fen) s.position = fromFen(opts.fen).position;
  if (opts.pockets) s.pockets = opts.pockets;
  return s;
}

function play(s: GameState, ...actions: Action[]) {
  let state = s;
  const events = [];
  for (const action of actions) {
    const outcome = applyAction(state, currentPlayer(state), action);
    state = outcome.state;
    events.push(...outcome.events);
  }
  return { state, events };
}

const mv = (from: string, to: string, promotion?: 'q' | 'r' | 'b' | 'n'): Action => ({
  type: 'move',
  move: { from: sq(from), to: sq(to), promotion },
});
const drop = (piece: DroppableType, to: string): Action => ({ type: 'drop', piece, to: sq(to) });
const draw: Action = { type: 'draw' };

describe('number cards', () => {
  it('gives that many consecutive moves, then passes the turn', () => {
    const { state } = play(rigged([num(2), num(1)]), draw, mv('e2', 'e4'), mv('g1', 'f3'));
    expect(state.turn).toBe('b');
    expect(state.phase).toEqual({ kind: 'draw' });
    expect(state.history[0].actions).toEqual(['e4', 'Nf3']);
  });

  it('caps big numbers at the move cap', () => {
    const { state } = play(rigged([num(9)], { settings: { moveCap: 3 } }), draw);
    expect(state.phase).toEqual({ kind: 'act', plan: { kind: 'moves', total: 3, remaining: 3 } });
    expect(state.history[0].notes).toContain('capped');
  });

  it('treats 0 as a pass', () => {
    const { state, events } = play(rigged([num(0)]), draw);
    expect(state.turn).toBe('b');
    expect(events).toContainEqual({ type: 'turnEnded', reason: 'zero', next: 'p2' });
  });

  it('gives one escape move for a 0 while in check', () => {
    const { state } = play(rigged([num(0)], { fen: '4k3/8/8/8/8/8/8/r3K3 w - - 0 1' }), draw);
    expect(state.phase).toEqual({ kind: 'act', plan: { kind: 'moves', total: 1, remaining: 1 } });
    expect(state.history[0].notes).toContain('zeroInCheck');
  });

  it('ends the turn as soon as you give check', () => {
    const fen = '4k3/8/8/8/8/8/8/R3K3 w - - 0 1';
    const { state, events } = play(rigged([num(3)], { fen }), draw, mv('a1', 'a8'));
    expect(state.turn).toBe('b');
    expect(state.history[0].notes).toContain('checkEndsTurn');
    expect(events).toContainEqual({ type: 'turnEnded', reason: 'check', next: 'p2' });
  });

  it('detects checkmate immediately, even mid-turn', () => {
    const fen = '6k1/5ppp/8/8/8/8/8/R3K3 w - - 0 1';
    const { state } = play(rigged([num(3)], { fen }), draw, mv('a1', 'a8'));
    expect(state.phase.kind).toBe('over');
    expect(state.result).toEqual({ winner: 'p1', winningColor: 'w', reason: 'checkmate' });
  });

  it('rejects out-of-turn and illegal actions without changing state', () => {
    const s = play(rigged([num(1)]), draw).state;
    expect(() => applyAction(s, 'p2', mv('e7', 'e5'))).toThrow(GameError);
    expect(() => applyAction(s, 'p1', mv('e2', 'e5'))).toThrow(/legal/);
    expect(() => applyAction(s, 'p1', draw)).toThrow(GameError);
    expect(s.seq).toBe(1);
  });

  it('ends a turn early only after at least one move', () => {
    const s = play(rigged([num(3)]), draw).state;
    expect(() => applyAction(s, 'p1', { type: 'endTurn' })).toThrow(/at least one/);
    const { state } = play(s, mv('e2', 'e4'), { type: 'endTurn' });
    expect(state.turn).toBe('b');
    expect(state.history[0].notes).toContain('endedEarly');
    const strict = play(rigged([num(3)], { settings: { allowEarlyEnd: false } }), draw, mv('e2', 'e4')).state;
    expect(() => applyAction(strict, 'p1', { type: 'endTurn' })).toThrow(/turned off/);
  });

  it('ends the turn when the mover runs out of legal moves mid-turn', () => {
    // After e3 the pawn is blocked and the king's only squares are covered by the g8 rook: no moves, no check.
    const fen = '3k2r1/8/8/8/4p3/7p/4P2P/7K w - - 0 1';
    const { state, events } = play(rigged([num(3)], { fen }), draw, mv('e2', 'e3'));
    expect(state.turn).toBe('b');
    expect(state.result).toBeNull();
    expect(state.history[0].notes).toContain('noMovesLeft');
    expect(events).toContainEqual({ type: 'turnEnded', reason: 'noMoves', next: 'p2' });
  });

  it('declares stalemate when a player must move and cannot', () => {
    const fen = '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1';
    const s = rigged([num(1)], { fen });
    s.turn = 'b';
    const { state } = play(s, draw);
    expect(state.result).toEqual({ winner: null, winningColor: null, reason: 'stalemate' });
  });
});

describe('skip and reverse', () => {
  it('skip lets the same player flip again', () => {
    const { state, events } = play(rigged([special('skip'), num(1)]), draw);
    expect(currentPlayer(state)).toBe('p1');
    expect(state.phase).toEqual({ kind: 'draw' });
    expect(events).toContainEqual({ type: 'skip', player: 'p1' });
  });

  it('reverse swaps armies and hands the same colour’s turn to the other player', () => {
    const { state } = play(rigged([special('reverse'), num(1)]), draw);
    expect(state.armies).toEqual({ w: 'p2', b: 'p1' });
    expect(state.turn).toBe('w');
    expect(currentPlayer(state)).toBe('p2');
    const next = play(state, draw, mv('e2', 'e4')).state;
    expect(next.history[1]).toMatchObject({ player: 'p2', color: 'w', actions: ['e4'] });
    expect(currentPlayer(next)).toBe('p1');
  });
});

describe('draw cards and drops', () => {
  const emptyish = '4k3/8/8/8/8/8/8/4K3 w - - 0 1';

  it('captured pieces go to their own colour’s pocket; promoted ones return as pawns', () => {
    const fen = '4k3/8/8/8/8/8/1q6/Q3K3 w - - 0 1';
    const s = rigged([num(1)], { fen });
    s.position.board[sq('b2')]!.promoted = true;
    const { state } = play(s, draw, mv('a1', 'b2'));
    expect(state.pockets).toEqual({ w: [], b: ['p'] });
  });

  it('+2 returns up to two pieces from your pocket', () => {
    const s = rigged([special('draw2'), num(1)], { fen: emptyish, pockets: { w: ['q', 'n', 'p'], b: [] } });
    let { state } = play(s, draw);
    expect(state.phase).toEqual({ kind: 'act', plan: { kind: 'drops', total: 2, remaining: 2 } });
    ({ state } = play(state, drop('n', 'c3'), drop('p', 'd2')));
    expect(state.pockets.w).toEqual(['q']);
    expect(state.turn).toBe('b');
    expect(state.history[0].actions).toEqual(['N@c3', 'P@d2']);
  });

  it('+4 with only one pocketed piece places just that piece', () => {
    const s = rigged([wild('wild4')], { fen: emptyish, pockets: { w: ['r'], b: [] } });
    const { state } = play(s, draw);
    expect(state.phase).toEqual({ kind: 'act', plan: { kind: 'drops', total: 1, remaining: 1 } });
  });

  it('with an empty pocket, a +2 becomes one normal move', () => {
    const { state } = play(rigged([special('draw2')]), draw);
    expect(state.phase).toEqual({ kind: 'act', plan: { kind: 'moves', total: 1, remaining: 1 } });
    expect(state.history[0].notes).toContain('noPocket');
  });

  it('rejects illegal drops', () => {
    const s = play(rigged([special('draw2')], { fen: emptyish, pockets: { w: ['p', 'n'], b: [] } }), draw).state;
    expect(() => applyAction(s, 'p1', drop('p', 'a8'))).toThrow(/can’t place/);
    expect(() => applyAction(s, 'p1', drop('p', 'e1'))).toThrow(/can’t place/);
    expect(() => applyAction(s, 'p1', drop('q', 'a3'))).toThrow(/pocket/);
  });

  it('a drop giving check ends the turn', () => {
    const s = rigged([special('draw2')], { fen: emptyish, pockets: { w: ['r', 'n'], b: [] } });
    const { state } = play(s, draw, drop('r', 'e5'));
    expect(state.turn).toBe('b');
    expect(state.history[0].notes).toContain('checkEndsTurn');
  });

  it('in check, drops must block; if none can, the card becomes an escape move', () => {
    const inCheckFen = '4k3/8/8/8/8/3n4/8/4K3 w - - 0 1'; // knight check cannot be blocked
    const s = rigged([special('draw2')], { fen: inCheckFen, pockets: { w: ['q'], b: [] } });
    const { state } = play(s, draw);
    expect(state.phase).toEqual({ kind: 'act', plan: { kind: 'moves', total: 1, remaining: 1 } });
    expect(state.history[0].notes).toContain('noDropSquares');
  });
});

describe('wild cards', () => {
  it('lets the player choose which card it acts as, within the cap', () => {
    const s = play(rigged([wild('wild')], { settings: { moveCap: 3 } }), draw).state;
    expect(s.phase).toEqual({ kind: 'wild' });
    expect(() => applyAction(s, 'p1', { type: 'chooseWild', effect: { kind: 'number', value: 5 } })).toThrow(GameError);
    expect(() => applyAction(s, 'p1', { type: 'chooseWild', effect: { kind: 'draw', count: 4 } })).toThrow(GameError);
    const { state, events } = play(s, { type: 'chooseWild', effect: { kind: 'reverse' } });
    expect(state.armies).toEqual({ w: 'p2', b: 'p1' });
    expect(events[0]).toEqual({ type: 'wildChosen', effect: { kind: 'reverse' } });
  });
});

describe('untrusted input', () => {
  it('rejects malformed actions without touching state', () => {
    const s = play(rigged([special('draw2')], { pockets: { w: ['n'], b: [] } }), draw).state;
    const bad: unknown[] = [
      null,
      { type: 'drop', piece: 'n', to: 'abc' },
      { type: 'drop', piece: 'k', to: 20 },
      { type: 'drop', piece: 'n', to: 64 },
      { type: 'move', move: { from: 12, to: 28.5 } },
      { type: 'move', move: { from: 12, to: 28, promotion: 'k' } },
      { type: 'move' },
      { type: 'chooseWild', effect: { kind: 'number' } },
      { type: 'answerDraw', accept: 'yes' },
      { type: 'hack' },
    ];
    for (const action of bad) {
      expect(() => applyAction(s, 'p1', action as Action)).toThrow(GameError);
    }
    expect(() => applyAction(s, 'p3' as 'p1', draw)).toThrow(GameError);
    expect(s.position.board.length).toBe(64);
    expect(s.pockets.w).toEqual(['n']);
  });
});

describe('deck and match flow', () => {
  it('reshuffles the discard pile (keeping the top card) when the deck runs out', () => {
    let s = rigged([num(0)]);
    s = play(s, draw).state; // p1 passes, deck now empty
    s.discard = [num(1), num(1), num(0)];
    const { state, events } = play(s, draw);
    expect(events[0]).toEqual({ type: 'reshuffled' });
    expect(state.discard).toHaveLength(2);
    expect(state.drawPile).toHaveLength(1);
  });

  it('a full random game never throws when playing random legal actions', () => {
    for (let seed = 1; seed <= 12; seed++) {
      let s = createGame({ names: { p1: 'A', p2: 'B' }, whitePlayer: 'p1', seed });
      let r = seed;
      const rand = (n: number) => {
        r = (r * 1103515245 + 12345) & 0x7fffffff;
        return r % n;
      };
      for (let step = 0; step < 600 && s.phase.kind !== 'over'; step++) {
        s = applyAction(s, currentPlayer(s), randomAction(s, rand)).state;
      }
      expect(s.pockets.w.length + s.pockets.b.length).toBeLessThanOrEqual(30);
    }
  }, 60_000);

  it('handles resignation and draw offers', () => {
    const s = rigged([num(1)]);
    expect(applyAction(s, 'p2', { type: 'resign' }).state.result).toEqual({ winner: 'p1', winningColor: 'w', reason: 'resignation' });
    const offered = applyAction(s, 'p1', { type: 'offerDraw' }).state;
    expect(() => applyAction(offered, 'p1', { type: 'answerDraw', accept: true })).toThrow(GameError);
    expect(applyAction(offered, 'p2', { type: 'answerDraw', accept: false }).state.drawOffer).toBeNull();
    expect(applyAction(offered, 'p2', { type: 'answerDraw', accept: true }).state.result?.reason).toBe('agreement');
  });
});

function randomAction(s: GameState, rand: (n: number) => number): Action {
  switch (s.phase.kind) {
    case 'draw': return draw;
    case 'wild': {
      const options = wildOptions(s.settings);
      return { type: 'chooseWild', effect: options[rand(options.length)] };
    }
    case 'act': {
      if (s.phase.plan.kind === 'drops') {
        const types = droppableTypes(s);
        const piece = types[rand(types.length)];
        const squares = dropSquares(s, piece);
        return { type: 'drop', piece, to: squares[rand(squares.length)] };
      }
      const moves = legalMoves(s.position, s.turn);
      return { type: 'move', move: moves[rand(moves.length)] };
    }
    default: throw new Error('unreachable');
  }
}

