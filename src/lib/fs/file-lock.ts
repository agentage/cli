import { randomBytes } from 'node:crypto';
import { linkSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

// A cross-process advisory lock keyed to a target file (`<target>.lock`).
export interface LockOptions {
  // Past this age a holder whose pid is gone counts as crashed and is taken over.
  ttlMs?: number;
  // Past this age a holder is taken over even if its pid resolves: only pid reuse explains it.
  hardStaleMs?: number;
  // How long withFileLock blocks on a contended lock before it throws.
  maxWaitMs?: number;
}

type Limits = Required<LockOptions>;

// Sized for sub-millisecond config read-modify-writes; the wait outlives the TTL on purpose.
const DEFAULTS: Limits = { ttlMs: 10_000, hardStaleMs: 60_000, maxWaitMs: 15_000 };
const STEP_MS = 25;

const limitsOf = (opts: LockOptions): Limits => ({
  ttlMs: opts.ttlMs ?? DEFAULTS.ttlMs,
  hardStaleMs: opts.hardStaleMs ?? DEFAULTS.hardStaleMs,
  maxWaitMs: opts.maxWaitMs ?? DEFAULTS.maxWaitMs,
});

const lockPath = (target: string): string => `${target}.lock`;

// "<pid> <at>"; a legacy single-token file parses as pid 0 (unknown holder) and ages out on the TTL.
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

// ESRCH = gone; EPERM = alive under another user; pid 0 (unknown) counts as gone.
const holderAlive = (pid: number): boolean => {
  if (pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
};

// Never steal a live-but-CPU-starved holder: two writers in the section drop an append (#249).
const isCrashed = (holder: { pid: number; at: number }, now: number, lim: Limits): boolean => {
  const age = now - holder.at;
  if (age < lim.ttlMs) return false;
  if (age >= lim.hardStaleMs) return true;
  return holder.pid === process.pid || !holderAlive(holder.pid);
};

const unlinkQuiet = (path: string): void => {
  try {
    unlinkSync(path);
  } catch {
    // already gone
  }
};

// Write-then-link: a reader can never see the lock before its "<pid> <at>" content (#231).
const createLockExclusive = (path: string, content: string): void => {
  const tmp = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.new`;
  writeFileSync(tmp, content);
  try {
    linkSync(tmp, path);
  } finally {
    unlinkQuiet(tmp);
  }
};

// Takeover runs under its own exclusive guard so no taker deletes a lock that turned fresh (ABA).
const takeOverStale = (target: string, now: number, lim: Limits): boolean => {
  const path = lockPath(target);
  const guard = `${path}.takeover`;
  const guardHeld = holderOf(guard);
  if (guardHeld !== null && isCrashed(guardHeld, now, lim)) unlinkQuiet(guard);
  try {
    createLockExclusive(guard, `${process.pid} ${now}`);
  } catch {
    return false; // another taker is mid-takeover; let it win
  }
  try {
    const holder = holderOf(path);
    // Unreadable content is not proof of a crash: only a provably crashed holder is cleared.
    if (holder === null || !isCrashed(holder, now, lim)) return false;
    unlinkQuiet(path);
    return true;
  } finally {
    unlinkQuiet(guard);
  }
};

// Only EEXIST is contention; a permission error never clears, so it fails fast.
const lockWriteError = (err: unknown, path: string): Error | null => {
  const code = (err as NodeJS.ErrnoException).code;
  if (code === 'EEXIST') return null;
  if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS')
    return new Error(`permission denied: ${path}`);
  return new Error(`could not write lock file ${path}${code ? ` (${code})` : ''}`);
};

const tryCreate = (path: string, now: number): boolean => {
  try {
    createLockExclusive(path, `${process.pid} ${now}`);
    return true;
  } catch (err) {
    const fatal = lockWriteError(err, path);
    if (fatal) throw fatal;
    return false;
  }
};

// One-shot acquire: the atomic link IS the mutex; a crashed holder is cleared and re-raced once.
export const acquireFileLock = (
  target: string,
  now: number = Date.now(),
  opts: LockOptions = {}
): boolean => {
  const lim = limitsOf(opts);
  const path = lockPath(target);
  mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
  for (let attempt = 0; attempt < 2; attempt++) {
    if (tryCreate(path, now)) return true;
    const holder = holderOf(path);
    if (holder === null || !isCrashed(holder, now, lim)) return false;
    if (!takeOverStale(target, now, lim)) return false;
  }
  return false;
};

// Only our own lock: a holder that took over after the hard-stale age keeps theirs.
export const releaseFileLock = (target: string): void => {
  const path = lockPath(target);
  if (holderOf(path)?.pid === process.pid) unlinkQuiet(path);
};

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// `fn` MUST be synchronous and hold the whole read-modify-write; released in a finally.
export const withFileLock = async <T>(
  target: string,
  fn: () => T,
  opts: LockOptions = {}
): Promise<T> => {
  const { maxWaitMs } = limitsOf(opts);
  const deadline = Date.now() + maxWaitMs;
  for (;;) {
    if (acquireFileLock(target, Date.now(), opts)) {
      try {
        return fn();
      } finally {
        releaseFileLock(target);
      }
    }
    if (Date.now() >= deadline)
      throw new Error(`could not acquire lock for ${target} within ${maxWaitMs}ms`);
    await sleep(STEP_MS + Math.floor(Math.random() * STEP_MS));
  }
};
