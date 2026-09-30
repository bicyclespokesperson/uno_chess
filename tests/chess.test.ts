import { describe, expect, it } from 'vitest';
import {
  applyDrop,
  applyMove,
  dropToSan,
  fromFen,
  inCheck,
  INITIAL_FEN,
  isDropSquareOk,
  legalDropSquares,
  legalMoves,
  moveToSan,
  parseSquare as sq,
  perft,
  toFen,
} from '../src/engine/chess';

const pos = (fen: string) => fromFen(fen).position;

describe('perft (validates standard move generation)', () => {
  const cases: [string, string, number[]][] = [
    ['start', INITIAL_FEN, [20, 400, 8902]],
    ['kiwipete', 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', [48, 2039]],
    ['position 3', '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', [14, 191, 2812, 43238]],
    ['position 4', 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', [6, 264, 9467]],
    ['position 5', 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8', [44, 1486, 62379]],
  ];
  for (const [name, fen, counts] of cases) {
    it(name, () => {
      const { position, turn } = fromFen(fen);
      counts.forEach((expected, i) => expect(perft(position, turn, i + 1)).toBe(expected));
    });
  }
});

describe('multi-move turn edge cases', () => {
  it('does not let a pawn capture its own side en passant after a double push', () => {
    // White just played e2-e4 mid-turn; d2 pawn "attacks" e3 but must not capture its own e4 pawn.
    const after = applyMove(pos('4k3/8/8/8/8/8/3PP3/4K3 w - - 0 1'), { from: sq('e2'), to: sq('e4') }).position;
    expect(after.ep).toBe(sq('e3'));
    const d2Moves = legalMoves(after, 'w').filter((m) => m.from === sq('d2')).map((m) => m.to);
    expect(d2Moves).not.toContain(sq('e3'));
  });

  it('still allows a genuine en passant capture', () => {
    const p = pos('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1');
    const move = { from: sq('e5'), to: sq('d6') };
    expect(legalMoves(p, 'w')).toContainEqual(move);
    const { position, captured, enPassant } = applyMove(p, move);
    expect(enPassant).toBe(true);
    expect(captured?.type).toBe('p');
    expect(position.board[sq('d5')]).toBeNull();
    expect(moveToSan(p, 'w', move)).toBe('exd6');
  });

  it('marks promoted pieces', () => {
    const { position } = applyMove(pos('4k3/P7/8/8/8/8/8/4K3 w - - 0 1'), { from: sq('a7'), to: sq('a8'), promotion: 'n' });
    expect(position.board[sq('a8')]).toMatchObject({ type: 'n', promoted: true });
  });

  it('removes castling rights when a rook is captured', () => {
    const { position } = applyMove(pos('r3k3/8/8/8/8/8/8/R3K2R w KQq - 0 1'), { from: sq('a1'), to: sq('a8') });
    expect(position.castling).toEqual({ wK: true, wQ: false, bK: false, bQ: false });
  });

  it('forbids castling through an attacked square', () => {
    const p = pos('4k3/8/8/8/8/8/5r2/4K2R w K - 0 1');
    expect(legalMoves(p, 'w').some((m) => m.from === sq('e1') && m.to === sq('g1'))).toBe(false);
  });
});

describe('drops', () => {
  it('forbids pawns on the first and last ranks and occupied squares', () => {
    const p = pos(INITIAL_FEN.replace('PPPPPPPP', 'PPPPPPP1'));
    const squares = legalDropSquares(p, 'w', 'p');
    expect(squares.some((s) => s < 8 || s >= 56)).toBe(false);
    expect(squares).toContain(sq('h2'));
    expect(squares).not.toContain(sq('a2'));
    expect(legalDropSquares(p, 'w', 'n')).toHaveLength(33);
  });

  it('requires a drop to block check', () => {
    const p = pos('4k3/8/8/8/8/8/8/r3K3 w - - 0 1');
    expect(inCheck(p, 'w')).toBe(true);
    expect(legalDropSquares(p, 'w', 'n').sort()).toEqual([sq('b1'), sq('c1'), sq('d1')].sort());
    expect(legalDropSquares(p, 'w', 'p')).toEqual([]);
  });

  it('lets a dropped pawn on its home rank double-step', () => {
    const p = applyDrop(pos('4k3/8/8/8/8/8/8/4K3 w - - 0 1'), 'w', 'p', sq('c2'));
    expect(legalMoves(p, 'w')).toContainEqual({ from: sq('c2'), to: sq('c4') });
  });

  it('writes drops in SAN, including check', () => {
    const p = pos('4k3/8/8/8/8/8/8/4K3 w - - 0 1');
    expect(dropToSan(p, 'w', 'q', sq('e7'))).toBe('Q@e7+');
    expect(isDropSquareOk(p, 'w', 'q', sq('e8'))).toBe(false);
  });
});

describe('SAN', () => {
  it('disambiguates and marks mate', () => {
    const p = pos('6k1/5ppp/8/8/8/8/4K3/R6R w - - 0 1');
    expect(moveToSan(p, 'w', { from: sq('a1'), to: sq('a8') })).toBe('Ra8#');
    expect(moveToSan(p, 'w', { from: sq('a1'), to: sq('d1') })).toBe('Rad1');
    expect(moveToSan(pos('4k3/8/8/8/8/8/8/R3K2R w KQ - 0 1'), 'w', { from: sq('e1'), to: sq('c1') })).toBe('O-O-O');
  });

  it('round-trips FEN', () => {
    expect(toFen(pos(INITIAL_FEN), 'w')).toBe('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -');
  });
});
