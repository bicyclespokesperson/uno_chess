import {
  DROPPABLE_TYPES,
  PROMOTION_TYPES,
  applyDrop,
  applyMove,
  dropToSan,
  hasLegalMove,
  inCheck,
  initialPosition,
  isDropSquareOk,
  isLegalMove,
  legalDropSquares,
  legalMoves,
  moveToSan,
  other,
  type Color,
  type DroppableType,
  type Move,
  type Position,
  type Square,
} from './chess.ts';
import { cardEffect, shuffle, standardDeck, type Card, type Effect } from './cards.ts';

export type PlayerId = 'p1' | 'p2';
export const PLAYER_IDS: PlayerId[] = ['p1', 'p2'];
export const otherPlayer = (p: PlayerId): PlayerId => (p === 'p1' ? 'p2' : 'p1');

export interface Settings {
  /** Number cards above this count as this many moves. 9 means uncapped. */
  moveCap: number;
  /** Lets a player stop before using every move/drop their card gave them. */
  allowEarlyEnd: boolean;
}

export const DEFAULT_SETTINGS: Settings = { moveCap: 3, allowEarlyEnd: true };
export const MOVE_CAP_OPTIONS = [2, 3, 4, 5, 9] as const;

export interface Plan {
  kind: 'moves' | 'drops';
  total: number;
  remaining: number;
}

export type Phase = { kind: 'draw' } | { kind: 'wild' } | { kind: 'act'; plan: Plan } | { kind: 'over' };

export type EndReason = 'checkmate' | 'stalemate' | 'resignation' | 'agreement';

export interface Result {
  winner: PlayerId | null;
  winningColor: Color | null;
  reason: EndReason;
}

export type TurnEndReason = 'done' | 'check' | 'zero' | 'noMoves' | 'pocketEmpty' | 'noDropSquares' | 'early';

export type TurnNote =
  | 'capped'
  | 'zero'
  | 'zeroInCheck'
  | 'skip'
  | 'reverse'
  | 'noPocket'
  | 'noDropSquares'
  | 'checkEndsTurn'
  | 'noMovesLeft'
  | 'endedEarly'
  | 'reshuffled';

/** One card flip and everything it caused. */
export interface TurnRecord {
  n: number;
  player: PlayerId;
  color: Color;
  card: Card;
  effect: Effect | null;
  actions: string[];
  notes: TurnNote[];
}

export interface GameState {
  version: 1;
  seed: number;
  rng: number;
  settings: Settings;
  players: Record<PlayerId, { name: string }>;
  /** Which player currently commands each army. Reverse cards swap these. */
  armies: Record<Color, PlayerId>;
  /** The army whose card-turn it is. */
  turn: Color;
  position: Position;
  /** Captured pieces of each color, waiting to be dropped back by a +2/+4. */
  pockets: Record<Color, DroppableType[]>;
  drawPile: Card[];
  /** Face-up pile; the last element is the top card. */
  discard: Card[];
  phase: Phase;
  history: TurnRecord[];
  lastAction: { from: Square | null; to: Square } | null;
  drawOffer: PlayerId | null;
  result: Result | null;
  /** Increments on every accepted action; lets a network client detect stale state. */
  seq: number;
}

export type Action =
  | { type: 'draw' }
  | { type: 'chooseWild'; effect: Effect }
  | { type: 'move'; move: Move }
  | { type: 'drop'; piece: DroppableType; to: Square }
  | { type: 'endTurn' }
  | { type: 'resign' }
  | { type: 'offerDraw' }
  | { type: 'answerDraw'; accept: boolean };

export type GameEvent =
  | { type: 'cardDrawn'; card: Card; player: PlayerId }
  | { type: 'reshuffled' }
  | { type: 'wildChosen'; effect: Effect }
  | { type: 'skip'; player: PlayerId }
  | { type: 'reverse'; armies: Record<Color, PlayerId> }
  | { type: 'moved'; san: string; capture: boolean }
  | { type: 'dropped'; san: string }
  | { type: 'turnEnded'; reason: TurnEndReason; next: PlayerId }
  | { type: 'drawOffered'; by: PlayerId }
  | { type: 'drawDeclined'; by: PlayerId }
  | { type: 'gameOver'; result: Result };

export interface ActionOutcome {
  state: GameState;
  events: GameEvent[];
}

export class GameError extends Error {}

export interface NewGameOptions {
  names: Record<PlayerId, string>;
  whitePlayer: PlayerId;
  settings?: Partial<Settings>;
  seed: number;
}

export function createGame({ names, whitePlayer, settings, seed }: NewGameOptions): GameState {
  const [drawPile, rng] = shuffle(standardDeck(), seed);
  return {
    version: 1,
    seed,
    rng,
    settings: { ...DEFAULT_SETTINGS, ...settings },
    players: { p1: { name: names.p1 }, p2: { name: names.p2 } },
    armies: { w: whitePlayer, b: otherPlayer(whitePlayer) },
    turn: 'w',
    position: initialPosition(),
    pockets: { w: [], b: [] },
    drawPile,
    discard: [],
    phase: { kind: 'draw' },
    history: [],
    lastAction: null,
    drawOffer: null,
    result: null,
    seq: 0,
  };
}

/**
 * Everything a player is allowed to see. The deck order and RNG are secrets a server would keep;
 * the UI only ever receives this view, even in local hot-seat play.
 */
export type GameView = Omit<GameState, 'drawPile' | 'rng' | 'seed'> & { drawPileCount: number };

export function toView(s: GameState): GameView {
  const { drawPile, rng: _rng, seed: _seed, ...visible } = s;
  return { ...visible, drawPileCount: drawPile.length };
}

type Viewable = Omit<GameState, 'drawPile' | 'rng' | 'seed'>;

export const currentPlayer = (s: Viewable): PlayerId => s.armies[s.turn];
export const colorOf = (s: Viewable, player: PlayerId): Color => (s.armies.w === player ? 'w' : 'b');
export const topCard = (s: Viewable): Card | null => s.discard[s.discard.length - 1] ?? null;
export const currentRecord = (s: Viewable): TurnRecord | null => s.history[s.history.length - 1] ?? null;

export function wildOptions(settings: Settings): Effect[] {
  const numbers = Array.from({ length: Math.min(settings.moveCap, 9) }, (_, i): Effect => ({ kind: 'number', value: i + 1 }));
  return [...numbers, { kind: 'skip' }, { kind: 'reverse' }, { kind: 'draw', count: 2 }];
}

function isAllowedWildChoice(settings: Settings, effect: Effect): boolean {
  return wildOptions(settings).some((o) => JSON.stringify(o) === JSON.stringify(effect));
}

/** Legal destination moves for the piece on `from`, when the current player may move. */
export function movesFrom(s: Viewable, from: Square): Move[] {
  if (s.phase.kind !== 'act' || s.phase.plan.kind !== 'moves') return [];
  return legalMoves(s.position, s.turn).filter((m) => m.from === from);
}

export function dropSquares(s: Viewable, piece: DroppableType): Square[] {
  if (s.phase.kind !== 'act' || s.phase.plan.kind !== 'drops') return [];
  if (!s.pockets[s.turn].includes(piece)) return [];
  return legalDropSquares(s.position, s.turn, piece);
}

export function droppableTypes(s: Viewable): DroppableType[] {
  const unique = [...new Set(s.pockets[s.turn])];
  return unique.filter((t) => legalDropSquares(s.position, s.turn, t).length > 0);
}

const canDropAny = (s: Viewable): boolean => droppableTypes(s).length > 0;

const isSquare = (v: unknown): v is Square => Number.isInteger(v) && (v as number) >= 0 && (v as number) < 64;
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

function isEffect(v: unknown): v is Effect {
  if (!isObject(v)) return false;
  switch (v.kind) {
    case 'number': return Number.isInteger(v.value);
    case 'skip':
    case 'reverse': return true;
    case 'draw': return Number.isInteger(v.count);
    default: return false;
  }
}

/** Actions can arrive from the network, so check their shape before trusting any field. */
export function isValidAction(a: unknown): a is Action {
  if (!isObject(a)) return false;
  switch (a.type) {
    case 'draw':
    case 'endTurn':
    case 'resign':
    case 'offerDraw':
      return true;
    case 'chooseWild': return isEffect(a.effect);
    case 'answerDraw': return typeof a.accept === 'boolean';
    case 'drop': return (DROPPABLE_TYPES as unknown[]).includes(a.piece) && isSquare(a.to);
    case 'move': {
      const m = a.move;
      return isObject(m) && isSquare(m.from) && isSquare(m.to) && (m.promotion === undefined || (PROMOTION_TYPES as unknown[]).includes(m.promotion));
    }
    default: return false;
  }
}

export const isPlayerId = (v: unknown): v is PlayerId => v === 'p1' || v === 'p2';

export function applyAction(state: GameState, actor: PlayerId, action: Action): ActionOutcome {
  if (!isPlayerId(actor) || !isValidAction(action)) throw new GameError('That request didn’t make sense.');
  if (state.phase.kind === 'over') throw new GameError('The game is over.');
  const s = structuredClone(state);
  const events: GameEvent[] = [];
  switch (action.type) {
    case 'draw': drawCard(s, actor, events); break;
    case 'chooseWild': chooseWild(s, actor, action.effect, events); break;
    case 'move': makeMove(s, actor, action.move, events); break;
    case 'drop': makeDrop(s, actor, action.piece, action.to, events); break;
    case 'endTurn': endTurnEarly(s, actor, events); break;
    case 'resign': resign(s, actor, events); break;
    case 'offerDraw': offerDraw(s, actor, events); break;
    case 'answerDraw': answerDraw(s, actor, action.accept, events); break;
  }
  s.seq++;
  return { state: s, events };
}

function requireTurn(s: GameState, actor: PlayerId): void {
  if (currentPlayer(s) !== actor) throw new GameError(`It's ${s.players[currentPlayer(s)].name}'s turn.`);
}

function requirePlan(s: GameState, kind: Plan['kind']): Plan {
  if (s.phase.kind !== 'act' || s.phase.plan.kind !== kind) {
    throw new GameError(kind === 'moves' ? 'You can’t move a piece right now.' : 'You can’t place a piece right now.');
  }
  return s.phase.plan;
}

function takeCard(s: GameState, events: GameEvent[]): Card {
  if (s.drawPile.length === 0) {
    const top = s.discard.pop();
    [s.drawPile, s.rng] = shuffle(s.discard, s.rng);
    s.discard = top ? [top] : [];
    events.push({ type: 'reshuffled' });
  }
  const card = s.drawPile.pop();
  if (!card) throw new GameError('The deck is empty.');
  return card;
}

function drawCard(s: GameState, actor: PlayerId, events: GameEvent[]): void {
  requireTurn(s, actor);
  if (s.phase.kind !== 'draw') throw new GameError('Finish this card before flipping another.');
  const card = takeCard(s, events);
  s.discard.push(card);
  s.history.push({
    n: s.history.length + 1,
    player: actor,
    color: s.turn,
    card,
    effect: null,
    actions: [],
    notes: events.some((e) => e.type === 'reshuffled') ? ['reshuffled'] : [],
  });
  events.push({ type: 'cardDrawn', card, player: actor });
  const effect = cardEffect(card);
  if (effect) resolveEffect(s, effect, events);
  else s.phase = { kind: 'wild' };
}

function chooseWild(s: GameState, actor: PlayerId, effect: Effect, events: GameEvent[]): void {
  requireTurn(s, actor);
  if (s.phase.kind !== 'wild') throw new GameError('There is no wild card to choose for.');
  if (!isAllowedWildChoice(s.settings, effect)) throw new GameError('That isn’t a valid wild choice.');
  events.push({ type: 'wildChosen', effect });
  resolveEffect(s, effect, events);
}

function resolveEffect(s: GameState, effect: Effect, events: GameEvent[]): void {
  const record = currentRecord(s)!;
  record.effect = effect;
  switch (effect.kind) {
    case 'number': {
      const moves = Math.min(effect.value, s.settings.moveCap);
      if (moves < effect.value) record.notes.push('capped');
      if (moves > 0) return startPlan(s, 'moves', moves, events);
      if (inCheck(s.position, s.turn)) {
        record.notes.push('zeroInCheck');
        return startPlan(s, 'moves', 1, events);
      }
      record.notes.push('zero');
      return endTurn(s, 'zero', events);
    }
    case 'skip':
      record.notes.push('skip');
      events.push({ type: 'skip', player: currentPlayer(s) });
      s.phase = { kind: 'draw' };
      return;
    case 'reverse':
      record.notes.push('reverse');
      s.armies = { w: s.armies.b, b: s.armies.w };
      events.push({ type: 'reverse', armies: { ...s.armies } });
      s.phase = { kind: 'draw' };
      return;
    case 'draw': {
      if (canDropAny(s)) return startPlan(s, 'drops', Math.min(effect.count, s.pockets[s.turn].length), events);
      record.notes.push(s.pockets[s.turn].length === 0 ? 'noPocket' : 'noDropSquares');
      return startPlan(s, 'moves', 1, events);
    }
  }
}

function startPlan(s: GameState, kind: Plan['kind'], total: number, events: GameEvent[]): void {
  s.phase = { kind: 'act', plan: { kind, total, remaining: total } };
  if (kind === 'moves' && !hasLegalMove(s.position, s.turn)) {
    const mated = inCheck(s.position, s.turn);
    const winner = mated ? other(s.turn) : null;
    gameOver(s, { winner: winner && s.armies[winner], winningColor: winner, reason: mated ? 'checkmate' : 'stalemate' }, events);
  }
}

function makeMove(s: GameState, actor: PlayerId, move: Move, events: GameEvent[]): void {
  requireTurn(s, actor);
  requirePlan(s, 'moves');
  const normalized: Move = move.promotion ? move : { from: move.from, to: move.to };
  if (!isLegalMove(s.position, s.turn, normalized)) throw new GameError('That move isn’t legal.');
  const san = moveToSan(s.position, s.turn, normalized);
  const { position, captured } = applyMove(s.position, normalized);
  s.position = position;
  if (captured) s.pockets[captured.color].push(captured.promoted ? 'p' : (captured.type as DroppableType));
  s.lastAction = { from: normalized.from, to: normalized.to };
  currentRecord(s)!.actions.push(san);
  events.push({ type: 'moved', san, capture: Boolean(captured) });
  afterAction(s, events);
}

function makeDrop(s: GameState, actor: PlayerId, piece: DroppableType, to: Square, events: GameEvent[]): void {
  requireTurn(s, actor);
  requirePlan(s, 'drops');
  const pocket = s.pockets[s.turn];
  const index = pocket.indexOf(piece);
  if (index < 0) throw new GameError('That piece isn’t in your pocket.');
  if (!isDropSquareOk(s.position, s.turn, piece, to)) throw new GameError('You can’t place that piece there.');
  const san = dropToSan(s.position, s.turn, piece, to);
  s.position = applyDrop(s.position, s.turn, piece, to);
  pocket.splice(index, 1);
  s.lastAction = { from: null, to };
  currentRecord(s)!.actions.push(san);
  events.push({ type: 'dropped', san });
  afterAction(s, events);
}

function afterAction(s: GameState, events: GameEvent[]): void {
  const plan = (s.phase as { kind: 'act'; plan: Plan }).plan;
  plan.remaining--;
  const enemy = other(s.turn);
  if (inCheck(s.position, enemy)) {
    if (!hasLegalMove(s.position, enemy)) {
      return gameOver(s, { winner: currentPlayer(s), winningColor: s.turn, reason: 'checkmate' }, events);
    }
    if (plan.remaining > 0) currentRecord(s)!.notes.push('checkEndsTurn');
    return endTurn(s, plan.remaining > 0 ? 'check' : 'done', events);
  }
  if (plan.remaining === 0) return endTurn(s, 'done', events);
  if (plan.kind === 'drops' && !canDropAny(s)) {
    return endTurn(s, s.pockets[s.turn].length === 0 ? 'pocketEmpty' : 'noDropSquares', events);
  }
  if (plan.kind === 'moves' && !hasLegalMove(s.position, s.turn)) {
    currentRecord(s)!.notes.push('noMovesLeft');
    return endTurn(s, 'noMoves', events);
  }
}

function endTurn(s: GameState, reason: TurnEndReason, events: GameEvent[]): void {
  s.turn = other(s.turn);
  s.phase = { kind: 'draw' };
  events.push({ type: 'turnEnded', reason, next: currentPlayer(s) });
}

function endTurnEarly(s: GameState, actor: PlayerId, events: GameEvent[]): void {
  requireTurn(s, actor);
  if (s.phase.kind !== 'act') throw new GameError('There’s no turn in progress to end.');
  if (!s.settings.allowEarlyEnd) throw new GameError('Ending a turn early is turned off for this game.');
  const { plan } = s.phase;
  if (plan.remaining === plan.total) throw new GameError('Make at least one move before ending your turn.');
  currentRecord(s)!.notes.push('endedEarly');
  endTurn(s, 'early', events);
}

function resign(s: GameState, actor: PlayerId, events: GameEvent[]): void {
  const winner = otherPlayer(actor);
  gameOver(s, { winner, winningColor: colorOf(s, winner), reason: 'resignation' }, events);
}

function offerDraw(s: GameState, actor: PlayerId, events: GameEvent[]): void {
  if (s.drawOffer) throw new GameError('A draw offer is already waiting for an answer.');
  s.drawOffer = actor;
  events.push({ type: 'drawOffered', by: actor });
}

function answerDraw(s: GameState, actor: PlayerId, accept: boolean, events: GameEvent[]): void {
  if (!s.drawOffer) throw new GameError('There’s no draw offer to answer.');
  if (s.drawOffer === actor) throw new GameError('You can’t answer your own draw offer.');
  s.drawOffer = null;
  if (accept) gameOver(s, { winner: null, winningColor: null, reason: 'agreement' }, events);
  else events.push({ type: 'drawDeclined', by: actor });
}

function gameOver(s: GameState, result: Result, events: GameEvent[]): void {
  s.phase = { kind: 'over' };
  s.result = result;
  s.drawOffer = null;
  events.push({ type: 'gameOver', result });
}
