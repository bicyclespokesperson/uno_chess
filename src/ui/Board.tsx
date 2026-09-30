import type { JSX } from 'preact';
import { fileOf, rankOf, squareName, type Color, type Piece, type Position, type PromotionType, type Square } from '../engine/chess';
import { COLOR_NAME, PIECE_NAME } from './text';

export const pieceSrc = (color: Color, type: string): string =>
  `${import.meta.env.BASE_URL}pieces/${color}${type.toUpperCase()}.svg`;

export type TargetKind = 'move' | 'capture';

export interface BoardProps {
  position: Position;
  whiteAtBottom: boolean;
  lastAction: { from: Square | null; to: Square } | null;
  selected: Square | null;
  targets: Map<Square, TargetKind>;
  dropTargets: Set<Square>;
  checkSquare: Square | null;
  interactive: boolean;
  hiddenPieceId: number | null;
  instantPieceId: number | null;
  promotion: { to: Square; color: Color; onPick: (t: PromotionType) => void; onCancel: () => void } | null;
  onSquarePointerDown: (sq: Square, e: PointerEvent) => void;
  onSquareActivate: (sq: Square) => void;
}

function displayCoords(sq: Square, whiteAtBottom: boolean): { col: number; row: number } {
  return whiteAtBottom ? { col: fileOf(sq), row: 7 - rankOf(sq) } : { col: 7 - fileOf(sq), row: rankOf(sq) };
}

function squareLabel(sq: Square, piece: Piece | null): string {
  return piece ? `${squareName(sq)}, ${COLOR_NAME[piece.color]} ${PIECE_NAME[piece.type]}` : squareName(sq);
}

export function Board(props: BoardProps) {
  const { position, whiteAtBottom, targets, dropTargets } = props;
  const squares: JSX.Element[] = [];
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const sq = whiteAtBottom ? (7 - row) * 8 + col : row * 8 + (7 - col);
      const piece = position.board[sq];
      const classes = ['sq', (fileOf(sq) + rankOf(sq)) % 2 === 0 ? 'sq--dark' : 'sq--light'];
      if (props.lastAction && (props.lastAction.from === sq || props.lastAction.to === sq)) classes.push('sq--last');
      if (props.selected === sq) classes.push('sq--selected');
      if (props.checkSquare === sq) classes.push('sq--check');
      const target = targets.get(sq);
      if (target) classes.push(`sq--${target}`);
      if (dropTargets.has(sq)) classes.push('sq--drop');
      const actionable = props.interactive && (Boolean(target) || dropTargets.has(sq) || Boolean(piece));
      squares.push(
        <div
          key={sq}
          class={classes.join(' ')}
          data-square={sq}
          role="button"
          tabIndex={actionable ? 0 : -1}
          aria-label={squareLabel(sq, piece)}
          onPointerDown={(e) => props.onSquarePointerDown(sq, e as unknown as PointerEvent)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              props.onSquareActivate(sq);
            }
          }}
        >
          {col === 0 && <span class="coord coord--rank">{rankOf(sq) + 1}</span>}
          {row === 7 && <span class="coord coord--file">{'abcdefgh'[fileOf(sq)]}</span>}
        </div>,
      );
    }
  }

  const pieces = position.board
    .map((piece, sq) => ({ piece, sq }))
    .filter((x): x is { piece: Piece; sq: Square } => x.piece !== null)
    .sort((a, b) => a.piece.id - b.piece.id)
    .map(({ piece, sq }) => {
      const { col, row } = displayCoords(sq, whiteAtBottom);
      const cls = ['piece'];
      if (piece.id === props.hiddenPieceId) cls.push('piece--hidden');
      if (piece.id === props.instantPieceId) cls.push('piece--instant');
      return (
        <div key={piece.id} class={cls.join(' ')} style={{ transform: `translate(${col * 100}%, ${row * 100}%)` }}>
          <img src={pieceSrc(piece.color, piece.type)} alt="" draggable={false} />
        </div>
      );
    });

  return (
    <div class="board">
      <div class="board__squares">{squares}</div>
      <div class="board__pieces" aria-hidden="true">{pieces}</div>
      {props.promotion && <PromotionPicker {...props.promotion} whiteAtBottom={whiteAtBottom} />}
    </div>
  );
}

function PromotionPicker({
  to,
  color,
  whiteAtBottom,
  onPick,
  onCancel,
}: NonNullable<BoardProps['promotion']> & { whiteAtBottom: boolean }) {
  const { col, row } = displayCoords(to, whiteAtBottom);
  const downward = row === 0;
  const types: PromotionType[] = ['q', 'n', 'r', 'b'];
  return (
    <div class="promotion" onPointerDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div
        class="promotion__menu"
        role="dialog"
        aria-label="Choose a promotion piece"
        style={{ left: `${col * 12.5}%`, [downward ? 'top' : 'bottom']: '0' }}
      >
        {(downward ? types : [...types].reverse()).map((t) => (
          <button key={t} type="button" class="promotion__choice" onClick={() => onPick(t)} aria-label={`Promote to ${PIECE_NAME[t]}`}>
            <img src={pieceSrc(color, t)} alt="" />
          </button>
        ))}
      </div>
    </div>
  );
}
