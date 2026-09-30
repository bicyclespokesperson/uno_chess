// Evaluated in the page: builds a rigged game from window.RIG = { cards, fen?, pockets?, settings?, turn? } and saves it.
(() => {
  const { game, chess, storage } = window.__uno;
  const R = window.RIG;
  let id = 5000;
  const card = (c) => (typeof c === 'number' ? { id: id++, kind: 'number', color: ['red', 'yellow', 'green', 'blue'][id % 4], value: c } : c.startsWith('wild') ? { id: id++, kind: c } : { id: id++, kind: c, color: ['red', 'yellow', 'green', 'blue'][id % 4] });
  const s = game.createGame({ names: { p1: 'Ana', p2: 'Bo' }, whitePlayer: 'p1', seed: 7, settings: R.settings });
  s.drawPile = R.cards.map(card).reverse().concat([]);
  s.drawPile = [...Array.from({ length: 20 }, () => card(1)), ...s.drawPile];
  if (R.fen) s.position = chess.fromFen(R.fen).position;
  if (R.pockets) s.pockets = R.pockets;
  if (R.turn) s.turn = R.turn;
  storage.saveGame(s);
  return 'rigged';
})();
