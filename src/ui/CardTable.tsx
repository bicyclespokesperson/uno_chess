import { inCheck } from '../engine/chess.ts';
import type { Card } from '../engine/cards.ts';
import { currentPlayer, currentRecord, type GameView } from '../engine/game.ts';
import { CardBack, UnoCard } from './UnoCard.tsx';
import { effectDetail, effectHeadline, plural, resultText } from './text.ts';

export interface CardTableProps {
  view: GameView;
  canAct: boolean;
  /** Online: it's the other player's turn, so describe what we're waiting for instead of giving instructions. */
  waitingOnOpponent: boolean;
  flipId: number | null;
  announcement: { text: string; key: number } | null;
  onDraw: () => void;
  onEndTurn: () => void;
  onChooseWild: () => void;
  onRematch: () => void;
}

/** Deterministic little tilt per card so the discard pile looks tossed, not stacked. */
const tilt = (card: Card): number => ((card.id * 47) % 17) - 8;

function Prompt({ view, waiting }: { view: GameView; waiting: boolean }) {
  const name = view.players[currentPlayer(view)].name;
  const record = currentRecord(view);
  const checked = inCheck(view.position, view.turn);
  const { phase } = view;
  if (phase.kind === 'over') {
    const { title, detail } = resultText(view);
    return <Heading title={title} detail={detail} />;
  }
  if (waiting && phase.kind === 'draw') {
    return <Heading title={`${name}’s turn`} detail={checked ? `Waiting for ${name} to flip a card. They’re in check.` : `Waiting for ${name} to flip a card.`} />;
  }
  if (waiting && phase.kind === 'wild') return <Heading title="Wild!" detail={`Waiting for ${name} to choose what it does.`} />;
  if (phase.kind === 'draw') {
    return <Heading title={`${name}, flip a card`} detail={checked ? 'You’re in check. Your next move has to get out of it.' : 'Click the deck, or press F.'} />;
  }
  if (phase.kind === 'wild') return <Heading title="Wild!" detail={`${name}, choose what it does.`} />;
  const { plan } = phase;
  const effect = record?.effect;
  const title = plan.kind === 'drops' ? `Place ${plural(plan.total, 'piece')}` : effect ? effectHeadline(effect, view.settings.moveCap) : plural(plan.total, 'move');
  let detail = effect ? effectDetail(effect) : '';
  if (plan.kind === 'moves' && effect?.kind === 'draw') detail = 'No captured pieces can come back, so you get one move instead.';
  if (plan.kind === 'moves' && effect?.kind === 'number' && effect.value === 0) detail = 'Zero, but you’re in check: make one move to escape.';
  if (plan.kind === 'moves' && effect?.kind === 'number' && effect.value > plan.total) detail = `Capped from ${effect.value}. ${detail}`;
  if (plan.kind === 'drops') detail = 'Pick a piece from your pocket, then a highlighted square. Pawns can’t go on the first or last rank.';
  if (waiting) detail = plan.kind === 'drops' ? `${name} is placing pieces.` : `${name} is moving.`;
  return (
    <>
      <Heading title={title} detail={detail} />
      <Pips total={plan.total} remaining={plan.remaining} name={name} kind={plan.kind} />
    </>
  );
}

function Heading({ title, detail }: { title: string; detail: string }) {
  return (
    <div class="prompt">
      <h2 class="prompt__title">{title}</h2>
      {detail && <p class="prompt__detail">{detail}</p>}
    </div>
  );
}

function Pips({ total, remaining, name, kind }: { total: number; remaining: number; name: string; kind: 'moves' | 'drops' }) {
  const noun = kind === 'drops' ? 'piece' : 'move';
  return (
    <div class="pips" role="status" aria-label={`${name}: ${plural(remaining, noun)} left`}>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} class={`pip ${i < total - remaining ? 'pip--used' : ''}`} />
      ))}
      <span class="pips__label">{`${name}: ${remaining} of ${plural(total, noun)} left`}</span>
    </div>
  );
}

export function CardTable({ view, canAct, waitingOnOpponent, flipId, announcement, onDraw, onEndTurn, onChooseWild, onRematch }: CardTableProps) {
  const canDraw = canAct && view.phase.kind === 'draw';
  const plan = view.phase.kind === 'act' ? view.phase.plan : null;
  const canEndEarly = canAct && plan !== null && view.settings.allowEarlyEnd && plan.remaining < plan.total;
  const shown = view.discard.slice(-3);
  const deckLayers = Math.min(4, Math.ceil(view.drawPileCount / 25));
  return (
    <section class="card-table" aria-label="Cards">
      <div class="piles">
        <button
          type="button"
          class={`deck ${canDraw ? 'deck--ready' : ''}`}
          disabled={!canDraw}
          onClick={onDraw}
          aria-label={`Flip a card. ${plural(view.drawPileCount, 'card')} left in the deck.`}
        >
          {Array.from({ length: Math.max(1, deckLayers) }, (_, i) => (
            <CardBack key={i} class="deck__card"/>
          ))}
          <span class="deck__count">{view.drawPileCount}</span>
        </button>
        <div class="discard" aria-live="polite">
          {shown.length === 0 && <div class="discard__empty">Flip the first card</div>}
          {shown.map((card, i) => {
            const top = i === shown.length - 1;
            return (
              <div
                key={card.id}
                class={`discard__card ${top && card.id === flipId ? 'discard__card--flip' : ''}`}
                style={{ '--tilt': `${tilt(card)}deg` } as Record<string, string>}
              >
                <div class="flipper">
                  <UnoCard card={card} class="flipper__front" />
                  <CardBack class="flipper__back" />
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <Prompt view={view} waiting={waitingOnOpponent} />
      <div class="card-table__actions">
        {canEndEarly && (
          <button type="button" class="btn" onClick={onEndTurn}>
            End turn now
          </button>
        )}
        {canAct && view.phase.kind === 'wild' && (
          <button type="button" class="btn btn--primary" onClick={onChooseWild}>
            Choose what the wild does
          </button>
        )}
        {view.phase.kind === 'over' && (
          <button type="button" class="btn btn--primary" onClick={onRematch}>
            Rematch
          </button>
        )}
      </div>
      <p class="announcement" role="status" key={announcement?.key}>
        {announcement?.text}
      </p>
    </section>
  );
}
