import type { Color, PieceType } from '../engine/chess.ts';
import type { Effect } from '../engine/cards.ts';
import { MAX_CARDS_PER_GAME, type EndReason, type GameEvent, type GameView, type PlayerId, type TurnNote } from '../engine/game.ts';

export const COLOR_NAME: Record<Color, string> = { w: 'White', b: 'Black' };
export const PIECE_NAME: Record<PieceType, string> = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };

export const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

export function effectHeadline(effect: Effect, cap: number): string {
  switch (effect.kind) {
    case 'number': {
      const moves = Math.min(effect.value, cap);
      return moves === 0 ? 'No moves' : plural(moves, 'move');
    }
    case 'skip': return 'Skip';
    case 'reverse': return 'Reverse';
    case 'draw': return `Get back ${plural(effect.count, 'piece')}`;
  }
}

export function effectDetail(effect: Effect): string {
  switch (effect.kind) {
    case 'number': return effect.value === 0 ? 'Pass, unless you’re in check.' : 'Move any of your pieces, in any order.';
    case 'skip': return 'Your opponent is skipped. Flip again.';
    case 'reverse': return 'Swap armies. Your opponent takes over this turn.';
    case 'draw': return 'Place captured pieces back on the board.';
  }
}

const NOTE_TEXT: Record<TurnNote, string> = {
  capped: 'capped',
  zero: 'pass',
  zeroInCheck: 'in check: one escape move',
  skip: 'flips again',
  reverse: 'armies swapped',
  noPocket: 'nothing to return: one move instead',
  noDropSquares: 'no legal drop: one move instead',
  checkEndsTurn: 'check ends the turn',
  noMovesLeft: 'no legal moves left',
  endedEarly: 'ended early',
  reshuffled: 'deck reshuffled',
};

export const noteText = (note: TurnNote): string => NOTE_TEXT[note];

export function resultText(view: GameView): { title: string; detail: string } {
  const result = view.result;
  if (!result) return { title: '', detail: '' };
  const reasons: Record<EndReason, string> = {
    checkmate: 'by checkmate',
    stalemate: 'Stalemate: no legal moves, but not in check.',
    resignation: 'by resignation',
    agreement: 'Draw agreed.',
    turnLimit: `Draw: ${MAX_CARDS_PER_GAME} cards flipped without a winner.`,
  };
  if (!result.winner) return { title: 'Draw', detail: reasons[result.reason] };
  const name = view.players[result.winner].name;
  const color = result.winningColor ? ` with ${COLOR_NAME[result.winningColor]}` : '';
  return { title: `${name} wins`, detail: `${name} won${color}, ${reasons[result.reason]}.` };
}

/** Short announcements for things that change the flow of play. */
export function eventAnnouncement(event: GameEvent, view: GameView): string | null {
  const name = (p: PlayerId) => view.players[p].name;
  switch (event.type) {
    case 'skip': return `Skip! ${name(event.player)} flips again.`;
    case 'reverse':
      return `Reverse! ${name(event.armies.w)} now plays White, ${name(event.armies.b)} plays Black.`;
    case 'reshuffled': return 'The deck ran out, so the discard pile was reshuffled.';
    case 'drawDeclined': return `${name(event.by)} declined the draw.`;
    case 'drawOffered': return `${name(event.by)} offered a draw.`;
    case 'turnEnded':
      switch (event.reason) {
        case 'check': return `Check! That ends the turn. ${name(event.next)}, you’re up.`;
        case 'zero': return `Zero: no moves. ${name(event.next)}, you’re up.`;
        case 'noMoves': return `No legal moves left. ${name(event.next)}, you’re up.`;
        case 'noDropSquares': return `Nowhere left to place a piece. ${name(event.next)}, you’re up.`;
        default: return null;
      }
    default: return null;
  }
}
