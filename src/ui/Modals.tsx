import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import type { Card, CardColor, Effect } from '../engine/cards';
import { wildOptions, type GameView, type PlayerId, type Settings } from '../engine/game';
import { UnoCard } from './UnoCard';
import { effectHeadline, plural, resultText } from './text';

interface ModalProps {
  title: string;
  onClose?: () => void;
  children: ComponentChildren;
  wide?: boolean;
}

export function Modal({ title, onClose, children, wide }: ModalProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('button, [href], input, select')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && onClose) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, []);
  return (
    <div class="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div class={`modal ${wide ? 'modal--wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <h2 class="modal__title">{title}</h2>
        {children}
        {onClose && (
          <button type="button" class="modal__close" onClick={onClose} aria-label="Close">
            ×
          </button>
        )}
      </div>
    </div>
  );
}

const WILD_TINTS: CardColor[] = ['red', 'yellow', 'green', 'blue'];

function effectAsCard(effect: Effect, i: number): Card {
  const color = WILD_TINTS[i % 4];
  switch (effect.kind) {
    case 'number': return { id: -1 - i, kind: 'number', color, value: effect.value };
    case 'skip': return { id: -1 - i, kind: 'skip', color };
    case 'reverse': return { id: -1 - i, kind: 'reverse', color };
    case 'draw': return { id: -1 - i, kind: 'draw2', color };
  }
}

export function WildPicker({ settings, name, onPick, onPeek }: { settings: Settings; name: string; onPick: (e: Effect) => void; onPeek: () => void }) {
  return (
    <Modal title={`${name}, your wild card becomes…`} onClose={onPeek} wide>
      <div class="wild-grid">
        {wildOptions(settings).map((effect, i) => (
          <button key={JSON.stringify(effect)} type="button" class="wild-option" onClick={() => onPick(effect)}>
            <UnoCard card={effectAsCard(effect, i)} />
            <span>{effectHeadline(effect, settings.moveCap)}</span>
          </button>
        ))}
      </div>
      <div class="modal__actions">
        <button type="button" class="btn" onClick={onPeek}>
          Look at the board first
        </button>
      </div>
    </Modal>
  );
}

export function GameOverModal({ view, onRematch, onNewGame, onClose }: { view: GameView; onRematch: () => void; onNewGame: () => void; onClose: () => void }) {
  const { title, detail } = resultText(view);
  return (
    <Modal title={title} onClose={onClose}>
      <p class="modal__lead">{detail}</p>
      <p class="modal__meta">{`${plural(view.history.length, 'card')} flipped.`}</p>
      <div class="modal__actions">
        <button type="button" class="btn btn--primary" onClick={onRematch}>
          Rematch
        </button>
        <button type="button" class="btn" onClick={onNewGame}>
          New players or settings
        </button>
      </div>
    </Modal>
  );
}

export function ResignModal({ view, candidates, onResign, onClose }: { view: GameView; candidates: readonly PlayerId[]; onResign: (p: PlayerId) => void; onClose: () => void }) {
  return (
    <Modal title="Resign the game?" onClose={onClose}>
      <p class="modal__lead">{candidates.length > 1 ? 'Who is resigning?' : 'Your opponent wins.'}</p>
      <div class="modal__actions">
        {candidates.map((p) => (
          <button key={p} type="button" class="btn btn--danger" onClick={() => onResign(p)}>
            {candidates.length > 1 ? `${view.players[p].name} resigns` : 'Resign'}
          </button>
        ))}
        <button type="button" class="btn" onClick={onClose}>
          Keep playing
        </button>
      </div>
    </Modal>
  );
}

export function DrawOfferModal({ view, onAnswer }: { view: GameView; onAnswer: (accept: boolean) => void }) {
  const by = view.drawOffer!;
  const to: PlayerId = by === 'p1' ? 'p2' : 'p1';
  return (
    <Modal title={`${view.players[by].name} offers a draw`}>
      <p class="modal__lead">{`${view.players[to].name}, do you accept?`}</p>
      <div class="modal__actions">
        <button type="button" class="btn btn--primary" onClick={() => onAnswer(true)}>
          Accept draw
        </button>
        <button type="button" class="btn" onClick={() => onAnswer(false)}>
          Keep playing
        </button>
      </div>
    </Modal>
  );
}

export function ConfirmModal({ title, lead, confirm, onConfirm, onClose }: { title: string; lead: string; confirm: string; onConfirm: () => void; onClose: () => void }) {
  return (
    <Modal title={title} onClose={onClose}>
      <p class="modal__lead">{lead}</p>
      <div class="modal__actions">
        <button type="button" class="btn btn--danger" onClick={onConfirm}>
          {confirm}
        </button>
        <button type="button" class="btn" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

const RULE_CARDS: { card: Card; title: string; body: string }[] = [
  { card: { id: -1, kind: 'number', color: 'yellow', value: 3 }, title: 'Numbers', body: 'Make that many moves in a row, with any pieces. Numbers above the move cap count as the cap.' },
  { card: { id: -2, kind: 'number', color: 'blue', value: 0 }, title: 'Zero', body: 'No moves. If you’re in check, you get one move to escape.' },
  { card: { id: -3, kind: 'skip', color: 'red' }, title: 'Skip', body: 'Your opponent is skipped. Flip another card.' },
  { card: { id: -4, kind: 'reverse', color: 'green' }, title: 'Reverse', body: 'The board turns around and you swap armies. Your opponent takes over the same color’s turn and flips a card.' },
  { card: { id: -5, kind: 'draw2', color: 'blue' }, title: '+2', body: 'Put up to two of your captured pieces back on any empty squares (bughouse drops). With nothing to return, make one move instead.' },
  { card: { id: -6, kind: 'wild' }, title: 'Wild', body: 'Choose which card it acts as: a number up to the cap, Skip, Reverse, or +2.' },
  { card: { id: -7, kind: 'wild4' }, title: 'Wild +4', body: 'Put up to four captured pieces back on the board.' },
];

export function RulesModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="How to play" onClose={onClose} wide>
      <p class="modal__lead">Normal chess, except each turn starts by flipping a card, and the card decides what you get to do.</p>
      <ul class="rules-cards">
        {RULE_CARDS.map(({ card, title, body }) => (
          <li key={title}>
            <UnoCard card={card} />
            <div>
              <h3>{title}</h3>
              <p>{body}</p>
            </div>
          </li>
        ))}
      </ul>
      <h3 class="rules__heading">The fine print</h3>
      <ul class="rules-list">
        <li>Giving check ends your turn immediately, even with moves left. Otherwise you could check and then take the king.</li>
        <li>Checkmate wins the moment it happens. If you have to move and can’t, and you’re not in check, it’s stalemate: a draw.</li>
        <li>Placed pieces follow bughouse rules: any empty square, but no pawns on the first or last rank. A placed piece can give check or block one. A pawn placed on its starting rank may still move two squares. A rook placed back home doesn’t bring castling back.</li>
        <li>If you’re in check when a +2 or +4 comes up, the first piece you place has to block the check. If nothing can block it, you make one move instead.</li>
        <li>Captured pieces go to their own army’s pocket. A promoted piece goes back as a pawn.</li>
        <li>Unless it was turned off at setup, you can end your turn early once you’ve made at least one move.</li>
        <li>When the deck runs out, the discard pile is shuffled into a new deck.</li>
        <li>En passant, castling and promotion work as usual. You can move the same piece more than once in a turn.</li>
      </ul>
    </Modal>
  );
}
