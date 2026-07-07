import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

// A cross-process advisory lock keyed to a target file (`<target>.lock`). Config read-modify-writes
// are sub-millisecond, so a lock older than this is a crashed holder to be taken over.
const LOCK_TTL_MS = 10_000;
// A caller blocks up to this long for a contended lock. Past the TTL so a crashed holder is taken
// over rather than wedging the caller; a throw only happens if the lock is genuinely stuck.
const MAX_WAIT_MS = 15_000;
const STEP_MS = 25;

const lockPath = (target: string): string => `${target}.lock`;

// The lock file holds "<pid> <timestamp>"; the trailing token is the acquisition time used for
// staleness. pid is there for debuggability only.
const heldAt = (path: string): number | null => {
  try {
    const parts = readFileSync(path, 'utf-8').trim().split(/\s+/);
    const n = Number.parseInt(parts[parts.length - 1] ?? '', 10);
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

// Serialize stale-lock takeover behind its own exclusive create so no taker can delete a lock that
// turned FRESH mid-takeover (the ABA race: a reader sees the stale timestamp, a winner re-creates
// the lock, the reader deletes the winner's file). Same O_EXCL-guard design proven in
// update-lock.ts. Returns whether to re-race the create.
const takeOverStale = (target: string, now: number): boolean => {
  const path = lockPath(target);
  const guard = `${path}.takeover`;
  const guardHeld = heldAt(guard);
  if (guardHeld !== null && now - guardHeld >= LOCK_TTL_MS) unlinkQuiet(guard);
  try {
    writeFileSync(guard, `${process.pid} ${now}`, { flag: 'wx' });
  } catch {
    return false; // another taker is mid-takeover; let it win
  }
  try {
    const held = heldAt(path);
    if (held !== null && now - held < LOCK_TTL_MS) return false; // became fresh meanwhile
    unlinkQuiet(path);
    return true;
  } finally {
    unlinkQuiet(guard);
  }
};

// One-shot acquire: the O_EXCL ('wx') create IS the mutex - concurrent callers cannot both win it,
// unlike a check-then-write. A fresh holder refuses; a stale one (crashed holder) is cleared under
// the takeover guard and re-raced once. `now` is injectable for tests.
export const acquireFileLock = (target: string, now: number = Date.now()): boolean => {
  mkdirSync(dirname(target), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(lockPath(target), `${process.pid} ${now}`, { flag: 'wx' });
      return true;
    } catch (err) {
      // Only EEXIST means contention. A permission/read-only error never clears, so failing fast
      // beats burning the full MAX_WAIT_MS before reporting a generic "could not acquire lock".
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST') {
        const path = lockPath(target);
        throw new Error(
          code === 'EACCES' || code === 'EPERM' || code === 'EROFS'
            ? `permission denied: ${path}`
            : `could not write lock file ${path}${code ? ` (${code})` : ''}`
        );
      }
      const held = heldAt(lockPath(target));
      if (held !== null && now - held < LOCK_TTL_MS) return false;
      if (!takeOverStale(target, now)) return false;
    }
  }
  return false;
};

export const releaseFileLock = (target: string): void => unlinkQuiet(lockPath(target));

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// Run `fn` while holding the advisory lock for `target`, blocking with bounded backoff until the
// lock is free (or a crashed holder is taken over past the TTL). `fn` MUST be synchronous: the lock
// is held only across one synchronous critical section, so in-process callers can never both be
// inside it. The whole read-modify-write belongs in `fn` - locking only the write still loses
// updates across the read->write gap. Released in a finally, so a throw never wedges the lock.
export const withFileLock = async <T>(target: string, fn: () => T): Promise<T> => {
  const deadline = Date.now() + MAX_WAIT_MS;
  for (;;) {
    if (acquireFileLock(target)) {
      try {
        return fn();
      } finally {
        releaseFileLock(target);
      }
    }
    if (Date.now() >= deadline) {
      throw new Error(`could not acquire lock for ${target} within ${MAX_WAIT_MS}ms`);
    }
    await sleep(STEP_MS + Math.floor(Math.random() * STEP_MS));
  }
};
