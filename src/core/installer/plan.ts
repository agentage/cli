import { join } from 'node:path';
import { currentTree } from '../loader/discover.js';
import { extensionsDir } from '../paths.js';
import { integrityDrift, lockEntries, parseLock, rootDependencies } from './compare-lock.js';
import { LOCK_FILE, readText } from './tree.js';

export type PlanVerb = 'add' | 'update' | 'remove' | 'off' | 'unchanged';

export interface PlanEntry {
  verb: PlanVerb;
  name: string;
  // The profile's range or URL; null when the profile no longer names it.
  wanted: string | null;
  // The range or URL the current tree was installed with; null when the tree lacks it.
  current: string | null;
}

export type PlanSummary = Record<PlanVerb, number>;

export interface Plan {
  extensions: PlanEntry[];
  summary: PlanSummary;
}

// The desired state: the install set and what this machine turns off.
export interface Desired {
  install: Record<string, string>;
  off: string[];
}

export interface LockDrift {
  // name@version whose integrity differs between extensions/package-lock.json and the tree's lock.
  integrity: string[];
  matches: boolean;
}

// A changed range is an update: npm would resolve it again.
const verbOf = (wanted: string | null, current: string | null, off: boolean): PlanVerb => {
  if (current === null) return 'add';
  if (wanted === null) return 'remove';
  if (wanted !== current) return 'update';
  return off ? 'off' : 'unchanged';
};

const entryOf = (name: string, desired: Desired, current: Record<string, string>): PlanEntry => {
  const wanted = desired.install[name] ?? null;
  const now = current[name] ?? null;
  return { verb: verbOf(wanted, now, desired.off.includes(name)), name, wanted, current: now };
};

// One entry per package the profile or the current tree names, sorted by name.
export const planChanges = (desired: Desired, current: Record<string, string>): Plan => {
  const names = [...new Set([...Object.keys(desired.install), ...Object.keys(current)])].sort();
  const extensions = names.map((name) => entryOf(name, desired, current));
  const summary: PlanSummary = { add: 0, update: 0, remove: 0, off: 0, unchanged: 0 };
  for (const entry of extensions) summary[entry.verb] += 1;
  return { extensions, summary };
};

// What setup would change, e.g. ["1 to add"]; `off` stays installed, so it is never pending.
export const pendingChanges = (summary: PlanSummary): string[] =>
  (['add', 'update', 'remove'] as const)
    .filter((verb) => summary[verb] > 0)
    .map((verb) => `${summary[verb]} to ${verb}`);

type Lock = ReturnType<typeof parseLock>;

const treeLock = (dir: string): Lock => {
  const tree = currentTree(dir).dir;
  return tree === null ? null : parseLock(readText(join(tree, LOCK_FILE)));
};

// What the last install asked npm for; a tree reused for the same packages keeps its first lock.
export const currentDependencies = (dir = extensionsDir()): Record<string, string> => {
  const finished = currentTree(dir).dir !== null;
  const lock = finished ? parseLock(readText(join(dir, LOCK_FILE))) : null;
  return lock === null ? {} : rootDependencies(lock);
};

// extensions/package-lock.json describes the current tree; anything else was changed by hand.
export const lockDrift = (dir = extensionsDir()): LockDrift => {
  const root = parseLock(readText(join(dir, LOCK_FILE)));
  const tree = treeLock(dir);
  const entries = (lock: Lock) => (lock === null ? '' : lockEntries(lock).join('\n'));
  const integrity = root && tree ? integrityDrift(root, tree) : [];
  return { integrity, matches: entries(root) === entries(tree) };
};

export const driftLines = (integrity: string[]): string[] =>
  integrity.map((key) => `integrity drift: ${key}`);
