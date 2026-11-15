// Test fixture only: the 0.51 install (one shared tree, switched by `current`). The cli no
// longer has it; tests build the 0.51 state that the new cli reads and never changes.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { lockEntries, parseLock } from '../core/installer/compare-lock.js';
import { prepareNpm, type Npm } from '../core/installer/npm.js';
import {
  commitTree,
  discardTree,
  LOCK_FILE,
  manifestText,
  npmrcText,
  readText,
  stageTree,
  withInstallLock,
} from '../core/installer/tree.js';
import { extensionsDir } from '../core/paths.js';
import { loadMachine, setProfileSource } from '../core/profile/machine.js';
import { keepMachine } from '../core/profile/merge.js';
import { mutateProfile, parseProfileText } from '../core/profile/profile.js';
import { type Profile } from '../core/profile/schema.js';
import { writeTextAtomic } from '../lib/fs/json-file.js';

type InstallSet = Pick<Profile, 'extensions' | 'registries'>;

// 0.51 named a tree by its normalized lock, so the same lock names the same tree.
const treeName = (lock: string | null): string => {
  const entries = lock === null ? [] : lockEntries(parseLock(lock) ?? {});
  return createHash('sha256').update(entries.join('\n')).digest('hex').slice(0, 16);
};

// npm install in a staged tree, keeping the pins of the current lock; an empty set skips npm.
const build = async (dir: string, set: InstallSet, npm: () => Promise<Npm>) => {
  const manifest = manifestText(set.extensions);
  const files = { manifest, npmrc: npmrcText(set.registries) };
  const staging = stageTree(dir, { ...files, lock: readText(join(dir, LOCK_FILE)) });
  const empty = Object.keys(set.extensions).length === 0;
  const res = empty ? null : await (await npm())('install', staging);
  if (res && res.code !== 0) {
    discardTree(staging);
    throw new Error(`npm install failed (exit ${res.code})`);
  }
  const lock = empty ? null : readText(join(staging, LOCK_FILE));
  commitTree(dir, staging, treeName(lock));
  return { tree: treeName(lock), manifest, lock };
};

// The new tree becomes current; the root files describe it and every other tree goes.
const promote = (dir: string, built: Awaited<ReturnType<typeof build>>): void => {
  writeTextAtomic(join(dir, 'current'), `${built.tree}\n`);
  writeTextAtomic(join(dir, 'package.json'), built.manifest);
  if (built.lock === null) rmSync(join(dir, LOCK_FILE), { force: true });
  else writeTextAtomic(join(dir, LOCK_FILE), built.lock);
  const trees = join(dir, 'trees');
  for (const name of existsSync(trees) ? readdirSync(trees) : [])
    if (name !== built.tree) rmSync(join(trees, name), { recursive: true, force: true });
};

export const install = async (
  set: InstallSet,
  npm: () => Promise<Npm> = prepareNpm
): Promise<{ tree: string }> =>
  withInstallLock(extensionsDir(), async () => {
    const built = await build(extensionsDir(), set, npm);
    promote(extensionsDir(), built);
    return { tree: built.tree };
  });

// What `setup --profile <file>` did in 0.51: save the profile, then build and switch the tree.
export const installOld = async (file: string, npm: () => Promise<Npm>): Promise<void> => {
  const parsed = parseProfileText(readFileSync(file, 'utf8'));
  if (!parsed.ok) throw new Error(`${file} is invalid`);
  const machine = await loadMachine();
  await mutateProfile((current) => keepMachine(parsed.profile, current, machine.id));
  await setProfileSource('file');
  await install(parsed.profile, npm);
};
