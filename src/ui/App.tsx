import { useEffect, useMemo, useState } from 'preact/hooks';
import { createGame, otherPlayer, type GameState, type PlayerId } from '../engine/game.ts';
import type { GameClient } from '../net/client.ts';
import { LocalClient } from '../net/localClient.ts';
import { clearGame, loadGame, loadPrefs, savePrefs, saveGame, type Prefs } from '../net/storage.ts';
import { GameScreen } from './GameScreen.tsx';
import { Setup } from './Setup.tsx';

const randomSeed = (): number => crypto.getRandomValues(new Uint32Array(1))[0];

function newGame(prefs: Prefs, whitePlayer: PlayerId): GameState {
  return createGame({ names: prefs.names, whitePlayer, settings: prefs.settings, seed: randomSeed() });
}

/** The player who drew first was White when the game began. */
const startingWhite = (s: GameState): PlayerId => s.history[0]?.player ?? s.armies.w;

export function App() {
  const [saved, setSaved] = useState<GameState | null>(() => loadGame());
  const [session, setSession] = useState<{ client: GameClient; id: number } | null>(null);
  const client = session?.client ?? null;
  const prefs = useMemo(() => loadPrefs(), [session]);

  useEffect(() => () => client?.dispose(), [client]);

  const begin = (state: GameState) => {
    saveGame(state);
    setSession({ client: new LocalClient(state), id: Date.now() });
  };

  const start = (p: Prefs) => {
    savePrefs(p);
    const white = p.whiteChoice === 'random' ? (Math.random() < 0.5 ? 'p1' : 'p2') : p.whiteChoice;
    begin(newGame(p, white));
  };

  const rematch = () => {
    const last = loadGame();
    if (!last) return;
    const names = { p1: last.players.p1.name, p2: last.players.p2.name };
    begin(newGame({ names, settings: last.settings, whiteChoice: 'p1' }, otherPlayer(startingWhite(last))));
  };

  const toSetup = () => {
    clearGame();
    setSaved(null);
    setSession(null);
  };

  if (session) return <GameScreen key={session.id} client={session.client} onRematch={rematch} onNewGame={toSetup} />;

  const inProgress = saved && saved.phase.kind !== 'over' ? saved : null;
  return (
    <Setup
      initial={prefs}
      savedGame={inProgress ? { names: `${inProgress.players.p1.name} vs ${inProgress.players.p2.name}`, turns: inProgress.history.length } : null}
      onStart={start}
      onContinue={() => inProgress && begin(inProgress)}
    />
  );
}
