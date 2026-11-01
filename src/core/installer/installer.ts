import { join } from 'node:path';
import { type NpmResult } from '../../lib/npm/npm-cli.js';
import { extensionsDir } from '../paths.js';
import { type Profile } from '../profile/schema.js';
import { lockAgrees, lockEntries, parseLock } from './compare-lock.js';
import { prepareNpm, type Npm, type NpmCommand } from './npm.js';
import { driftLines, lockDrift } from './plan.js';
import {
  clearStaging,
  collectTrees,
  commitTree,
  discardTree,
  isComplete,
  LOCK_FILE,
  manifestText,
  npmrcText,
  pointCurrent,
  promoteFiles,
  readText,
  sortedSet,
  stageTree,
  treeName,
  withInstallLock,
  type TreeFiles,
} from './tree.js';

// `lock`: the lock pulled with the profile, installed from instead of the local one.
export type InstallSet = Pick<Profile, 'extensions' | 'registries'> & {
  lock?: Record<string, unknown> | null;
};

export interface InstallPlan extends TreeFiles {
  extensionsDir: string;
  install: Record<string, string>;
  registries: Record<string, string>;
  // null skips npm: an empty set, or a complete tree already built from this lock.
  npm: NpmCommand | null;
  // Known up front for a matching lock or an empty set; else named from the lock npm writes.
  tree: string | null;
  reuse: boolean;
}

export interface InstallResult {
  tree: string;
  npm: NpmCommand | null;
  reused: boolean;
  count: number;
}

type LockPlan = Pick<InstallPlan, 'lock' | 'npm' | 'tree' | 'reuse'>;

// The current lock rides into the staged tree, so npm keeps every pin it can.
const lockPlan = (dir: string, install: Record<string, string>, raw: string | null): LockPlan => {
  if (Object.keys(install).length === 0) {
    const tree = treeName([]);
    return { lock: null, npm: null, tree, reuse: isComplete(dir, tree) };
  }
  const lock = parseLock(raw);
  if (lock === null) return { lock: null, npm: 'install', tree: null, reuse: false };
  if (!lockAgrees(lock, install)) return { lock: raw, npm: 'install', tree: null, reuse: false };
  const tree = treeName(lockEntries(lock));
  const reuse = isComplete(dir, tree);
  return { lock: raw, npm: reuse ? null : 'ci', tree, reuse };
};

// Reads only: `setup --dry-run` prints this and stops.
export const planInstall = (set: InstallSet): InstallPlan => {
  const dir = extensionsDir();
  const install = sortedSet(set.extensions);
  const registries = sortedSet(set.registries);
  const files = { manifest: manifestText(install), npmrc: npmrcText(registries) };
  const raw = set.lock ? `${JSON.stringify(set.lock, null, 2)}\n` : readText(join(dir, LOCK_FILE));
  const lock = lockPlan(dir, install, raw);
  return { extensionsDir: dir, install, registries, ...files, ...lock };
};

// npm's last lines, enough to see why it failed.
export const lastLines = (output: string, count = 20): string =>
  output
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .slice(-count)
    .join('\n');

const npmFailure = (command: NpmCommand, res: NpmResult): Error =>
  new Error(
    `npm ${command} failed (exit ${res.code}); extensions/current is unchanged\n` +
      lastLines(`${res.stdout}\n${res.stderr}`)
  );

// The staged tree's name and lock text, once npm succeeded in it; `packages` limits an update.
export const runNpmInto = async (
  staging: string,
  command: NpmCommand,
  npm: Npm,
  packages: string[] = []
) => {
  const res = await npm(command, staging, packages);
  if (res.code !== 0) throw npmFailure(command, res);
  const lock = readText(join(staging, LOCK_FILE));
  const parsed = parseLock(lock);
  if (lock === null || parsed === null)
    throw new Error(`npm ${command} wrote no usable ${LOCK_FILE}`);
  return { tree: treeName(lockEntries(parsed)), lock };
};

const build = async (plan: InstallPlan, prepare: () => Promise<Npm>) => {
  const npm = plan.npm === null ? null : await prepare();
  const staging = stageTree(plan.extensionsDir, plan);
  try {
    const built =
      npm === null || plan.npm === null
        ? { tree: treeName([]), lock: null }
        : await runNpmInto(staging, plan.npm, npm);
    commitTree(plan.extensionsDir, staging, built.tree);
    return built;
  } catch (err) {
    discardTree(staging);
    throw err;
  }
};

// A lock that disagrees with its own tree on a package's bytes is never built on.
export const refuseDrift = (dir: string): void => {
  const { integrity } = lockDrift(dir);
  if (integrity.length > 0) throw new Error(driftLines(integrity).join('\n'));
};

const execute = async (plan: InstallPlan, prepare: () => Promise<Npm>): Promise<InstallResult> => {
  refuseDrift(plan.extensionsDir);
  clearStaging(plan.extensionsDir);
  const built =
    plan.reuse && plan.tree !== null
      ? { tree: plan.tree, lock: plan.lock }
      : await build(plan, prepare);
  pointCurrent(plan.extensionsDir, built.tree);
  promoteFiles(plan.extensionsDir, { manifest: plan.manifest, lock: built.lock });
  collectTrees(plan.extensionsDir, built.tree);
  const count = Object.keys(plan.install).length;
  return { tree: built.tree, npm: plan.npm, reused: plan.reuse, count };
};

// Plans again under the lock: a run that waited sees the tree the first one built.
export const install = async (
  set: InstallSet,
  prepare: () => Promise<Npm> = prepareNpm
): Promise<InstallResult> =>
  withInstallLock(extensionsDir(), () => execute(planInstall(set), prepare));
