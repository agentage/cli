import { randomBytes } from 'node:crypto';
import { rmSync } from 'node:fs';
import { link, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { CliError } from '../json-output.js';
import { sleep } from '../wait.js';

// A copy of the kit's data-lock.ts and withFileLock (0.13), rule for rule; kitFileLock retires it.
const STEP_MS = 25;
const TRIES = 200;
const LOCKED = 'LOCKED';

// The locks of this process: our own pid in a lock not in here is stale (a container is pid 1 again).
const held = new Set<string>();

const alive = (pid: number): boolean => {
  try {
    return process.kill(pid, 0);
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
};

const holder = async (file: string): Promise<number> =>
  Number(await readFile(file, 'utf8').catch(() => '0'));

const live = (lock: string, pid: number): boolean =>
  pid === process.pid ? held.has(lock) : pid > 0 && alive(pid);

const locked = (pid: number) => Object.assign(new Error(String(pid)), { code: LOCKED, pid });

const unique = (file: string) => `${file}.${process.pid}.${randomBytes(4).toString('hex')}`;

const take = async (lock: string): Promise<boolean> => {
  const tmp = unique(lock);
  await writeFile(tmp, String(process.pid));
  try {
    await link(tmp, lock);
    held.add(lock);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    return false;
  } finally {
    await unlink(tmp).catch(() => undefined);
  }
};

// Only one taker moves the stale file away; one that moved a fresh lock puts it back and refuses.
const clearStale = async (lock: string, pid: number): Promise<void> => {
  const moved = unique(`${lock}.stale`);
  const gone = await rename(lock, moved).then(
    () => false,
    (err: NodeJS.ErrnoException) => err.code === 'ENOENT'
  );
  if (gone) return;
  const now = await holder(moved);
  if (now !== pid) {
    await link(moved, lock).catch(() => undefined);
    await unlink(moved);
    throw locked(now);
  }
  await unlink(moved);
};

const acquire = async (lock: string): Promise<void> => {
  if (await take(lock)) return;
  const pid = await holder(lock);
  if (live(lock, pid)) throw locked(pid);
  await clearStale(lock, pid);
  if (!(await take(lock))) throw locked(await holder(lock));
};

// A live holder is waited for, 200 x 25 ms as the kit; then `timeout` names it.
const acquireWaiting = async (file: string, lock: string, tries: number): Promise<void> => {
  for (let i = 0; ; i += 1) {
    try {
      return await acquire(lock);
    } catch (err) {
      const pid = (err as { code?: string; pid?: number }).pid;
      if ((err as { code?: string }).code !== LOCKED) throw err;
      if (i >= tries) throw new CliError('timeout', `${file} is held by process ${pid}; try again`);
      await sleep(STEP_MS);
    }
  }
};

export const withKitLock = async <T>(
  file: string,
  fn: () => T | Promise<T>,
  tries = TRIES
): Promise<T> => {
  const lock = `${file}.lock`;
  await acquireWaiting(file, lock, tries);
  try {
    return await fn();
  } finally {
    rmSync(lock, { force: true });
    held.delete(lock);
  }
};

export type FileLock = <T>(file: string, fn: () => T | Promise<T>) => Promise<T>;

interface KitHost {
  capabilities?: readonly string[];
  withFileLock?: FileLock;
}

// The kit's own lock once it ships it (capability `updateInstallation`); else the copy above.
export const kitFileLock = async (
  load: () => Promise<unknown> = () => import('@agentage/extension/host')
): Promise<FileLock> => {
  const kit = (await load()) as KitHost;
  const ships = kit.capabilities?.includes('updateInstallation') && kit.withFileLock;
  return ships || withKitLock;
};
