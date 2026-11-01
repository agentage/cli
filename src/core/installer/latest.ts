import { join } from 'node:path';
import { isRecord, readJson } from '../../lib/fs/json-file.js';
import { manifestInfo } from '../loader/manifest.js';
import { extensionsDir } from '../paths.js';
import { fitsApi } from './compat.js';
import { lockEntries, lockedVersion, parseLock, rootDependencies } from './compare-lock.js';
import {
  planInstall,
  refuseDrift,
  runNpmInto,
  type InstallPlan,
  type InstallSet,
} from './installer.js';
import { type Npm } from './npm.js';
import {
  clearStaging,
  collectTrees,
  commitTree,
  discardTree,
  pointCurrent,
  promoteFiles,
  readText,
  stageTree,
  treePath,
  withInstallLock,
} from './tree.js';

// One extension's version before and after; null where the tree did not or will not have it.
export interface VersionChange {
  name: string;
  from: string | null;
  to: string | null;
}

// Kept at `version`: the newest version its range allows, `newer`, needs extension API `engine`.
export interface Held {
  name: string;
  version: string;
  newer: string;
  engine: string;
}

export interface LatestResult {
  changes: VersionChange[];
  held: Held[];
  unchanged: number;
  // The tree npm built; null when nothing changed.
  tree: string | null;
  // true once that tree passed the check and is the one extensions/current names.
  current: boolean;
}

// The new tree, built and named, before it becomes current: `dir` is where to load it from.
export type Staged = Omit<LatestResult, 'tree' | 'current'> & { tree: string; dir: string };

// Loads the staged tree; false keeps the old tree current.
export type Check = (staged: Staged) => Promise<boolean>;

type Lock = ReturnType<typeof parseLock>;

interface Built {
  staging: string;
  tree: string;
  lock: Lock;
  raw: string;
}

const diff = (names: string[], before: Lock, after: Lock): VersionChange[] =>
  names
    .map((name) => ({ name, from: lockedVersion(before, name), to: lockedVersion(after, name) }))
    .filter((change) => change.from !== change.to);

// Every extension the profile names or the old lock installed, sorted.
const namesOf = (plan: InstallPlan, before: Lock): string[] => {
  const installed = before === null ? [] : Object.keys(rootDependencies(before));
  return [...new Set([...Object.keys(plan.install), ...installed])].sort();
};

const update = async (plan: InstallPlan, npm: Npm, packages: string[] = []): Promise<Built> => {
  const staging = stageTree(plan.extensionsDir, plan);
  try {
    const { tree, lock } = await runNpmInto(staging, 'update', npm, packages);
    return { staging, tree, lock: parseLock(lock), raw: lock };
  } catch (err) {
    discardTree(staging);
    throw err;
  }
};

const engineIn = (staging: string, name: string): string =>
  manifestInfo(readJson(join(staging, 'node_modules', name, 'package.json'), isRecord) ?? {})
    .engine;

// An extension whose new version needs another extension API stays where it was.
const heldIn = (built: Built, changes: VersionChange[]): Held[] =>
  changes.flatMap(({ name, from, to }) => {
    if (from === null || to === null) return [];
    const engine = engineIn(built.staging, name);
    return fitsApi(engine) ? [] : [{ name, version: from, newer: to, engine }];
  });

const unchanged = (plan: InstallPlan, changes: VersionChange[]): number =>
  Object.keys(plan.install).filter((name) => !changes.some((c) => c.name === name)).length;

// One update; when it moved an extension past the extension API, again without moving that one.
const settle = async (plan: InstallPlan, npm: Npm, names: string[], before: Lock) => {
  const first = await update(plan, npm);
  const changes = diff(names, before, first.lock);
  const held = heldIn(first, changes);
  if (held.length === 0) return { built: first, held };
  discardTree(first.staging);
  const moving = changes.map((c) => c.name).filter((name) => !held.some((h) => h.name === name));
  return { built: moving.length === 0 ? null : await update(plan, npm, moving), held };
};

const sameEntries = (a: Lock, b: Lock): boolean =>
  (a ? lockEntries(a).join('\n') : '') === (b ? lockEntries(b).join('\n') : '');

// A tree that failed its check goes, unless extensions/current already names it.
const dropUnlessCurrent = (dir: string, tree: string): void => {
  if (readText(join(dir, 'current'))?.trim() !== tree) discardTree(treePath(dir, tree));
};

// The new tree becomes current only once it passed the check; then it is the only tree left.
const commit = async (plan: InstallPlan, built: Built, staged: Staged, check: Check) => {
  commitTree(plan.extensionsDir, built.staging, built.tree);
  if (!(await check(staged))) {
    dropUnlessCurrent(plan.extensionsDir, built.tree);
    return false;
  }
  pointCurrent(plan.extensionsDir, built.tree);
  promoteFiles(plan.extensionsDir, { manifest: plan.manifest, lock: built.raw });
  collectTrees(plan.extensionsDir, built.tree);
  return true;
};

const run = async (plan: InstallPlan, prepare: () => Promise<Npm>, check: Check) => {
  refuseDrift(plan.extensionsDir);
  clearStaging(plan.extensionsDir);
  const before = parseLock(plan.lock);
  const names = namesOf(plan, before);
  const none: LatestResult = { changes: [], held: [], unchanged: 0, tree: null, current: false };
  if (names.length === 0) return none;
  const { built, held } = await settle(plan, await prepare(), names, before);
  const changes = built === null ? [] : diff(names, before, built.lock);
  const result = { ...none, changes, held, unchanged: unchanged(plan, changes) };
  if (built === null || sameEntries(before, built.lock)) {
    if (built !== null) discardTree(built.staging);
    return result;
  }
  const staged = { ...result, tree: built.tree, dir: treePath(plan.extensionsDir, built.tree) };
  return { ...result, tree: built.tree, current: await commit(plan, built, staged, check) };
};

// `setup --latest`: npm update from the current lock, under the install lock for the whole run.
export const updateLatest = (
  set: InstallSet,
  prepare: () => Promise<Npm>,
  check: Check
): Promise<LatestResult> =>
  withInstallLock(extensionsDir(), () => run(planInstall(set), prepare, check));
