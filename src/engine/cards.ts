export type CardColor = 'red' | 'yellow' | 'green' | 'blue';
export const CARD_COLORS: CardColor[] = ['red', 'yellow', 'green', 'blue'];

export type Card =
  | { id: number; kind: 'number'; color: CardColor; value: number }
  | { id: number; kind: 'skip' | 'reverse' | 'draw2'; color: CardColor }
  | { id: number; kind: 'wild' | 'wild4' };

/** What a card does once any wild choice is made. */
export type Effect =
  | { kind: 'number'; value: number }
  | { kind: 'skip' }
  | { kind: 'reverse' }
  | { kind: 'draw'; count: number };

/** The standard 108-card deck: per color one 0, two each of 1–9, Skip, Reverse, Draw Two; plus 4 Wild and 4 Wild Draw Four. */
export function standardDeck(): Card[] {
  const cards: Card[] = [];
  let id = 1;
  for (const color of CARD_COLORS) {
    cards.push({ id: id++, kind: 'number', color, value: 0 });
    for (let copy = 0; copy < 2; copy++) {
      for (let value = 1; value <= 9; value++) cards.push({ id: id++, kind: 'number', color, value });
      for (const kind of ['skip', 'reverse', 'draw2'] as const) cards.push({ id: id++, kind, color });
    }
  }
  for (let i = 0; i < 4; i++) cards.push({ id: id++, kind: 'wild' });
  for (let i = 0; i < 4; i++) cards.push({ id: id++, kind: 'wild4' });
  return cards;
}

export function cardEffect(card: Card): Effect | null {
  switch (card.kind) {
    case 'number': return { kind: 'number', value: card.value };
    case 'skip': return { kind: 'skip' };
    case 'reverse': return { kind: 'reverse' };
    case 'draw2': return { kind: 'draw', count: 2 };
    case 'wild4': return { kind: 'draw', count: 4 };
    case 'wild': return null;
  }
}

export function cardLabel(card: Card): string {
  const color = 'color' in card ? card.color[0].toUpperCase() + card.color.slice(1) + ' ' : '';
  switch (card.kind) {
    case 'number': return `${color}${card.value}`;
    case 'skip': return `${color}Skip`;
    case 'reverse': return `${color}Reverse`;
    case 'draw2': return `${color}+2`;
    case 'wild': return 'Wild';
    case 'wild4': return 'Wild +4';
  }
}

export function effectLabel(effect: Effect): string {
  switch (effect.kind) {
    case 'number': return String(effect.value);
    case 'skip': return 'Skip';
    case 'reverse': return 'Reverse';
    case 'draw': return `+${effect.count}`;
  }
}

/** mulberry32: tiny, fast, and deterministic so a server can replay a game from its seed. */
export function nextRandom(seed: number): [value: number, nextSeed: number] {
  const nextSeed = (seed + 0x6d2b79f5) | 0;
  let t = nextSeed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, nextSeed];
}

export function shuffle<T>(items: T[], seed: number): [shuffled: T[], nextSeed: number] {
  const out = items.slice();
  let s = seed;
  for (let i = out.length - 1; i > 0; i--) {
    let r: number;
    [r, s] = nextRandom(s);
    const j = Math.floor(r * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return [out, s];
}
