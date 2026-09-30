import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { inCheck, kingSquare, other, type DroppableType, type Move, type PromotionType, type Square } from '../engine/chess';
import {
  colorOf,
  currentPlayer,
  droppableTypes,
  dropSquares,
  movesFrom,
  otherPlayer,
  topCard,
  type Action,
  type GameEvent,
  type GameView,
  type PlayerId,
} from '../engine/game';
import type { GameClient } from '../net/client';
import { Board, pieceSrc, type TargetKind } from './Board';
import { CardTable } from './CardTable';
import { ConfirmModal, DrawOfferModal, GameOverModal, ResignModal, RulesModal, WildPicker } from './Modals';
import { PlayerBar } from './PlayerBar';
import { eventAnnouncement } from './text';
import { TurnLog } from './TurnLog';

const SPIN_MS = 1100;
const DRAG_THRESHOLD_PX = 5;

type DragSource = { kind: 'square'; sq: Square; pieceId: number; wasSelected: boolean } | { kind: 'pocket'; piece: DroppableType };

interface DragState {
  source: DragSource;
  pointerId: number;
  startX: number;
  startY: number;
  active: boolean;
}

interface Ghost {
  src: string;
  x: number;
  y: number;
  size: number;
}

type Overlay = 'rules' | 'resign' | 'newGame' | null;

const prefersReducedMotion = (): boolean => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

function squareFromPoint(x: number, y: number): Square | null {
  const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-square]');
  return el ? Number(el.dataset.square) : null;
}

export interface GameScreenProps {
  client: GameClient;
  onRematch: () => void;
  onNewGame: () => void;
}

export function GameScreen({ client, onRematch, onNewGame }: GameScreenProps) {
  const [view, setView] = useState<GameView>(client.getView());
  const [selected, setSelected] = useState<Square | null>(null);
  const [selectedPocket, setSelectedPocket] = useState<DroppableType | null>(null);
  const [promotion, setPromotion] = useState<{ from: Square; to: Square } | null>(null);
  const [announcement, setAnnouncement] = useState<{ text: string; key: number } | null>(null);
  const [flipId, setFlipId] = useState<number | null>(null);
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [showResult, setShowResult] = useState(true);
  const [wildPeek, setWildPeek] = useState(false);
  const [viewFlipped, setViewFlipped] = useState(false);
  const [ghost, setGhost] = useState<Ghost | null>(null);
  const [instantPieceId, setInstantPieceId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const boardWrapRef = useRef<HTMLDivElement>(null);
  const compactMenuRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    setView(client.getView());
    return client.subscribe((next: GameView, events: GameEvent[]) => {
      setView(next);
      setSelected(null);
      setPromotion(null);
      setWildPeek(false);
      const drawn = events.find((e) => e.type === 'cardDrawn');
      if (drawn?.type === 'cardDrawn') setFlipId(drawn.card.id);
      const texts = events.map((e) => eventAnnouncement(e, next)).filter((t): t is string => Boolean(t));
      if (texts.length) setAnnouncement({ text: texts.join(' '), key: Date.now() });
      if (events.some((e) => e.type === 'gameOver')) setShowResult(true);
    });
  }, [client]);

  useEffect(() => {
    if (!announcement) return;
    const t = setTimeout(() => setAnnouncement(null), 5000);
    return () => clearTimeout(t);
  }, [announcement]);

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 3500);
    return () => clearTimeout(t);
  }, [error]);

  const actor = currentPlayer(view);
  const canAct = client.localPlayers.includes(actor) && view.phase.kind !== 'over';
  const plan = view.phase.kind === 'act' ? view.phase.plan : null;
  const placing = canAct && plan?.kind === 'drops';
  const moving = canAct && plan?.kind === 'moves';

  const droppable = useMemo(() => new Set(placing ? droppableTypes(view) : []), [view, placing]);

  // Keep a sensible pocket selection while placing: auto-pick when there's only one kind of piece.
  useEffect(() => {
    if (!placing) return setSelectedPocket(null);
    if (selectedPocket && droppable.has(selectedPocket)) return;
    setSelectedPocket(droppable.size === 1 ? [...droppable][0] : null);
  }, [placing, droppable]);

  // Board orientation follows seats: each player's army sits on their side, so a Reverse spins the board.
  const bottomSeat: PlayerId = viewFlipped ? 'p2' : 'p1';
  const targetWhiteAtBottom = view.armies.w === bottomSeat;
  const [shownWhiteAtBottom, setShownWhiteAtBottom] = useState(targetWhiteAtBottom);
  const [spinning, setSpinning] = useState(false);
  useEffect(() => {
    if (targetWhiteAtBottom === shownWhiteAtBottom) return;
    if (prefersReducedMotion()) return setShownWhiteAtBottom(targetWhiteAtBottom);
    setSpinning(true);
    const t = setTimeout(() => {
      setShownWhiteAtBottom(targetWhiteAtBottom);
      setSpinning(false);
    }, SPIN_MS);
    return () => clearTimeout(t);
  }, [targetWhiteAtBottom]);

  const dispatch = useCallback(
    async (action: Action, as: PlayerId = actor) => {
      const result = await client.dispatch(as, action);
      if (!result.ok) setError(result.error);
      return result.ok;
    },
    [client, actor],
  );

  const targets = useMemo(() => {
    const map = new Map<Square, TargetKind>();
    if (selected === null || !moving) return map;
    for (const m of movesFrom(view, selected)) {
      const occupied = view.position.board[m.to] !== null;
      const enPassant = view.position.board[m.from]?.type === 'p' && m.to === view.position.ep;
      map.set(m.to, occupied || enPassant ? 'capture' : 'move');
    }
    return map;
  }, [selected, view, moving]);

  const dropTargets = useMemo(
    () => new Set(placing && selectedPocket ? dropSquares(view, selectedPocket) : []),
    [view, placing, selectedPocket],
  );

  const attemptMove = (from: Square, to: Square, instant: boolean) => {
    const candidates: Move[] = movesFrom(view, from).filter((m) => m.to === to);
    if (candidates.length === 0) return false;
    const piece = view.position.board[from];
    if (candidates.some((m) => m.promotion)) {
      setPromotion({ from, to });
      return true;
    }
    if (instant && piece) setInstantPieceId(piece.id);
    void dispatch({ type: 'move', move: { from, to } });
    return true;
  };

  const choosePromotion = (type: PromotionType) => {
    if (!promotion) return;
    void dispatch({ type: 'move', move: { ...promotion, promotion: type } });
    setPromotion(null);
  };

  const isOwnMovable = (sq: Square) => moving && view.position.board[sq]?.color === view.turn && movesFrom(view, sq).length > 0;

  const activateSquare = (sq: Square) => {
    setInstantPieceId(null);
    if (placing) {
      if (selectedPocket && dropTargets.has(sq)) void dispatch({ type: 'drop', piece: selectedPocket, to: sq });
      return;
    }
    if (!moving) return;
    if (selected !== null && selected !== sq && attemptMove(selected, sq, false)) return;
    if (selected === sq) return setSelected(null);
    setSelected(isOwnMovable(sq) ? sq : null);
  };

  const onSquarePointerDown = (sq: Square, e: PointerEvent) => {
    if (e.button !== 0 || spinning || promotion) return;
    setInstantPieceId(null);
    if (placing) return activateSquare(sq);
    if (!moving) return;
    if (selected !== null && selected !== sq && targets.has(sq)) return void attemptMove(selected, sq, false);
    const piece = view.position.board[sq];
    if (!piece || !isOwnMovable(sq)) return setSelected(null);
    e.preventDefault();
    dragRef.current = {
      source: { kind: 'square', sq, pieceId: piece.id, wasSelected: selected === sq },
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      active: false,
    };
    setSelected(sq);
  };

  const onPocketPointerDown = (piece: DroppableType, e: PointerEvent) => {
    if (e.button !== 0 || !placing) return;
    e.preventDefault();
    setSelectedPocket(piece);
    dragRef.current = { source: { kind: 'pocket', piece }, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, active: false };
  };

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || e.pointerId !== drag.pointerId) return;
      if (!drag.active && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < DRAG_THRESHOLD_PX) return;
      drag.active = true;
      const size = (boardWrapRef.current?.getBoundingClientRect().width ?? 480) / 8;
      const src =
        drag.source.kind === 'pocket'
          ? pieceSrc(view.turn, drag.source.piece)
          : pieceSrc(view.turn, view.position.board[drag.source.sq]?.type ?? 'p');
      setGhost({ src, x: e.clientX, y: e.clientY, size });
    };
    const onUp = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || e.pointerId !== drag.pointerId) return;
      dragRef.current = null;
      setGhost(null);
      const target = drag.active ? squareFromPoint(e.clientX, e.clientY) : null;
      if (drag.source.kind === 'pocket') {
        if (target !== null && dropTargets.has(target)) void dispatch({ type: 'drop', piece: drag.source.piece, to: target });
        return;
      }
      if (!drag.active) {
        if (drag.source.wasSelected) setSelected(null);
        return;
      }
      if (target !== null && target !== drag.source.sq) attemptMove(drag.source.sq, target, true);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  });

  const draw = () => void dispatch({ type: 'draw' });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (overlay || e.metaKey || e.ctrlKey || e.altKey) return;
      if ((e.target as HTMLElement)?.closest?.('input, textarea, select')) return;
      if (e.key === 'f' && canAct && view.phase.kind === 'draw') draw();
      if (e.key === 'Escape') {
        setSelected(null);
        setPromotion(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const checkedColor = view.result?.reason === 'checkmate' && view.result.winningColor ? other(view.result.winningColor) : view.turn;
  const checkSquare = inCheck(view.position, checkedColor) ? kingSquare(view.position, checkedColor) : null;
  const top = topCard(view);
  const accent = top && 'color' in top ? `var(--uno-${top.color})` : 'var(--wild-accent)';
  const accentInk = top && 'color' in top && top.color !== 'yellow' ? '#fff' : '#000';
  const topSeat = otherPlayer(bottomSeat);
  const seats: [PlayerId, 'top' | 'bottom'][] = [
    [topSeat, 'top'],
    [bottomSeat, 'bottom'],
  ];
  const bars = Object.fromEntries(
    seats.map(([p, where]) => {
      const color = colorOf(view, p);
      const active = actor === p && view.phase.kind !== 'over';
      return [
        where,
        <PlayerBar
          key={p}
          name={view.players[p].name}
          color={color}
          active={active}
          inCheck={active && checkSquare !== null && view.phase.kind !== 'over'}
          pocket={view.pockets[color]}
          droppable={active && placing ? droppable : new Set()}
          selectedPocket={active ? selectedPocket : null}
          position={where}
          onPocketPointerDown={onPocketPointerDown}
          onPocketActivate={setSelectedPocket}
        />,
      ];
    }),
  );

  const resignCandidates = client.localPlayers;

  const menuItems = (
    <>
      <button type="button" class="btn btn--quiet" onClick={() => setOverlay('rules')}>
        How to play
      </button>
      <button type="button" class="btn btn--quiet" onClick={() => setViewFlipped((f) => !f)} disabled={spinning}>
        Flip board
      </button>
      {view.phase.kind !== 'over' && (
        <>
          <button type="button" class="btn btn--quiet" onClick={() => void dispatch({ type: 'offerDraw' }, canAct ? actor : client.localPlayers[0])} disabled={view.drawOffer !== null}>
            Offer draw
          </button>
          <button type="button" class="btn btn--quiet" onClick={() => setOverlay('resign')}>
            Resign
          </button>
        </>
      )}
      <button type="button" class="btn btn--quiet" onClick={() => (view.phase.kind === 'over' ? onNewGame() : setOverlay('newGame'))}>
        New game
      </button>
    </>
  );

  return (
    <div class="game" style={{ '--accent': accent, '--accent-ink': accentInk } as Record<string, string>}>
      <header class="topbar">
        <h1 class="wordmark">
          Uno<span>Chess</span>
        </h1>
        <nav class="menu" aria-label="Game">
          {menuItems}
        </nav>
        <details class="menu-compact" ref={compactMenuRef}>
          <summary class="btn">Menu</summary>
          <div class="menu-compact__list" onClick={() => compactMenuRef.current?.removeAttribute('open')}>
            {menuItems}
          </div>
        </details>
      </header>

      <main class="layout">
        <div class="board-column">
          {bars.top}
          <div class={`board-wrap ${spinning ? 'board-wrap--spinning' : ''}`} ref={boardWrapRef}>
            <Board
              position={view.position}
              whiteAtBottom={shownWhiteAtBottom}
              lastAction={view.lastAction}
              selected={selected}
              targets={targets}
              dropTargets={dropTargets}
              checkSquare={checkSquare}
              interactive={canAct && !spinning}
              hiddenPieceId={ghost && dragRef.current?.source.kind === 'square' ? dragRef.current.source.pieceId : null}
              instantPieceId={instantPieceId}
              promotion={
                promotion
                  ? { to: promotion.to, color: view.turn, onPick: choosePromotion, onCancel: () => setPromotion(null) }
                  : null
              }
              onSquarePointerDown={onSquarePointerDown}
              onSquareActivate={activateSquare}
            />
          </div>
          {bars.bottom}
        </div>
        <aside class="side-column">
          <CardTable
            view={view}
            canAct={canAct && !spinning}
            flipId={flipId}
            announcement={announcement}
            onDraw={draw}
            onEndTurn={() => void dispatch({ type: 'endTurn' })}
            onChooseWild={() => setWildPeek(false)}
            onRematch={onRematch}
          />
          {error && (
            <p class="error" role="alert">
              {error}
            </p>
          )}
          <TurnLog view={view} />
        </aside>
      </main>

      {ghost && (
        <img
          class="drag-ghost"
          src={ghost.src}
          alt=""
          style={{ width: `${ghost.size}px`, height: `${ghost.size}px`, transform: `translate(${ghost.x - ghost.size / 2}px, ${ghost.y - ghost.size / 2}px)` }}
        />
      )}

      {view.phase.kind === 'wild' && canAct && !spinning && !wildPeek && (
        <WildPicker
          settings={view.settings}
          name={view.players[actor].name}
          onPick={(effect) => void dispatch({ type: 'chooseWild', effect })}
          onPeek={() => setWildPeek(true)}
        />
      )}
      {view.drawOffer && client.localPlayers.includes(otherPlayer(view.drawOffer)) && (
        <DrawOfferModal view={view} onAnswer={(accept) => void dispatch({ type: 'answerDraw', accept }, otherPlayer(view.drawOffer!))} />
      )}
      {view.phase.kind === 'over' && showResult && (
        <GameOverModal view={view} onRematch={onRematch} onNewGame={onNewGame} onClose={() => setShowResult(false)} />
      )}
      {overlay === 'rules' && <RulesModal onClose={() => setOverlay(null)} />}
      {overlay === 'resign' && (
        <ResignModal
          view={view}
          candidates={resignCandidates}
          onClose={() => setOverlay(null)}
          onResign={(p) => {
            setOverlay(null);
            void dispatch({ type: 'resign' }, p);
          }}
        />
      )}
      {overlay === 'newGame' && (
        <ConfirmModal
          title="Start a new game?"
          lead="This game will be lost."
          confirm="Abandon this game"
          onConfirm={onNewGame}
          onClose={() => setOverlay(null)}
        />
      )}
    </div>
  );
}
