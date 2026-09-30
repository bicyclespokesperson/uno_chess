import type { Card, CardColor } from '../engine/cards.ts';

const FILL: Record<CardColor, string> = {
  red: 'var(--uno-red)',
  yellow: 'var(--uno-yellow)',
  green: 'var(--uno-green)',
  blue: 'var(--uno-blue)',
};

const WILD_QUADRANTS: CardColor[] = ['red', 'blue', 'yellow', 'green'];

function Glyph({ card, size, x, y, color }: { card: Card; size: number; x: number; y: number; color: string }) {
  const text = (value: string, scale = 1) => (
    <text
      x={x}
      y={y}
      font-size={size * scale}
      text-anchor="middle"
      dominant-baseline="central"
      class="uno-card__numeral"
      fill={color}
      stroke="#000"
      stroke-width={size * 0.06}
      paint-order="stroke"
    >
      {value}
    </text>
  );
  const s = size / 60;
  switch (card.kind) {
    case 'number': return text(String(card.value));
    case 'draw2': return text('+2', 0.8);
    case 'wild4': return text('+4', 0.8);
    case 'skip':
      return (
        <g transform={`translate(${x} ${y}) scale(${s})`} fill="none" stroke={color} stroke-width="9">
          <circle r="20" stroke="#000" stroke-width="15" />
          <line x1="-14" y1="14" x2="14" y2="-14" stroke="#000" stroke-width="15" />
          <circle r="20" />
          <line x1="-14" y1="14" x2="14" y2="-14" />
        </g>
      );
    case 'reverse':
      return (
        <g transform={`translate(${x} ${y}) scale(${s}) rotate(-45)`} stroke="#000" stroke-width="3" fill={color}>
          <path d="M-6 -24 L14 -12 L-6 0 L-6 -7 L-18 -7 L-18 -17 L-6 -17 Z" />
          <path d="M6 24 L-14 12 L6 0 L6 7 L18 7 L18 17 L6 17 Z" />
        </g>
      );
    case 'wild':
      return (
        <g transform={`translate(${x} ${y}) scale(${s}) rotate(28)`} stroke="#000" stroke-width="2.5">
          {WILD_QUADRANTS.map((c, i) => {
            const a0 = (i * Math.PI) / 2;
            const a1 = a0 + Math.PI / 2;
            const [rx, ry] = [16, 24];
            return (
              <path
                key={c}
                fill={FILL[c]}
                d={`M0 0 L${rx * Math.cos(a0)} ${ry * Math.sin(a0)} A${rx} ${ry} 0 0 1 ${rx * Math.cos(a1)} ${ry * Math.sin(a1)} Z`}
              />
            );
          })}
        </g>
      );
  }
}

export function UnoCard({ card, class: className = '' }: { card: Card; class?: string }) {
  const isWild = !('color' in card);
  const face = 'color' in card ? FILL[card.color] : '#000';
  const ink = 'color' in card ? FILL[card.color] : '#fff';
  return (
    <svg class={`uno-card ${className}`} viewBox="0 0 120 180" role="img" aria-label={describeCard(card)}>
      <rect x="1" y="1" width="118" height="178" rx="12" fill="#fff" stroke="rgba(0,0,0,.25)" />
      <rect x="8" y="8" width="104" height="164" rx="8" fill={face} />
      <ellipse cx="60" cy="90" rx="42" ry="74" transform="rotate(28 60 90)" fill={isWild ? 'transparent' : '#fff'} stroke={isWild ? '#fff' : 'none'} stroke-width="3" />
      <Glyph card={card} size={70} x={60} y={92} color={ink} />
      <Glyph card={card} size={24} x={22} y={26} color="#fff" />
      <g transform="rotate(180 98 154)">
        <Glyph card={card} size={24} x={98} y={154} color="#fff" />
      </g>
    </svg>
  );
}

export function CardBack({ class: className = '' }: { class?: string }) {
  return (
    <svg class={`uno-card uno-card--back ${className}`} viewBox="0 0 120 180" aria-hidden="true">
      <rect x="1" y="1" width="118" height="178" rx="12" fill="#fff" stroke="rgba(0,0,0,.25)" />
      <rect x="8" y="8" width="104" height="164" rx="8" fill="#000" />
      <ellipse cx="60" cy="90" rx="40" ry="70" transform="rotate(28 60 90)" fill="var(--uno-red)" />
      <image href={`${import.meta.env.BASE_URL}pieces/wN.svg`} x="28" y="58" width="64" height="64" />
    </svg>
  );
}

export function describeCard(card: Card): string {
  const color = 'color' in card ? `${card.color} ` : '';
  switch (card.kind) {
    case 'number': return `${color}${card.value}`;
    case 'skip': return `${color}skip`;
    case 'reverse': return `${color}reverse`;
    case 'draw2': return `${color}draw two`;
    case 'wild': return 'wild';
    case 'wild4': return 'wild draw four';
  }
}
