import { randomBytes } from 'node:crypto';
import { linkSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

// A cross-process advisory lock keyed to a target file (`<target>.lock`). Config read-modify-writes
// are sub-millisecond, so a lock past this age whose holder is gone is a crashed holder to take over.
const LOCK_TTL_MS = 10_000;
// A caller blocks up to this long for a contended lock. Past the TTL so a crashed holder is taken
// over rather than wedging the caller; a throw only happens if the lock is genuinely stuck.
const MAX_WAIT_MS = 15_000;
// Past this age a holder is taken over even if its pid still resolves - the only explanation left is
// pid reuse after a crash. Far beyond any real critical section or plausible scheduler pause, so a
// live-but-CPU-starved holder is never mistaken for crashed below it.
const STALE_HARD_MS = 60_000;
const STEP_MS = 25;

const lockPath = (target: string): string => `${target}.lock`;

// The lock file holds "<pid> <timestamp>": pid gates crash-takeover, the trailing token is the
// acquisition time used for staleness. A legacy single-token file parses as pid 0 (unknown holder).
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
// leftover pid (we cannot be inside our own synchronous section while here), or so old that pid reuse
// is the only explanation. A live holder merely starved of CPU is NEVER stolen - stealing it would
// put two writers in the critical section and silently drop an append (issue #249).
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

// Atomic exclusive create: writeFileSync('wx') is create-then-write, so a concurrent holderOf can
// read the freshly created but still-empty lock and mistake a live holder for absent (issue #231
// lost-update). Instead write the full "<pid> <at>" to a unique temp, then linkSync it into place:
// link is atomic and fails EEXIST if held, so the content is always complete when the lock appears.
const createLockExclusive = (path: string, content: string): void => {
  const tmp = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.new`;
  writeFileSync(tmp, content);
  try {
    linkSync(tmp, path);
  } finally {
    unlinkQuiet(tmp);
  }
};

// Serialize stale-lock takeover behind its own exclusive create so no taker can delete a lock that
// turned FRESH mid-takeover (the ABA race: a reader sees the stale timestamp, a winner re-creates
// the lock, the reader deletes the winner's file). Same O_EXCL-guard design proven in
// update-lock.ts. Returns whether to re-race the create.
const takeOverStale = (target: string, now: number): boolean => {
  const path = lockPath(target);
  const guard = `${path}.takeover`;
  const guardHeld = holderOf(guard);
  if (guardHeld !== null && isCrashed(guardHeld, now)) unlinkQuiet(guard);
  try {
    createLockExclusive(guard, `${process.pid} ${now}`);
  } catch {
    return false; // another taker is mid-takeover; let it win
  }
  try {
    const holder = holderOf(path);
    // A null holder means the lock file exists but its content did not read cleanly. Never treat that
    // as absent: clearing it here would steal a live holder still writing its bytes. Only a holder we
    // can positively prove crashed is taken over.
    if (holder === null || !isCrashed(holder, now)) return false;
    unlinkQuiet(path);
    return true;
  } finally {
    unlinkQuiet(guard);
  }
};

// One-shot acquire: the atomic link IS the mutex - concurrent callers cannot both win it, and the
// linked content is always complete so no reader sees an empty lock. A fresh or live holder refuses;
// a crashed one (dead holder past the TTL) is cleared under the takeover guard and re-raced once.
// `now` is injectable for tests.
export const acquireFileLock = (target: string, now: number = Date.now()): boolean => {
  mkdirSync(dirname(target), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      createLockExclusive(lockPath(target), `${process.pid} ${now}`);
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
      const holder = holderOf(lockPath(target));
      // Refuse unless the holder is positively crashed. A null holder (unreadable content) is NOT
      // proof of a crash: attempting takeover on it once stole a live holder's lock (issue #231).
      if (holder === null || !isCrashed(holder, now)) return false;
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
