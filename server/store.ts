import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Room, RoomStore } from './rooms.ts';

/**
 * One JSON file per room. Saves are coalesced and written on a short timer (and on shutdown via
 * `flush`), each via write-then-rename so a crash never leaves a half-written file.
 */
export class FileRoomStore implements RoomStore {
  private readonly dir: string;
  private readonly delayMs: number;
  private readonly log: (msg: string) => void;
  private dirty = new Map<string, Room>();
  private timer: NodeJS.Timeout | null = null;

  constructor(dataDir: string, opts: { delayMs?: number; log?: (msg: string) => void } = {}) {
    this.dir = path.join(dataDir, 'rooms');
    this.delayMs = opts.delayMs ?? 250;
    this.log = opts.log ?? (() => {});
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
  }

  private file(code: string): string {
    return path.join(this.dir, `${code}.json`);
  }

  load(): Room[] {
    const rooms: Room[] = [];
    for (const name of readdirSync(this.dir)) {
      if (!name.endsWith('.json')) continue;
      try {
        rooms.push(JSON.parse(readFileSync(path.join(this.dir, name), 'utf8')) as Room);
      } catch (err) {
        this.log(`skipping unreadable room file ${name}: ${(err as Error).message}`);
      }
    }
    return rooms;
  }

  save(room: Room): void {
    this.dirty.set(room.code, room);
    this.timer ??= setTimeout(() => this.flush(), this.delayMs);
  }

  remove(code: string): void {
    this.dirty.delete(code);
    rmSync(this.file(code), { force: true });
  }

  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    for (const [code, room] of this.dirty) {
      const target = this.file(code);
      const tmp = `${target}.tmp`;
      try {
        writeFileSync(tmp, JSON.stringify(room), { mode: 0o600 });
        renameSync(tmp, target);
      } catch (err) {
        this.log(`failed to save room ${code}: ${(err as Error).message}`);
      }
    }
    this.dirty.clear();
  }
}
