export type Color = 'w' | 'b';
export type PieceType = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';
export type DroppableType = Exclude<PieceType, 'k'>;
export type PromotionType = 'q' | 'r' | 'b' | 'n';

/** a1 = 0, h1 = 7, a8 = 56, h8 = 63 */
export type Square = number;

export interface Piece {
  type: PieceType;
  color: Color;
  /** Stable identity so the UI can animate a piece across squares. */
  id: number;
  /** Promoted pieces return to the pocket as pawns when captured (bughouse rule). */
  promoted?: boolean;
}

export interface CastlingRights {
  wK: boolean;
  wQ: boolean;
  bK: boolean;
  bQ: boolean;
}

export interface Position {
  board: (Piece | null)[];
  castling: CastlingRights;
  /** Square a pawn skipped over on the most recent double push, if any. */
  ep: Square | null;
  nextPieceId: number;
}

export interface Move {
  from: Square;
  to: Square;
  promotion?: PromotionType;
}

export interface MoveResult {
  position: Position;
  captured: Piece | null;
  castle?: 'K' | 'Q';
  enPassant?: boolean;
}

export const PROMOTION_TYPES: PromotionType[] = ['q', 'r', 'b', 'n'];
export const DROPPABLE_TYPES: DroppableType[] = ['q', 'r', 'b', 'n', 'p'];

export const other = (c: Color): Color => (c === 'w' ? 'b' : 'w');
export const fileOf = (sq: Square): number => sq & 7;
export const rankOf = (sq: Square): number => sq >> 3;
export const squareAt = (file: number, rank: number): Square => rank * 8 + file;
const onBoard = (file: number, rank: number): boolean => file >= 0 && file < 8 && rank >= 0 && rank < 8;

export function squareName(sq: Square): string {
  return 'abcdefgh'[fileOf(sq)] + String(rankOf(sq) + 1);
}

export function parseSquare(name: string): Square {
  const file = 'abcdefgh'.indexOf(name[0]);
  const rank = Number(name[1]) - 1;
  if (name.length !== 2 || file < 0 || !(rank >= 0 && rank < 8)) throw new Error(`Bad square: ${name}`);
  return squareAt(file, rank);
}

const KNIGHT_STEPS: [number, number][] = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
const KING_STEPS: [number, number][] = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
const ROOK_DIRS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const BISHOP_DIRS: [number, number][] = [[1, 1], [1, -1], [-1, 1], [-1, -1]];

const pawnDir = (c: Color): number => (c === 'w' ? 1 : -1);
const pawnStartRank = (c: Color): number => (c === 'w' ? 1 : 6);
const lastRank = (c: Color): number => (c === 'w' ? 7 : 0);

export const INITIAL_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export function fromFen(fen: string): { position: Position; turn: Color } {
  const [placement, turn = 'w', castling = '-', ep = '-'] = fen.trim().split(/\s+/);
  const board: (Piece | null)[] = Array(64).fill(null);
  let nextPieceId = 1;
  const rows = placement.split('/');
  if (rows.length !== 8) throw new Error(`Bad FEN: ${fen}`);
  rows.forEach((row, i) => {
    const rank = 7 - i;
    let file = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) {
        file += Number(ch);
        continue;
      }
      const color: Color = ch === ch.toUpperCase() ? 'w' : 'b';
      board[squareAt(file, rank)] = { type: ch.toLowerCase() as PieceType, color, id: nextPieceId++ };
      file++;
    }
  });
  return {
    position: {
      board,
      castling: { wK: castling.includes('K'), wQ: castling.includes('Q'), bK: castling.includes('k'), bQ: castling.includes('q') },
      ep: ep === '-' ? null : parseSquare(ep),
      nextPieceId,
    },
    turn: turn === 'b' ? 'b' : 'w',
  };
}

export function toFen(pos: Position, turn: Color): string {
  const rows: string[] = [];
  for (let rank = 7; rank >= 0; rank--) {
    let row = '';
    let empty = 0;
    for (let file = 0; file < 8; file++) {
      const p = pos.board[squareAt(file, rank)];
      if (!p) {
        empty++;
        continue;
      }
      if (empty) row += empty;
      empty = 0;
      row += p.color === 'w' ? p.type.toUpperCase() : p.type;
    }
    rows.push(row + (empty || ''));
  }
  const c = pos.castling;
  const castling = (c.wK ? 'K' : '') + (c.wQ ? 'Q' : '') + (c.bK ? 'k' : '') + (c.bQ ? 'q' : '') || '-';
  return `${rows.join('/')} ${turn} ${castling} ${pos.ep === null ? '-' : squareName(pos.ep)}`;
}

export const initialPosition = (): Position => fromFen(INITIAL_FEN).position;

export function kingSquare(pos: Position, color: Color): Square | null {
  const idx = pos.board.findIndex((p) => p?.type === 'k' && p.color === color);
  return idx < 0 ? null : idx;
}

function slideHits(pos: Position, sq: Square, dirs: [number, number][], by: Color, types: PieceType[]): boolean {
  return dirs.some(([df, dr]) => {
    let f = fileOf(sq) + df;
    let r = rankOf(sq) + dr;
    while (onBoard(f, r)) {
      const p = pos.board[squareAt(f, r)];
      if (p) return p.color === by && types.includes(p.type);
      f += df;
      r += dr;
    }
    return false;
  });
}

function stepHits(pos: Position, sq: Square, steps: [number, number][], by: Color, type: PieceType): boolean {
  return steps.some(([df, dr]) => {
    const f = fileOf(sq) + df;
    const r = rankOf(sq) + dr;
    if (!onBoard(f, r)) return false;
    const p = pos.board[squareAt(f, r)];
    return p?.color === by && p.type === type;
  });
}

export function isAttacked(pos: Position, sq: Square, by: Color): boolean {
  const pawnSourceRank = -pawnDir(by);
  return (
    stepHits(pos, sq, [[-1, pawnSourceRank], [1, pawnSourceRank]], by, 'p') ||
    stepHits(pos, sq, KNIGHT_STEPS, by, 'n') ||
    stepHits(pos, sq, KING_STEPS, by, 'k') ||
    slideHits(pos, sq, ROOK_DIRS, by, ['r', 'q']) ||
    slideHits(pos, sq, BISHOP_DIRS, by, ['b', 'q'])
  );
}

export function inCheck(pos: Position, color: Color): boolean {
  const k = kingSquare(pos, color);
  return k !== null && isAttacked(pos, k, other(color));
}

function pushPawnMove(moves: Move[], from: Square, to: Square, color: Color): void {
  if (rankOf(to) === lastRank(color)) {
    PROMOTION_TYPES.forEach((promotion) => moves.push({ from, to, promotion }));
  } else {
    moves.push({ from, to });
  }
}

/** The pawn removed by an en passant capture, or null if moving `from`→`to` isn't a valid en passant. */
function enPassantVictim(pos: Position, from: Square, to: Square, color: Color): Square | null {
  if (pos.ep !== to) return null;
  const victim = to - 8 * pawnDir(color);
  const victimPiece = pos.board[victim];
  // Multi-move turns mean the ep square can belong to our *own* just-pushed pawn.
  if (victimPiece?.type !== 'p' || victimPiece.color === color) return null;
  if (Math.abs(fileOf(from) - fileOf(to)) !== 1) return null;
  return victim;
}

function pawnMoves(pos: Position, from: Square, color: Color, moves: Move[]): void {
  const f = fileOf(from);
  const r = rankOf(from);
  const dir = pawnDir(color);
  const one = squareAt(f, r + dir);
  if (onBoard(f, r + dir) && !pos.board[one]) {
    pushPawnMove(moves, from, one, color);
    const two = squareAt(f, r + 2 * dir);
    if (r === pawnStartRank(color) && !pos.board[two]) moves.push({ from, to: two });
  }
  for (const df of [-1, 1]) {
    if (!onBoard(f + df, r + dir)) continue;
    const to = squareAt(f + df, r + dir);
    const target = pos.board[to];
    if (target && target.color !== color) pushPawnMove(moves, from, to, color);
    else if (!target && enPassantVictim(pos, from, to, color) !== null) moves.push({ from, to });
  }
}

function stepMoves(pos: Position, from: Square, color: Color, steps: [number, number][], moves: Move[]): void {
  for (const [df, dr] of steps) {
    const f = fileOf(from) + df;
    const r = rankOf(from) + dr;
    if (!onBoard(f, r)) continue;
    const to = squareAt(f, r);
    if (pos.board[to]?.color !== color) moves.push({ from, to });
  }
}

function slideMoves(pos: Position, from: Square, color: Color, dirs: [number, number][], moves: Move[]): void {
  for (const [df, dr] of dirs) {
    let f = fileOf(from) + df;
    let r = rankOf(from) + dr;
    while (onBoard(f, r)) {
      const to = squareAt(f, r);
      const p = pos.board[to];
      if (p?.color === color) break;
      moves.push({ from, to });
      if (p) break;
      f += df;
      r += dr;
    }
  }
}

function castlingMoves(pos: Position, color: Color, moves: Move[]): void {
  const home = color === 'w' ? 0 : 56;
  const kingFrom = home + 4;
  const king = pos.board[kingFrom];
  if (king?.type !== 'k' || king.color !== color) return;
  const enemy = other(color);
  if (isAttacked(pos, kingFrom, enemy)) return;
  const sides: { right: boolean; rook: Square; empty: Square[]; path: Square[]; to: Square }[] = [
    { right: color === 'w' ? pos.castling.wK : pos.castling.bK, rook: home + 7, empty: [home + 5, home + 6], path: [home + 5, home + 6], to: home + 6 },
    { right: color === 'w' ? pos.castling.wQ : pos.castling.bQ, rook: home, empty: [home + 1, home + 2, home + 3], path: [home + 3, home + 2], to: home + 2 },
  ];
  for (const side of sides) {
    const rook = pos.board[side.rook];
    if (!side.right || rook?.type !== 'r' || rook.color !== color) continue;
    if (side.empty.some((sq) => pos.board[sq])) continue;
    if (side.path.some((sq) => isAttacked(pos, sq, enemy))) continue;
    moves.push({ from: kingFrom, to: side.to });
  }
}

export function pseudoLegalMoves(pos: Position, color: Color): Move[] {
  const moves: Move[] = [];
  pos.board.forEach((p, from) => {
    if (!p || p.color !== color) return;
    switch (p.type) {
      case 'p': return pawnMoves(pos, from, color, moves);
      case 'n': return stepMoves(pos, from, color, KNIGHT_STEPS, moves);
      case 'k': return stepMoves(pos, from, color, KING_STEPS, moves);
      case 'b': return slideMoves(pos, from, color, BISHOP_DIRS, moves);
      case 'r': return slideMoves(pos, from, color, ROOK_DIRS, moves);
      case 'q': return slideMoves(pos, from, color, [...ROOK_DIRS, ...BISHOP_DIRS], moves);
    }
  });
  castlingMoves(pos, color, moves);
  return moves;
}

export function legalMoves(pos: Position, color: Color): Move[] {
  return pseudoLegalMoves(pos, color).filter((m) => !inCheck(applyMove(pos, m).position, color));
}

export const hasLegalMove = (pos: Position, color: Color): boolean =>
  pseudoLegalMoves(pos, color).some((m) => !inCheck(applyMove(pos, m).position, color));

function clearCastlingFor(castling: CastlingRights, sq: Square): void {
  if (sq === 4) castling.wK = castling.wQ = false;
  if (sq === 60) castling.bK = castling.bQ = false;
  if (sq === 0) castling.wQ = false;
  if (sq === 7) castling.wK = false;
  if (sq === 56) castling.bQ = false;
  if (sq === 63) castling.bK = false;
}

/** Applies a move assumed to be pseudo-legal for the piece on `from`. Never mutates `pos`. */
export function applyMove(pos: Position, move: Move): MoveResult {
  const board = pos.board.slice();
  const castling = { ...pos.castling };
  const piece = board[move.from];
  if (!piece) throw new Error(`No piece on ${squareName(move.from)}`);
  const result: Omit<MoveResult, 'position'> = { captured: board[move.to] };
  let ep: Square | null = null;

  if (piece.type === 'p') {
    const victim = enPassantVictim(pos, move.from, move.to, piece.color);
    if (victim !== null && !board[move.to]) {
      result.captured = board[victim];
      result.enPassant = true;
      board[victim] = null;
    }
    if (Math.abs(move.to - move.from) === 16) ep = (move.to + move.from) / 2;
  }

  board[move.to] = piece;
  board[move.from] = null;

  if (piece.type === 'p' && rankOf(move.to) === lastRank(piece.color)) {
    board[move.to] = { type: move.promotion ?? 'q', color: piece.color, id: piece.id, promoted: true };
  }

  if (piece.type === 'k' && Math.abs(move.to - move.from) === 2) {
    const kingside = move.to > move.from;
    const rookFrom = kingside ? move.from + 3 : move.from - 4;
    const rookTo = kingside ? move.from + 1 : move.from - 1;
    board[rookTo] = board[rookFrom];
    board[rookFrom] = null;
    result.castle = kingside ? 'K' : 'Q';
  }

  clearCastlingFor(castling, move.from);
  clearCastlingFor(castling, move.to);

  return { ...result, position: { board, castling, ep, nextPieceId: pos.nextPieceId } };
}

export function isLegalMove(pos: Position, color: Color, move: Move): boolean {
  return legalMoves(pos, color).some((m) => m.from === move.from && m.to === move.to && m.promotion === move.promotion);
}

export function isDropSquareOk(pos: Position, color: Color, type: DroppableType, to: Square): boolean {
  if (pos.board[to]) return false;
  if (type === 'p' && (rankOf(to) === 0 || rankOf(to) === 7)) return false;
  return !inCheck(placePiece(pos, color, type, to), color);
}

export function legalDropSquares(pos: Position, color: Color, type: DroppableType): Square[] {
  const squares: Square[] = [];
  for (let sq = 0; sq < 64; sq++) if (isDropSquareOk(pos, color, type, sq)) squares.push(sq);
  return squares;
}

function placePiece(pos: Position, color: Color, type: DroppableType, to: Square): Position {
  const board = pos.board.slice();
  board[to] = { type, color, id: pos.nextPieceId };
  return { board, castling: pos.castling, ep: null, nextPieceId: pos.nextPieceId + 1 };
}

/** Bughouse drop. Dropped rooks never regain castling rights; dropped pawns on their 2nd rank may double-step. */
export function applyDrop(pos: Position, color: Color, type: DroppableType, to: Square): Position {
  return placePiece(pos, color, type, to);
}

const PIECE_LETTER: Record<PieceType, string> = { p: '', n: 'N', b: 'B', r: 'R', q: 'Q', k: 'K' };

function checkSuffix(after: Position, mover: Color): string {
  const enemy = other(mover);
  if (!inCheck(after, enemy)) return '';
  return hasLegalMove(after, enemy) ? '+' : '#';
}

/** SAN for a legal move, computed against the position *before* the move. */
export function moveToSan(pos: Position, color: Color, move: Move): string {
  const piece = pos.board[move.from];
  if (!piece) throw new Error(`No piece on ${squareName(move.from)}`);
  const { position: after, castle, enPassant } = applyMove(pos, move);
  const suffix = checkSuffix(after, color);
  if (castle) return (castle === 'K' ? 'O-O' : 'O-O-O') + suffix;

  const isCapture = Boolean(pos.board[move.to]) || Boolean(enPassant);
  let san = PIECE_LETTER[piece.type];
  if (piece.type === 'p') {
    if (isCapture) san += 'abcdefgh'[fileOf(move.from)];
  } else {
    const rivals = legalMoves(pos, color).filter(
      (m) => m.to === move.to && m.from !== move.from && pos.board[m.from]?.type === piece.type,
    );
    if (rivals.length) {
      const sameFile = rivals.some((m) => fileOf(m.from) === fileOf(move.from));
      const sameRank = rivals.some((m) => rankOf(m.from) === rankOf(move.from));
      if (!sameFile) san += 'abcdefgh'[fileOf(move.from)];
      else if (!sameRank) san += String(rankOf(move.from) + 1);
      else san += squareName(move.from);
    }
  }
  if (isCapture) san += 'x';
  san += squareName(move.to);
  if (move.promotion) san += '=' + move.promotion.toUpperCase();
  return san + suffix;
}

export function dropToSan(pos: Position, color: Color, type: DroppableType, to: Square): string {
  const after = applyDrop(pos, color, type, to);
  return `${type === 'p' ? '' : type.toUpperCase()}@${squareName(to)}${checkSuffix(after, color)}`;
}

export function perft(pos: Position, color: Color, depth: number): number {
  if (depth === 0) return 1;
  const moves = legalMoves(pos, color);
  if (depth === 1) return moves.length;
  return moves.reduce((n, m) => n + perft(applyMove(pos, m).position, other(color), depth - 1), 0);
}
