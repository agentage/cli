import { join } from 'node:path';
import { type NpmResult } from '../../lib/npm/npm-cli.js';
import { extensionsDir } from '../paths.js';
import { specProblem } from '../profile/schema.js';
import { lockAgrees, lockEntries, parseLock } from './compare-lock.js';
import {
  npmSettings,
  prepareNpm,
  type InstallerNpm,
  type NpmCommand,
  type NpmSettings,
} from './npm.js';
import {
  clearStaging,
  commitTree,
  discardTree,
  isComplete,
  LOCK_FILE,
  manifestText,
  pointCurrent,
  promoteFiles,
  readText,
  sortedSet,
  stageTree,
  treeName,
  withInstallLock,
} from './tree.js';

export interface InstallPlan {
  extensionsDir: string;
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
  extensionsDir: () => string;
  settings: () => NpmSettings;
  prepareNpm: (settings: NpmSettings) => Promise<InstallerNpm>;
  lock: <T>(extensionsDir: string, fn: () => Promise<T>) => Promise<T>;
}

export const defaultInstallerDeps: InstallerDeps = {
  extensionsDir,
  settings: () => npmSettings(),
  prepareNpm: (settings) => prepareNpm(settings),
  lock: (dir, fn) => withInstallLock(dir, fn),
};

// Not profile data: a stolen token cannot widen what this machine installs.
const CORE_SCOPES = ['@agentage'];

export const allowedScopes = (env: NodeJS.ProcessEnv = process.env): string[] => {
  const extra = (env['AGENTAGE_EXTENSION_SCOPES'] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '')
    .map((s) => (s.startsWith('@') ? s : `@${s}`));
  return [...new Set([...CORE_SCOPES, ...extra])];
};

const scopeProblem = (name: string, scopes: string[]): string | null => {
  const scope = name.startsWith('@') && name.includes('/') ? name.split('/')[0] : null;
  if (scope && scopes.includes(scope)) return null;
  const only = `only ${scopes.join(', ')} packages are installed`;
  return `refused by the scope rule: ${only} (AGENTAGE_EXTENSION_SCOPES widens it)`;
};

// The schema refuses bad specs on read; checked again because an install set can come from code.
export const installSetProblems = (
  install: Record<string, string>,
  scopes: string[] = allowedScopes()
): string[] =>
  Object.entries(install).flatMap(([name, spec]) => {
    const problem = scopeProblem(name, scopes) ?? specProblem(spec);
    return problem === null ? [] : [`extensions[${JSON.stringify(name)}]: ${problem}`];
  });

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
  const dir = deps.extensionsDir();
  const sorted = sortedSet(install);
  const raw = readText(join(dir, LOCK_FILE));
  const base = { extensionsDir: dir, registry: deps.settings().registry, install: sorted };
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
    `npm ${command} failed (exit ${res.code}); extensions/current is unchanged\n` +
      lastLines(`${res.stdout}\n${res.stderr}`)
  );

const runNpmInto = async (staging: string, command: NpmCommand, npm: InstallerNpm) => {
  const res = await npm.run(command, staging);
  if (res.code !== 0) throw npmFailure(command, res);
  const lock = readText(join(staging, LOCK_FILE));
  const parsed = parseLock(lock);
  if (parsed === null) throw new Error(`npm ${command} wrote no usable ${LOCK_FILE}`);
  return { tree: treeName(lockEntries(parsed)), lock };
};

const build = async (plan: InstallPlan, deps: InstallerDeps) => {
  const npm = plan.npm === null ? null : await deps.prepareNpm(deps.settings());
  const staging = stageTree(plan.extensionsDir, { manifest: plan.manifest, lock: plan.lock });
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

const execute = async (plan: InstallPlan, deps: InstallerDeps): Promise<InstallResult> => {
  clearStaging(plan.extensionsDir);
  const built =
    plan.reuse && plan.tree !== null
      ? { tree: plan.tree, lock: plan.lock }
      : await build(plan, deps);
  pointCurrent(plan.extensionsDir, built.tree);
  promoteFiles(plan.extensionsDir, { manifest: plan.manifest, lock: built.lock });
  const count = Object.keys(plan.install).length;
  return { tree: built.tree, npm: plan.npm, reused: plan.reuse, count };
};

// Plans again under the lock: a run that waited sees the tree the first one built.
export const install = async (
  installSet: Record<string, string>,
  deps: InstallerDeps = defaultInstallerDeps
): Promise<InstallResult> => {
  const problems = installSetProblems(installSet);
  if (problems.length > 0) throw new Error(problems.join('\n'));
  return deps.lock(deps.extensionsDir(), () => execute(planInstall(installSet, deps), deps));
};
