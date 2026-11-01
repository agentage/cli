import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { refreshFileLock, withFileLock } from '../../lib/fs/file-lock.js';
import { writeTextAtomic } from '../../lib/fs/json-file.js';

export const LOCK_FILE = 'package-lock.json';
const MANIFEST_FILE = 'package.json';
const TREES = 'trees';
const COMPLETE = '.complete';
// A fixed name keeps the lock's root entry identical in every tree directory.
export const MANIFEST_NAME = 'agentage-modules';
// Dot-prefixed: `modules/current` only accepts names starting with a letter or digit.
const STAGING_PREFIX = '.staging-';
// An install runs for minutes: a long TTL plus a heartbeat keep a live holder from looking dead.
const INSTALL_LOCK = { ttlMs: 2 * 60_000, hardStaleMs: 60 * 60_000, maxWaitMs: 30 * 60_000 };
const HEARTBEAT_MS = 20_000;

export interface TreeFiles {
  manifest: string;
  lock: string | null;
}

export const sortedSet = (install: Record<string, string>): Record<string, string> =>
  Object.fromEntries(Object.entries(install).sort(([a], [b]) => (a < b ? -1 : 1)));

// Same install set, same bytes: no scripts, nothing machine-specific.
export const manifestText = (install: Record<string, string>): string =>
  `${JSON.stringify(
    { name: MANIFEST_NAME, private: true, dependencies: sortedSet(install) },
    null,
    2
  )}\n`;

// Content-addressed: the same normalized lock names the same tree on every machine.
export const treeName = (entries: string[]): string =>
  createHash('sha256').update(entries.join('\n')).digest('hex').slice(0, 16);

export const treePath = (modulesDir: string, name: string): string => join(modulesDir, TREES, name);

export const isComplete = (modulesDir: string, name: string): boolean =>
  existsSync(join(treePath(modulesDir, name), COMPLETE));

export const readText = (path: string): string | null => {
  try {
    return readFileSync(path, 'utf-8');
  } catch {
    return null;
  }
};

const remove = (path: string): void => rmSync(path, { recursive: true, force: true });

// Only called under the install lock, so every staging dir left over is from a dead run.
export const clearStaging = (modulesDir: string): void => {
  const trees = join(modulesDir, TREES);
  if (!existsSync(trees)) return;
  for (const name of readdirSync(trees).filter((n) => n.startsWith(STAGING_PREFIX)))
    remove(join(trees, name));
};

export const stageTree = (modulesDir: string, files: TreeFiles): string => {
  const trees = join(modulesDir, TREES);
  mkdirSync(trees, { recursive: true, mode: 0o700 });
  const dir = mkdtempSync(join(trees, STAGING_PREFIX));
  writeFileSync(join(dir, MANIFEST_FILE), files.manifest);
  if (files.lock !== null) writeFileSync(join(dir, LOCK_FILE), files.lock);
  return dir;
};

export const discardTree = (dir: string): void => remove(dir);

// `.complete` lands before the rename, so a tree appears finished or not at all.
export const commitTree = (modulesDir: string, staging: string, name: string): void => {
  const target = treePath(modulesDir, name);
  if (existsSync(join(target, COMPLETE))) return discardTree(staging);
  remove(target);
  writeFileSync(join(staging, COMPLETE), '');
  renameSync(staging, target);
};

export const pointCurrent = (modulesDir: string, name: string): void =>
  writeTextAtomic(join(modulesDir, 'current'), `${name}\n`);

// The modules root always describes the tree `current` names, never a failed attempt.
export const promoteFiles = (modulesDir: string, files: TreeFiles): void => {
  writeTextAtomic(join(modulesDir, MANIFEST_FILE), files.manifest);
  const lock = join(modulesDir, LOCK_FILE);
  if (files.lock === null) remove(lock);
  else writeTextAtomic(lock, files.lock);
};

const heartbeat = async <T>(target: string, fn: () => Promise<T>): Promise<T> => {
  const beat = setInterval(() => refreshFileLock(target), HEARTBEAT_MS);
  beat.unref();
  try {
    return await fn();
  } finally {
    clearInterval(beat);
  }
};

// A second run waits on `<modulesDir>/install.lock` instead of racing the first one.
export const withInstallLock = <T>(modulesDir: string, fn: () => Promise<T>): Promise<T> => {
  const target = join(modulesDir, 'install');
  const onWait = (): void =>
    console.error(`waiting for another install to finish (${target}.lock)`);
  return withFileLock(target, () => heartbeat(target, fn), { ...INSTALL_LOCK, onWait });
};
