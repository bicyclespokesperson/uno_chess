import { useEffect, useRef } from 'preact/hooks';
import { cardLabel, effectLabel } from '../engine/cards.ts';
import type { GameView } from '../engine/game.ts';
import { COLOR_NAME, noteText } from './text.ts';

export function TurnLog({ view }: { view: GameView }) {
  const listRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [view.history.length, view.seq]);

  return (
    <section class="log" aria-label="Turn history">
      <h2 class="log__title">History</h2>
      {view.history.length === 0 ? (
        <p class="log__empty">Every card and move lands here.</p>
      ) : (
        <ol class="log__list" ref={listRef}>
          {view.history.map((r) => {
            const color = 'color' in r.card ? r.card.color : 'wild';
            const wildAs = (r.card.kind === 'wild') && r.effect ? ` as ${effectLabel(r.effect)}` : '';
            return (
              <li key={r.n} class="log__row">
                <span class={`chip chip--${color}`} title={cardLabel(r.card)}>
                  {cardLabel(r.card).replace(/^(Red|Yellow|Green|Blue) /, '')}
                  {wildAs}
                </span>
                <span class="log__who">
                  {view.players[r.player].name}
                  <span class="log__color"> {COLOR_NAME[r.color]}</span>
                </span>
                <span class="log__moves">
                  {r.actions.join(' ')}
                  {r.notes.length > 0 && <span class="log__notes">{r.actions.length ? ' · ' : ''}{r.notes.map(noteText).join(', ')}</span>}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
