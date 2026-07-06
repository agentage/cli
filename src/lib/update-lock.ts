import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ensureConfigDir, getConfigDir } from './config.js';

const LOCK_FILE = 'update.lock';
const LOCK_TTL_MS = 10 * 60 * 1000; // a lock older than this is treated as stale (crashed run)

const lockPath = (): string => join(getConfigDir(), LOCK_FILE);

// Acquire the single-writer update lock. Returns false when a fresh lock (younger than the TTL) is
// already held by a concurrent run; a stale lock is overridden and acquired. `now` is injectable.
export const acquireUpdateLock = (now: number = Date.now()): boolean => {
  const path = lockPath();
  if (existsSync(path)) {
    const held = Number.parseInt(readFileSync(path, 'utf-8').trim(), 10);
    if (!Number.isNaN(held) && now - held < LOCK_TTL_MS) return false;
  }
  ensureConfigDir();
  writeFileSync(path, String(now), 'utf-8');
  return true;
};

export const releaseUpdateLock = (): void => {
  const path = lockPath();
  if (existsSync(path)) unlinkSync(path);
};
