import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ensureConfigDir, getConfigDir } from './config.js';

const LOCK_FILE = 'update.lock';
const LOCK_TTL_MS = 10 * 60 * 1000; // a lock older than this is treated as stale (crashed run)

const lockPath = (): string => join(getConfigDir(), LOCK_FILE);

const heldAt = (path: string): number | null => {
  try {
    const n = Number.parseInt(readFileSync(path, 'utf-8').trim(), 10);
    return Number.isNaN(n) ? null : n;
  } catch {
    return null;
  }
};

// Acquire the single-writer update lock. The O_EXCL ('wx') create IS the mutex - concurrent runs
// cannot both win it, unlike a check-then-write. A fresh holder (younger than the TTL) refuses;
// a stale one (crashed run) is unlinked and re-raced exactly once. `now` is injectable.
export const acquireUpdateLock = (now: number = Date.now()): boolean => {
  ensureConfigDir();
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(lockPath(), String(now), { flag: 'wx' });
      return true;
    } catch {
      const held = heldAt(lockPath());
      if (held !== null && now - held < LOCK_TTL_MS) return false;
      try {
        unlinkSync(lockPath());
      } catch {
        // already gone: lost the unlink race, retry the exclusive create
      }
    }
  }
  return false;
};

export const releaseUpdateLock = (): void => {
  const path = lockPath();
  if (existsSync(path)) unlinkSync(path);
};
