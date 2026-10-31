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
import { writeTextAtomic } from '../../lib/fs/json-file.js';

export const TREES = 'trees';
export const CURRENT = 'current';
export const COMPLETE = '.complete';
export const MANIFEST_FILE = 'package.json';
export const LOCK_FILE = 'package-lock.json';
export const NPM_MAJOR_FILE = 'npm-major';
// Dot-prefixed: `plugins/current` only accepts names starting with a letter or digit.
const STAGING_PREFIX = '.staging-';

export interface TreeFiles {
  manifest: string;
  lock: string | null;
}

export interface PromotedFiles extends TreeFiles {
  // The npm major that wrote `lock`; null keeps the recorded one.
  npmMajor: number | null;
}

// Content-addressed: the same normalized lock names the same tree on every machine.
export const treeName = (entries: string[]): string =>
  createHash('sha256').update(entries.join('\n')).digest('hex').slice(0, 16);

export const treePath = (pluginsDir: string, name: string): string => join(pluginsDir, TREES, name);

export const isComplete = (pluginsDir: string, name: string): boolean =>
  existsSync(join(treePath(pluginsDir, name), COMPLETE));

export const readText = (path: string): string | null => {
  try {
    return readFileSync(path, 'utf-8');
  } catch {
    return null;
  }
};

const remove = (path: string): void => rmSync(path, { recursive: true, force: true });

// Only called under the install lock, so every staging dir left over is from a dead run.
export const clearStaging = (pluginsDir: string): void => {
  const trees = join(pluginsDir, TREES);
  if (!existsSync(trees)) return;
  for (const name of readdirSync(trees).filter((n) => n.startsWith(STAGING_PREFIX)))
    remove(join(trees, name));
};

export const stageTree = (pluginsDir: string, files: TreeFiles): string => {
  const trees = join(pluginsDir, TREES);
  mkdirSync(trees, { recursive: true, mode: 0o700 });
  const dir = mkdtempSync(join(trees, STAGING_PREFIX));
  writeFileSync(join(dir, MANIFEST_FILE), files.manifest);
  if (files.lock !== null) writeFileSync(join(dir, LOCK_FILE), files.lock);
  return dir;
};

export const discardTree = (dir: string): void => remove(dir);

// `.complete` lands before the rename, so a tree appears finished or not at all.
export const commitTree = (pluginsDir: string, staging: string, name: string): void => {
  const target = treePath(pluginsDir, name);
  if (existsSync(join(target, COMPLETE))) return discardTree(staging);
  remove(target);
  writeFileSync(join(staging, COMPLETE), '');
  renameSync(staging, target);
};

export const pointCurrent = (pluginsDir: string, name: string): void =>
  writeTextAtomic(join(pluginsDir, CURRENT), `${name}\n`);

const writeOrRemove = (path: string, text: string | null): void =>
  text === null ? remove(path) : writeTextAtomic(path, text);

// The plugins root always describes the tree `current` names, never a failed attempt.
export const promoteFiles = (pluginsDir: string, files: PromotedFiles): void => {
  writeTextAtomic(join(pluginsDir, MANIFEST_FILE), files.manifest);
  writeOrRemove(join(pluginsDir, LOCK_FILE), files.lock);
  const major = join(pluginsDir, NPM_MAJOR_FILE);
  if (files.lock === null) remove(major);
  else if (files.npmMajor !== null) writeTextAtomic(major, `${files.npmMajor}\n`);
};
