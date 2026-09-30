import { render } from 'preact';
import '@fontsource/lilita-one/latin-400.css';
import '@fontsource-variable/rubik/wght.css';
import './ui/styles.css';
import { App } from './ui/App';

if (import.meta.env.DEV) {
  // Lets the e2e driver rig decks and inspect state. Stripped from production builds.
  void Promise.all([import('./engine/game'), import('./engine/chess'), import('./net/storage')]).then(([game, chess, storage]) => {
    Object.assign(window, { __uno: { game, chess, storage } });
  });
}

render(<App />, document.getElementById('app')!);
