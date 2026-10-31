import { join } from 'node:path';
import { type NpmResult } from '../../lib/npm/npm-cli.js';
import { pluginsDir } from '../paths.js';
import { lockAgrees, lockEntries, parseLock } from './compare-lock.js';
import { withInstallLock } from './lock.js';
import { manifestText, sortedSet } from './manifest-writer.js';
import {
  npmSettings,
  prepareNpm,
  type InstallerNpm,
  type NpmCommand,
  type NpmSettings,
} from './npm.js';
import { allowedScopes, installSetProblems } from './scope.js';
import {
  clearStaging,
  commitTree,
  discardTree,
  isComplete,
  LOCK_FILE,
  pointCurrent,
  promoteFiles,
  readText,
  stageTree,
  treeName,
} from './tree.js';

export interface InstallPlan {
  pluginsDir: string;
  registry: string;
  install: Record<string, string>;
  manifest: string;
  // Carried into the staged tree so npm keeps every pin it can.
  lock: string | null;
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

export interface InstallerDeps {
  pluginsDir: () => string;
  settings: () => NpmSettings;
  scopes: () => string[];
  prepareNpm: (settings: NpmSettings) => Promise<InstallerNpm>;
  lock: <T>(pluginsDir: string, fn: () => Promise<T>) => Promise<T>;
}

export const defaultInstallerDeps: InstallerDeps = {
  pluginsDir,
  settings: () => npmSettings(),
  scopes: () => allowedScopes(),
  prepareNpm: (settings) => prepareNpm(settings),
  lock: (dir, fn) => withInstallLock(dir, fn),
};

interface Built {
  tree: string;
  lock: string | null;
  npmMajor: number | null;
}

type LockPlan = Pick<InstallPlan, 'lock' | 'npm' | 'tree' | 'reuse'>;

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
export const planInstall = (
  install: Record<string, string>,
  deps: InstallerDeps = defaultInstallerDeps
): InstallPlan => {
  const dir = deps.pluginsDir();
  const sorted = sortedSet(install);
  const raw = readText(join(dir, LOCK_FILE));
  const base = { pluginsDir: dir, registry: deps.settings().registry, install: sorted };
  return { ...base, manifest: manifestText(sorted), ...lockPlan(dir, sorted, raw) };
};

export const lastLines = (output: string, count = 20): string =>
  output
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .slice(-count)
    .join('\n');

const npmFailure = (command: NpmCommand, res: NpmResult): Error =>
  new Error(
    `npm ${command} failed (exit ${res.code}); plugins/current is unchanged\n` +
      lastLines(`${res.stdout}\n${res.stderr}`)
  );

const runNpmInto = async (staging: string, command: NpmCommand, npm: InstallerNpm) => {
  const res = await npm.run(command, staging);
  if (res.code !== 0) throw npmFailure(command, res);
  const lock = readText(join(staging, LOCK_FILE));
  const parsed = parseLock(lock);
  if (parsed === null) throw new Error(`npm ${command} wrote no usable ${LOCK_FILE}`);
  const npmMajor = command === 'install' ? npm.major : null;
  return { tree: treeName(lockEntries(parsed)), lock, npmMajor };
};

const build = async (plan: InstallPlan, deps: InstallerDeps): Promise<Built> => {
  const npm = plan.npm === null ? null : await deps.prepareNpm(deps.settings());
  const staging = stageTree(plan.pluginsDir, { manifest: plan.manifest, lock: plan.lock });
  try {
    const built: Built =
      npm === null || plan.npm === null
        ? { tree: treeName([]), lock: null, npmMajor: null }
        : await runNpmInto(staging, plan.npm, npm);
    commitTree(plan.pluginsDir, staging, built.tree);
    return built;
  } catch (err) {
    discardTree(staging);
    throw err;
  }
};

const execute = async (plan: InstallPlan, deps: InstallerDeps): Promise<InstallResult> => {
  clearStaging(plan.pluginsDir);
  const built: Built =
    plan.reuse && plan.tree !== null
      ? { tree: plan.tree, lock: plan.lock, npmMajor: null }
      : await build(plan, deps);
  pointCurrent(plan.pluginsDir, built.tree);
  promoteFiles(plan.pluginsDir, { manifest: plan.manifest, ...built });
  const count = Object.keys(plan.install).length;
  return { tree: built.tree, npm: plan.npm, reused: plan.reuse, count };
};

export const checkInstallSet = (
  install: Record<string, string>,
  deps: InstallerDeps = defaultInstallerDeps
): void => {
  const problems = installSetProblems(install, deps.scopes());
  if (problems.length > 0) throw new Error(problems.join('\n'));
};

// Plans again under the lock: a run that waited sees the tree the first one built.
export const install = async (
  installSet: Record<string, string>,
  deps: InstallerDeps = defaultInstallerDeps
): Promise<InstallResult> => {
  checkInstallSet(installSet, deps);
  return deps.lock(deps.pluginsDir(), () => execute(planInstall(installSet, deps), deps));
};
