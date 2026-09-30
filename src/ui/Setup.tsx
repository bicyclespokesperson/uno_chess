import { useState } from 'preact/hooks';
import { DEFAULT_SETTINGS, MOVE_CAP_OPTIONS, type PlayerId, type Settings } from '../engine/game.ts';
import type { Prefs } from '../net/storage.ts';
import { RulesModal } from './Modals.tsx';
import { UnoCard } from './UnoCard.tsx';

export interface SetupProps {
  initial: Prefs | null;
  savedGame: { names: string; turns: number } | null;
  onStart: (prefs: Prefs) => void;
  onContinue: () => void;
}

const DEFAULT_PREFS: Prefs = { names: { p1: 'Player 1', p2: 'Player 2' }, settings: DEFAULT_SETTINGS, whiteChoice: 'p1' };

function Segmented<T extends string | number>({ label, options, value, onChange }: { label: string; options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <fieldset class="field">
      <legend class="field__label">{label}</legend>
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

export function Setup({ initial, savedGame, onStart, onContinue }: SetupProps) {
  const [prefs, setPrefs] = useState<Prefs>({ ...DEFAULT_PREFS, ...initial, settings: { ...DEFAULT_SETTINGS, ...initial?.settings } });
  const [showRules, setShowRules] = useState(false);
  const setName = (p: PlayerId, name: string) => setPrefs({ ...prefs, names: { ...prefs.names, [p]: name } });
  const setSetting = <K extends keyof Settings>(key: K, value: Settings[K]) => setPrefs({ ...prefs, settings: { ...prefs.settings, [key]: value } });

  const start = (e: Event) => {
    e.preventDefault();
    const clean = (p: PlayerId, fallback: string) => prefs.names[p].trim().slice(0, 24) || fallback;
    const names = { p1: clean('p1', 'Player 1'), p2: clean('p2', 'Player 2') };
    if (names.p1 === names.p2) names.p2 = `${names.p2} (2)`;
    onStart({ ...prefs, names });
  };

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
        <p class="hero__lede">Every turn, flip a card. A 3 means three moves in a row. Reverse spins the board and you swap armies. +2 brings captured pieces back. Two players, one screen.</p>
      </header>

      {savedGame && (
        <section class="resume">
          <p>
            <strong>Game in progress:</strong> {savedGame.names}, {savedGame.turns === 1 ? "1 card" : `${savedGame.turns} cards`} flipped.
          </p>
          <button type="button" class="btn btn--primary" onClick={onContinue}>
            Continue game
          </button>
        </section>
      )}

      <form class="setup__form" onSubmit={start}>
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
        <Segmented
          label="Most moves a number card can give"
          value={prefs.settings.moveCap}
          onChange={(v) => setSetting('moveCap', v)}
          options={MOVE_CAP_OPTIONS.map((n) => ({ value: n, label: n === 9 ? 'No cap' : String(n) }))}
        />
        <label class="check">
          <input type="checkbox" checked={prefs.settings.allowEarlyEnd} onChange={(e) => setSetting('allowEarlyEnd', e.currentTarget.checked)} />
          <span>Allow ending a turn before using every move</span>
        </label>
        <div class="setup__actions">
          <button type="submit" class="btn btn--primary btn--big">
            Deal
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
