import { useEffect, useState } from 'preact/hooks';
import { MAX_NAME_LENGTH, type RoomInfo } from '../net/protocol.ts';
import { OnlineError, RemoteClient, type OnlineMeta } from '../net/remoteClient.ts';

export function inviteLink(code: string): string {
  return `${location.origin}${location.pathname}#join=${code}`;
}

export function joinCodeFromHash(): string | null {
  const match = /^#join=([A-Za-z0-9]{4,12})$/.exec(location.hash);
  return match ? match[1].toUpperCase() : null;
}

export function clearHash(): void {
  history.replaceState(null, '', location.pathname + location.search);
}

function capText(cap: number): string {
  return cap === 9 ? 'Number cards aren’t capped.' : `Number cards give at most ${cap} moves.`;
}

function whiteText(room: RoomInfo, perspective: 'host' | 'guest'): string {
  const host = room.names.p1 ?? 'The host';
  if (room.white === 'random') return 'Colors are picked at random.';
  if (perspective === 'host') return room.white === 'host' ? 'You start as White.' : 'Your opponent starts as White.';
  return room.white === 'guest' ? 'You start as White.' : `${host} starts as White.`;
}

export function Lobby({ meta, onCancel }: { meta: OnlineMeta; onCancel: () => void }) {
  const link = inviteLink(meta.code);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      (document.getElementById('invite-link') as HTMLInputElement | null)?.select();
    }
  };
  const share = () => void navigator.share?.({ title: 'Uno Chess', text: `${meta.room.names.p1} invited you to Uno Chess`, url: link }).catch(() => {});

  return (
    <div class="setup lobby">
      <h1 class="lobby__title">Invite your opponent</h1>
      <p class="lobby__lede">Send them this link. The game starts as soon as they open it.</p>
      <div class="invite">
        <input id="invite-link" class="input invite__link" value={link} readOnly onFocus={(e) => e.currentTarget.select()} aria-label="Invite link" />
        <button type="button" class="btn btn--primary" onClick={copy}>
          {copied ? 'Copied' : 'Copy link'}
        </button>
        {'share' in navigator && (
          <button type="button" class="btn" onClick={share}>
            Share…
          </button>
        )}
      </div>
      <p class="lobby__code">
        Or give them the code <strong>{meta.code}</strong>
      </p>
      {meta.status === 'closed' ? (
        <p class="notice notice--error" role="status">
          {meta.closedReason ?? 'Disconnected.'}
        </p>
      ) : (
        <div class="lobby__waiting" role="status">
          <span class="lobby__dots" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          {meta.status === 'online' ? 'Waiting for your opponent to join' : 'Reconnecting to the server'}
        </div>
      )}
      <p class="lobby__settings">
        {capText(meta.room.settings.moveCap)} {whiteText(meta.room, 'host')}
      </p>
      <button type="button" class="btn btn--quiet" onClick={onCancel}>
        {meta.status === 'closed' ? 'Back to start' : 'Cancel this game'}
      </button>
    </div>
  );
}

export interface JoinScreenProps {
  serverUrl: string;
  code: string;
  defaultName: string;
  onJoined: (client: RemoteClient, name: string) => void;
  onCancel: () => void;
}

export function JoinScreen({ serverUrl, code, defaultName, onJoined, onCancel }: JoinScreenProps) {
  const [room, setRoom] = useState<RoomInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(defaultName);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    RemoteClient.peek(serverUrl, code)
      .then(setRoom)
      .catch((err: unknown) => setError(err instanceof OnlineError ? err.message : 'Something went wrong.'));
  }, [code]);

  const join = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const trimmed = name.trim() || 'Player 2';
      onJoined(await RemoteClient.connect(serverUrl, { type: 'join', code, name: trimmed }), trimmed);
    } catch (err) {
      setError(err instanceof OnlineError ? err.message : 'Something went wrong.');
      setBusy(false);
    }
  };

  const full = room?.status === 'playing';
  return (
    <div class="setup lobby">
      {!room && !error && <p class="lobby__lede" role="status">Looking up game {code}…</p>}
      {room && !full && (
        <form class="setup__form" onSubmit={join}>
          <h1 class="lobby__title">{`${room.names.p1} invited you to Uno Chess`}</h1>
          <p class="lobby__settings">
            {capText(room.settings.moveCap)} {whiteText(room, 'guest')}
          </p>
          <label class="field">
            <span class="field__label">Your name</span>
            <input class="input" value={name} maxLength={MAX_NAME_LENGTH} onInput={(e) => setName(e.currentTarget.value)} autoFocus />
          </label>
          <div class="setup__actions">
            <button type="submit" class="btn btn--primary btn--big" disabled={busy}>
              {busy ? 'Joining…' : 'Join game'}
            </button>
            <button type="button" class="btn btn--quiet" onClick={onCancel}>
              Not now
            </button>
          </div>
        </form>
      )}
      {full && <h1 class="lobby__title">This game already has two players</h1>}
      {(error || full) && (
        <>
          {error && <p class="notice notice--error">{error}</p>}
          <button type="button" class="btn" onClick={onCancel}>
            Back to start
          </button>
        </>
      )}
    </div>
  );
}
