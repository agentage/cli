import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ensureConfigDir, getConfigDir } from '../fs/config.js';

const LOCK_FILE = 'update.lock';
const LOCK_TTL_MS = 10 * 60 * 1000; // a lock older than this whose holder is gone is a crashed run
// Past this age a holder is taken over even if its pid still resolves (pid reuse after a crash); far
// beyond any real run or scheduler pause, so a live-but-slow holder is never mistaken for crashed.
const STALE_HARD_MS = 30 * 60 * 1000;

const lockPath = (): string => join(getConfigDir(), LOCK_FILE);

// The lock file holds "<pid> <timestamp>": pid gates crash-takeover, the trailing token is the
// acquisition time. A legacy single-token file parses as pid 0 (unknown holder), aging out on TTL.
const holderOf = (path: string): { pid: number; at: number } | null => {
  try {
    const parts = readFileSync(path, 'utf-8').trim().split(/\s+/);
    const at = Number.parseInt(parts[parts.length - 1] ?? '', 10);
    if (Number.isNaN(at)) return null;
    const pid = parts.length >= 2 ? Number.parseInt(parts[0] ?? '', 10) : 0;
    return { pid: Number.isNaN(pid) ? 0 : pid, at };
  } catch {
    return null;
  }
};

// Same-host liveness probe. ESRCH = the holder is gone (crashed); EPERM = alive but owned by another
// user. pid 0/unknown counts as gone so a legacy or malformed lock still ages out on the TTL.
const holderAlive = (pid: number): boolean => {
  if (pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
};

// A holder is safe to take over only once it is past the TTL AND provably gone: a dead pid, our own
// leftover pid, or so old that pid reuse is the only explanation. A live holder merely starved of
// CPU is never stolen - stealing it would let two writers run concurrently.
const isCrashed = (holder: { pid: number; at: number }, now: number): boolean => {
  const age = now - holder.at;
  if (age < LOCK_TTL_MS) return false;
  if (age >= STALE_HARD_MS) return true;
  return holder.pid === process.pid || !holderAlive(holder.pid);
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
  const guardHeld = holderOf(guard);
  if (guardHeld !== null && isCrashed(guardHeld, now)) unlinkQuiet(guard);
  try {
    writeFileSync(guard, `${process.pid} ${now}`, { flag: 'wx' });
  } catch {
    return false; // another taker is mid-takeover; let it win
  }
  try {
    const holder = holderOf(lockPath());
    if (holder !== null && !isCrashed(holder, now)) return false; // fresh or a live-but-slow holder
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
      writeFileSync(lockPath(), `${process.pid} ${now}`, { flag: 'wx' });
      return true;
    } catch {
      const holder = holderOf(lockPath());
      if (holder !== null && !isCrashed(holder, now)) return false;
      if (!takeOverStale(now)) return false;
    }
  }
  return false;
};

export const releaseUpdateLock = (): void => {
  const path = lockPath();
  if (existsSync(path)) unlinkSync(path);
};
