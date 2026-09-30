import { useEffect, useState } from 'preact/hooks';
import { createGame, otherPlayer, startingWhite, type GameState } from '../engine/game.ts';
import { SERVER_URL } from '../net/config.ts';
import { LocalClient } from '../net/localClient.ts';
import { OnlineError, RemoteClient, type OnlineMeta } from '../net/remoteClient.ts';
import { clearGame, clearOnline, loadGame, loadOnline, loadOnlineSessions, loadPrefs, saveGame, savePrefs, type Prefs } from '../net/storage.ts';
import { GameScreen } from './GameScreen.tsx';
import { clearHash, JoinScreen, joinCodeFromHash, Lobby } from './Online.tsx';
import { Setup } from './Setup.tsx';

type Screen =
  | { kind: 'setup'; notice?: string }
  | { kind: 'local'; client: LocalClient; id: number }
  | { kind: 'connecting'; message: string; code: string }
  | { kind: 'join'; code: string }
  | { kind: 'online'; client: RemoteClient; id: number };

const randomSeed = (): number => crypto.getRandomValues(new Uint32Array(1))[0];

function initialScreen(): Screen {
  if (!SERVER_URL) return { kind: 'setup' };
  const code = joinCodeFromHash();
  if (code && !loadOnline(code)) return { kind: 'join', code };
  const session = loadOnline(code ?? undefined);
  if (session) return { kind: 'connecting', message: 'Rejoining your online game…', code: session.code };
  return { kind: 'setup' };
}

function OnlineGame({ client, onLeave }: { client: RemoteClient; onLeave: () => void }) {
  const [meta, setMeta] = useState<OnlineMeta>(client.getMeta());
  const [hasGame, setHasGame] = useState(client.hasGame());
  useEffect(() => {
    const offMeta = client.subscribeMeta(setMeta);
    const offView = client.subscribe(() => setHasGame(true));
    setMeta(client.getMeta());
    setHasGame(client.hasGame());
    return () => {
      offMeta();
      offView();
    };
  }, [client]);
  if (!hasGame) return <Lobby meta={meta} onCancel={onLeave} />;
  return <GameScreen client={client} online={client} onRematch={() => client.rematch()} onNewGame={onLeave} />;
}

export function App() {
  const [screen, setScreen] = useState<Screen>(initialScreen);
  const [savedLocal, setSavedLocal] = useState<GameState | null>(() => loadGame());
  const [onlineSessions, setOnlineSessions] = useState(() => (SERVER_URL ? loadOnlineSessions() : []));
  const prefs = loadPrefs();

  useEffect(() => {
    if (screen.kind === 'local' || screen.kind === 'online') return () => screen.client.dispose();
  }, [screen]);

  const toSetup = (notice?: string) => {
    setOnlineSessions(SERVER_URL ? loadOnlineSessions() : []);
    setSavedLocal(loadGame());
    setScreen({ kind: 'setup', notice });
  };

  const goOnline = (client: RemoteClient) => {
    clearHash();
    setScreen({ kind: 'online', client, id: Date.now() });
  };

  const connect = async (hello: Parameters<typeof RemoteClient.connect>[1], message: string) => {
    setScreen({ kind: 'connecting', message, code: hello.type === 'resume' ? hello.code : '' });
    try {
      goOnline(await RemoteClient.connect(SERVER_URL, hello));
    } catch (err) {
      const e = err instanceof OnlineError ? err : new OnlineError('unreachable', 'Something went wrong.');
      if (hello.type === 'resume' && (e.code === 'bad_token' || e.code === 'not_found')) {
        clearOnline(hello.code);
        return toSetup('That online game isn’t available any more.');
      }
      toSetup(e.message);
    }
  };

  const resume = (code: string) => {
    const session = loadOnline(code);
    if (session) void connect({ type: 'resume', code: session.code, token: session.token }, 'Rejoining your online game…');
  };

  useEffect(() => {
    if (screen.kind === 'connecting') resume(screen.code);
  }, []);

  const beginLocal = (state: GameState) => {
    clearHash();
    saveGame(state);
    setScreen({ kind: 'local', client: new LocalClient(state), id: Date.now() });
  };

  const startLocal = (p: Prefs) => {
    savePrefs(p);
    const white = p.whiteChoice === 'random' ? (Math.random() < 0.5 ? 'p1' : 'p2') : p.whiteChoice;
    beginLocal(createGame({ names: p.names, whitePlayer: white, settings: p.settings, seed: randomSeed() }));
  };

  const createOnline = (p: Prefs) => {
    savePrefs(p);
    void connect({ type: 'create', name: p.onlineName ?? 'Player 1', settings: p.settings, white: p.onlineWhite ?? 'host' }, 'Setting up your game…');
  };

  const rematchLocal = () => {
    const last = loadGame();
    if (!last) return;
    const names = { p1: last.players.p1.name, p2: last.players.p2.name };
    beginLocal(createGame({ names, whitePlayer: otherPlayer(startingWhite(last)), settings: last.settings, seed: randomSeed() }));
  };

  switch (screen.kind) {
    case 'local':
      return (
        <GameScreen
          key={screen.id}
          client={screen.client}
          online={null}
          onRematch={rematchLocal}
          onNewGame={() => {
            clearGame();
            toSetup();
          }}
        />
      );
    case 'online':
      return (
        <OnlineGame
          key={screen.id}
          client={screen.client}
          onLeave={() => {
            screen.client.leave();
            toSetup();
          }}
        />
      );
    case 'connecting':
      return (
        <div class="setup lobby">
          <p class="lobby__lede" role="status">
            {screen.message}
          </p>
        </div>
      );
    case 'join':
      return (
        <JoinScreen
          serverUrl={SERVER_URL}
          code={screen.code}
          defaultName={prefs?.onlineName ?? ''}
          onJoined={(client, name) => {
            if (prefs) savePrefs({ ...prefs, onlineName: name });
            goOnline(client);
          }}
          onCancel={() => {
            clearHash();
            toSetup();
          }}
        />
      );
    case 'setup': {
      const inProgress = savedLocal && savedLocal.phase.kind !== 'over' ? savedLocal : null;
      return (
        <Setup
          initial={prefs}
          notice={screen.notice ?? null}
          onlineAvailable={Boolean(SERVER_URL)}
          onlineSessions={onlineSessions}
          savedGame={inProgress ? { names: `${inProgress.players.p1.name} vs ${inProgress.players.p2.name}`, turns: inProgress.history.length } : null}
          onStart={startLocal}
          onCreateOnline={createOnline}
          onContinue={() => inProgress && beginLocal(inProgress)}
          onResumeOnline={resume}
        />
      );
    }
  }
}
