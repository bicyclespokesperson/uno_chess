import { useState } from 'preact/hooks';
import { DEFAULT_SETTINGS, MOVE_CAP_OPTIONS, type PlayerId, type Settings } from '../engine/game.ts';
import { MAX_NAME_LENGTH, normalizeRoomCode, ROOM_CODE_LENGTH } from '../net/protocol.ts';
import type { OnlineSession, Prefs } from '../net/storage.ts';
import { RulesModal } from './Modals.tsx';
import { UnoCard } from './UnoCard.tsx';

export interface SetupProps {
  initial: Prefs | null;
  notice: string | null;
  onlineAvailable: boolean;
  onlineSessions: OnlineSession[];
  savedGame: { names: string; turns: number } | null;
  onStart: (prefs: Prefs) => void;
  onCreateOnline: (prefs: Prefs) => void;
  onContinue: () => void;
  onResumeOnline: (code: string) => void;
  onJoinCode: (code: string) => void;
}

type Mode = 'create' | 'join' | 'local';

const DEFAULT_PREFS: Prefs = {
  names: { p1: 'Player 1', p2: 'Player 2' },
  settings: DEFAULT_SETTINGS,
  whiteChoice: 'p1',
  onlineName: '',
  onlineWhite: 'host',
};

interface SegmentedProps<T> {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  hideLabel?: boolean;
  class?: string;
}

function Segmented<T extends string | number>({ label, options, value, onChange, hideLabel, class: className = '' }: SegmentedProps<T>) {
  return (
    <fieldset class={`field ${className}`}>
      <legend class={hideLabel ? 'visually-hidden' : 'field__label'}>{label}</legend>
      <div class="segmented">
        {options.map((o) => (
          <label key={String(o.value)} class={`segmented__option ${o.value === value ? 'is-checked' : ''}`}>
            <input type="radio" name={label} checked={o.value === value} onChange={() => onChange(o.value)} />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function RulesSettings({ settings, onChange }: { settings: Settings; onChange: <K extends keyof Settings>(key: K, value: Settings[K]) => void }) {
  return (
    <>
      <Segmented
        label="Most moves a number card can give"
        value={settings.moveCap}
        onChange={(v) => onChange('moveCap', v)}
        options={MOVE_CAP_OPTIONS.map((n) => ({ value: n, label: n === 9 ? 'No cap' : String(n) }))}
      />
      <label class="check">
        <input type="checkbox" checked={settings.allowEarlyEnd} onChange={(e) => onChange('allowEarlyEnd', e.currentTarget.checked)} />
        <span>Allow ending a turn before using every move</span>
      </label>
    </>
  );
}

export function Setup({ initial, notice, onlineAvailable, onlineSessions, savedGame, onStart, onCreateOnline, onContinue, onResumeOnline, onJoinCode }: SetupProps) {
  const [prefs, setPrefs] = useState<Prefs>({ ...DEFAULT_PREFS, ...initial, settings: { ...DEFAULT_SETTINGS, ...initial?.settings } });
  const [mode, setMode] = useState<Mode>(onlineAvailable ? 'create' : 'local');
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const [showRules, setShowRules] = useState(false);
  const setName = (p: PlayerId, name: string) => setPrefs({ ...prefs, names: { ...prefs.names, [p]: name } });
  const setSetting = <K extends keyof Settings>(key: K, value: Settings[K]) => setPrefs({ ...prefs, settings: { ...prefs.settings, [key]: value } });

  const submit = (e: Event) => {
    e.preventDefault();
    if (mode === 'join') {
      const normalized = normalizeRoomCode(code);
      if (normalized.length !== ROOM_CODE_LENGTH) return setCodeError(`Game codes are ${ROOM_CODE_LENGTH} letters and numbers.`);
      return onJoinCode(normalized);
    }
    if (mode === 'create') return onCreateOnline({ ...prefs, onlineName: (prefs.onlineName ?? '').trim().slice(0, MAX_NAME_LENGTH) || 'Player 1' });
    const clean = (p: PlayerId, fallback: string) => prefs.names[p].trim().slice(0, 24) || fallback;
    const names = { p1: clean('p1', 'Player 1'), p2: clean('p2', 'Player 2') };
    if (names.p1 === names.p2) names.p2 = `${names.p2} (2)`;
    onStart({ ...prefs, names });
  };

  const submitLabel: Record<Mode, string> = { create: 'Create game', join: 'Join game', local: 'Deal' };

  return (
    <div class="setup">
      <header class="hero">
        <div class="hero__fan" aria-hidden="true">
          <UnoCard card={{ id: -1, kind: 'number', color: 'yellow', value: 3 }} />
          <UnoCard card={{ id: -2, kind: 'reverse', color: 'green' }} />
          <UnoCard card={{ id: -3, kind: 'draw2', color: 'red' }} />
        </div>
        <h1 class="hero__title">
          Uno<span>Chess</span>
        </h1>
        <p class="hero__lede">
          Every turn, flip a card. A 3 means three moves in a row. Reverse spins the board and you swap armies. +2 brings captured pieces back.
          {onlineAvailable ? ' Play a friend online, or pass one screen back and forth.' : ' Two players, one screen.'}
        </p>
      </header>

      {notice && <p class="notice notice--error">{notice}</p>}

      {onlineSessions.map((session) => (
        <section class="resume" key={session.code}>
          <p>
            <strong>Online game:</strong> {session.label}.
          </p>
          <button type="button" class="btn btn--primary" onClick={() => onResumeOnline(session.code)}>
            Rejoin
          </button>
        </section>
      ))}

      {savedGame && (
        <section class="resume">
          <p>
            <strong>Game in progress:</strong> {savedGame.names}, {savedGame.turns === 1 ? '1 card' : `${savedGame.turns} cards`} flipped.
          </p>
          <button type="button" class="btn btn--primary" onClick={onContinue}>
            Continue game
          </button>
        </section>
      )}

      <form class="setup__form" onSubmit={submit}>
        {onlineAvailable && (
          <Segmented
            label="How do you want to play?"
            hideLabel
            class="mode-switch"
            value={mode}
            onChange={(m) => {
              setMode(m);
              setCodeError(null);
            }}
            options={[
              { value: 'create', label: 'Create game' },
              { value: 'join', label: 'Join game' },
              { value: 'local', label: 'Same screen' },
            ]}
          />
        )}
        {mode === 'create' && (
          <>
            <p class="mode-hint">You’ll get a link to send your opponent.</p>
            <label class="field">
              <span class="field__label">Your name</span>
              <input class="input" value={prefs.onlineName} placeholder="Player 1" maxLength={MAX_NAME_LENGTH} onInput={(e) => setPrefs({ ...prefs, onlineName: e.currentTarget.value })} />
            </label>
            <Segmented
              label="Who starts as White"
              value={prefs.onlineWhite ?? 'host'}
              onChange={(onlineWhite) => setPrefs({ ...prefs, onlineWhite })}
              options={[
                { value: 'host', label: 'Me' },
                { value: 'guest', label: 'My opponent' },
                { value: 'random', label: 'Random' },
              ]}
            />
            <RulesSettings settings={prefs.settings} onChange={setSetting} />
          </>
        )}
        {mode === 'join' && (
          <label class="field">
            <span class="field__label">Game code</span>
            <input
              class="input join-code__input"
              value={code}
              maxLength={ROOM_CODE_LENGTH + 4}
              autoComplete="off"
              autoCapitalize="characters"
              spellcheck={false}
              placeholder="ABC123"
              aria-invalid={codeError !== null}
              aria-describedby="code-help"
              onInput={(e) => {
                setCode(e.currentTarget.value.toUpperCase());
                setCodeError(null);
              }}
            />
            <span id="code-help" class={codeError ? 'join-code__error' : 'field__help'}>
              {codeError ?? 'Ask the person who created the game, or just open the link they sent.'}
            </span>
          </label>
        )}
        {mode === 'local' && (
          <>
            {onlineAvailable && <p class="mode-hint">Two players taking turns on this device.</p>}
            <div class="names">
              <label class="field">
                <span class="field__label">Player 1 (near side)</span>
                <input class="input" value={prefs.names.p1} maxLength={24} onInput={(e) => setName('p1', e.currentTarget.value)} />
              </label>
              <label class="field">
                <span class="field__label">Player 2 (far side)</span>
                <input class="input" value={prefs.names.p2} maxLength={24} onInput={(e) => setName('p2', e.currentTarget.value)} />
              </label>
            </div>
            <Segmented
              label="Who starts as White"
              value={prefs.whiteChoice}
              onChange={(whiteChoice) => setPrefs({ ...prefs, whiteChoice })}
              options={[
                { value: 'p1', label: prefs.names.p1.trim() || 'Player 1' },
                { value: 'p2', label: prefs.names.p2.trim() || 'Player 2' },
                { value: 'random', label: 'Random' },
              ]}
            />
            <RulesSettings settings={prefs.settings} onChange={setSetting} />
          </>
        )}
        <div class="setup__actions">
          <button type="submit" class="btn btn--primary btn--big">
            {submitLabel[mode]}
          </button>
          <button type="button" class="btn btn--quiet" onClick={() => setShowRules(true)}>
            How to play
          </button>
        </div>
      </form>
      <footer class="credits">
        Inspired by{' '}
        <a href="https://old.reddit.com/r/AnarchyChess/comments/1wsbpwa/sorry_im_new_to_chess_is_this_legal/" target="_blank" rel="noreferrer">
          this r/AnarchyChess post
        </a>
        . Pieces by Cburnett, CC BY-SA 3.0. Not affiliated with Mattel.
      </footer>
      {showRules && <RulesModal onClose={() => setShowRules(false)} />}
    </div>
  );
}
