# Uno Chess

Chess where every turn starts by flipping an Uno card. Two players on one screen, or online with an invite link.

**Play:** https://unochess.jeremysigrist.com

Inspired by [this r/AnarchyChess post](https://old.reddit.com/r/AnarchyChess/comments/1wsbpwa/sorry_im_new_to_chess_is_this_legal/), where two people play over-the-board chess with an Uno deck and physically spin the board when a Reverse comes up.

## Rules

Normal chess, except each turn begins with the current player flipping the top card of a standard 108-card Uno deck:

| Card | Effect |
| --- | --- |
| **1–9** | Make that many moves in a row, with any pieces (the same piece can move repeatedly). Numbers above the *move cap* (a setup option, default 3) count as the cap. |
| **0** | No moves. If you're in check you get one move to escape. |
| **Skip** | Your opponent is skipped: flip again. |
| **Reverse** | The board spins 180° and the players swap armies. The other player takes over the same color's turn and flips a card. |
| **+2** | Put up to two of your army's captured pieces back on the board, using bughouse drop rules. |
| **Wild** | Choose which card it acts as: any number up to the cap, Skip, Reverse, or +2. |
| **Wild +4** | Put up to four captured pieces back. |

Fine print:

- **Giving check ends your turn** immediately, even with moves left. Without this, any check with a move to spare would be followed by capturing the king.
- **Checkmate** wins the moment it happens. If you must move and have no legal move while not in check, it's **stalemate** (a draw).
- **Drops** follow bughouse rules: any empty square, no pawns on the first or last rank, may give check (even mate) or block one. A pawn dropped on its starting rank may still double-step; a rook dropped in the corner doesn't restore castling rights.
- Captured pieces go to their own army's pocket, so after a Reverse you get back the pieces *that army* lost. Promoted pieces return as pawns.
- If a +2/+4 can't place anything (empty pocket, or you're in check and no drop can block it), you make one normal move instead.
- En passant only applies to the opponent's pawn: in a multi-move turn your own double-pushed pawn can't be taken "en passant" by your other pawns.
- When the deck runs out, the discard pile (minus its top card) is reshuffled.
- Optional: players may end a turn early after at least one move (setup toggle, on by default).
- A game that reaches 1,000 flipped cards is a draw.

## Development

```sh
npm install
npm run dev        # http://127.0.0.1:5173
npm test           # engine unit tests, perft, random-game soak test, server integration tests
npm run build      # type-check + production build into dist/
npm run server     # online game server on 127.0.0.1:7879 (the dev build connects to it)
```

Online play: the browser talks to `server/` over a WebSocket. See [services/unochess/README.md](services/unochess/README.md) for how it's hosted, and `npm run e2e:online` for a two-browser test against the dev servers.

Pushing to `main` runs the tests in CI. The site and game server are hosted together on one machine: deploy with `services/unochess/deploy.sh` (see [services/unochess/README.md](services/unochess/README.md)). The old GitHub Pages URL redirects to the new domain.

`e2e/drive.mjs` drives the dev server in headless Chrome (via `playwright-core` and the system Chrome) and takes screenshots. In dev builds, `window.__uno` exposes the engine so `e2e/rig.js` can stack the deck and set up positions:

```sh
node e2e/drive.mjs '[{"rig":{"cards":[1,"reverse",2]}},{"key":"f"},{"drag":["e2","e4"]},{"key":"f"},{"wait":1200},{"shot":"after-reverse"}]'
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for how the code is organized and how online play would be added.

## Credits

Chess pieces: [Cburnett](https://commons.wikimedia.org/wiki/User:Cburnett), [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) (see `public/pieces/`). Fonts: Lilita One and Rubik (SIL Open Font License). Uno is a trademark of Mattel; this is an unaffiliated fan project.
