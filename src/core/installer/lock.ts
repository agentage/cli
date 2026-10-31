import { join } from 'node:path';
import {
  acquireFileLock,
  refreshFileLock,
  releaseFileLock,
  type LockOptions,
} from '../../lib/fs/file-lock.js';

export interface InstallLockDeps {
  acquire: (target: string, now: number, opts: LockOptions) => boolean;
  release: (target: string) => void;
  refresh: (target: string, now: number) => boolean;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  onWait: (lockFile: string) => void;
  limits: Required<LockOptions>;
  heartbeatMs: number;
}

// An install runs for minutes: the heartbeat keeps the stamp far younger than the TTL.
export const INSTALL_LOCK_LIMITS: Required<LockOptions> = {
  ttlMs: 2 * 60_000,
  hardStaleMs: 60 * 60_000,
  maxWaitMs: 30 * 60_000,
};
const HEARTBEAT_MS = 20_000;
const STEP_MS = 200;

const defaultDeps: InstallLockDeps = {
  acquire: acquireFileLock,
  release: releaseFileLock,
  refresh: refreshFileLock,
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  onWait: (lockFile) => console.error(`waiting for another install to finish (${lockFile})`),
  limits: INSTALL_LOCK_LIMITS,
  heartbeatMs: HEARTBEAT_MS,
};

// file-lock appends `.lock`, so the file on disk is `<pluginsDir>/install.lock`.
export const installLockTarget = (pluginsDir: string): string => join(pluginsDir, 'install');

const acquire = async (target: string, deps: InstallLockDeps): Promise<void> => {
  const deadline = deps.now() + deps.limits.maxWaitMs;
  let waiting = false;
  while (!deps.acquire(target, deps.now(), deps.limits)) {
    if (deps.now() >= deadline)
      throw new Error(
        `another install still holds ${target}.lock after ${deps.limits.maxWaitMs}ms`
      );
    if (!waiting) deps.onWait(`${target}.lock`);
    waiting = true;
    await deps.sleep(STEP_MS);
  }
};

// A second run waits here instead of racing the first one into the same plugins dir.
export const withInstallLock = async <T>(
  pluginsDir: string,
  fn: () => Promise<T>,
  deps: InstallLockDeps = defaultDeps
): Promise<T> => {
  const target = installLockTarget(pluginsDir);
  await acquire(target, deps);
  const beat = setInterval(() => deps.refresh(target, deps.now()), deps.heartbeatMs);
  beat.unref();
  try {
    return await fn();
  } finally {
    clearInterval(beat);
    deps.release(target);
  }
};
