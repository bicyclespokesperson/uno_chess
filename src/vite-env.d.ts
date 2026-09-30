/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** WebSocket URL of the game server, e.g. wss://unochess.example.com/ws. Online play is hidden when unset. */
  readonly VITE_SERVER_URL?: string;
}
