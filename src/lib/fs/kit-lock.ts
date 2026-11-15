import { randomBytes } from 'node:crypto';
import { linkSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { isAlive } from '../daemon/daemon-file.js';
import { CliError } from '../json-output.js';
import { sleep } from '../wait.js';

// The kit daemon's lock on its files: `<file>.lock` holds the pid, made by a hard link.
const STEP_MS = 25;
const TRIES = 200;

const holder = (lock: string): number => {
  try {
    return Number(readFileSync(lock, 'utf8')) || 0;
  } catch {
    return 0;
  }
};

const take = (lock: string): boolean => {
  const tmp = `${lock}.${process.pid}.${randomBytes(4).toString('hex')}`;
  writeFileSync(tmp, String(process.pid));
  try {
    linkSync(tmp, lock);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    return false;
  } finally {
    unlinkSync(tmp);
  }
};

const linkQuiet = (from: string, to: string): void => {
  try {
    linkSync(from, to);
  } catch {
    // another taker made a new lock meanwhile
  }
};

// Only one taker moves a dead holder's file away; a fresh lock moved by mistake is put back.
const clearStale = (lock: string, pid: number): void => {
  const moved = `${lock}.stale.${process.pid}.${randomBytes(4).toString('hex')}`;
  try {
    renameSync(lock, moved);
  } catch {
    return;
  }
  if (holder(moved) !== pid) linkQuiet(moved, lock);
  unlinkSync(moved);
};

// A live holder (this process too: the kit may hold it here) is waited for, about 5 s as the kit.
export const withKitLock = async <T>(file: string, fn: () => T, tries = TRIES): Promise<T> => {
  const lock = `${file}.lock`;
  for (let i = 0; !take(lock); i += 1) {
    const pid = holder(lock);
    if (pid !== process.pid && !isAlive(pid)) clearStale(lock, pid);
    else if (i >= tries)
      throw new CliError('timeout', `${file} is held by process ${pid}; try again`);
    else await sleep(STEP_MS);
  }
  try {
    return fn();
  } finally {
    rmSync(lock, { force: true });
  }
};
