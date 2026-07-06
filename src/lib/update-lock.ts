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

const unlinkQuiet = (path: string): void => {
  try {
    unlinkSync(path);
  } catch {
    // already gone
  }
};

// Serialize stale-lock takeover behind its own exclusive create, so no taker can ever delete a
// lock that turned FRESH mid-takeover (the ABA race: reader sees the stale timestamp, a winner
// re-creates the lock, the reader deletes the winner's file). Under the guard the staleness is
// re-checked and only a genuinely stale lock is cleared; losers simply refuse. A guard left by a
// crashed taker expires like the lock itself. Returns whether to re-race the create.
const takeOverStale = (now: number): boolean => {
  const guard = `${lockPath()}.takeover`;
  const guardHeld = heldAt(guard);
  if (guardHeld !== null && now - guardHeld >= LOCK_TTL_MS) unlinkQuiet(guard);
  try {
    writeFileSync(guard, String(now), { flag: 'wx' });
  } catch {
    return false; // another taker is mid-takeover; let it win
  }
  try {
    const held = heldAt(lockPath());
    if (held !== null && now - held < LOCK_TTL_MS) return false; // became fresh meanwhile
    unlinkQuiet(lockPath());
    return true;
  } finally {
    unlinkQuiet(guard);
  }
};

// Acquire the single-writer update lock. The O_EXCL ('wx') create IS the mutex - concurrent runs
// cannot both win it, unlike a check-then-write. A fresh holder (younger than the TTL) refuses;
// a stale one (crashed run) is cleared under the takeover guard and re-raced once. `now` is
// injectable.
export const acquireUpdateLock = (now: number = Date.now()): boolean => {
  ensureConfigDir();
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(lockPath(), String(now), { flag: 'wx' });
      return true;
    } catch {
      const held = heldAt(lockPath());
      if (held !== null && now - held < LOCK_TTL_MS) return false;
      if (!takeOverStale(now)) return false;
    }
  }
  return false;
};

export const releaseUpdateLock = (): void => {
  const path = lockPath();
  if (existsSync(path)) unlinkSync(path);
};
