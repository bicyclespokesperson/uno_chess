import { DROPPABLE_TYPES, type Color, type DroppableType } from '../engine/chess.ts';
import { pieceSrc } from './Board.tsx';
import { COLOR_NAME, PIECE_NAME, plural } from './text.ts';

export interface PlayerBarProps {
  name: string;
  color: Color;
  active: boolean;
  inCheck: boolean;
  pocket: DroppableType[];
  /** Pocket pieces that can be placed right now; empty when not placing. */
  droppable: Set<DroppableType>;
  selectedPocket: DroppableType | null;
  position: 'top' | 'bottom';
  onPocketPointerDown: (piece: DroppableType, e: PointerEvent) => void;
  onPocketActivate: (piece: DroppableType) => void;
  /** Online opponent whose connection dropped. */
  offline?: boolean;
}

export function PlayerBar(props: PlayerBarProps) {
  const counts = DROPPABLE_TYPES.map((t) => [t, props.pocket.filter((p) => p === t).length] as const).filter(([, n]) => n > 0);
  const placing = props.droppable.size > 0;
  return (
    <section class={`player player--${props.position} ${props.active ? 'player--active' : ''}`} aria-label={`${props.name}, ${COLOR_NAME[props.color]}`}>
      <div class="player__id">
        <span class={`army-chip army-chip--${props.color}`} aria-hidden="true" />
        <span class="player__name">{props.name}</span>
        <span class="player__army">{COLOR_NAME[props.color]}</span>
        {props.offline && <span class="player__offline">offline</span>}
        {props.active && <span class={`player__turn ${props.inCheck ? 'player__turn--check' : ''}`}>{props.inCheck ? 'in check' : 'to play'}</span>}
      </div>
      <div class={`pocket ${placing ? 'pocket--placing' : ''}`} aria-label={`Captured ${COLOR_NAME[props.color]} pieces`}>
        {counts.length === 0 && <span class="pocket__empty">No captured pieces</span>}
        {counts.map(([type, n]) => {
          const enabled = props.droppable.has(type);
          return (
            <button
              key={type}
              type="button"
              class={`pocket__piece ${props.selectedPocket === type ? 'pocket__piece--selected' : ''}`}
              disabled={placing && !enabled}
              tabIndex={enabled ? 0 : -1}
              aria-pressed={props.selectedPocket === type}
              aria-label={`${plural(n, PIECE_NAME[type])}${enabled ? ', place on board' : ''}`}
              onPointerDown={(e) => enabled && props.onPocketPointerDown(type, e as unknown as PointerEvent)}
              onKeyDown={(e) => {
                if (enabled && (e.key === 'Enter' || e.key === ' ')) {
                  e.preventDefault();
                  props.onPocketActivate(type);
                }
              }}
            >
              <img src={pieceSrc(props.color, type)} alt="" draggable={false} />
              {n > 1 && <span class="pocket__count">{n}</span>}
            </button>
          );
        })}
      </div>
    </section>
  );
}
